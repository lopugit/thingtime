import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/codeql-analysis.yml', import.meta.url), 'utf8');
const helper = workflow.split("<<'CODEQL_RECOVERY'\n")[1].split('          CODEQL_RECOVERY')[0].split('\n').map(line => line.replace(/^ {10}/u, '')).join('\n');
const program = helper.replace(/^import .*;\n/gmu, '');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const start = 1700000000000;
const sha = 'a'.repeat(40);
const response = (body, status = 200, headers = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: name => headers[name] ?? null }, json: async () => { if (body === 'invalid-json') throw Error('bad JSON'); return body; } });
const quota = (core = 1000, upload = 1000, reset = (start / 1000) + 300) => ({ resources: {
  core: { remaining: core, reset }, code_scanning_upload: { remaining: upload, reset }
} });

async function execute(mode, responses, overrides = {}) {
  let time = start;
  const calls = [], waits = [], logs = [];
  const files = { '/temp/codeql-sarif/deadline': String(start + 65 * 60000) };
  const env = { RUNNER_TEMP: '/temp', GH_TOKEN: 'synthetic-secret-canary', GITHUB_REPOSITORY: 'lopugit/thingtime',
    SARIF_ID: 'accepted-123', ANALYSIS_SHA: sha, ANALYSIS_REF: 'refs/pull/1497/merge', CATEGORY: '/language:actions', ...overrides };
  const fetch = async (url, options) => {
    calls.push({ url, options, time });
    const result = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (result instanceof Error) throw result;
    return result;
  };
  const clock = class extends Date { static now() { return time; } };
  const keys = ['readFileSync', 'writeFileSync', 'readdirSync', 'lstatSync', 'createHash', 'execFileSync', 'join', 'sleep', 'process', 'Date', 'fetch', 'console'];
  const values = [path => files[path], (path, value) => { files[path] = value; }, () => ['upload.sarif'], () => ({ isFile: () => true }), createHash, () => sha, join,
    async delay => { waits.push(delay); time += delay; }, { argv: ['', '', mode], env }, clock, fetch, { log: value => logs.push(value) }];
  if (mode === 'evidence') for (const sub of ['raw', 'processed']) files[`/temp/codeql-sarif/${sub}/upload.sarif`] = Buffer.from(JSON.stringify({ runs: [{ tool: { driver: { name: 'CodeQL' } } }] }));
  let error;
  try { await new AsyncFunction(...keys, program)(...values); } catch (caught) { error = caught; }
  return { calls, waits, logs: logs.join('\n'), files, error, elapsed: time - start };
}

test('actual workflow program waits for actual core and upload reset, then dispatches once', async () => {
  const result = await execute('quota', [response(quota(0, 0)), response(quota())]);
  assert.ifError(result.error);
  assert.deepEqual(result.waits, [305000]);
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[1].time - start, 305000);
});

test('quota unknown or malformed cannot authorize upload, and reset beyond budget fails', async () => {
  for (const body of [{}, quota('1000', 1000), quota(0, 0, start / 1000 + 7200)]) {
    const result = await execute('quota', [response(body)]);
    assert.match(result.error.message, /deadline elapsed/u);
    assert.equal(result.elapsed, 65 * 60000);
    assert.ok(result.calls.length <= 67);
  }
});

// The real job recorded these core values. Its projected upload nulls cannot
// distinguish absence from malformed fields; this fixture combines those core
// values with the documented optional-family omission, not captured raw JSON.
const observedBuiltinTokenQuota = { resources: {
  core: { limit: 5000, remaining: 4187, reset: 1794586145 }
} };

test('documented missing upload bucket with recorded core values reaches the official uploader', async () => {
  const result = await execute('quota', [response(observedBuiltinTokenQuota)]);
  assert.ifError(result.error);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.waits, []);
  assert.match(result.logs, /quota is not advertised/u);
});

