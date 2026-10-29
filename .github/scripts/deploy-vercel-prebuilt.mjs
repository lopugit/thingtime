import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gatewayPolicy, gatewayMetadata, gatewayDeploymentIssue, gatewayRuntimeArgs, gatewayPublisherEnvironment, gatewaySecretConfigured, reconcileGatewayAliases, restoreGatewayAliases } from './environment-gateway-policy.mjs';
import { checkStorageReadiness, checkRuntimeLogs } from './storage-release-gate.mjs';

const exec = promisify(execFile);
export const marker = 'thingtimeGithubActionsBuild';
export const policyVersion = '3';
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const github = (path, init) => request(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${required('GITHUB_REPOSITORY')}${path}`, required('GH_TOKEN'), init);
const vercel = (path, init) => request(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${required('VERCEL_TEAM_ID')}`, required('VERCEL_API_TOKEN'), init);
async function request(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    const rateLimit = response.headers.get('x-ratelimit-remaining') === '0' ? '; provider rate limit exhausted' : '';
    throw Object.assign(new Error(`Provider request failed: HTTP ${response.status} (${new URL(url).pathname})${rateLimit}`), { status: response.status });
  }
  return response.status === 204 ? null : response.json();
}

export function selectTarget(branch, productionBranch, environments, requested = 'auto') {
  if (!branch || /[\r\n\x00]/.test(branch) || branch === 'github-actions') throw new Error('Invalid product branch');
  const matches = environments.filter(({ branchMatcher: m }) => m && (
    m.type === 'equals' ? branch === m.pattern :
    m.type === 'startsWith' ? branch.startsWith(m.pattern) :
    m.type === 'endsWith' ? branch.endsWith(m.pattern) : false
  ));
  if (requested === 'auto' && matches.length > 1) throw new Error('Ambiguous custom environment branch match');
  const slug = requested === 'auto' ? (branch === productionBranch ? 'production' : matches[0]?.slug || 'preview') : requested;
  if (slug === 'production' && branch !== productionBranch) throw new Error('Production requires the current production branch');
  if (slug === 'production' || slug === 'preview') return { slug, kind: slug, id: '' };
  const environment = environments.find((e) => e.slug === slug);
  if (!environment) throw new Error('Unknown custom environment');
  // Stable custom environments follow their configured branches. PR-scoped
  // deploys continue through the existing isolated preview controller.
  if (!matches.includes(environment)) throw new Error('Custom environment requires its configured branch');
  return { slug, kind: 'preview', id: environment.id };
}

export function deploymentIssue(deployment, { sha, branch, target, projectId }) {
  const gateway = gatewayPolicy({ branch, target, owner: branch === 'main' && target.slug === 'preview' });
  if (gatewayDeploymentIssue(deployment, gateway)) return 'gateway-policy';
  if (deployment.projectId !== projectId) return 'project';
  if (deployment.meta?.[marker] !== '1') return 'build-marker';
  if (deployment.meta?.thingtimePrebuiltPolicy !== policyVersion) return 'output-policy';
  if (deployment.meta?.githubCommitSha !== sha || deployment.meta?.githubCommitRef !== branch) return 'source';
  if (deployment.meta?.thingtimeBuildTarget !== target.slug) return 'target-marker';
  if (target.kind === 'production' ? deployment.target !== 'production' : deployment.target === 'production') return 'production-target';
  if ((deployment.customEnvironment?.id || deployment.customEnvironmentId || '') !== target.id) return 'custom-environment';
  return null;
}

