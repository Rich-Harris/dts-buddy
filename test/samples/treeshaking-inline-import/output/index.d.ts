declare module 'treeshaking-inline-import' {
	/**
	 * Add two vectors
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