import { Internal } from './internal';

export interface Foo {
	bar: string;
	/** @internal */
	baz: Internal;
}
