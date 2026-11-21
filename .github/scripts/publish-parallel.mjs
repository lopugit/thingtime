import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profiles, matchesTarget } from './deployment-profiles.mjs';
import { applyOutputPolicy } from './deploy-vercel-prebuilt.mjs';

export async function publishParallel(env = process.env, fetcher = fetch) {
  const token = env.VERCEL_DEPLOY_TOKEN;
  const { SOURCE_SHA: sha, PROFILE_ID: id, TEST_ORIGIN: testOrigin, RUNNER_TEMP: temp } = env;
  if (!token || !/^[a-f0-9]{40}$/.test(sha) || env.GITHUB_REF !== 'refs/heads/main') throw new Error('Missing trusted publisher context');
  const checkProfile = async () => {
    const p = (await profiles(env, fetcher)).find(row => row.id === id);
    if (!p?.enabled || p.mode !== 'parallel' || p.testOrigin !== testOrigin || !matchesTarget(p, env)) throw new Error('Enabled deployment profile must match its independent GitHub environment');
    const head = await fetcher('https://api.github.com/repos/lopugit/thingtime/git/ref/heads/main', { redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!head.ok || (await head.json()).object?.sha !== sha) throw new Error('Source no longer matches main');
    return p;
  };
  const p = await checkProfile();
  const vercel = async (path, init = {}) => {
    const u = new URL(path, 'https://api.vercel.com');
    u.searchParams.set('teamId', p.teamId);
    const r = await fetcher(u, { ...init, redirect: 'error', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('Vercel project check failed: HTTP ' + r.status);
    return r.json();
  };
  const assertProject = async () => {
    const project = await vercel('/v9/projects/' + p.projectId);
    if (project.id !== p.projectId || project.name !== p.projectName || project.accountId !== p.teamId || project.link) throw new Error('Parallel project must be dedicated to this publisher and disconnected from Git builds');
    const vars = await vercel('/v9/projects/' + p.projectId + '/env');
    if (!Array.isArray(vars.envs) || vars.envs.length || vars.pagination?.next) throw new Error('Parallel project must have zero user-configured Vercel variables');
    const domains = await vercel('/v9/projects/' + p.projectId + '/domains');
    if (!Array.isArray(domains.domains) || domains.pagination?.next || domains.domains.some(d => !d.name.endsWith('.vercel.app')) ||
        !domains.domains.some(d => 'https://' + d.name === testOrigin)) throw new Error('Test alias must already belong to a project with only Vercel domains');
  };
  await assertProject();
  const directory = join(temp, 'prebuilt');
  await applyOutputPolicy(directory, { regions: ['syd1'] }, { kind: 'preview' });
  await mkdir(join(directory, '.vercel'), { recursive: true });
  await writeFile(join(directory, '.vercel/project.json'), JSON.stringify({ orgId: p.teamId, projectId: p.projectId }), { mode: 0o600 });
  const prior = await vercel('/v6/deployments?projectId=' + p.projectId + '&meta-thingtimeParallelProfile=' + id + '&meta-githubCommitSha=' + sha + '&limit=2');
  let deployment = prior.deployments?.find(d => d.readyState === 'READY' && d.target === 'production');
  if (!deployment && prior.deployments?.some(d => ['BUILDING','QUEUED','INITIALIZING'].includes(d.readyState))) throw new Error('An upload of this revision is in progress');
  if (!deployment) {
    let stdout;
    try {
      ({ stdout } = await promisify(execFile)(env.VERCEL_CLI_PATH, ['deploy','--prebuilt','--prod','--skip-domain','--archive=tgz','--yes','--scope',p.teamSlug,'--cwd',directory,'--meta','thingtimeParallelProfile=' + id,'--meta','githubCommitSha=' + sha], {
        env: { PATH: env.PATH, HOME: env.HOME, VERCEL_ORG_ID: p.teamId, VERCEL_PROJECT_ID: p.projectId, VERCEL_TOKEN: token }, timeout: 900000
      }));
    } catch { throw new Error('Parallel prebuilt upload failed; inspect the target project deployment log'); }
    const u = new URL(stdout.trim());
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.vercel.app')) throw new Error('Unexpected upload URL');
    deployment = await vercel('/v13/deployments/' + u.hostname);
  } else deployment = await vercel('/v13/deployments/' + deployment.uid);
  if (deployment.projectId !== p.projectId || deployment.readyState !== 'READY' || deployment.target !== 'production' ||
      deployment.meta?.thingtimeParallelProfile !== id || deployment.meta?.githubCommitSha !== sha || deployment.crons?.length) throw new Error('Parallel deployment did not verify');
  await checkProfile();
  await assertProject();
  const alias = new URL(testOrigin).hostname;
  await vercel('/v2/deployments/' + deployment.id + '/aliases', { method: 'POST', body: JSON.stringify({ alias }) });
  const saved = await vercel('/v4/aliases/' + alias);
  if (saved.deploymentId !== deployment.id) throw new Error('Test alias readback failed');
  const response = await fetcher(testOrigin + '/.well-known/thingtime-capabilities.json', { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || (await response.json()).origin !== testOrigin) throw new Error('Test origin manifest did not verify');
  await appendFile(env.GITHUB_STEP_SUMMARY, 'Published ' + sha + ' to ' + testOrigin + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await publishParallel();
