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

async function orphaned(identity, config, github) {
  if (identity.number !== null) {
    // A missing/deleted PR or unknown provenance is not deletion authority.
    const pr = await github(`/repos/${config.repository}/pulls/${identity.number}`);
    if (!sameRepository(pr, config) || pr.number !== identity.number || pr.head.ref !== identity.branch || !['open', 'closed'].includes(pr.state)) throw new Error('Preview PR ownership changed or unknown');
    if (pr.state === 'open') return false;
  }
  // A new/reopened PR using the same branch protects old deployments too.
  return (await openBranchPullRequests(config, identity.branch, github)).length === 0;
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
    if (name.endsWith('.vercel.app')) continue;
    if (!identity.number || !suffixes.some((suffix) => name === `pr-${identity.number}.${suffix}`)) return false;
  }
  return true;
}

export async function reconcileOrphanPreviews(config, { github, vercel, prNumber = null, prBranch = null, deploymentIds = null }) {
  const repository = await github(`/repos/${config.repository}`);
  if (repository?.full_name !== config.repository || Number(repository.id) !== Number(config.repositoryId) || !repository.default_branch) throw new Error('Cleanup repository identity mismatch');
  config = { ...config, defaultBranch: repository.default_branch };
  const summaries = deploymentIds ? deploymentIds.map((id) => ({ id })) : await completeInventory(vercel, `/v7/deployments?projectId=${encodeURIComponent(config.projectId)}`, 'deployments');
  const failures = [], removed = [];
  for (const id of new Set(summaries.map(idOf))) {
    if (!/^dpl_[A-Za-z0-9]+$/.test(id || '')) throw new Error('Invalid cleanup deployment identifier');
    try {
      let deployment;
      try { deployment = await vercel(`/v13/deployments/${id}?withGitRepoInfo=true`); }
      catch (error) { if (missing(error)) continue; throw error; }
      const identity = previewIdentity(deployment, config);
      if (!identity || prNumber !== null && identity.number !== prNumber && !(identity.number === null && identity.branch === prBranch) || !await orphaned(identity, config, github)) continue;
      if (!await safeAliases(deployment, identity, config, vercel)) continue;
      // Re-read immutable source/project identity, PR state and aliases at each
      // destructive boundary. Failed reads never mean "no PR" or "no alias".
      const fenced = async () => {
        deployment = await vercel(`/v13/deployments/${id}?withGitRepoInfo=true`);
        if (JSON.stringify(previewIdentity(deployment, config)) !== JSON.stringify(identity)) throw new Error('Cleanup deployment identity changed');
        return await safeAliases(deployment, identity, config, vercel) && await orphaned(identity, config, github);
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
      removed.push(id);
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Orphan preview cleanup incomplete; unknown resources preserved');
  console.log(`Orphan preview cleanup removed ${removed.length} deployment(s)`);
  return removed;
}

export async function assertPreviewHasOpenPullRequest(plan, config, github) {
  if (plan.target.slug !== 'preview' || protectedBranches(config).has(plan.branch)) return;
  if (!(await openBranchPullRequests(config, plan.branch, github)).length) throw new Error('Preview publication requires an open same-repository PR');
}
