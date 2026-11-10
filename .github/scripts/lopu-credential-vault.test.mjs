import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./lopu-credential-vault.mjs', import.meta.url), 'utf8');

test('vault client signs exact bodies, pins HTTPS, masks values, and bounds the waterfall', () => {
  assert.match(source, /createHmac\('sha256', secret\)\.update\(body, 'utf8'\)/u);
  assert.match(source, /origin\.protocol !== 'https:'/u);
  assert.match(source, /::add-mask::\$\{row\.value\}/u);
  assert.match(source, /MAX_CREDENTIALS = 8/u);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/u);
});

test('vault cache is scoped to the exact run attempt and written mode 0600', () => {
  assert.match(source, /parsed\.runId !== process\.env\.GITHUB_RUN_ID/u);
  assert.match(source, /parsed\.runAttempt !== process\.env\.GITHUB_RUN_ATTEMPT/u);
  assert.match(source, /mode: 0o600/u);
  assert.match(source, /chmod\(file, 0o600\)/u);
  assert.match(source, /process\.argv\[2\] === 'needles'/u);
});
