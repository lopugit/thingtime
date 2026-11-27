import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/codeql-analysis.yml', import.meta.url), 'utf8');
const step = name => {
  const block = workflow.split(`      - name: ${name}\n`)[1]?.split(/\n      - name: |\n  [a-zA-Z0-9_-]+:\n/u)[0];
  assert.ok(block, `Missing workflow step ${name}`);
  return block;
};
const shell = name => step(name).split('        run: |\n')[1].split('\n').map(line => line.replace(/^ {10}/u, '')).join('\n').trim();
const names = ['Snapshot quota without analysis', 'Snapshot quota before Analyze', 'Snapshot quota after Analyze'];
const unknown = { limit: null, remaining: null, reset: null };
const sample = { resources: {
  core: { limit: 1000, remaining: 17, reset: 1794578400, used: 983 },
  code_scanning_upload: { limit: 1000, remaining: 0, reset: 1794580000 },
  graphql: { limit: 5000 }, unexpected: 'secret-canary'
}, token: 'secret-canary', private: 'secret-canary' };

function execute({ guard = false, env = {}, body = sample, exitCode = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-quota-diagnostic-'));
  try {
    const calls = join(dir, 'calls');
    const payload = join(dir, 'payload');
    writeFileSync(payload, typeof body === 'string' ? body : JSON.stringify(body));
    const executable = (name, content) => { const file = join(dir, name); writeFileSync(file, content); chmodSync(file, 0o755); };
    executable('gh', `#!/usr/bin/env node
const fs=require('node:fs');
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['api','rate_limit']))process.exit(99);
fs.appendFileSync(process.env.QUOTA_TEST_CALLS,'GET /rate_limit\\n');
process.stdout.write(fs.readFileSync(process.env.QUOTA_TEST_PAYLOAD));
process.exit(Number(process.env.QUOTA_TEST_EXIT));
`);
    executable('timeout', '#!/usr/bin/env bash\nshift 2\nexec "$@"\n');
    const script = (guard ? shell('Validate quota-only dispatch boundary') + '\n' : '') + shell(names[0]);
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        QUOTA_TEST_CALLS: calls, QUOTA_TEST_PAYLOAD: payload, QUOTA_TEST_EXIT: String(exitCode),
        EVENT_NAME: 'workflow_dispatch', REPO: 'lopugit/thingtime', SELECTED_REF: 'refs/heads/github-actions',
        QUOTA_ONLY: 'true', PR_NUMBER: '', EXPECTED_HEAD_SHA: '', BACKFILL_LISTENER_OWNED: 'false',
        GH_TOKEN: 'synthetic-never-transmitted', ...env }
    });
    assert.ifError(result.error);
    const count = (() => { try { return readFileSync(calls, 'utf8').trim().split('\n').length; } catch { return 0; } })();
    return { ...result, count };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('all three actual snapshot scripts are identical, bounded, same-job token reads', () => {
  for (const name of names) {
    assert.equal(shell(name), shell(names[0]));
    assert.match(step(name), /GH_TOKEN: \$\{\{ github\.token \}\}/u);
    assert.match(shell(name), /timeout --signal=TERM 30s gh api rate_limit/u);
    assert.doesNotMatch(shell(name), /\bwhile\b|\buntil\b|gh api.*--include|curl|--verbose/u);
  }
  assert.match(step(names[2]), /if: always\(\)/u);
  assert.match(step(names[1]), /continue-on-error: true/u);
  assert.match(step(names[2]), /continue-on-error: true/u);
  assert.doesNotMatch(step(names[0]), /continue-on-error/u);
});

test('quota-only is a typed manual-only mode with minimum permissions and no scan actions', () => {
  const triggers = workflow.split('\npermissions:')[0];
  const callable = triggers.split('  workflow_call:')[1].split('  pull_request:')[0];
  assert.doesNotMatch(callable, /quota_only/u, 'workflow_call cannot request the diagnostic mode');
  assert.match(triggers.split('  workflow_dispatch:')[1], /quota_only:\n[\s\S]*?default: false\n\s+type: boolean/u);
  const job = workflow.split('  quota-diagnostics:\n')[1].split('\n  scope:\n')[0];
  assert.match(job, /if: github\.event_name == 'workflow_dispatch' && inputs\.quota_only/u);
  assert.match(job, /permissions: \{\}/u);
  assert.doesNotMatch(job, /actions\/checkout|github\/codeql-action|security-events:|contents: write/u);
});

