# AgentOS Smart Context Engine — Technical specification v0.4.0

## Scope and engineering decision
AgentOS creates small, task-focused, reviewable context packages from a Git working tree. **No model is invoked** to decide what to include, and no network is used. The term “semantic” here means **deterministic symbol relevance, structure and one-hop call/reference relationships**, not neural semantic search or an LLM-generated semantic summary.

`agentos pack` and the background watcher call the same engine. Existing sessions, checkpoints, packs and handoffs remain compatible.

## Offline dependencies
Node.js >=20 and Git are still required. A pinned TypeScript compiler is **vendored** (`vendor/typescript.cjs`, Apache-2.0; license in `vendor/TYPESCRIPT_LICENSE.txt`); the installable package includes a copy in `dist/vendor/`. It is real third-party code, albeit shipped with AgentOS; there is no runtime npm dependency and no runtime download. This is not “zero third-party code.”

## Processing pipeline
1. Read Git's tracked and non-ignored untracked paths. Ignore forbidden directories, binary-like extensions, secret file names, explicit user ignore globs and symlink paths.
2. Select files from deterministic framework presets, changed/untracked paths, explicit task file references and configured patterns. Prioritize exact task paths, then changed files, then project metadata and filename terms.
3. Read bounded file content as strict UTF-8; enforce source and output byte limits.
4. Parse JS/JSX/TS/TSX into a real TypeScript AST. Keep imports, module exports, class and function boundaries, methods, source line numbers and lexical references. For other languages, preserve original source. For malformed JS/TS, **preserve full text rather than inventing a parse**.
5. Rank declarations by matches between the task and symbol name, signature and referenced identifiers; AST references used in selected declarations expand relevant functions in the same file by one hop.
6. Emit full code for relevant declarations and compact syntax outlines for less relevant declarations, annotating each original line range. Never pass a truncated function body off as a valid complete body. If a relevant function exceeds its per-file budget, emit a labeled outline with the reason.
7. Pass **all emitted text** through secret redaction. Generated source packs are sensitive and must be reviewed before sharing. Built-in rules are **best-effort** and cannot guarantee detection of every secret.
8. Apply output-byte and estimated-token budget. The engine fails closed if task/header alone exceed the limit and leaves the previous good pack unchanged.
9. Write deterministic Markdown and JSON manifest with selected files, symbols, ranges, full/outline selection, omitted/budget reasons, SHA256 fingerprints, sizes and compression ratio.

## Configuration
AgentOS keeps `agentos.yml` deliberately small and uses a strict YAML subset, not full YAML.

```yaml
packer:
  enabled: true
  include: []
  ignore: []
  maxFiles: 200
  maxFileBytes: 131072
  maxTotalBytes: 2097152
  maxOutputBytes: 1048576
smart:
  mode: smart
  maxEstimatedTokens: 200000
  minSymbolScore: 30
  fullFileThresholdBytes: 800
  fileBudgetBytes: 65536
```

`smart.mode: full` reverts to the old complete-file packer, retaining current safety checks. `fullFileThresholdBytes` preserves short source files in full. On reading v0.3 config without the `smart` section, the defaults above are applied without destructive migration.

## Token accounting — intentionally honest
- `outputBytes`: exact UTF-8 bytes in the finished pack.
- `exactSyntaxTokens`: exact count of tokens reported by the bundled TypeScript scanner for the **selected output fragment of JS/TS source**, not model-specific tokens.
- `estimatedTokens`: a deliberately conservative heuristic, `ceil(UTF8 bytes / 2)`, used to plan pack size. It is **not** an exact LLM tokenizer and is not a mathematical guarantee across all models.
- `exactModelTokens`: always `null` in v0.4; `tokenAccounting` explicitly says estimate-only.
- `smart.maxEstimatedTokens`: budget based on that heuristic; it is not a hard provider context limit. Keep safety headroom for system prompts, conversation history and tool responses.

**Why no universal exact model count?** Claude, Gemini and the different OpenAI models can tokenize the same input differently; precise model token counting requires their own versioned tokenization assets/API. Adding one universal “exact tokens” number would be misleading. Once one or more target model families are selected, offline tokenizers can be bundled as optional adapters without changing the packer architecture.

## Inspecting results
```bash
agentos init
agentos start --no-watch
agentos pack
agentos explain --json
# .ai/packs/current-task.md
# .ai/packs/current-task.manifest.json
```

The manifest is local. It includes `parser`, `mode`, `segments`, `compressionRatio`, `redactedLines` and all budget fields. Outlined/omitted content is not a replacement for reading the original repo when edits are required.

## Known limitations and backlog
- Structured AST extraction is for JS/JSX/TS/TSX; other languages use full text. TS Compiler parsing does not perform full program-wide type checking.
- Dependency closure is *one hop inside each file*; no project-wide import graph, type-resolved symbol references, or call graph is claimed.
- No AI-generated summaries, embeddings, lexical minification, intelligent chunk deduplication or exact model token count.
- A compressed pack is an information-lossy reading aid, **not** a code backup, reproducible build, or guarantee the agent sees all relevant logic.
- Tests verify functional behavior in a Linux environment; Windows/macOS and large monorepos are still release gates.

## Acceptance criteria
- No network or external npm module required at runtime.
- Vendor AST parser and license are distributed with installed package.
- Parser extracts method and import boundaries for TSX, and handles malformed code conservatively.
- Task-relevant body and at least one local reference can be selected, with untouched functions compacted to source-preserving outlines.
- Limits, ignore rules and inline redaction remain active.
- Packs and manifests are byte-identical when project/task/config state is unchanged.
- Runtime installation and the original v0.3 tests pass.
