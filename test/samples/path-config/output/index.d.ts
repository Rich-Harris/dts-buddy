declare module 'path-config' {
	function foo(input: Input): Output;

	function overload(input: Input): Output;

	function overload(input: string): Output;

	function foo2(foo: Foo): void;
	type Foo = {
		foo: Input;
	};
	type Input = number;
	type Output = number;
	function foo_nested(input: Input): Output;

	export { foo, overload, foo2, Foo, foo_nested };
}

//# sourceMappingURL=index.d.ts.map