export function deploymentArgs({ directory, target, branch, sha, teamSlug, runId, repository, regions = [] }) {
  const args = ['deploy', '--prebuilt', '--archive=tgz', '--yes', '--scope', teamSlug, '--cwd', directory];
  if (regions.length) args.push('--regions', regions.join(','));
  args.push(target.kind === 'production' ? '--prod' : `--target=${target.slug}`);
  if (target.kind === 'production') args.push('--skip-domain');
  const gateway = gatewayPolicy({ branch, target, owner: branch === 'main' && target.slug === 'preview' });
  args.push(...gatewayRuntimeArgs(gateway));
  const [owner, repo] = repository.split('/');
  for (const [key, value] of Object.entries({ ...gatewayMetadata(gateway), [marker]: '1', thingtimePrebuiltPolicy: policyVersion, thingtimeBuildTarget: target.slug, githubCommitSha: sha, githubCommitRef: branch, githubCommitOrg: owner, githubCommitRepo: repo, githubDeployment: '1', githubWorkflowRunId: runId })) args.push('--meta', `${key}=${value}`);
  for (const [key, value] of Object.entries({ THINGTIME_BRANCH_NAME: branch, THINGTIME_GIT_COMMIT_SHA: sha })) args.push('--env', `${key}=${value}`);
  return args;
}

export function compatibilityAliasCandidates({ branch, projectName, teamSlug, target }) {
  if (!/^[a-z0-9-]+$/.test(branch)) return [];
  const labels = [`${projectName}-git-${branch}-${teamSlug}`];
  if (target.kind === 'production') labels.push(`${projectName}-${teamSlug}`);
  return labels.filter((label) => label.length <= 63).map((label) => `${label}.vercel.app`);
}

export function publisherEnvironment({ teamId, projectId, token }, environment = process.env) {
  // Vercel CLI rejects a lone VERCEL_PROJECT_ID even when project.json exists.
  // Bind both identifiers to the independently authorized project, overriding
  // any inherited CLI context before uploading the artifact.
  return { ...environment, VERCEL_ORG_ID: teamId, VERCEL_PROJECT_ID: projectId, VERCEL_TOKEN: token };
}

// Prebuilt uploads consume Build Output API metadata; vercel.json alone does
// not carry cron schedules or per-function regions into an existing artifact.
export async function applyOutputPolicy(directory, productConfig, target) {
  const output = resolve(directory, '.vercel/output');
  const path = resolve(output, 'config.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (config.version !== 3) throw new Error('Unsupported Build Output API version');
  delete config.crons;
  if (target.kind === 'production') config.crons = productConfig.crons || [];
  await writeFile(path, JSON.stringify(config));
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; // Function aliases are symlinks.
      const child = resolve(directory, entry.name);
      if (!entry.name.endsWith('.func')) { await visit(child); continue; }
      const file = resolve(child, '.vc-config.json');
      const fn = JSON.parse(await readFile(file, 'utf8'));
      if (productConfig.regions) fn.regions = productConfig.regions;
      await writeFile(file, JSON.stringify(fn));
    }
  }
  await visit(resolve(output, 'functions'));
}

export function runtimePolicyIssue(deployment, productConfig, target) {
  if (productConfig.regions && JSON.stringify([...(deployment.regions || [])].sort()) !== JSON.stringify([...productConfig.regions].sort())) return 'regions';
  const expected = target.kind === 'production' ? productConfig.crons || [] : [];
  const normalized = (rows) => JSON.stringify(rows.map(({ path, schedule }) => ({ path, schedule })).sort((a, b) => a.path.localeCompare(b.path)));
  if (normalized(deployment.crons || []) !== normalized(expected)) return 'crons';
  return null;
}

async function context(branch, requested) {
  const [repository, ref, project] = await Promise.all([
    github(''), github(`/git/ref/heads/${encodeURIComponent(branch)}`),
    vercel(`/v9/projects/${required('VERCEL_PROJECT_ID')}`)
  ]);
  if (repository.full_name !== required('GITHUB_REPOSITORY') || project.id !== required('VERCEL_PROJECT_ID') || project.name !== required('VERCEL_PROJECT_NAME')) throw new Error('Repository or project identity mismatch');
  if (project.link && (project.link.org !== repository.owner.login || project.link.repo !== repository.name)) throw new Error('Vercel Git link mismatch');
  const environments = await vercel(`/v9/projects/${project.id}/custom-environments`);
  const target = selectTarget(branch, repository.default_branch, environments.environments, requested);
  const sha = ref.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid source SHA');
  const gateway = gatewayPolicy({ branch, target, owner: branch === 'main' && target.slug === 'preview' });
  return { sha, branch, target, gateway, projectId: project.id };
}

