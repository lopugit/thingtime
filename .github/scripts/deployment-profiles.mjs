import { createHmac } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const origin = 'https://thingtime.com';
const route = '/api/v1/integrations/ci/deployment-profiles';

export async function requireOperation(feature, path, method, fetcher = fetch) {
  const response = await fetcher(origin + '/.well-known/thingtime-capabilities.json', {
    redirect: 'error', signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('Thingtime discovery failed: ' + response.status);
  const data = await response.json();
  if (data.origin !== origin || data.schemaVersion !== 1 ||
      !/^1\.\d+\.\d+$/.test(data.features?.[feature]?.version) ||
      !data.operations?.some(op => op.feature === feature && op.path === path && op.methods?.includes(method))) {
    throw new Error('Required Thingtime operation unavailable: ' + feature);
  }
  return data.features[feature].version;
}

export async function profiles(env = process.env, fetcher = fetch) {
  const version = await requireOperation('api.integration-ci-deployment-profiles', route, 'POST', fetcher);
  const secret = env.THINGTIME_CI_ROUTER_SECRET;
  const repository = env.GITHUB_REPOSITORY;
  if (!secret || repository !== 'lopugit/thingtime') throw new Error('Missing controller identity');
  const body = JSON.stringify({ purpose: 'deployment-profiles', ref: 'github-actions', repository, requestedAt: new Date().toISOString() });
  const response = await fetcher(origin + route, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body,
    headers: { 'content-type': 'application/json', 'x-thingtime-ci-signature': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex') }
  });
  if (!response.ok) throw new Error('Unable to read deployment profiles: ' + response.status);
  const data = await response.json();
  if (!data.ok || data.repository !== repository || !Array.isArray(data.profiles)) throw new Error('Invalid deployment profile response');
  const seen = new Set();
  for (const p of data.profiles) {
    const lanes = p.pilotLanes ?? [];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id) || ('vercel-deployment-' + p.id).length > 255 || seen.has(p.id) ||
        typeof p.enabled !== 'boolean' || p.mode !== (p.id === 'legacy' ? 'primary' : 'parallel') ||
        !/^team_[A-Za-z0-9]+$/.test(p.teamId) || !/^prj_[A-Za-z0-9]+$/.test(p.projectId) ||
        !Array.isArray(lanes) || lanes.some(lane => !['production', 'development', 'preview'].includes(lane)) ||
        new Set(lanes).size !== lanes.length || (lanes.length && (p.mode !== 'parallel' || Number(version.split('.')[1]) < 1)) ||
        (p.mode === 'parallel' && !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(p.testOrigin))) {
      throw new Error('Invalid target identity');
    }
    seen.add(p.id);
  }
  return data.profiles;
}

export function matchesTarget(p, env) {
  return p.teamId === env.VERCEL_TEAM_ID && p.projectId === env.VERCEL_PROJECT_ID &&
    p.teamSlug === env.VERCEL_TEAM_SLUG && p.projectName === env.VERCEL_PROJECT_NAME;
}

export async function legacyEnabled(env = process.env) {
  // Enable enforcement only after the product endpoint is deployed. Once on,
  // an unavailable or malformed control plane must never reactivate a target.
  if (env.THINGTIME_DEPLOYMENT_PROFILES_ENABLED !== 'true') return true;
  const p = (await profiles(env)).find(p => p.id === 'legacy');
  if (p && !matchesTarget(p, env)) throw new Error('Legacy deployment identity mismatch');
  return p?.enabled ?? true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = (await profiles()).filter(p => p.mode === 'parallel' && p.enabled && !p.pilotLanes?.includes('production'));
  await appendFile(process.env.GITHUB_OUTPUT, 'targets=' + JSON.stringify(rows.map(({ id, testOrigin }) => ({ id, testOrigin }))) + '\n');
}
