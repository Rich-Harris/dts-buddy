declare module 'jsdoc-import' {
	/**
	 * Add two vectors
	 * @param a the first vector
	 * @param b the second vector
	 * */
	export function add(a: Vector2, b: Vector2): Vector2;
	/** A vector with two components */
	interface Vector2 {
		/** The x component */
		x: number;
		/** The y component */
		y: number;
	}

	export {};
}

//# sourceMappingURL=index.d.ts.map