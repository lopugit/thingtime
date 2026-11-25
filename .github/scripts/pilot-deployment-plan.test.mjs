import assert from 'node:assert/strict';
import test from 'node:test';
import { pilotAlias, pilotLaneFor, assertPilotSource, pilotPlan, sameRepositoryPr } from './pilot-deployment-plan.mjs';
import { pilotProjectIssue, pilotDeploymentIssue, assertPilotAccess } from './publish-pilot.mjs';

const sha = 'a'.repeat(40);
const profile = { id: 'vercel-hobby', mode: 'parallel', enabled: true, teamId: 'team_test', projectId: 'prj_test',
  projectName: 'app', testOrigin: 'https://app-base.vercel.app', pilotLanes: ['production', 'development', 'preview'] };
const repo = { full_name: 'lopugit/thingtime', id: 42, default_branch: 'main' };
const pr = { number: 321, state: 'open', updated_at: new Date().toISOString(), head: { ref: 'codex/example', sha, repo }, base: { repo } };
const source = Buffer.from("export const PILOT_LANES_VERSION = '2.0.0'; const x = THINGTIME_PILOT_LANE + THINGTIME_PILOT_ORIGIN").toString('base64');
const env = { GITHUB_REPOSITORY: repo.full_name, GITHUB_REF: 'refs/heads/main', GH_TOKEN: 'fixture', SOURCE_REF: 'codex/example', PR_NUMBER: '321' };
const fake = async (url) => {
  const path = new URL(url).pathname;
  if (path === `/repos/${repo.full_name}`) return Response.json(repo);
  if (path.endsWith('/pulls/321')) return Response.json(pr);
  if (path.includes('/contents/')) return Response.json({ type: 'file', encoding: 'base64', content: source });
  if (path.includes('/git/ref/heads/')) return Response.json({ object: { sha } });
  throw new Error(`Unexpected GitHub request: ${path}`);
};
const options = { fetcher: fake, profileReader: async () => [profile], retentionReader: async () => ({ enabled: true, inactivePullRequestDays: 30 }) };

test('derive only exact pilot aliases, including long DNS labels', () => {
  assert.equal(pilotAlias(profile.testOrigin, 'production'), 'app-base.vercel.app');
  assert.equal(pilotAlias(profile.testOrigin, 'development'), 'app-base-dev.vercel.app');
  assert.equal(pilotAlias(profile.testOrigin, 'preview', 321), 'app-base-pr-321.vercel.app');
  const long = pilotAlias(`https://${'a'.repeat(60)}.vercel.app`, 'preview', 321);
  assert.match(long, /^a+-[a-f0-9]{8}-pr-321\.vercel\.app$/);
  assert.ok(long.split('.')[0].length <= 63);
  assert.throws(() => pilotAlias('https://thingtime.com', 'production'));
  assert.throws(() => pilotAlias(profile.testOrigin, 'preview', 0));
  assert.equal(pilotLaneFor('main'), 'production');
  assert.equal(pilotLaneFor('develop'), 'development');
  assert.equal(pilotLaneFor('codex/example', 321), 'preview');
  assert.throws(() => pilotLaneFor('main', 321));
  assert.throws(() => pilotLaneFor('other'));
});

test('pilot plan accepts only current same-repository live PR and lane-aware immutable source', async () => {
  const result = await pilotPlan(env, options);
  assert.equal(result.sourceSha, sha);
  assert.deepEqual(result.targets.map(p => p.alias), ['app-base-pr-321.vercel.app']);
  assert.equal(result.shouldBuild, true);
  assert.equal(sameRepositoryPr(pr, repo, 321, 'codex/example', 'open'), true);
  assert.equal(sameRepositoryPr({ ...pr, head: { ...pr.head, repo: { ...repo, id: 99 } } }, repo, 321, 'codex/example', 'open'), false);
  await assert.rejects(pilotPlan(env, { ...options, fetcher: async (url) => {
    if (String(url).includes('/pulls/321')) return Response.json({ ...pr, state: 'closed' });
    return fake(url);
  } }), /same-repository/);
  await assert.rejects(pilotPlan(env, { ...options, retentionReader: async () => ({ enabled: true, inactivePullRequestDays: 1 }), fetcher: async (url) => {
    if (String(url).includes('/pulls/321')) return Response.json({ ...pr, updated_at: '2020-01-01T00:00:00Z' });
    return fake(url);
  } }), /stale/);
  await assert.rejects(pilotPlan({ ...env, EXPECTED_SHA: 'b'.repeat(40) }, options), /advanced/);
  await assert.rejects(pilotPlan(env, { ...options, fetcher: async url => String(url).includes('/pulls/321') ? Response.json({ ...pr, draft: true }) : fake(url) }), /eligible/);
  assert.throws(() => assertPilotSource("export const PILOT_LANES_VERSION = '1.0.0'"), /does not implement/);
  assert.deepEqual((await pilotPlan(env, { ...options, profileReader: async () => [{ ...profile, pilotLanes: [] }] })).targets, []);
});

