import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPreviewHasOpenPullRequest, completeInventory, previewIdentity, reconcileOrphanPreviews as reconcileWithReport } from './orphan-preview-cleanup.mjs';

const config = { repository: 'owner/product', repositoryId: 42, projectId: 'prj_test', projectName: 'product', customEnvironmentId: 'env_develop', retentionPolicy: { version: 1, enabled: true, noOpenPrGraceHours: 0, pruneSupersededOpenPr: false, supersededGraceHours: 24, inactivePullRequestDays: null }, previewAliasSuffix: 'previews.dev.example.com' };
const reconcileOrphanPreviews = async (...args) => (await reconcileWithReport(...args)).removedIds;
const deployment = () => ({ id: 'dpl_test', projectId: config.projectId, readyState: 'READY', target: null, meta: { githubCommitOrg: 'owner', githubCommitRepo: 'product', githubCommitRef: 'feature/x', githubCommitSha: 'a'.repeat(40), githubPrId: '12', thingtimeDevelopPrPreview: '1' } });
const pr = (state = 'closed') => ({ number: 12, state, head: { ref: 'feature/x', sha: 'a'.repeat(40), repo: { id: 42, full_name: config.repository } }, base: { repo: { id: 42, full_name: config.repository } } });
function fixture({ detail = deployment(), open = [], aliases = [], domains = [], project = {}, change, failure, state = 'closed', others = [], updatedAt = new Date().toISOString(), closedAt = new Date().toISOString() } = {}) {
  const mutations = []; let reads = 0, deleted = false;
  const github = async (path) => {
    if (path === `/repos/${config.repository}`) return { full_name: config.repository, id: 42, default_branch: 'main' };
    if (path.endsWith('/pulls/12')) return { ...pr(state), updated_at: updatedAt, closed_at: closedAt, head: { ...pr(state).head, ref: detail.meta.githubCommitRef } };
    if (path.includes('/pulls?')) return typeof open === 'function' ? open() : open;
    throw new Error('Unexpected GitHub fixture path');
  };
  const vercel = async (path, options = {}) => {
    if (failure?.(path)) throw new Error('Synthetic unavailable inventory');
    if (options.method) {
      mutations.push([path, options.method]);
      if (options.method === 'DELETE') deleted = true;
      if (options.method === 'PATCH') detail.readyState = 'CANCELED';
      return null;
    }
    if (path.startsWith('/v7/deployments?')) return { deployments: [detail, ...others].map((item) => ({ uid: item.id, meta: item.meta, createdAt: item.createdAt })), pagination: { next: null } };
    if (path.startsWith('/v13/deployments/')) {
      const requested = path.split('/')[3].split('?')[0];
      if (requested !== detail.id) { const other = others.find((item) => item.id === requested); if (other) return structuredClone(other); }
      if (deleted) throw Object.assign(new Error('Missing'), { status: 404 });
      reads++; change?.(reads, detail); return structuredClone(detail);
    }
    if (path === `/v9/projects/${config.projectId}`) return { id: config.projectId, name: config.projectName, ...project };
    if (path.includes('/domains?')) return { domains };
    if (path.includes('/aliases?')) return { aliases };
    if (path.startsWith('/v4/aliases/')) return { projectId: config.projectId, alias: decodeURIComponent(path.split('/').at(-1)), deploymentId: detail.id };
    throw new Error(`Unexpected Vercel fixture path: ${path}`);
  };
  return { github, vercel, mutations };
}

