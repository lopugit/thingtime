import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAlias, compatibilityAliasCandidates, applyOutputPolicy, policyVersion, runtimePolicyIssue, deploymentArgs, deploymentIssue, marker, planOutputs, publisherEnvironment, selectTarget, sourceFromEvent } from './deploy-vercel-prebuilt.mjs';

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
    if (branch !== 'main') assert.ok(args.includes(`--target=${target.slug}`));
    assert.ok(!args.includes('--build-env'));
  }
});

test('deployment evidence rejects mismatched source, project and environments', () => {
  const plan = { branch: 'develop', sha: 'a'.repeat(40), target: selectTarget('develop', 'main', custom), projectId: 'prj_thingtime' };
  const deployment = { projectId: plan.projectId, customEnvironment: { id: 'env_develop' }, target: null, meta: { [marker]: '1', thingtimePrebuiltPolicy: policyVersion, githubCommitRef: plan.branch, githubCommitSha: plan.sha, thingtimeBuildTarget: 'develop' } };
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
  assert.equal((yaml.match(/GH_TOKEN: \$\{\{ secrets\.CONFLICT_RESOLVER_PAT \|\| github\.token \}\}/g) || []).length, 2);
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
  await assert.rejects(verifyAlias(async () => { failures++; throw new Error('persistent'); }, async () => {}), /persistent/);
  assert.equal(failures, 3);
});
