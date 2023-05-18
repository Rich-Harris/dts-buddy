/**
 * Add two vectors
 * @param {import('my-lib').Vector} a
 * @param {import('my-lib').Vector} b
 * @returns {import('my-lib').Vector}
 */
export function add(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}
