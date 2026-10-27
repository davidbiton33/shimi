# AgentOS v0.8.22-rc.2 — Release hardening status

## Passed locally (Linux / Node.js 22)

- Offline `npm pack`, clean `npm install --offline --ignore-scripts` and CLI version/status/context smoke.
- No user repositories, secrets or project source snapshots shipped inside the npm tarball.
- Source release includes full TS source, tests, offline vendored runtime, QA scripts and Windows smoke script.
- `npm test`, strict WASM, multilingual tests, and framework acceptance.
- Five user-provided real-world Git repository acceptance tasks compared against v0.8.19.
- SCIP index ingestion and TypeScript static callsite linking using the bundled compiler (QA-only emitter).
- Fail-closed stale index detection for edited indexed source, added source files, build/lockfile changes, and cached graph reads.

## Blocking gates before stable

1. **Official indexers:** Run `scip-typescript`, `scip-java` (Java/Kotlin), `scip-dotnet` and `scip_dart` on the real project fixtures with their build environments configured. The local QA environment has no official indexers and no registry network access. Probe result is 0 attempted, NOT 0 failed.
2. **OS parity:** Run `qa/windows-smoke.ps1` on native Windows and analogous smoke on macOS with the exact TGZ. In particular Windows npm-installed `.cmd` shim handling for auto-refresh is not verified.
3. **Third-party WASM license audit:** The archive currently includes pinned Tree-sitter grammar `.wasm` files and `LICENSE-web-tree-sitter.txt`, but per-grammar LICENSE texts were not confirmed in the vendored folder. Confirm each grammar's upstream SPDX/license and redistribute required notices before any public stable release. Update `vendor/tree-sitter/README.md` to match the actual shipped assets, since it contains historical bootstrap-only language.
4. **Untrusted build audit:** Official indexers may execute Maven/Gradle/.NET/npm project scripts. Do not opt in to auto refresh on untrusted repositories. Review CI isolation and resource limits.
5. **Semantic acceptance:** Existing five-task acceptance proves bounded retention of specified source spans, not runtime semantics, complete precision/recall or compiler parity. Extend independent gold sets and indexer-produced reference verification before marketing any strong guarantee.

## Reproducibility

```bash
npm test && npm run test:wasm && npm run qa:multilang && npm run qa:frameworks
node qa/official-indexer-matrix.mjs <fixtures> dist/src/cli.js official-readiness.json
# Intentionally execute build toolchains ONLY for trusted repositories:
AGENTOS_ALLOW_PROJECT_BUILD_EXEC=1 node qa/official-indexer-matrix.mjs <fixtures> dist/src/cli.js official-run.json --execute
```

Status: **Release candidate, not public v1.0 Stable**.
