import { Dependency } from './dependency';

export namespace Namespace {
	export interface X {
		x: string;
	}

	export interface Y {
		y: string;
	}
}

export namespace NamespaceWithDeps {
	export interface Z {
		z: Dependency;
	}
}
