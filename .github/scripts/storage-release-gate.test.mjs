import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkRuntimeLogs, checkStorageManifest, checkStorageReadiness, logLimit, monitor, productionOrigin as origin, readRuntimeLogs, requireStorageManifest, requireStorageReady, runtimeLogArgs, shouldPublishStatus, summarizeRuntimeLogs, waitForStorageReadiness } from './storage-release-gate.mjs';

const manifest = { schemaVersion: 1, origin, features: { 'api.health-nitro': { version: '1.3.0' }, 'api.storage-accounting': { version: '1.0.0' } }, operations: [{ feature: 'api.health-nitro', path: '/api/v1/health/nitro', methods: ['GET'] }] };
const health = { origin, targetOrigin: origin, service: 'nitro', ok: true, state: 'ready', storageAccounting: { state: 'ready', expectedVersion: 1 } };
test('only negotiated origin-specific healthy storage passes, including HTTP-200 degraded bodies', () => {
  assert.deepEqual(requireStorageReady(manifest, health, origin), { state: 'ready', accountingVersion: 1 });
  for (const patch of [{ ok: false }, { state: 'degraded' }, { storageAccounting: { state: 'migration-required', expectedVersion: 1 } }, { storageAccounting: { state: 'recovering', expectedVersion: 1, pending: true } }, { storageAccounting: null }, { origin: 'https://other.example' }, { targetOrigin: 'https://other.example' }]) assert.throws(() => requireStorageReady(manifest, { ...health, ...patch }, origin));
  for (const version of ['1.1.0', '2.0.0', '1.2.1-preview', null]) assert.throws(() => requireStorageReady({ ...manifest, features: { 'api.health-nitro': { version } } }, health, origin));
  assert.throws(() => requireStorageReady({ ...manifest, origin: 'https://other.example' }, health, origin));
});
test('recovering gets one bounded drain observer; stuck recovery and source migration never pass', async () => {
  let elapsed = 0, reads = 0;
  const wait = async (ms) => { elapsed += ms; };
  const check = async () => { if (++reads < 4) throw new Error('Storage release gate: storage-recovering'); return { state: 'ready' }; };
  assert.deepEqual(await waitForStorageReadiness(origin, { wait, now: () => elapsed, check }), { state: 'ready' });
  assert.equal(reads, 4); assert.equal(elapsed, 14_000);
  elapsed = 0; reads = 0;
  await assert.rejects(waitForStorageReadiness(origin, { wait, now: () => elapsed, check: async () => { reads++; throw new Error('Storage release gate: storage-recovering'); } }), /storage-recovery-deadline/);
  assert.equal(elapsed, 90_000); assert.equal(reads, 6);
  elapsed = 0; reads = 0;
  await assert.rejects(waitForStorageReadiness(origin, { wait, now: () => elapsed, check: async () => { reads++; throw new Error('Storage release gate: storage-not-ready'); } }), /storage-not-ready/);
  assert.equal(elapsed, 0); assert.equal(reads, 1);
});
test('premerge admits repaired 1.2.0 while new production candidates require 1.3.0 source readiness', () => {
  const previous = { ...manifest, features: { 'api.health-nitro': { version: '1.2.0' } } };
  assert.doesNotThrow(() => requireStorageReady(previous, health, origin));
  assert.throws(() => requireStorageReady(previous, health, origin, '1.3.0'));
  assert.doesNotThrow(() => requireStorageReady(manifest, health, origin, '1.3.0'));
});
test('candidate requires shared storage-accounting major 1 even with ready health 1.3', () => {
  for (const version of [undefined, '0.9.0', '2.0.0', '1.0.0-preview', 'invalid']) {
    const candidate = { ...manifest, features: { ...manifest.features, 'api.storage-accounting': { version } } };
    assert.throws(() => requireStorageReady(candidate, health, origin, '1.3.0'), /storage-capability-unavailable/);
    assert.doesNotThrow(() => requireStorageReady(candidate, health, origin, '1.2.0'));
  }
  for (const version of ['1.0.0', '1.0.1', '1.2.0']) {
    assert.doesNotThrow(() => requireStorageReady({ ...manifest, features: { ...manifest.features, 'api.storage-accounting': { version } } }, health, origin, '1.3.0'));
  }
});
test('discovery and health fail closed on redirects, HTML, unauthorized, invalid JSON and unavailable transport', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return Response.json(url.includes('.well-known') ? manifest : health); };
  await checkStorageReadiness(origin, { fetcher });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.redirect === 'error' && options.cache === 'no-store'));
  for (const response of [new Response('html'), new Response('{}', { status: 403 }), new Response('{', { headers: { 'content-type': 'application/json' } })]) await assert.rejects(checkStorageReadiness(origin, { fetcher: async () => response }));
  await assert.rejects(checkStorageReadiness(origin, { fetcher: async () => { throw new Error('private response'); } }), (error) => !error.message.includes('private'));
});
test('candidate manifest binds gateway identity and health operation without calling follower health', async () => {
  const gateway = { origin, environment: 'production', deploymentId: 'dpl_candidate' };
  const local = { ...manifest, gateway };
  const paths = [];
  await checkStorageManifest(origin, { gateway, fetcher: async (url) => {
    paths.push(new URL(url).pathname);
    if (!url.endsWith('/.well-known/thingtime-capabilities.json')) throw new Error('Follower health must not be called before promotion');
    return Response.json(local);
  } });
  assert.deepEqual(paths, ['/.well-known/thingtime-capabilities.json']);
  for (const patch of [{ origin: 'https://other.example' }, { environment: 'preview' }, { deploymentId: 'dpl_other' }]) assert.throws(() => requireStorageManifest({ ...local, gateway: { ...gateway, ...patch } }, origin, '1.3.0', gateway), /gateway-identity-mismatch/);
  for (const operations of [[], [{ feature: 'api.health-nitro', path: '/wrong', methods: ['GET'] }], [{ feature: 'api.health-nitro', path: '/api/v1/health/nitro', methods: ['POST'] }]]) assert.throws(() => requireStorageManifest({ ...local, operations }, origin, '1.3.0', gateway), /health-operation-unavailable/);
});
const options = { cli: '/verified/vercel', projectId: 'prj_test', deploymentId: 'dpl_test', scope: 'authorized-team', since: '2026-10-29T00:00:00.000Z', until: '2026-10-29T00:30:00.000Z' };
const emptySummary = () => ({
  records: 0, storageFailures: 0, errorRecords: 0, fatalRecords: 0, unknownSeverityRecords: 0,
  categories: { storage: 0, timeout: 0, memory: 0, exception: 0, database: 0, http5xx: 0, other: 0 }
});
const logRow = (patch = {}) => ({
  projectId: options.projectId, deploymentId: options.deploymentId, environment: 'production',
  timestamp: Date.parse(options.since), level: 'error', message: 'An operation failed', logs: [], ...patch
});
const jsonLines = (rows) => rows.map((row) => JSON.stringify(row)).join('\n');