async function existing(plan) {
  const params = new URLSearchParams({ projectId: plan.projectId, [`meta-${marker}`]: '1', 'meta-githubCommitSha': plan.sha, 'meta-thingtimeBuildTarget': plan.target.slug, limit: '100' });
  const result = await vercel(`/v7/deployments?${params}`);
  for (const d of result.deployments || []) {
    const detail = await vercel(`/v13/deployments/${d.uid || d.id}`);
    if (!deploymentIssue(detail, plan) && detail.readyState === 'READY') return detail;
  }
  return null;
}

export function sourceFromEvent(eventName, event, inputRef) {
  if (eventName === 'workflow_dispatch') return { branch: inputRef, sha: null };
  if (eventName === 'push') return { branch: event.ref?.replace(/^refs\/heads\//, ''), sha: event.after, skip: !!event.deleted };
  if (eventName === 'workflow_run') {
    const run = event.workflow_run;
    if (run?.event !== 'push' || event.action !== 'requested' || run.head_repository?.full_name !== event.repository?.full_name) return { skip: true };
    return { branch: run.head_branch, sha: run.head_sha };
  }
  throw new Error('Unsupported deployment event');
}

async function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(String(value))) throw new Error('Unsafe workflow output');
    await appendFile(required('GITHUB_OUTPUT'), `${key}=${value}\n`);
  }
}

export function needsReleaseBuild(plan, deployed, previewMaster) {
  return !deployed || (plan.target.kind === 'production' && !previewMaster);
}

export function planOutputs(plan, deployed) {
  // READY output may still need aliases/status recovery after an interrupted
  // publisher. Reconcile it without compiling or uploading it again.
  return { should_build: String(!deployed), should_publish: 'true', source_sha: plan.sha, source_ref: plan.branch, target_slug: plan.target.slug, target_kind: plan.target.kind, target_id: plan.target.id };
}

async function prepare() {
  const event = JSON.parse(await readFile(required('GITHUB_EVENT_PATH'), 'utf8'));
  const source = sourceFromEvent(required('GITHUB_EVENT_NAME'), event, process.env.SOURCE_REF);
  if (source.skip || source.branch === 'github-actions') return output({ should_build: 'false' });
  const plan = await context(source.branch, process.env.TARGET_ENVIRONMENT || 'auto');
  if (source.sha && plan.sha !== source.sha) return output({ should_build: 'false' });
  if (process.env.BUILD_ONLY === 'true') {
    await output({ ...planOutputs(plan, null), should_publish: 'false' });
    console.log(`Build-only plan: ${plan.branch} @ ${plan.sha} -> ${plan.target.slug}; publication disabled`);
    return;
  }
  const deployed = await existing(plan);
  const master = plan.target.kind === 'production' ? await existing(await context(plan.branch, 'preview')) : null;
  await output(planOutputs(plan, needsReleaseBuild(plan, deployed, master) ? null : deployed));
  console.log(`Deployment plan: ${plan.branch} @ ${plan.sha} -> ${plan.target.slug}${deployed ? ' (already deployed)' : ''}`);
}

export async function verifyAlias(check, wait = (ms) => new Promise((done) => setTimeout(done, ms)), { timeoutMs = 90_000, now = Date.now, onFailure = (observation) => console.log(JSON.stringify(observation)) } = {}) {
  const started = now();
  const delays = [2000, 5000, 10_000, 15_000];
  let waited = 0;
  let attempt = 0;
  let lastError;
  while (true) {
    const remaining = timeoutMs - Math.max(now() - started, waited);
    if (remaining <= 0) throw lastError || new Error('Alias acceptance deadline expired');
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        check({ signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Alias acceptance deadline expired')); }, remaining); })
      ]);
    } catch (error) {
      lastError = error;
      onFailure({ event: 'alias-acceptance-pending', attempt: ++attempt, elapsedMs: Math.max(now() - started, waited), ...(error.observation ? { observation: error.observation } : {}) });
    } finally { clearTimeout(timer); }
    const delay = Math.min(delays[Math.min(attempt - 1, delays.length - 1)], timeoutMs - Math.max(now() - started, waited));
    if (delay <= 0) throw lastError;
    await wait(delay);
    waited += delay;
  }
}

