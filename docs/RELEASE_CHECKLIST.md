# Public beta release gate — SHIMI 1.6.0-beta.1

## Technical

- [ ] Core Node tests pass with zero failures; all skips explained and checked independently
- [ ] WASM, language and framework suites pass
- [ ] Exact SHIMI npm tarball clean install tested on Linux
- [ ] **Native Windows exact tarball** installed and tested, including `shimi switch` and `continue`
- [ ] Native macOS test or explicit unsupported warning
- [ ] Actual Claude→Codex (or equivalent) trial with no shared conversation history

## Privacy/security/license

- [ ] Source zip reviewed for API keys, private URLs, real emails and personal data
- [ ] Test inputs/examples contain only synthetic or properly licensed data
- [ ] Bundled WASM upstream provenance checked and corresponding notices/licenses verified
- [ ] Avoid representing MIT root license as overriding third-party component licenses
- [ ] GitHub private vulnerability reporting enabled and maintainer policy confirmed

## Distribution/brand

- [ ] GitHub repository created by owner and public visibility approved
- [ ] CLI package name confirmed available and publisher identity authorized
- [ ] Stable ownership of npm package and npm publishing credentials established; prefer trusted publishing
- [ ] README quickstart tested from a GitHub release artifact
- [ ] Honest beta release notes, limitations and checksums uploaded
- [ ] Screenshots/GIF from a **real** demo (no invented success footage)

## Operational decision

Until the provenance, platform and owner permissions are resolved, treat the tarball as a **shareable beta candidate, not a formally published npm release**.
