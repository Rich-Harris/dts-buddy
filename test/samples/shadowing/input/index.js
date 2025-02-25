/**
 * @template K
 * @template V
 * @extends {Map<K, V>}
 */
class MyMap extends Map {
	#stuff = 1;

	/**
	 * @param {K} k
	 */
	has(k) {
		return super.has(k);
	}

	/**
	 * @internal
	 * @param {K} k
	 * @param {V} v
	 * @returns {this}
	 */
	set(k, v) {
		return super.set(k, v);
	}
}

export { MyMap as Map };
