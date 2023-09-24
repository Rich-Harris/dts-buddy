import fs from 'node:fs';
import path from 'node:path';
import glob from 'tiny-glob/sync.js';
import globrex from 'globrex';
import ts from 'typescript';
import * as tsu from 'ts-api-utils';
import { getLocator } from 'locate-character';
import { decode } from '@jridgewell/sourcemap-codec';

const preserved_jsdoc_tags = new Set(['default', 'deprecated', 'example']);

/** @param {ts.Node} node */
function get_jsdoc(node) {
	const { jsDoc } = /** @type {{ jsDoc?: ts.JSDoc[] }} */ (/** @type {*} */ (node));
	return jsDoc;
}

/**
 * @param {ts.Node} node
 * @param {import('magic-string').default} code
 */
export function clean_jsdoc(node, code) {
	const jsdoc = get_jsdoc(node);

	if (jsdoc) {
		for (const jsDoc of jsdoc) {
			let should_keep = !!jsDoc.comment;

			jsDoc.tags?.forEach((tag) => {
				const type = /** @type {string} */ (tag.tagName.escapedText);

				// @ts-ignore
				const name = /** @type {ts.Identifier | undefined} */ (tag.name);
				if (name) {
					// @ts-ignore
					if (tag.isBracketed) {
						// in JSDoc, we might have an optional [foo] parameter. in a .d.ts context,
						// the brackets cause the parameter to be interpreted as a comment,
						// so we have to remove them
						let a = name.pos - 1;
						let b = name.end;

						while (code.original[a] === ' ') a -= 1;
						while (code.original[b] === ' ') b += 1;

						code.remove(a, name.pos);
						code.remove(name.end, b + 1);
					}
				}

				if (tag.comment) {
					should_keep = true;

					const typeExpression = /** @type {ts.JSDocTypeExpression | undefined} */ (
						// @ts-ignore
						tag.typeExpression
					);

					if (typeExpression) {
						// turn `@param {string} foo description` into `@param foo description`
						let a = typeExpression.pos;
						let b = typeExpression.end;

						while (code.original[b] === ' ') b += 1;
						code.remove(a, b);
					}
				} else if (preserved_jsdoc_tags.has(type)) {
					should_keep = true;
				} else {
					code.remove(tag.pos, tag.end);
				}
			});

			if (!should_keep) {
				code.remove(jsDoc.pos, jsDoc.end);
			}
		}
	}
}

/**
 * @param {string} cwd
 * @param {string[]} include
 * @param {string[]} exclude
 * @returns {string[]}
 */
