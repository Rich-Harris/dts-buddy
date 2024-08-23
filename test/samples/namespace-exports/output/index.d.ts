declare module 'namespace-exports' {
	export type X = Namespace.X;
	namespace Namespace {
		interface X {
			x: string;
		}
		interface Y {
			y: string;
		}
	}
	export namespace NamespaceWithDeps {
		interface Z {
			z: Dependency;
		}
	}
	interface Dependency {
		name: string;
	}

	export {};
}

//# sourceMappingURL=index.d.ts.map