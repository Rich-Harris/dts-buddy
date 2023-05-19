import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import MagicString from 'magic-string';
import { SourceMapConsumer } from '@jridgewell/source-map';
import { File, get_input_files } from './utils.js';

/**
 * @param {{
 *   output: string;
 *   modules: Record<string, string>;
 *   project?: string;
 *   ambient?: string;
 *   include?: string[];
 *   exclude?: string[];
 * }} options
 * @returns {Promise<void>}
 */
export async function createModuleDeclarations(options) {
	const project = options.project ?? 'tsconfig.json';
	const output = path.resolve(options.output);

	/** @type {Record<string, string>} */
	const modules = {};
	for (const id in options.modules) {
		modules[id] = path
			.resolve(options.modules[id])
			.replace(/(\.d\.ts|\.js|\.ts)$/, '.d.ts');
	}

	const cwd = path.dirname(project);
	const tsconfig = eval(`(${fs.readFileSync(project, 'utf-8')})`);

	const input = get_input_files(
		cwd,
		options.include ?? tsconfig.include,
		options.exclude ?? tsconfig.exclude
	);

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

	// TODO generate ambient declarations alongside types
	const types = new File(output);

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

	// for (const file in created) {
	// 	console.log(`\u001B[1m\u001B[35m${file}\u001B[39m\u001B[22m`);
	// 	console.log(created[file]);
	// 	console.log('\n');
	// }

	/** @type {Set<string>} */
	const ambient_modules = new Set();

	for (const id in modules) {
		types.append(`declare module '${id}' {`);

		const included = new Set([modules[id]]);
		const modules_to_export_from = new Set([modules[id]]);

		const exports = new Map();

		for (const file of included) {
			types.append('\n');
			const module = get_dts(file);
			exports.set(file, []);

			const magic_string = new MagicString(module.source);

			const index = module.source.indexOf('//# sourceMappingURL=');
			if (index !== -1) magic_string.remove(index, module.source.length);

			ts.forEachChild(module.ast, (node) => {
				// follow imports
				if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
					// TODO handle node_modules as well as relative imports, where specified
					if (
						node.moduleSpecifier &&
						ts.isStringLiteral(node.moduleSpecifier)
					) {
						if (node.moduleSpecifier.text.startsWith('.')) {
							const resolved = resolve_dts(file, node.moduleSpecifier.text);

							if (ts.isImportDeclaration(node) && !node.importClause) {
								// assume this is an ambient module
								ambient_modules.add(resolved);
							} else {
								included.add(resolved);
							}

							magic_string.remove(node.pos, node.end);
						}

						if (node.moduleSpecifier.text === id) {
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
					const name = ts.isVariableStatement(node)
						? ts.getNameOfDeclaration(node.declarationList.declarations[0])
						: ts.getNameOfDeclaration(node);

					if (name) {
						exports.get(file).push(name.getText(module.ast));
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

						if (node.jsDoc) {
							for (const jsDoc of node.jsDoc) {
								if (jsDoc.comment) {
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

			types.append(magic_string.trim().indent().toString());
		}

		types.append(`\n}\n\n`);
	}

	for (const file of ambient_modules) {
		const module = get_dts(file);

		const magic_string = new MagicString(module.source);

		const index = module.source.indexOf('//# sourceMappingURL=');
		if (index !== -1) magic_string.remove(index, module.source.length);

		ts.forEachChild(module.ast, (node) => {
			if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
				walk(node, (node) => {
					if (node.jsDoc) {
						for (const jsDoc of node.jsDoc) {
							if (jsDoc.comment) {
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

		types.append(magic_string.trim().toString());
	}

	types.save();
}

/**
 * @param {import('typescript').Node} node
 * @param {(node: import('typescript').Node) => void} callback
 */
function walk(node, callback) {
	callback(node);
	ts.forEachChild(node, (child) => walk(child, callback));
}
