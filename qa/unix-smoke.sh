#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 1 ]] || { echo 'Usage: qa/unix-smoke.sh /path/to/package.tgz'; exit 2; }
tgz="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
root="$(mktemp -d)"; trap 'rm -rf "$root"' EXIT
npm install --prefix "$root/install" --offline --ignore-scripts --no-audit --no-fund "$tgz" >/dev/null
bin="$root/install/node_modules/.bin/shimi"
[[ -x "$bin" ]] || { echo 'SHIMI binary missing'; exit 1; }
"$bin" --version
repo="$root/project with spaces"; mkdir -p "$repo"; git -C "$repo" init -q
printf 'export const value=1;
' > "$repo/test.ts"
"$bin" init --cwd "$repo" --json >/dev/null
printf '# Task
Review test.ts.
' > "$repo/.ai/AI_TASK.md"
"$bin" pack --cwd "$repo" --json >/dev/null
"$bin" context --cwd "$repo" --symbol value --json >/dev/null
printf 'SHIMI Linux/macOS smoke passed
'
