declare module 'my-lib' {

	/** A vector with two components */
	export interface Vector2 {
		/** The x component */
		x: number;
		/** The y component */
		y: number;
	}

	/** A vector with three components */
	interface Vector3 extends Vector2 {
		/** The z component */
		z: number;
	}
	/**
	 * Add two vectors
	 *
	 *  This is a second line
	 *
	 * */
	export function add(a: Vector2, b: Vector2): Vector2;
}

declare module 'my-lib/subpackage' {

	/**
	 * Multiply two vectors
	 * */
	export function multiply(a: import('my-lib').Vector2, b: import('my-lib').Vector2): import('my-lib').Vector2;
}

