import fs from 'node:fs';
import path from 'node:path';
import glob from 'tiny-glob/sync.js';
import globrex from 'globrex';
import ts from 'typescript';
import MagicString from 'magic-string';
import { getLocator } from 'locate-character';
import { decode } from '@jridgewell/sourcemap-codec';

/**
 * @param {string} cwd
 * @param {string[]} [include]
 * @param {string[]} [exclude]
 * @returns {string[]}
 */
export function get_input_files(cwd, include = [], exclude = []) {
	/** @type {Set<string>} */
	const included = new Set();

	for (const pattern of include) {
		for (const file of glob(pattern, { cwd })) {
			const resolved = path.resolve(cwd, file);
			if (fs.statSync(resolved).isDirectory()) {
				for (const file of glob('**/*.{js,jsx,ts,tsx}', { cwd: resolved })) {
					included.add(path.resolve(resolved, file));
				}
			} else {
				included.add(resolved);
			}
		}
	}

	let input = Array.from(included);

	for (const pattern of exclude) {
		const { regex } = globrex(pattern, { globstar: true });
		input = input.filter((file) => !regex.test(file));
	}

	return input.map((file) => path.resolve(file));
}

/**
 * @param {string} file
 * @param {string} contents
 */
export function write(file, contents) {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
	} catch {}
	fs.writeFileSync(file, contents);
}

/**
 * @param {string} file
 * @param {Record<string, string>} created
 * @param {(file: string, specifier: string) => string | null} resolve
 */
export function get_dts(file, created, resolve) {
	const dts = created[file] ?? fs.readFileSync(file, 'utf8');
	const ast = ts.createSourceFile(file, dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const locator = getLocator(dts, { offsetLine: 1 });

	/** @type {import('./types').Module} */
	const module = {
		file,
		dts,
		ast,
		locator,
		source: null,
		dependencies: [],
		declarations: new Map(),
		imports: new Map(),
		exports: new Map(),
		export_from: new Map(),
		import_all: new Map(),
		export_all: [],
		ambient_imports: []
	};

	if (file in created) {
		const map = JSON.parse(created[file + '.map']);

		const source_file = path.resolve(path.dirname(file), map.sources[0]);
		const code = fs.readFileSync(source_file, 'utf8');

		module.source = {
			code,
			map,
			mappings: decode(map.mappings)
		};
	}

	ts.forEachChild(ast, (node) => {
		// follow imports
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
				const { text } = node.moduleSpecifier;
				const resolved = resolve(file, text);
				const external = !resolved;
				const id = resolved ?? text;

				// if a local module, and _not_ an ambient import, add it to dependencies
				if (!external && !(ts.isImportDeclaration(node) && !node.importClause)) {
					module.dependencies.push(id);
				}

				if (ts.isImportDeclaration(node)) {
					if (node.importClause) {
						// `import foo`
						if (node.importClause.name) {
							const name = node.importClause.name.getText(module.ast);
							module.imports.set(name, {
								id,
								name: 'default',
								external,
								referenced: false
							});
						} else if (node.importClause.namedBindings) {
							// `import * as foo`
							if (ts.isNamespaceImport(node.importClause.namedBindings)) {
								const name = node.importClause.namedBindings.name.getText(module.ast);
								module.import_all.set(name, {
									id,
									name,
									external,
									referenced: false
								});
							}

							// `import { foo }`, `import { foo as bar }`
							else {
								node.importClause.namedBindings.elements.forEach((specifier) => {
									const local = specifier.name.getText(module.ast);

									module.imports.set(local, {
										id,
										name: specifier.propertyName?.getText(module.ast) ?? local,
										external,
										referenced: false
									});
								});
							}
						}
					} else {
						// assume this is an ambient module
						module.ambient_imports.push({ id, external });
					}
				}

				if (ts.isExportDeclaration(node)) {
					if (node.exportClause && ts.isNamedExports(node.exportClause)) {
						// `export { foo as bar } from '...'`
						if (ts.isNamedExports(node.exportClause)) {
							node.exportClause.elements.forEach((specifier) => {
								const name = specifier.name.getText(module.ast);
								const local = specifier.propertyName
									? specifier.propertyName.getText(module.ast)
									: name;

								module.export_from.set(name, {
									id,
									name: local,
									external,
									referenced: false
								});
							});
						}
					} else {
						// `export * as foo from '...'`
						if (node.exportClause) {
							// in this case, we need to generate an `export namespace` declaration
							const name = node.exportClause?.name?.getText(module.ast) ?? null;
							throw new Error(`TODO export * as ${name}`);
						}

						// `export * from '...'`
						module.export_all.push({ id, external });
					}
				}
			} else if (ts.isExportDeclaration(node)) {
				if (node.exportClause && ts.isNamedExports(node.exportClause)) {
					// `export { foo as bar }`
					if (ts.isNamedExports(node.exportClause)) {
						node.exportClause.elements.forEach((specifier) => {
							const name = specifier.name.getText(module.ast);
							const local = specifier.propertyName
								? specifier.propertyName.getText(module.ast)
								: name;

							module.exports.set(name, local);
						});
					}
				}
			}

			return;
		}

		if (is_declaration(node)) {
			const identifier = ts.isVariableStatement(node)
				? ts.getNameOfDeclaration(node.declarationList.declarations[0])
				: ts.getNameOfDeclaration(node);

			if (!identifier) {
				throw new Error('TODO'); // unnamed default export?
			}

			const name = identifier.getText(module.ast);

			/** @type {import('./types').Declaration} */
			const declaration = {
				node,
				name,
				references: new Set(),
				is_referenced: false,
				alias: ''
			};

			module.declarations.set(name, declaration);

			const export_modifier = node.modifiers?.find((node) => node.kind === 93);

			if (export_modifier) {
				const default_modifier = node.modifiers?.find((node) => node.kind === 88);
				module.exports.set(default_modifier ? 'default' : name, name);
			}

			walk(node, (node) => {
				// `import('./foo').Foo` -> `Foo`
				if (
					ts.isImportTypeNode(node) &&
					ts.isLiteralTypeNode(node.argument) &&
					ts.isStringLiteral(node.argument.literal)
				) {
					// follow import
					const resolved = resolve(file, node.argument.literal.text);
					if (resolved) module.dependencies.push(resolved);
				}

				// TODO track which things are referenced inside this declaration,
				// so that we can treeshake unused stuff
			});

			return;
		}

		// EOF
		if (node.kind === 1) return;

		throw new Error(`Unimplemented node type ${node.kind}`);
	});

	return module;
}

