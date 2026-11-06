import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export const productionOrigin = 'https://thingtime.com';
export const logLimit = 500;
export const storageFailure = /Account content requires storage migration before its ledger can be reconciled|Storage accounting requires (?:migration|recovery)|storage migration required|\bSTORAGE_(?:MIGRATION_REQUIRED|RECOVERY_BUSY|ACCOUNTING_UNAVAILABLE|INVARIANT)\b/i;
const failureCodes = new WeakMap();
const failure = (code) => {
  const error = new Error(`Storage release gate: ${code}`);
  failureCodes.set(error, code);
  return error;
};
const safeFailureCode = (error) => failureCodes.get(error) || 'monitor-unavailable';
const runtimeCategories = {
  timeout: /\b(?:FUNCTION_INVOCATION_TIMEOUT|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_(?:CONNECT|HEADERS|BODY)_TIMEOUT|TimeoutError)\b|(?:task|function execution) timed out/i,
  memory: /\b(?:FUNCTION_MEMORY_LIMIT_EXCEEDED|ERR_WORKER_OUT_OF_MEMORY)\b|heap out of memory/i,
  exception: /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION)\b|uncaught exception|unhandled (?:promise|rejection)/i,
  database: /\bMongo(?:Server|Network|ServerSelection|PoolCleared|TopologyClosed)Error\b/
};

function logWindow({ since, until }) {
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 30 * 60_000) throw failure('invalid-log-window');
  return { start, end };
}

export function requireStorageManifest(manifest, origin, minimumVersion = '1.2.0', gateway) {
  const version = manifest?.features?.['api.health-nitro']?.version;
  const parts = /^1\.(\d+)\.(\d+)$/.exec(version || '');
  const minimum = minimumVersion.split('.').map(Number);
  if (manifest?.origin !== origin || !parts || Number(parts[1]) < minimum[1] || (Number(parts[1]) === minimum[1] && Number(parts[2]) < minimum[2])) throw failure('health-capability-unavailable');
  if (minimum[1] >= 3 && !/^1\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(manifest?.features?.['api.storage-accounting']?.version || '')) throw failure('storage-capability-unavailable');
  if (minimum[1] >= 3 && (manifest.schemaVersion !== 1 || !Array.isArray(manifest.operations) || !manifest.operations.some((operation) => operation?.feature === 'api.health-nitro' && operation.path === '/api/v1/health/nitro' && Array.isArray(operation.methods) && operation.methods.includes('GET')))) throw failure('health-operation-unavailable');
  if (gateway && ['origin', 'environment', 'deploymentId'].some((key) => manifest.gateway?.[key] !== gateway[key])) throw failure('gateway-identity-mismatch');
}

export function requireStorageReady(manifest, health, origin, minimumVersion = '1.2.0', gateway) {
  requireStorageManifest(manifest, origin, minimumVersion, gateway);
  if (health?.origin !== origin || health?.targetOrigin !== origin || health?.service !== 'nitro') throw failure('health-origin-mismatch');
  if (health?.storageAccounting?.state === 'recovering') throw failure('storage-recovering');
  if (health?.ok !== true || health?.state !== 'ready' || health?.storageAccounting?.state !== 'ready' || !Number.isSafeInteger(health.storageAccounting.expectedVersion) || health.storageAccounting.expectedVersion < 1) throw failure('storage-not-ready');
  return { state: 'ready', accountingVersion: health.storageAccounting.expectedVersion };
}

async function readStorageJson(origin, path, { fetcher = fetch, signal } = {}) {
  // Never follow a health endpoint to a login, a different origin or a proxy target.
  if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw failure('invalid-origin');
  let response;
  try { response = await fetcher(origin + path, { redirect: 'error', cache: 'no-store', signal: signal || AbortSignal.timeout(30_000) }); }
  catch { throw failure('health-request-unavailable'); }
  if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw failure('health-response-unavailable');
  try { return await response.json(); } catch { throw failure('health-response-invalid'); }
}

export async function checkStorageManifest(origin, { minimumVersion = '1.3.0', gateway, ...options } = {}) {
  const manifest = await readStorageJson(origin, '/.well-known/thingtime-capabilities.json', options);
  requireStorageManifest(manifest, origin, minimumVersion, gateway);
}

