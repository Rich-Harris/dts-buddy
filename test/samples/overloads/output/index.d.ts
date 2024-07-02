declare module 'overloads' {
	interface Foo {
	}
	interface Bar {
	}
	export function baz(input: Foo): Foo;
	export function baz(input: Bar): Bar;
}

//# sourceMappingURL=index.d.ts.map
