/**
 * Multiply two vectors
 * @param {import('basic').Vector2} a
 * @param {import('basic').Vector2} b
 * @returns {import('basic').Vector2}
 */
export function multiply(a, b) {
	return {
		x: multiply_numbers(a.x, b.x),
		y: multiply_numbers(a.y, b.y)
	};
}

/**
 * Multiply two numbers
 * @param {number} a
 * @param {number} b
 */
function multiply_numbers(a, b) {
	return a * b;
}
