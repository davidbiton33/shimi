# Security and privacy review — AgentOS v0.3

## Privacy model

AgentOS is **local-first** and sends no telemetry and no model requests by itself. It executes `git`; the context packer itself runs inside AgentOS using Node.js APIs. It may produce source-containing pack files under `.ai/packs` and a combined handoff under `.ai/exports`. These files must be treated as confidential repository material. Sharing/uploading an export to a hosted AI tool **is a separate action controlled by the developer**.

## Threat model

- Accidentally packing `.env`, private keys or secrets into a file shared externally.
- Prompt injection inside repository text, including agent rule files and source comments.
- Malicious Git executable in `PATH`, and possible symlink-to-regular-file races during concurrent filesystem changes.
- Filesystem access of background process, particularly on shared multi-user machines.
- Corrupt/malicious `agentos.yml` or overwritten human-authored instruction files.
- Broken process lifecycle causing stale PID records.

## Controls implemented

- Nonce-scoped watcher leases, cooperative stop requests and project-scoped atomic directory locks (v0.2).

- Never invokes a model or a browser; no telemetry, network client, or credential store.
- Uses child process with fixed binary and argument array, not `shell: true`.
- Filters sensitive file paths and directories, hard-denies symlinks at each path component, rejects binary and invalid UTF-8 data, and redact lines matching several credential signatures.
- Generated packs, checkpoints, journal, runtime and exports are `.gitignore`d by default; generated state files are written with restrictive mode on initial creation.
- Managed blocks preserve unmanaged instruction text and refuse corrupt markers.
- Validated, intentionally narrow YAML config syntax, with upper bounds on poll/checkpoint settings and packer size limits.
- `.ai/` itself never becomes a recursive input to a generated code pack.
- No automatic Git mutation or remote push.

## Important limitations

- Path filtering and regex-based redaction **cannot guarantee** that a secret never appears in an ordinary source file, code comment or task note. `.ai/exports/handoff.md` concatenates human-edited context and task files and is not globally redacted. Review every file before sharing with external AI services.
- The packer has no runtime npm dependencies; Git is still an external executable. Avoid running on untrusted repositories without reviewing their contents.
- Generated agent instruction files can influence external AI systems that choose to read them; review files and never treat them as a permission boundary.
- v0.2 uses a nonce-bound cooperative watcher stop request and heartbeat rather than signalling a potentially reused PID. This avoids killing unrelated processes; however a stalled watcher may remain alive beyond the CLI timeout, in which case `agentos end` returns a warning.
- The per-project lock prevents ordinary concurrent writes but stale-lock reclamation on unreliable/network filesystems has residual race conditions. Do not share one working tree for simultaneous writers across remote hosts.
- `agentos init` preserves arbitrary unmanaged file content, but its own generated managed blocks are overwritten when re-synced; review changes before committing.
- There is no encryption-at-rest or built-in secure delete; protect the local folder with OS permissions.

## Additional caveat

The file read sequence uses lstat/realpath/read and is vulnerable to a narrow concurrent swap (TOCTOU); AgentOS does not claim a security sandbox. No encryption-at-rest; generated files are ignored by Git but still readable to local users with filesystem permission.

## Reporting

Do not include private repository code, API keys or packed exports in public bug reports. Reproduce issues with a synthetic repository.
