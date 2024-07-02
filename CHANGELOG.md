# dts-buddy changelog

## 0.5.1

- Use more TypeScript-friendly way of preventing unintended exports ([#85](https://github.com/Rich-Harris/dts-buddy/pull/85))

## 0.5.0

- Prevent unintended exports ([#82](https://github.com/Rich-Harris/dts-buddy/pull/82))

## 0.4.7

- Preserve renamed exports ([#78](https://github.com/Rich-Harris/dts-buddy/pull/78))
- Avoid conflicts with globals ([#78](https://github.com/Rich-Harris/dts-buddy/pull/78))

## 0.4.6

- Handle namespaces ([#77](https://github.com/Rich-Harris/dts-buddy/pull/77))

## 0.4.5

- Support TypeScript 5.4 ([#76](https://github.com/Rich-Harris/dts-buddy/pull/76))

## 0.4.4

- Handle `.jsx` and `.tsx` ([#72](https://github.com/Rich-Harris/dts-buddy/pull/72))
- Allow `paths` to be nulled out ([#73](https://github.com/Rich-Harris/dts-buddy/pull/73))
- Handle overloads ([#74](https://github.com/Rich-Harris/dts-buddy/pull/74))

## 0.4.3

- Fix path resolution on Windows ([#71](https://github.com/Rich-Harris/dts-buddy/pull/71))

## 0.4.2

- Support path rewriting in `typedef`, `overload` and `callback` tags ([#68](https://github.com/Rich-Harris/dts-buddy/pull/68))
- Preserve type expressions in JSDoc annotations ([#69](https://github.com/Rich-Harris/dts-buddy/pull/69))

## 0.4.1

- Support TypeScript 5.3 ([#67](https://github.com/Rich-Harris/dts-buddy/pull/67))

## 0.4.0

- Replace path aliases ([#65](https://github.com/Rich-Harris/dts-buddy/pull/65))

## 0.3.0

- Make `typescript` a peer dependency ([#58](https://github.com/Rich-Harris/dts-buddy/pull/58))

## 0.2.5

- Handle enum declarations ([#57](https://github.com/Rich-Harris/dts-buddy/pull/57))

## 0.2.4

- Rename external imports as necessary ([#54](https://github.com/Rich-Harris/dts-buddy/pull/54))

## 0.2.3

- Ignore missing sourcemap segments ([#51](https://github.com/Rich-Harris/dts-buddy/pull/51))

## 0.2.2

- Correctly re-export declarations regardless of inclusion order ([#49](https://github.com/Rich-Harris/dts-buddy/pull/49))

## 0.2.1

- Include all project files by default ([#48](https://github.com/Rich-Harris/dts-buddy/pull/48))

## 0.2.0

- Use TypeScript to parse config, rather than `eval` ([#36](https://github.com/Rich-Harris/dts-buddy/pull/36))

## 0.1.14

- Improve error message when encountering unknown node types ([#39](https://github.com/Rich-Harris/dts-buddy/pull/39))
- Add license info ([#38](https://github.com/Rich-Harris/dts-buddy/pull/38))

## 0.1.13

- Allow `modules` to be specified via the CLI ([#35](https://github.com/Rich-Harris/dts-buddy/pull/35))

## 0.1.12

- Remove `declare module` blocks ([#33](https://github.com/Rich-Harris/dts-buddy/pull/33))

## 0.1.11

- Handle default exports ([#32](https://github.com/Rich-Harris/dts-buddy/pull/32))

## 0.1.10

- Override `lib` option ([#31](https://github.com/Rich-Harris/dts-buddy/pull/31))

## 0.1.9

- Use reference directives for external ambient imports ([#29](https://github.com/Rich-Harris/dts-buddy/pull/29))

## 0.1.8

- Include external ambient imports ([#27](https://github.com/Rich-Harris/dts-buddy/pull/27))

## 0.1.7

- Bump `locate-character` dependency

## 0.1.6

- Preserve descriptions in JSDoc comments, remove brackets from parameters

## 0.1.5

- Always preserve JSDoc comments with `@default`, `@deprecated` and `@example` tags

## 0.1.4

- Prevent unnecessary `_1` suffixes

## 0.1.3

- Preserve `@deprecated` tags
- More forgiving `pkg.exports` parsing in CLI
- Use `ts-api-utils` instead of brittle `node.kind` checks

## 0.1.2

- Work on Windows

## 0.1.1

- Ensure inline dependencies are correctly marked

## 0.1.0

- Treeshaking
- Robust renaming

## 0.0.10

- Ignore `outDir` setting

## 0.0.9

- Warn instead of failing on invalid `pkg.exports` entries

## 0.0.8

- Preserve `@example` and `@default` tags

## 0.0.7

- Include `types` in `pkg.files`

## 0.0.6

- Tidier output

## 0.0.5

- Remove unwanted `declare` keywords from `.d.ts` output

## 0.0.4

- Add a CLI

## 0.0.3

- Generate declaration maps

## 0.0.2

- Only export things that are exported

## 0.0.1

- First release
