import { githubRequest, repositoryName } from './githubClient';
import { adminPreviewDeploymentPayload, type CiPreviewEnvironment } from './previewPolicyCore';
import { listCiPreviewPolicies, recordCiEvent, upsertCiEntity } from './store';

const ACTIVE_VERCEL_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING', 'READY']);

type PreviewPullRequest = {
  number: number;
  state: string;
  draft: boolean;
  base?: { repo?: { id?: number; full_name?: string } };
  head?: { ref?: string; sha?: string; repo?: { id?: number; full_name?: string } };
};

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Preview builder is missing ${name}`);
  return value;
};

const previewConfig = (environment: CiPreviewEnvironment) => ({
  token: required('VERCEL_API_TOKEN'),
  teamId: required('VERCEL_TEAM_ID'),
  projectId: required('VERCEL_PROJECT_ID'),
  projectName: process.env.VERCEL_PROJECT_NAME?.trim() || 'thingtime',
  gitRepoId: Number(required('VERCEL_GITHUB_REPO_ID')),
  developEnvironmentId: environment === 'develop' ? required('VERCEL_CUSTOM_ENVIRONMENT_ID') : undefined
});

export const ciAdminPreviewReadiness = () => {
  const requiredNames = ['VERCEL_API_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID', 'VERCEL_GITHUB_REPO_ID', 'VERCEL_CUSTOM_ENVIRONMENT_ID'];
  const missing = requiredNames.filter((name) => !process.env[name]?.trim());
  return { configured: missing.length === 0, missing };
};

const vercelRequest = async <T>(path: string, init: { method?: string; body?: unknown; accept?: number[] } = {}): Promise<T> => {
  const teamId = required('VERCEL_TEAM_ID');
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`https://api.vercel.com${path}${separator}teamId=${encodeURIComponent(teamId)}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${required('VERCEL_API_TOKEN')}`,
      'Content-Type': 'application/json',
      'User-Agent': 'thingtime-admin-pr-preview'
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000)
  });
  const payload = await response.json().catch(() => null);
  if (!(init.accept ?? [200]).includes(response.status)) {
    throw new Error(`Vercel preview request failed (${response.status})`);
  }
  return payload as T;
};

export const validatedPreviewPullRequest = async (prNumber: number): Promise<PreviewPullRequest> => {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Choose a valid pull request');
  const repository = repositoryName();
  const pr = await githubRequest<PreviewPullRequest>(`/repos/${repository}/pulls/${prNumber}`);
  if (pr.state !== 'open' || pr.draft) throw new Error('Preview builds require an open, ready pull request');
  if (pr.base?.repo?.full_name !== repository || pr.head?.repo?.full_name !== repository) {
    throw new Error('Production-data previews are limited to same-repository pull requests');
  }
  if (!/^[0-9a-f]{40}$/.test(pr.head?.sha ?? '') || !pr.head?.ref || Number(pr.base?.repo?.id) < 1) {
    throw new Error('The live pull request head is not deployable');
  }
  return pr;
};

const ownedDeployment = (deployment: any, input: { prNumber: number; environment: CiPreviewEnvironment; sha?: string }) =>
  deployment?.meta?.thingtimeAdminPrPreview === '1' &&
  deployment?.meta?.thingtimePreviewEnvironment === input.environment &&
  String(deployment?.meta?.githubPrId ?? '') === String(input.prNumber) &&
  (!input.sha || deployment?.meta?.githubCommitSha === input.sha);

const listOwnedDeployments = async (projectId: string, prNumber: number, environment: CiPreviewEnvironment) => {
  const query = new URLSearchParams({
    projectId,
    limit: '100',
    'meta-thingtimeAdminPrPreview': '1',
    'meta-thingtimePreviewEnvironment': environment,
    'meta-githubPrId': String(prNumber)
  });
  const payload = await vercelRequest<{ deployments?: any[] }>(`/v6/deployments?${query}`);
  return (payload.deployments ?? []).filter((deployment) => ownedDeployment(deployment, { prNumber, environment }));
};

