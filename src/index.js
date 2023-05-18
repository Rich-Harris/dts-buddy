import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import glob from 'tiny-glob/sync.js';
import globrex from 'globrex';
import { SourceMapConsumer, SourceMapGenerator } from '@jridgewell/source-map';
import { get_input_files } from './utils.js';

/**
 * @param {{
 *   project: string;
 *   output: string;
 *   ambient: string;
 *   modules: Record<string, string>
 * }} options
 * @returns {Promise<void>}
 */
export async function createModuleDeclarations(options) {
	const { project = 'tsconfig.json', output, modules } = options;

	const cwd = path.dirname(project);
	const tsconfig = JSON.parse(fs.readFileSync(project, 'utf8'));

	const input = get_input_files(cwd, tsconfig.include, tsconfig.exclude);

	/** @type {ts.CompilerOptions} */
	const compilerOptions = {
		...tsconfig.compilerOptions,
		allowJs: true,
		declaration: true,
		declarationDir: undefined,
		declarationMap: true,
		emitDeclarationOnly: true,
		moduleResolution: undefined
	};

	const created = {};
	const host = ts.createCompilerHost(compilerOptions);
	host.writeFile = (fileName, contents) => (created[fileName] = contents);

	const program = ts.createProgram(input, compilerOptions, host);
	program.emit();

	// TODO generate ambient declarations alongside types
	const types = {
		code: '',
		smg: new SourceMapGenerator({ file: path.basename(output) })
	};

	const cache = new Map();

	/**
	 * @param {string} file
	 */
	function get_dts(file) {
		const authored = file.endsWith('.d.ts');
		const dts_file = authored ? file : file.replace(/\.[jt]s$/, '.d.ts');
		const map_file = authored ? null : dts_file + '.map';

		if (!cache.has(dts_file)) {
			const source = authored
				? fs.readFileSync(dts_file, 'utf8')
				: created[dts_file];
			const map = map_file && created[map_file];

			const ast = ts.createSourceFile(
				dts_file,
				source,
				ts.ScriptTarget.Latest,
				false,
				ts.ScriptKind.TS
			);

			const module = {
				authored,
				source,
				ast,
				smc: map && new SourceMapConsumer(JSON.parse(map), map_file)
			};

			cache.set(dts_file, module);
		}

		return cache.get(dts_file);
	}

	for (const file in created) {
		console.log(`\u001B[1m\u001B[35m${file}\u001B[39m\u001B[22m`);
		console.log(created[file]);
		console.log('\n');
	}

	for (const id in modules) {
		types.code += `declare module '${id}' {\n`;

		const included = new Set([modules[id]]);
		const modules_to_export_from = new Set([modules[id]]);

		const exports = new Map();

		for (const file of included) {
			const module = get_dts(path.resolve(file));
			exports.set(file, []);

			ts.forEachChild(module.ast, (node) => {
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

					exports.get(file).push(name.getText(module.ast));
				}

				// if (
				// 	ts.isInterfaceDeclaration(node) ||
				// 	ts.isTypeAliasDeclaration(node)
				// ) {
				// 	console.log('isInterfaceDeclaration');
				// }

				// const modifiers = ts.getModifiers(node);

				// console.log(modifiers);

				// console.log(module.source.slice(node.pos, node.end));
			});

			console.log(file, exports.get(file));
		}

		types.code += `}\n`;
	}

	types.code += `//# sourceMappingURL=${path.basename(output)}.map`;

	try {
		fs.mkdirSync(path.dirname(output), { recursive: true });
	} catch {
		// ignore
	}

	fs.writeFileSync(output, types.code);
	fs.writeFileSync(`${output}.map`, JSON.stringify(types.smg, null, '\t'));
}
