declare module 'import-external-named-as-conflict' {
	import type { foo as f } from 'external';
	export function foo(): void;
	export { f };
}

//# sourceMappingURL=index.d.ts.map
