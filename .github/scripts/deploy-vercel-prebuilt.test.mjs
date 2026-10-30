import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish, needsReleaseBuild, verifyAlias, verifyCanonicalGateway, compatibilityAliasCandidates, applyOutputPolicy, policyVersion, runtimePolicyIssue, deploymentArgs, deploymentIssue, marker, planOutputs, publisherEnvironment, selectTarget, sourceFromEvent } from './deploy-vercel-prebuilt.mjs';

import { gatewayMetadata, gatewayPolicy } from './environment-gateway-policy.mjs';

const custom = [{ id: 'env_develop', slug: 'develop', branchMatcher: { type: 'equals', pattern: 'develop' } }];
test('a READY artifact still reconciles its aliases and status without rebuilding', () => {
  const plan = { sha: 'a'.repeat(40), branch: 'main', target: { slug: 'production', kind: 'production', id: '' } };
  assert.equal(planOutputs(plan, null).should_build, 'true');
  const ready = planOutputs(plan, { id: 'dpl_ready' });
  assert.equal(ready.should_build, 'false');
  assert.equal(ready.should_publish, 'true');
  assert.equal(ready.source_sha, plan.sha);
  assert.equal(ready.target_slug, 'production');
});
test('publisher supplies the paired CLI identifiers and overrides inherited project context', () => {
  const environment = publisherEnvironment({ teamId: 'team_authorized', projectId: 'prj_authorized', token: 'synthetic-test-token' }, { VERCEL_PROJECT_ID: 'prj_other', VERCEL_ORG_ID: 'team_other', CI: 'true' });
  assert.equal(environment.VERCEL_ORG_ID, 'team_authorized');
  assert.equal(environment.VERCEL_PROJECT_ID, 'prj_authorized');
  assert.equal(environment.VERCEL_TOKEN, 'synthetic-test-token');
  assert.equal(environment.CI, 'true');
});
test('all targets resolve explicitly and production cannot receive feature code', () => {
  assert.deepEqual(selectTarget('main', 'main', custom), { slug: 'production', kind: 'production', id: '' });
  assert.deepEqual(selectTarget('develop', 'main', custom), { slug: 'develop', kind: 'preview', id: 'env_develop' });
  assert.deepEqual(selectTarget('staging', 'main', custom), { slug: 'preview', kind: 'preview', id: '' });
  assert.equal(selectTarget('feature/x', 'main', custom).slug, 'preview');
  assert.throws(() => selectTarget('feature/x', 'main', custom, 'production'), /Production/);
  assert.throws(() => selectTarget('feature/x', 'main', custom, 'develop'), /configured branch/);
  assert.throws(() => selectTarget('github-actions', 'main', custom), /product branch/);
  assert.throws(() => selectTarget('main', 'main', custom, 'missing'), /Unknown/);
  for (const type of ['startsWith', 'endsWith']) {
    assert.equal(selectTarget('staging', 'main', [{ id: 'env_staging', slug: 'staging', branchMatcher: { type, pattern: type === 'startsWith' ? 'stag' : 'ing' } }]).slug, 'staging');
  }
  assert.throws(() => selectTarget('develop', 'main', [...custom, ...custom]), /Ambiguous/);
});

test('legacy branch wakeups admit only same-repository push events', () => {
  const event = { action: 'requested', repository: { full_name: 'owner/product' }, workflow_run: { event: 'push', head_repository: { full_name: 'owner/product' }, head_branch: 'develop', head_sha: 'a'.repeat(40) } };
  assert.equal(sourceFromEvent('workflow_run', event).branch, 'develop');
  assert.deepEqual(sourceFromEvent('workflow_run', { ...event, action: 'completed' }), { skip: true });
  assert.deepEqual(sourceFromEvent('workflow_run', { ...event, workflow_run: { ...event.workflow_run, event: 'pull_request' } }), { skip: true });
  assert.deepEqual(sourceFromEvent('workflow_run', { ...event, workflow_run: { ...event.workflow_run, head_repository: { full_name: 'attacker/fork' } } }), { skip: true });
  assert.equal(sourceFromEvent('push', { ref: 'refs/heads/main', after: 'b'.repeat(40) }).branch, 'main');
  assert.equal(sourceFromEvent('push', { deleted: true }).skip, true);
  assert.throws(() => sourceFromEvent('pull_request_target', {}), /Unsupported/);
});

