declare module 'overloads' {
	interface Foo {
	}
	interface Bar {
	}
	export function baz(input: Foo): Foo;
	export function baz(input: Bar): Bar;

	export {};
}

//# sourceMappingURL=index.d.ts.map