test('retirement requires the exact closed PR and no source build', async () => {
  const closed = { ...pr, state: 'closed' };
  const result = await pilotPlan({ ...env, SOURCE_REF: '', PR_NUMBER: '0', RETIRE_PR_NUMBER: '321' }, {
    ...options, fetcher: async url => String(url).includes('/pulls/321') ? Response.json(closed) : fake(url)
  });
  assert.equal(result.shouldBuild, false);
  assert.equal(result.targets[0].alias, 'app-base-pr-321.vercel.app');
  const stale = await pilotPlan({ ...env, SOURCE_REF: '', PR_NUMBER: '0', RETIRE_PR_NUMBER: '321' }, {
    ...options, retentionReader: async () => ({ enabled: true, inactivePullRequestDays: 1 }),
    fetcher: async url => String(url).includes('/pulls/321') ? Response.json({ ...pr, updated_at: '2020-01-01T00:00:00Z' }) : fake(url)
  });
  assert.equal(stale.targets[0].lane, 'retire');
});

test('destination and uploaded deployment must preserve the environment boundary', () => {
  const project = { id: profile.projectId, name: profile.projectName, accountId: profile.teamId,
    ssoProtection: { deploymentType: 'prod_deployment_urls_and_all_previews' } };
  const domains = { domains: [{ name: 'app-base.vercel.app' }] };
  const variables = { envs: [] };
  assert.equal(pilotProjectIssue(project, profile, domains, variables), null);
  assert.match(pilotProjectIssue({ ...project, ssoProtection: null }, profile, domains, variables), /protection/);
  assert.match(pilotProjectIssue(project, profile, domains, { envs: [{ key: 'SECRET' }] }), /variables/);
  const plan = { lane: 'preview', sourceSha: sha, sourceRef: 'codex/example', prNumber: 321 };
  const deployment = { id: 'dpl_test', projectId: profile.projectId, readyState: 'READY', target: 'preview', crons: [],
    meta: { thingtimePilotProfile: profile.id, thingtimePilotLane: 'preview', githubCommitSha: sha, githubCommitRef: plan.sourceRef, githubPrId: '321' } };
  assert.equal(pilotDeploymentIssue(deployment, plan, profile), null);
  assert.equal(pilotDeploymentIssue({ ...deployment, target: null }, plan, profile), null);
  assert.match(pilotDeploymentIssue({ ...deployment, target: null, customEnvironment: { slug: 'test' } }, plan, profile), /target/);
  assert.match(pilotDeploymentIssue({ ...deployment, target: 'production' }, plan, profile), /target/);
  assert.match(pilotDeploymentIssue({ ...deployment, crons: [{ path: '/x', schedule: '* * * * *' }] }, plan, profile), /scheduled/);
});


test('preview publication requires the Vercel sign-in response', async () => {
  const alias = 'app-base-pr-321.vercel.app';
  await assertPilotAccess(alias, 'preview', async () => Response.redirect('https://vercel.com/sso-api', 302));
  await assert.rejects(assertPilotAccess(alias, 'preview', async () => Response.redirect('https://' + alias + '/login', 302)), /authentication/);
  await assert.rejects(assertPilotAccess(alias, 'preview', async () => Response.json({ ok: false }, { status: 403 })), /authentication/);
});