/**
 * @param {string} from
 * @param {string} to
 */
export function resolve_dts(from, to) {
	const file = path.resolve(from, to);
	if (file.endsWith('.d.ts')) return file;
	if (file.endsWith('.ts')) return file.replace(/\.ts$/, '.d.ts');
	if (file.endsWith('.js')) return file.replace(/\.js$/, '.d.ts');
	return file + '.d.ts';
}

/**
 * @param {import('typescript').Node} node
 * @param {(node: import('typescript').Node) => void} callback
 */
export function walk(node, callback) {
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
export function is_declaration(node) {
	return (
		ts.isInterfaceDeclaration(node) ||
		ts.isTypeAliasDeclaration(node) ||
		ts.isClassDeclaration(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isVariableStatement(node)
	);
}

/**
 * @param {import('typescript').Node} node
 * @returns {node is import('typescript').Identifier}
 */
export function is_reference(node) {
	if (!ts.isIdentifier(node)) return false;

	if (node.parent) {
		if (ts.isPropertyAccessExpression(node.parent)) return node === node.parent.expression;
		if (ts.isPropertyDeclaration(node.parent)) return node === node.parent.initializer;
		if (ts.isPropertyAssignment(node.parent)) return node === node.parent.initializer;

		if (ts.isImportTypeNode(node.parent)) return false;
		if (ts.isPropertySignature(node.parent)) return false;
		if (ts.isParameter(node.parent)) return false;
		if (ts.isMethodDeclaration(node.parent)) return false;
		if (ts.isLabeledStatement(node.parent) || ts.isBreakOrContinueStatement(node.parent))
			return false;
	}

	return true;
}
