export interface Module {
	authored: boolean;
	source: string;
	ast: import('typescript').SourceFile;
	smc: import('@jridgewell/source-map').SourceMapConsumer | null;
	locator: (pos: number) => import('locate-character').Location;
}

export interface Mapping {
	source: string;
	line: number;
	column: number;
}
