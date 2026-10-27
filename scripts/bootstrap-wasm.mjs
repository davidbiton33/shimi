/**
 * AgentOS Tree-sitter WASM bootstrap (Windows-safe verified in v0.8.1).
 *
 * Pins and downloads the build-time WASM assets, vendors them locally,
 * and runs strict real-parser integration tests. No runtime downloads.
 *
 * IMPORTANT: subprocess arguments are passed as an array with shell:false.
 * Windows paths such as C:\Program Files\nodejs\node.exe and Unicode user
 * directories are passed to the OS as file paths, not unquoted shell text.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve('.');
const workspace = mkdtempSync(join(tmpdir(), 'agentos-tree-sitter-bootstrap-'));

function findNpmCli() {
  // npm run sets npm_execpath on Windows, macOS and Linux. It points to the
  // real JS entrypoint of npm, and can safely be executed with process.execPath.
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ].filter(Boolean);
  return candidates.find((candidate) => isAbsolute(candidate) && existsSync(candidate));
}

function runNode(argv, cwd = projectRoot) {
  console.log('>', JSON.stringify([process.execPath, ...argv]));
  const result = spawnSync(process.execPath, argv, {
    cwd,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`);
  }
}

try {
  const npmCli = findNpmCli();
  if (!npmCli) {
    throw new Error('Cannot find npm CLI. Run this command from the source folder using: npm run bootstrap:wasm');
  }
  runNode([
    npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund',
    '--no-package-lock', '--prefix', workspace,
    'web-tree-sitter@0.25.10', 'tree-sitter-wasms@0.1.13',
  ]);

  const modules = join(workspace, 'node_modules');
  runNode([
    'scripts/vendor-tree-sitter.mjs',
    join(modules, 'web-tree-sitter'),
    join(modules, 'tree-sitter-wasms', 'out'),
  ]);

  runNode([npmCli, 'run', 'test:wasm']);
  console.log('SUCCESS: Tree-sitter WASM real-parser integration tests passed.');
} catch (error) {
  console.error('WASM bootstrap or verification failed:', error);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
