import { createBundle } from '../src/index.js';

await createBundle({
	output: 'types/index.d.ts',
	modules: {
		'dts-buddy': 'src/index.js'
	}
});
