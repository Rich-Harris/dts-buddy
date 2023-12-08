/**
 * @param {import('#lib').Input} input
 * @returns {import('#lib').Output}
 */
export function foo(input) {
	return input * 2;
}

/**
 * @overload
 * @param {import('#lib').Input} input
 * @returns {import('#lib').Output}
 *
 * @overload
 * @param {string} input
 * @returns {import('#lib').Output}
 *
 * @param {string | import('#lib').Input} input
 */
export function overload(input) {
	const input_num = typeof input === 'string' ? parseInt(input) : input;
	return input_num * 2;
}

/**
 * @typedef {Object} Foo
 * @property {import('#lib').Input} foo
 * @param {Foo} foo
 */
export function foo2(foo) {}
