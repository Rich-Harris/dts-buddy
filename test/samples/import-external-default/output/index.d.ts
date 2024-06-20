declare module 'import-external-default' {
	import type { default as x } from 'external';
	function foo(input: x): x;

	export { foo };
}

//# sourceMappingURL=index.d.ts.map