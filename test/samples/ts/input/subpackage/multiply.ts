import type { Vector2 } from 'ts';

/**
 * Multiply two vectors
 */
export function multiply(a: Vector2, b: Vector2): Vector2 {
	return {
		x: multiply_numbers(a.x, b.x),
		y: multiply_numbers(a.y, b.y)
	};
}

/**
 * Multiply two numbers
 */
function multiply_numbers(a: number, b: number) {
	return a * b;
}
