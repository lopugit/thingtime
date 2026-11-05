import { parsePreviewRetentionPolicy, pullRequestIsLive, previewGraceElapsed } from './preview-retention-policy.mjs';
// Shared by protected preview lifecycle and prebuilt publisher. No credentials,
// source code execution, aliases or provider state are supplied by a PR.
const ACTIVE = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
const TERMINAL = new Set(['READY', 'ERROR', 'CANCELED', 'BLOCKED']);
const protectedBranches = (config) => new Set(['main', 'master', 'develop', 'staging', 'github-actions', 'thingtime-preview-fallback', config.defaultBranch]);
const idOf = (value) => value?.id ?? value?.uid;
const missing = (error) => error?.status === 404;

export async function completeInventory(request, path, field, { github = false } = {}) {
  const rows = [], cursors = new Set();
  for (let page = 1, until = null; page <= 1000; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const result = await request(`${path}${separator}${github ? `per_page=100&page=${page}` : `limit=100${until === null ? '' : `&until=${until}`}`}`);
    const batch = github ? result : result?.[field];
    if (!Array.isArray(batch)) throw new Error('Incomplete preview cleanup inventory');
    rows.push(...batch);
    if (github) { if (batch.length < 100) return rows; continue; }
    const next = result.pagination?.next;
    if (next === null || next === undefined) {
      if (batch.length >= 100) throw new Error('Missing preview cleanup pagination cursor');
      return rows;
    }
    if (!Number.isSafeInteger(next) || next <= 0 || cursors.has(next) || (until !== null && next >= until)) throw new Error('Invalid preview cleanup pagination cursor');
    cursors.add(next); until = next;
  }
  throw new Error('Preview cleanup inventory safety bound exceeded');
}

function sameRepository(pr, config) {
  return pr?.base?.repo?.full_name === config.repository && Number(pr.base.repo.id) === Number(config.repositoryId) &&
    pr?.head?.repo?.full_name === config.repository && Number(pr.head.repo.id) === Number(config.repositoryId);
}

