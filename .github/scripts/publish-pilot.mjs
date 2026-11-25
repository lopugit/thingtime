import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profiles, matchesTarget } from './deployment-profiles.mjs';
import { pilotPlan, pilotAlias } from './pilot-deployment-plan.mjs';
import { applyOutputPolicy, verifyAlias } from './deploy-vercel-prebuilt.mjs';
import { promotePreviewAlias } from './preview-alias-promotion.mjs';

const run = promisify(execFile);
const repo = 'lopugit/thingtime';
const shaPattern = /^[a-f0-9]{40}$/;
const idPattern = /^dpl_[A-Za-z0-9]+$/;

export function pilotDeploymentIssue(deployment, plan, profile) {
  if (!idPattern.test(deployment?.id || '') || deployment.projectId !== profile.projectId || deployment.readyState !== 'READY') return 'deployment identity or readiness';
  const correctTarget = plan.lane === 'production' ? deployment.target === 'production' :
    (deployment.target === null || deployment.target === 'preview') && !deployment.customEnvironment && !deployment.customEnvironmentId;
  if (!correctTarget || deployment.crons?.length) return 'target or scheduled work';
  if (deployment.meta?.thingtimePilotProfile !== profile.id || deployment.meta?.thingtimePilotLane !== plan.lane ||
      deployment.meta?.githubCommitSha !== plan.sourceSha || deployment.meta?.githubCommitRef !== plan.sourceRef ||
      String(deployment.meta?.githubPrId || '') !== (plan.lane === 'preview' ? String(plan.prNumber) : '')) return 'source metadata';
  return null;
}

export function pilotProjectIssue(project, profile, domains, variables) {
  if (project?.id !== profile.projectId || project.name !== profile.projectName || project.accountId !== profile.teamId || project.link) return 'project identity or Git link';
  if (!Array.isArray(variables?.envs) || variables.envs.length || variables.pagination?.next) return 'user-configured Vercel environment variables';
  if (!Array.isArray(domains?.domains) || domains.pagination?.next ||
      domains.domains.some(d => typeof d.name !== 'string' || !d.name.endsWith('.vercel.app') || d.redirect || d.customEnvironmentId) ||
      !domains.domains.some(d => `https://${d.name}` === profile.testOrigin)) return 'project domain inventory';
  if (!['prod_deployment_urls_and_all_previews', 'preview'].includes(project.ssoProtection?.deploymentType)) return 'Preview deployment protection';
  return null;
}

export async function assertPilotAccess(alias, lane, fetcher = fetch) {
  const response = await fetcher(`https://${alias}/.well-known/thingtime-capabilities.json`, {
    redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' }
  });
  if (lane === 'production') {
    if (response.status !== 200) throw new Error('Pilot production alias is not publicly reachable');
    const manifest = await response.json();
    if (manifest.origin !== `https://${alias}` || manifest.schemaVersion !== 1 || manifest.gateway !== null ||
        !/^1\.(?:[4-9]|[1-9]\d+)\.\d+$/.test(manifest.features?.['api.environment-gateway']?.version) ||
        !manifest.operations?.some(op => op.path === '/api/v1/health/mongodb' && op.methods?.includes('GET'))) throw new Error('Pilot production alias returned the wrong origin');
  } else {
    const location = response.headers.get('location');
    const login = location ? new URL(location, `https://${alias}`) : null;
    if (![302, 303, 307, 308].includes(response.status) || login?.origin !== 'https://vercel.com' || login.pathname !== '/sso-api') {
      throw new Error('Pilot nonproduction alias did not present Vercel authentication');
    }
  }
}