test('runtime summary counts requests once when top-level severity repeats nested errors', () => {
  const message = 'TypeError: synthetic-private-account at https://private.example/secret?token=secret';
  const rows = [
    logRow({ message, logs: [{ level: 'error', message }, { level: 'error', message }] }),
    logRow({ level: 'fatal', message: 'heap out of memory', logs: [
      { level: 'info', message: 'private informational context' },
      { level: 'error', message }, { level: 'fatal', message: 'heap out of memory' }
    ] })
  ];
  const summary = summarizeRuntimeLogs(jsonLines(rows), options);
  assert.deepEqual(summary, {
    records: 2, storageFailures: 0, errorRecords: 1, fatalRecords: 1, unknownSeverityRecords: 0,
    categories: { storage: 0, timeout: 0, memory: 1, exception: 2, database: 0, http5xx: 0, other: 0 }
  });
  assert.deepEqual(summarizeRuntimeLogs(' \n\t\n', options), emptySummary());
});

test('runtime categories are a closed aggregate projection that never returns private provider fields', () => {
  const secret = 'synthetic-private-account-secret';
  const messages = [
    'STORAGE_ACCOUNTING_UNAVAILABLE', 'FUNCTION_INVOCATION_TIMEOUT', 'ERR_WORKER_OUT_OF_MEMORY',
    'ReferenceError', 'MongoNetworkError', 'HTTP request returned a server error', 'opaque provider error'
  ];
  const rows = messages.map((message, index) => logRow({
    message: message + ' ' + secret, responseStatusCode: index === 5 ? 503 : 200,
    requestId: secret, requestPath: '/private/' + secret, url: 'https://private.example/' + secret,
    headers: { authorization: 'Bearer ' + secret }, accountId: secret, stack: secret,
    arbitraryCategory: secret, logs: [{ level: 'error', message: message + ' ' + secret }]
  }));
  const summary = summarizeRuntimeLogs(jsonLines(rows), options);
  assert.deepEqual(summary, {
    records: 7, storageFailures: 1, errorRecords: 7, fatalRecords: 0, unknownSeverityRecords: 0,
    categories: { storage: 1, timeout: 1, memory: 1, exception: 1, database: 1, http5xx: 1, other: 1 }
  });
  assert.ok(!JSON.stringify(summary).includes(secret));
  for (const code of ['STORAGE_MIGRATION_REQUIRED', 'STORAGE_RECOVERY_BUSY', 'STORAGE_ACCOUNTING_UNAVAILABLE', 'STORAGE_INVARIANT']) {
    const row = logRow({ logs: [{ level: 'error', message: JSON.stringify({ source: 'storage-accounting', code }) }] });
    assert.equal(summarizeRuntimeLogs(JSON.stringify(row), options).storageFailures, 1);
  }
  for (const message of ['Account content requires storage migration before its ledger can be reconciled', 'Storage accounting requires recovery']) {
    assert.equal(summarizeRuntimeLogs(JSON.stringify(logRow({ message })), options).storageFailures, 1);
  }
});

