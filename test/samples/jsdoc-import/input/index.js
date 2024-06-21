/** @import {Vector2} from './vector' */

/**
 * Add two vectors
 * @param {Vector2} a the first vector
 * @param {Vector2} b the second vector
 * @returns {Vector2}
 */
export function add(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y
	};
}
