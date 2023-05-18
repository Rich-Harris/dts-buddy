/**
 * Add two vectors
 *
 *  This is a second line
 *
 * @param {import('./types').Vector} a
 * @param {import('./types').Vector} b
 * @returns {import('./types').Vector}
 */
export function add(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}
