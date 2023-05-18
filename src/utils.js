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

export class File {
	/** @type {string} */
	#filename;

	/** @type {string} */
	#contents = '';

	/** @type {Map<number, import('./types').Mapping>} */
	#mappings = new Map();

	/** @param {string} filename */
	constructor(filename) {
		this.#filename = filename;
	}

	/**
	 *
	 * @param {string} string
	 * @param {*} [mapping]
	 */
	append(string, mapping) {
		this.#mappings.set(this.#contents.length, mapping);
		this.#contents += string;
	}

	save() {
		try {
			fs.mkdirSync(path.dirname(this.#filename), { recursive: true });
		} catch {
			// ignore
		}

		const comment = `//# sourceMappingURL=${path.basename(this.#filename)}.map`;
		this.#contents += comment;

		console.log('saving', this.#filename);
		fs.writeFileSync(this.#filename, this.#contents);

		// TODO generate sourcemap
		// fs.writeFileSync(`${this.#filename}.map`, JSON.stringify(types.smg, null, '\t'));
	}
}
