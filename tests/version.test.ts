import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('CLI --version and version agree with root package.json', () => {
  const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version;
  for (const arg of ['--version', 'version', '-v']) {
    const out = spawnSync(process.execPath, [resolve('dist/src/cli.js'), arg], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout.trim(), version);
  }
});
