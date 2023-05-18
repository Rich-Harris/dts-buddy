export interface Module {
	authored: boolean;
	source: string;
	ast: import('typescript').SourceFile;
	smc: import('@jridgewell/source-map').SourceMapConsumer | null;
}

export interface Mapping {
	source: string;
	line: number;
	column: number;
}
