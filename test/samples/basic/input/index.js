/**
 * Add two vectors
 * @param {import('./types').Vector2} a the first vector
 * @param {import('./types').Vector2} b the second vector
 * @returns {import('./types').Vector2}
 */
export function add(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}
