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
 *   modules: Record<string, string>
 * }} options
 * @returns {Promise<void>}
 */
export async function createModuleDeclarations({
	project = 'tsconfig.json',
	output,
	modules
}) {
	const cwd = path.dirname(project);
	const tsconfig = JSON.parse(fs.readFileSync(project, 'utf8'));

	const input = get_input_files(cwd, tsconfig.include, tsconfig.exclude);

	/** @type {ts.CompilerOptions} */
	const options = {
		...tsconfig.compilerOptions,
		allowJs: true,
		declaration: true,
		declarationMap: true,
		emitDeclarationOnly: true
	};

	const created = {};
	const host = ts.createCompilerHost(options);
	host.writeFile = (fileName, contents) => (created[fileName] = contents);

	// Prepare and emit the d.ts files
	const program = ts.createProgram(input, options, host);
	program.emit();

	for (const id in modules) {
		const entry = path.resolve(modules[id]).replace(/\.[jt]s$/, '.d.ts');

		const dts = created[entry];
		const map = created[entry + '.map'];

		console.log(id, dts);
	}
}