export function get_input_files(cwd, include, exclude) {
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

	/** @param {ts.Node} node */
	function scan(node) {
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
								external,
								name: 'default'
							});
						} else if (node.importClause.namedBindings) {
							// `import * as foo`
							if (ts.isNamespaceImport(node.importClause.namedBindings)) {
								const name = node.importClause.namedBindings.name.getText(module.ast);
								module.import_all.set(name, {
									id,
									external,
									name
								});
							}

							// `import { foo }`, `import { foo as bar }`
							else {
								node.importClause.namedBindings.elements.forEach((specifier) => {
									const local = specifier.name.getText(module.ast);

									module.imports.set(local, {
										id,
										external,
										name: specifier.propertyName?.getText(module.ast) ?? local
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
									external,
									name: local
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
				module: file,
				name,
				alias: '',
				included: false,
				external: false,
				dependencies: [],
				preferred_alias: ''
			};

			module.declarations.set(name, declaration);

			const export_modifier = node.modifiers?.find((node) => tsu.isExportKeyword(node));

			if (export_modifier) {
				const default_modifier = node.modifiers?.find((node) => tsu.isDefaultKeyword(node));
				module.exports.set(default_modifier ? 'default' : name, name);
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
				// `import('./foo').Foo` -> `Foo`
				if (
					ts.isImportTypeNode(node) &&
					ts.isLiteralTypeNode(node.argument) &&
					ts.isStringLiteral(node.argument.literal)
				) {
					// follow import
					const resolved = resolve(file, node.argument.literal.text);
					if (resolved) {
						module.dependencies.push(resolved);

						if (node.qualifier) {
							declaration.dependencies.push({
								module: resolved ?? node.argument.literal.text,
								name: node.qualifier.getText(module.ast)
							});
						}
					}
				}

				if (is_reference(node)) {
					const name = node.getText(module.ast);
					if (params.has(name)) return;

					if (name !== declaration.name) {
						declaration.dependencies.push({
							module: file,
							name
						});
					}
				}
			});

			return;
		}

		if (ts.isExportAssignment(node)) {
			const name = node.expression.getText(module.ast);
			module.exports.set('default', name);
			return;
		}

		if (ts.isModuleDeclaration(node)) {
			return;
		}

		if (tsu.isEndOfFileToken(node)) return;

		if (ts.isEnumDeclaration(node)) return;

		throw new Error(`Unimplemented node type ${ts.SyntaxKind[node.kind]}`);
	}

	ast.statements.forEach(scan);

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
 * @param {ts.Node} node
 * @param {(node: ts.Node) => void} callback
 */
export function walk(node, callback) {
	callback(node);
	ts.forEachChild(node, (child) => walk(child, callback));
}

/**
 * @param {ts.Node} node
 * @returns {node is
 *   ts.InterfaceDeclaration |
 *   ts.TypeAliasDeclaration |
 *   ts.ClassDeclaration |
 *   ts.FunctionDeclaration |
 *   ts.VariableStatement |
 *   ts.EnumDeclaration |
 *   ts.ModuleDeclaration
 * }
 */
export function is_declaration(node) {
	return (
		ts.isInterfaceDeclaration(node) ||
		ts.isTypeAliasDeclaration(node) ||
		ts.isClassDeclaration(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isVariableStatement(node) ||
		ts.isEnumDeclaration(node) ||
		!!(ts.isModuleDeclaration(node) && node.flags & 16)
	);
}

/**
 * @param {ts.Node} node
 * @returns {node is ts.Identifier}
 */
export function is_reference(node) {
	if (!ts.isIdentifier(node)) return false;

	if (node.parent) {
		if (is_declaration(node.parent)) {
			if (ts.isVariableStatement(node.parent)) {
				return node === node.parent.declarationList.declarations[0].name;
			}

			return node === node.parent.name;
		}

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

/**
 * parse tsconfig.json with typescript api
 * @param {string} tsconfig_file
 * @returns {{
 *   include: string[]|undefined,
 *   exclude: string[]|undefined,
 *   compilerOptions: ts.CompilerOptions
 * }}
 * @throws {Error} if ts api returns error diagnostics
 */
export function parse_tsconfig(tsconfig_file) {
	const { config, error: read_diagnostic } = ts.readConfigFile(tsconfig_file, ts.sys.readFile);
	if (read_diagnostic != null) {
		report_ts_errors(tsconfig_file, 'readConfigFile', [read_diagnostic]);
	}
	const {
		raw,
		options,
		errors: parse_diagnostics
	} = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(tsconfig_file));
	report_ts_errors(tsconfig_file, 'parseJsonConfigFileContent', parse_diagnostics);
	// only returns what's needed later on
	return {
		include: raw.include,
		exclude: raw.exclude,
		compilerOptions: options
	};
}

/**
 * log and throw error diagnostics
 * @param {string} tsconfig_file
 * @param {string} phase
 * @param {ts.Diagnostic[]} diagnostics
 */
function report_ts_errors(tsconfig_file, phase, diagnostics) {
	const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
	if (errors.length > 0) {
		const msg = `parsing ${tsconfig_file} failed during ${phase}`;
		console.error(
			`${msg}\n`,
			ts.formatDiagnostics(diagnostics, {
				getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
				getCanonicalFileName: (f) => f,
				getNewLine: () => '\n'
			})
		);
		throw new Error(msg);
	}
}
