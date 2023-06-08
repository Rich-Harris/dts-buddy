import path from 'node:path';
import ts from 'typescript';
import MagicString from 'magic-string';
import { get_dts, is_declaration, is_reference, resolve_dts, walk } from './utils.js';

/**
 * @param {string} id
 * @param {string} entry
 * @param {Record<string, string>} created
 * @param {(file: string, specifier: string) => string | null} resolve
 * @returns {{
 *   content: string;
 *   mappings: Map<string, import('./types').Mapping>;
 *   ambient: string[];
 * }}
 */
export function create_module_declaration(id, entry, created, resolve) {
	let content = '';

	/** @type {Map<string, import('./types').Mapping>} */
	const mappings = new Map();

	/** @type {string[]} */
	const ambient = [];

	/** @type {Record<string, Record<string, import('./types').Declaration>>} */
	const external_imports = {};

	/** @type {Record<string, Record<string, import('./types').Declaration>>} */
	const external_import_alls = {};

	/** @type {Record<string, Record<string, import('./types').Declaration>>} */
	const external_export_from = {};

	/** @type {Set<string>} */
	const external_export_all_from = new Set();

	/** @type {Map<string, import('./types').Module>} */
	const bundle = new Map();

	/** @type {Map<string, Map<string, import('./types').Declaration>>} */
	const traced = new Map();

	/** @type {Set<string>} */
	const exports = new Set();

	// step 1 — discover which modules are included in the bundle
	{
		const included = new Set([entry]);

		/**
		 * @param {string} module
		 * @param {string} name
		 * @returns {import('./types').Declaration}
		 */
		const create_external_declaration = (module, name) => {
			return {
				module,
				name,
				alias: '',
				external: true,
				included: false,
				dependencies: []
			};
		};

		for (const file of included) {
			const module = get_dts(file, created, resolve);

			for (const dep of module.dependencies) {
				included.add(dep);
			}

			for (const dep of module.ambient_imports) {
				if (!dep.external) {
					ambient.push(dep.id);
				}
			}

			for (const binding of module.imports.values()) {
				if (binding.external) {
					(external_imports[binding.id] ??= {})[binding.name] = create_external_declaration(
						binding.id,
						binding.name
					);
				}
			}

			for (const binding of module.import_all.values()) {
				if (binding.external) {
					(external_import_alls[binding.id] ??= {})[binding.name] = create_external_declaration(
						binding.id,
						binding.name
					);
				}
			}

			for (const binding of module.export_from.values()) {
				if (binding.external) {
					(external_export_from[binding.id] ??= {})[binding.name] = create_external_declaration(
						binding.id,
						binding.name
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

		/** @type {Set<import('./types').Module>} */
		const modules_to_export_all_from = new Set([
			/** @type {import('./types').Module} */ (bundle.get(entry))
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
	}

	// step 2 - treeshaking
	{
		/**
		 * @param {string} id
		 * @param {string} name
		 */
		const reference = (id, name) => {
			const declaration = trace(id, name);
			if (!declaration.included) {
				declaration.included = true;

				for (const { module, name } of declaration.dependencies) {
					reference(module, name);
				}
			}
		};

		for (const name of exports) {
			const declaration = trace_export(entry, name);
			if (declaration) reference(declaration.module, declaration.name);
		}
	}

	// step 3 - deconflicting
	{
		/**
		 * @param {string} id
		 * @param {string} name
		 * @param {string} alias
		 */
		const assign_alias = (id, name, alias) => {
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
				const declaration =
					external_imports[id]?.[name] ??
					external_import_alls[id]?.[name] ??
					external_export_from[id]?.[name];

				declaration.alias = alias;
			}
		};

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
			assign_alias(entry, name, get_name(name));
		}

		// ...and imported bindings...
		for (const module in external_imports) {
			if (module === id) continue;

			for (const name in external_imports[module]) {
				external_imports[module][name].alias ||= get_name(name);
			}
		}

		for (const module in external_import_alls) {
			if (module === id) continue;

			for (const name in external_import_alls[module]) {
				external_import_alls[module][name].alias ||= get_name(name);
			}
		}

		for (const module in external_export_from) {
			if (module === id) continue;

			for (const name in external_export_from[module]) {
				external_export_from[module][name].alias ||= get_name(name);
			}
		}

		// ...then deconflict everything else
		for (const module of bundle.values()) {
			for (const declaration of module.declarations.values()) {
				declaration.alias ||= get_name(declaration.name);
			}
		}
	}

	// step 4 - generate code
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

			ts.forEachChild(module.ast, (node) => {
				if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
					result.remove(node.pos, node.end);
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

					if (!declaration.included) {
						result.remove(node.pos, node.end);
						return;
					}

					if (identifier && declaration.alias !== declaration.name) {
						result.overwrite(identifier.getStart(module.ast), identifier.end, declaration.alias);
					}

					const export_modifier = node.modifiers?.find((node) => node.kind === 93);
					if (export_modifier) {
						// remove `default` keyword
						const default_modifier = node.modifiers?.find((node) => node.kind === 88);
						if (default_modifier) {
							let b = default_modifier.end;
							const a = b - 7;
							while (/\s/.test(module.dts[b])) b += 1;
							result.remove(a, b);
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
								if (a) {
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
									// TODO how does this happen?
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

						if (!exports.has(declaration.alias)) {
							// remove all export keywords in the initial pass; reinstate as necessary later
							// TODO only do this for things that aren't exported from the entry point
							let b = export_modifier.end;
							const a = b - 6;
							while (/\s/.test(module.dts[b])) b += 1;
							result.remove(a, b);
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
						result.remove(a, b);
					}

					const params = new Set();
					if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
						if (node.typeParameters) {
							for (const param of node.typeParameters) {
								params.add(param.name.getText(module.ast));
							}
						}
					}

					walk(node, (node) => {
						if (is_reference(node)) {
							const name = node.getText(module.ast);
							if (params.has(name)) return;

							const declaration = trace(module.file, name);

							if (declaration.alias !== name) {
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

						// @ts-expect-error
						if (node.jsDoc) {
							// @ts-expect-error
							for (const jsDoc of node.jsDoc) {
								if (jsDoc.comment) {
									// @ts-expect-error
									jsDoc.tags?.forEach((tag) => {
										const kind = tag.tagName.escapedText;
										if (kind === 'example' || kind === 'default') return; // TODO others?
										result.remove(tag.pos, tag.end);
									});
								} else {
									result.remove(jsDoc.pos, jsDoc.end);
								}
							}
						}
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

		/** @type {string[]} */
		const specifiers = [];

		for (const name of exports) {
			const declaration = trace_export(entry, name);
			if (declaration?.external) {
				const specifier =
					declaration.alias === declaration.name
						? declaration.name
						: `${declaration.name} as ${declaration.alias}`;

				specifiers.push(specifier);
			}
		}

		if (specifiers.length > 0) {
			content += `\n\texport { ${specifiers.join(', ')} };`;
		}

		content += `\n}`;
	}

	/**
	 * @param {string} module_id
	 * @param {string} name
	 * @returns {import('./types').Declaration | null}
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
	 * @returns {import('./types').Declaration}
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
			return /** @type {import('./types').Declaration} */ (cache.get(name));
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
				name,
				alias: name,
				dependencies: []
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
