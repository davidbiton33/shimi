# AgentOS SCIP — Optional local semantic evidence

This is phase 1 of SCIP integration and does not replace the core AST/graph engine.

## Why

The `context` CLI can now prefer exact source symbol identities from a language-specific
SCIP indexer over name-based AST/structural guesses. A SCIP `Occurrence` can identify a
definition or a reference, and `SymbolInformation.relationships` can indicate
implementations or related symbols. The metadata is reported with source provenance;
it is **not** a verified dynamic call graph.

## Workflow

1. Initialize AgentOS as usual: `agentos init`.
2. In the project root, generate a SCIP index using a separate indexer.
   For TypeScript/JS (`@sourcegraph/scip-typescript`, currently Node.js 22/24):
   `scip-typescript index --output index.scip`.
   JS projects without a tsconfig may require `--infer-tsconfig`.
   Monorepos may need `--pnpm-workspaces` or `--yarn-workspaces`.
3. Import it: `agentos scip import --index index.scip --json`.
4. Inspect: `agentos scip status --json`.
5. Request: `agentos context --symbol calculateTotal --json`.
   Use the returned `semantic.symbolId` in
   `agentos context --symbol-id 'exact symbol id' --json` to avoid ambiguity.
6. Repeat on demand. The base `current-task.md` is not modified by these requests.
7. Regenerate and reimport after edits that affect symbol identity or project dependencies.

For Java/Kotlin, .NET, Dart, Python, etc., use a suitable indexer to produce a SCIP binary
and import it. AgentOS doesn't install those indexers and doesn't guarantee their availability
or correctness; some have extra toolchain/build requirements.

## Trust and limitations

- Only documents in the Git inventory and AgentOS allowlist are ingested. Symlinks,
  secrets, and outside-project paths are rejected.
- `Metadata.project_root` must match the local project root. Unsafe/duplicate paths are ignored.
- Index file size capped at 64 MiB; documents, occurrences, and source reads are also bounded.
- Source snippets are run through AgentOS's existing sanitization pipeline.
- SHA-256 fingerprints are recorded when imported, and checked when a symbol is requested.
  This detects edits **after import**, not a semantically stale index at the instant of import.
- SCIP supports heterogeneous indexers. `scip-definition` proves only that the indexer
  emitted a definition occurrence, *not* that an application executes that method.
- Both `context` lookups and `pack`/main navigation graph now benefit. The AST/framework
  call graph still supplies call-specific evidence; SCIP links by themselves
  are reference navigation, not runtime invocation proof.
- No automatic indexer execution, network calls, MCP server, or external credentials.

## Implementation/testing

`src/scip.ts`: minimal protobuf decoder that understands Index/Document/Occurrence,
legacy and typed ranges, source symbol identity, references, and relationships.
`tests/scip.test.ts`: synthetic official-schema compatible binary fixtures, source-change
invalidations, unsafe paths, malformed indexes, and CLI end-to-end tests. A real
`scip-typescript`-generated index has **not yet** been included in acceptance testing;
do not claim verified compatibility across indexer versions until tested.

## Phase 2: `pack` and navigation graph (`0.8.21-rc.1`)

- `agentos pack` now reads the **previously imported** SCIP snapshot and checks
  every referenced source file against its saved SHA-256 before trusting edges.
- `.ai/packs/dependency-graph.json` exposes `semanticReferences` (from source
  occurrence to uniquely identified target definition) and `scipCoverage`.
  These are **navigation links**. They are intentionally **not** inserted into
  `edges` or counted as runtime-verified calls.
- Task-scoped SCIP evidence resolves name collisions when an explicitly named
  caller references the symbol. It may retain a relevant definition, but cannot
  guess runtime dispatch, container bindings, or cross-HTTP behavior.
- `current-task.manifest.json` contains `scip` coverage, ambiguity elimination,
  retained targets and callable-body verification; type declarations are not
  counted as function bodies.
- A task-scoped filter prevents broad type/DTO reference fan-out. No index still
  gives the identical legacy AST/framework pipeline.
- For offline QA, `qa/typescript-compiler-scip.mjs` can emit an actual SCIP
  index using the bundled TypeScript compiler/TypeChecker. This is a **QA-only
  indexer**, NOT the official `@sourcegraph/scip-typescript` package. It does
  not demonstrate compatibility with every official indexer. Production use
  still expects an independent supported SCIP indexer.
- `qa/scip-semantic-compare.mjs` verifies alias collision disambiguation against
  the earlier v0.8.19 compiled CLI using an actual TypeScript TypeChecker.

## Static callsites (TypeScript / JavaScript)

`dependency-graph.json` additionally reports `scipCallsites` **only** when
the SCIP reference matches an actual `CallExpression` or `new` callee in the
TypeScript AST and the source encoding is known. Imported identifiers and
type-only references do **not** qualify. A static target is not the
guaranteed runtime dispatch target (virtual methods, DI, monkey patching, etc.).
Other languages currently emit SCIP navigation references, not AST-verified
SCIP callsites. The count appears separately in `scipCoverage.staticCallsites`.


## Phase 3: freshness & safe regeneration (0.8.22-rc.1)

- Import records Git source-file inventory and build/lockfile fingerprints. Changes in either invalidate *all* imported SCIP navigation and callsite evidence. This prevents the old silent failure where a changed `tsconfig`/alias could keep an apparently valid link.
- `agentos scip status --json` exposes `freshness.staleFiles`, `changedConfigs`, and `inventoryChanged`. Older imported snapshots with no freshness metadata are intentionally invalidated; regenerate the index and reimport once.
- `agentos scip refresh --indexer typescript|java|dotnet|dart` runs a fixed local indexer executable without invoking a shell or fetching dependencies. For TypeScript/Java it writes `.ai/scip/generated.scip`; .NET/Dart commonly write `index.scip` at the root. Output must exist and differ from the previous binary before AgentOS imports it.
- `agentos scip auto-enable` opts in to auto-index on pack/start/context and uses **only** the TypeScript indexer. Failure does not block packing; the index remains unusable and AgentOS falls back to AST. `auto-disable` turns it off. Opt-in may run third-party local project build logic; enable only for trusted projects.
- On Windows, binary `.cmd` shim execution is not yet native-verified; manual generation plus `scip import` is the supported fallback.
- `qa/official-indexer-matrix.mjs` probes real indexer availability and optionally runs them with an explicit environment opt-in. The QA-only TypeScript TypeChecker emitter must never be represented as an official SCIP indexer.

**Caution:** The protocol does not authenticate source hashes from an indexer. Import-time freshness cannot be proven if an old binary is simply re-imported; the generation step must have actually been performed. SCIP indexes are navigation metadata, not whole-program runtime proofs.
