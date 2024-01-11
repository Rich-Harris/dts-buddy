interface Foo {}
interface Bar {}

export function baz(input: Foo): Foo;
export function baz(input: Bar): Bar;

export function baz(input: Foo | Bar) {
	return input;
}
