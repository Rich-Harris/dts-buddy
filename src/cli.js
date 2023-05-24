#!/usr/bin/env node
import fs from 'node:fs';
import sade from 'sade';
import c from 'kleur';
import { createBundle } from './index.js';

const dts_buddy_pkg = JSON.parse(
	fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

/** @param {string} message */
function exit(message) {
	console.error(c.bold().red(message));
	process.exit(1);
}

/** @param {string} message */
function warn(message) {
	console.error(c.bold().yellow(message));
}

const program = sade('dts-buddy [bundle]', true)
	.version(dts_buddy_pkg.version)
	.option('--project, -p', 'The location of your TypeScript configuration', 'tsconfig.json')
	.action(async (output, opts) => {
		if (!fs.existsSync('package.json')) {
			exit('No package.json found');
		}

		const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
		if (!output) output = pkg.types;

		if (!output) {
			exit(
				'No output specified. Either add a "types" field to your package.json, or run `dts-buddy <output>`'
			);
		}

		if (!pkg.exports) {
			exit('No "exports" field in package.json');
		}

		/** @type {Record<string, string>} */
		const modules = {};

		for (const [key, value] of Object.entries(pkg.exports)) {
			if (key[0] !== '.') continue;

			const entry = value.import ?? value.default;
			if (typeof entry === 'string') {
				modules[pkg.name + key.slice(1)] = entry;
			} else {
				warn(`Skipping pkg.exports["${key}"] — expected an "import" or "default" string`);
			}
		}

		if (Object.keys(modules).length === 0) {
			exit('No entry points found in pkg.exports');
		}
		
		await createBundle({
			output,
			modules
		});
	});

program.parse(process.argv);
