# Incremental Symbol Graph — implementation, invariants and limitations (v0.8)

## Goal
Avoid recomputing cross-file symbol resolutions when a project change cannot affect them, while retaining exact equality with the conservative full resolver.

## Algorithm
1. The language-level graph scanner reads eligible, size-limited source files and reuses per-file analysis in `dependency-graph-index.json`, keyed by SHA-256 source hashes.
2. It builds the current import graph and export/import metadata. **Graph edge traversal itself is still rebuilt** from cached metadata; there is no claim of O(changes) end-to-end indexing.
3. `incremental-symbol-graph.json` stores SHA-256 hashes of import/export metadata, the previous graph's directed edges, and the previous symbol resolutions. No source bodies are stored.
4. Changed import/export metadata, removed or added modules, and added/removed graph edges form the dirty seed. For every changed edge, both endpoints are seeds.
5. Reverse dependency closure through **both old and new edges** invalidates all importing ancestors, including re-export chains. Unaffected source files reuse their previous symbol results; dirty source files are resolved against the complete *current* graph.
6. The new result is deterministically sorted and atomically saved, unless safety limits would be exceeded or the result is truncated.

## Guarantees and safety
- Modified symbol exports propagate to transitive consumers; a body-only edit does not invalidate symbol resolution.
- Newly added modules can satisfy unresolved imports; removed modules cannot leave stale results.
- Corrupt or unknown-schema caches trigger a fresh computation.
- Cache capped at 8 MB / 6,000 files / 120,000 directed edges / 2,400 reported import resolutions.
- All symbol processing is local; no source execution, embeddings, external API, or runtime npm dependency.
- Caches are performance hints, not source-of-truth. Git and source files remain authoritative.

## Example diagnostic

```json
"incrementalSymbols": {
  "mode": "incremental",
  "recomputedFiles": 3,
  "reusedFiles": 2,
  "dirtyFiles": 1,
  "invalidatedFiles": 3,
  "removedFiles": 0,
  "changedEdges": 0,
  "stored": true
}
```

Use `agentos graph --json` after `agentos pack`.

## Limits and future work
- The dependency graph scans current source hashes and reconstructs edge lists; full O(changes) graph updates and a persistent reverse adjacency index remain future optimizations.
- Dynamic imports, reflection, runtime method dispatch, and type-checker-informed symbol resolution are intentionally not claimed as exact.
- Concurrent writers must use the existing AgentOS project lock (CLI path). Calling the low-level `buildGraph` API concurrently to the same cache path is not supported.
- Additional syntax validity checks and genuine Tree-sitter WASM integration tests remain outstanding until assets are available.
