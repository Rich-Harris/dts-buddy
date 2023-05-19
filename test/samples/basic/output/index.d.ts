declare module 'my-lib' {
	/** A vector */
	export interface Vector {
		/** The x component */
		x: number;
		/** The y component */
		y: number;
	}
	/**
	 * Add two vectors
	 *
	 *  This is a second line
	 *
	 * */
	export function add(a: Vector, b: Vector): Vector;
}

declare module 'my-lib/subpackage' {

	/**
	 * Multiply two vectors
	 * */
	export function multiply(a: import('my-lib').Vector, b: import('my-lib').Vector): import('my-lib').Vector;
}

