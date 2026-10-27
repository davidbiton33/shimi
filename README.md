# SHIMI 🎤

[Website](https://shimi-dev.surge.sh) · [Docs](docs/README.md) · [Issues](https://github.com/davidbiton33/shimi/issues)

**Switch agents. Keep your progress.**

*Shimmy shimmy yo. Next agent, let's go.*

Your coding agent ran out of tokens halfway through a task? SHIMI helps the next agent pick up your **project state, pending tasks, changed files, relevant source and recorded evidence** — without copying the old conversation.

**Local-first · Open source · Model-independent · Node.js 20+ · No API keys**

> **Public beta candidate — `1.6.0-beta.1`.** Linux has automated QA. The exact release package still needs a native Windows/macOS acceptance test and a real two-vendor AI-agent pilot. See [known limitations](#important-limitations).

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

Prerequisites: Git, Node.js 20+, and a trusted project repository. Download the `.tgz` attached to this project's GitHub release (once published):

```bash
npm install -g --offline --ignore-scripts ./SHIMI-v1.6.0-beta.1-cli.tgz
shimi --version
cd /path/to/your/existing-git-repo
shimi setup --dry-run
shimi setup
```

- `setup` initializes `.ai/`, adds agent rules and sets up project-local Skills and MCP for Claude Code, Cursor and Codex. Review the `--dry-run` preview and approve client MCP access as required by your agent.
- Existing agent settings are preserved; unknown conflicting definitions are not overwritten.
- If you previously used AgentOS, SHIMI retains the **`agentos` CLI alias** and the old `.ai/` and `agentos.yml` project state formats. The branded Skills/MCP configs migrate only where recognizable. See [migration notes](docs/SHIMI_MIGRATION.md).
- Do not run the agent on untrusted repositories with permissive shell permissions. SHIMI does not run tests unless you explicitly request it.

**Public npm status:** `shimi` (the bare package name) is already occupied by an unrelated MIDI library. The beta tarball uses `shimi-agent-cli` as its package metadata, but no claim of npm registration is made. Always install the verified release artifact until a registry release is announced.

## Daily flow

The AI agent should call `shimi work` (or MCP `agentos_work`, a temporary legacy tool ID) when entering the project. It can then request source context, record decisions, track subtasks and inspect evidence. **You shouldn't have to remember any maintenance commands.**

| You want to… | Command |
| --- | --- |
| Preview setup | `shimi setup --dry-run` |
| Set up the project | `shimi setup` |
| Let an agent start or reuse work | `shimi work` |
| Switch to another AI agent (you initiate) | `shimi switch` |
| Continue from previous handoff (you initiate) | `shimi continue` |
| Inspect everything SHIMI can do | `shimi help` |
| Check project readiness | `shimi doctor --json` |

Advanced, opt-in: `shimi context`, `pack`, `memory`, `subtask`, `evidence`, `guard`, `radar`, `stall`, `scip`, `session`, `mcp`, `skill`.

## What makes it useful

- **Agent continuity:** handoffs, explicit next steps, session notes, a Git-aware watcher and task memory.
- **Source-grounded context:** TypeScript AST and optional structural/SCIP evidence, with exact symbols/files and size limits.
- **Evidence-aware resume:** indicates when test evidence was recorded and whether declared source inputs changed. **Evidence does not prove business correctness.**
- **No AI dependency:** SHIMI never calls an AI model or needs a provider API key. The coding agent uses the data through CLI, a project-local Skill and/or MCP.
- **Explicit transfer:** SHIMI **never autonomously switches agents**; you run `switch` and `continue`.

## Important limitations

- **Not a transcript migration system.** Decisions never recorded by the previous agent cannot be reconstructed after its context expires.
- **Same worktree required:** local `.ai/` files and uncommitted source must still be available to the next agent. Checkpoints contain metadata, **not backups**.
- **Test execution is opt-in.** `evidence run` executes commands from a project-local manifest: review it first. Handoff and resume do not run repository code automatically.
- **Static analysis isn't a runtime correctness oracle.** Dependency warnings and conflict heuristics can miss dynamic behavior.
- **Beta OS support:** Linux tested; the exact beta tarball requires native Windows/macOS validation and actual Claude/Codex/Cursor interoperability tests.
- **Security & licensing:** best-effort secret redaction is not a guarantee. Bundled Tree-sitter WASM binaries have checksums matched to a source package, but per-grammar upstream commit provenance is not fully resolved. Review [third-party notices](docs/THIRD_PARTY_NOTICES.md) and [provenance](docs/GRAMMAR_PROVENANCE.json).
- **MCP compatibility note:** SHIMI installs client connection **`shimi`** and exposes 14 historically named **`agentos_*`** tools for compatibility; protocol identifiers may be versioned in a future release. Resources use `shimi://` with legacy `agentos://` readable.

## Development

```bash
npm ci
npm run build
npm test
npm run test:wasm
npm run qa:multilang
npm run qa:frameworks
```

The npm release tarball has **no runtime npm dependencies**. Development builds require TypeScript and the Node type definitions from `devDependencies`.

## More information

- [SHIMI migration and compatibility](docs/SHIMI_MIGRATION.md)
- [Zero-friction orchestrator reference](docs/ORCHESTRATOR_V15.md)
- [Evidence engine](docs/EVIDENCE_V14.md)
- [MCP and memory](docs/CONTINUITY_V12.md)
- [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Why SHIMI?

Because the best moment to switch an AI agent is the moment you need to — not after rewriting your entire task. *Shimmy shimmy yo, next agent, let's go.*

**MIT licensed.** Built for people who actually use multiple coding agents.
