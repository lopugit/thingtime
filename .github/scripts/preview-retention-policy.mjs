import { createHmac } from 'node:crypto';
const FEATURE = 'api.integration-ci-preview-retention';
const PATH = '/api/v1/integrations/ci/preview-retention';
const DAY = 86_400_000;
const duration = (value, minimum, unit) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && Number.isSafeInteger(value * unit);

export function parsePreviewRetentionPolicy(value, repository) {
  const policy = value?.policy;
  if (value?.ok !== true || value.repository !== repository || policy?.version !== 1 ||
      typeof policy.enabled !== 'boolean' || typeof policy.pruneSupersededOpenPr !== 'boolean' ||
      !duration(policy.noOpenPrGraceHours, 0, 3_600_000) ||
      !duration(policy.supersededGraceHours, 0, 3_600_000) ||
      !(policy.inactivePullRequestDays === null || duration(policy.inactivePullRequestDays, 1, DAY))) {
    throw new Error('Preview retention policy response is invalid');
  }
  return { version: 1, enabled: policy.enabled, noOpenPrGraceHours: policy.noOpenPrGraceHours,
    supersededGraceHours: policy.supersededGraceHours, pruneSupersededOpenPr: policy.pruneSupersededOpenPr,
    inactivePullRequestDays: policy.inactivePullRequestDays };
}

export function previewRetentionCapability(manifest, origin) {
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(manifest?.features?.[FEATURE]?.version || '');
  return manifest?.schemaVersion === 1 && manifest.origin === origin && version?.[1] === '1' &&
    Array.isArray(manifest.operations) && manifest.operations.some((operation) => operation.feature === FEATURE && operation.path === PATH && operation.methods?.includes('POST'));
}

export async function readPreviewRetentionPolicy(config, { env = process.env, fetcher = fetch, now = Date.now } = {}) {
  const parsed = new URL(env.THINGTIME_PREVIEW_POLICY_ORIGIN || 'https://thingtime.com');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Preview retention policy origin is invalid');
  const origin = parsed.origin, secret = env.THINGTIME_CI_ROUTER_SECRET?.trim();
  if (!secret) throw new Error('Preview retention policy requires the existing CI router secret');
  const read = async (path, init = {}) => {
    const response = await fetcher(`${origin}${path}`, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Preview retention policy request failed (HTTP ${response.status})`); }
    try { return await response.json(); } catch { throw new Error('Preview retention policy returned invalid JSON'); }
  };
  if (!previewRetentionCapability(await read('/.well-known/thingtime-capabilities.json'), origin)) throw new Error('Preview retention policy capability unavailable');
  const body = JSON.stringify({ repository: config.repository, ref: 'github-actions', requestedAt: new Date(now()).toISOString() });
  const signature = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
  return parsePreviewRetentionPolicy(await read(PATH, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Thingtime-CI-Signature': signature }, body }), config.repository);
}

export function pullRequestIsLive(pullRequest, policy, now = Date.now()) {
  if (pullRequest?.state !== 'open') return false;
  if (!policy.enabled || policy.inactivePullRequestDays === null) return true;
  const updatedAt = Date.parse(pullRequest.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 60_000) throw new Error('Preview PR activity timestamp unavailable');
  return now - updatedAt < policy.inactivePullRequestDays * DAY;
}

export function previewGraceElapsed(deployment, policy, pullRequest = null, now = Date.now()) {
  if (policy.noOpenPrGraceHours === 0) return true;
  const created = Number(deployment.createdAt ?? deployment.created);
  const closed = pullRequest?.state === 'closed' ? Date.parse(pullRequest.closed_at) : created;
  if (!Number.isFinite(created) || created <= 0 || !Number.isFinite(closed) || created > now || closed > now) throw new Error('Preview retention age unavailable');
  return now - Math.max(created, closed) >= policy.noOpenPrGraceHours * 3_600_000;
}
