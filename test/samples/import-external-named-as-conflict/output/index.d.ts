declare module 'import-external-named-as-conflict' {
	import type { foo as f } from 'external';
	function foo(): void;

	export { foo, f };
	export { f };
}

//# sourceMappingURL=index.d.ts.map