export async function openBranchPullRequests(config, branch, github) {
  const owner = config.repository.split('/')[0];
  const rows = await completeInventory(github, `/repos/${config.repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, null, { github: true });
  for (const pr of rows) {
    // Forks can share branch names, but do not confer ownership of this branch.
    if (pr?.state !== 'open' || !Number.isSafeInteger(pr.number) || !pr.head?.ref || !pr.head.repo || !pr.base?.repo) throw new Error('Invalid open PR inventory');
  }
  return rows.filter((pr) => sameRepository(pr, config) && pr.head.ref === branch);
}

export function previewIdentity(deployment, config) {
  if (!/^dpl_[A-Za-z0-9]+$/.test(deployment?.id || '') || deployment.projectId !== config.projectId) return null;
  const meta = deployment.meta || {}, source = deployment.gitSource;
  const branch = meta.githubCommitRef, sha = meta.githubCommitSha;
  if (typeof branch !== 'string' || !branch || /[\x00-\x1f\x7f]/.test(branch) || !/^[a-f0-9]{40}$/.test(sha || '')) return null;
  if (deployment.target === 'production' || (deployment.target != null && deployment.target !== 'preview')) return null;
  if (meta.thingtimeGatewayOwner != null && meta.thingtimeGatewayOwner !== 'false') return null;
  const [owner, repo] = config.repository.split('/');
  if (meta.githubCommitOrg !== owner || meta.githubCommitRepo !== repo) return null;
  if (meta.githubCommitRepoId != null && String(meta.githubCommitRepoId) !== String(config.gitRepoId || config.repositoryId)) return null;
  if (meta.githubRepoId != null && String(meta.githubRepoId) !== String(config.gitRepoId || config.repositoryId)) return null;
  if (meta.githubRepositoryId != null && String(meta.githubRepositoryId) !== String(config.repositoryId)) return null;
  if (source && (source.type !== 'github' || String(source.repoId) !== String(config.gitRepoId || config.repositoryId) || source.ref !== branch || source.sha !== sha)) return null;
  const managed = meta.thingtimeGithubActionsBuild === '1' || meta.thingtimeDevelopPrPreview === '1' || meta.thingtimeAdminPrPreview === '1';
  if (!source && !managed) return null;
  const custom = deployment.customEnvironment?.id || deployment.customEnvironmentId;
  if (deployment.customEnvironment?.id && deployment.customEnvironmentId && deployment.customEnvironment.id !== deployment.customEnvironmentId) return null;
  if (custom && (custom !== config.customEnvironmentId || !(meta.thingtimeDevelopPrPreview === '1' || meta.thingtimeAdminPrPreview === '1'))) return null;
  const rawNumber = meta.githubPrId ?? source?.prId;
  if (meta.githubPrId != null && source?.prId != null && String(meta.githubPrId) !== String(source.prId)) return null;
  const number = rawNumber == null ? null : Number(rawNumber);
  if (number !== null && (!/^[1-9][0-9]*$/.test(String(rawNumber)) || !Number.isSafeInteger(number))) return null;
  // Stable branch names alone are protected. Explicit PR-tagged snapshots of
  // a closed promotion remain previews; current owners/aliases are fenced below.
  if (protectedBranches(config).has(branch) && number === null) return null;
  return { branch, sha, number };
}

const deploymentLane = (deployment) => JSON.stringify({
  target: deployment.target || 'preview',
  custom: deployment.customEnvironment?.id || deployment.customEnvironmentId || null,
  publisher: deployment.meta?.thingtimeAdminPrPreview === '1' ? 'admin' : deployment.meta?.thingtimeDevelopPrPreview === '1' ? 'develop-pr' : deployment.meta?.thingtimeGithubActionsBuild === '1' ? 'prebuilt' : 'native',
  environment: deployment.meta?.thingtimePreviewEnvironment || deployment.meta?.thingtimeBuildTarget || null,
  gateway: deployment.meta?.thingtimeGatewayEnvironment || null,
  origin: deployment.meta?.thingtimeGatewayOrigin || null
});

async function retentionDecision(identity, deployment, config, github, vercel, summaries, policy, now) {
  let tagged = null;
  if (identity.number !== null) {
    tagged = await github(`/repos/${config.repository}/pulls/${identity.number}`);
    if (!sameRepository(tagged, config) || tagged.number !== identity.number || tagged.head.ref !== identity.branch || !['open', 'closed'].includes(tagged.state)) throw new Error('Preview PR ownership changed or unknown');
  }
  const open = await openBranchPullRequests(config, identity.branch, github);
  if (tagged?.state === 'open' && !open.some((pr) => pr.number === tagged.number)) open.push(tagged);
  const live = open.filter((pr) => pullRequestIsLive(pr, policy, now));
  if (!live.length) {
    if (open.length) return true; // Explicit inactivity expiry; never close the PR.
    return previewGraceElapsed(deployment, policy, tagged, now);
  }
  if (!policy.pruneSupersededOpenPr || ACTIVE.has(deployment.readyState)) return false;
  // READY alone does not prove publisher health/alias acceptance. Keep the
  // currently published live-PR owner until publication moves its aliases.
  const published = await completeInventory(vercel, `/v2/deployments/${deployment.id}/aliases`, 'aliases');
  if (published.length) return false;
  // Never prune the last READY current-head preview. Summary metadata only
  // selects candidates: keeper identity is independently read and verified.
  const created = Number(deployment.createdAt ?? deployment.created);
  if (!Number.isFinite(created) || created <= 0) throw new Error('Superseded preview age unavailable');
  const heads = new Set(live.map((pr) => pr.head.sha));
  for (const summary of summaries) {
    const id = idOf(summary);
    if (id === deployment.id || !heads.has(summary.meta?.githubCommitSha) || summary.meta?.githubCommitRef !== identity.branch) continue;
    let keeper;
    try { keeper = await vercel(`/v13/deployments/${id}?withGitRepoInfo=true`); }
    catch (error) { if (missing(error)) continue; throw error; }
    const source = previewIdentity(keeper, config), keeperCreated = Number(keeper.createdAt ?? keeper.created);
    if (!source || source.number !== identity.number || deploymentLane(keeper) !== deploymentLane(deployment) || source.branch !== identity.branch || !heads.has(source.sha) || keeper.readyState !== 'READY' || !Number.isFinite(keeperCreated) || keeperCreated <= 0) continue;
    if (heads.has(identity.sha) && keeperCreated <= created) continue;
    return now - Math.max(created, keeperCreated) >= policy.supersededGraceHours * 3_600_000;
  }
  return false;
}

async function safeAliases(deployment, identity, config, vercel) {
  // Check both current project target pointers and all bound project domains.
  const project = await vercel(`/v9/projects/${config.projectId}`);
  if (project?.id !== config.projectId || project.name !== config.projectName) throw new Error('Cleanup project identity mismatch');
  if (Object.entries(project.targets || {}).some(([target, value]) => target !== 'preview' && idOf(value) === deployment.id)) return false;
  const domains = await completeInventory(vercel, `/v9/projects/${config.projectId}/domains`, 'domains');
  for (const domain of domains) {
    if (typeof domain.name !== 'string') throw new Error('Invalid cleanup project domain');
    if (domain.name.startsWith('*.')) continue;
    let binding;
    try { binding = await vercel(`/v4/aliases/${encodeURIComponent(domain.name)}`); }
    catch (error) { if (missing(error)) continue; throw error; }
    if (binding.projectId !== config.projectId || binding.alias !== domain.name) throw new Error('Cleanup domain ownership mismatch');
    if (binding.deploymentId === deployment.id) return false;
  }
  const aliases = await completeInventory(vercel, `/v2/deployments/${deployment.id}/aliases`, 'aliases');
  const suffixes = [config.previewAliasSuffix, config.productionPreviewAliasSuffix].filter(Boolean);
  for (const alias of aliases) {
    const name = alias.alias;
    if (typeof name !== 'string' || alias.deploymentId && alias.deploymentId !== deployment.id || alias.projectId && alias.projectId !== config.projectId) throw new Error('Cleanup alias ownership mismatch');
    // Arbitrary custom domains, gateway aliases, and other PRs always survive.
    if (config.teamSlug && name === `${config.projectName}-${config.teamSlug}.vercel.app`) return false;
    if ([...protectedBranches(config)].filter(Boolean).some((branch) => name.startsWith(`${config.projectName}-git-${branch}-`) && name.endsWith('.vercel.app'))) return false;
    if (name.endsWith('.vercel.app')) continue;
    if (!identity.number || !suffixes.some((suffix) => name === `pr-${identity.number}.${suffix}`)) return false;
  }
  return true;
}

export async function reconcileOrphanPreviews(config, { github, vercel, prNumber = null, prBranch = null, deploymentIds = null, now = Date.now }) {
  let policy = parsePreviewRetentionPolicy({ ok: true, repository: config.repository, policy: config.retentionPolicy }, config.repository);
  if (!policy.enabled) {
    console.log('Preview retention reconciliation disabled by saved policy');
    return { disabled: true, removedIds: [], retainedIds: null };
  }
  const repository = await github(`/repos/${config.repository}`);
  if (repository?.full_name !== config.repository || Number(repository.id) !== Number(config.repositoryId) || !repository.default_branch) throw new Error('Cleanup repository identity mismatch');
  config = { ...config, defaultBranch: repository.default_branch };
  const summaries = deploymentIds ? deploymentIds.map((id) => ({ id })) : await completeInventory(vercel, `/v7/deployments?projectId=${encodeURIComponent(config.projectId)}`, 'deployments');
  const failures = [], removed = [], retained = new Set(), ids = new Set(summaries.map(idOf));
  if ([...ids].some((id) => !/^dpl_[A-Za-z0-9]+$/.test(id || ''))) throw new Error('Invalid cleanup deployment identifier');
  for (const id of ids) {
    if (!policy.enabled) break;
    try {
      let deployment;
      try { deployment = await vercel(`/v13/deployments/${id}?withGitRepoInfo=true`); }
      catch (error) { if (missing(error)) continue; throw error; }
      const identity = previewIdentity(deployment, config);
      const scoped = prNumber === null || String(deployment.meta?.githubPrId) === String(prNumber) || deployment.meta?.githubPrId == null && deployment.meta?.githubCommitRef === prBranch;
      if (!scoped) continue;
      retained.add(id);
      if (!identity || !await retentionDecision(identity, deployment, config, github, vercel, summaries, policy, now())) continue;
      if (!await safeAliases(deployment, identity, config, vercel)) continue;
      // Re-read immutable source/project identity, PR state and aliases at each
      // destructive boundary. Failed reads never mean "no PR" or "no alias".
      const fenced = async () => {
        if (config.refreshRetentionPolicy) policy = parsePreviewRetentionPolicy({ ok: true, repository: config.repository, policy: await config.refreshRetentionPolicy() }, config.repository);
        if (!policy.enabled) return false;
        deployment = await vercel(`/v13/deployments/${id}?withGitRepoInfo=true`);
        if (JSON.stringify(previewIdentity(deployment, config)) !== JSON.stringify(identity)) throw new Error('Cleanup deployment identity changed');
        return await safeAliases(deployment, identity, config, vercel) && await retentionDecision(identity, deployment, config, github, vercel, summaries, policy, now());
      };
      if (!await fenced()) continue;
      if (ACTIVE.has(deployment.readyState)) {
        await vercel(`/v12/deployments/${id}/cancel`, { method: 'PATCH', retries: 0, accept: [200, 404, 409] });
        if (!await fenced()) continue;
      }
      if (!TERMINAL.has(deployment.readyState)) continue; // Next sweep finishes a still-canceling upload.
      try { await vercel(`/v13/deployments/${id}`, { method: 'DELETE', retries: 0, accept: [200, 204, 404] }); }
      catch (error) { if (!missing(error)) throw error; }
      try { await vercel(`/v13/deployments/${id}`); throw new Error('Deleted preview still exists'); }
      catch (error) { if (!missing(error)) throw error; }
      removed.push(id); retained.delete(id);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Orphan preview cleanup incomplete; unknown resources preserved');
  console.log(`Preview retention reconciliation: removed=${removed.length}; retained=${retained.size}; enabled=${policy.enabled}`);
  return { disabled: !policy.enabled, removedIds: removed, retainedIds: [...retained] };
}

export async function assertPreviewHasOpenPullRequest(plan, config, github) {
  if (plan.target.slug !== 'preview' || protectedBranches(config).has(plan.branch)) return;
  const policy = parsePreviewRetentionPolicy({ ok: true, repository: config.repository, policy: config.retentionPolicy }, config.repository);
  if (!(await openBranchPullRequests(config, plan.branch, github)).some((pr) => pullRequestIsLive(pr, policy))) throw new Error('Preview publication requires an open same-repository PR');
}
