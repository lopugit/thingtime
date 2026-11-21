import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profiles, matchesTarget } from './deployment-profiles.mjs';
import { reconcileGatewayAliases } from './environment-gateway-policy.mjs';
import { applyOutputPolicy, verifyAlias } from './deploy-vercel-prebuilt.mjs';

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
    if (!r.ok) throw Object.assign(new Error('Vercel project check failed: HTTP ' + r.status), { status: r.status });
    if (r.status === 204) return null;
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
  const read = async name => {
    let entry;
    try { entry = await vercel('/v4/aliases/' + name); }
    catch (error) { if (error.status === 404) return null; throw error; }
    const owner = entry.projectId || (await vercel('/v13/deployments/' + entry.deploymentId)).projectId;
    if (owner !== p.projectId) throw new Error('Test alias belongs to another project');
    return entry;
  };
  const publicJson = async (origin, path, signal) => {
    const r = await fetcher(origin + path, { redirect: 'error', signal, cache: 'no-store' });
    if (!r.ok) throw new Error('Public acceptance failed: HTTP ' + r.status);
    return r.json();
  };
  await reconcileGatewayAliases({
    names: [alias], deploymentId: deployment.id, read,
    assign: (name, id) => vercel('/v2/deployments/' + id + '/aliases', { method: 'POST', body: JSON.stringify({ alias: name }) }),
    remove: async name => {
      const entry = await read(name);
      if (entry?.deploymentId === deployment.id) await vercel('/v2/aliases/' + entry.uid, { method: 'DELETE' });
    },
    verify: () => verifyAlias(async ({ signal }) => {
      const manifest = await publicJson(testOrigin, '/.well-known/thingtime-capabilities.json', signal);
      if (manifest.origin !== testOrigin || manifest.gateway !== null ||
          !/^1\.(?:[3-9]|[1-9]\d+)\.\d+$/.test(manifest.features?.['api.environment-gateway']?.version) ||
          !manifest.operations?.some(op => op.path === '/api/v1/health/mongodb' && op.methods?.includes('GET'))) {
        throw new Error('Pilot gateway capability did not verify');
      }
      const [pilot, live] = await Promise.all([testOrigin, 'https://thingtime.com'].map(
        origin => publicJson(origin, '/api/v1/health/mongodb', signal)));
      if ([pilot, live].some(db => db.connected !== true || db.custom !== false || !Number.isFinite(db.pingMs) || !db.host || !db.dbName) ||
          (pilot.host === live.host && pilot.dbName === live.dbName)) throw new Error('Independent database identity did not verify');
    })
  });
  await appendFile(env.GITHUB_STEP_SUMMARY, 'Published ' + sha + ' to ' + testOrigin + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await publishParallel();