test('quota-mode skipped checks have disjoint names and cannot satisfy product Analyze contexts', () => {
  const scope = workflow.split('\n  scope:\n')[1].split('\n  analyze:\n')[0];
  const analyze = workflow.split('\n  analyze:\n')[1];
  assert.match(scope, /if: \$\{\{ !inputs\.quota_only \}\}/u);
  assert.match(analyze, /if: \$\{\{ !inputs\.quota_only && needs\.scope\.outputs\.analyze == 'true' \}\}/u);
  const formats = /name: \$\{\{ inputs\.quota_only && format\('([^']+)', matrix\.language\) \|\| format\('([^']+)', matrix\.language\) \}\}/u.exec(analyze);
  assert.ok(formats);
  for (const language of ['actions', 'javascript-typescript']) {
    assert.doesNotMatch(formats[1].replace('{0}', language), /^Analyze \(/u);
    assert.equal(formats[2].replace('{0}', language), `Analyze (${language})`);
  }
  assert.match(scope, /inputs\.quota_only && 'Quota-only dispatch \(no analysis owner\)' \|\| 'Select one analysis owner'/u);
  assert.match(workflow, /- name: Analyze the triggering revision\n[\s\S]*?uses: github\/codeql-action\/analyze@/u);
  assert.match(workflow, /- name: Analyze the exact centrally dispatched PR head\n[\s\S]*?uses: github\/codeql-action\/analyze@/u);
});

test('only the canonical manual dispatch with no analysis selection reaches the API', () => {
  const result = execute({ guard: true });
  assert.equal(result.status, 0);
  assert.equal(result.count, 1);
});

for (const env of [
  { EVENT_NAME: 'workflow_call' }, { EVENT_NAME: 'push' }, { EVENT_NAME: 'pull_request' },
  { REPO: 'someone/fork' }, { SELECTED_REF: 'refs/heads/main' }, { SELECTED_REF: 'refs/heads/codex/arbitrary-product-head' },
  { SELECTED_REF: 'refs/pull/1462/merge' }, { QUOTA_ONLY: 'false' }, { QUOTA_ONLY: '1' },
  { PR_NUMBER: '1462' }, { EXPECTED_HEAD_SHA: 'a'.repeat(40) }, { BACKFILL_LISTENER_OWNED: 'true' }
]) {
  test(`invalid quota-mode route fails before any probe: ${JSON.stringify(env)}`, () => {
    const result = execute({ guard: true, env });
    assert.equal(result.status, 1);
    assert.equal(result.count, 0);
    assert.match(result.stdout, /canonical controller ref and no analysis selection/u);
  });
}

test('actual shell emits only UTC and allowlisted distinct core/upload counters', () => {
  const result = execute();
  assert.equal(result.status, 0);
  assert.equal(result.count, 1);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(output).sort(), ['code_scanning_upload', 'core', 'observedUtc']);
  assert.match(output.observedUtc, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u);
  assert.deepEqual(output.core, { limit: 1000, remaining: 17, reset: 1794578400 });
  assert.deepEqual(output.code_scanning_upload, { limit: 1000, remaining: 0, reset: 1794580000 });
  assert.doesNotMatch(result.stdout, /secret-canary|synthetic-never-transmitted|graphql|used/u);
});

test('missing buckets and malformed counters remain unknown, never invented zero', () => {
  const result = execute({ body: { resources: { core: { limit: '1000', remaining: -1, reset: true } } } });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.core, unknown);
  assert.deepEqual(output.code_scanning_upload, unknown);
  const fractions = JSON.parse(execute({ body: { resources: { core: { limit: 0.5, remaining: 1e99, reset: null } } } }).stdout);
  assert.deepEqual(fractions.core, unknown);
});

for (const fixture of [{ body: '<html>secret-canary</html>' }, { exitCode: 124, body: 'secret-canary' }, { exitCode: 1, body: { message: 'secret-canary' } }]) {
  test(`unavailable probe reports only unknown counters and fails: ${JSON.stringify(fixture)}`, () => {
    const result = execute(fixture);
    assert.equal(result.status, 1);
    assert.equal(result.count, 1);
    assert.equal(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output.core, unknown);
    assert.deepEqual(output.code_scanning_upload, unknown);
    assert.doesNotMatch(result.stdout, /secret-canary/u);
  });
}
