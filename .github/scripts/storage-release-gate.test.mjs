import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkRuntimeLogs, checkStorageReadiness, logLimit, monitor, productionOrigin as origin, requireStorageReady, runtimeLogArgs, shouldPublishStatus, summarizeRuntimeLogs, waitForStorageReadiness } from './storage-release-gate.mjs';

const manifest = { origin, features: { 'api.health-nitro': { version: '1.3.0' }, 'api.storage-accounting': { version: '1.0.0' } } };
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
test('runtime log summary detects nested migration errors and never returns private content', () => {
  const secret = 'synthetic-private-account';
  const summary = summarizeRuntimeLogs(JSON.stringify({ requestId: secret, logs: [{ message: 'Account content requires storage migration before its ledger can be reconciled' }] }));
  assert.deepEqual(summary, { records: 1, storageFailures: 1 });
  assert.ok(!JSON.stringify(summary).includes(secret));
  assert.deepEqual(summarizeRuntimeLogs(''), { records: 0, storageFailures: 0 });
  for (const code of ['STORAGE_MIGRATION_REQUIRED', 'STORAGE_RECOVERY_BUSY', 'STORAGE_ACCOUNTING_UNAVAILABLE', 'STORAGE_INVARIANT']) {
    assert.equal(summarizeRuntimeLogs(JSON.stringify({ logs: [{ message: JSON.stringify({ source: 'storage-accounting', code, message: 'HTTP request returned a server error' }) }] })).storageFailures, 1);
  }
  assert.equal(summarizeRuntimeLogs(JSON.stringify({ logs: [{ message: 'Storage accounting requires recovery' }] })).storageFailures, 1);
  assert.equal(summarizeRuntimeLogs(JSON.stringify({ logs: [{ message: 'HTTP request returned a server error' }] })).storageFailures, 0);
  assert.throws(() => summarizeRuntimeLogs('unexpected provider response'), /invalid/);
  assert.throws(() => summarizeRuntimeLogs(JSON.stringify({ logs: [{ messageTruncated: true }] })), /truncated/);
  assert.throws(() => summarizeRuntimeLogs(('{}\n').repeat(logLimit)), /truncated/);
});
const options = { cli: '/verified/vercel', projectId: 'prj_test', deploymentId: 'dpl_test', scope: 'authorized-team', since: '2026-10-29T00:00:00.000Z', until: '2026-10-29T00:30:00.000Z' };
test('pinned CLI queries a bounded exact production deployment with credentials only in environment', async () => {
  const args = runtimeLogArgs(options);
  assert.ok(args.includes('--no-follow'));
  assert.equal(args.filter((arg) => arg === '--level').length, 2);
  assert.equal(args.includes('--query'), false);
  assert.equal(args[args.indexOf('--deployment') + 1], 'dpl_test');
  assert.equal(args[args.indexOf('--limit') + 1], String(logLimit));
  await checkRuntimeLogs(options, { environment: { VERCEL_API_TOKEN: 'synthetic-secret', GH_TOKEN: 'synthetic-github-secret' }, runner: async (cli, actual, config) => {
    assert.equal(cli, options.cli); assert.deepEqual(actual, args);
    assert.equal(config.env.VERCEL_TOKEN, 'synthetic-secret');
    assert.equal(config.env.GH_TOKEN, undefined);
    assert.ok(!actual.includes('synthetic-secret')); assert.equal(config.timeout, 60_000);
    return { stdout: '' };
  } });
  await assert.rejects(checkRuntimeLogs(options, { runner: async () => { throw new Error('secret token raw log'); } }), /runtime-log-access-unavailable/);
  const row = { projectId: options.projectId, deploymentId: options.deploymentId, timestamp: Date.parse(options.since), message: 'storage migration required' };
  await assert.rejects(checkRuntimeLogs(options, { runner: async () => ({ stdout: JSON.stringify(row) }) }), /runtime-storage-errors-1/);
  await assert.rejects(checkRuntimeLogs(options, { runner: async () => ({ stdout: JSON.stringify({ ...row, deploymentId: 'dpl_other' }) }) }), /log-scope-mismatch/);
  await assert.rejects(checkRuntimeLogs(options, { runner: async () => ({ stdout: JSON.stringify({ ...row, timestamp: Date.parse(options.since) - 1 }) }) }), /log-scope-mismatch/);
});
test('monitor binds current production source, deduplicates failure and recovery, and rejects alias races', async () => {
  const environment = { GITHUB_REPOSITORY: 'lopugit/thingtime', GH_TOKEN: 'synthetic-gh', VERCEL_API_TOKEN: 'synthetic-vc', VERCEL_PROJECT_ID: 'prj_test', VERCEL_TEAM_ID: 'team_test', VERCEL_TEAM_SLUG: 'authorized-team', VERCEL_CLI_PATH: '/verified/vercel', GITHUB_STEP_SUMMARY: '' };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const statuses = [];
  let healthy = true, race = false, aliasReads = 0, logReads = 0;
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/v4/aliases/thingtime.com') return Response.json({ deploymentId: race && ++aliasReads > 1 ? 'dpl_new' : 'dpl_test' });
    if (url.pathname === '/v13/deployments/dpl_test') return Response.json({ id: 'dpl_test', projectId: 'prj_test', target: 'production', meta: { githubCommitRef: 'main', githubCommitSha: 'a'.repeat(40) } });
    if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json(manifest);
    if (url.pathname === '/api/v1/health/nitro') return Response.json({ ...health, ok: healthy });
    if (url.pathname.endsWith('/status')) return Response.json({ statuses: [...statuses].reverse() });
    if (url.pathname.includes('/statuses/') && init.method === 'POST') { statuses.push(JSON.parse(init.body)); return Response.json({}); }
    throw new Error('Unexpected fixture path');
  };
  const runtimeLogs = async (scope) => { logReads++; assert.equal(scope.deploymentId, 'dpl_test'); };
  try {
    await monitor({ fetcher, runtimeLogs });
    await monitor({ fetcher, runtimeLogs });
    assert.equal(statuses.length, 1);
    healthy = false;
    await assert.rejects(monitor({ fetcher, runtimeLogs }), /storage-not-ready/);
    await assert.rejects(monitor({ fetcher, runtimeLogs }), /storage-not-ready/);
    assert.equal(statuses.length, 2); assert.equal(logReads, 2);
    healthy = true;
    await monitor({ fetcher, runtimeLogs });
    assert.equal(statuses.length, 3); assert.equal(statuses.at(-1).state, 'success');
    race = true; aliasReads = 0;
    await assert.rejects(monitor({ fetcher, runtimeLogs }), /production-advanced/);
    assert.equal(statuses.length, 3);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('unchanged monitor observations do not duplicate statuses', () => {
  const next = { state: 'failure', description: 'Storage readiness + runtime logs: storage-not-ready', target_url: 'https://github.com/lopugit/thingtime/actions/workflows/storage-release-monitor.yml' };
  assert.equal(shouldPublishStatus({ ...next }, next), false);
  assert.equal(shouldPublishStatus({ ...next, state: 'success' }, next), true);
  assert.equal(shouldPublishStatus(null, next), true);
});
test('production gates run before alias movement and inside existing merge-required contexts', () => {
  const publisher = readFileSync(new URL('./deploy-vercel-prebuilt.mjs', import.meta.url), 'utf8');
  assert.ok(publisher.indexOf('await waitForStorageReadiness(url') < publisher.indexOf('await reconcileGatewayAliases'));
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
