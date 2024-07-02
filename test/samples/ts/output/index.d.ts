declare module 'ts' {
	/** A vector with two components */
	export interface Vector2 {
		/** The x component */
		x: number;
		/** The y component */
		y: number;
	}
	/** A vector with three components */
	export interface Vector3 extends Vector2 {
		/** The z component */
		z: number;
	}
	/**
	 * Add two vectors
	 */
	export function add(a: Vector2, b: Vector2): Vector2;

	export {};
}

declare module 'ts/subpackage' {
	import type { Vector2 } from 'ts';
	/**
	 * Multiply two vectors
	 */
	export function multiply(a: Vector2, b: Vector2): Vector2;

	export {};
}

//# sourceMappingURL=index.d.ts.map