import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export const marker = 'thingtimeGithubActionsBuild';
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
  if (!response.ok) throw new Error(`Provider request failed: HTTP ${response.status} (${new URL(url).pathname})`);
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
  if (deployment.projectId !== projectId) return 'project';
  if (deployment.meta?.[marker] !== '1') return 'build-marker';
  if (deployment.meta?.githubCommitSha !== sha || deployment.meta?.githubCommitRef !== branch) return 'source';
  if (deployment.meta?.thingtimeBuildTarget !== target.slug) return 'target-marker';
  if (target.kind === 'production' ? deployment.target !== 'production' : deployment.target === 'production') return 'production-target';
  if ((deployment.customEnvironment?.id || deployment.customEnvironmentId || '') !== target.id) return 'custom-environment';
  return null;
}

export function deploymentArgs({ directory, target, branch, sha, teamSlug, runId, repository }) {
  const args = ['deploy', '--prebuilt', '--archive=tgz', '--yes', '--scope', teamSlug, '--cwd', directory];
  args.push(target.kind === 'production' ? '--prod' : `--target=${target.slug}`);
  const [owner, repo] = repository.split('/');
  for (const [key, value] of Object.entries({ [marker]: '1', thingtimeBuildTarget: target.slug, githubCommitSha: sha, githubCommitRef: branch, githubCommitOrg: owner, githubCommitRepo: repo, githubDeployment: '1', githubWorkflowRunId: runId })) args.push('--meta', `${key}=${value}`);
  for (const [key, value] of Object.entries({ THINGTIME_BRANCH_NAME: branch, THINGTIME_GIT_COMMIT_SHA: sha })) args.push('--env', `${key}=${value}`);
  return args;
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
  return { sha, branch, target, projectId: project.id };
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

async function prepare() {
  const event = JSON.parse(await readFile(required('GITHUB_EVENT_PATH'), 'utf8'));
  const source = sourceFromEvent(required('GITHUB_EVENT_NAME'), event, process.env.SOURCE_REF);
  if (source.skip || source.branch === 'github-actions') return output({ should_build: 'false' });
  const plan = await context(source.branch, process.env.TARGET_ENVIRONMENT || 'auto');
  if (source.sha && plan.sha !== source.sha) return output({ should_build: 'false' });
  const deployed = await existing(plan);
  await output({ should_build: String(!deployed), source_sha: plan.sha, source_ref: plan.branch, target_slug: plan.target.slug, target_kind: plan.target.kind, target_id: plan.target.id });
  console.log(`Deployment plan: ${plan.branch} @ ${plan.sha} -> ${plan.target.slug}${deployed ? ' (already deployed)' : ''}`);
}

async function smoke(url) {
  const home = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const html = await home.text();
  if (!home.ok || !html.includes('<div id="root"></div>')) throw new Error('Deployed Vite shell failed verification');
  const index = await fetch(`${url}/index.html`, { signal: AbortSignal.timeout(30_000) });
  if (!index.ok || !(await index.text()).includes('<div id="root"></div>')) throw new Error('Deployed index.html failed verification');
  const asset = html.match(/(?:src|href)="(\/assets\/[^"?]+\.js)[^"]*"/);
  if (!asset) throw new Error('No deployed JavaScript asset');
  const response = await fetch(new URL(asset[1], url), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('javascript')) throw new Error('Deployed asset failed verification');
  const api = await fetch(`${url}/api/root-data`, { signal: AbortSignal.timeout(30_000) });
  if (!api.ok || !(api.headers.get('content-type') || '').includes('json')) throw new Error('Deployed API failed verification');
  await api.json();
}

async function publish() {
  const branch = required('SOURCE_REF');
  const plan = await context(branch, required('TARGET_ENVIRONMENT'));
  if (plan.sha !== required('SOURCE_SHA') || plan.target.id !== (process.env.TARGET_ID || '')) {
    console.log('Source or environment advanced; a newer run owns deployment'); return;
  }
  let deployment = await existing(plan);
  if (!deployment) {
    const directory = resolve(required('VERCEL_PREBUILT_DIR'));
    // Only the validated output is read from the untrusted build. Source config
    // comes independently from the authorized immutable GitHub commit.
    const source = await github(`/contents/vercel.json?ref=${plan.sha}`);
    const productConfig = JSON.parse(Buffer.from(source.content, 'base64').toString('utf8'));
    const config = { framework: null, git: { deploymentEnabled: false } };
    for (const key of ['regions', 'fluid']) if (productConfig[key] !== undefined) config[key] = productConfig[key];
    if (plan.target.kind === 'production' && productConfig.crons) config.crons = productConfig.crons;
    await mkdir(resolve(directory, '.vercel'), { recursive: true });
    await writeFile(resolve(directory, '.vercel/project.json'), JSON.stringify({ orgId: required('VERCEL_TEAM_ID'), projectId: plan.projectId }), { mode: 0o600 });
    await writeFile(resolve(directory, 'vercel.json'), JSON.stringify(config));
    const args = deploymentArgs({ ...plan, directory, teamSlug: required('VERCEL_TEAM_SLUG'), runId: required('GITHUB_RUN_ID'), repository: required('GITHUB_REPOSITORY') });
    let stdout;
    try {
      ({ stdout } = await exec(required('VERCEL_CLI_PATH'), args, { env: { ...process.env, VERCEL_TOKEN: required('VERCEL_API_TOKEN') }, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 }));
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
  const issue = deploymentIssue(deployment, plan);
  if (issue || deployment.readyState !== 'READY') throw new Error(`Deployment verification failed (${issue || deployment.readyState})`);
  const url = `https://${deployment.url}`;
  await smoke(url);
  if ((await context(branch, plan.target.slug)).sha !== plan.sha) throw new Error('Branch advanced before alias publication');
  const domains = await vercel(`/v9/projects/${plan.projectId}/domains?limit=100`);
  for (const domain of domains.domains || []) {
    if (domain.redirect || domain.name.startsWith('*.')) continue;
    const productionDomain = plan.target.kind === 'production' && !domain.gitBranch && !domain.customEnvironmentId;
    if (!productionDomain && domain.gitBranch !== branch && !(plan.target.id && domain.customEnvironmentId === plan.target.id)) continue;
    await vercel(`/v2/deployments/${deployment.id}/aliases`, { method: 'POST', body: JSON.stringify({ alias: domain.name }) });
    const alias = await vercel(`/v4/aliases/${domain.name}`);
    if (alias.deploymentId !== deployment.id) throw new Error('Alias did not publish the verified deployment');
    await smoke(`https://${domain.name}`);
  }
  await github(`/statuses/${plan.sha}`, { method: 'POST', body: JSON.stringify({ state: 'success', context: `Vercel prebuilt (${plan.target.slug})`, target_url: url, description: 'Built on GitHub Actions; uploaded as prebuilt output' }) });
  await appendFile(required('GITHUB_STEP_SUMMARY'), `### Vercel prebuilt deployment\n\n- Source: \`${plan.branch}\` @ \`${plan.sha}\`\n- Environment: \`${plan.target.slug}\`\n- Deployment: ${url}\n- Build compute: GitHub-hosted Ubuntu runner\n`);
  console.log(`Verified ${plan.target.slug}: ${url} (${deployment.id})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  (process.argv.includes('--prepare') ? prepare() : publish()).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
