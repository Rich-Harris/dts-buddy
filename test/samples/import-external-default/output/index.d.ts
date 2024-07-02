declare module 'import-external-default' {
	import type { default as x } from 'external';
	export function foo(input: x): x;

	export {};
}

//# sourceMappingURL=index.d.ts.map