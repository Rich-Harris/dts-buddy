# dts-buddy

A tool for creating `.d.ts` bundles.

## Why?

If you're creating a package with subpackages (i.e. you can import from `my-lib` but also `my-lib/subpackage`), correctly exposing types to your users in a way that works everywhere is [difficult difficult lemon difficult](https://www.youtube.com/watch?v=7mAFiPVs3tM).

The TypeScript team recommends a [variety of strategies](https://github.com/andrewbranch/example-subpath-exports-ts-compat/tree/main) but they all involve adding a bunch of otherwise useless files to your package.

One thing that works everywhere is `declare module` — if you expose a file like this...

```ts
declare module 'my-lib' {
  /**
   * Add two numbers
   */
  export function add(a: number, b: number): number;
}

declare module 'my-lib/subpackage' {
  /**
   * Multiply two numbers
   */
  export function multiply(a: number, b: number): number;
}
```

...then everyone will get autocompletion and typechecking for those functions. For bonus points, it should include a `.d.ts.map` file that allows 'go to definition' to take you to the original source. (This rules out hand-authoring the file, which you shouldn't be doing anyway.)

There are other benefits to this approach — you end up with smaller packages, and TypeScript has less work to do on startup, making everything quicker for your users.

Unfortunately, I couldn't find a tool for generating `.d.ts` bundles, at least not one that worked. `dts-buddy` aims to fill the gap.

## But really, why?

For [SvelteKit](https://kit.svelte.dev), where for a long time we hand-authored an `ambient.d.ts` file containing `declare module` blocks for subpackages, and _also_ had an `index.d.ts` file for the main types that had to duplicate the definitions of certain functions. Every time we changed anything, we had to update things in multiple places, and contributing to the codebase was unnecessarily difficult.

An extra dimension is that we have virtual modules like `$app/environment`, which can't be expressed using any of the techniques suggested by the TypeScript team.

`dts-buddy` means we can automate generation of all our type definitions, using the source as the, well, source of truth.

## How do I use it?

Pick a place to write your `.d.ts` file to — e.g. `types/index.d.ts` — then add it to your `package.json` both as the top-level `types` property and the `types` value of each entry in your `exports` map. Add a `prepublishOnly` step to your `scripts`:

```diff
{
  "name": "my-lib",
  "version": "1.0.0",
  "type": "module",
+  "types": "./types/index.d.ts",
  "files": [
    "src",
+    "types"
  ],
  "exports": {
    ".": {
+      "types": "./types/index.d.ts",
      "import": "./src/index.js"
    },
    "./subpackage": {
+      "types": "./types/index.d.ts",
      "import": "./src/subpackage.js"
    }
  },
  "scripts": {
+    "prepublishOnly": "dts-buddy"
  }
}
```

`dts-buddy` will infer the entry points and the output location from your `package.json`.

In some cases you may need to specify the entry points and output location manually (for example, you want to use a `.d.ts` file that re-exports from your `.js` file as an entry point), in which case:

```
dts-buddy types/index.d.ts -m my-lib:src/index.js -m my-lib/subpackage:src/subpackage.js
```

You can also use the JavaScript API directly:

```js
// scripts/generate-dts-bundle.js
import { createBundle } from 'dts-buddy';

await createBundle({
  project: 'tsconfig.json',
  output: 'types/index.d.ts',
  modules: {
    'my-lib': 'src/index.js',
    'my-lib/subpackage': 'src/subpackage.js'
  }
});
```

Note that the result will also be treeshaken — your .d.ts bundle will only include public types.

## Any other benefits over using `tsc`?

In large codebases, it's convenient to use the `"paths"` option in your `tsconfig.json` so that you can do things like this...

```js
/** @type {import('#types').Thing} */
let thing = { ... };
```

...instead of this:

```js
/** @type {import('../../../../../types.d.ts').Thing} */
let thing = { ... };
```

Unfortunately, `tsc` ignores `"paths"` when emitting declaration files ([docs](https://www.typescriptlang.org/tsconfig/#paths)), which breaks stuff. `dts-buddy` fixes it.

## License

MIT