test('missing and unknown severities stay explicitly unknown even alongside a known fatal record', () => {
  for (const level of [undefined, '', 'warning', 'info', 'emergency', 'ERROR']) {
    const summary = summarizeRuntimeLogs(JSON.stringify(logRow({ level })), options);
    assert.equal(summary.records, 1);
    assert.equal(summary.unknownSeverityRecords, 1, String(level));
  }
  const summary = summarizeRuntimeLogs(JSON.stringify(logRow({
    level: 'fatal', logs: [{ level: 'fatal', message: '' }, { level: 'unrecognized-provider-level', message: '' }]
  })), options);
  assert.equal(summary.fatalRecords, 1);
  assert.equal(summary.errorRecords, 0);
  assert.equal(summary.unknownSeverityRecords, 1);
});

test('pinned CLI nullable truncation metadata is accepted without masking actual truncation', () => {
  assert.equal(summarizeRuntimeLogs(JSON.stringify(logRow({
    message: '', messageTruncated: null, logs: [{ level: 'error', message: '', messageTruncated: null }]
  })), options).records, 1);
  for (const patch of [{ messageTruncated: true }, { logs: [{ level: 'error', message: '', messageTruncated: true }] }]) {
    assert.throws(() => summarizeRuntimeLogs(JSON.stringify(logRow(patch)), options), /log-message-truncated/);
  }
});

test('runtime parsing rejects malformed structure, saturated results and unverifiable scope', () => {
  for (const value of [undefined, null, {}, 'not json', 'null', '[]', '"private response"']) {
    assert.throws(() => summarizeRuntimeLogs(value, options), /log-response-invalid/);
  }
  for (const patch of [
    { logs: {} }, { logs: null }, { logs: [null] }, { logs: [[]] }, { logs: ['private log'] },
    { message: 123 }, { level: 123 }, { messageTruncated: 'false' },
    { logs: [{ level: 'error', message: {}, messageTruncated: false }] }
  ]) assert.throws(() => summarizeRuntimeLogs(JSON.stringify(logRow(patch)), options), /log-response-invalid/);
  for (const patch of [
    { deploymentId: 'dpl_other' }, { projectId: 'prj_other' }, { environment: 'preview' },
    { timestamp: null }, { timestamp: options.since },
    { timestamp: Date.parse(options.since) - 1 }, { timestamp: Date.parse(options.until) + 1 }
  ]) assert.throws(() => summarizeRuntimeLogs(JSON.stringify(logRow(patch)), options), /log-scope-mismatch/);
  assert.throws(() => summarizeRuntimeLogs(jsonLines(Array.from({ length: logLimit }, () => logRow())), options), /log-window-truncated/);
  assert.equal(summarizeRuntimeLogs(JSON.stringify(logRow({ timestamp: Date.parse(options.until) })), options).records, 1);
});

test('invalid log windows fail before invoking the provider and cannot silently skip timestamp validation', async () => {
  for (const window of [
    { since: 'invalid', until: options.until }, { since: options.since, until: 'invalid' },
    { since: options.until, until: options.since }, { since: options.since, until: options.since },
    { since: options.since, until: '2026-10-29T00:30:00.001Z' }
  ]) {
    let called = false;
    const scoped = { ...options, ...window };
    assert.throws(() => runtimeLogArgs(scoped), /invalid-log-window/);
    assert.throws(() => summarizeRuntimeLogs('', scoped), /invalid-log-window/);
    await assert.rejects(readRuntimeLogs(scoped, { runner: async () => { called = true; return { stdout: '' }; } }), /invalid-log-window/);
    assert.equal(called, false);
  }
});

