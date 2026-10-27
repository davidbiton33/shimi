# Offline Fullstack Lab — Release Candidate Acceptance

## Scope

Runs against the fully local `AgentOS-Fullstack-Lab/`, a runnable Node.js HTTP API and browser UI plus React TypeScript/TSX AST-analysis fixtures. The React/TSX fixtures are not bundled into the runnable browser UI; the latter is native JavaScript so no network install is required.

`npm test` in the fixture exercises live HTTP routes, authorization, coupons, stock, order creation/cancellation, variant pricing and browser asset delivery.

Acceptance runner automatically creates a Git repo and initializes AgentOS when required. It changes only the fixture's task input, executes `pack` in a fresh CLI process for each task, checks presence of required files and emitted symbol identifiers, checks precise imported API members, checks JSX preservation coverage, ensures unrelated APIs are not promoted, and archives every produced context and manifest. These checks are **not** a semantic proof of answer quality.

## A/B results on the same fixture and same prompts

| Task | v0.8.10 estimated tokens | v0.8.11-rc.1 estimated tokens | v0.8.10 | v0.8.11-rc.1 |
|---|---:|---:|---|---|
| cart | 9,912 | 9,918 | PASS | PASS |
| auth | 6,739 | 6,806 | PASS | PASS |
| checkout | 7,398 | 7,880 | FAIL | PASS |
| inventory | 8,621 | 8,742 | FAIL | PASS |
| reports | 5,614 | 5,688 | FAIL | PASS |
| admin | 6,462 | 6,585 | FAIL | PASS |
| pricing | 3,889 | 7,248 | FAIL | PASS |
| returns | 9,366 | 7,619 | PASS | PASS |

- v0.8.10: **3/8 passed** under the stricter contract.
- v0.8.11-rc.1: **8/8 passed**.
- The RC sometimes includes **more** tokens than v0.8.10, because it restores relevant omitted APIs. Token counts are AgentOS estimates and not provider token measurements.
- The fixture was used during development. It is **not** an independent hidden holdout set, and this cannot be presented as generalization or universal production readiness.

## Replay

1. Extract the source ZIP and Fullstack Lab ZIP separately.
2. Node.js 20+ and Git are required. Build the CLI with `npm run build` or use the tarball installer.
3. Within `AgentOS-Fullstack-Lab`, run `npm test`, then `node benchmarks/run.mjs /absolute/path/to/AgentOS/dist/src/cli.js` (acceptance bootstraps Git and AgentOS).
4. Inspect `benchmark-results/summary.json`, per-task `*.manifest.json` and `*.pack.md`.

## Unverified release gates

- Clean Windows/macOS installation and CLI lifecycle on real machines.
- Independent projects using Python/Go/Java/C#/Rust/Ruby/PHP/C/C++/Kotlin/Dart; current strict WASM tests cover parser readiness, not independent feature acceptance.
- Full static type binding for aliases, reexports and dynamic dispatch.
- Extended adversarial security review, package supply chain and third-party licensing review.
- Exact tokenizer accounting, latency/memory thresholds under large repositories and true agent answer-quality evaluation.

**RC, not production-certified.**
