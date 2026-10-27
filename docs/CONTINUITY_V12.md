# AgentOS v1.2.0 — Session continuity, MCP, task dependencies and durable memory

Four features are integrated into the *local, deterministic, model-independent* AgentOS CLI. They do not require Beads, Kontinuo, a cloud account or a running model. **They do not automatically read a provider's private chat transcript.** A coding agent must invoke the supplied CLI/MCP tools, or the user must explicitly ingest structured events.

## 1. Record decisions and intent from an active session

```bash
agentos init
agentos task prompt --request "Fix checkout validation" --lang en
# Paste the output to your coding agent; the agent updates AI_TASK.md.
agentos start
agentos session capture --kind intent --text "Keep existing checkout API stable"
agentos session capture --kind decision --text "Validate before charging cards"
agentos session capture --kind progress --text "Added request validator"
agentos session capture --kind next --text "Run integration tests"
agentos session list --json
agentos session timeline --json
```

Supported kinds: `intent`, `decision`, `progress`, `blocker`, `next`, `verification`. Each entry is timestamped and associated with the active Session ID. `session timeline` merges **factual** AgentOS Git/Watcher/Checkpoint events with explicit agent notes, clearly identifying the origin. **It does not guess why code changed.** The existing Watcher independently tracks source changes and checkpoints.

### Structured transcript import (opt-in only)

A coding agent or integration can emit a project-local, UTF-8 JSONL file with explicit annotations; example `agent-events.jsonl`:

```jsonl
{"kind":"decision","text":"Use the old API response shape","source":"Agent A"}
{"kind":"next","text":"Update checkout tests","source":"Agent A"}
```

```bash
agentos session ingest --file agent-events.jsonl --json
```

Ingestion validates *all* entries before writing any, is limited to 150 events / 1 MiB, and refuses outside-project or symlink paths. This is **not** general chat transcript parsing, and does not monitor Claude, Codex, or Cursor sessions behind the scenes. Captured entries are sanitized on a best-effort basis; avoid secrets. `.ai/session-notes/` is gitignored by default and includes sensitive working notes.

## 2. Connect AI coding agents through MCP

`agentos mcp serve --cwd /ABSOLUTE/PROJECT/PATH` starts a **stdio** Model Context Protocol server: newline-delimited JSON-RPC 2.0, *no HTTP server*. To generate a suggested MCP client configuration for the current project:

```bash
agentos mcp config --json
```

The resulting `mcpServers.agentos` object uses the installed CLI's absolute path and the project root; put it in the **appropriate MCP configuration file** for your agent (the exact location varies by client/version). Connecting an MCP client is a client-side action. No model is launched or contacted by AgentOS.

**MCP tools:**

- `agentos_status` — current state.
- `agentos_handoff` — portable session Handoff, augmented with explicit decisions and durable memories.
- `agentos_context` — source-grounded, bounded context by symbol/file/query.
- `agentos_tasks_ready` — runnable leaf tasks, with blocked reasons.
- `agentos_memory_search`, `agentos_memory_add` — durable project assertions.
- `agentos_session_timeline`, `agentos_session_notes`, `agentos_session_capture` — read/write attributed session events.

**MCP resources:** `agentos://task`, `agentos://handoff`, `agentos://pack`.

All tools are project-scoped. MCP is opt-in because it exposes code and project notes to the connected agent. Source snippets and machine-derived relationships are **evidence for navigation**, not proof of runtime control flow. Review the exposed material before attaching third-party agents.

## 3. Task dependency DAG and `ready` queue

```bash
agentos subtask create --title "Implement checkout validator" --json
agentos subtask create --title "Integration tests" --json
# Save IDs from the JSON output, then:
agentos subtask depend --id TEST_TASK_ID --on VALIDATOR_TASK_ID
agentos subtask ready --json
agentos subtask blocked --json
agentos subtask complete --id VALIDATOR_TASK_ID --result "Validation done, unit tests green"
agentos subtask ready --json
agentos subtask complete --id TEST_TASK_ID --result "Integration tests passed"
# Optional correction:
agentos subtask undepend --id TEST_TASK_ID --on VALIDATOR_TASK_ID
```

Subtasks retain the existing `parentId` tree. `blockedBy` is an **independent dependency DAG**. Adding a self-dependency, cycle or parent/child dependency is rejected. Completing a blocked task or a parent with open children is rejected. `ready` lists open *leaf* tasks whose prerequisites have completed; `blocked` provides reasons. Old subtasks without `blockedBy` remain valid. Mutations use the existing per-project file lock and atomic JSON writes. **This is not a multi-agent lease/claim scheduler**; two independent agents should still coordinate who takes which task.

## 4. Persistent facts and decisions

```bash
agentos memory add --kind fact --text "App uses PostgreSQL" --tags database,backend --source README
agentos memory add --kind decision --text "Use Zod for checkout request validation" --tags checkout --source "team-design"
agentos memory list --json
agentos memory list --kind decision --json
agentos memory search --query checkout --json
agentos memory get --id MEMORY_ID --json
```

Entries are bounded, source-labeled, stored under `.ai/memory/` and survive `end` and new sessions. Search is **lexical**, not embedding/semantic AI search. A short memory digest is included in Handoff exports. Memories are recorded assertions; verify important facts against source code/tests before acting. By design, `.ai/memory/` can be committed explicitly to Git after privacy review; AgentOS itself performs **no automatic commit or sync**.

## 5. A→B agent handoff

Agent A:

```bash
agentos session capture --kind decision --text "Keep API stable; updated validation only"
agentos session capture --kind next --text "Test invalid and missing fields"
agentos checkpoint
agentos end
```

Agent B, in a **fresh conversation with the same project folder**:

```bash
agentos resume --json
agentos session timeline --json
agentos subtask ready --json
agentos memory search --query validation --json
agentos context --query validation --max-tokens 2000 --json
agentos start
```

Via MCP the second agent can read the `agentos://handoff` resource and use `agentos_handoff`. It still needs to verify Git changes. **Checkpoints do not back up unsaved/uncommitted source content.**

## Current limits and verification

- This release includes the four mechanisms and supports existing CLI behavior. Linux tests confirm compatibility.
- Windows / macOS **exact v1.2.0 TGZ smoke** must be verified independently before a broad support claim.
- Integration with real Claude/Codex/Cursor MCP clients, true independent-agent handoff and outcome/usage benchmarks still need field testing.
- Session capture is agent-assisted / explicitly opt-in JSONL, not universal transcript extraction.
- Beads-style claiming, distributed synchronization, dependency formulas and event-derived automatic priority are **not** included.
- The bundled code AST/SCIP/Tree-sitter analyzers retain their prior limitations.
