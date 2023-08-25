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
