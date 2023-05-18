export interface Module {
	authored: boolean;
	source: string;
	ast: import('typescript').SourceFile;
	smc: import('@jridgewell/source-map').SourceMapConsumer | null;
}
