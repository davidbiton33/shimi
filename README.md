# SHIMI 🎤

[Website](https://shimi-dev.surge.sh) · [Issues](https://github.com/davidbiton33/shimi/issues)

**Switch agents. Keep your progress.**

*Shimmy shimmy yo. Next agent, let's go.*

Your coding agent ran out of tokens halfway through a task? SHIMI helps the next agent pick up your **project state, pending tasks, changed files, relevant source and recorded evidence** — without copying the old conversation.

**Local-first · Open source · Model-independent · Node.js 20+ · No API keys**

> **Public beta candidate — `1.6.0-beta.1`.** Linux has automated QA. The exact release package still needs native Windows/macOS acceptance tests and a real two-vendor AI-agent pilot.

## The entire pitch

**One-time setup** in an existing Git repository:

```bash
shimi setup
```

Your AI coding assistant uses SHIMI's Skill/MCP during routine work. **You control the agent change:**

```bash
# Claude Code / original terminal: quota ran out
shimi switch

# New coding agent, same Git worktree and .ai directory
shimi continue
```

The previous agent does **not** need to respond to `switch`. SHIMI does not copy hidden chat history or uncommitted files across computers.

## Install a beta artifact

Prerequisites: Git, Node.js 20+, and a trusted project repository. Download the `.tgz` attached to this project's GitHub release **once published**:

```bash
npm install -g --offline --ignore-scripts ./SHIMI-v1.6.0-beta.1-cli.tgz
shimi --version
cd /path/to/your/existing-git-repo
shimi setup --dry-run
shimi setup
```

- `setup` initializes `.ai/`, adds agent rules and project-local Skills/MCP for Claude Code, Cursor and Codex. Review the `--dry-run` preview and approve client MCP access as needed.
- Existing settings are preserved; unknown conflicting definitions are not overwritten.
- SHIMI retains the legacy **`agentos` CLI alias**, `.ai/` files, and `agentos.yml` config format.
- `shimi` on npm is owned by an unrelated MIDI library. The beta archive metadata uses `shimi-agent-cli`; no npm registry publishing claim is made.

## Daily flow

The coding agent should call `shimi work` (or MCP `agentos_work`, a legacy tool ID) when entering the project. It can then request source context, record decisions, track subtasks and inspect evidence.

| You want to… | Command |
| --- | --- |
| Preview setup | `shimi setup --dry-run` |
| Set up the project | `shimi setup` |
| Let an agent start or reuse work | `shimi work` |
| Switch to another agent | `shimi switch` |
| Continue from a handoff | `shimi continue` |
| Get help | `shimi help` |
| Check project state | `shimi doctor --json` |

Other commands include `context`, `pack`, `memory`, `subtask`, `evidence`, `guard`, `radar`, `stall`, `scip`, `session`, `mcp` and `skill`.

## What makes it useful

- **Agent continuity:** handoffs, next steps, session notes, Git-aware task memory.
- **Source-grounded context:** TypeScript AST and optional structural/SCIP evidence.
- **Evidence-aware resume:** reports recorded test evidence and whether source files changed. Evidence **does not prove correctness**.
- **No AI dependency:** SHIMI itself does not call an AI model or need a provider API key.
- **Explicit transfer:** SHIMI **never automatically switches AI agents**.

## Important limitations

- **Not transcript migration.** Decisions never recorded cannot be reconstructed after context expires.
- **Same worktree required.** Checkpoints are metadata, not file backups.
- **Tests are opt-in.** Review the project evidence manifest before running any commands.
- **Static analysis is not a correctness oracle.**
- **Beta OS support:** Linux tested; native Windows/macOS and live cross-agent pilots still needed.
- **Licensing:** bundled Tree-sitter WASM binaries match package hashes, but exact upstream grammar commit provenance remains unresolved. Third-party notices ship with the source package.
- **MCP naming:** SHIMI installs a connection named `shimi` with 14 legacy `agentos_*` tool IDs for compatibility.

## Development

```bash
npm ci
npm run build
npm test
npm run test:wasm
npm run qa:multilang
npm run qa:frameworks
```

The published tarball, once released, has **no runtime npm dependencies**.

## Why SHIMI?

Because the best moment to switch an AI agent is the moment you need to — not after rewriting your entire task.

*Shimmy shimmy yo, next agent, let's go.*

**MIT licensed.** Built for developers using multiple coding agents.
