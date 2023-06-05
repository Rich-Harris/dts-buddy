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
	/** @type {Map<string, import('./types').Mapping>} */
	const mappings = new Map();

	/** @type {string[]} */
	const ambient = [];

	/** @type {Record<string, Record<string, string>>} */
	const imports = {};

	/** @type {Record<string, Record<string, string>>} */
	const import_alls = {};

	/** @type {Map<string, import('./types').Module>} */
	const bundle = new Map();

	/** @type {Map<string, Map<string, string>>} */
	const traced = new Map();

	// first pass — discover which modules are included in the bundle
	{
		const included = new Set([entry]);

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
				(imports[binding.id] ??= {})[binding.name] = '';
			}

			for (const binding of module.import_all.values()) {
				(import_alls[binding.id] ??= {})[binding.name] = '';
			}

			bundle.set(file, module);
			traced.set(file, new Map());
		}
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
	for (const id in imports) {
		for (const name in imports[id]) {
			imports[id][name] = get_name(name);
		}
	}

	for (const id in import_alls) {
		for (const name in import_alls[id]) {
			import_alls[id][name] = get_name(name);
		}
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
		const cache = traced.get(id);

		if (!cache) {
			// this means we're dealing with an external module
			return imports[id][name] ?? import_alls[id][name];
		}

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

			throw new Error(`Could not trace ${name} binding from ${id}`);
		} else {
			throw new Error('TODO external imports');
		}
	}

	let content = `declare module '${id}' {`;

	// inject imports from external modules
	for (const id in imports) {
		const specifiers = Object.keys(imports[id]).map((name) => {
			const alias = imports[id][name];
			return name === alias ? name : `${name} as ${alias}`;
		});

		for (const name in imports[id]) {
			content += `\n\timport type { ${specifiers.join(', ')} } from '${id}';`;
		}
	}

	for (const id in import_alls) {
		for (const name in import_alls[id]) {
			content += `\n\timport * as ${name} from '${id}';`; // TODO could this have been aliased?
		}
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
							params.add(param.getText(module.ast));
						}
					}
				}

				walk(node, (node) => {
					if (is_reference(node)) {
						const name = node.getText(module.ast);
						if (params.has(name)) return;

						const alias = trace(module.file, name);

						if (alias !== name) {
							result.overwrite(node.getStart(module.ast), node.getEnd(), name);
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

							result.overwrite(node.getStart(module.ast), node.qualifier.end, name);
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

	content += `\n}`;

	return {
		content,
		mappings,
		ambient
	};
}