test('missing optional upload bucket never weakens the required core or authoritative header gate', async () => {
  const reset = start / 1000 + 120;
  const result = await execute('quota', [
    response({ resources: { core: { remaining: 0, reset } } }),
    response(observedBuiltinTokenQuota)
  ]);
  assert.ifError(result.error);
  assert.deepEqual(result.waits, [125000]);
  const headers = await execute('quota', [
    response(observedBuiltinTokenQuota, 200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
    response(observedBuiltinTokenQuota)
  ]);
  assert.ifError(headers.error);
  assert.deepEqual(headers.waits, [125000]);
  for (const core of [undefined, null, {}, { remaining: '4187', reset }, { remaining: 4187, reset: null }]) {
    const invalid = await execute('quota', [response({ resources: { core } })]);
    assert.match(invalid.error.message, /deadline elapsed/u);
  }
});

test('an advertised upload bucket remains mandatory even when malformed or exhausted', async () => {
  for (const upload of [null, {}, [], 0, 'unavailable', { remaining: null, reset: null },
    { remaining: '1', reset: start / 1000 + 120 }, { remaining: 1, reset: 'invalid' },
    { remaining: -1, reset: start / 1000 + 120 }]) {
    const result = await execute('quota', [response({ resources: { core: observedBuiltinTokenQuota.resources.core, code_scanning_upload: upload } })]);
    assert.match(result.error.message, /deadline elapsed/u);
    assert.doesNotMatch(result.logs, /not advertised/u);
  }
  const exhausted = await execute('quota', [response(quota(1000, 0)), response(quota())]);
  assert.ifError(exhausted.error);
  assert.deepEqual(exhausted.waits, [305000]);
});

test('processing only succeeds after returned receipt is complete and never POSTs', async () => {
  const result = await execute('processing', [response({ processing_status: 'pending' }), response({ processing_status: 'complete' })]);
  assert.ifError(result.error);
  assert.equal(JSON.parse(result.files['/temp/codeql-sarif/receipt.json']).status, 'complete');
  assert.ok(result.calls.every(call => call.url.endsWith('/sarifs/accepted-123') && !call.options.method));
  assert.deepEqual(result.waits, [15000]);
});

test('safe receipt reads recover rate limits, Retry-After, 502, transport and invalid JSON', async () => {
  const result = await execute('processing', [
    response({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(start / 1000 + 120) }),
    response({}, 429, { 'retry-after': '90' }), response({}, 502), Error('private-canary'), response('invalid-json'),
    response({ processing_status: 'complete' })
  ]);
  assert.ifError(result.error);
  assert.deepEqual(result.waits.slice(0, 2), [125000, 90000]);
  assert.doesNotMatch(result.logs, /canary|synthetic|authorization/u);
  for (const call of result.calls) {
    assert.match(call.url, /^https:\/\/api\.github\.com\//u);
    assert.equal(call.options.redirect, 'error');
  }
});

test('failed, unauthorized, invalid, missing and never-completing receipts fail closed', async () => {
  for (const fixture of [response({ processing_status: 'failed', errors: ['private-canary'] }), response({}, 401), response({}, 403), response({ processing_status: 'unknown' }), response({ processing_status: 'pending' })]) {
    const result = await execute('processing', [fixture]);
    assert.ok(result.error);
    assert.notEqual(JSON.parse(result.files['/temp/codeql-sarif/receipt.json']).status, 'complete');
    assert.doesNotMatch(result.logs + result.error.message, /private-canary/u);
  }
  for (const env of [{ SARIF_ID: '' }, { SARIF_ID: '../foreign' }, { GITHUB_REPOSITORY: 'other/fork' }, { GH_TOKEN: '' }]) {
    const result = await execute('processing', [], env);
    assert.ok(result.error);
    assert.equal(result.calls.length, 0);
  }
});

test('evidence binds original bytes, ref, immutable source and category without credentials', async () => {
  const result = await execute('evidence', []);
  assert.ifError(result.error);
  const evidence = JSON.parse(result.files['/temp/codeql-sarif/source.json']);
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.ref, 'refs/pull/1497/merge');
  assert.equal(evidence.category, '/language:actions');
  assert.equal(evidence.files.length, 2);
  assert.match(evidence.files[0].sha256, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(evidence), /canary/u);
  assert.ok((await execute('evidence', [], { ANALYSIS_SHA: 'b'.repeat(40) })).error);
});

test('workflow retains exact evidence before one official upload, then requires strict processing', () => {
  assert.match(workflow, /timeout-minutes: 120/u);
  assert.equal((workflow.match(/upload: never/gu) || []).length, 2);
  assert.equal((workflow.match(/upload-database: false/gu) || []).length, 2);
  assert.equal((workflow.match(/uses: github\/codeql-action\/upload-sarif@4c0873ef8656cb3c50b3f42fb63bc1ade0cfa827/gu) || []).length, 1);
  assert.ok(workflow.indexOf('- name: Retain completed SARIF evidence') < workflow.indexOf('- name: Wait for live SARIF upload quota'));
  assert.ok(workflow.indexOf('- name: Wait for live SARIF upload quota') < workflow.indexOf('- name: Upload retained SARIF once'));
  const upload = workflow.split('- name: Upload retained SARIF once')[1].split('\n      - name:')[0];
  assert.match(upload, /ref: \$\{\{ needs\.scope\.outputs\.analysis_ref \|\| github\.ref \}\}/u);
  assert.match(upload, /sha: \$\{\{ needs\.scope\.outputs\.analysis_sha \|\| github\.sha \}\}/u);
  assert.match(upload, /wait-for-processing: false/u);
  assert.doesNotMatch(upload, /continue-on-error|token:/u);
  assert.match(workflow, /SARIF_ID: \$\{\{ steps\.sarif_upload\.outputs\.sarif-id \}\}/u);
  assert.doesNotMatch(helper, /sentinel|POST|PUT/u);
});

// GitHub adds success() to step conditions without a status function. Pin that
// boundary: an archive, quota or upload failure must suppress downstream work.
test('upload and quota remain gated by successful prior steps and real analysis', () => {
  for (const name of ['Wait for live SARIF upload quota', 'Upload retained SARIF once']) {
    const block = workflow.split(`      - name: ${name}\n`)[1].split('\n      - name:')[0];
    assert.match(block, /if: steps\.analyze_trigger\.outcome == 'success' \|\| steps\.analyze_exact\.outcome == 'success'/u);
    assert.doesNotMatch(block, /always\(|failure\(|cancelled\(|continue-on-error/u);
  }
  assert.match(workflow, /name: \$\{\{ inputs\.quota_only && format\('Quota-only dispatch \(\{0\}\)', matrix\.language\) \|\| format\('Analyze \(\{0\}\)', matrix\.language\) \}\}/u);
});