test('every environment uploads only prebuilt output and stamps exact source identity', () => {
  for (const branch of ['main', 'develop', 'feature/x']) {
    const target = selectTarget(branch, 'main', custom);
    const args = deploymentArgs({ target, branch, sha: 'a'.repeat(40), directory: '/prebuilt', teamSlug: 'team', runId: '123', repository: 'owner/product', regions: ['syd1'] });
    assert.ok(args.includes('--prebuilt'));
    assert.ok(args.includes('--archive=tgz'));
    assert.equal(args[args.indexOf('--regions') + 1], 'syd1');
    assert.ok(args.includes('THINGTIME_GIT_COMMIT_SHA=' + 'a'.repeat(40)));
    assert.equal(args.includes('--prod'), branch === 'main');
    assert.equal(args.includes('--skip-domain'), branch === 'main');
    if (branch !== 'main') assert.ok(args.includes(`--target=${target.slug}`));
    assert.ok(!args.includes('--build-env'));
  }
});

test('deployment evidence rejects mismatched source, project and environments', () => {
  const plan = { branch: 'develop', sha: 'a'.repeat(40), target: selectTarget('develop', 'main', custom), projectId: 'prj_thingtime' };
  const deployment = { projectId: plan.projectId, customEnvironment: { id: 'env_develop' }, target: null, meta: { ...gatewayMetadata(gatewayPolicy(plan)), [marker]: '1', thingtimePrebuiltPolicy: policyVersion, githubCommitRef: plan.branch, githubCommitSha: plan.sha, thingtimeBuildTarget: 'develop' } };
  assert.equal(deploymentIssue(deployment, plan), null);
  assert.equal(deploymentIssue({ ...deployment, target: 'production' }, plan), 'production-target');
  assert.equal(deploymentIssue({ ...deployment, customEnvironment: null }, plan), 'custom-environment');
  assert.equal(deploymentIssue({ ...deployment, meta: { ...deployment.meta, githubCommitSha: 'b'.repeat(40) } }, plan), 'source');
  assert.equal(deploymentIssue({ ...deployment, projectId: 'prj_other' }, plan), 'project');
  assert.equal(deploymentIssue({ ...deployment, meta: { ...deployment.meta, [marker]: '0' } }, plan), 'build-marker');
});

test('build job has no secrets/environment and publisher executes only protected controller code', () => {
  const yaml = readFileSync(new URL('../workflows/deploy-vercel-prebuilt.yml', import.meta.url), 'utf8');
  const build = yaml.split('\n  build:\n')[1].split('\n  publish:\n')[0];
  assert.doesNotMatch(build, /secrets\.|environment:/);
  assert.match(build, /runs-on: ubuntu-latest/);
  assert.match(build, /persist-credentials: false/);
  const publish = yaml.split('\n  publish:\n')[1];
  assert.match(publish, /should_publish == 'true'/);
  assert.match(publish, /needs\.build\.result == 'skipped'/);
  assert.match(publish, /ref: github-actions/);
  assert.match(publish, /extract-vercel-prebuilt.py/);
  assert.doesNotMatch(publish, /run: (?:node scripts\/|.*vercel build)/);
  // Shared installation-token quotas must not strand a READY deployment before
  // its final branch check or status receipt. Only protected jobs use the same
  // automation credential fallback as the existing PR preview controller.
  assert.equal((yaml.match(/GH_TOKEN: \$\{\{ secrets\.CONFLICT_RESOLVER_PAT \|\| github\.token \}\}/g) || []).length, 3);
});

