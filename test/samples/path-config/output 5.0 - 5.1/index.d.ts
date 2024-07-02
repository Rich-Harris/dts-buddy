declare module 'path-config' {
	export function foo(input: Input): Output;
	export function overload(input: Input): Output;
	export function overload(input: string): Output;

	export function foo2(foo: Foo): void;
	export type Foo = {
		foo: Input;
	};
	type Input = number;
	type Output = number;
	export function foo_nested(input: Input): Output;

	export {};
}

//# sourceMappingURL=index.d.ts.map