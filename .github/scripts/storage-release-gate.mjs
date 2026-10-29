import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export const productionOrigin = 'https://thingtime.com';
export const logLimit = 500;
export const storageFailure = /Account content requires storage migration before its ledger can be reconciled|Storage accounting requires migration|storage migration required/i;
const failure = (code) => new Error(`Storage release gate: ${code}`);

export function requireStorageReady(manifest, health, origin, minimumVersion = '1.2.0') {
  const version = manifest?.features?.['api.health-nitro']?.version;
  const parts = /^1\.(\d+)\.(\d+)$/.exec(version || '');
  const minimum = minimumVersion.split('.').map(Number);
  if (manifest?.origin !== origin || !parts || Number(parts[1]) < minimum[1] || (Number(parts[1]) === minimum[1] && Number(parts[2]) < minimum[2])) throw failure('health-capability-unavailable');
  if (health?.origin !== origin || health?.targetOrigin !== origin || health?.service !== 'nitro') throw failure('health-origin-mismatch');
  if (health?.storageAccounting?.state === 'recovering') throw failure('storage-recovering');
  if (health?.ok !== true || health?.state !== 'ready' || health?.storageAccounting?.state !== 'ready' || !Number.isSafeInteger(health.storageAccounting.expectedVersion) || health.storageAccounting.expectedVersion < 1) throw failure('storage-not-ready');
  return { state: 'ready', accountingVersion: health.storageAccounting.expectedVersion };
}

export async function checkStorageReadiness(origin, { fetcher = fetch, signal, minimumVersion = '1.2.0' } = {}) {
  // Never follow a health endpoint to a login, a different origin or a proxy target.
  if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw failure('invalid-origin');
  const read = async (path) => {
    let response;
    try { response = await fetcher(origin + path, { redirect: 'error', cache: 'no-store', signal: signal || AbortSignal.timeout(30_000) }); }
    catch { throw failure('health-request-unavailable'); }
    if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw failure('health-response-unavailable');
    try { return await response.json(); } catch { throw failure('health-response-invalid'); }
  };
  const manifest = await read('/.well-known/thingtime-capabilities.json');
  const health = await read('/api/v1/health/nitro');
  return requireStorageReady(manifest, health, origin, minimumVersion);
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
  const lines = stdout.split('\n').filter((line) => line.trim());
  if (lines.length >= logLimit) throw failure('log-window-truncated');
  let matches = 0;
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { throw failure('log-response-invalid'); }
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw failure('log-response-invalid');
    if (expected && (row.deploymentId !== expected.deploymentId || row.projectId !== expected.projectId || !Number.isFinite(row.timestamp) || row.timestamp < Date.parse(expected.since) || row.timestamp > Date.parse(expected.until))) throw failure('log-scope-mismatch');
    if (row.messageTruncated || row.logs?.some((log) => log.messageTruncated)) throw failure('log-message-truncated');
    if (storageFailure.test(JSON.stringify(row))) matches++;
  }
  // Return no raw messages, request URLs, account IDs, tokens or provider output.
  return { records: lines.length, storageFailures: matches };
}

export function runtimeLogArgs({ projectId, deploymentId, scope, since, until }) {
  if (!/^prj_[a-zA-Z0-9]+$/.test(projectId) || !/^dpl_[a-zA-Z0-9]+$/.test(deploymentId) || !/^[a-z0-9-]+$/.test(scope)) throw failure('invalid-provider-scope');
  return ['logs', '--project', projectId, '--deployment', deploymentId, '--environment', 'production', '--scope', scope,
    '--since', since, '--until', until, '--query', '"storage migration"', '--limit', String(logLimit), '--json', '--no-follow'];
}

