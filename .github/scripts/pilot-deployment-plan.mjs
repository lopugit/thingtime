import { createHash } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { profiles } from './deployment-profiles.mjs';
import { readPreviewRetentionPolicy, pullRequestIsLive } from './preview-retention-policy.mjs';

const repository = 'lopugit/thingtime';
const sourcePath = 'remix/app/api/utils/deployment/pilotBuild.ts';
const shaPattern = /^[a-f0-9]{40}$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const protectedBranches = new Set(['main', 'develop', 'github-actions']);

export function pilotAlias(baseOrigin, lane, prNumber = 0) {
  const url = new URL(baseOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(url.hostname)) throw new Error('Invalid pilot base origin');
  if (!['production', 'development', 'preview'].includes(lane)) throw new Error('Invalid pilot lane');
  if (lane === 'production') return url.hostname;
  if (lane === 'preview' && (!Number.isSafeInteger(prNumber) || prNumber < 1)) throw new Error('Invalid pilot PR number');
  const suffix = lane === 'development' ? '-dev' : `-pr-${prNumber}`;
  const base = url.hostname.slice(0, -'.vercel.app'.length);
  const tag = base.length + suffix.length <= 63 ? base :
    `${base.slice(0, 63 - suffix.length - 9).replace(/-+$/, '')}-${createHash('sha256').update(base).digest('hex').slice(0, 8)}`;
  if (!tag || tag.length + suffix.length > 63) throw new Error('Pilot alias exceeds DNS limit');
  return `${tag}${suffix}.vercel.app`;
}

export function pilotLaneFor(sourceRef, prNumber = 0, retirePrNumber = 0) {
  if (retirePrNumber) {
    if (!Number.isSafeInteger(retirePrNumber) || retirePrNumber < 1 || prNumber) throw new Error('Invalid pilot retirement request');
    return 'retire';
  }
  if (sourceRef === 'main' && !prNumber) return 'production';
  if (sourceRef === 'develop' && !prNumber) return 'development';
  if (prNumber && Number.isSafeInteger(prNumber) && prNumber > 0 && !protectedBranches.has(sourceRef) && branchPattern.test(sourceRef)) return 'preview';
  throw new Error('Unsupported pilot source');
}

export function assertPilotSource(file) {
  if (!/^export\s+const\s+PILOT_LANES_VERSION\s*=\s*['"]2\.0\.0['"]\s*;?/m.test(file) ||
      !/THINGTIME_PILOT_LANE/.test(file) || !/THINGTIME_PILOT_ORIGIN/.test(file)) {
    throw new Error('Product source does not implement pilot lanes 2.0.0');
  }
}

export function sameRepositoryPr(pr, repo, number, ref, state) {
  return pr?.number === number && pr.state === state && pr.base?.repo?.full_name === repo.full_name &&
    pr.head?.repo?.full_name === repo.full_name && pr.base.repo.id === repo.id && pr.head.repo.id === repo.id &&
    (ref === null || pr.head.ref === ref) && shaPattern.test(pr.head.sha || '');
}

export function retireablePilotPr(pr, repo, number) {
  if (pr?.number !== number || pr.base?.repo?.full_name !== repo.full_name || pr.base.repo.id !== repo.id ||
      (pr.head?.repo && (pr.head.repo.full_name !== repo.full_name || pr.head.repo.id !== repo.id))) return false;
  return pr.state === 'closed' || (pr.state === 'open' && (pr.draft === true || pr.base.ref === 'github-actions'));
}

const github = async (path, token, fetcher = fetch) => {
  const response = await fetcher(`https://api.github.com/repos/${repository}${path}`, {
    redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' }
  });
  if (!response.ok) throw new Error(`GitHub pilot source read failed: HTTP ${response.status}`);
  return response.json();
};

export async function pilotPlan(env = process.env, { fetcher = fetch, profileReader = profiles, retentionReader = readPreviewRetentionPolicy } = {}) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REF !== 'refs/heads/main' || !env.GH_TOKEN) throw new Error('Pilot planner requires trusted main controller');
  const ref = env.SOURCE_REF || 'main';
  const prNumber = Number(env.PR_NUMBER || 0), retirePrNumber = Number(env.RETIRE_PR_NUMBER || 0);
  const lane = pilotLaneFor(ref, prNumber, retirePrNumber);
  const rows = await profileReader(env, fetcher);
  const selected = rows.filter(p => (lane === 'retire' || p.enabled) && p.mode === 'parallel' && p.pilotLanes?.includes(lane === 'retire' ? 'preview' : lane));
  if (!selected.length) return { targets: [], sourceSha: '', sourceRef: ref, lane, shouldBuild: false };
  const repo = await github('', env.GH_TOKEN, fetcher);
  if (repo.full_name !== repository || !Number.isSafeInteger(repo.id) || repo.default_branch !== 'main') throw new Error('Canonical GitHub repository identity mismatch');
  let sha = '', branch = ref;
  if (lane === 'preview' || lane === 'retire') {
    const number = lane === 'retire' ? retirePrNumber : prNumber;
    const pr = await github(`/pulls/${number}`, env.GH_TOKEN, fetcher);
    let retireable = lane === 'retire' && retireablePilotPr(pr, repo, number);
    if (lane === 'retire' && !retireable && sameRepositoryPr(pr, repo, number, null, 'open')) {
      const policy = await retentionReader({ repository, repositoryId: repo.id }, { env, fetcher });
      retireable = !pullRequestIsLive(pr, policy);
    }
    if (lane === 'retire' ? !retireable :
        !sameRepositoryPr(pr, repo, number, ref, 'open') || pr.draft === true || pr.base.ref === 'github-actions') {
      throw new Error('Pilot PR is not an exact eligible same-repository source');
    }
    branch = pr.head.ref;
    if (lane === 'preview') {
      const policy = await retentionReader({ repository, repositoryId: repo.id }, { env, fetcher });
      if (!pullRequestIsLive(pr, policy)) throw new Error('Pilot PR is stale under saved retention policy');
      sha = pr.head.sha;
    }
  } else {
    const head = await github(`/git/ref/heads/${encodeURIComponent(ref)}`, env.GH_TOKEN, fetcher);
    sha = head.object?.sha;
    if (!shaPattern.test(sha || '')) throw new Error('Invalid branch head');
  }
  if (env.EXPECTED_SHA && (!shaPattern.test(env.EXPECTED_SHA) || (lane !== 'retire' && sha !== env.EXPECTED_SHA))) {
    throw new Error('Pilot source advanced since trusted event');
  }
  if (lane !== 'retire') {
    const item = await github(`/contents/${sourcePath}?ref=${sha}`, env.GH_TOKEN, fetcher);
    if (item.type !== 'file' || item.encoding !== 'base64' || typeof item.content !== 'string') throw new Error('Pilot source file unavailable');
    assertPilotSource(Buffer.from(item.content, 'base64').toString('utf8'));
  }
  const targets = selected.map(p => ({ id: p.id, lane, alias: pilotAlias(p.testOrigin, lane === 'retire' ? 'preview' : lane, lane === 'retire' ? retirePrNumber : prNumber), baseOrigin: p.testOrigin, prNumber: lane === 'retire' ? retirePrNumber : prNumber }));
  return { targets, sourceSha: sha, sourceRef: branch, lane, shouldBuild: lane !== 'retire' && targets.length > 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = await pilotPlan();
  for (const [key, value] of Object.entries({ targets: JSON.stringify(plan.targets), source_sha: plan.sourceSha, source_ref: plan.sourceRef, should_build: String(plan.shouldBuild) })) {
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
