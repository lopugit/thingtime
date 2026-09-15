import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Execute the exact checked-in loader shell with a fixture HTTP response.
// No credentials, provider requests, or live settings writes are involved.
for (const workflow of ['resolve-pr-conflicts', 'rebase-pr-stacks', 'all-branch']) {
  const source = readFileSync(new URL(`../workflows/${workflow}.yml`, import.meta.url), 'utf8');
  const endpoint = source.indexOf('https://thingtime.com/api/v1/settings/pr-conflict-auto-resolver-model-waterfall');
  const start = source.lastIndexOf('        run: |\n', endpoint) + '        run: |\n'.length;
  const output = source.indexOf('echo "model_args=', endpoint);
  const end = source.indexOf('\n', output);
  const script = source.slice(start, end).replace(/^          /gm, '');
  assert.ok(endpoint > 0 && output > endpoint);
  const run = (waterfall, failFetch = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-order-'));
    try {
      writeFileSync(join(dir, 'response.json'), JSON.stringify({ ok: true, key: 'Thingtime.PRConflictAutoResolverModelWaterfall', waterfall }));
      writeFileSync(join(dir, 'out'), '');
      writeFileSync(join(dir, 'curl'), '#!/bin/sh\n[ "$FAIL_FETCH" != "1" ] || exit 22\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = "--output" ]; then cp "$RUNNER_TEMP/response.json" "$2"; exit 0; fi\n shift\ndone\nexit 1\n', { mode: 0o700 });
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_OUTPUT: join(dir, 'out'), FAIL_FETCH: failFetch ? '1' : '0' } });
      return { ...result, output: readFileSync(join(dir, 'out'), 'utf8') };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  test(`${workflow}: executes exactly the configured compatible model order`, () => {
    for (const [waterfall, args] of [
      [['claude-opus-5:high'], '--model claude-opus-5 --effort high'],
      [['claude-fable-5', 'claude-opus-5'], '--model claude-fable-5 --fallback-model claude-opus-5 --effort max'],
      [['default', 'claude-opus-5'], '--model default --fallback-model claude-opus-5 --effort max'],
      [['claude-opus-5', 'default'], '--model claude-opus-5 --fallback-model default --effort max']
    ]) {
      const result = run(waterfall);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.output, `model_args=${args}\n`);
    }
  });
  test(`${workflow}: unusable settings never select an unconfigured model`, () => {
    for (const waterfall of [[], ['gpt-5.6-sol'], ['--tools=Bash'], ['claude-opus-5:high:low'], ['claude-opus-5', 'claude-opus-5'], Array.from({length: 60}, (_, i) => `claude-${'a'.repeat(40)}${i}`)]) {
      const result = run(waterfall);
      assert.notEqual(result.status, 0);
      assert.equal(result.output, '');
    }
    assert.notEqual(run(['claude-opus-5'], true).status, 0);
  });
}
