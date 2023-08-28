#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
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
	.option('--module, -m', 'Each entry point, as <id>:<path> (can be used multiple times)')
	.option('--debug', 'Directory to emit .d.ts files for debugging')
	.action(async (output, opts) => {
		if (!fs.existsSync('package.json')) {
			exit('No package.json found');
		}

		const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
		if (!output) output = pkg.types ?? 'index.d.ts';

		/** @type {Record<string, string>} */
		const modules = {};

		if (opts.module) {
			const entries = Array.isArray(opts.module) ? opts.module : [opts.module];
			for (const entry of entries) {
				const [id, path] = entry.split(':');
				if (!id || !path) {
					exit(`Invalid module entry: ${entry}`);
				}
				modules[id] = path;
			}
		} else {
			if (!pkg.exports) {
				exit('No "exports" field in package.json');
			}

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
				if (typeof pkg.exports === 'string') {
					modules[pkg.name] = pkg.exports;
				} else if (pkg.exports['import'] || pkg.exports['default']) {
					modules[pkg.name] = pkg.exports['import'] ?? pkg.exports['default'];
				} else {
					exit('No entry points found in pkg.exports');
				}
			}
		}

		await createBundle({
			output,
			modules,
			project: opts.project,
			debug: opts.debug
		});

		const relative = path.relative(process.cwd(), output);
		console.error(`Wrote ${c.bold().cyan(relative)} and ${c.bold().cyan(relative + '.map')}\n`);
	});

program.parse(process.argv);
