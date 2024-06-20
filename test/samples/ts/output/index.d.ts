declare module 'ts' {
	/** A vector with two components */
	interface Vector2 {
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
	 */
	function add(a: Vector2, b: Vector2): Vector2;

	export { Vector2, Vector3, add };
}

declare module 'ts/subpackage' {
	import type { Vector2 } from 'ts';
	/**
	 * Multiply two vectors
	 */
	function multiply(a: Vector2, b: Vector2): Vector2;

	export { multiply };
}

//# sourceMappingURL=index.d.ts.map