import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import MagicString from 'magic-string';
import { SourceMapConsumer } from '@jridgewell/source-map';
import { get_input_files } from './utils.js';

/**
 * @param {{
 *   output: string;
 *   modules: Record<string, string>;
 *   project?: string;
 *   include?: string[];
 *   exclude?: string[];
 * }} options
 * @returns {Promise<void>}
 */
export async function createBundle(options) {
	const project = options.project ?? 'tsconfig.json';
	const output = path.resolve(options.output);

	/** @type {Record<string, string>} */
	const modules = {};
	for (const id in options.modules) {
		modules[id] = path.resolve(options.modules[id]).replace(/(\.d\.ts|\.js|\.ts)$/, '.d.ts');
	}

	const cwd = path.dirname(project);
	const tsconfig = eval(`(${fs.readFileSync(project, 'utf-8')})`);

	const input = get_input_files(
		cwd,
		options.include ?? tsconfig.include,
		options.exclude ?? tsconfig.exclude
	);

	const original_cwd = process.cwd();
	process.chdir(cwd);

	/** @type {ts.CompilerOptions} */
	const compilerOptions = {
		...tsconfig.compilerOptions,
		allowJs: true,
		declaration: true,
		declarationDir: undefined,
		declarationMap: true,
		emitDeclarationOnly: true,
		moduleResolution: undefined,
		noEmit: false
	};

	/** @type {Record<string, string>} */
	const created = {};
	const host = ts.createCompilerHost(compilerOptions);
	host.writeFile = (file, contents) => (created[file] = contents);

	const program = ts.createProgram(input, compilerOptions, host);
	program.emit();

	let types = '';

	/**
	 * @type {Map<string, import('./types').Module>}
	 */
	const cache = new Map();

	/**
	 * @param {string} file
	 * @returns {import('./types').Module}
	 */
	function get_dts(file) {
		const authored = !(file in created);
		const map_file = authored ? null : file + '.map';

		if (!cache.has(file)) {
			const source = created[file] ?? fs.readFileSync(file, 'utf8');
			const map = map_file && created[map_file];

			const ast = ts.createSourceFile(
				file,
				source,
				ts.ScriptTarget.Latest,
				false,
				ts.ScriptKind.TS
			);

			cache.set(file, {
				authored,
				source,
				ast,
				smc: map ? new SourceMapConsumer(JSON.parse(map), map_file) : null
			});
		}

		return /** @type {import('./types').Module} */ (cache.get(file));
	}

	/**
	 * @param {string} from
	 * @param {string} to
	 */
	function resolve_dts(from, to) {
		const file = path.resolve(path.dirname(from), to);
		if (file.endsWith('.d.ts')) return file;
		if (file.endsWith('.ts')) return file.replace(/\.ts$/, '.d.ts');
		if (file.endsWith('.js')) return file.replace(/\.js$/, '.d.ts');
		return file + '.d.ts';
	}

	/** @type {Map<string, string[]>} **/
	const exports = new Map();

	/** @type {Set<string>} */
	const ambient_modules = new Set();

	for (const id in modules) {
		types += `declare module '${id}' {`;

		const included = new Set([modules[id]]);

		/**
		 * A map of module IDs to the names of the things they export
		 * @type {Map<string, string[]>}
		 */
		const module_exports = new Map();

		const modules_to_export_all_from = new Set([modules[id]]);

		for (const file of included) {
			types += '\n';
			const module = get_dts(file);

			/** @type {string[]} */
			const exported = [];

			module_exports.set(file, exported);

			const magic_string = new MagicString(module.source);

			const index = module.source.indexOf('//# sourceMappingURL=');
			if (index !== -1) magic_string.remove(index, module.source.length);

			ts.forEachChild(module.ast, (node) => {
				// follow imports
				if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
					if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
						const { text } = node.moduleSpecifier;

						// if a module imports from the module we're currently declaring,
						// just remove the import altogether
						if (text === id) {
							magic_string.remove(node.pos, node.end);
						}

						// if a module imports from another module we're declaring,
						// leave the import intact
						if (text in modules) {
							return;
						}

						// resolve relative imports and aliases (from tsconfig.paths)
						const resolved = text.startsWith('.')
							? resolve_dts(file, text)
							: compilerOptions.paths && text in compilerOptions.paths
							? resolve_dts(cwd, compilerOptions.paths[text][0])
							: null;

						if (resolved) {
							if (ts.isImportDeclaration(node) && !node.importClause) {
								// assume this is an ambient module
								ambient_modules.add(resolved);
							} else {
								included.add(resolved);
							}

							if (ts.isExportDeclaration(node)) {
								if (node.exportClause) {
									// export { x } from '...';
									node.exportClause.forEachChild((specifier) => {
										if (ts.isExportSpecifier(specifier)) {
											if (specifier.propertyName) {
												throw new Error(`export { x as y } is not yet implemented`);
											}

											const name = specifier.getText(module.ast);
											exported.push(name);
										}
									});
								} else {
									// export * from '...';
									modules_to_export_all_from.add(resolved);
								}
							}

							magic_string.remove(node.pos, node.end);
						}
					}

					return;
				}

				if (
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isClassDeclaration(node) ||
					ts.isFunctionDeclaration(node) ||
					ts.isVariableStatement(node)
				) {
					const export_modifier = node.modifiers && node.modifiers.find((node) => node.kind === 93);
					if (export_modifier) {
						const name = ts.isVariableStatement(node)
							? ts.getNameOfDeclaration(node.declarationList.declarations[0])
							: ts.getNameOfDeclaration(node);

						if (name) {
							exported.push(name.getText(module.ast));
						}

						// remove all export keywords in the initial pass; reinstate as necessary later
						let b = export_modifier.end;
						const a = b - 6;
						while (/\s/.test(module.source[b])) b += 1;

						magic_string.remove(a, b);
					}

					walk(node, (node) => {
						// `import('./foo').Foo` -> `Foo`
						if (
							ts.isImportTypeNode(node) &&
							ts.isLiteralTypeNode(node.argument) &&
							ts.isStringLiteral(node.argument.literal) &&
							node.argument.literal.text.startsWith('.')
						) {
							// follow import
							const resolved = resolve_dts(file, node.argument.literal.text);

							included.add(resolved);

							// remove the `import(...)`
							if (node.qualifier) {
								let a = node.pos;
								while (/\s/.test(module.source[a])) a += 1;
								magic_string.remove(a, node.qualifier.pos);
							} else {
								throw new Error('TODO');
							}
						}

						// @ts-expect-error
						if (node.jsDoc) {
							// @ts-expect-error
							for (const jsDoc of node.jsDoc) {
								if (jsDoc.comment) {
									// @ts-expect-error
									jsDoc.tags?.forEach((tag) => {
										magic_string.remove(tag.pos, tag.end);
									});
								} else {
									magic_string.remove(jsDoc.pos, jsDoc.end);
								}
							}
						}
					});
				}
			});

			types += magic_string.trim().indent().toString();
		}

		/** @type {string[]} */
		const exported = [];
		exports.set(id, exported);

		for (const id of modules_to_export_all_from) {
			for (const name of /** @type {string[]} */ (module_exports.get(id))) {
				exported.push(name);
			}
		}

		types += `\n}\n\n`;
	}

	for (const file of ambient_modules) {
		const module = get_dts(file);

		const magic_string = new MagicString(module.source);

		const index = module.source.indexOf('//# sourceMappingURL=');
		if (index !== -1) magic_string.remove(index, module.source.length);

		ts.forEachChild(module.ast, (node) => {
			if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
				walk(node, (node) => {
					// @ts-expect-error
					if (node.jsDoc) {
						// @ts-expect-error
						for (const jsDoc of node.jsDoc) {
							if (jsDoc.comment) {
								// @ts-expect-error
								jsDoc.tags?.forEach((tag) => {
									magic_string.remove(tag.pos, tag.end);
								});
							} else {
								magic_string.remove(jsDoc.pos, jsDoc.end);
							}
						}
					}
				});
			}
		});

		types += magic_string.trim().toString();
	}

	// finally, add back exports as appropriate
	const ast = ts.createSourceFile(output, types, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const magic_string = new MagicString(types.toString());

	ts.forEachChild(ast, (node) => {
		if (ts.isModuleDeclaration(node)) {
			if (!node.body) return;

			const name = node.name.text;

			const exported = exports.get(name);
			if (!exported) return;

			node.body.forEachChild((node) => {
				if (
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isClassDeclaration(node) ||
					ts.isFunctionDeclaration(node) ||
					ts.isVariableStatement(node)
				) {
					const identifier = ts.isVariableStatement(node)
						? ts.getNameOfDeclaration(node.declarationList.declarations[0])
						: ts.getNameOfDeclaration(node);

					if (identifier) {
						const name = identifier.getText(ast);
						if (exported.includes(name)) {
							const start = node.getStart(ast);
							magic_string.prependRight(start, 'export ');
						}
					}
				}
			});
		}
	});

	// then save
	try {
		fs.mkdirSync(path.dirname(output), { recursive: true });
	} catch {
		// ignore
	}

	// const comment = `//# sourceMappingURL=${path.basename(output)}.map`;
	// types += `\n${comment}`;

	fs.writeFileSync(output, magic_string.toString());

	// TODO generate sourcemap
	// fs.writeFileSync(`${this.#filename}.map`, JSON.stringify(types.smg, null, '\t'));

	process.chdir(original_cwd);
}

/**
 * @param {import('typescript').Node} node
 * @param {(node: import('typescript').Node) => void} callback
 */
function walk(node, callback) {
	callback(node);
	ts.forEachChild(node, (child) => walk(child, callback));
}
