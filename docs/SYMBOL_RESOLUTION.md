# v0.7 — Cross-file Symbol Resolution Specification

## Architecture

The module graph is built from safe, Git-visible source files with language adapters and a SHA-256 metadata cache. Import and export bindings are extracted from the already-bundled TypeScript AST for JS/TS. Python function/class declarations and `from ... import ...` are extracted conservatively and marked `heuristic`.

`src/symbols.ts` resolves **explicit bindings** through local module edges and re-export barrels, including `export *`, named and default exports, renames, and named import aliases. It is not a TypeScript type checker, runtime call graph, compiler, or module loader.

Results are versioned in `.ai/packs/dependency-graph.json` and visible through `agentos symbols --json`; `agentos graph --json` also contains the symbol report. Definitions discovered through barrels are promoted into the Smart Context graph selection at distance one when source anchors explicitly import the binding, and their actual symbol names are fed into the snippet ranker.

## Honesty protocol

- `resolved` means a **unique explicit local export binding** was found, not necessarily a runtime match in a full build.
- `ambiguous` is returned for conflicting wildcard exports.
- `unresolved` means no safely proven local definition was found.
- `unsupported` includes namespace-member access and exceeded traversal budgets.
- `certainty=ast` only when all binding links came from TS/JS AST; Python is `heuristic`.
- Dynamic imports, Python runtime attribute lookups, TS `paths` aliases, Node package exports/conditional exports, macros, inheritance/virtual dispatch, and framework dependency injection are **not** proven.

## Performance and security

- Offline; no source execution or network access.
- Relies on Git-approved file inventory and the Packer's secrets/symlink policy.
- Bounded 48-hop barrel depth, 1,200 visits per import, 2,400 reported imports across a repository.
- `truncated=true` when imports exceed the report budget.
- Cache contains metadata/hash only, not function bodies. Cache schema migrated to 3 to invalidate older entries.
- AST parser remains TypeScript for TS/JS; other language adapters remain structurally conservative when Tree-sitter assets are not present.

## Acceptance

Tests cover aliased import, default export, named re-export, wildcard re-export, cycles, ambiguity, unsupported namespace imports, external package rejection, heuristic Python imports, deep barrel focus, and incremental binding cache.
