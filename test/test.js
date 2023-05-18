import { createModuleDeclarations } from '../src/index.js';

await createModuleDeclarations({
	project: 'test/tsconfig.test.json',
	output: 'test/actual/index.d.ts',
	modules: {
		'my-lib': 'test/input/types.d.ts',
		'my-lib/subpackage': 'test/input/subpackage/index.js'
	}
});
