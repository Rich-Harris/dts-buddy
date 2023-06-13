/**
 * Add two vectors
 * @param {import('./vectors').Vector2} a
 * @param {import('./vectors').Vector2} b
 * @returns {import('./vectors').Vector2}
 */
export function add(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}