export async function checkStorageReadiness(origin, { minimumVersion = '1.2.0', gateway, ...options } = {}) {
  const manifest = await readStorageJson(origin, '/.well-known/thingtime-capabilities.json', options);
  requireStorageManifest(manifest, origin, minimumVersion, gateway);
  const health = await readStorageJson(origin, '/api/v1/health/nitro', options);
  return requireStorageReady(manifest, health, origin, minimumVersion, gateway);
}

export async function waitForStorageReadiness(origin, { timeoutMs = 90_000, now = Date.now, wait = (ms) => new Promise((done) => setTimeout(done, ms)), check = checkStorageReadiness, ...options } = {}) {
  const start = now();
  let waited = 0, attempt = 0;
  while (true) {
    const remaining = timeoutMs - Math.max(now() - start, waited);
    if (remaining <= 0) throw failure('storage-recovery-deadline');
    try { return await check(origin, { ...options, signal: AbortSignal.timeout(remaining) }); }
    catch (error) {
      // Merely admitting queued writes never establishes healthy release.
      // Allow the durable worker to drain, then require the exact ready state.
      if (error.message !== 'Storage release gate: storage-recovering') throw error;
      const delay = Math.min(2_000 * 2 ** attempt++, 30_000, remaining);
      await wait(delay); waited += delay;
    }
  }
}

export function summarizeRuntimeLogs(stdout, expected) {
  const window = expected ? logWindow(expected) : null;
  if (typeof stdout !== 'string') throw failure('log-response-invalid');
  const lines = stdout.split('\n').filter((line) => line.trim());
  if (lines.length >= logLimit) throw failure('log-window-truncated');
  const summary = {
    records: lines.length, storageFailures: 0, errorRecords: 0, fatalRecords: 0, unknownSeverityRecords: 0,
    categories: { storage: 0, timeout: 0, memory: 0, exception: 0, database: 0, http5xx: 0, other: 0 }
  };
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { throw failure('log-response-invalid'); }
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw failure('log-response-invalid');
    if (expected && (row.deploymentId !== expected.deploymentId || row.projectId !== expected.projectId || !Number.isFinite(row.timestamp) || row.timestamp < window.start || row.timestamp > window.end || (row.environment !== undefined && row.environment !== 'production'))) throw failure('log-scope-mismatch');
    if (row.logs !== undefined && !Array.isArray(row.logs)) throw failure('log-response-invalid');
    const entries = [row, ...(row.logs || [])];
    if (entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || (entry.message !== undefined && typeof entry.message !== 'string') || (entry.level !== undefined && typeof entry.level !== 'string') || (entry.messageTruncated != null && typeof entry.messageTruncated !== 'boolean'))) throw failure('log-response-invalid');
    if (entries.some((entry) => entry.messageTruncated)) throw failure('log-message-truncated');
    // Pinned CLI output is one request record; its top-level message repeats a
    // nested log. Count each request once, never top-level + nested as events.
    if (entries.some((entry) => entry.level === 'fatal')) summary.fatalRecords++;
    else if (entries.some((entry) => entry.level === 'error')) summary.errorRecords++;
    if (!['error', 'fatal'].includes(row.level) || entries.some((entry) => !['info', 'warning', 'error', 'fatal'].includes(entry.level))) summary.unknownSeverityRecords++;
    const text = entries.filter((entry) => entry === row || ['error', 'fatal'].includes(entry.level)).map((entry) => entry.message || '').join('\n');
    const kinds = {
      storage: storageFailure.test(JSON.stringify(row)),
      ...Object.fromEntries(Object.entries(runtimeCategories).map(([kind, pattern]) => [kind, pattern.test(text)])),
      http5xx: Number.isInteger(row.responseStatusCode) && row.responseStatusCode >= 500 && row.responseStatusCode <= 599
    };
    if (kinds.storage) summary.storageFailures++;
    for (const [kind, matched] of Object.entries(kinds)) if (matched) summary.categories[kind]++;
    if (!Object.values(kinds).some(Boolean)) summary.categories.other++;
  }
  // Return no raw messages, request URLs, account IDs, tokens or provider output.
  // Categories can overlap. CLI normalization/pagination does not establish
  // raw-field provenance or distinct event totals; these are returned records.
  return summary;
}

