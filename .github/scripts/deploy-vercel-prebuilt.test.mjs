import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deploymentArgs, deploymentIssue, marker, publisherEnvironment, selectTarget, sourceFromEvent } from './deploy-vercel-prebuilt.mjs';

const custom = [{ id: 'env_develop', slug: 'develop', branchMatcher: { type: 'equals', pattern: 'develop' } }];
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
    const args = deploymentArgs({ target, branch, sha: 'a'.repeat(40), directory: '/prebuilt', teamSlug: 'team', runId: '123', repository: 'owner/product' });
    assert.ok(args.includes('--prebuilt'));
    assert.ok(args.includes('--archive=tgz'));
    assert.ok(args.includes('THINGTIME_GIT_COMMIT_SHA=' + 'a'.repeat(40)));
    assert.equal(args.includes('--prod'), branch === 'main');
    if (branch !== 'main') assert.ok(args.includes(`--target=${target.slug}`));
    assert.ok(!args.includes('--build-env'));
  }
});

test('deployment evidence rejects mismatched source, project and environments', () => {
  const plan = { branch: 'develop', sha: 'a'.repeat(40), target: selectTarget('develop', 'main', custom), projectId: 'prj_thingtime' };
  const deployment = { projectId: plan.projectId, customEnvironment: { id: 'env_develop' }, target: null, meta: { [marker]: '1', githubCommitRef: plan.branch, githubCommitSha: plan.sha, thingtimeBuildTarget: 'develop' } };
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
  assert.match(publish, /ref: github-actions/);
  assert.match(publish, /extract-vercel-prebuilt.py/);
  assert.doesNotMatch(publish, /run: (?:node scripts\/|.*vercel build)/);
});
