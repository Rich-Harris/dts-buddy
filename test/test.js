import fs from 'node:fs';
import { createModuleDeclarations } from '../src/index.js';

for (const sample of fs.readdirSync('test/samples')) {
	const dir = `test/samples/${sample}`;

	await createModuleDeclarations({
		project: `${dir}/tsconfig.json`,
		ambient: `${dir}/actual/ambient.d.ts`,
		output: `${dir}/actual/index.d.ts`,
		modules: {
			'my-lib': `${dir}/input/types.d.ts`,
			'my-lib/subpackage': `${dir}/input/subpackage/index.js`
		}
	});
}