export async function checkRuntimeLogs(options, { runner = exec, environment = process.env } = {}) {
  let stdout;
  try {
    ({ stdout } = await runner(options.cli, runtimeLogArgs(options), {
      timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      env: { PATH: environment.PATH, HOME: environment.HOME, TMPDIR: environment.TMPDIR, CI: 'true', VERCEL_TOKEN: environment.VERCEL_API_TOKEN, NO_COLOR: '1', VERCEL_TELEMETRY_DISABLED: '1' }
    }));
  } catch { throw failure('runtime-log-access-unavailable'); }
  const summary = summarizeRuntimeLogs(stdout, options);
  if (summary.storageFailures) throw failure(`runtime-storage-errors-${summary.storageFailures}`);
  return summary;
}

export const shouldPublishStatus = (latest, next) => !latest || latest.state !== next.state || latest.description !== next.description || latest.target_url !== next.target_url;

export async function monitor({ fetcher = fetch, now = Date.now, runtimeLogs = checkRuntimeLogs } = {}) {
  const required = (key) => { if (!process.env[key]) throw failure(`missing-${key}`); return process.env[key]; };
  const provider = async (base, path, token, init = {}) => {
    const response = await fetcher(base + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (!response.ok) throw failure('provider-read-unavailable');
    return response.json();
  };
  const team = required('VERCEL_TEAM_ID'), project = required('VERCEL_PROJECT_ID');
  const vercel = (path) => provider('https://api.vercel.com', `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(team)}`, required('VERCEL_API_TOKEN'));
  const alias = await vercel('/v4/aliases/thingtime.com');
  const deployment = await vercel(`/v13/deployments/${encodeURIComponent(alias.deploymentId || '')}`);
  if (deployment.projectId !== project || deployment.target !== 'production' || deployment.meta?.githubCommitRef !== 'main' || !/^[a-f0-9]{40}$/.test(deployment.meta?.githubCommitSha || '')) throw failure('production-deployment-identity-mismatch');
  const sha = deployment.meta.githubCommitSha;
  let code = 'ready', state = 'success';
  try {
    await checkStorageReadiness(productionOrigin, { fetcher });
    const end = now();
    await runtimeLogs({ cli: required('VERCEL_CLI_PATH'), projectId: project, deploymentId: deployment.id, scope: required('VERCEL_TEAM_SLUG'), since: new Date(end - 30 * 60_000).toISOString(), until: new Date(end).toISOString() });
  } catch (error) {
    state = 'failure';
    code = error.message.startsWith('Storage release gate: ') ? error.message.slice(22) : 'monitor-unavailable';
  }
  // An alias change makes this observation stale. A later run owns the new deployment.
  if ((await vercel('/v4/aliases/thingtime.com')).deploymentId !== deployment.id) throw failure('production-advanced');
  const repo = required('GITHUB_REPOSITORY');
  if (repo !== 'lopugit/thingtime') throw failure('repository-mismatch');
  const github = (path, init) => provider('https://api.github.com', `/repos/${repo}${path}`, required('GH_TOKEN'), init);
  const context = 'Production storage runtime';
  const next = { state, context, description: `Storage readiness + runtime logs: ${code}`.slice(0, 140), target_url: `https://github.com/${repo}/actions/workflows/storage-release-monitor.yml` };
  const statuses = await github(`/commits/${sha}/status`);
  // Stable target URL permits repeated unchanged observations to deduplicate.
  if (shouldPublishStatus(statuses.statuses?.find((row) => row.context === context), next)) await github(`/statuses/${sha}`, { method: 'POST', body: JSON.stringify(next) });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Storage runtime monitor: ${state} (${code}). Checks stop on failure; a success requires both readiness and a complete 30-minute runtime-log query.\n`);
  console.log(JSON.stringify({ event: 'production-storage-monitor', state, code }));
  if (state !== 'success') throw failure(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (process.argv.includes('--monitor') ? monitor() : checkStorageReadiness(productionOrigin)).then(() => console.log('Storage release gate passed')).catch((error) => {
    console.error(error.message.startsWith('Storage release gate: ') ? error.message : 'Storage release gate: unavailable');
    process.exitCode = 1;
  });
}
