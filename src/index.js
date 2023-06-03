import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import MagicString from 'magic-string';
import { getLocator } from 'locate-character';
import { SourceMapGenerator } from '@jridgewell/source-map';
import {
	get_dts,
	get_input_files,
	is_declaration,
	is_reference,
	resolve_dts,
	walk,
	write
} from './utils.js';

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

		/** @type {Map<string, string[]>} **/
		const all_exports = new Map();

		/** @type {Map<string, Map<string, import('./types').Mapping>>} */
		const all_mappings = new Map();

		/** @type {Set<string>} */
		const ambient_modules = new Set();

		let first = true;

		/**
		 * @param {string} file
		 * @param {string} specifier
		 * @returns {string | null}
		 */
		function resolve(file, specifier) {
			// if a module imports from another module we're declaring,
			// leave the import intact
			if (specifier in modules) {
				return null;
			}

			// resolve relative imports and aliases (from tsconfig.paths)
			return specifier.startsWith('.')
				? resolve_dts(path.dirname(file), specifier)
				: compilerOptions.paths && specifier in compilerOptions.paths
				? resolve_dts(cwd, compilerOptions.paths[specifier][0])
				: null;
		}

		for (const id in modules) {
			if (!first) types += '\n\n';
			first = false;

			types += `declare module '${id}' {`;

			/** @type {Map<string, import('./types').Mapping>} */
			const mappings = new Map();
			all_mappings.set(id, mappings);

			const included = new Set([modules[id]]);

			/** @type {Map<string, import('./types').Module>} */
			const bundle = new Map();

			/** @type {Map<string, Map<string, string>>} */
			const traced = new Map();

			// first pass — discovery
			for (const file of included) {
				const module = get_dts(file, created, resolve);

				module.dependencies.forEach((dep) => {
					included.add(dep);
				});

				module.ambient_imports.forEach((dep) => {
					if (!dep.external) {
						ambient_modules.add(dep.id);
					}
				});

				bundle.set(file, module);
				traced.set(file, new Map());
			}

			// TODO treeshaking

			const exports = new Set();

			/**
			 * @param {string} id
			 * @param {string} name
			 * @param {string} alias
			 */
			function assign_alias(id, name, alias) {
				const module = bundle.get(id);

				if (module) {
					if (module.exports.has(name)) {
						const local = /** @type {string} */ (module.exports.get(name));

						const declaration = module.declarations.get(local);
						if (declaration) {
							declaration.alias = alias;
							return true;
						}

						const binding = module.imports.get(local);
						if (binding) {
							assign_alias(binding.id, binding.name, alias);
							return true;
						}

						throw new Error('Something unexpected happened');
					}

					const binding = module.export_from.get(name);
					if (binding) {
						assign_alias(binding.id, binding.name, alias);
						return true;
					}

					for (const reference of module.export_all) {
						if (assign_alias(reference.id, name, alias)) {
							return true;
						}
					}
				} else {
					// this is an import from an external module
					throw new Error('TODO imports from external modules');
				}
			}

			/** @type {Set<import('./types').Module>} */
			const modules_to_export_all_from = new Set([
				/** @type {import('./types').Module} */ (bundle.get(modules[id]))
			]);

			for (const module of modules_to_export_all_from) {
				for (const exported of module.exports.keys()) {
					exports.add(exported);
				}

				for (const exported of module.export_from.keys()) {
					exports.add(exported);
				}

				for (const next of module.export_all) {
					const m = bundle.get(next.id);
					if (m) modules_to_export_all_from.add(m);
				}
			}

			/** @type {Set<string>} */
			const names = new Set();

			/** @param {string} name */
			function get_name(name) {
				let i = 1;
				while (names.has(name)) {
					name = `${name}_${i++}`;
				}

				names.add(name);
				return name;
			}

			// fix export names initially...
			for (const name of exports) {
				assign_alias(modules[id], name, get_name(name));
			}

			// ...then deconflict everything else
			for (const module of bundle.values()) {
				for (const declaration of module.declarations.values()) {
					if (!declaration.alias) {
						declaration.alias = get_name(declaration.name);
					}
				}
			}

			/**
			 * @param {string} id
			 * @param {string} name
			 * @returns {string} TODO or an external import
			 */
			function trace(id, name) {
				const cache = /** @type {Map<string, string>} */ (traced.get(id));

				if (cache.has(name)) {
					return /** @type {string} */ (cache.get(name));
				}

				const module = bundle.get(id);
				if (module) {
					const declaration = module.declarations.get(name);
					if (declaration) {
						cache.set(name, declaration.alias);
						return declaration.alias;
					}

					const binding = module.imports.get(name) ?? module.export_from.get(name);
					if (binding) {
						const alias = trace(binding.id, binding.name);
						cache.set(name, alias);
						return alias;
					}

					throw new Error('TODO');
				} else {
					throw new Error('TODO external imports');
				}
			}

			// second pass — editing
			for (const module of bundle.values()) {
				const index = module.dts.indexOf('//# sourceMappingURL=');
				if (index !== -1) module.result.remove(index, module.dts.length);

				ts.forEachChild(module.ast, (node) => {
					if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
						module.result.remove(node.pos, node.end);
						return;
					}

					if (is_declaration(node)) {
						const identifier = ts.isVariableStatement(node)
							? ts.getNameOfDeclaration(node.declarationList.declarations[0])
							: ts.getNameOfDeclaration(node);

						const name = identifier?.getText(module.ast);
						if (!name) {
							throw new Error('TODO');
						}

						const declaration = /** @type {import('./types').Declaration} */ (
							module.declarations.get(name)
						);

						if (declaration.alias !== declaration.name) {
							throw new Error('TODO rename declaration');
						}

						const export_modifier = node.modifiers?.find((node) => node.kind === 93);
						if (export_modifier) {
							// remove `default` keyword
							const default_modifier = node.modifiers?.find((node) => node.kind === 88);
							if (default_modifier) {
								let b = default_modifier.end;
								const a = b - 7;
								while (/\s/.test(module.dts[b])) b += 1;
								module.result.remove(a, b);
							}
							if (identifier && name) {
								const pos = identifier.getStart(module.ast);
								const loc = module.locator(pos);
								if (module.source) {
									// the sourcemaps generated by TypeScript are very inaccurate, borderline useless.
									// we need to fix them up here. TODO is it only inaccurate in the JSDoc case?
									const segments = module.source.mappings?.[loc.line - 1];
									// find the segments immediately before and after the generated column
									const index = segments.findIndex((segment) => segment[0] >= loc.column);
									const a = segments[index - 1] ?? segments[0];
									let l = /** @type {number} */ (a[2]);
									const source_line = module.source.code.split('\n')[l];
									const regex = new RegExp(`\\b${name}\\b`);
									const match = regex.exec(source_line);
									if (match) {
										const mapping = {
											source: path.resolve(path.dirname(module.file), module.source.map.sources[0]),
											line: l + 1,
											column: match.index
										};
										mappings.set(name, /** @type {import('./types').Mapping} */ (mapping));
									} else {
										// TODO figure out how to repair sourcemaps in this case
									}
								} else {
									const mapping = {
										source: module.file,
										line: loc.line,
										column: loc.column
									};
									mappings.set(name, /** @type {import('./types').Mapping} */ (mapping));
								}
							}

							if (!exports.has(name)) {
								// remove all export keywords in the initial pass; reinstate as necessary later
								// TODO only do this for things that aren't exported from the entry point
								let b = export_modifier.end;
								const a = b - 6;
								while (/\s/.test(module.dts[b])) b += 1;
								module.result.remove(a, b);
							}
						} else if (exports.has(name)) {
							throw new Error('TODO add export keyword');
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
							if (is_reference(node)) {
								const name = node.getText(module.ast);
								const alias = trace(module.file, name);

								if (alias !== name) {
									module.result.overwrite(node.getStart(module.ast), node.getEnd(), name);
								}
							}

							// `import('./foo').Foo` -> `Foo`
							if (
								ts.isImportTypeNode(node) &&
								ts.isLiteralTypeNode(node.argument) &&
								ts.isStringLiteral(node.argument.literal) &&
								node.argument.literal.text.startsWith('.')
							) {
								// follow import
								const resolved = resolve_dts(path.dirname(module.file), node.argument.literal.text);

								// included.add(resolved);
								// remove the `import(...)`
								if (node.qualifier) {
									const name = node.qualifier.getText(module.ast);
									const alias = trace(resolved, name);

									module.result.overwrite(node.getStart(module.ast), node.qualifier.end, name);
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

				const mod = module.result
					.trim()
					.indent()
					.toString()
					.replace(/^(    )+/gm, (match) => '\t'.repeat(match.length / 4));
				if (mod) types += '\n' + mod;
			}

			// /** @type {string[]} */
			// const exported = [];
			// all_exports.set(id, exported);

			// for (const id of modules_to_export_all_from) {
			// 	for (const name of /** @type {string[]} */ (module_exports.get(id))) {
			// 		exported.push(name);
			// 	}
			// }

			types += `\n}`;
		}

		for (const file of ambient_modules) {
			// TODO clean up ambient module then inject wholesale
			// const module = get_dts(file, created);
			// const index = module.dts.indexOf('//# sourceMappingURL=');
			// if (index !== -1) module.result.remove(index, module.dts.length);
			// ts.forEachChild(module.ast, (node) => {
			// 	if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
			// 		walk(node, (node) => {
			// 			// @ts-expect-error
			// 			if (node.jsDoc) {
			// 				// @ts-expect-error
			// 				for (const jsDoc of node.jsDoc) {
			// 					if (jsDoc.comment) {
			// 						// @ts-expect-error
			// 						jsDoc.tags?.forEach((tag) => {
			// 							module.result.remove(tag.pos, tag.end);
			// 						});
			// 					} else {
			// 						module.result.remove(jsDoc.pos, jsDoc.end);
			// 					}
			// 				}
			// 			}
			// 		});
			// 	}
			// });
			// types += module.result.trim().toString();
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

				const mappings = all_mappings.get(name);

				node.body.forEachChild((node) => {
					if (is_declaration(node)) {
						const identifier = ts.isVariableStatement(node)
							? ts.getNameOfDeclaration(node.declarationList.declarations[0])
							: ts.getNameOfDeclaration(node);

						if (identifier) {
							const name = identifier.getText(ast);

							const mapping = mappings?.get(name);

							if (mapping) {
								const start = identifier.getStart(ast);
								let { line, column } = locator(start);

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
