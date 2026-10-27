# SHIMI security policy

SHIMI handles source code, task state, and agent-visible context. Treat these as sensitive. Do **not** report security vulnerabilities by posting working exploits or credentials in public issues.

## Beta safety model

- No built-in AI model, outbound analytics, server endpoint or network listener is required by SHIMI core.
- MCP uses local **stdio**, under your existing agent client's security/permission model.
- SHIMI `evidence run` explicitly executes project-defined commands. Read the manifest and trust the project before allowing it.
- Local Handoff/Context output may contain proprietary source. The secret redaction filter is **best effort only**.
- Checkpoint records are metadata, **not code backups**. Use Git/backup practices before agent changes.
- Browser/agent instruction files created by `setup` should be inspected before sharing a repository.
- External SCIP indexers, installed separately, may run project build scripts and access the network.

## Reporting

Until a maintainer-controlled private vulnerability-reporting channel is configured on GitHub, **do not include secrets or exploit details in a public issue**. You may open a public, non-sensitive issue requesting a private contact route, or use GitHub's private vulnerability reporting when the repository enables it.

Supported version: the current public beta candidate only; no guaranteed response SLA. Earlier AgentOS builds were local development releases.
