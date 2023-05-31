import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import MagicString from 'magic-string';
import { getLocator } from 'locate-character';
import { SourceMapGenerator } from '@jridgewell/source-map';
import { decode } from '@jridgewell/sourcemap-codec';
import { get_input_files, write } from './utils.js';

/**
 * @param {{
 *   output: string;
 *   modules: Record<string, string>;
 *   project?: string;
 *   include?: string[];
 *   exclude?: string[];
 *   debug?: string;
 * }} options
 * @returns {Promise<void>}
 */
export async function createBundle(options) {
	const project = options.project ?? 'tsconfig.json';
	const output = path.resolve(options.output);
	const debug = options.debug && path.resolve(options.debug);

	/** @type {Record<string, string>} */
	const modules = {};
	for (const id in options.modules) {
		modules[id] = path.resolve(options.modules[id]).replace(/(\.d\.ts|\.js|\.ts)$/, '.d.ts');
	}

	const cwd = path.resolve(path.dirname(project));
	const tsconfig = eval(`(${fs.readFileSync(project, 'utf-8')})`);

	const input = get_input_files(
		cwd,
		options.include ?? tsconfig.include,
		options.exclude ?? tsconfig.exclude
	);

	const original_cwd = process.cwd();
	process.chdir(cwd);

	try {
		/** @type {ts.CompilerOptions} */
		const compilerOptions = {
			...tsconfig.compilerOptions,
			allowJs: true,
			checkJs: true,
			declaration: true,
			declarationDir: undefined,
			declarationMap: true,
			emitDeclarationOnly: true,
			moduleResolution: undefined,
			noEmit: false,
			noEmitOnError: false,
			outDir: undefined
		};

		/** @type {Record<string, string>} */
		const created = {};
		const host = ts.createCompilerHost(compilerOptions);
		host.writeFile = (file, contents) => (created[file] = contents);

		const program = ts.createProgram(input, compilerOptions, host);
		program.emit();

		if (debug) {
			for (const file in created) {
				const relative = path.relative(cwd, file);
				const dest = path.join(debug, relative);
				write(dest, created[file]);
			}

			for (const file of input) {
				if (!file.endsWith('.d.ts')) continue;
				const relative = path.relative(cwd, file);
				const dest = path.join(debug, relative);
				write(dest, fs.readFileSync(file, 'utf-8'));
			}
		}

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
				const dts = created[file] ?? fs.readFileSync(file, 'utf8');
				const map = map_file && JSON.parse(created[map_file]);

				const ast = ts.createSourceFile(file, dts, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

				const source_file = map && path.resolve(path.dirname(file), map.sources[0]);
				const source = source_file && fs.readFileSync(source_file, 'utf8');

				/** @type {import('./types').Module} */
				const module = {
					type: authored ? 'authored' : 'generated',
					dts,
					source,
					ast,
					map,
					mappings: map ? decode(map.mappings) : null,
					locator: getLocator(dts, { offsetLine: 1 }),
					result: new MagicString(dts)
				};

				cache.set(file, module);
			}

			return /** @type {import('./types').Module} */ (cache.get(file));
		}

		/**
		 * @param {string} from
		 * @param {string} to
		 */
		function resolve_dts(from, to) {
			const file = path.resolve(from, to);
			if (file.endsWith('.d.ts')) return file;
			if (file.endsWith('.ts')) return file.replace(/\.ts$/, '.d.ts');
			if (file.endsWith('.js')) return file.replace(/\.js$/, '.d.ts');
			return file + '.d.ts';
		}

		/** @type {Map<string, string[]>} **/
		const all_exports = new Map();

		/** @type {Map<string, Map<string, import('./types').Mapping>>} */
		const all_mappings = new Map();

		/** @type {Set<string>} */
		const ambient_modules = new Set();

		let first = true;

		for (const id in modules) {
			if (!first) types += '\n\n';
			first = false;

			types += `declare module '${id}' {`;

			/** @type {Map<string, import('./types').Mapping>} */
			const mappings = new Map();
			all_mappings.set(id, mappings);

			const included = new Set([modules[id]]);

			/**
			 * A map of module IDs to the names of the things they export
			 * @type {Map<string, string[]>}
			 */
			const module_exports = new Map();

			const modules_to_export_all_from = new Set([modules[id]]);

			/** @type {import('./types').Module[]} */
			const bundle = [];

			for (const file of included) {
				const module = get_dts(file);

				/** @type {string[]} */
				const exported = [];

				module_exports.set(file, exported);

				const index = module.dts.indexOf('//# sourceMappingURL=');
				if (index !== -1) module.result.remove(index, module.dts.length);

				ts.forEachChild(module.ast, (node) => {
					// follow imports
					if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
						if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
							const { text } = node.moduleSpecifier;

							// if a module imports from the module we're currently declaring,
							// just remove the import altogether
							if (text === id) {
								module.result.remove(node.pos, node.end);
							}

							// if a module imports from another module we're declaring,
							// leave the import intact
							if (text in modules) {
								return;
							}

							// resolve relative imports and aliases (from tsconfig.paths)
							const resolved = text.startsWith('.')
								? resolve_dts(path.dirname(file), text)
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

								module.result.remove(node.pos, node.end);
							}
						}

						return;
					}

					if (is_declaration(node)) {
						const export_modifier = node.modifiers?.find((node) => node.kind === 93);
						if (export_modifier) {
							const identifier = ts.isVariableStatement(node)
								? ts.getNameOfDeclaration(node.declarationList.declarations[0])
								: ts.getNameOfDeclaration(node);

							if (identifier) {
								const name = identifier.getText(module.ast);
								exported.push(name);

								const pos = identifier.getStart(module.ast);
								const loc = module.locator(pos);

								if (module.mappings) {
									// the sourcemaps generated by TypeScript are very inaccurate, borderline useless.
									// we need to fix them up here. TODO is it only inaccurate in the JSDoc case?
									const segments = module.mappings?.[loc.line - 1];

									// find the segments immediately before and after the generated column
									const index = segments.findIndex((segment) => segment[0] >= loc.column);
									const a = segments[index - 1] ?? segments[0];
									let l = /** @type {number} */ (a[2]);

									const source_line = module.source.split('\n')[l];
									const regex = new RegExp(`\\b${name}\\b`);
									const match = regex.exec(source_line);

									if (match) {
										const mapping = {
											source: path.resolve(path.dirname(file), module.map.sources[0]),
											line: l + 1,
											column: match.index
										};

										mappings.set(name, /** @type {import('./types').Mapping} */ (mapping));
									} else {
										// TODO figure out how to repair sourcemaps in this case
									}
								} else {
									const mapping = {
										source: file,
										line: loc.line,
										column: loc.column
									};

									mappings.set(name, /** @type {import('./types').Mapping} */ (mapping));
								}
							}

							// remove all export keywords in the initial pass; reinstate as necessary later
							let b = export_modifier.end;
							const a = b - 6;
							while (/\s/.test(module.dts[b])) b += 1;

							module.result.remove(a, b);

							// remove `default` keyword
							const default_modifier = node.modifiers?.find((node) => node.kind === 88);
							if (default_modifier) {
								let b = default_modifier.end;
								const a = b - 7;
								while (/\s/.test(module.dts[b])) b += 1;

								module.result.remove(a, b);
							}
						}

						const declare_modifier = node.modifiers?.find((node) => node.kind === 136);
						if (declare_modifier) {
							// i'm not sure why typescript turns `export function` in a .ts file to `export declare function`,
							// but it's weird and we don't want it
							let b = declare_modifier.end;
							const a = b - 7;
							while (/\s/.test(module.dts[b])) b += 1;

							module.result.remove(a, b);
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
								const resolved = resolve_dts(path.dirname(file), node.argument.literal.text);

								included.add(resolved);

								// remove the `import(...)`
								if (node.qualifier) {
									let a = node.pos;
									while (/\s/.test(module.dts[a])) a += 1;
									module.result.remove(a, node.qualifier.pos);
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
											const kind = tag.tagName.escapedText;
											if (kind === 'example' || kind === 'default') return; // TODO others?
											module.result.remove(tag.pos, tag.end);
										});
									} else {
										module.result.remove(jsDoc.pos, jsDoc.end);
									}
								}
							}
						});
					}
				});

				bundle.push(module);
			}

			for (const module of bundle) {
				const mod = module.result
					.trim()
					.indent()
					.toString()
					.replace(/^(    )+/gm, (match) => '\t'.repeat(match.length / 4));
				if (mod) types += '\n' + mod;
			}

			/** @type {string[]} */
			const exported = [];
			all_exports.set(id, exported);

			for (const id of modules_to_export_all_from) {
				for (const name of /** @type {string[]} */ (module_exports.get(id))) {
					exported.push(name);
				}
			}

			types += `\n}`;
		}

		for (const file of ambient_modules) {
			const module = get_dts(file);

			const index = module.dts.indexOf('//# sourceMappingURL=');
			if (index !== -1) module.result.remove(index, module.dts.length);

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
										module.result.remove(tag.pos, tag.end);
									});
								} else {
									module.result.remove(jsDoc.pos, jsDoc.end);
								}
							}
						}
					});
				}
			});

			types += module.result.trim().toString();
		}

		// finally, add back exports as appropriate
		const ast = ts.createSourceFile(output, types, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
		const magic_string = new MagicString(types);
		const locator = getLocator(types, { offsetLine: 1 });
		const smg = new SourceMapGenerator({ file: path.basename(output) });

		/** @type {Set<string>} */
		const sources = new Set();

		ts.forEachChild(ast, (node) => {
			if (ts.isModuleDeclaration(node)) {
				if (!node.body) return;

				const name = node.name.text;

				const exported = all_exports.get(name);
				if (!exported) return;

				const mappings = all_mappings.get(name);

				node.body.forEachChild((node) => {
					if (is_declaration(node)) {
						const identifier = ts.isVariableStatement(node)
							? ts.getNameOfDeclaration(node.declarationList.declarations[0])
							: ts.getNameOfDeclaration(node);

						if (identifier) {
							const name = identifier.getText(ast);
							if (exported.includes(name)) {
								const start = node.getStart(ast);
								magic_string.prependRight(start, 'export ');
							}

							const mapping = mappings?.get(name);

							if (mapping) {
								const start = identifier.getStart(ast);
								let { line, column } = locator(start);
								if (exported.includes(name)) column += 7;

								const relative = path.relative(path.dirname(output), mapping.source);

								smg.addMapping({
									generated: { line, column },
									original: { line: mapping.line, column: mapping.column },
									source: relative,
									name
								});

								smg.addMapping({
									generated: { line, column: column + name.length },
									original: { line: mapping.line, column: mapping.column + name.length },
									source: relative,
									name
								});

								sources.add(mapping.source);
							}
						}
					}
				});
			}
		});

		// for (const source of sources) {
		// 	smg.setSourceContent(
		// 		path.relative(path.dirname(output), source),
		// 		fs.readFileSync(source, 'utf8')
		// 	);
		// }

		const comment = `//# sourceMappingURL=${path.basename(output)}.map`;
		magic_string.append(`\n\n${comment}`);

		write(output, magic_string.toString());

		write(`${output}.map`, JSON.stringify(smg.toJSON(), null, '\t'));
	} finally {
		process.chdir(original_cwd);
	}
}

/**
 * @param {import('typescript').Node} node
 * @param {(node: import('typescript').Node) => void} callback
 */
function walk(node, callback) {
	callback(node);
	ts.forEachChild(node, (child) => walk(child, callback));
}

/**
 * @param {import('typescript').Node} node
 * @returns {node is
 *   import('typescript').InterfaceDeclaration |
 *   import('typescript').TypeAliasDeclaration |
 *   import('typescript').ClassDeclaration |
 *   import('typescript').FunctionDeclaration |
 *   import('typescript').VariableStatement
 * }
 */
function is_declaration(node) {
	return (
		ts.isInterfaceDeclaration(node) ||
		ts.isTypeAliasDeclaration(node) ||
		ts.isClassDeclaration(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isVariableStatement(node)
	);
}
