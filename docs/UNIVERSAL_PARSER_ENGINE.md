# AgentOS v0.6 — Universal Parser Engine

## What shipped

- **Language-neutral ParserRegistry** with registered source parser providers. External TypeScript consumers can register parser adapters with their own `analyze(path, source)` function. This does **not** dynamically install parsers into the CLI.
- **Real AST for JS, JSX, TS and TSX**, powered by the **vendored TypeScript parser**. No npm dependency installation at runtime. TypeScript's code and license are included.
- **Deterministic, offline structural lexer** for Python, Go, Java, C#, Rust, Ruby, PHP, C/C++, Kotlin and Dart. It extracts bounded function/class units by indentation and balanced delimiters, masking strings and comments. This is **NOT a full grammar / AST parser**. The manifest reports `structural-lexer` instead of `typescript-ast`.
- **Semantic-ish compression without AI:** task terms select definitions, intra-file identifier references add one-hop helper context, and other definitions become labeled outlines. This is **lexical+structural relevance**, not learned semantic similarity.
- **Dependency-graph symbol integration:** successfully bounded structural declarations contribute qualified names like `AuthService.login` to the graph node’s symbol inventory, improving task-based file anchoring. Import edges still use the prior static scanners.
- **Graph metadata cache** in `.ai/cache/dependency-graph-index.json`, with content-SHA-256 invalidation, v2 schema, atomic writes, bounded cache size, corrupt-cache recovery and symlink checks. Only parsed imports/symbol names/hashes are cached; source bodies are not stored.
- `agentos parsers --json` reveals available parsers and whether their analysis is `ast` or `structural`.

## What we explicitly do not claim

- Complete AST parsing for all languages (requires vetted grammar engines, e.g. vendored Tree-sitter WASM grammars; no external registry access was available during this release).
- Complete cross-file call graph / symbol resolution; v0.5 imports remain best-effort static resolution, and dynamic imports may not resolve.
- Safe lossless compression: smart packs include outlines. For damaged syntax or a lexer failure, the file is included unchanged when possible and remains subject to pack-wide size limits.
- Provider-accurate LLM token counts. The packer reports a conservative estimate and explicitly sets `exactModelTokens: null`.
- Zero external prerequisites: Node.js >=20 and Git are still mandatory. There are no *runtime npm install* dependencies.
- Complete protection from secrets or prompt injection in code. Review context and handoff files before uploading.

## Parsing and fallback policy

`ParserRegistry` chooses a parser by extension. Each parser returns text spans with start/end offsets, ranges and diagnostics. JavaScript-family AST nodes are compiler-recognized syntax units. Structural parsers use bounded lexing with braces/indentation; they **cannot guarantee a valid syntax tree**. If no valid spans or diagnostics indicate unsafe parsing, Smart Context falls back to full text rather than silently omitting source. There are two levels of context analysis, made visible in the manifest: `full` and `smart`. Each symbol records whether its body is `full` or `outline` and why it was omitted.

## Incremental graph cache

A cold graph pass reads up to 3,000 source files/20 MB by default, calculates content hashes and extracts imports. A warm graph pass **still reads and hashes allowed source files** to ensure correctness, but reuses metadata for unchanged source and skips repeated import analysis. Files deleted from the repository are dropped from cache; malformed or oversized cache data triggers a clean rebuild. The JSON report adds `cache: {hits, misses, removed, stored}`. No background disk watcher or database is required for cache correctness.

## Follow-up roadmap

1. Vendor portable, licensed Tree-sitter runtime/grammars (WASM) per language without increasing runtime npm installation needs. Ensure parser grammar versions are included in cache keys and keep structural fallback.
2. Language-aware import resolver for Python packages, Kotlin/Java build modules, Rust Cargo crates, Go module replace/alias, PHP autoload and C++ compile commands. Always label certainty.
3. Safe symbol-resolution graph and deterministic import/use ranking, with cycle detection and budgets.
4. Performance benchmarks on real multilingual monorepos and Windows/macOS acceptance tests.
