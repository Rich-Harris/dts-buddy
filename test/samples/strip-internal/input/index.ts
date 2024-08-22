export { Foo } from './others';

/** @internal TS itself will take care of stripping this */
export interface TSdddd {
	foo: boolean;
}
