export { Y } from './type';
export { Namespace } from './namespace';
export type X = true;
export function error(): void {}

export interface Foo {
	get bar(): number;
	set bar(x: number);
}
export * from './function';