export function runtimeLogArgs({ projectId, deploymentId, scope, since, until }) {
  logWindow({ since, until });
  if (!/^prj_[a-zA-Z0-9]+$/.test(projectId) || !/^dpl_[a-zA-Z0-9]+$/.test(deploymentId) || !/^[a-z0-9-]+$/.test(scope)) throw failure('invalid-provider-scope');
  return ['logs', '--project', projectId, '--deployment', deploymentId, '--environment', 'production', '--scope', scope,
    '--since', since, '--until', until, '--level', 'error', '--level', 'fatal', '--limit', String(logLimit), '--json', '--no-follow'];
}

export async function readRuntimeLogs(options, { runner = exec, environment = process.env } = {}) {
  const args = runtimeLogArgs(options);
  let stdout;
  try {
    ({ stdout } = await runner(options.cli, args, {
      timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: environment.PATH, HOME: environment.HOME, TMPDIR: environment.TMPDIR, CI: 'true', VERCEL_TOKEN: environment.VERCEL_API_TOKEN, NO_COLOR: '1', VERCEL_TELEMETRY_DISABLED: '1' }
    }));
  } catch { throw failure('runtime-log-access-unavailable'); }
  return summarizeRuntimeLogs(stdout, options);
}

export async function checkRuntimeLogs(options, dependencies) {
  const summary = await readRuntimeLogs(options, dependencies);
  // Keep the publisher's storage release policy separate from broad monitoring.
  if (summary.storageFailures) throw failure(`runtime-storage-errors-${summary.storageFailures}`);
  return summary;
}

export const shouldPublishStatus = (latest, next) => !latest || latest.state !== next.state || latest.description !== next.description || latest.target_url !== next.target_url;

