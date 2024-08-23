declare module 'no-renames' {
	export type X = true;
	export function error(): void;
	export type Y = Namespace.X;
	export namespace Namespace {
		interface X {
			error(): string;
		}
	}

	export {};
}

//# sourceMappingURL=index.d.ts.map