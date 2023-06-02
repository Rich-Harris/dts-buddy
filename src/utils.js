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
 */
export function get_dts(file, created) {
	const dts = created[file] ?? fs.readFileSync(file, 'utf8');
	const ast = ts.createSourceFile(file, dts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const locator = getLocator(dts, { offsetLine: 1 });
	const result = new MagicString(dts);

	/** @type {import('./types').Module} */
	const module = {
		file,
		dts,
		ast,
		locator,
		result,
		source: null
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
