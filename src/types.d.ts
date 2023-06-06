import { SourceMapMappings } from '@jridgewell/sourcemap-codec';

interface Declaration {
	module: string;
	external: boolean;
	name: string;
	alias: string;
	included: boolean;
	references: Set<string>;
}

interface Binding {
	id: string;
	name: string;
}

interface ModuleReference {
	id: string;
	external: boolean;
}

export interface Module {
	file: string;
	dts: string;
	ast: import('typescript').SourceFile;
	locator: (pos: number) => import('locate-character').Location;
	source: null | {
		code: string;
		map: any; // TODO
		mappings: SourceMapMappings;
	};
	dependencies: string[];
	declarations: Map<string, Declaration>;
	imports: Map<string, Binding>;
	import_all: Map<string, Binding>;
	export_from: Map<string, Binding>;
	export_all: ModuleReference[];
	ambient_imports: ModuleReference[];

	/** A map of <exported, local> exports */
	exports: Map<string, string>;
}

export interface Mapping {
	source: string;
	line: number;
	column: number;
}
