declare module 'my-lib' {
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
}

declare module 'my-lib/subpackage' {
	import type { Vector2 } from 'my-lib';
	/**
	 * Multiply two vectors
	 */
	export function multiply(a: Vector2, b: Vector2): Vector2;
}

//# sourceMappingURL=index.d.ts.map