test('pinned CLI queries exact deployment and window with credentials only in a scrubbed environment', async () => {
  const args = runtimeLogArgs(options);
  assert.deepEqual(args, [
    'logs', '--project', 'prj_test', '--deployment', 'dpl_test', '--environment', 'production', '--scope', 'authorized-team',
    '--since', options.since, '--until', options.until, '--level', 'error', '--level', 'fatal', '--limit', '500', '--json', '--no-follow'
  ]);
  const summary = await readRuntimeLogs(options, {
    environment: { VERCEL_API_TOKEN: 'synthetic-secret', GH_TOKEN: 'synthetic-github-secret', UNRELATED_SECRET: 'private' },
    runner: async (cli, actual, config) => {
      assert.equal(cli, options.cli); assert.deepEqual(actual, args);
      assert.equal(config.env.VERCEL_TOKEN, 'synthetic-secret');
      assert.equal(config.env.GH_TOKEN, undefined); assert.equal(config.env.UNRELATED_SECRET, undefined);
      assert.ok(!actual.includes('synthetic-secret')); assert.equal(config.timeout, 60_000);
      assert.equal(config.maxBuffer, 4 * 1024 * 1024);
      return { stdout: '' };
    }
  });
  assert.deepEqual(summary, emptySummary());
  for (const code of ['ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'EACCES']) {
    await assert.rejects(readRuntimeLogs(options, { runner: async () => {
      throw Object.assign(new Error('private provider stderr token'), { code, stderr: 'private provider body' });
    } }), { message: 'Storage release gate: runtime-log-access-unavailable' });
  }
});

test('publisher storage gate still accepts unrelated runtime errors while rejecting storage failures', async () => {
  const generic = logRow({ level: 'fatal', message: 'TypeError: unrelated operation failed' });
  const summary = await checkRuntimeLogs(options, { runner: async () => ({ stdout: JSON.stringify(generic) }) });
  assert.equal(summary.fatalRecords, 1);
  assert.equal(summary.storageFailures, 0);
  await assert.rejects(checkRuntimeLogs(options, { runner: async () => ({
    stdout: JSON.stringify(logRow({ message: 'STORAGE_INVARIANT' }))
  }) }), /runtime-storage-errors-1/);
  await assert.rejects(checkRuntimeLogs(options, { runner: async () => ({
    stdout: JSON.stringify(logRow({ deploymentId: 'dpl_other' }))
  }) }), /log-scope-mismatch/);
});

async function withMonitorFixture(work, summaryPath = '') {
  const environment = {
    GITHUB_REPOSITORY: 'lopugit/thingtime', GH_TOKEN: 'synthetic-gh', VERCEL_API_TOKEN: 'synthetic-vc',
    VERCEL_PROJECT_ID: 'prj_test', VERCEL_TEAM_ID: 'team_test', VERCEL_TEAM_SLUG: 'authorized-team',
    VERCEL_CLI_PATH: '/verified/vercel', GITHUB_STEP_SUMMARY: summaryPath
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const fixture = {
    healthy: true, rows: [], statuses: [], reports: [], calls: [], events: [], aliasReads: 0, logReads: 0,
    race: false, providerFailure: null, throwLogError: false, logError: null, summaryOverride: null,
    githubFailure: null, githubPostAttempts: 0,
    gateway: { origin, environment: 'production', deploymentId: 'dpl_test' },
    deployment: { id: 'dpl_test', projectId: 'prj_test', target: 'production', meta: { githubCommitRef: 'main', githubCommitSha: 'a'.repeat(40) } }
  };
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    const request = { host: url.hostname, path: url.pathname, method: init.method || 'GET' };
    fixture.calls.push(request);
    fixture.events.push({ type: 'request', ...request });
    if (url.hostname === 'api.github.com') {
      if (request.method === 'POST') fixture.githubPostAttempts++;
      const failure = fixture.githubFailure;
      if (failure && request.method === failure.method && (request.method !== 'POST' || fixture.githubPostAttempts === failure.at)) {
        if (Object.hasOwn(failure, 'throw')) throw failure.throw;
        return new Response('synthetic-private-provider-body', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
      }
    }
    if (fixture.providerFailure === url.hostname) return new Response('private provider response', {
      status: 403, headers: { 'x-ratelimit-remaining': '0' }
    });
    if (url.pathname === '/v4/aliases/thingtime.com') {
      fixture.aliasReads++;
      return Response.json({ deploymentId: fixture.race && fixture.aliasReads > 1 ? 'dpl_new' : 'dpl_test' });
    }
    if (url.pathname === '/v13/deployments/dpl_test') return Response.json(fixture.deployment);
    if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ ...manifest, gateway: fixture.gateway });
    if (url.pathname === '/api/v1/health/nitro') return Response.json({ ...health, ok: fixture.healthy });
    if (url.pathname.endsWith('/status')) {
      assert.equal(url.pathname, '/repos/lopugit/thingtime/commits/' + 'a'.repeat(40) + '/status');
      return Response.json({ statuses: [...fixture.statuses].reverse() });
    }
    if (url.pathname.includes('/statuses/') && init.method === 'POST') {
      assert.equal(url.pathname, '/repos/lopugit/thingtime/statuses/' + 'a'.repeat(40));
      fixture.statuses.push(JSON.parse(init.body)); return Response.json({});
    }
    throw new Error('Unexpected fixture path');
  };
  const runtimeLogs = async (scope) => {
    fixture.logReads++;
    assert.deepEqual(scope, options);
    if (fixture.throwLogError) throw fixture.logError;
    return fixture.summaryOverride || readRuntimeLogs(scope, { runner: async () => ({ stdout: jsonLines(fixture.rows) }) });
  };
  fixture.run = () => monitor({
    fetcher, runtimeLogs, now: () => Date.parse(options.until), report: (line) => {
      fixture.reports.push(line);
      fixture.events.push({ type: 'report', event: JSON.parse(line).event });
    }
  });
  fixture.latest = (context) => [...fixture.statuses].reverse().find((status) => status.context === context);
  fixture.observation = () => fixture.reports.map((line) => JSON.parse(line)).findLast((row) => row.event === 'production-runtime-monitor');
  fixture.delivery = () => fixture.reports.map((line) => JSON.parse(line)).findLast((row) => row.event === 'production-monitor-status-delivery');
  try { await work(fixture); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('monitor publishes separate exact-source statuses and deduplicates failures and recovery', async () => {
  await withMonitorFixture(async (fixture) => {
    const observed = await fixture.run();
    assert.deepEqual(observed, {
      event: 'production-runtime-monitor', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
      githubStatusDelivery: 'pending',
      window: { since: options.since, until: options.until },
      storage: { state: 'success', code: 'ready' },
      runtime: { state: 'success', code: 'ready', queryComplete: true, summary: emptySummary() }
    });
    assert.deepEqual(fixture.delivery(), {
      event: 'production-monitor-status-delivery', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
      state: 'delivered', code: 'ready', published: 2, unchanged: 0
    });
    await fixture.run();
    assert.equal(fixture.statuses.length, 2);
    assert.deepEqual(fixture.delivery(), {
      event: 'production-monitor-status-delivery', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
      state: 'delivered', code: 'ready', published: 0, unchanged: 2
    });
    fixture.rows = [logRow({ message: 'TypeError: failed generic operation' })];
    await assert.rejects(fixture.run(), /runtime-errors-1/);
    assert.equal(fixture.latest('Production storage runtime').state, 'success');
    assert.equal(fixture.latest('Production runtime errors').state, 'failure');
    assert.equal(fixture.observation().runtime.queryComplete, true);
    await assert.rejects(fixture.run(), /runtime-errors-1/);
    assert.equal(fixture.statuses.length, 3);
    fixture.rows = [];
    await fixture.run();
    assert.equal(fixture.statuses.length, 4);
    assert.equal(fixture.latest('Production runtime errors').state, 'success');
  });
});

test('unhealthy storage still queries runtime and reports both failures independently', async () => {
  await withMonitorFixture(async (fixture) => {
    fixture.healthy = false;
    fixture.rows = [logRow({ level: 'fatal', message: 'FUNCTION_INVOCATION_TIMEOUT' })];
    await assert.rejects(fixture.run(), /storage-not-ready/);
    assert.equal(fixture.logReads, 1);
    assert.equal(fixture.latest('Production storage runtime').state, 'failure');
    assert.equal(fixture.latest('Production runtime errors').state, 'failure');
    assert.equal(fixture.observation().storage.code, 'storage-not-ready');
    assert.equal(fixture.observation().runtime.code, 'runtime-errors-1');
    assert.equal(fixture.observation().runtime.queryComplete, true);
    fixture.rows = [];
    await assert.rejects(fixture.run(), /storage-not-ready/);
    assert.equal(fixture.logReads, 2);
    assert.equal(fixture.latest('Production runtime errors').state, 'success');
  });
});

test('storage runtime errors fail both contexts and recover without duplicate unchanged statuses', async () => {
  await withMonitorFixture(async (fixture) => {
    fixture.rows = [logRow({ message: 'STORAGE_RECOVERY_BUSY' })];
    await assert.rejects(fixture.run(), /runtime-storage-errors-1/);
    assert.equal(fixture.latest('Production storage runtime').state, 'failure');
    assert.equal(fixture.latest('Production runtime errors').state, 'failure');
    assert.equal(fixture.observation().runtime.summary.storageFailures, 1);
    assert.equal(fixture.observation().runtime.queryComplete, true);
    await assert.rejects(fixture.run(), /runtime-storage-errors-1/);
    assert.equal(fixture.statuses.length, 2);
    fixture.rows = [];
    await fixture.run();
    assert.equal(fixture.statuses.length, 4);
    assert.equal(fixture.latest('Production storage runtime').state, 'success');
    assert.equal(fixture.latest('Production runtime errors').state, 'success');
  });
});

test('missing or unknown severity cannot become a successful broad runtime observation', async () => {
  for (const row of [
    logRow({ level: undefined }),
    logRow({ level: 'warning' }),
    logRow({ level: 'fatal', logs: [{ level: 'secret-provider-severity', message: 'private' }] })
  ]) await withMonitorFixture(async (fixture) => {
    fixture.rows = [row];
    await assert.rejects(fixture.run(), /runtime-severity-unknown-1/);
    assert.equal(fixture.latest('Production runtime errors').state, 'error');
    assert.equal(fixture.observation().runtime.queryComplete, false);
    assert.equal(fixture.observation().runtime.summary.unknownSeverityRecords, 1);
    assert.ok(!fixture.reports.join('\n').includes('secret-provider-severity'));
  });
});

test('collector failures remain incomplete, never a clean empty window, even while storage is unhealthy', async () => {
  await withMonitorFixture(async (fixture) => {
    fixture.healthy = false;
    fixture.rows = [logRow({ messageTruncated: true })];
    await assert.rejects(fixture.run(), /storage-not-ready/);
    assert.equal(fixture.observation().runtime.code, 'log-message-truncated');
    assert.equal(fixture.observation().runtime.state, 'error');
    assert.equal(fixture.observation().runtime.queryComplete, false);
    assert.equal(fixture.observation().runtime.summary, null);
  });
});

test('monitor fences alias movement and returned deployment identity before reporting current results', async () => {
  await withMonitorFixture(async (fixture) => {
    fixture.race = true;
    await assert.rejects(fixture.run(), /production-advanced/);
    assert.equal(fixture.logReads, 1);
    assert.equal(fixture.statuses.length, 0); assert.equal(fixture.reports.length, 0);
    assert.ok(!fixture.calls.some((call) => call.host === 'api.github.com'));
  });
  for (const patch of [
    { id: 'dpl_other' }, { projectId: 'prj_other' }, { target: 'preview' },
    { meta: { githubCommitRef: 'develop', githubCommitSha: 'a'.repeat(40) } },
    { meta: { githubCommitRef: 'main', githubCommitSha: 'private-invalid-sha' } }
  ]) await withMonitorFixture(async (fixture) => {
    Object.assign(fixture.deployment, patch);
    await assert.rejects(fixture.run(), /production-deployment-identity-mismatch/);
    assert.equal(fixture.logReads, 0);
    assert.equal(fixture.statuses.length, 0); assert.equal(fixture.reports.length, 0);
    assert.ok(!fixture.calls.some((call) => call.host === 'api.github.com'));
  });
});

test('repository mismatch suppresses observations and GitHub requests after collecting fenced evidence', async () => {
  await withMonitorFixture(async (fixture) => {
    process.env.GITHUB_REPOSITORY = 'unrelated/repository';
    await assert.rejects(fixture.run(), /repository-mismatch/);
    assert.equal(fixture.aliasReads, 2);
    assert.equal(fixture.logReads, 1);
    assert.equal(fixture.reports.length, 0);
    assert.equal(fixture.statuses.length, 0);
    assert.ok(!fixture.calls.some((call) => call.host === 'api.github.com'));
  });
});

test('wrong health gateway cannot certify the snapshotted deployment while runtime evidence stays separate', async () => {
  for (const patch of [{ origin: 'https://other.example' }, { environment: 'preview' }, { deploymentId: 'dpl_other' }]) {
    await withMonitorFixture(async (fixture) => {
      Object.assign(fixture.gateway, patch);
      await assert.rejects(fixture.run(), /gateway-identity-mismatch/);
      assert.equal(fixture.logReads, 1);
      assert.equal(fixture.latest('Production storage runtime').state, 'failure');
      assert.equal(fixture.latest('Production runtime errors').state, 'success');
      assert.ok(!fixture.calls.some((call) => call.path === '/api/v1/health/nitro'));
    });
  }
});

test('Vercel identity lookup failure publishes neither observations nor statuses', async () => {
  await withMonitorFixture(async (fixture) => {
    fixture.providerFailure = 'api.vercel.com';
    await assert.rejects(fixture.run(), (error) => {
      assert.match(error.message, /http-403-rate-limit-exhausted/);
      assert.ok(!error.message.includes('private')); return true;
    });
    assert.equal(fixture.statuses.length, 0); assert.equal(fixture.reports.length, 0);
  });
});

test('verified observation survives a rate-limited GitHub status read without claiming delivery', async () => {
  await withMonitorFixture(async (fixture) => {
    fixture.githubFailure = { method: 'GET' };
    await assert.rejects(fixture.run(), { message: 'Storage release gate: github-http-403-rate-limit-exhausted' });
    const observation = fixture.observation();
    assert.equal(observation.githubStatusDelivery, 'pending');
    assert.equal(observation.sourceSha, 'a'.repeat(40));
    assert.equal(observation.deploymentId, 'dpl_test');
    assert.deepEqual(observation.window, { since: options.since, until: options.until });
    assert.deepEqual(observation.storage, { state: 'success', code: 'ready' });
    assert.deepEqual(observation.runtime, { state: 'success', code: 'ready', queryComplete: true, summary: emptySummary() });
    assert.deepEqual(fixture.delivery(), {
      event: 'production-monitor-status-delivery', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
      state: 'failed', code: 'github-http-403-rate-limit-exhausted', published: 0, unchanged: 0
    });
    assert.equal(fixture.statuses.length, 0);
    assert.equal(fixture.githubPostAttempts, 0);
    const observationIndex = fixture.events.findIndex((event) => event.type === 'report' && event.event === 'production-runtime-monitor');
    const lastAliasIndex = fixture.events.findLastIndex((event) => event.type === 'request' && event.path === '/v4/aliases/thingtime.com');
    const githubIndex = fixture.events.findIndex((event) => event.type === 'request' && event.host === 'api.github.com');
    const deliveryIndex = fixture.events.findIndex((event) => event.type === 'report' && event.event === 'production-monitor-status-delivery');
    assert.ok(lastAliasIndex >= 0 && lastAliasIndex < observationIndex);
    assert.ok(observationIndex < githubIndex && githubIndex < deliveryIndex);
    assert.ok(!fixture.reports.join('\n').includes('synthetic-private-provider-body'));
  });
});

test('failed first or second status POST preserves evidence and reports only confirmed publication counts', async () => {
  for (const at of [1, 2]) await withMonitorFixture(async (fixture) => {
    fixture.githubFailure = { method: 'POST', at };
    await assert.rejects(fixture.run(), { message: 'Storage release gate: github-http-403-rate-limit-exhausted' });
    assert.equal(fixture.observation().githubStatusDelivery, 'pending');
    assert.equal(fixture.observation().runtime.queryComplete, true);
    assert.deepEqual(fixture.delivery(), {
      event: 'production-monitor-status-delivery', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
      state: 'failed', code: 'github-http-403-rate-limit-exhausted', published: at - 1, unchanged: 0
    });
    assert.equal(fixture.githubPostAttempts, at);
    assert.equal(fixture.statuses.length, at - 1);
    assert.ok(!fixture.reports.join('\n').includes('synthetic-private-provider-body'));
    if (at === 2) {
      fixture.githubFailure = null;
      await fixture.run();
      assert.equal(fixture.statuses.length, 2);
      assert.deepEqual(fixture.delivery(), {
        event: 'production-monitor-status-delivery', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
        state: 'delivered', code: 'ready', published: 1, unchanged: 1
      });
    }
  });
});

test('GitHub delivery failure retains unhealthy storage and incomplete runtime evidence independently', async () => {
  for (const incomplete of [false, true]) await withMonitorFixture(async (fixture) => {
    fixture.githubFailure = { method: 'GET' };
    fixture.healthy = false;
    fixture.rows = [logRow({ level: 'fatal', message: 'FUNCTION_INVOCATION_TIMEOUT', messageTruncated: incomplete })];
    await assert.rejects(fixture.run(), { message: 'Storage release gate: github-http-403-rate-limit-exhausted' });
    const observation = fixture.observation();
    assert.equal(observation.githubStatusDelivery, 'pending');
    assert.deepEqual(observation.storage, { state: 'failure', code: 'storage-not-ready' });
    assert.equal(observation.runtime.state, incomplete ? 'error' : 'failure');
    assert.equal(observation.runtime.code, incomplete ? 'log-message-truncated' : 'runtime-errors-1');
    assert.equal(observation.runtime.queryComplete, !incomplete);
    if (incomplete) assert.equal(observation.runtime.summary, null);
    else {
      assert.equal(observation.runtime.summary.fatalRecords, 1);
      assert.equal(observation.runtime.summary.categories.timeout, 1);
    }
    assert.equal(fixture.delivery().state, 'failed');
    assert.equal(fixture.statuses.length, 0);
  });
});

test('untrusted GitHub transport exceptions cannot inject raw content through delivery reports or rejections', async () => {
  for (const method of ['GET', 'POST']) await withMonitorFixture(async (fixture) => {
    const secret = 'synthetic-private-provider-token-and-account';
    fixture.githubFailure = { method, at: 1, throw: Object.assign(new Error('Storage release gate: ' + secret), { code: 'ready', body: secret }) };
    await assert.rejects(fixture.run(), { message: 'Storage release gate: monitor-unavailable' });
    assert.equal(fixture.observation().githubStatusDelivery, 'pending');
    assert.equal(fixture.observation().runtime.queryComplete, true);
    assert.deepEqual(fixture.delivery(), {
      event: 'production-monitor-status-delivery', sourceSha: 'a'.repeat(40), deploymentId: 'dpl_test',
      state: 'failed', code: 'monitor-unavailable', published: 0, unchanged: 0
    });
    assert.ok(!JSON.stringify([fixture.statuses, fixture.reports]).includes(secret));
  });
});

test('summary-file I/O failure preserves the pending observation and prevents GitHub status requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-monitor-summary-failure-'));
  try {
    // Appending to a directory reliably fails without relying on filesystem
    // permissions or a privileged test runner; the report must already exist.
    await withMonitorFixture(async (fixture) => {
      await assert.rejects(fixture.run());
      assert.equal(fixture.observation().githubStatusDelivery, 'pending');
      assert.equal(fixture.observation().runtime.queryComplete, true);
      assert.deepEqual(fixture.observation().runtime.summary, emptySummary());
      assert.equal(fixture.statuses.length, 0);
      assert.ok(!fixture.calls.some((call) => call.host === 'api.github.com'));
    }, dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('malicious prefixed collector errors cannot inject private content into statuses or reports', async () => {
  for (const error of [
    new Error('Storage release gate: synthetic-private-token'),
    Object.assign(new Error('Storage release gate: synthetic-private-token'), { code: 'ready' }),
    { message: 'Storage release gate: synthetic-private-token' },
    null, 'Storage release gate: synthetic-private-token'
  ]) await withMonitorFixture(async (fixture) => {
    fixture.throwLogError = true;
    fixture.logError = error;
    await assert.rejects(fixture.run(), { message: 'Storage release gate: monitor-unavailable' });
    assert.equal(fixture.latest('Production runtime errors').state, 'error');
    assert.equal(fixture.observation().runtime.summary, null);
    assert.ok(!JSON.stringify([fixture.statuses, fixture.reports]).includes('synthetic-private-token'));
  });
});

test('monitor rejects impossible aggregate counts and projects future collector fields out of all outputs', async () => {
  for (const patch of [
    { records: -1 }, { records: logLimit }, { records: 1.5 }, { errorRecords: 1 },
    { records: 1 }, { categories: { ...emptySummary().categories, storage: 1 } }
  ]) await withMonitorFixture(async (fixture) => {
    fixture.summaryOverride = { ...emptySummary(), ...patch };
    await assert.rejects(fixture.run(), /log-response-invalid/);
    assert.equal(fixture.observation().runtime.summary, null);
    assert.equal(fixture.observation().runtime.queryComplete, false);
  });
  const dir = await mkdtemp(join(tmpdir(), 'runtime-monitor-summary-'));
  const summaryPath = join(dir, 'summary.md');
  try {
    await withMonitorFixture(async (fixture) => {
      const secret = 'synthetic-private-token-and-account';
      fixture.summaryOverride = {
        ...emptySummary(), raw: secret, messages: [secret], requestUrl: 'https://private.example/' + secret,
        categories: { ...emptySummary().categories, attackerCategory: secret }
      };
      const observation = await fixture.run();
      assert.deepEqual(observation.runtime.summary, emptySummary());
      const output = JSON.stringify([observation, fixture.statuses, fixture.reports]) + await readFile(summaryPath, 'utf8');
      assert.ok(!output.includes(secret)); assert.ok(!output.includes('attackerCategory'));
      assert.match(output, /dpl_test/); assert.match(output, /2026-10-29T00:30:00.000Z/);
    }, summaryPath);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('unchanged monitor observations do not duplicate statuses', () => {
  const next = { state: 'failure', description: 'Storage readiness + runtime logs: storage-not-ready', target_url: 'https://github.com/lopugit/thingtime/actions/workflows/storage-release-monitor.yml' };
  assert.equal(shouldPublishStatus({ ...next }, next), false);
  assert.equal(shouldPublishStatus({ ...next, state: 'success' }, next), true);
  assert.equal(shouldPublishStatus(null, next), true);
});
test('production gates run before alias movement and inside existing merge-required contexts', () => {
  const publisher = readFileSync(new URL('./deploy-vercel-prebuilt.mjs', import.meta.url), 'utf8');
  assert.ok(publisher.indexOf('await checkStorageManifest(url') < publisher.indexOf('await reconcileGatewayAliases'));
  assert.ok(publisher.indexOf('await waitForStorageReadiness(plan.gateway.origin') < publisher.indexOf('await reconcileGatewayAliases'));
  assert.ok(publisher.indexOf('await runtimeLogs') < publisher.indexOf('await reconcileGatewayAliases'));
  assert.match(publisher, /checkStorageReadiness\(`https:\/\/\$\{name\}`/);
  const workflow = readFileSync(new URL('../workflows/web-ci.yml', import.meta.url), 'utf8');
  for (const job of ['build', 'required-build-context']) {
    const section = workflow.split(`\n  ${job}:\n`)[1].split(/\n  [\w-]+:\n/)[0];
    assert.match(section, /Require production storage readiness before merge/);
    assert.match(section, /github\.base_ref == 'github-actions' && github\.event\.pull_request\.head\.sha/);
  }
  const monitor = readFileSync(new URL('../workflows/storage-release-monitor.yml', import.meta.url), 'utf8');
  assert.match(monitor, /environment: vercel-prebuilt-control/);
  assert.match(monitor, /vercel@59\.10\.0/);
  assert.doesNotMatch(monitor, /ADMIN.*TOKEN|continue-on-error/);
});
test('required API-suite job runs real storage integration when present without warning-only fallback', () => {
  const workflow = readFileSync(new URL('../workflows/web-ci.yml', import.meta.url), 'utf8');
  const api = workflow.split('\n  api-tests:\n')[1].split(/\n  [\w-]+:\n/)[0];
  const start = api.indexOf('      - name: Verify durable storage recovery against an isolated replica');
  const end = api.indexOf('      - name: Start dev stack', start);
  assert.ok(start >= 0 && end > start);
  assert.ok(api.indexOf('      - name: Install dependencies') < start);
  const step = api.slice(start, end);
  assert.match(step, /hashFiles\('remix\/scripts\/storage-recovery\.integration\.mts'\) != ''/);
  assert.match(step, /THINGTIME_TEST_MONGO_RUNTIME: docker/);
  assert.match(step, /run: pnpm run test:storage-recovery:integration/);
  assert.doesNotMatch(step, /continue-on-error|\|\| true|secrets\./);
});
