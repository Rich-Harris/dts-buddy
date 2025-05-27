declare module 'no-renames' {
	export type X = true;
	export function error(): void;
	export interface Foo {
		get bar(): number;
		set bar(x: number);
	}
	export type Y = Namespace.X;
	export namespace Namespace {
		interface X {
			error(): string;
		}
	}
	export function bar(): void;

	export {};
}

//# sourceMappingURL=index.d.ts.map