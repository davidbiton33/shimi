# AgentOS v0.3.0 — Acceptance & testing

**Environment tested:** Linux, Node.js 22.16.0, Git 2.47.3.

## Acceptance targets

| Behavior | Verification |
|---|---|
| `init` | Preserves unmanaged agent instructions; creates `.ai` and validated config |
| `start → pack → checkpoint → end` | Native packed source, manifest, Handoff and checkpoint with no Repomix |
| `doctor` | Checks Node, Git, repository, config, native packer, watcher |
| Watcher | Detached process updates changed files, rebuilds pack, shuts down cooperatively |
| Concurrency | Per-project lock prevents conflicting starts, stale dead-process owner handled |
| Private content | Blocks `.env`, sensitive dirs, symlinks and binaries; masks representative inline secrets and multiline keys |
| Limits | Enforces file count, file size, total bytes, output bytes |
| Determinism | Identical source/config → byte-identical packed Markdown and manifest |
| Upgrade | Legacy v0.2 `repomix:` config parsed into native `packer:` settings |
| Install | Packaged .tgz installed without network into clean prefix and exercised on test repo |

## Remaining pre-v1 acceptance

- Validate on actual Windows/macOS and varied-size real monorepos.
- Perform adversarial privacy audit; heuristic secret masking is not a guarantee.
- Evaluate stale-link replacement race, Git path edge cases, export redaction and resource load under stress.
- Test actual cross-agent handoff in different editors and terminal environments.
- Validate crash recovery and noncommitted file preservation expectations.
