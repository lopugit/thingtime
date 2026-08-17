import { createSign } from 'node:crypto';

import type { CiWorkflowKey } from './automationPolicy';
import { ciProviderReadiness } from './providerReadiness';
import { getCiAutomationPolicy, recordCiEvent, upsertCiEntity } from './store';
import { ciFeatureIdentity } from './webhooks';

export type { CiWorkflowKey } from './automationPolicy';

const API_VERSION = '2022-11-28';
const DEFAULT_REPOSITORY = 'lopugit/thingtime';
const DEFAULT_CONTROL_REF = 'github-actions';

type CachedToken = { token: string; expiresAt: number };
let cachedInstallationToken: CachedToken | null = null;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

const appPrivateKey = (): string => {
  const raw = process.env.THINGTIME_GITHUB_APP_PRIVATE_KEY ?? '';
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
};

const appJwt = (): string => {
  const appId = (process.env.THINGTIME_GITHUB_APP_ID ?? '').trim();
  const privateKey = appPrivateKey();
  if (!appId || !privateKey) throw new Error('GitHub App credentials are not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const payload = encode({ iat: now - 60, exp: now + 9 * 60, iss: appId });
  const unsigned = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString('base64url')}`;
};

const installationId = (): string => {
  const id = (process.env.THINGTIME_GITHUB_APP_INSTALLATION_ID ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('GitHub App installation id is not configured');
  return id;
};

const installationToken = async (): Promise<string> => {
  if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 90_000) {
    return cachedInstallationToken.token;
  }
  const response = await fetch(`https://api.github.com/app/installations/${installationId()}/access_tokens`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${appJwt()}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'thingtime-ci-control'
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || typeof payload?.token !== 'string') {
    throw new Error(`GitHub App installation authentication failed (${response.status})`);
  }
  const expiresAt = new Date(payload.expires_at).getTime();
  cachedInstallationToken = {
    token: payload.token,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 50 * 60 * 1000
  };
  return payload.token;
};