export const buildAdminPrPreview = async (pr: PreviewPullRequest, environment: CiPreviewEnvironment, actorId: string) => {
  const repository = repositoryName();
  const config = previewConfig(environment);
  if (!Number.isSafeInteger(config.gitRepoId) || config.gitRepoId < 1) throw new Error('Preview builder has an invalid Vercel Git repository id');
  const existing = (await listOwnedDeployments(config.projectId, pr.number, environment)).find(
    (deployment) => ownedDeployment(deployment, { prNumber: pr.number, environment, sha: pr.head!.sha }) && ACTIVE_VERCEL_STATES.has(String(deployment.readyState ?? deployment.state).toUpperCase())
  );
  const candidate =
    existing ??
    (await vercelRequest<any>('/v13/deployments?forceNew=1', {
      method: 'POST',
      accept: [200, 201],
      body: adminPreviewDeploymentPayload({
        environment,
        projectId: config.projectId,
        projectName: config.projectName,
        gitRepoId: config.gitRepoId,
        repositoryId: Number(pr.base!.repo!.id),
        repository,
        prNumber: pr.number,
        headRef: pr.head!.ref!,
        headSha: pr.head!.sha!,
        developEnvironmentId: config.developEnvironmentId
      })
    }));
  const deploymentId = String(candidate.id ?? candidate.uid ?? '');
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)) throw new Error('Vercel did not identify the preview deployment');
  const deployment = await vercelRequest<any>(`/v13/deployments/${encodeURIComponent(deploymentId)}?withGitRepoInfo=true`);
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId) || !ownedDeployment(deployment, { prNumber: pr.number, environment, sha: pr.head!.sha })) {
    throw new Error('Vercel returned an unverified preview deployment');
  }
  const url = typeof deployment.url === 'string' ? `https://${deployment.url}` : null;
  const entity = await upsertCiEntity({
    kind: 'ci-preview',
    provider: 'vercel',
    repository,
    externalId: deploymentId,
    title: `PR #${pr.number} ${environment} preview`,
    status: String(deployment.readyState ?? deployment.state ?? 'queued').toLowerCase(),
    url,
    occurredAt: new Date(),
    data: {
      deploymentId,
      projectId: config.projectId,
      prNumber: pr.number,
      previewEnvironment: environment,
      ref: pr.head!.ref,
      sha: pr.head!.sha,
      target: environment === 'production' ? 'production' : 'develop'
    }
  });
  await recordCiEvent({
    provider: 'thingtime',
    repository,
    deliveryId: `admin-preview:${deploymentId}`,
    eventType: 'admin_preview_build',
    action: environment,
    actor: actorId,
    parentId: entity.id,
    statusFrom: null,
    statusTo: 'queued',
    occurredAt: new Date(),
    data: { prNumber: pr.number }
  });
  return { deploymentId, status: String(deployment.readyState ?? deployment.state ?? 'queued').toLowerCase(), url };
};

export const removeAdminPrPreviews = async (prNumber: number, environment: CiPreviewEnvironment) => {
  const config = previewConfig(environment);
  const deployments = await listOwnedDeployments(config.projectId, prNumber, environment);
  let removed = 0;
  for (const deployment of deployments) {
    const id = String(deployment.id ?? deployment.uid ?? '');
    if (!/^dpl_[A-Za-z0-9]+$/.test(id) || !ownedDeployment(deployment, { prNumber, environment })) continue;
    await vercelRequest(`/v13/deployments/${encodeURIComponent(id)}`, { method: 'DELETE', accept: [200, 204, 404] });
    removed += 1;
  }
  return { removed };
};

const PREVIEW_REFRESH_ACTIONS = new Set(['opened', 'reopened', 'ready_for_review', 'synchronize']);

export const syncAdminPrPreviewsForPullRequest = async (prNumber: number, action: string) => {
  const repository = repositoryName();
  const policy = (await listCiPreviewPolicies(repository)).find((candidate) => candidate.prNumber === prNumber);
  if (!policy || (!policy.develop && !policy.production)) return { attempted: 0, failures: 0 };

  const enabled = (['develop', 'production'] as const).filter((environment) => policy[environment]);
  if (action === 'closed') {
    const results = await Promise.allSettled(enabled.map((environment) => removeAdminPrPreviews(prNumber, environment)));
    return { attempted: enabled.length, failures: results.filter((result) => result.status === 'rejected').length };
  }
  if (!PREVIEW_REFRESH_ACTIONS.has(action)) return { attempted: 0, failures: 0 };

  const pr = await validatedPreviewPullRequest(prNumber);
  const results = await Promise.allSettled(
    enabled.map((environment) => buildAdminPrPreview(pr, environment, 'github-webhook'))
  );
  const failures = results.filter((result) => result.status === 'rejected').length;
  if (failures) {
    await recordCiEvent({
      provider: 'thingtime',
      repository,
      deliveryId: `admin-preview-sync:${prNumber}:${pr.head?.sha}`,
      eventType: 'admin_preview_sync',
      action,
      actor: 'github-webhook',
      parentId: policy.id,
      statusFrom: null,
      statusTo: 'partial_failure',
      occurredAt: new Date(),
      data: { prNumber, attempted: enabled.length, failures }
    });
  }
  return { attempted: enabled.length, failures };
};
