/**
 * Multiply two vectors
 * @param {import('my-lib').Vector} a
 * @param {import('my-lib').Vector} b
 * @returns {import('my-lib').Vector}
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
