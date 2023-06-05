import { SourceMapMappings } from '@jridgewell/sourcemap-codec';
import MagicString from 'magic-string';
import * as ts from 'typescript';

interface Declaration {
	node:
		| ts.InterfaceDeclaration
		| ts.TypeAliasDeclaration
		| ts.FunctionDeclaration
		| ts.ClassDeclaration
		| ts.VariableStatement;
	name: string;
	references: Set<string>;
	is_referenced: boolean;
	alias: string;
}

interface Binding {
	id: string;
	name: string;
	external: boolean;
	referenced: boolean;
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
