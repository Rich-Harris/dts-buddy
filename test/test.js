import fs from 'node:fs';
import { createBundle } from '../src/index.js';

for (const sample of fs.readdirSync('test/samples')) {
	const dir = `test/samples/${sample}`;

	await createBundle({
		project: `${dir}/tsconfig.json`,
		output: `${dir}/actual/index.d.ts`,
		modules: {
			'my-lib': `${dir}/input/types.d.ts`,
			'my-lib/subpackage': `${dir}/input/subpackage/index.js`
		}
	});
}
