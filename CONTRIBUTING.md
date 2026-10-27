# Contributing to SHIMI

Thanks for helping make cross-agent coding less painful! Bug reports, docs fixes, compatibility test results, and reproducible examples are especially useful during the beta.

## Before opening an issue

- Search existing issues to avoid duplicates.
- Include `shimi --version`, OS, Node version, the exact command, and a minimal reproduction.
- **Remove all tokens, environment variables, usernames, proprietary source, real user paths, and private `.ai/` exports.** Handoffs and context packs may contain source.

## Development

1. Fork the repository and create a descriptive branch.
2. Install dev dependencies using `npm ci`.
3. Run `npm run build` and relevant tests before opening a PR.
4. Add tests for bug fixes and important behavior changes. Keep CLIs non-destructive by default.
5. Keep the core local-only, AI-independent and model-agnostic. Do not add telemetry or remote service calls without explicit opt-in design review.
6. Document backwards compatibility when changing `.ai/` data formats, CLI flags, Skills or MCP tool IDs.

## Beta priorities

- Native Windows/macOS install tests from the **exact** tarball.
- Real agent-to-agent trials with Claude Code, Codex and Cursor.
- Clearer zero-friction onboarding and fewer required commands.
- Validation of bundled WASM supply chain provenance and license compliance.
- Honest, measurable handoff reliability benchmarks.

By participating, you agree to collaborate respectfully and assume good intent. Maintainers may remove abusive or unsafe content.