test('prebuilt output carries trusted production crons and function regions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'prebuilt-policy-'));
  try {
    const output = join(dir, '.vercel/output');
    const fn = join(output, 'functions/server.func');
    await mkdir(fn, { recursive: true });
    await writeFile(join(output, 'config.json'), JSON.stringify({ version: 3, routes: [{ handle: 'filesystem' }], crons: [{ path: '/untrusted', schedule: '* * * * *' }] }));
    await writeFile(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', regions: ['iad1'] }));
    await symlink('server.func', join(output, 'functions/alias.func'));
    const trusted = { regions: ['syd1'], crons: [{ path: '/api/cron', schedule: '17 * * * *' }] };
    await applyOutputPolicy(dir, trusted, { kind: 'production' });
    const config = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
    assert.deepEqual(config.crons, trusted.crons);
    assert.deepEqual(config.routes, [{ handle: 'filesystem' }]);
    assert.deepEqual(JSON.parse(await readFile(join(fn, '.vc-config.json'), 'utf8')).regions, ['syd1']);
    assert.equal(runtimePolicyIssue({ regions: ['syd1'], crons: trusted.crons }, trusted, { kind: 'production' }), null);
    assert.equal(runtimePolicyIssue({ regions: ['syd1'], crons: [] }, trusted, { kind: 'production' }), 'crons');
    assert.equal(runtimePolicyIssue({ regions: ['iad1'], crons: trusted.crons }, trusted, { kind: 'production' }), 'regions');
    await applyOutputPolicy(dir, trusted, { kind: 'preview' });
    assert.equal(JSON.parse(await readFile(join(output, 'config.json'), 'utf8')).crons, undefined);
    assert.equal(runtimePolicyIssue({ regions: ['syd1'] }, trusted, { kind: 'preview' }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('legacy alias candidates are bounded and production alone includes the project alias', () => {
  const input = { branch: 'staging', projectName: 'thingtime', teamSlug: 'team', target: { kind: 'preview' } };
  assert.deepEqual(compatibilityAliasCandidates(input), ['thingtime-git-staging-team.vercel.app']);
  assert.deepEqual(compatibilityAliasCandidates({ ...input, branch: 'main', target: { kind: 'production' } }), ['thingtime-git-main-team.vercel.app', 'thingtime-team.vercel.app']);
  assert.deepEqual(compatibilityAliasCandidates({ ...input, branch: 'feature/slash' }), []);
  assert.deepEqual(compatibilityAliasCandidates({ ...input, branch: 'x'.repeat(64) }), []);
});

test('alias propagation retries only reads and stops on persistent failure', async () => {
  let reads = 0;
  const delays = [];
  assert.equal(await verifyAlias(async () => {
    if (++reads < 3) throw new Error('old shell references missing asset');
    return 'ready';
  }, async (ms) => { delays.push(ms); }), 'ready');
  assert.equal(reads, 3);
  assert.deepEqual(delays, [2000, 5000]);
  let failures = 0;
  const observations = [];
  await assert.rejects(verifyAlias(async () => { failures++; throw new Error('persistent'); }, async () => {}, { now: () => 0, onFailure: value => observations.push(value) }), /persistent/);
  assert.equal(failures, 8);
  assert.equal(observations.at(-1).elapsedMs, 77000);
});


test('preview master has a separate secretless preview build and all uploads snapshot aliases first', () => {
  const yaml = readFileSync(new URL('../workflows/deploy-vercel-prebuilt.yml', import.meta.url), 'utf8');
  const masterBuild = yaml.split('- name: Build controlled preview master')[1].split('  publish:')[0];
  assert.match(masterBuild, /VERCEL_ENV: preview/);
  assert.match(masterBuild, /VERCEL_TARGET_ENV: preview/);
  assert.match(masterBuild, /vercel-preview-master-/);
  assert.doesNotMatch(masterBuild, /secrets\./);
  const source = readFileSync(new URL('./deploy-vercel-prebuilt.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('const aliasBefore =') < source.indexOf("await exec(required('VERCEL_CLI_PATH')"));
  assert.match(source, /Canonical gateway domain missing from project mapping/);
  const prSource = readFileSync(new URL('./deploy-develop-pr-preview.mjs', import.meta.url), 'utf8');
  const reconciliation = prSource.split('const reconcileStableDevelopAlias =')[1].split('const prepareDeployment =')[0];
  assert.doesNotMatch(reconciliation, /assignStableDevelopAlias|method: 'POST'/);
  assert.match(reconciliation, /stablePublisherDeploymentIssue/);
});


test('partial production success rebuilds the missing preview artifact before retry publication', () => {
  const plan = { target: { kind: 'production' } };
  assert.equal(needsReleaseBuild(plan, { id: 'production-ready' }, null), true);
  assert.equal(needsReleaseBuild(plan, { id: 'production-ready' }, { id: 'master-ready' }), false);
  assert.equal(needsReleaseBuild(plan, null, { id: 'master-ready' }), true);
  assert.equal(needsReleaseBuild({ target: { kind: 'preview' } }, { id: 'preview-ready' }, null), false);
});


test('bootstrap can request secretless artifacts without enabling any publication job', () => {
  const yaml = readFileSync(new URL('../workflows/deploy-vercel-prebuilt.yml', import.meta.url), 'utf8');
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /build_only:/);
  assert.match(yaml, /BUILD_ONLY: \$\{\{ inputs.build_only \}\}/);
  const source = readFileSync(new URL('./deploy-vercel-prebuilt.mjs', import.meta.url), 'utf8');
  assert.match(source, /BUILD_ONLY === 'true'[\s\S]*should_publish: 'false'/);
});


test('two-phase promotion binds owners, rejects preflight failures, rolls back failed health and reuses READY output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'publisher-ready-reuse-'));
  const summary = join(directory, 'summary.md');
  const environment = {
    GITHUB_REPOSITORY: 'lopugit/thingtime', GITHUB_API_URL: 'https://api.github.com',
    GH_TOKEN: 'synthetic-github', VERCEL_API_TOKEN: 'synthetic-vercel',
    VERCEL_TEAM_ID: 'team_test', VERCEL_TEAM_SLUG: 'team',
    VERCEL_PROJECT_ID: 'prj_test', VERCEL_PROJECT_NAME: 'thingtime',
    SOURCE_REF: 'main', SOURCE_SHA: 'a'.repeat(40), TARGET_ENVIRONMENT: 'production', TARGET_ID: '',
    GITHUB_RUN_ID: '123', GITHUB_STEP_SUMMARY: summary, VERCEL_CLI_PATH: '/verified/vercel'
  };
  const originalEnvironment = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const sha = environment.SOURCE_SHA;
  const policy = gatewayPolicy({ branch: 'main', target: { slug: 'production' } });
  const deployment = {
    id: 'dpl_ready', projectId: 'prj_test', url: 'thingtime-ready.vercel.app', readyState: 'READY',
    target: 'production', regions: ['syd1'], crons: [],
    meta: { ...gatewayMetadata(policy), [marker]: '1', thingtimePrebuiltPolicy: policyVersion,
      thingtimeBuildTarget: 'production', githubCommitSha: sha, githubCommitRef: 'main' }
  };
  const bindings = new Map([
    ['thingtime.com', { projectId: 'prj_test', alias: 'thingtime.com', deploymentId: 'dpl_previous' }],
    ['www.thingtime.com', { projectId: 'prj_test', alias: 'www.thingtime.com', deploymentId: 'dpl_previous_www' }]
  ]);
  const statuses = [], calls = [], assignments = [];
  let storageReady = true, postReady = true, candidateContract = true;
  const runtimeLogs = async (options) => { assert.equal(options.deploymentId, deployment.id); calls.push('runtime-log-gate'); };
  const aliasVerifier = async (check) => check({ signal: AbortSignal.timeout(1000) });
  const publishFixture = (extra = {}) => publish({ runtimeLogs, aliasVerifier, ...extra });
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  Object.assign(process.env, environment);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input)), method = init.method || 'GET';
    calls.push(`${method} ${url.origin}${url.pathname}`);
    if (url.hostname === 'api.github.com') {
      const path = url.pathname.replace('/repos/lopugit/thingtime', '');
      if (path === '') return json({ full_name: 'lopugit/thingtime', owner: { login: 'lopugit' }, name: 'thingtime', default_branch: 'main' });
      if (path === '/git/ref/heads/main') return json({ object: { sha } });
      if (path === '/contents/vercel.json') return json({ content: Buffer.from(JSON.stringify({ regions: ['syd1'], crons: [] })).toString('base64') });
      if (path === `/commits/${sha}/status`) return json({ statuses });
      if (path === `/statuses/${sha}` && method === 'POST') { statuses.push(JSON.parse(init.body)); return json(statuses.at(-1), 201); }
    }
    if (url.hostname === 'api.vercel.com') {
      const path = url.pathname;
      if (path === '/v9/projects/prj_test') return json({ id: 'prj_test', name: 'thingtime', link: null });
      if (path === '/v9/projects/prj_test/custom-environments') return json({ environments: [] });
      if (path === '/v9/projects/prj_test/env') return json({ envs: [{ key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['production'] }] });
      // Deliberately return the secondary alias first: canonical must be promoted first.
      if (path === '/v9/projects/prj_test/domains') return json({ domains: [{ name: 'www.thingtime.com', verified: true }, { name: 'thingtime.com', verified: true }] });
      if (path === '/v7/deployments') return json({ deployments: [{ uid: deployment.id }] });
      if (path === '/v13/deployments/dpl_ready') return json(deployment);
      if (path.startsWith('/v4/aliases/')) return bindings.has(path.slice(12)) ? json(bindings.get(path.slice(12))) : json({}, 404);
      if (/^\/v2\/deployments\/dpl_(ready|previous|previous_www)\/aliases$/.test(path) && method === 'POST') {
        const { alias } = JSON.parse(init.body), deploymentId = path.split('/')[3];
        assert.ok(bindings.has(alias));
        assignments.push({ alias, deploymentId });
        const binding = { ...bindings.get(alias), deploymentId }; bindings.set(alias, binding); return json(binding);
      }
    }
    if (url.hostname === 'thingtime-ready.vercel.app' || bindings.has(url.hostname)) {
      if (url.pathname === '/' || url.pathname === '/index.html') return new Response('<div id="root"></div><script src="/assets/app.js"></script>', { headers: { 'Content-Type': 'text/html' } });
      if (url.pathname === '/assets/app.js') return new Response('console.log("fixture")', { headers: { 'Content-Type': 'application/javascript' } });
      const deploymentId = url.hostname === 'thingtime-ready.vercel.app' ? deployment.id : bindings.get(url.hostname).deploymentId;
      const next = deploymentId === deployment.id;
      if (url.pathname === '/.well-known/thingtime-capabilities.json') return json({
        schemaVersion: 1, origin: url.origin, features: { 'api.health-nitro': { version: next ? '1.3.0' : '1.2.0' }, ...(next && candidateContract ? { 'api.storage-accounting': { version: '1.0.0' } } : {}) },
        operations: [{ feature: 'api.health-nitro', path: '/api/v1/health/nitro', methods: ['GET'] }],
        gateway: { environment: 'production', origin: 'https://thingtime.com', deploymentId }
      });
      if (url.pathname === '/api/v1/health/nitro') {
        // This is the actual rollout failure: the candidate is still a follower.
        if (url.hostname === 'thingtime-ready.vercel.app') return json({ code: 'ENVIRONMENT_GATEWAY_CAPABILITY' }, 409);
        const ready = next ? postReady : storageReady;
        return json({ origin: url.origin, targetOrigin: url.origin, service: 'nitro', ok: ready, state: ready ? 'ready' : 'degraded', storageAccounting: { state: ready ? 'ready' : 'migration-required', expectedVersion: 1 } });
      }
      if (url.pathname === '/api/root-data') return json({ ok: true });
    }
    throw new Error(`Unexpected fixture request: ${method} ${url.origin}${url.pathname}`);
  };
  try {
    storageReady = false;
    await assert.rejects(publishFixture(), /storage-not-ready/);
    assert.equal(assignments.length, 0);
    storageReady = true; candidateContract = false;
    await assert.rejects(publishFixture(), /storage-capability-unavailable/);
    assert.equal(assignments.length, 0);
    candidateContract = true;
    await assert.rejects(publishFixture({ runtimeLogs: async () => { throw new Error('runtime-storage-errors-1'); } }), /runtime-storage-errors-1/);
    assert.equal(assignments.length, 0);
    postReady = false;
    await assert.rejects(publishFixture(), /storage-not-ready/);
    assert.equal(bindings.get('thingtime.com').deploymentId, 'dpl_previous');
    assert.equal(bindings.get('www.thingtime.com').deploymentId, 'dpl_previous_www');
    assert.equal(statuses.length, 0);
    assert.deepEqual(assignments, [{ alias: 'thingtime.com', deploymentId: 'dpl_ready' }, { alias: 'thingtime.com', deploymentId: 'dpl_previous' }]);
    postReady = true; calls.length = 0; assignments.length = 0;
    await publishFixture();
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].target_url, 'https://thingtime-ready.vercel.app');
    assert.equal(statuses[0].context, 'Vercel prebuilt (production)');
    assert.deepEqual(assignments, [{ alias: 'thingtime.com', deploymentId: 'dpl_ready' }, { alias: 'www.thingtime.com', deploymentId: 'dpl_ready' }]);
    const firstPromotion = calls.findIndex((call) => call.startsWith('POST '));
    assert.ok(calls.indexOf('runtime-log-gate') < firstPromotion);
    assert.ok(calls.indexOf('GET https://thingtime.com/api/v1/health/nitro') < firstPromotion);
    assert.equal(calls.includes('GET https://thingtime-ready.vercel.app/api/v1/health/nitro'), false);
    assert.equal(calls.slice(0, firstPromotion).includes('GET https://www.thingtime.com/api/v1/health/nitro'), false);
    assert.match(await readFile(summary, 'utf8'), /Deployment: https:\/\/thingtime-ready\.vercel\.app/);
    const firstCalls = calls.length;
    await writeFile(summary, '');
    await publishFixture();
    assert.equal(statuses.length, 1);
    assert.equal(calls.slice(firstCalls).filter((call) => call.startsWith('POST ')).length, 0);
    assert.match(await readFile(summary, 'utf8'), /Environment: `production`/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});

test('alias acceptance waits beyond seven seconds and bounds persistent propagation', async () => {
  let elapsed = 0; let reads = 0; const observations = [];
  const ready = await verifyAlias(async () => { reads++; if (elapsed < 32000) throw Error('old edge'); return 'ready'; }, async ms => { elapsed += ms; }, { now: () => elapsed, onFailure: value => observations.push(value) });
  assert.equal(ready, 'ready'); assert.equal(reads, 5); assert.equal(elapsed, 32000); assert.equal(observations.length, 4);
  elapsed = 0; reads = 0;
  await assert.rejects(verifyAlias(async () => { reads++; throw Error('stale'); }, async ms => { elapsed += ms; }, { now: () => elapsed, onFailure: () => {} }), /stale/);
  assert.equal(elapsed, 90000); assert.equal(reads, 8);
});

test('canonical verifier requires every exact identity and records only safe mismatch fields', async () => {
  const original = globalThis.fetch;
  const gateway = { environment: 'production', origin: 'https://thingtime.com' };
  const correct = { origin: gateway.origin, gateway: { ...gateway, deploymentId: 'dpl_new' } };
  try {
    for (const field of ['status', 'origin', 'environment', 'gateway-origin', 'deploymentId', 'invalid-json']) {
      const manifest = structuredClone(correct);
      if (field === 'origin') manifest.origin = 'https://old.example';
      if (field === 'environment') manifest.gateway.environment = 'preview';
      if (field === 'gateway-origin') manifest.gateway.origin = 'https://old.example';
      if (field === 'deploymentId') manifest.gateway.deploymentId = 'dpl_old';
      globalThis.fetch = async () => new Response(field === 'invalid-json' ? 'not JSON secret-value' : JSON.stringify(manifest), { status: field === 'status' ? 503 : 200, headers: { 'x-vercel-cache': 'HIT', age: '18', 'set-cookie': 'secret-value' } });
      await assert.rejects(verifyCanonicalGateway('thingtime.com', gateway, 'dpl_new'), error => { assert.equal(error.observation.status, field === 'status' ? 503 : 200); assert.equal(error.observation.cache, 'HIT'); assert.equal(error.observation.age, '18'); assert.ok(!JSON.stringify(error.observation).includes('secret-value')); return true; });
    }
    globalThis.fetch = async () => new Response(JSON.stringify(correct), { status: 200 });
    await verifyCanonicalGateway('thingtime.com', gateway, 'dpl_new');
  } finally { globalThis.fetch = original; }
});

test('alias acceptance aborts an in-flight read at its deadline', async () => {
  let signal;
  await assert.rejects(verifyAlias(({ signal: value }) => { signal = value; return new Promise(() => {}); }, async () => {}, { timeoutMs: 15, onFailure: () => {} }), /deadline expired/);
  assert.equal(signal.aborted, true);
});

test('failed late-upload cleanup preserves the original publication error', async () => {
  const branch = 'feature/cleanup-error', sha = 'a'.repeat(40), repository = 'lopugit/thingtime';
  const environment = { GITHUB_REPOSITORY: repository, GH_TOKEN: 'fixture-gh', VERCEL_TEAM_ID: 'team_test', VERCEL_TEAM_SLUG: 'team', VERCEL_API_TOKEN: 'fixture-vercel', VERCEL_PROJECT_ID: 'prj_test', VERCEL_PROJECT_NAME: 'thingtime', SOURCE_REF: branch, SOURCE_SHA: sha, TARGET_ENVIRONMENT: 'preview', TARGET_ID: '', GITHUB_RUN_ID: '123', THINGTIME_CI_ROUTER_SECRET: 'fixture-ci', THINGTIME_PREVIEW_POLICY_ORIGIN: 'https://policy.example.test' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch, originalLog = console.log, logs = [];
  const gateway = gatewayPolicy({ branch, target: { slug: 'preview' } });
  const deployment = { id: 'dpl_ready', projectId: 'prj_test', url: 'feature-ready.vercel.app', readyState: 'READY', target: null, regions: ['syd1'], crons: [], meta: { ...gatewayMetadata(gateway), [marker]: '1', thingtimePrebuiltPolicy: policyVersion, thingtimeBuildTarget: 'preview', githubCommitSha: sha, githubCommitRef: branch, githubCommitOrg: 'lopugit', githubCommitRepo: 'thingtime' } };
  const policy = { version: 1, enabled: true, noOpenPrGraceHours: 0, supersededGraceHours: 24, pruneSupersededOpenPr: false, inactivePullRequestDays: null };
  const repo = { id: 42, full_name: repository, owner: { login: 'lopugit' }, name: 'thingtime', default_branch: 'main' };
  const pr = { number: 12, state: 'open', head: { ref: branch, sha, repo }, base: { repo } };
  const source = path => ({ type: 'file', encoding: 'base64', content: Buffer.from(
    path.endsWith('/mongodb.ts') ? "import { requireGatewayDatabaseAccess } from '../deployment/environmentGateway'; class GatewayMongoClient extends mod.MongoClient { override async connect() { await requireGatewayDatabaseAccess(); await super.connect(); } }" :
    path.endsWith('/environment-gateway.ts') ? "import { environmentGatewayIngress } from '../utils/environmentGateway'; await environmentGatewayIngress(event.req); runAdmittedGatewayWork(() => next());" :
    path.endsWith('/mongoConnectionPolicy.ts') ? "export const mongoConnectionPolicy = 'proxy';" :
    'export const requireGatewayDatabaseAccess = async () => { await gatewayAuthority.requireDatabase(); };'
  ).toString('base64') });
  let publicationFailed = false, cleanupReads = 0;
  Object.assign(process.env, environment);
  console.log = value => logs.push(String(value));
  globalThis.fetch = async input => {
    const url = new URL(String(input)), path = decodeURIComponent(url.pathname);
    if (url.origin === environment.THINGTIME_PREVIEW_POLICY_ORIGIN) {
      if (path.endsWith('thingtime-capabilities.json')) return Response.json({ schemaVersion: 1, origin: url.origin, features: { 'api.integration-ci-preview-retention': { version: '1.0.0' } }, operations: [{ feature: 'api.integration-ci-preview-retention', path: '/api/v1/integrations/ci/preview-retention', methods: ['POST'] }] });
      return Response.json({ ok: true, repository, policy });
    }
    if (url.hostname === 'api.github.com') {
      const route = path.replace(`/repos/${repository}`, '');
      if (!route) return Response.json(repo);
      if (route === `/git/ref/heads/${branch}`) return Response.json({ object: { sha } });
      if (route === '/pulls') return Response.json([pr]);
      if (route === '/contents/vercel.json') return Response.json({ content: Buffer.from(JSON.stringify({ regions: ['syd1'] })).toString('base64') });
      if (route.startsWith('/contents/')) return Response.json(source(route));
    }
    if (url.hostname === 'api.vercel.com') {
      if (path === '/v9/projects/prj_test') return Response.json({ id: 'prj_test', name: 'thingtime' });
      if (path.endsWith('/custom-environments')) return Response.json({ environments: [] });
      if (path.endsWith('/env')) return Response.json({ envs: [{ key: 'THINGTIME_GATEWAY_SECRET', type: 'encrypted', target: ['preview'] }] });
      if (path.endsWith('/domains')) return Response.json({ domains: [] });
      if (path === '/v7/deployments') return Response.json({ deployments: [{ uid: deployment.id }] });
      if (path === '/v13/deployments/dpl_ready') {
        if (publicationFailed) { cleanupReads++; return Response.json({}, { status: 503 }); }
        return Response.json(deployment);
      }
    }
    if (url.hostname === deployment.url) { publicationFailed = true; throw new Error('original-publish-failure'); }
    throw new Error('Unexpected publication fixture request');
  };
  try {
    await assert.rejects(publish(), { message: 'original-publish-failure' });
    assert.equal(cleanupReads, 1);
    assert.ok(logs.some(line => line.includes('Failed preview upload left for the next retention sweep')));
    assert.ok(logs.every(line => !line.includes('fixture-ci') && !line.includes('fixture-gh') && !line.includes('fixture-vercel')));
  } finally {
    globalThis.fetch = originalFetch; console.log = originalLog;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