test('deletes exact closed-PR deployment and immutable URL, idempotently accepting absent objects', async () => {
  const f = fixture({ aliases: [{ alias: 'pr-12.previews.dev.example.com' }] });
  assert.deepEqual(await reconcileOrphanPreviews(config, f), ['dpl_test']);
  assert.equal(f.mutations[0][1], 'DELETE');
  assert.deepEqual(await reconcileOrphanPreviews(config, f), []);
});
test('legacy policy and branch previews without PR metadata are included', async () => {
  const d = deployment(); delete d.meta.githubPrId; delete d.meta.thingtimeDevelopPrPreview;
  d.gitSource = { type: 'github', repoId: 42, ref: d.meta.githubCommitRef, sha: d.meta.githubCommitSha };
  assert.deepEqual(await reconcileOrphanPreviews(config, fixture({ detail: d })), [d.id]);
});
test('open PRs, including a new same-branch PR, protect previews', async () => {
  for (const settings of [{ state: 'open' }, { open: [pr('open')] }]) {
    const f = fixture(settings); assert.deepEqual(await reconcileOrphanPreviews(config, f), []); assert.equal(f.mutations.length, 0);
  }
});
test('PR reopen and alias promotion between planning and mutation abort deletion', async () => {
  let calls = 0;
  const f = fixture({ open: () => ++calls === 1 ? [] : [pr('open')] });
  assert.deepEqual(await reconcileOrphanPreviews(config, f), []); assert.equal(f.mutations.length, 0);
  const p = {}; const g = fixture({ project: p, change: (count) => { if (count === 2) p.targets = { production: { id: 'dpl_test' } }; } });
  assert.deepEqual(await reconcileOrphanPreviews(config, g), []); assert.equal(g.mutations.length, 0);
});
test('protects production, stable branches, gateway owners, foreign and unknown identities', async () => {
  const modifications = [
    (d) => d.target = 'production', (d) => d.meta.thingtimeGatewayOwner = 'true', (d) => { d.meta.githubCommitRef = 'main'; delete d.meta.githubPrId; },
    (d) => { d.meta.githubCommitRef = 'develop'; delete d.meta.githubPrId; }, (d) => { d.meta.githubCommitRef = 'staging'; delete d.meta.githubPrId; }, (d) => { d.meta.githubCommitRef = 'github-actions'; delete d.meta.githubPrId; },
    (d) => d.projectId = 'prj_other', (d) => d.meta.githubCommitOrg = 'foreign', (d) => d.meta.githubRepoId = '100',
    (d) => d.gitSource = { type: 'github', repoId: 99 }, (d) => d.meta.githubPrId = 'bad', (d) => d.customEnvironmentId = 'env_other',
    (d) => delete d.meta.githubCommitSha, (d) => delete d.meta.thingtimeDevelopPrPreview
  ];
  for (const modify of modifications) { const d = deployment(); modify(d); assert.equal(previewIdentity(d, config), null); }
});
test('protects canonical/custom domains, project targets and other PR aliases', async () => {
  for (const settings of [{ domains: [{ name: 'dev.example.com' }] }, { project: { targets: { production: { id: 'dpl_test' } } } }, { aliases: [{ alias: 'master.previews.example.com' }] }, { aliases: [{ alias: 'pr-99.previews.dev.example.com' }] }]) {
    const f = fixture(settings); assert.deepEqual(await reconcileOrphanPreviews(config, f), []); assert.equal(f.mutations.length, 0);
  }
});
test('failed inventories and mismatched PRs fail closed', async () => {
  const f = fixture({ failure: (path) => path.includes('/aliases?') });
  await assert.rejects(reconcileOrphanPreviews(config, f), /incomplete/); assert.equal(f.mutations.length, 0);
  const g = fixture(); const base = g.github; g.github = async (path) => path.endsWith('/pulls/12') ? { ...pr(), head: { ...pr().head, ref: 'different' } } : base(path);
  await assert.rejects(reconcileOrphanPreviews(config, g), /incomplete/); assert.equal(g.mutations.length, 0);
});
test('cancel active builds then recheck PR and target ownership before deletion', async () => {
  const d = deployment(); d.readyState = 'BUILDING'; const f = fixture({ detail: d });
  assert.deepEqual(await reconcileOrphanPreviews(config, f), [d.id]); assert.deepEqual(f.mutations.map((entry) => entry[1]), ['PATCH', 'DELETE']);
  let reads = 0; const g = fixture({ detail: { ...deployment(), readyState: 'BUILDING' }, open: () => ++reads > 2 ? [pr('open')] : [] });
  assert.deepEqual(await reconcileOrphanPreviews(config, g), []); assert.deepEqual(g.mutations.map((entry) => entry[1]), ['PATCH']);
});
test('pagination is complete and repeated, missing, failed or malformed pages fail closed', async () => {
  const seen = []; const rows = await completeInventory(async (path) => { seen.push(path); return path.includes('until=5') ? { deployments: [{ id: 2 }], pagination: { next: null } } : { deployments: [{ id: 1 }], pagination: { next: 5 } }; }, '/v7/deployments', 'deployments');
  assert.equal(rows.length, 2); assert.equal(seen.length, 2);
  await assert.rejects(completeInventory(async () => ({ deployments: [], pagination: { next: 5 } }), '/v7/deployments', 'deployments'), /cursor/);
  await assert.rejects(completeInventory(async () => ({ deployments: Array(100).fill({}) }), '/v7/deployments', 'deployments'), /cursor/);
  assert.equal((await completeInventory(async (path) => path.includes('page=2') ? [] : Array(100).fill(pr('open')), '/pulls', null, { github: true })).length, 100);
});
test('ordinary prebuilt previews require open PR, stable owners remain exempt', async () => {
  const f = fixture(); const plan = { target: { slug: 'preview' }, branch: 'feature/x' };
  await assert.rejects(assertPreviewHasOpenPullRequest(plan, config, f.github), /requires an open/);
  await assertPreviewHasOpenPullRequest({ ...plan, branch: 'main' }, config, f.github);
  await assertPreviewHasOpenPullRequest(plan, config, fixture({ open: [pr('open')] }).github);
});

