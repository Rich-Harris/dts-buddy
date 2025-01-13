import fs from 'node:fs';
import { globSync } from 'tinyglobby';
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { createBundle } from '../src/index.js';
import * as semver from 'semver';
import ts from 'typescript';

const filter = process.argv[2];

for (const sample of fs.readdirSync('test/samples')) {
	if (filter && !sample.includes(filter)) continue;
	if (sample.startsWith('.')) continue;

	test(sample, async () => {
		const dir = `test/samples/${sample}`;

		/** @type {Record<string, string>} */
		const modules = {};

		const compilerOptions = {
			/** @type {Record<string, string[]>} */
			paths: {},
			...(fs.existsSync(`${dir}/options.json`)
				? JSON.parse(fs.readFileSync(`${dir}/options.json`, 'utf-8'))
				: {})
		};

		for (const file of globSync('**', { cwd: `${dir}/input`, onlyFiles: true })) {
			const parts = file.split(/[\/\\]/);
			const basename = parts.pop();

			if (basename === 'index.js' || basename === 'index.ts' || basename === 'types.d.ts') {
				const name = [sample, ...parts].join('/');
				modules[name] = `${dir}/input/${file}`;
				compilerOptions.paths[name] = [`./samples/${sample}/input/${file}`];
			}
		}

		fs.rmSync(`${dir}/actual`, { recursive: true, force: true });
		fs.rmSync(`${dir}/debug`, { recursive: true, force: true });

		await createBundle({
			project: 'test/tsconfig.json',
			modules,
			output: `${dir}/actual/index.d.ts`,
			debug: `${dir}/debug`,
			include: [`samples/${sample}/input`],
			compilerOptions
		});

		let output_dir = 'output';
		for (const candidate of fs.readdirSync(dir)) {
			if (!candidate.startsWith('output ')) continue;
			const range = candidate.slice(7);

			if (semver.satisfies(ts.version.split('-')[0], range)) {
				output_dir = candidate;
				break;
			}
		}

		const actual = globSync('**', { cwd: `${dir}/actual`, onlyFiles: true }).sort();
		const output = globSync('**', { cwd: `${dir}/${output_dir}`, onlyFiles: true }).sort();

		assert.equal(actual, output);

		for (const file of actual) {
			assert.equal(
				fs.readFileSync(`${dir}/actual/${file}`, 'utf-8').trim(),
				fs.readFileSync(`${dir}/${output_dir}/${file}`, 'utf-8').trim(),
				file
			);
		}
	});
}

test.run();
