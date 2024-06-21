declare module 'basic' {
	/** A vector with two components */
	interface Vector2 {
		/** The x component */
		x: number;
		/** The y component */
		y: number;
	}
	/**
	 * Add two vectors
	 * @param a the first vector
	 * @param b the second vector
	 * */
	function add(a: Vector2, b: Vector2): Vector2;

	export { Vector2, add };
}

declare module 'basic/subpackage' {
	/**
	 * Multiply two vectors
	 * */
	function multiply(a: import("basic").Vector2, b: import("basic").Vector2): import("basic").Vector2;

	export { multiply };
}

//# sourceMappingURL=index.d.ts.map