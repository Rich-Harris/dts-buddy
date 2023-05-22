import fs from 'node:fs';
import path from 'node:path';
import glob from 'tiny-glob/sync.js';
import globrex from 'globrex';

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
