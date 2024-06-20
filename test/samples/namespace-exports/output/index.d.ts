declare module 'namespace-exports' {
	type X = Namespace.X;
	namespace Namespace {
		interface X {
			x: string;
		}
		interface Y {
			y: string;
		}
	}

	export { X };
}

//# sourceMappingURL=index.d.ts.map