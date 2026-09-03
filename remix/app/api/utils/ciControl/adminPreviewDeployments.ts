import { githubRequest, repositoryName } from './githubClient';
import {
  adminPreviewCommentBody,
  adminPreviewPersistentHostname,
  adminPreviewRemovedCommentBody,
  adminPreviewSnapshotUrl,
  isOwnedAdminPreviewComment,
  type AdminPreviewCommentRow
} from './adminPreviewPublicationCore';
import {
  adminPreviewDeploymentPayload,
  type CiPreviewEnvironment,
  type CiPreviewPolicy
} from './previewPolicyCore';
import { listCiPreviewPolicies, recordCiEvent, upsertCiEntity } from './store';

const ACTIVE_VERCEL_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING', 'READY']);
const MAX_GITHUB_COMMENT_PAGES = 10;

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
  developEnvironmentId: environment === 'develop' ? required('VERCEL_CUSTOM_ENVIRONMENT_ID') : undefined,
  aliasSuffixes: {
    develop: process.env.PREVIEW_ALIAS_SUFFIX?.trim() || 'previews.dev.thingtime.com',
    production: process.env.PRODUCTION_PREVIEW_ALIAS_SUFFIX?.trim() || 'previews.thingtime.com'
  }
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

export type AdminPreviewDeploymentResult = {
  environment: CiPreviewEnvironment;
  deploymentId: string;
  sha: string;
  status: string;
  url: string | null;
  snapshotUrl: string | null;
  persistentUrl: string;
};

const deploymentStatus = (deployment: any): string =>
  String(deployment?.readyState ?? deployment?.state ?? 'queued').toLowerCase();

