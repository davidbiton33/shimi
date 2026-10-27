# Bundled Tree-sitter WASM runtime (v0.8.22 RC)

This release contains a pinned `web-tree-sitter` runtime and eleven compiled
Tree-sitter grammars (`*.wasm`). See `asset-manifest.json` for pinned
checksums. AgentOS never downloads runtime grammars during normal use.

`npm run build` copies these vendored files to `dist/vendor/tree-sitter`.
`agentos parsers --json` reports which grammars loaded successfully;
structural fallback is retained if a grammar is unavailable.

The directory currently contains `LICENSE-web-tree-sitter.txt` but individual
upstream grammar LICENSE texts still require redistribution audit. This is an
explicit blocking gate for public Stable distribution. See
`docs/RELEASE_HARDENING.md` in the source release.
