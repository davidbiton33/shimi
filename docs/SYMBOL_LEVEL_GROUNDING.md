# Symbol-level task grounding (v0.8.9)

## Why

Previously, task-oriented semantic closure could start from an imported namespace (e.g. `db`) and spend context on unrelated *sibling* helpers such as banner/review/category mappers. The dependency was real at the file level but not at the specific member level.

## Static algorithm

1. Select task anchors and actionable JSX caller files using the existing task/graph process.
2. For each actual local import edge from those callers, parse the caller's TypeScript/JavaScript AST and identify **invoked, statically named member chains**. A call to `db.orders.createWithValidation()` is recorded as `db.orders.createWithValidation` with an originating file, line, and enclosing handler.
3. Respect named imports (including `import { db as storeDb }`) and namespace imports. Calls inside strings/comments, dynamic computed methods, or obviously shadowed local identifiers do not create member-level evidence.
4. In the imported module, split an exported **object-literal variable** into annotated, individually rankable method excerpts. Only the precise matched member and its bounded local helper closure are preferred; unrelated siblings are not promoted or printed as outlines. Preserve the container as an outline.
5. Record `importedMemberCoverage` (discovered / preserved / outlined / unresolved) and trace the exact callsite through `semanticDependencyCoverage.items[].trace`, with reason `imported-member-call`. Absence of a match or failure to retain its body is reported rather than counted as success.

## Example

```ts
// cart.ts
import { db } from './db';
await db.products.getByIds(ids);

// db.ts
export const db = {
  products: { getByIds: async (ids) => /* ... */, list: async () => /* unrelated */ },
  reviews: { list: async () => /* unrelated */ }
};
```

The pack prefers `db.products.getByIds`, plus any statically referenced top-level helpers; the unrelated `list` methods are not promoted simply because their parent object is `db`.

## Scope and limitations

- This is **static callsite evidence**, **not a TypeScript compiler symbol graph** and **not runtime/dataflow correctness**.
- Import targets must be local, resolved by the existing bounded graph, and the caller must be an explicit task file, selected anchor, or recognized JSX task-path file. Unresolved/reexported/third-party imports are not assumed to map to source implementations.
- Static property access, and bracket access with literal string keys, are supported. Dynamic index expressions, runtime property dispatch, factory-returned APIs, class instances, and method aliases are not fully resolved.
- The method extractor currently supports nested **object-literal API declarations** with static method/property names; other API construction patterns can be reported unresolved.
- `importedMemberCoverage.preserved == discovered` proves only that detected exact API member declarations were retained; it does not prove all semantically necessary dependencies were found. The existing `taskPathCoverage` has the same static-evidence limitation.
- Large method bodies still respect user-configured budgets; insufficient budget is reflected in the coverage report. Secrets continue through the pack's sanitize step.

## Offline acceptance

`npm test` (core) and `AGENTOS_REQUIRE_WASM=1 npm run test:wasm` (strict 11-language runtime) must pass. For real-project acceptance, hold `.ai/AI_TASK.md` and Git HEAD constant; compare v0.8.8 and v0.8.9 manifests, and inspect `.ai/packs/current-task.md` before declaring a quality win.
