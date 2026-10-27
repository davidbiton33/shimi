# AgentOS v1.3.0 — Agent Skills and project-scoped MCP installation

Two new CLI commands make AgentOS discoverable and callable by coding agents.

## Quick start (run in the root of an initialized project)

```bash
agentos init             # Only for a project not initialized already
agentos rules            # Synchronize AGENTS.md / CLAUDE.md / editor rules
agentos skill install --dry-run
agentos skill install --client all
agentos mcp install --dry-run
agentos mcp install --client all
```

`--client` accepts `claude`, `cursor`, `codex` or `all` (default). `--dry-run` reports intended file changes without writing. All commands accept `--cwd PATH` and `--json`.

## Files installed

| Client | SKILL.md | MCP project config |
|---|---|---|
| Claude Code | `.claude/skills/agentos/SKILL.md` | `.mcp.json` (`mcpServers.agentos`) |
| Cursor | `.cursor/skills/agentos/SKILL.md` | `.cursor/mcp.json` (`mcpServers.agentos`) |
| Codex | `.agents/skills/agentos/SKILL.md` | `.codex/config.toml` (`[mcp_servers.agentos]`) |

The skill teaches agents how to use the existing workflow: read task and project memory, request missing context, record decisions, check ready/blocked work, and hand off verified state. It is a document, not a tool and not an autonomous scheduler. MCP provides 9 existing local tools and 3 resources over standard stdio. The installer does not launch an agent and does not expose an HTTP port.

## Safety

- Installers write **only inside the initialized project**, never home/global client configs.
- `--dry-run` is useful before committing generated config files.
- Existing other MCP server settings remain intact. When an `agentos` entry or skill file exists but differs, the installer **fails without overwriting it**. Remove or migrate the conflicting setting yourself after reviewing.
- On `--client all`, the installer preflights all destinations before writing. Unexpected disk-write errors can still interrupt a multi-file installation; there is no transaction rollback.
- The agent/client must **trust the project**, and may ask permission before enabling a project-local MCP server. Restart/reload the client if it does not detect new skills/config.
- The `command` and executable path are recorded as absolute paths to the **currently installed** Node.js and AgentOS binary. Regenerate/review MCP config after moving the project between machines or changing the AgentOS install location. Do not assume the path will work in a remote/cloud agent environment.
- Codex only loads project-local `.codex/config.toml` when the project is trusted. Claude Code and Cursor use their own project rules for MCP authorization.
- Project files are untrusted. Review imported skills and MCP settings before running third-party repositories. MCP tools that write notes or memories do so only through explicit calls.

## Existing commands

`agentos mcp config --json` still prints a config snippet without writing it. `agentos mcp serve --cwd PROJECT` is the stdio server. `agentos rules` still generates lightweight always-on instructions, while `agentos skill install` provides an on-demand multi-step procedure.

## Validation

```bash
agentos --version
agentos skill install --client all --json
agentos mcp install --client all --json
agentos status --json
```

For client-specific validation, inspect the respective Skills list and MCP tools view. Request `agentos_status` (read-only), and check the result matches `agentos status --json`. Do not assume client-side discovery was tested merely because the configuration file was written.
