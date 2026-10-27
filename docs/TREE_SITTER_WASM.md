# Tree-sitter WASM — v0.8.1 verified local runtime

**Status: genuine runtime and eleven language grammars are bundled.** Strict integration tests passed under Node.js 22 in Linux, including named function-body extraction for Python, Go, Java, C#, Rust, Kotlin, Dart, PHP, Ruby, C and C++. They have not yet been validated on Windows/macOS for this package.

The upstream `web-tree-sitter@0.25.10` runtime and `tree-sitter-wasms@0.1.13` binaries were obtained in a user-supplied Windows bootstrap. They are checked against `asset-manifest.json` SHA-256 digests at initialization. The CLI never downloads code or executes repository code. The archive ships prebuilt WASM and JS loader; `npm install` of these modules is **not needed at runtime**.

## Actual upstream filenames
The pinned web-tree-sitter 0.25.10 npm package exposes `tree-sitter.js`, `tree-sitter.wasm`, `LICENSE`, not the old bridge's assumed `web-tree-sitter.js` and `web-tree-sitter.wasm`. The vendoring script fixes this mismatch. Grammar files are named `tree-sitter-python.wasm`, `tree-sitter-go.wasm`, etc.

## Developer-only bootstrap on network-enabled machine

```bash
npm install  # development dependency setup, not required for installed CLI
npm run bootstrap:wasm
# IMPORTANT: command must finish with all strict real-parser tests PASS
npm test
npm pack
```

The build bootstrap installs **pinned** `web-tree-sitter@0.25.10` and `tree-sitter-wasms@0.1.13` into a temporary directory with npm install scripts disabled. It copies and hashes the runtime and supported grammar assets into `vendor/tree-sitter`. It then performs actual parsing for eleven grammar languages. If binaries are missing, incompatible, or invalid, the strict check exits nonzero. Grammar `.wasm` binaries from `tree-sitter-wasms` may be built with older tooling and **may be incompatible** even with 0.25.10; an ABI/dynamic-linking failure is a blocker, not a reason to silence the test.

The `vendor:wasm` command supports packages supplied offline in local `node_modules`. The production CLI does not download assets or execute `npm`.

## Scope
With bundled assets verified, the registry uses a real typed Tree-sitter CST/AST-style syntax tree to identify declarations in supported grammar languages, while the existing language-neutral dependency binder remains conservative. AST syntax trees are NOT full semantic type-checker resolution.

## Security and licenses
- Source code from the target project is parsed, not executed.
- Vendored WASM files are checked for magic/version bytes and bounded size. The asset manifest lists SHA-256 digests for audit and reproducibility.
- Grammar licenses vary by upstream project. **Review and include each grammar's license before publishing a WASM-containing distributable.** A license from a binary aggregator alone is not enough.
- Vendor files must come from trusted upstream archives and pass strict tests before a release can claim Tree-sitter support.

## Validation commands

```bash
agentos parsers --json
npm run test:wasm   # MUST fail without actual, compatible WASM assets
```

The CLI reports `treeSitter.enabled=false` when no verified grammar was loaded. Baseline tests are not substitutes for this test. The strict suite is required for this release.

## Known limits
- Parser support does not imply runtime symbol/type resolution, and dynamic imports/reflection are outside scope.
- Some edited or invalid code triggers the conservative structural fallback (reported via `parser`).
- Asset manifest SHA-256 provides consistency with the bootstrap artifact, not cryptographic proof of upstream provenance.
- **Public redistribution must wait until the actual upstream grammar licenses have been verified and included**; the upload contains only the web-tree-sitter runtime license, not each grammar license.

