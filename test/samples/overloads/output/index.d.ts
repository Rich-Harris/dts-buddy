declare module 'overloads' {
	interface Foo {
	}
	interface Bar {
	}
	function baz(input: Foo): Foo;
	function baz(input: Bar): Bar;

	export { baz };
}

//# sourceMappingURL=index.d.ts.map