const deploymentCreatedAt = (deployment: any): number => {
  const value = deployment?.createdAt ?? deployment?.created;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const newestOwnedDeployment = (deployments: any[], input: { prNumber: number; environment: CiPreviewEnvironment; sha: string }) =>
  deployments
    .filter((deployment) => ownedDeployment(deployment, input))
    .sort((left, right) => deploymentCreatedAt(right) - deploymentCreatedAt(left))[0] ?? null;

const persistentUrlFor = (prNumber: number, environment: CiPreviewEnvironment): string => {
  const config = previewConfig(environment);
  return `https://${adminPreviewPersistentHostname(prNumber, environment, config.aliasSuffixes)}/`;
};

const getOwnedAlias = async (projectId: string, alias: string) => {
  const query = new URLSearchParams({ projectId });
  const found = await vercelRequest<any>(`/v4/aliases/${encodeURIComponent(alias)}?${query}`, { accept: [200, 404] });
  if (!found?.alias) return null;
  if (found.alias !== alias || found.projectId !== projectId || !/^dpl_[A-Za-z0-9]+$/.test(found.deploymentId ?? '')) {
    throw new Error('Persistent preview alias ownership did not match the configured project');
  }
  return found;
};

const assignPersistentAlias = async (
  pr: PreviewPullRequest,
  environment: CiPreviewEnvironment,
  deploymentId: string
): Promise<string> => {
  const config = previewConfig(environment);
  const alias = adminPreviewPersistentHostname(pr.number, environment, config.aliasSuffixes);
  const deployment = await vercelRequest<any>(`/v13/deployments/${encodeURIComponent(deploymentId)}?withGitRepoInfo=true`);
  if (
    !ownedDeployment(deployment, { prNumber: pr.number, environment, sha: pr.head!.sha }) ||
    deploymentStatus(deployment) !== 'ready'
  ) {
    throw new Error('Refusing to publish an unverified or non-ready preview deployment');
  }
  const existing = await getOwnedAlias(config.projectId, alias);
  if (existing?.deploymentId === deploymentId) return `https://${alias}/`;
  try {
    const assigned = await vercelRequest<any>(`/v2/deployments/${encodeURIComponent(deploymentId)}/aliases`, {
      method: 'POST',
      accept: [200],
      body: { alias }
    });
    if (assigned?.alias !== alias) throw new Error('Vercel assigned an unexpected persistent preview alias');
  } catch (error) {
    const reconciled = await getOwnedAlias(config.projectId, alias);
    if (reconciled?.deploymentId !== deploymentId) throw error;
  }
  const verified = await getOwnedAlias(config.projectId, alias);
  if (verified?.deploymentId !== deploymentId) throw new Error('Persistent preview alias did not resolve to the expected deployment');
  return `https://${alias}/`;
};

const removePersistentAlias = async (prNumber: number, environment: CiPreviewEnvironment): Promise<boolean> => {
  const config = previewConfig(environment);
  const alias = adminPreviewPersistentHostname(prNumber, environment, config.aliasSuffixes);
  const found = await getOwnedAlias(config.projectId, alias);
  if (!found) return false;
  const deployment = await vercelRequest<any>(`/v13/deployments/${encodeURIComponent(found.deploymentId)}?withGitRepoInfo=true`, {
    accept: [200, 404]
  });
  if (deployment?.id && !ownedDeployment(deployment, { prNumber, environment })) {
    throw new Error('Refusing to remove a persistent alias owned by another preview');
  }
  await vercelRequest(`/v2/aliases/${encodeURIComponent(found.uid)}`, { method: 'DELETE', accept: [200, 204, 404] });
  return true;
};

const configuredGithubAppId = (): number => {
  const value = Number(process.env.THINGTIME_GITHUB_APP_ID);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('GitHub App id is not configured');
  return value;
};

const upsertPreviewComment = async (repository: string, prNumber: number, body: string, createIfMissing: boolean) => {
  const githubAppId = configuredGithubAppId();
  let existing: any = null;
  for (let page = 1; page <= MAX_GITHUB_COMMENT_PAGES; page += 1) {
    const comments = await githubRequest<any[]>(`/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(comments)) throw new Error('GitHub comments response was invalid');
    existing = comments.find((comment) => isOwnedAdminPreviewComment(comment, githubAppId));
    if (existing || comments.length < 100) break;
    if (page === MAX_GITHUB_COMMENT_PAGES) throw new Error('GitHub preview comment scan exceeded its safety bound');
  }
  if (existing) {
    await githubRequest(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
    return { commented: true, created: false };
  }
  if (!createIfMissing) return { commented: false, created: false };
  await githubRequest(`/repos/${repository}/issues/${prNumber}/comments`, { method: 'POST', body: { body } });
  return { commented: true, created: true };
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
  const snapshotUrl = adminPreviewSnapshotUrl(deployment.url);
  if (!snapshotUrl) throw new Error('Vercel returned an invalid preview deployment URL');
  const persistentUrl = persistentUrlFor(pr.number, environment);
  const entity = await upsertCiEntity({
    kind: 'ci-preview',
    provider: 'vercel',
    repository,
    externalId: deploymentId,
    title: `PR #${pr.number} ${environment} preview`,
    status: String(deployment.readyState ?? deployment.state ?? 'queued').toLowerCase(),
    url: snapshotUrl,
    occurredAt: new Date(),
    data: {
      deploymentId,
      projectId: config.projectId,
      prNumber: pr.number,
      previewEnvironment: environment,
      ref: pr.head!.ref,
      sha: pr.head!.sha,
      target: environment === 'production' ? 'production' : 'develop',
      snapshotUrl,
      persistentUrl
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
  const status = deploymentStatus(deployment);
  return {
    environment,
    deploymentId,
    sha: pr.head!.sha!,
    status,
    url: snapshotUrl,
    snapshotUrl,
    persistentUrl
  } satisfies AdminPreviewDeploymentResult;
};

export const removeAdminPrPreviews = async (prNumber: number, environment: CiPreviewEnvironment) => {
  const config = previewConfig(environment);
  const deployments = await listOwnedDeployments(config.projectId, prNumber, environment);
  const aliasRemoved = await removePersistentAlias(prNumber, environment);
  let removed = 0;
  for (const deployment of deployments) {
    const id = String(deployment.id ?? deployment.uid ?? '');
    if (!/^dpl_[A-Za-z0-9]+$/.test(id) || !ownedDeployment(deployment, { prNumber, environment })) continue;
    await vercelRequest(`/v13/deployments/${encodeURIComponent(id)}`, { method: 'DELETE', accept: [200, 204, 404] });
    removed += 1;
  }
  return { removed, aliasRemoved };
};

export const publishAdminPrPreviewComment = async (input: {
  pr: PreviewPullRequest;
  policy: CiPreviewPolicy;
  knownDeployments?: AdminPreviewDeploymentResult[];
}) => {
  const repository = repositoryName();
  const enabled = (['develop', 'production'] as const).filter((environment) => input.policy[environment]);
  const known = new Map((input.knownDeployments ?? []).map((deployment) => [deployment.environment, deployment]));
  const rows: AdminPreviewCommentRow[] = [];
  for (const environment of enabled) {
    const config = previewConfig(environment);
    const fromKnown = known.get(environment);
    const deployment = newestOwnedDeployment(await listOwnedDeployments(config.projectId, input.pr.number, environment), {
      prNumber: input.pr.number,
      environment,
      sha: input.pr.head!.sha!
    });
    const listedDeploymentId = String(deployment?.id ?? deployment?.uid ?? '');
    const knownMatchesNewest = Boolean(fromKnown?.deploymentId) && fromKnown?.deploymentId === listedDeploymentId;
    const deploymentId = listedDeploymentId || fromKnown?.deploymentId || '';
    const status = knownMatchesNewest || !deployment ? fromKnown?.status ?? deploymentStatus(deployment) : deploymentStatus(deployment);
    const snapshotUrl =
      knownMatchesNewest || !deployment ? fromKnown?.snapshotUrl ?? adminPreviewSnapshotUrl(deployment?.url) : adminPreviewSnapshotUrl(deployment?.url);
    let persistentUrl = persistentUrlFor(input.pr.number, environment);
    if (status === 'ready' && /^dpl_[A-Za-z0-9]+$/.test(deploymentId)) {
      persistentUrl = await assignPersistentAlias(input.pr, environment, deploymentId);
    }
    rows.push({ environment, status, snapshotUrl, persistentUrl });
  }
  const comment = await upsertPreviewComment(
    repository,
    input.pr.number,
    adminPreviewCommentBody({ prNumber: input.pr.number, sha: input.pr.head!.sha!, rows }),
    rows.length > 0
  );
  return { ...comment, previews: rows };
};

export const refreshAdminPrPreviewPublication = async (
  prNumber: number,
  knownDeployments: AdminPreviewDeploymentResult[] = []
) => {
  const repository = repositoryName();
  const policy = (await listCiPreviewPolicies(repository)).find((candidate) => candidate.prNumber === prNumber);
  if (!policy || (!policy.develop && !policy.production)) return { commented: false, previews: [] as AdminPreviewCommentRow[] };
  let pr: PreviewPullRequest;
  try {
    pr = await validatedPreviewPullRequest(prNumber);
  } catch {
    return { commented: false, previews: [] as AdminPreviewCommentRow[] };
  }
  return publishAdminPrPreviewComment({
    pr,
    policy,
    knownDeployments: knownDeployments.filter((deployment) => deployment.sha === pr.head!.sha)
  });
};

export const refreshAdminPrPreviewPublicationForDeployment = async (input: {
  prNumber: number;
  environment: CiPreviewEnvironment;
  deploymentId: string;
  sha: string;
  status: string;
  snapshotUrl: string | null;
}) =>
  refreshAdminPrPreviewPublication(input.prNumber, [
    {
      ...input,
      url: input.snapshotUrl,
      persistentUrl: persistentUrlFor(input.prNumber, input.environment)
    }
  ]);

const markAdminPrPreviewCommentRemoved = async (repository: string, prNumber: number) =>
  upsertPreviewComment(repository, prNumber, adminPreviewRemovedCommentBody(prNumber), false);

const PREVIEW_REFRESH_ACTIONS = new Set(['opened', 'reopened', 'ready_for_review', 'synchronize']);

export const syncAdminPrPreviewsForPullRequest = async (prNumber: number, action: string) => {
  const repository = repositoryName();
  const policy = (await listCiPreviewPolicies(repository)).find((candidate) => candidate.prNumber === prNumber);
  if (!policy || (!policy.develop && !policy.production)) return { attempted: 0, failures: 0 };

  const enabled = (['develop', 'production'] as const).filter((environment) => policy[environment]);
  if (action === 'closed') {
    const results = await Promise.allSettled(enabled.map((environment) => removeAdminPrPreviews(prNumber, environment)));
    const failures = results.filter((result) => result.status === 'rejected').length;
    if (!failures) await markAdminPrPreviewCommentRemoved(repository, prNumber);
    return { attempted: enabled.length, failures };
  }
  if (!PREVIEW_REFRESH_ACTIONS.has(action)) return { attempted: 0, failures: 0 };

  const pr = await validatedPreviewPullRequest(prNumber);
  const results = await Promise.allSettled(
    enabled.map((environment) => buildAdminPrPreview(pr, environment, 'github-webhook'))
  );
  const knownDeployments = results.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          environment: enabled[index],
          deploymentId: '',
          sha: pr.head!.sha!,
          status: 'failed',
          url: null,
          snapshotUrl: null,
          persistentUrl: persistentUrlFor(prNumber, enabled[index])
        }
  );
  let failures = results.filter((result) => result.status === 'rejected').length;
  try {
    await publishAdminPrPreviewComment({ pr, policy, knownDeployments });
  } catch {
    failures += 1;
  }
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
