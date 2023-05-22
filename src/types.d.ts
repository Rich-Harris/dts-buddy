import { SourceMapMappings } from '@jridgewell/sourcemap-codec';

export interface GeneratedModule {
	type: 'generated',
	dts: string;
	ast: import('typescript').SourceFile;
	source: string;
	map: any; // TODO
	mappings: SourceMapMappings;
	locator: (pos: number) => import('locate-character').Location;
}

export interface AuthoredModule {
	type: 'authored',
	dts: string;
	ast: import('typescript').SourceFile;
	source: null;
	map: null;
	mappings: null;
	locator: (pos: number) => import('locate-character').Location;
}

export type Module = GeneratedModule | AuthoredModule;

export interface Mapping {
	source: string;
	line: number;
	column: number;
}
