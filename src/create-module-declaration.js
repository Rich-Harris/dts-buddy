/** @import { Binding, Declaration, Mapping, Module, ModuleReference } from './types' */
import path from 'node:path';
import ts from 'typescript';
import * as tsu from 'ts-api-utils';
import MagicString from 'magic-string';
import {
	clean_jsdoc,
	get_dts,
	is_declaration,
	is_internal,
	is_reference,
	resolve_dts,
	walk
} from './utils.js';

/**
 * @param {string} id
 * @param {string} entry
 * @param {Record<string, string>} created
 * @param {(file: string, specifier: string) => string | null} resolve
 * @param {{ stripInternal?: boolean }} options
 * @returns {{
 *   content: string;
 *   mappings: Map<string, Mapping>;
 *   ambient: ModuleReference[];
 * }}
 */
export function create_module_declaration(id, entry, created, resolve, options) {
	let content = '';

	/** @type {Map<string, Mapping>} */
	const mappings = new Map();

	/** @type {ModuleReference[]} */
	const ambient = [];

	/** @type {Record<string, Record<string, Declaration>>} */
	const external_imports = {};

	/** @type {Record<string, Record<string, Declaration>>} */
	const external_import_alls = {};

	/** @type {Record<string, Record<string, Declaration>>} */
	const external_export_from = {};

	/** @type {Set<string>} */
	const external_export_all_from = new Set();

	/** @type {Map<string, Module>} */
	const bundle = new Map();

	/** @type {Map<string, Map<string, Declaration>>} */
	const traced = new Map();

	/** @type {Set<string>} */
	const exports = new Set();

	/** @type {Set<string>} */
	const globals = new Set();

	/** @type {string[]} */
	const export_specifiers = [];

	// step 1 — discover which modules are included in the bundle
	{
		const included = new Set([entry]);

		for (const file of included) {
			const module = get_dts(file, created, resolve, options);

			for (const name of module.globals) {
				globals.add(name);
			}

			for (const dep of module.dependencies) {
				included.add(dep);
			}

			for (const dep of module.ambient_imports) {
				ambient.push(dep);
			}

			for (const [name, binding] of module.imports) {
				if (binding.external) {
					(external_imports[binding.id] ??= {})[binding.name] ??= create_external_declaration(
						binding,
						name
					);
				}
			}

			for (const [name, binding] of module.import_all) {
				if (binding.external) {
					(external_import_alls[binding.id] ??= {})[binding.name] ??= create_external_declaration(
						binding,
						name
					);
				}
			}

			for (const [name, binding] of module.export_from) {
				if (binding.external) {
					(external_export_from[binding.id] ??= {})[binding.name] ??= create_external_declaration(
						binding,
						name
					);
				}
			}

			for (const binding of module.export_all.values()) {
				if (binding.external) {
					external_export_all_from.add(binding.id);
				}
			}

			bundle.set(file, module);
			traced.set(file, new Map());
		}

		/** @type {Set<Module>} */
		const modules_to_export_all_from = new Set([/** @type {Module} */ (bundle.get(entry))]);

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
	}

	// step 2 - treeshaking
	{
		/** @type {Set<string>} */
		const names = new Set(globals);

		/** @type {Set<Declaration>} */
		const declarations = new Set();

		/** @param {string} name */
		function get_name(name) {
			let i = 1;
			while (names.has(name)) {
				name = `${name}_${i++}`;
			}

			names.add(name);
			return name;
		}

		/**
		 * @param {Declaration} declaration
		 */
		const mark = (declaration) => {
			if (declaration.included) return;

			declarations.add(declaration);
			declaration.included = true;

			for (const { module, name } of declaration.dependencies) {
				const dependency = trace(module, name);
				mark(dependency);
			}
		};

		for (const name of exports) {
			const declaration = trace_export(entry, name);
			if (declaration) {
				declaration.alias = get_name(globals.has(name) ? declaration.name : name);
				mark(declaration);

				if (declaration.alias !== name) {
					export_specifiers.push(`${declaration.alias} as ${name}`);
				} else {
					declaration.exported = true;
				}
			} else {
				throw new Error('Something strange happened');
			}
		}

		// provide a name for declarations that are included but not exported
		for (const declaration of declarations) {
			if (!declaration.alias) {
				declaration.alias = get_name(declaration.preferred_alias || declaration.name);
			}
		}
	}

	// step 3 - generate code
	{
		content += `declare module '${id}' {`;

		// inject imports from external modules
		for (const id in external_imports) {
			const specifiers = [];

			for (const name in external_imports[id]) {
				const declaration = external_imports[id][name];
				if (declaration.included) {
					specifiers.push(name === declaration.alias ? name : `${name} as ${declaration.alias}`);
				}
			}

			if (specifiers.length > 0) {
				content += `\n\timport type { ${specifiers.join(', ')} } from '${id}';`;
			}
		}

		for (const id in external_import_alls) {
			for (const name in external_import_alls[id]) {
				content += `\n\timport * as ${name} from '${id}';`; // TODO could this have been aliased?
			}
		}

		for (const id in external_export_from) {
			const specifiers = Object.keys(external_export_from[id]).map((name) => {
				// this is a bit of a hack, but it makes life easier
				exports.delete(name);

				const declaration = external_export_from[id][name];
				return name === declaration.alias ? name : `${name} as ${declaration.alias}`;
			});

			content += `\n\texport { ${specifiers.join(', ')} } from '${id}';`;
		}

		// second pass — editing
		for (const module of bundle.values()) {
			const result = new MagicString(module.dts);

			const index = module.dts.indexOf('//# sourceMappingURL=');
			if (index !== -1) result.remove(index, module.dts.length);

			if (module.import_all.size > 0) {
				// remove the leading `Foo.` from references to `import * as Foo` namespace imports
				walk(module.ast, (node) => {
					if (is_reference(node) && ts.isQualifiedName(node.parent)) {
						const binding = module.import_all.get(node.getText(module.ast));
						if (binding) {
							result.remove(node.pos, result.original.indexOf('.', node.end) + 1);
							const declaration = bundle
								.get(binding.id)
								?.declarations.get(node.parent.right.getText(module.ast));
							if (declaration?.alias) {
								result.overwrite(node.parent.right.pos, node.parent.right.end, declaration.alias);
							}
						}
					}
				});
			}

			ts.forEachChild(module.ast, (node) => {
				if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
					result.remove(node.pos, node.end);
					return;
				}

				// remove `declare module 'foo'`
				if (
					ts.isModuleDeclaration(node) &&
					!tsu.isNamespaceDeclaration(node) &&
					node.modifiers?.some((modifier) => tsu.isDeclareKeyword(modifier))
				) {
					result.remove(node.pos, node.end);
					return;
				}

				if (is_declaration(node)) {
					if (is_internal(node) && options.stripInternal) {
						result.remove(node.pos, node.end);
					}

					const identifier = ts.isVariableStatement(node)
						? ts.getNameOfDeclaration(node.declarationList.declarations[0])
						: ts.getNameOfDeclaration(node);

					const name = identifier?.getText(module.ast);
					if (!name) {
						throw new Error('TODO');
					}

					const declaration = /** @type {Declaration} */ (module.declarations.get(name));

					if (!declaration.included) {
						result.remove(node.pos, node.end);
						return;
					}

					if (declaration.alias !== 'default') {
						const export_modifier = node.modifiers?.find((node) => tsu.isExportKeyword(node));

						if (export_modifier) {
							// remove `default` keyword
							const default_modifier = node.modifiers?.find((node) => tsu.isDefaultKeyword(node));

							if (default_modifier) {
								let b = default_modifier.end;
								const a = b - 7;
								while (/\s/.test(module.dts[b])) b += 1;
								result.remove(a, b);
							}

							if (identifier && name) {
								const pos = identifier.getStart(module.ast);
								const loc = module.locator(pos);

								if (loc) {
									// the sourcemaps generated by TypeScript are very inaccurate, borderline useless.
									// we need to fix them up here. TODO is it only inaccurate in the JSDoc case?
									const segments = module.source?.mappings?.[loc.line - 1];

									if (module.source && segments) {
										// find the segments immediately before and after the generated column
										const index = segments.findIndex((segment) => segment[0] >= loc.column);

										const a = segments[index - 1] ?? segments[0];
										if (a) {
											let l = /** @type {number} */ (a[2]);

											const source_line = module.source.code.split('\n')[l];
											const regex = new RegExp(`\\b${name}\\b`);
											const match = regex.exec(source_line);

											if (match) {
												const mapping = {
													source: path.resolve(
														path.dirname(module.file),
														module.source.map.sources[0]
													),
													line: l + 1,
													column: match.index
												};
												mappings.set(name, /** @type {Mapping} */ (mapping));
											} else {
												// TODO figure out how to repair sourcemaps in this case
											}
										} else {
											// TODO how does this happen?
										}
									} else {
										const mapping = {
											source: module.file,
											line: loc.line,
											column: loc.column
										};
										mappings.set(name, /** @type {Mapping} */ (mapping));
									}
								}
							}

							if (!exports.has(declaration.alias)) {
								// remove all export keywords in the initial pass; reinstate as necessary later
								let b = export_modifier.end;
								const a = b - 6;
								while (/\s/.test(module.dts[b])) b += 1;
								result.remove(a, b);
							}
						} else if (declaration.exported) {
							export_specifiers.push(declaration.alias);
						}
					}

					const declare_modifier = node.modifiers?.find((node) => tsu.isDeclareKeyword(node));
					if (declare_modifier) {
						// i'm not sure why typescript turns `export function` in a .ts file to `export declare function`,
						// but it's weird and we don't want it
						let b = declare_modifier.end;
						const a = b - 7;
						while (/\s/.test(module.dts[b])) b += 1;
						result.remove(a, b);
					}

					walk(node, (node) => {
						if (ts.isPropertySignature(node) && is_internal(node) && options.stripInternal) {
							result.remove(node.pos, node.end);
							return false;
						}

						// We need to include the declarations because if references to them have changed, we need to update the declarations, too
						if (is_reference(node, true)) {
							const name = node.getText(module.ast);

							const declaration = trace(module.file, name);

							if (
								declaration.alias !== name &&
								declaration.alias &&
								declaration.alias !== 'default'
							) {
								result.overwrite(node.getStart(module.ast), node.getEnd(), declaration.alias);
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
								const declaration = trace(resolved, name);

								result.overwrite(node.getStart(module.ast), node.qualifier.end, declaration.alias);
							} else {
								throw new Error('TODO');
							}
						}

						clean_jsdoc(node, result);
					});
				}
			});

			const mod = result
				.trim()
				.indent()
				.toString()
				.replace(/^(    )+/gm, (match) => '\t'.repeat(match.length / 4));

			if (mod) content += '\n' + mod;
		}

		// finally, export any bindings that are exported from external modules

		for (const name of exports) {
			const declaration = trace_export(entry, name);
			if (declaration?.external) {
				export_specifiers.push(declaration.alias);
			}
		}

		// Always add an export { .. } statement, even if there are no exports. This ensures
		// that only the public types are exposed to consumers of the declaration file. Due to some
		// old TypeScript inconsistency, omitting the export statement would expose all types.
		if (export_specifiers.length > 0) {
			content += `\n\n\texport { ${export_specifiers.join(', ')} };`;
		} else {
			content += '\n\n\texport {};';
		}

		content += `\n}`;
	}

	/**
	 * @param {string} module_id
	 * @param {string} name
	 * @returns {Declaration | null}
	 */
	function trace_export(module_id, name) {
		if (module_id === id) {
			return trace_export(entry, name);
		}

		const module = bundle.get(module_id);
		if (module) {
			const local = module.exports.get(name);
			if (local) {
				return trace(module_id, local);
			}

			const binding = module.export_from.get(name);
			if (binding) {
				return trace_export(binding.id, binding.name);
			}

			for (const reference of module.export_all) {
				const declaration = trace_export(reference.id, name);
				if (declaration) return declaration;
			}
		} else {
			const declaration =
				external_imports[module_id]?.[name] ??
				external_import_alls[module_id]?.[name] ??
				external_export_from[module_id]?.[name];

			if (declaration) return declaration;
		}

		return null;
	}

	/**
	 * @param {string} id
	 * @param {string} name
	 * @returns {Declaration}
	 */
	function trace(id, name) {
		const cache = traced.get(id);

		if (!cache) {
			// this means we're dealing with an external module
			return (
				external_imports[id]?.[name] ??
				external_import_alls[id]?.[name] ??
				external_export_from[id]?.[name]
			);
		}

		if (cache.has(name)) {
			return /** @type {Declaration} */ (cache.get(name));
		}

		const module = bundle.get(id);
		if (module) {
			const declaration = module.declarations.get(name);
			if (declaration) {
				cache.set(name, declaration);
				return declaration;
			}

			const binding = module.imports.get(name) ?? module.export_from.get(name);
			if (binding) {
				const declaration = trace_export(binding.id, binding.name);
				if (declaration) return declaration;
			}

			for (const reference of module.export_all) {
				const declaration = trace_export(reference.id, name);
				if (declaration) {
					cache.set(name, declaration);
					return declaration;
				}
			}

			// otherwise it's presumably a built-in
			return {
				module: '<builtin>',
				external: false,
				included: true,
				exported: false,
				name,
				alias: name,
				dependencies: [],
				preferred_alias: ''
			};
		} else {
			throw new Error('TODO external imports');
		}
	}

	return {
		content,
		mappings,
		ambient
	};
}

/**
 * @param {Binding} binding
 * @param {string} alias
 * @returns {Declaration}
 */
function create_external_declaration(binding, alias) {
	return {
		module: binding.id,
		name: binding.name,
		alias: '',
		exported: false,
		external: true,
		included: false,
		dependencies: [],
		preferred_alias: alias
	};
}
