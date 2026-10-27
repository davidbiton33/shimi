# SHIMI: migration from AgentOS

`1.6.0-beta.1` is the public-brand transition from AgentOS v1.5.0. The goal is to keep existing source state usable, **not** to silently rewrite all legacy files.

## What changes

- New CLI command: `shimi`. The `agentos` binary remains as a compatibility alias in the same package.
- New npm package metadata: `shimi-agent-cli` (not yet published to the registry).
- Fresh Skills are created in `.claude/skills/shimi/SKILL.md`, `.cursor/skills/shimi/SKILL.md`, `.agents/skills/shimi/SKILL.md`.
- Fresh project-local MCP entries are named `shimi` in `.mcp.json`, `.cursor/mcp.json` and `.codex/config.toml`.
- MCP server advertises itself as `shimi`, and resources now list `shimi://...`. The 14 MCP tool IDs **remain `agentos_*`** for backwards-compatible agent calls, and legacy `agentos://...` resource reads remain accepted.

## What does **not** change yet

- `.ai/`, `agentos.yml`, `.agentosignore`, `.agentos-evidence.json` and associated journal/checkpoint structure remain stable. This is intentional to retain existing projects and Git history.
- Some internal metadata keys and legacy adapter filenames still use `agentos`; these are implementation compatibility details.
- Existing user-edited rules, custom Skills and unrecognized MCP entries are never overwritten by the migration.

## Upgrading safely

1. Back up or commit your work before upgrading the CLI.
2. Install the release tarball and run `shimi --version`.
3. In your Git repository run `shimi setup --dry-run` and inspect the proposed files.
4. Run `shimi setup`, reload the supported clients, and verify their `shimi` MCP connection.
5. If a previous `.claude/skills/agentos`, `.cursor/skills/agentos` or `.agents/skills/agentos` Skill still exists, **review and remove it manually only if you own it and no longer need it**. The updater does not silently delete those files. They may otherwise appear alongside the new SHIMI Skill.
6. Your ordinary cycle is `shimi work`, `shimi switch` and `shimi continue`.

### Migration rules for MCP

- Existing project-local generated entries named `agentos` are migrated to `shimi` only if their shape and path are recognized by the installer.
- All unrelated MCP server entries are preserved.
- A custom/unrecognized `agentos` or `shimi` entry causes a safe failure, not an overwrite.
- Codex managed TOML blocks are migrated only when the existing block matches a recognizable generated command.

### Rollback

The persistent `.ai/` formats were not changed, and `agentos` remains a command alias. However, **existing MCP clients may need their prior settings restored** if you roll back to an older release. Save a copy of `.mcp.json`, `.cursor/mcp.json`, and `.codex/config.toml` before migration. No automatic rollback command is included in this beta.
