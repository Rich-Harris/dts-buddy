import { SourceMapMappings } from '@jridgewell/sourcemap-codec';
import MagicString from 'magic-string';

export interface GeneratedModule {
	type: 'generated';
	file: string;
	dts: string;
	ast: import('typescript').SourceFile;
	source: string;
	map: any; // TODO
	mappings: SourceMapMappings;
	locator: (pos: number) => import('locate-character').Location;
	result: MagicString;
}

export interface AuthoredModule {
	type: 'authored';
	file: string;
	dts: string;
	ast: import('typescript').SourceFile;
	source: null;
	map: null;
	mappings: null;
	locator: (pos: number) => import('locate-character').Location;
	result: MagicString;
}

export type Module = GeneratedModule | AuthoredModule;

export interface Mapping {
	source: string;
	line: number;
	column: number;
}