export const githubRequest = async <T = any>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${await installationToken()}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'thingtime-ci-control'
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body)
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status})`);
  }
  return payload as T;
};

export const repositoryName = () =>
  (process.env.THINGTIME_GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY).trim() || DEFAULT_REPOSITORY;

const workflowFileByKey = {
  'resolve-conflicts': 'resolve-pr-conflicts.yml',
  'rebase-stack': 'rebase-pr-stacks.yml',
  'promote-features': 'promote-features-to-main.yml',
  'promote-develop': 'promote-develop-to-main.yml',
  'sync-main': 'sync-main-into-develop.yml',
  'web-ci': 'web-ci.yml',
  'electron-release': 'electron-release.yml'
} as const;

const inputAllowlist: Record<CiWorkflowKey, readonly string[]> = {
  'resolve-conflicts': ['pr_number', 'branch'],
  'rebase-stack': ['pr_number', 'branch', 'cascade'],
  'promote-features': ['dry_run', 'lookback'],
  'promote-develop': [],
  'sync-main': [],
  'web-ci': [],
  'electron-release': []
};

const workflowEntryRef: Record<CiWorkflowKey, 'develop' | 'main'> = {
  'resolve-conflicts': 'develop',
  'rebase-stack': 'develop',
  'promote-features': 'develop',
  'promote-develop': 'develop',
  'sync-main': 'main',
  'web-ci': 'develop',
  'electron-release': 'main'
};

export const resolveCiWorkflowEntryRef = (workflow: CiWorkflowKey, requested?: unknown): 'develop' | 'main' => {
  const expected = workflowEntryRef[workflow];
  const supplied = typeof requested === 'string' ? requested.trim() : '';
  if (supplied && supplied !== expected) {
    throw new Error(`The ${workflow} workflow must enter through ${expected}`);
  }
  return expected;
};

export const dispatchCiWorkflow = async (input: {
  workflow: CiWorkflowKey;
  ref?: string;
  inputs?: Record<string, unknown>;
  actorId: string;
  externalId?: string;
  requestedAt?: Date;
}) => {
  const workflowFile = workflowFileByKey[input.workflow];
  if (!workflowFile) throw new Error('Unsupported CI workflow');
  // workflow_dispatch loads its listener from `ref`. Keep that entrypoint on
  // the two reviewed product branches; an arbitrary feature ref could carry
  // executable YAML and would defeat the protected control plane.
  const ref = resolveCiWorkflowEntryRef(input.workflow, input.ref);
  const allowed = new Set(inputAllowlist[input.workflow]);
  const inputs = Object.fromEntries(
    Object.entries(input.inputs ?? {})
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value ?? '').slice(0, 300)])
  );
  const repository = repositoryName();
  const policy = await getCiAutomationPolicy(repository, input.workflow);
  if (!policy.enabled) throw new Error(`The ${input.workflow} automation is disabled`);
  const requestedAt = input.requestedAt ?? new Date();
  const externalId = input.externalId ?? `${input.workflow}:${requestedAt.toISOString()}:${input.actorId}`;
  const dispatch = await upsertCiEntity({
    kind: 'ci-dispatch',
    provider: 'thingtime',
    repository,
    externalId,
    title: `Dispatch ${input.workflow}`,
    status: 'requested',
    occurredAt: requestedAt,
    data: {
      workflow: input.workflow,
      workflowFile,
      ref,
      controlPlaneRef: DEFAULT_CONTROL_REF,
      executionProvider: policy.executionProvider,
      inputs,
      actorId: input.actorId
    }
  });

  try {
    if (policy.executionProvider === 'vercel-sandbox') {
      const { startCiOnVercel, vercelRunnerConfigured } = await import('./vercelRunner');
      if (!policy.vercelSupported || !vercelRunnerConfigured()) {
        throw new Error('Vercel Sandbox execution is not configured for this automation');
      }
      const workflowRun = await startCiOnVercel({
        repository,
        workflow: input.workflow,
        workflowFile,
        inputs,
        actorId: input.actorId,
        dispatchExternalId: externalId,
        dispatchThingId: dispatch.id,
        requestedAt: requestedAt.toISOString()
      });
      await upsertCiEntity({
        kind: 'ci-dispatch',
        provider: 'thingtime',
        repository,
        externalId,
        title: `Dispatch ${input.workflow}`,
        status: 'accepted',
        occurredAt: new Date(),
        data: {
          workflow: input.workflow,
          workflowFile,
          ref: DEFAULT_CONTROL_REF,
          controlPlaneRef: DEFAULT_CONTROL_REF,
          executionProvider: policy.executionProvider,
          workflowRunId: workflowRun.runId,
          inputs,
          actorId: input.actorId
        }
      });
      await recordCiEvent({
        provider: 'thingtime',
        repository,
        deliveryId: externalId,
        eventType: 'workflow_dispatch',
        action: input.workflow,
        parentId: dispatch.id,
        actor: input.actorId,
        statusFrom: 'requested',
        statusTo: 'accepted',
        occurredAt: requestedAt,
        data: {
          workflowFile,
          ref: DEFAULT_CONTROL_REF,
          controlPlaneRef: DEFAULT_CONTROL_REF,
          executionProvider: policy.executionProvider,
          workflowRunId: workflowRun.runId
        }
      });
      return {
        ok: true as const,
        dispatchId: dispatch.id,
        workflowFile,
        ref: DEFAULT_CONTROL_REF,
        controlPlaneRef: DEFAULT_CONTROL_REF,
        executionProvider: policy.executionProvider,
        workflowRunId: workflowRun.runId
      };
    }
    await githubRequest<void>(
      `/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`,
      { method: 'POST', body: { ref, inputs } }
    );
    await upsertCiEntity({
      kind: 'ci-dispatch',
      provider: 'thingtime',
      repository,
      externalId,
      title: `Dispatch ${input.workflow}`,
      status: 'accepted',
      occurredAt: new Date(),
      data: {
        workflow: input.workflow,
        workflowFile,
        ref,
        controlPlaneRef: DEFAULT_CONTROL_REF,
        executionProvider: policy.executionProvider,
        inputs,
        actorId: input.actorId
      }
    });
    await recordCiEvent({
      provider: 'thingtime',
      repository,
      deliveryId: externalId,
      eventType: 'workflow_dispatch',
      action: input.workflow,
      parentId: dispatch.id,
      actor: input.actorId,
      statusFrom: 'requested',
      statusTo: 'accepted',
      occurredAt: requestedAt,
      data: { workflowFile, ref, controlPlaneRef: DEFAULT_CONTROL_REF, executionProvider: policy.executionProvider }
    });
    return {
      ok: true as const,
      dispatchId: dispatch.id,
      workflowFile,
      ref,
      controlPlaneRef: DEFAULT_CONTROL_REF,
      executionProvider: policy.executionProvider
    };
  } catch (error) {
    await upsertCiEntity({
      kind: 'ci-dispatch',
      provider: 'thingtime',
      repository,
      externalId,
      title: `Dispatch ${input.workflow}`,
      status: 'failed',
      occurredAt: new Date(),
      data: {
        workflow: input.workflow,
        workflowFile,
        ref,
        controlPlaneRef: DEFAULT_CONTROL_REF,
        executionProvider: policy.executionProvider,
        inputs,
        actorId: input.actorId
      }
    });
    await recordCiEvent({
      provider: 'thingtime',
      repository,
      deliveryId: externalId,
      eventType: 'workflow_dispatch',
      action: input.workflow,
      parentId: dispatch.id,
      actor: input.actorId,
      statusFrom: 'requested',
      statusTo: 'failed',
      occurredAt: new Date(),
      data: { workflowFile, ref, controlPlaneRef: DEFAULT_CONTROL_REF, executionProvider: policy.executionProvider }
    });
    throw error;
  }
};

const graphQl = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const response = await githubRequest<{ data?: T; errors?: unknown[] }>('/graphql', {
    method: 'POST',
    body: { query, variables }
  });
  if (!response?.data || response.errors?.length) throw new Error('GitHub GraphQL reconciliation failed');
  return response.data;
};

const listGitHubBranches = async (repository: string): Promise<any[]> => {
  const branches: any[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await githubRequest<any[]>(`/repos/${repository}/branches?per_page=100&page=${page}`);
    branches.push(...batch);
    if (batch.length < 100) return branches;
  }
  throw new Error('GitHub branch reconciliation exceeded its safety limit');
};

const listOpenPullRequests = async (owner: string, name: string): Promise<any[]> => {
  const query = `
    query ThingtimeCiPullRequests($owner: String!, $name: String!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequests(first: 100, after: $cursor, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) {
          nodes {
            number title body url state isDraft mergeable mergeStateStatus
            headRefName headRefOid baseRefName baseRefOid createdAt updatedAt
            author { login }
            labels(first: 30) { nodes { name } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  const pullRequests: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result: any = await graphQl<any>(query, { owner, name, cursor });
    const connection = result.repository?.pullRequests;
    pullRequests.push(...(connection?.nodes ?? []));
    if (!connection?.pageInfo?.hasNextPage) return pullRequests;
    cursor = connection.pageInfo.endCursor;
    if (!cursor) throw new Error('GitHub pull-request pagination did not return a cursor');
  }
  throw new Error('GitHub pull-request reconciliation exceeded its safety limit');
};

const prStatus = (pr: any): string => {
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.isDraft) return 'draft';
  if (pr.mergeable === 'CONFLICTING' || ['DIRTY', 'BLOCKED'].includes(pr.mergeStateStatus)) return 'conflicting';
  if (pr.mergeable === 'MERGEABLE') return 'clean';
  return 'unknown';
};

export const reconcileGitHubRepository = async (actorId: string) => {
  const repository = repositoryName();
  const [owner, name] = repository.split('/');
  if (!owner || !name) throw new Error('THINGTIME_GITHUB_REPOSITORY must be owner/name');
  const deliveryPrefix = `reconcile:${Date.now()}:${actorId}`;
  const query = `
    query ThingtimeCiControl($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        id
        nameWithOwner
        url
        isArchived
        isPrivate
        defaultBranchRef { name target { oid } }
      }
    }
  `;
  const [graph, branches, pullRequests, runs, deployments] = await Promise.all([
    graphQl<any>(query, { owner, name }),
    listGitHubBranches(repository),
    listOpenPullRequests(owner, name),
    githubRequest<any>(`/repos/${repository}/actions/runs?per_page=100`),
    githubRequest<any[]>(`/repos/${repository}/deployments?per_page=100`)
  ]);
  const repo = graph.repository;
  const touched: string[] = [];
  const remember = (value: { id: string }) => touched.push(value.id);
  remember(
    await upsertCiEntity({
      kind: 'ci-repository',
      provider: 'github',
      repository,
      externalId: repo.id,
      title: repo.nameWithOwner,
      status: repo.isArchived ? 'archived' : 'active',
      url: repo.url,
      occurredAt: new Date(),
      data: {
        defaultBranch: repo.defaultBranchRef?.name ?? null,
        defaultBranchSha: repo.defaultBranchRef?.target?.oid ?? null,
        private: repo.isPrivate === true,
        archived: repo.isArchived === true,
        reconciledBy: actorId
      }
    })
  );
  for (const branch of branches) {
    remember(
      await upsertCiEntity({
        kind: 'ci-branch',
        provider: 'github',
        repository,
        externalId: branch.name,
        title: branch.name,
        status: 'active',
        url: `https://github.com/${repository}/tree/${encodeURIComponent(branch.name)}`,
        occurredAt: new Date(),
        data: {
          ref: branch.name,
          sha: branch.commit?.sha ?? null,
          protected: branch.protected === true,
          reconciledBy: actorId
        }
      })
    );
  }
  for (const pr of pullRequests) {
    const labels = (pr.labels?.nodes ?? []).map((label: any) => String(label.name ?? '')).filter(Boolean);
    const { featureKey, sourcePrNumber, promotionGroup } = ciFeatureIdentity({
      body: pr.body,
      labels,
      prNumber: pr.number
    });
    const feature = await upsertCiEntity({
      kind: 'ci-feature',
      provider: 'github',
      repository,
      externalId: featureKey,
      title: pr.title,
      status: prStatus(pr),
      url: pr.url,
      occurredAt: pr.updatedAt,
      data: {
        featureKey,
        sourcePrNumber,
        promotionGroup,
        primaryPrNumber: sourcePrNumber ?? pr.number,
        reconciledBy: actorId
      }
    });
    remember(feature);
    remember(
      await upsertCiEntity({
        kind: 'ci-pull-request',
        provider: 'github',
        repository,
        externalId: String(pr.number),
        title: pr.title,
        status: prStatus(pr),
        url: pr.url,
        parentId: feature.id,
        occurredAt: pr.updatedAt,
        data: {
          number: pr.number,
          state: pr.state,
          draft: pr.isDraft,
          mergeable: pr.mergeable,
          mergeStateStatus: pr.mergeStateStatus,
          headRef: pr.headRefName,
          headSha: pr.headRefOid,
          baseRef: pr.baseRefName,
          baseSha: pr.baseRefOid,
          author: pr.author?.login ?? null,
          labels,
          featureKey,
          sourcePrNumber,
          promotionGroup,
          reconciledBy: actorId
        }
      })
    );
  }
  for (const run of runs.workflow_runs ?? []) {
    remember(
      await upsertCiEntity({
        kind: 'ci-workflow-run',
        provider: 'github',
        repository,
        externalId: String(run.id),
        title: run.name ?? run.display_title ?? `Run #${run.id}`,
        status: run.conclusion ?? run.status ?? 'unknown',
        url: run.html_url,
        occurredAt: run.updated_at ?? run.created_at,
        data: {
          runId: run.id,
          runNumber: run.run_number,
          workflowId: run.workflow_id,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
          headRef: run.head_branch,
          headSha: run.head_sha,
          actor: run.actor?.login ?? null,
          startedAt: run.run_started_at ?? run.created_at,
          completedAt: run.status === 'completed' ? run.updated_at : null,
          reconciledBy: actorId
        }
      })
    );
  }
  for (const deployment of deployments ?? []) {
    remember(
      await upsertCiEntity({
        kind: 'ci-deployment',
        provider: 'github',
        repository,
        externalId: String(deployment.id),
        title: deployment.environment ?? `Deployment #${deployment.id}`,
        status: 'created',
        url: deployment.url,
        occurredAt: deployment.updated_at ?? deployment.created_at,
        data: {
          deploymentId: deployment.id,
          environment: deployment.environment ?? null,
          ref: deployment.ref ?? null,
          sha: deployment.sha ?? null,
          task: deployment.task ?? null,
          reconciledBy: actorId
        }
      })
    );
  }
  await recordCiEvent({
    provider: 'thingtime',
    repository,
    deliveryId: deliveryPrefix,
    eventType: 'reconcile',
    action: 'github',
    actor: actorId,
    statusTo: 'completed',
    occurredAt: new Date(),
    data: {
      branches: branches.length,
      pullRequests: pullRequests.length,
      workflowRuns: runs.workflow_runs?.length ?? 0,
      deployments: deployments?.length ?? 0
    }
  });
  return {
    ok: true as const,
    repository,
    touched: touched.length,
    counts: {
      branches: branches.length,
      pullRequests: pullRequests.length,
      workflowRuns: runs.workflow_runs?.length ?? 0,
      deployments: deployments?.length ?? 0
    }
  };
};

export const githubAppConfigured = () =>
  ciProviderReadiness().githubAppConfigured;
