# AgentOS v1.0.0 — Release decision

**PRIVATE EVALUATION ONLY; PUBLIC STABLE NO-GO.**

The full 11-grammar Tree-sitter WASM distribution is preserved to avoid regressing the engine. The grammar-specific upstream license and binary build provenance audit is incomplete; do not publish on npm until resolved. macOS native smoke and official Java/Kotlin/.NET/Dart SCIP indexer matrix have not been completed.

Windows native test was completed for v0.8.22-rc.3, including official scip-typescript: 85 documents, 715 definitions, 2171 references, 25 relationships; the exact v1.0.0 bytes have not yet been smoke-tested on Windows.

There is no evidence of compiler-level semantic parity. This package is for evaluation, not public redistribution.
