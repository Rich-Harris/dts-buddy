/**
 * Add two vectors
 *
 *  This is a second line
 *
 * @param {import('./types').Vector2} a
 * @param {import('./types').Vector2} b
 * @returns {import('./types').Vector2}
 */
export function add(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}
