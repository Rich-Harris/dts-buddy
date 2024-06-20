declare module 'shadowing' {
	class MyMap extends Map<any, any> {
		constructor();
		constructor(entries?: readonly (readonly [any, any])[]);
		constructor();
		constructor(iterable?: Iterable<readonly [any, any]>);
	}

	export { MyMap as Map, MyMap };
}

//# sourceMappingURL=index.d.ts.map