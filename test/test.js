import fs from 'node:fs';
import glob from 'tiny-glob/sync.js';
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { createBundle } from '../src/index.js';

for (const sample of fs.readdirSync('test/samples')) {
	test(sample, async () => {
		const dir = `test/samples/${sample}`;

		const modules = JSON.parse(fs.readFileSync(`${dir}/modules.json`, 'utf-8'));
		for (const [name, value] of Object.entries(modules)) {
			modules[name] = `${dir}/input/${value}`;
		}

		await createBundle({
			project: `${dir}/tsconfig.json`,
			output: `${dir}/actual/index.d.ts`,
			modules,
			debug: `${dir}/debug`
		});

		const actual = glob('**', { cwd: `${dir}/actual`, filesOnly: true }).sort();
		const output = glob('**', { cwd: `${dir}/output`, filesOnly: true }).sort();

		assert.equal(actual, output);

		for (const file of actual) {
			assert.equal(
				fs.readFileSync(`${dir}/actual/${file}`, 'utf-8'),
				fs.readFileSync(`${dir}/output/${file}`, 'utf-8'),
				file
			);
		}
	});
}

test.run();
