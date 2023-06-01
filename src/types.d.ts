import { SourceMapMappings } from '@jridgewell/sourcemap-codec';
import MagicString from 'magic-string';

export interface Module {
	file: string;
	dts: string;
	ast: import('typescript').SourceFile;
	locator: (pos: number) => import('locate-character').Location;
	result: MagicString;
	source: null | {
		code: string;
		map: any; // TODO
		mappings: SourceMapMappings;
	};
}

export interface Mapping {
	source: string;
	line: number;
	column: number;
}