export async function publishPilot(env = process.env, { fetcher = fetch, exec = run, planReader = pilotPlan, profileReader = profiles } = {}) {
  if (env.GITHUB_REPOSITORY !== repo || env.GITHUB_REF !== 'refs/heads/main' || !env.VERCEL_DEPLOY_TOKEN || !env.GH_TOKEN ||
      !env.THINGTIME_CI_ROUTER_SECRET || !env.RUNNER_TEMP || !env.VERCEL_CLI_PATH) throw new Error('Pilot publisher requires protected main controller context');
  const plan = await planReader(env, { fetcher, profileReader });
  const id = env.PROFILE_ID, alias = env.PILOT_ALIAS;
  const selected = plan.targets.find(p => p.id === id);
  if (!selected || selected.alias !== alias || selected.lane !== env.PILOT_LANE || selected.baseOrigin !== env.PILOT_BASE_ORIGIN ||
      plan.sourceSha !== (env.SOURCE_SHA || '') || plan.sourceRef !== env.SOURCE_REF || !Number.isSafeInteger(selected.prNumber)) {
    throw new Error('Pilot source or profile changed since preparation');
  }
  const profile = (await profileReader(env, fetcher)).find(p => p.id === id);
  if (!profile || (plan.lane !== 'retire' && !profile.enabled) || !matchesTarget(profile, env) || profile.testOrigin !== selected.baseOrigin ||
      !profile.pilotLanes?.includes(plan.lane === 'retire' ? 'preview' : plan.lane) ||
      pilotAlias(profile.testOrigin, plan.lane === 'retire' ? 'preview' : plan.lane, selected.prNumber) !== alias) {
    throw new Error('Pilot enrollment or independent GitHub environment changed');
  }
  const api = async (path, init = {}) => {
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', profile.teamId);
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${env.VERCEL_DEPLOY_TOKEN}`, 'content-type': 'application/json' } });
    if (!response.ok) throw Object.assign(new Error(`Vercel pilot request failed: HTTP ${response.status}`), { status: response.status });
    return response.status === 204 ? null : response.json();
  };
  const project = await api(`/v9/projects/${profile.projectId}`);
  const [variables, domains] = await Promise.all([
    api(`/v9/projects/${profile.projectId}/env`), api(`/v9/projects/${profile.projectId}/domains`)
  ]);
  const projectIssue = pilotProjectIssue(project, profile, domains, variables);
  if (projectIssue) throw new Error(`Pilot destination rejected: ${projectIssue}`);
  const readAlias = async () => {
    let entry;
    try { entry = await api(`/v4/aliases/${alias}`); }
    catch (error) { if (error.status === 404) return null; throw error; }
    const owner = entry.projectId || (await api(`/v13/deployments/${entry.deploymentId}`)).projectId;
    if (owner !== profile.projectId) throw new Error('Pilot alias belongs to another project');
    return entry;
  };
  if (plan.lane === 'retire') {
    const current = await readAlias();
    if (current) {
      const incumbent = await api(`/v13/deployments/${current.deploymentId}`);
      if (incumbent.meta?.thingtimePilotProfile !== id || incumbent.meta?.thingtimePilotLane !== 'preview' ||
          String(incumbent.meta?.githubPrId) !== String(selected.prNumber) || incumbent.projectId !== profile.projectId) {
        throw new Error('Refusing to retire an alias without exact pilot PR ownership');
      }
      // Recheck the PR and enrollment immediately before changing the alias.
      const currentPlan = await planReader(env, { fetcher, profileReader });
      if (!currentPlan.targets.some(p => p.id === id && p.alias === alias && p.lane === 'retire')) throw new Error('Pilot retirement authority changed');
      await api(`/v2/aliases/${current.uid || current.id}`, { method: 'DELETE' });
      if (await readAlias()) throw new Error('Retired pilot PR alias remains assigned');
    }
    await appendFile(env.GITHUB_STEP_SUMMARY, `Retired pilot PR alias ${alias}\n`);
    return;
  }
  if (!shaPattern.test(plan.sourceSha)) throw new Error('Invalid pilot source SHA');
  const target = plan.lane === 'production' ? 'production' : 'preview';
  const prior = await api(`/v6/deployments?projectId=${profile.projectId}&meta-thingtimePilotProfile=${id}&meta-thingtimePilotLane=${plan.lane}&meta-githubCommitSha=${plan.sourceSha}&limit=5`);
  if (!Array.isArray(prior.deployments)) throw new Error('Pilot deployment inventory incomplete');
  let deployment;
  for (const row of prior.deployments) {
    if (row.readyState !== 'READY') continue;
    const candidate = await api(`/v13/deployments/${row.uid || row.id}`);
    if (!pilotDeploymentIssue(candidate, { ...plan, prNumber: selected.prNumber }, profile)) { deployment = candidate; break; }
  }
  if (!deployment && prior.deployments.some(d => ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(d.readyState))) throw new Error('A pilot upload of this revision is already in progress');
  if (!deployment) {
    const directory = join(env.RUNNER_TEMP, 'prebuilt');
    // The pilot never schedules a second set of jobs against production data.
    await applyOutputPolicy(directory, { regions: ['syd1'] }, { kind: 'preview' });
    await mkdir(join(directory, '.vercel'), { recursive: true });
    await writeFile(join(directory, '.vercel/project.json'), JSON.stringify({ orgId: profile.teamId, projectId: profile.projectId }), { mode: 0o600 });
    const args = ['deploy', '--prebuilt', '--archive=tgz', '--yes', '--cwd', directory,
      target === 'production' ? '--prod' : '--target=preview',
      ...(target === 'production' ? ['--skip-domain'] : []),
      '--meta', `thingtimePilotProfile=${id}`, '--meta', `thingtimePilotLane=${plan.lane}`,
      '--meta', `githubCommitSha=${plan.sourceSha}`, '--meta', `githubCommitRef=${plan.sourceRef}`,
      ...(plan.lane === 'preview' ? ['--meta', `githubPrId=${selected.prNumber}`] : [])];
    let stdout;
    try {
      ({ stdout } = await exec(env.VERCEL_CLI_PATH, args, { timeout: 900000,
        env: { PATH: env.PATH, HOME: env.HOME, VERCEL_ORG_ID: profile.teamId, VERCEL_PROJECT_ID: profile.projectId, VERCEL_TOKEN: env.VERCEL_DEPLOY_TOKEN } }));
    } catch {
      throw new Error('Pilot prebuilt upload failed; inspect target deployment events before retrying');
    }
    const uploaded = new URL(stdout.trim());
    if (uploaded.protocol !== 'https:' || !uploaded.hostname.endsWith('.vercel.app')) throw new Error('Unexpected pilot deployment URL');
    deployment = await api(`/v13/deployments/${uploaded.hostname}`);
  }
  const issue = pilotDeploymentIssue(deployment, { ...plan, prNumber: selected.prNumber }, profile);
  if (issue) throw new Error(`Pilot deployment failed verification: ${issue}`);
  // Do not forward the project-wide automation bypass or deployment token to
  // PR-authored functions. READY metadata and anonymous protection are the
  // controller's checks; authenticated app acceptance is a separate step.
  await promotePreviewAlias({ alias, deploymentId: deployment.id,
    read: readAlias,
    assign: (name, id) => api(`/v2/deployments/${id}/aliases`, { method: 'POST', body: JSON.stringify({ alias: name }) }),
    remove: async name => {
      const current = await readAlias();
      if (current) await api(`/v2/aliases/${current.uid || current.id}`, { method: 'DELETE' });
    },
    verifyCandidate: async () => {
      const fresh = await api(`/v13/deployments/${deployment.id}`);
      const issue = pilotDeploymentIssue(fresh, { ...plan, prNumber: selected.prNumber }, profile);
      if (issue) throw new Error(`Pilot candidate changed: ${issue}`);
    },
    assertCurrent: async () => {
      const fresh = await planReader(env, { fetcher, profileReader });
      if (fresh.sourceSha !== plan.sourceSha || fresh.sourceRef !== plan.sourceRef ||
          !fresh.targets.some(p => p.id === id && p.alias === alias)) throw new Error('Pilot source or enrollment advanced before alias publication');
    },
    verifyAlias: async () => verifyAlias(async () => {
      await assertPilotAccess(alias, plan.lane, fetcher);
      if (target === 'production') {
        const [pilot, primary] = await Promise.all([`https://${alias}`, 'https://thingtime.com'].map(async origin => {
          const health = await fetcher(origin + '/api/v1/health/mongodb', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
          if (!health.ok) throw new Error('Production database health unavailable');
          return health.json();
        }));
        if ([pilot, primary].some(h => h.connected !== true || h.custom !== false || !h.host || !h.dbName) ||
            pilot.host !== primary.host || pilot.dbName !== primary.dbName) throw new Error('Pilot production data authority did not match');
      }
    }, undefined, { onFailure: () => {} })
  });
  await appendFile(env.GITHUB_STEP_SUMMARY, `Published ${plan.lane} ${plan.sourceSha} to https://${alias}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await publishPilot();
