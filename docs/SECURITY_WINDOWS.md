# Security and Windows validation: 0.8.12-rc.2

The v0.8.12-rc.1 packer allowed `.ai/packs` to be a symlink to a location outside the repository, causing generated packs and manifests to be written there. The exploit was reproduced in a temporary repository. The security fix validates *every existing component* of project-owned `.ai` paths and editor-adapter paths with `lstatSync`, rejects symlinks, and refuses traversal outside the chosen root. Existing files do not need migration.

Security boundary: The chosen repository root is assumed to be a directory trusted by the user. This change prevents ordinary symlink redirects within that root; it is not an atomic guarantee against a malicious **concurrent local process** that continually replaces directories after validation (TOCTOU). It is also not a sandbox for untrusted code; do not point AgentOS at a hostile repository without appropriate OS isolation.

Windows native test is **not executed** in the Linux build environment. Run `qa/windows-smoke.ps1` with `-PackagePath <local-tgz>` on Windows PowerShell 5.1+ or PowerShell 7+, with Node.js >=20, npm and Git. It creates and cleans its own temporary repo and checks offline install, CLI version, init/pack/explain/doctor and bundled WASM grammars.

Dependency audit used `npm audit --offline`; this reports no known issues **in locally cached advisories** only. For release, run a live, current-registry dependency scan and separate legal/provenance review of bundled third-party Tree-sitter grammars and WASM assets. No OS-native Windows test or macOS test was completed in the Linux environment.

The published npm artifact excludes test fixtures (including synthetic test secrets); the source archive retains all unit tests. Source file redaction and ignore rules are defense-in-depth, not a substitute for checking the generated context before external sharing. `pack` never uploads content by itself.
