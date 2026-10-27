# AgentOS v0.5 — Multilingual Project-wide Dependency Graph

## Scope

The **AgentOS core is language-independent**: its watcher, sessions, checkpoints,
Git model, task and handoff do not depend on the project's implementation language.
The smart packer now uses a pluggable, language-specific `LanguageAdapter` registry,
with a conservative dependency index over eligible local Git files.

The graph is built without running the user's code, without network requests,
and without installing parsers/packages in the target project.

## Coverage and confidence

| Language family | Discovery | Dependency extraction | Function-body AST compression |
|---|---|---|---|
| TypeScript, JavaScript, JSX, TSX | Supported | **TypeScript AST** + basic literal CommonJS/dynamic imports | **AST** |
| Python | Supported | Relative/absolute `import` and simple `from ... import` (**heuristic**) | No, full source |
| Go | Supported | `import` and local paths resolved using `go.mod` (**heuristic**) | No, full source |
| Java | Supported | `import`, `package` and project paths (**heuristic**) | No, full source |
| C# | Supported | `using` and `namespace` (**heuristic**) | No, full source |
| Rust | Supported | `mod` / `use crate::` / `self::` (**heuristic**) | No, full source |
| Ruby | Supported | `require_relative` (**heuristic**) | No, full source |
| PHP | Supported | Literal `require` / `include` (**heuristic**) | No, full source |
| C, C++ | Supported | Local `#include "..."` (**heuristic**) | No, full source |
| Kotlin | Supported | `package` / `import` (**heuristic**) | No, full source |
| Dart | Supported | Relative imports and `package:` local URI (**heuristic**) | No, full source |

Other languages can still be packed as full text when covered by normal include
patterns. Add language adapters for graph support; do not infer unsupported
languages as accurately analyzed. The adapter contract is `src/languages.ts`.

## Pipeline

1. Read `AI_TASK.md`, Git inventory, ignore/secret rules and project profile.
2. Index at most 3,000 recognized source files, up to 20 MB of UTF-8 source.
3. Extract language-specific module links without code execution.
4. Resolve **local** links only. External dependencies are reported as unresolved,
   not fetched. Imports with computed/dynamic module names are not reliably resolved.
5. Seed graph with paths explicitly mentioned in the task and/or changed Git paths.
   If no anchors exist, search file names and declaration names in the task.
6. Traverse up to two hops, preferring dependencies, then dependents, capped at
   36 related paths in addition to anchors.
7. Rank those paths above unrelated preset files. Existing byte/file/token
   budgets still apply. The manifest records omissions and graph linkage.
8. For JS/TS source, promote imported named symbols so their full bodies are
   eligible for inclusion even if the task does not name them.

## Artifacts

- `.ai/packs/dependency-graph.json` — deterministic auditable nodes, local edges,
  unresolved links, parser confidence and indexing limits (metadata, not source).
- `.ai/packs/current-task.manifest.json` — graph summary, file relation and
  symbol-level reasons.
- `.ai/packs/current-task.md` — selected, redacted source snippets.

CLI: `agentos graph --json` and `agentos explain --json`.

## Engineering limits (do not claim otherwise)

- Non-JS languages currently use **static, regex-based scanning**, not a real AST.
  Comments, macros, multiline imports, wildcard imports and generated code can
  produce omissions or false links.
- `go.mod` import resolution is local/module based; all recognized `.go` files
  from a local package can be connected (bounded fan-out).
- C# namespace imports may connect several project files but do **not** establish
  type-accurate symbol dependencies; wildcard Java imports are also approximate.
- No full external package graph, no compilation, no type checking, no cross-
  language FFI mapping, no language-server integration and no runtime analysis.
- Python's precise relative import semantics vary with package roots and namespace
  packages. The heuristic may miss complex layouts.
- No persistent incremental graph index in v0.5; each `pack` rescan is bounded
  but large monorepos require profiling and caching before a production release.
- The byte-per-token estimate is **not** an exact model-specific tokenizer.
- The secret filter is defense in depth, **not** a guarantee that all sensitive
  values are detected. Review packs before sending to third-party AI providers.
- The dependency graph is an index, not a record of actual runtime call edges.

## Next recommended extensions

1. Pluggable Tree-sitter parsers for production-grade Python, Go, Java, Rust,
   C#, Kotlin etc., with versions/licenses bundled and no runtime npm install.
2. Incremental content-addressed graph indexing, robust cache invalidation,
   symlink/path protection, per-adapter performance limits.
3. Cross-language code intelligence for FFI/RPC/protobuf/OpenAPI references.
4. Task query relevance benchmarks on real polyglot monorepos (recall and
   token savings), then harden false-positive handling.