const safeOrigin = (value) => {
  try { const url = new URL(value); return !url.username && !url.password && ['https:', 'http:'].includes(url.protocol) && url.origin === value ? url.origin : 'invalid'; }
  catch { return 'invalid'; }
};
export async function verifyCanonicalGateway(name, gateway, deploymentId, signal) {
  const response = await fetch(`https://${name}/.well-known/thingtime-capabilities.json`, { signal, cache: 'no-store' });
  let manifest;
  try { manifest = await response.json(); } catch { manifest = null; }
  if (response.ok && manifest?.origin === `https://${name}` && manifest.gateway?.environment === gateway.environment && manifest.gateway?.origin === gateway.origin && manifest.gateway?.deploymentId === deploymentId) return;
  const error = new Error('Canonical gateway ownership failed verification');
  const cache = response.headers.get('x-vercel-cache');
  const age = response.headers.get('age');
  error.observation = { host: name, status: response.status, origin: safeOrigin(manifest?.origin), gateway: { environment: ['production', 'develop', 'preview'].includes(manifest?.gateway?.environment) ? manifest.gateway.environment : 'invalid', origin: safeOrigin(manifest?.gateway?.origin), deploymentId: /^dpl_[a-zA-Z0-9]+$/.test(manifest?.gateway?.deploymentId || '') ? manifest.gateway.deploymentId : 'invalid' }, cache: ['HIT', 'MISS', 'STALE', 'BYPASS'].includes(cache) ? cache : 'unknown', age: /^\d+$/.test(age || '') ? age : null };
  throw error;
}

async function smoke(url, { api = true, signal } = {}) {
  const home = await fetch(url, { signal: signal || AbortSignal.timeout(30_000) });
  const html = await home.text();
  if (!home.ok || !html.includes('<div id="root"></div>')) throw new Error(`Deployed Vite shell failed verification at ${url}`);
  const index = await fetch(`${url}/index.html`, { signal: signal || AbortSignal.timeout(30_000) });
  if (!index.ok || !(await index.text()).includes('<div id="root"></div>')) throw new Error('Deployed index.html failed verification');
  const asset = html.match(/(?:src|href)="(\/assets\/[^"?]+\.js)[^"]*"/);
  if (!asset) throw new Error('No deployed JavaScript asset');
  const response = await fetch(new URL(asset[1], url), { signal: signal || AbortSignal.timeout(30_000) });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('javascript')) throw new Error(`Deployed asset failed verification at ${url}`);
  if (!api) return;
  const apiResponse = await fetch(`${url}/api/root-data`, { signal: signal || AbortSignal.timeout(30_000) });
  if (!apiResponse.ok || !(apiResponse.headers.get('content-type') || '').includes('json')) throw new Error('Deployed API failed verification');
  await apiResponse.json();
}

