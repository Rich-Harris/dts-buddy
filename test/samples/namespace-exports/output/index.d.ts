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
}

//# sourceMappingURL=index.d.ts.map