test('latest ordinary preview bookkeeping pointer does not retain an orphan', async () => {
  const f = fixture({ project: { targets: { preview: { id: 'dpl_test' } } } });
  assert.deepEqual(await reconcileOrphanPreviews(config, f), ['dpl_test']);
});

test('explicit closed promotion snapshots on develop are previews; current owners survive', async () => {
  const d = deployment(); d.meta.githubCommitRef = 'develop';
  assert.deepEqual(await reconcileOrphanPreviews(config, fixture({ detail: d })), ['dpl_test']);
  d.meta.thingtimeGatewayOwner = 'true';
  assert.deepEqual(await reconcileOrphanPreviews(config, fixture({ detail: d })), []);
});
test('native Git metadata agrees with exact provider source and repository ID', () => {
  const d = deployment(); delete d.meta.thingtimeDevelopPrPreview; d.meta.githubCommitRepoId = '42';
  d.gitSource = { type: 'github', repoId: 42, ref: d.meta.githubCommitRef, sha: d.meta.githubCommitSha, prId: null };
  assert.equal(previewIdentity(d, config).number, 12);
  d.meta.githubCommitRepoId = '99'; assert.equal(previewIdentity(d, config), null);
});


test('saved superseded policy preserves newest READY head and waits for replacement grace', async () => {
  const now = Date.now(), old = { ...deployment(), createdAt: now - 72 * 3_600_000 };
  old.meta.githubCommitSha = 'b'.repeat(40);
  const keeper = { ...deployment(), id: 'dpl_keeper', createdAt: now - 30 * 3_600_000 };
  const configured = { ...config, retentionPolicy: { ...config.retentionPolicy, pruneSupersededOpenPr: true } };
  const f = fixture({ detail: old, others: [keeper], state: 'open', open: [pr('open')] });
  assert.deepEqual(await reconcileOrphanPreviews(configured, { ...f, now: () => now }), ['dpl_test']);
  assert.deepEqual(f.mutations.map(([path]) => path), ['/v13/deployments/dpl_test']);
  const g = fixture({ detail: old, others: [{ ...keeper, createdAt: now - 3_600_000 }], state: 'open', open: [pr('open')] });
  assert.deepEqual(await reconcileOrphanPreviews(configured, { ...g, now: () => now }), []);
});
test('closed grace retains previews and inactivity expiry resumes after fresh activity', async () => {
  const now = Date.now(), d = { ...deployment(), createdAt: now - 72 * 3_600_000 };
  const grace = { ...config, retentionPolicy: { ...config.retentionPolicy, noOpenPrGraceHours: 24 } };
  const f = fixture({ detail: d, closedAt: new Date(now - 3_600_000).toISOString() });
  const report = await reconcileWithReport(grace, { ...f, now: () => now });
  assert.deepEqual(report.removedIds, []); assert.deepEqual(report.retainedIds, ['dpl_test']); assert.equal(f.mutations.length, 0);
  const stale = { ...pr('open'), updated_at: new Date(now - 5 * 86_400_000).toISOString() };
  const expired = { ...config, retentionPolicy: { ...config.retentionPolicy, inactivePullRequestDays: 3 } };
  const g = fixture({ detail: d, state: 'open', open: [stale], updatedAt: stale.updated_at });
  assert.deepEqual(await reconcileOrphanPreviews(expired, { ...g, now: () => now }), ['dpl_test']);
  let calls = 0;
  const h = fixture({ detail: d, state: 'open', updatedAt: stale.updated_at, open: () => [++calls === 1 ? stale : { ...stale, updated_at: new Date(now).toISOString() }] });
  assert.deepEqual(await reconcileOrphanPreviews(expired, { ...h, now: () => now }), []); assert.equal(h.mutations.length, 0);
});