export async function monitor({ fetcher = fetch, now = Date.now, runtimeLogs = readRuntimeLogs, report = console.log } = {}) {
  const required = (key) => { if (!process.env[key]) throw failure(`missing-${key}`); return process.env[key]; };
  const provider = async (base, path, token, init = {}) => {
    const response = await fetcher(base + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (!response.ok) {
      const providerName = base === 'https://api.github.com' ? 'github' : 'vercel';
      const exhausted = response.headers.get('x-ratelimit-remaining') === '0' ? '-rate-limit-exhausted' : '';
      throw failure(`${providerName}-http-${response.status}${exhausted}`);
    }
    return response.json();
  };
  const team = required('VERCEL_TEAM_ID'), project = required('VERCEL_PROJECT_ID');
  const vercel = (path) => provider('https://api.vercel.com', `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(team)}`, required('VERCEL_API_TOKEN'));
  const alias = await vercel('/v4/aliases/thingtime.com');
  if (!/^dpl_[a-zA-Z0-9]+$/.test(alias.deploymentId || '')) throw failure('production-deployment-identity-mismatch');
  const deployment = await vercel(`/v13/deployments/${encodeURIComponent(alias.deploymentId || '')}`);
  if (deployment.id !== alias.deploymentId || deployment.projectId !== project || deployment.target !== 'production' || deployment.meta?.githubCommitRef !== 'main' || !/^[a-f0-9]{40}$/.test(deployment.meta?.githubCommitSha || '')) throw failure('production-deployment-identity-mismatch');
  const sha = deployment.meta.githubCommitSha;
  const end = now();
  if (!Number.isFinite(end)) throw failure('invalid-log-window');
  const window = { since: new Date(end - 30 * 60_000).toISOString(), until: new Date(end).toISOString() };
  let healthCode = null, logCode = null, summary = null;
  try {
    await checkStorageReadiness(productionOrigin, { fetcher, gateway: { origin: productionOrigin, environment: 'production', deploymentId: deployment.id } });
  } catch (error) { healthCode = safeFailureCode(error); }
  // Logs are independently useful during a storage outage. Neither observation
  // is publishable until the same canonical owner is verified again below.
  try {
    summary = await runtimeLogs({ cli: required('VERCEL_CLI_PATH'), projectId: project, deploymentId: deployment.id, scope: required('VERCEL_TEAM_SLUG'), ...window });
    // Explicit projection also protects output from future collector additions.
    const counts = ['records', 'storageFailures', 'errorRecords', 'fatalRecords', 'unknownSeverityRecords'];
    const kinds = ['storage', 'timeout', 'memory', 'exception', 'database', 'http5xx', 'other'];
    if (!summary || [...counts.map((key) => summary[key]), ...kinds.map((key) => summary.categories?.[key])].some((value) => !Number.isSafeInteger(value) || value < 0 || value >= logLimit) || counts.some((key) => summary[key] > summary.records) || summary.errorRecords + summary.fatalRecords > summary.records || summary.errorRecords + summary.fatalRecords + summary.unknownSeverityRecords < summary.records || summary.storageFailures !== summary.categories.storage || kinds.some((key) => summary.categories[key] > summary.records)) throw failure('log-response-invalid');
    summary = { ...Object.fromEntries(counts.map((key) => [key, summary[key]])), categories: Object.fromEntries(kinds.map((key) => [key, summary.categories[key]])) };
  } catch (error) { logCode = safeFailureCode(error); summary = null; }
  // An alias change makes this observation stale. A later run owns the new deployment.
  if ((await vercel('/v4/aliases/thingtime.com')).deploymentId !== deployment.id) throw failure('production-advanced');
  const repo = required('GITHUB_REPOSITORY');
  if (repo !== 'lopugit/thingtime') throw failure('repository-mismatch');
  const github = (path, init) => provider('https://api.github.com', `/repos/${repo}${path}`, required('GH_TOKEN'), init);
  const code = healthCode || logCode || (summary.storageFailures ? `runtime-storage-errors-${summary.storageFailures}` : 'ready');
  const state = code === 'ready' ? 'success' : 'failure';
  const runtimeCode = logCode || (summary.unknownSeverityRecords ? `runtime-severity-unknown-${summary.unknownSeverityRecords}` : summary.records ? `runtime-errors-${summary.records}` : 'ready');
  const runtimeState = logCode || summary?.unknownSeverityRecords ? 'error' : runtimeCode === 'ready' ? 'success' : 'failure';
  const target_url = `https://github.com/${repo}/actions/workflows/storage-release-monitor.yml`;
  const nextStatuses = [
    { state, context: 'Production storage runtime', description: `Storage readiness + runtime logs: ${code}`.slice(0, 140), target_url },
    { state: runtimeState, context: 'Production runtime errors', description: `Error/fatal request scan: ${runtimeCode}`.slice(0, 140), target_url }
  ];
  const statuses = await github(`/commits/${sha}/status`);
  // Stable target URL permits repeated unchanged observations to deduplicate.
  for (const next of nextStatuses) if (shouldPublishStatus(statuses.statuses?.find((row) => row.context === next.context), next)) await github(`/statuses/${sha}`, { method: 'POST', body: JSON.stringify(next) });
  const observation = { event: 'production-runtime-monitor', sourceSha: sha, deploymentId: deployment.id, window, storage: { state, code }, runtime: { state: runtimeState, code: runtimeCode, queryComplete: summary !== null && summary.unknownSeverityRecords === 0, summary } };
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Production monitor for source ${sha}, deployment ${deployment.id}, ${window.since} through ${window.until}.\n\nStorage: ${state} (${code}). Runtime: ${runtimeState} (${runtimeCode}).\n\n${summary ? `Returned request records: ${summary.records}; error: ${summary.errorRecords}; fatal: ${summary.fatalRecords}; unknown severity: ${summary.unknownSeverityRecords}. Categories (may overlap): ${Object.entries(summary.categories).map(([key, count]) => `${key}=${count}`).join(', ')}.` : 'Runtime query unavailable or incomplete; no clean-log claim.'}\n\nOnly error/fatal-filtered request records are covered; no raw logs, browser acceptance, or unique-event/comprehensive outage coverage is provided.\n`);
  report(JSON.stringify({ event: 'production-storage-monitor', state, code }));
  report(JSON.stringify(observation));
  if (state !== 'success') throw failure(code);
  if (runtimeState !== 'success') throw failure(runtimeCode);
  return observation;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (process.argv.includes('--monitor') ? monitor() : checkStorageReadiness(productionOrigin)).then(() => console.log('Storage release gate passed')).catch((error) => {
    console.error(`Storage release gate: ${safeFailureCode(error)}`);
    process.exitCode = 1;
  });
}