export async function publish({ runtimeLogs = checkRuntimeLogs } = {}) {
  const branch = required('SOURCE_REF');
  const plan = await context(branch, required('TARGET_ENVIRONMENT'));
  if (plan.sha !== required('SOURCE_SHA') || plan.target.id !== (process.env.TARGET_ID || '')) {
    console.log('Source or environment advanced; a newer run owns deployment'); return;
  }
  const variables = await vercel(`/v9/projects/${plan.projectId}/env`);
  if (!gatewaySecretConfigured(variables.envs || [], plan.target)) throw new Error('Scoped encrypted gateway bootstrap secret missing');
  const source = await github(`/contents/vercel.json?ref=${plan.sha}`);
  const productConfig = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8'));
  const domains = await vercel(`/v9/projects/${plan.projectId}/domains?limit=100`);
  const previewMaster = plan.gateway.owner && plan.target.slug === 'preview';
  const aliases = new Set(previewMaster ? [new URL(plan.gateway.origin).hostname] : []);
  for (const domain of previewMaster ? [] : domains.domains || []) {
    if (domain.redirect || domain.name.startsWith('*.')) continue;
    const productionDomain = plan.target.kind === 'production' && !domain.gitBranch && !domain.customEnvironmentId;
    if (!productionDomain && domain.gitBranch !== branch && !(plan.target.id && domain.customEnvironmentId === plan.target.id)) continue;
    aliases.add(domain.name);
  }
  // Native Git used to maintain these provider-owned compatibility URLs.
  // Reconcile only existing aliases belonging to this exact project; do not
  // invent long-branch slugs or create additional public hostnames.
  for (const name of previewMaster ? [] : compatibilityAliasCandidates({ branch, projectName: required('VERCEL_PROJECT_NAME'), teamSlug: required('VERCEL_TEAM_SLUG'), target: plan.target })) {
    let alias;
    try { alias = await vercel(`/v4/aliases/${name}`); }
    catch (error) { if (error.status === 404) continue; throw error; }
    const owner = alias.projectId || (alias.deploymentId && (await vercel(`/v13/deployments/${alias.deploymentId}`)).projectId);
    if (owner !== plan.projectId) throw new Error('Compatibility alias project mismatch');
    aliases.add(name);
  }
  const readAlias = async (name) => {
    try {
      const alias = await vercel(`/v4/aliases/${name}`);
      const owner = alias.projectId || (alias.deploymentId && (await vercel(`/v13/deployments/${alias.deploymentId}`)).projectId);
      if (owner !== plan.projectId) throw new Error('Alias project mismatch');
      return alias;
    }
    catch (error) { if (error.status === 404) return null; throw error; }
  };
  const assignAlias = (name, id) => vercel(`/v2/deployments/${id}/aliases`, { method: 'POST', body: JSON.stringify({ alias: name }) });
  const removeAlias = async (name) => {
    const alias = await readAlias(name);
    if (alias) await vercel(`/v2/aliases/${alias.uid || alias.id || name}`, { method: 'DELETE' });
  };
  const canonicalHost = new URL(plan.gateway.origin).hostname;
  if (plan.gateway.owner && !aliases.has(canonicalHost)) throw new Error('Canonical gateway domain missing from project mapping');
  if (previewMaster && !(domains.domains || []).some((domain) => domain.name === '*.previews.thingtime.com' && domain.verified && !domain.redirect)) throw new Error('Preview master wildcard ownership unavailable');
  const aliasBefore = new Map(await Promise.all([...aliases].map(async (name) => [name, await readAlias(name)])));
  let deployment;
  let url;
  try {
    deployment = await existing(plan);
    if (!deployment) {
      const directory = resolve(required('VERCEL_PREBUILT_DIR'));
      // Only the validated output is read from the untrusted build. Source config
      // comes independently from the authorized immutable GitHub commit.
      const config = { framework: null, git: { deploymentEnabled: false } };
      for (const key of ['regions', 'fluid']) if (productConfig[key] !== undefined) config[key] = productConfig[key];
      if (plan.target.kind === 'production' && productConfig.crons) config.crons = productConfig.crons;
      await mkdir(resolve(directory, '.vercel'), { recursive: true });
      await writeFile(resolve(directory, '.vercel/project.json'), JSON.stringify({ orgId: required('VERCEL_TEAM_ID'), projectId: plan.projectId }), { mode: 0o600 });
      await writeFile(resolve(directory, 'vercel.json'), JSON.stringify(config));
      await applyOutputPolicy(directory, productConfig, plan.target);
      const args = deploymentArgs({ ...plan, regions: productConfig.regions, directory, teamSlug: required('VERCEL_TEAM_SLUG'), runId: required('GITHUB_RUN_ID'), repository: required('GITHUB_REPOSITORY') });
      let stdout;
      try {
        ({ stdout } = await exec(required('VERCEL_CLI_PATH'), args, { env: gatewayPublisherEnvironment(plan.gateway, publisherEnvironment({ teamId: required('VERCEL_TEAM_ID'), projectId: plan.projectId, token: required('VERCEL_API_TOKEN') })), timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 }));
      } catch {
        // Reconcile an uncertain upload once; never silently retry a deployment.
        deployment = await existing(plan);
        if (!deployment) throw new Error('Prebuilt upload failed; inspect Vercel and the workflow before retrying');
      }
      if (!deployment) {
        const urls = stdout.match(/https:\/\/[a-z0-9.-]+\.vercel\.app\/?/gi) || [];
        if (!urls.length) throw new Error('Publisher returned no deployment URL');
        deployment = await vercel(`/v13/deployments/${new URL(urls.at(-1)).hostname}`);
      }
    }
    const issue = deploymentIssue(deployment, plan) || runtimePolicyIssue(deployment, productConfig, plan.target);
    if (issue || deployment.readyState !== 'READY') throw new Error(`Deployment verification failed (${issue || deployment.readyState})`);
    url = `https://${deployment.url}`;
    await smoke(url, { api: !plan.gateway.owner });
    // A READY upload and a Vite shell do not establish writable account storage.
    // The selected backend must be ready before any production alias moves.
    if (plan.target.kind === 'production') {
      await checkStorageReadiness(url, { minimumVersion: '1.2.1' });
      const until = Date.now();
      await runtimeLogs({ cli: required('VERCEL_CLI_PATH'), projectId: plan.projectId, deploymentId: deployment.id, scope: required('VERCEL_TEAM_SLUG'), since: new Date(until - 30 * 60_000).toISOString(), until: new Date(until).toISOString() });
    }
    if ((await context(branch, plan.target.slug)).sha !== plan.sha) throw new Error('Branch advanced before alias publication');
    await reconcileGatewayAliases({
      names: [...aliases], before: aliasBefore, deploymentId: deployment.id, read: readAlias, assign: assignAlias, remove: removeAlias,
      verify: (name) => verifyAlias(async ({ signal }) => {
        if (name === new URL(plan.gateway.origin).hostname && plan.gateway.owner) await verifyCanonicalGateway(name, plan.gateway, deployment.id, signal);
        await smoke(`https://${name}`, { signal });
        if (plan.target.kind === 'production') await checkStorageReadiness(`https://${name}`, { signal, minimumVersion: '1.2.1' });
      })
    });
  } catch (error) {
    if (deployment) await restoreGatewayAliases({ before: aliasBefore, deploymentId: deployment.id, read: readAlias, assign: assignAlias, remove: removeAlias });
    else {
      // An interrupted CLI may have autoassigned a custom environment before
      // returning its URL. Reconcile only this run's independently verified upload.
      for (const name of aliases) {
        const current = await readAlias(name);
        if (!current || current.deploymentId === aliasBefore.get(name)?.deploymentId) continue;
        const candidate = await vercel(`/v13/deployments/${current.deploymentId}`);
        if (!deploymentIssue(candidate, plan) && candidate.meta?.githubWorkflowRunId === required('GITHUB_RUN_ID')) await restoreGatewayAliases({ before: aliasBefore, deploymentId: candidate.id, read: readAlias, assign: assignAlias, remove: removeAlias });
      }
    }
    throw error;
  }
  const statusContext = `Vercel prebuilt (${plan.target.slug})`;
  const statuses = await github(`/commits/${plan.sha}/status`);
  if (!statuses.statuses?.some((status) => status.context === statusContext && status.state === 'success' && status.target_url === url)) {
    await github(`/statuses/${plan.sha}`, { method: 'POST', body: JSON.stringify({ state: 'success', context: statusContext, target_url: url, description: 'Built on GitHub Actions; uploaded as prebuilt output' }) });
  }
  await appendFile(required('GITHUB_STEP_SUMMARY'), `### Vercel prebuilt deployment\n\n- Source: \`${plan.branch}\` @ \`${plan.sha}\`\n- Environment: \`${plan.target.slug}\`\n- Deployment: ${url}\n- Build compute: GitHub-hosted Ubuntu runner\n`);
  console.log(`Verified ${plan.target.slug}: ${url} (${deployment.id})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (process.argv.includes('--prepare') ? prepare() : publish()).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
