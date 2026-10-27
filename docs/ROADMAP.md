# AgentOS roadmap

## Delivered — v0.1.0

CLI with init/start/end/status/doctor/checkpoint/pack/handoff/resume/rules/watch; deterministic Git repository mapping; local AI-neutral context memory; managed agent adapters; background watcher; Repomix integration including degraded mode; retention policy; portable exports; integration tests and docs.

## Implemented reliability work — v0.2.0

- Atomic filesystem lock for session-changing CLI commands with dead-owner recovery.
- Nonce-bound watcher lease, heartbeat and cooperative shutdown; never signal an unverified PID.
- 15 integration/unit tests including concurrency, crash lock recovery and PID reuse protection.

## Remaining engineering milestone — v0.2.x

1. Native packer tested in fixtures; remaining: large monorepo scaling, secret scanning and additional language profiles.
2. Strengthen lease protocol for network filesystems and rapid forced-shutdown restarts.
3. Long-running process supervision and complete cross-process crash/fault-injection coverage.
4. macOS and Windows CI matrix and process supervisor portability checks.
5. Formal JSON Schema for config, session and checkpoint; migration/version keys.
6. Git staged/rename/submodule edge-case tests and more robust ignored-file handling.
7. Adapter compatibility audits (vendors change rule-file conventions).
8. Optional real content snapshots/patch backups: current checkpoints are metadata records only, not a copy of all uncommitted files.

## Optional UI — v0.3+

A lightweight VS Code extension that invokes `agentos` CLI and renders status/checkpoint/handoff, without business logic. Optional terminal UI. Human-reviewed export/share helpers. None requires an AI vendor or an account.

## Explicitly not on roadmap

A proprietary model backend, mandatory SaaS login, hidden automated code commits, token-hungry agent loop or vendor-specific orchestration engine. These contradict the product thesis.


## v0.3.0 — native context engine (implemented)

- Replaced Repomix subprocess with in-process, deterministic source packer.
- Added explicit output/file budgets, manifest, Git inventories, content redaction and hard excludes.
- Legacy v0.2 `repomix` config accepted.
- Remaining: real Windows/macOS validation, AST-aware trimming and rigorous security review.
