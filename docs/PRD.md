> v0.4.0 scope: deterministic symbol-aware Smart Context Engine with vendored parser; see [SMART_CONTEXT_ENGINE.md](SMART_CONTEXT_ENGINE.md). No external npm runtime dependencies; exact LLM tokenization remains target-model dependent.

# AgentOS — Product Requirements Document v1.2

**Date:** 2026-10-20  
**Status:** Implemented developer release, with platform and integration validation pending.  
**Source of truth:** Project-specific documents `AgentOS_PRD_v0.1` and `AgentOS_Specification_v1.0`, July 2026. This PRD expands those concepts into testable requirements; it does not replace their vision.

## 1. Problem and product thesis

AI coding conversations and hosted agent sessions are fragile containers for project continuity. When a model quota expires, a chat ends, or the developer switches editor, the developer often repeats repository scanning and re-explains context. A repository-local, deterministic memory layer should own this continuity rather than any one AI vendor. Git tracks code; AgentOS tracks working context and transition metadata.

## 2. Audience

- **Primary:** Solo developers switching between tools, AI coding assistants, terminals and editor clients.
- **Secondary:** Development teams needing deterministic handoff between human and AI contributors.
- **Non-target:** Users seeking a hosted autonomous AI agent or cloud orchestration platform.

## 3. User stories

- As a developer, I can run one command to initialize agent-independent project memory without destroying existing instructions.
- As a developer, I can start/resume a session and have the repository type and changed files detected automatically.
- As a developer, I can stop using one editor and supply the next with a portable handoff document.
- As a developer, I do not lose the *latest recorded session metadata* if the AI conversation disappears unexpectedly.
- As a developer, I can understand missing prerequisites and degraded packing from `doctor`.
- As a developer, I can use the same project memory in CLI-based and editor-based tools without requiring logins, APIs, embeddings or a cloud database.

## 4. Requirements

| ID | Priority | Requirement | Acceptance criterion | Implementation |
|---|---|---|---|---|
| R01 | P0 | `init` establishes `.ai` and settings | Re-running refuses to overwrite existing config; existing agent instructions preserved | Yes |
| R02 | P0 | Git-aware dirty file and branch tracking | Modified, staged, untracked and branch information recorded | Yes |
| R03 | P0 | Deterministic project detection | Recognizes Vite/React/Next/Nest/Express/Angular/monorepo and other signatures without AI | Yes |
| R04 | P0 | Automatic native context packs | No third-party npm dependency; deterministic, selective, budgeted code pack and manifest | Yes; real binary validation pending |
| R05 | P0 | Session lifecycle | `start`, `end`, `status`, `resume` continue from local files | Yes |
| R06 | P0 | Background watcher | Polls, detects changed state, refreshes memory, saves checkpoints, shuts down | Yes; tested on Linux |
| R07 | P0 | Portable handoff | Export includes task, context, state, file map, rules and pack | Yes |
| R08 | P0 | Cross-agent rules | Generates bounded, marked sections for 7 editor/agent conventions + AGENTS.md | Yes |
| R09 | P0 | No hidden AI or server calls | Core uses no model or provider API and requires no credentials | Yes |
| R10 | P0 | Safe ignored generated data | Runtime/packed outputs excluded from Git and packing by default | Yes |
| R11 | P1 | `doctor` diagnostics | Reports required vs optional components and current artifacts | Yes |
| R12 | P1 | Manual checkpoints and pack | Direct commands update artifact independently | Yes |
| R13 | P1 | Watcher recovery | Re-running `start` on active session restarts missing daemon | Yes |
| R14 | P1 | Configurable retention and intervals | Validated settings and checkpoint pruning | Yes |
| R15 | P2 | VS Code UI | Thin CLI-calling shell with no business logic | Deferred (optional in source PRD) |
| R16 | P2 | Windows/macOS QA | Real daemon lifecycle and native context packing on both OSs | Pending |

## 5. Scope boundaries

**In:** local CLI, session workflow, project profile, file watchers, journal, metadata checkpoints, profile-guided native context packs, deterministic rules, portable handoffs.

**Out:** actual model inference, task planning by AI, generative summaries, file-content rollback, embeddings, hosted storage, remote editor control, automatic commits or pushing, provider billing integration, autonomous agent execution.

## 6. UX and performance goals

- Git-backed new project initialization should take less than a few seconds in normal small repos.
- Outputs are human-readable Markdown and JSON.
- `doctor` explains actionable problems rather than silently breaking.
- Each command should produce machine-consumable `--json` output for extensions and scripts.
- No Repomix binary is required at all.
- Source and generated data remain in the developer's directory; no sign-up.

## 7. Operational risks and mitigations

- **Secret exposure:** ignored sensitive file patterns, heuristic token masking, private local exports. Review files before sharing.
- **State loss:** periodic checkpoints and persistent task/context files; Git stores code. Not a backup of uncommitted bytes.
- **File corruption:** atomic rewrite of state and docs; append-only journal.
- **Daemon race:** session ID binding, watcher startup reconciliation and orderly stop.
- **Third-party tooling:** native implementation, zero runtime npm dependencies, preserve last pack on errors.
- **Editor incompatibility:** agents read portable files; rule adapter is a convenience rather than a guarantee of execution.

## 8. Success criteria

- 100% of automated tests passing on Linux.
- Real project can `init → start → edit → checkpoint → end → resume` without provider API credentials.
- Repeated initialization never destroys unmanaged user text.
- No AI model is called by core commands.
- Pack generation is either successful or explicitly marked disabled/error.

## 9. Definition of done for v0.1

Functional CLI, source code, test suite, docs and archive distributed together. The v0.1 release is **not equivalent to a production-hardened cross-platform release**; see roadmap for remaining work.

## 10. v0.3 requirement amendment — independence

- **R17 (P0):** Pack project source code without installing Repomix or other runtime npm packages. Verify through a clean tarball installation and synthetic Git worktree.
- **R18 (P0):** Apply hard limits on file size, file count and output bytes, reporting all skipped candidates in a manifest.
- **R19 (P0):** Skip symlinks, binary files and sensitive filenames; mask known credential signatures. This does not replace human review before export.
- **R20 (P1):** Keep v0.2 project configurations parseable; migrate old Repomix options without running the tool.
- **R21 (P1):** Identical project state and configuration produce byte-identical pack and manifest output.