test('disabling canonical cleanup during a run stops the next destructive fence', async () => {
  let reads = 0;
  const configured = { ...config, refreshRetentionPolicy: async () => { reads++; return { ...config.retentionPolicy, enabled: false }; } };
  const f = fixture();
  const result = await reconcileWithReport(configured, f);
  assert.equal(result.disabled, true); assert.deepEqual(result.removedIds, []); assert.equal(f.mutations.length, 0); assert.equal(reads, 1);
});

test('stable provider compatibility aliases protect their deployment', async () => {
  const configured = { ...config, teamSlug: 'team' };
  for (const alias of ['product-team.vercel.app', 'product-git-main-team.vercel.app', 'product-git-develop-team.vercel.app']) {
    const f = fixture({ aliases: [{ alias }] });
    assert.deepEqual(await reconcileOrphanPreviews(configured, f), []); assert.equal(f.mutations.length, 0);
  }
});

test('a different preview environment or PR cannot replace this lane current head', async () => {
  const now = Date.now(), old = { ...deployment(), createdAt: now - 72 * 3_600_000, customEnvironment: { id: 'env_develop' } };
  const configured = { ...config, retentionPolicy: { ...config.retentionPolicy, pruneSupersededOpenPr: true, supersededGraceHours: 0 } };
  for (const keeper of [
    { ...deployment(), id: 'dpl_keeper', createdAt: now - 30 * 3_600_000 },
    { ...deployment(), id: 'dpl_keeper', createdAt: now - 30 * 3_600_000, customEnvironment: { id: 'env_develop' }, meta: { ...deployment().meta, thingtimeAdminPrPreview: '1', thingtimePreviewEnvironment: 'develop' } },
    { ...deployment(), id: 'dpl_keeper', createdAt: now - 30 * 3_600_000, customEnvironment: { id: 'env_develop' }, meta: { ...deployment().meta, githubPrId: '99' } }
  ]) {
    const f = fixture({ detail: old, others: [keeper], state: 'open', open: [pr('open')] });
    const base = f.github; f.github = async (path) => path.endsWith('/pulls/99') ? { ...pr('open'), number: 99 } : base(path);
    await reconcileOrphanPreviews(configured, { ...f, now: () => now });
    assert.ok(!f.mutations.some(([path]) => path === '/v13/deployments/dpl_test'));
  }
});

test('unaliased newer READY cannot evict the published current PR alias', async () => {
  const now = Date.now(), old = { ...deployment(), createdAt: now - 72 * 3_600_000 };
  const keeper = { ...deployment(), id: 'dpl_keeper', createdAt: now - 30 * 3_600_000 };
  const configured = { ...config, retentionPolicy: { ...config.retentionPolicy, pruneSupersededOpenPr: true, supersededGraceHours: 0 } };
  const f = fixture({ detail: old, others: [keeper], state: 'open', open: [pr('open')], aliases: [{ alias: 'pr-12.previews.dev.example.com' }] });
  assert.deepEqual(await reconcileOrphanPreviews(configured, { ...f, now: () => now }), []);
  assert.equal(f.mutations.length, 0);
});
