import { createSign } from 'node:crypto';

import type { CiWorkflowKey } from './automationPolicy';
import { ciProviderReadiness } from './providerReadiness';
import { featureStackTargetsForSource } from './featureStackRoutingCore';
import { linkFeatureStackWorkflowRun } from './featureStackStore';
import { getCiAutomationPolicy, recordCiEvent, upsertCiEntity } from './store';
import { ciFeatureIdentity } from './webhooks';

export type { CiWorkflowKey } from './automationPolicy';

const API_VERSION = '2022-11-28';
const DEFAULT_REPOSITORY = 'lopugit/thingtime';
const DEFAULT_CONTROL_REF = 'github-actions';
const GIT_REF = /^(?![./])(?!.*(?:\.\.|\/\.|\.\/|@\{|\\|[[~^:?*]))[A-Za-z0-9._/-]{1,180}(?<![./])$/;
const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });

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

export const githubRequest = async <T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
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

export type GitHubWorkflowRunLink = {
	workflowRunId: number;
	url: string | null;
	title: string;
	status: string;
	startedAt: string;
	completedAt: string | null;
};

export const findFeatureStackWorkflowRunNear = async (value: string | Date): Promise<GitHubWorkflowRunLink | null> => {
	const wanted = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(wanted.getTime())) return null;
	const repository = repositoryName();
	const response = await githubRequest<{ workflow_runs?: any[] }>(
		`/repos/${repository}/actions/workflows/resolve-pr-conflicts.yml/runs?branch=develop&event=workflow_dispatch&per_page=100`
	);
	const candidates = (response.workflow_runs ?? [])
		.map((run) => ({ run, delta: Math.abs(new Date(run.run_started_at ?? run.created_at).getTime() - wanted.getTime()) }))
		.filter(({ run, delta }) => Number.isSafeInteger(Number(run.id)) && Number.isFinite(delta) && delta <= 120_000)
		.sort((left, right) => left.delta - right.delta)
		.slice(0, 5);
	const inspected = await Promise.all(
		candidates.map(async ({ run }) => ({
			run,
			jobs: (await githubRequest<{ jobs?: any[] }>(`/repos/${repository}/actions/runs/${Number(run.id)}/jobs?per_page=100`)).jobs ?? []
		}))
	);
	const match = inspected.find(({ jobs }) => jobs.some((job) => String(job.name ?? '').includes('Validate the immutable Feature Stack')))?.run;
	if (!match) return null;
	return {
		workflowRunId: Number(match.id),
		url: typeof match.html_url === 'string' ? match.html_url : null,
		title: String(match.display_title ?? match.name ?? `Run #${match.id}`),
		status: String(match.conclusion ?? match.status ?? 'unknown'),
		startedAt: String(match.run_started_at ?? match.created_at),
		completedAt: match.status === 'completed' && match.updated_at ? String(match.updated_at) : null
	};
};

export const repositoryName = () => (process.env.THINGTIME_GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY).trim() || DEFAULT_REPOSITORY;

export const cancelGitHubWorkflowRun = async (workflowRunId: number) => {
	if (!Number.isSafeInteger(workflowRunId) || workflowRunId < 1) throw new Error('GitHub workflow run id is invalid');
	const repository = repositoryName();
	const path = `/repos/${repository}/actions/runs/${workflowRunId}`;
	const current = await githubRequest<{ status?: string; conclusion?: string | null }>(path);
	if (String(current.status ?? '').toLowerCase() === 'completed') {
		return { cancelled: false as const, status: String(current.conclusion ?? current.status ?? 'completed') };
	}
	try {
		await githubRequest<void>(`${path}/cancel`, { method: 'POST' });
		return { cancelled: true as const, status: 'cancel_requested' };
	} catch (error) {
		// GitHub can finish a run between the status read and cancellation. That
		// race is already the requested terminal outcome, so prove it before
		// surfacing a false lifecycle failure.
		const latest = await githubRequest<{ status?: string; conclusion?: string | null }>(path);
		if (String(latest.status ?? '').toLowerCase() === 'completed') {
			return { cancelled: false as const, status: String(latest.conclusion ?? latest.status ?? 'completed') };
		}
		throw error;
	}
};

const workflowFileByKey = {
  'feature-stack': 'resolve-pr-conflicts.yml',
  'resolve-conflicts': 'resolve-pr-conflicts.yml',
  'rebase-stack': 'resolve-pr-conflicts.yml',
  'promote-features': 'resolve-pr-conflicts.yml',
  'promote-develop': 'resolve-pr-conflicts.yml',
  'sync-main': 'resolve-pr-conflicts.yml',
  'web-ci': 'web-ci.yml',
  'electron-release': 'electron-release.yml'
} as const;

const inputAllowlist: Record<CiWorkflowKey, readonly string[]> = {
  'feature-stack': ['feature_stack_plan_b64', 'feature_stack_run_id'],
  'resolve-conflicts': ['pr_number', 'branch'],
  'rebase-stack': ['pr_number', 'branch', 'cascade'],
  'promote-features': ['dry_run', 'lookback'],
  'promote-develop': [],
  'sync-main': [],
  'web-ci': [],
  'electron-release': []
};

const workflowEntryRef: Record<CiWorkflowKey, 'develop' | 'main'> = {
  'feature-stack': 'develop',
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

export const resolveCiWorkflowDispatch = (
  workflow: CiWorkflowKey,
  requestedInputs: Record<string, unknown> = {}
): { workflowFile: string; inputs: Record<string, string | boolean> } => {
  const workflowFile = workflowFileByKey[workflow];
  if (!workflowFile) throw new Error('Unsupported CI workflow');
  const allowed = new Set(inputAllowlist[workflow]);
  const selected = Object.fromEntries(
    Object.entries(requestedInputs)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [
        key,
				typeof value === 'boolean' ? value : String(value ?? '').slice(0, key === 'feature_stack_plan_b64' ? 60_000 : 300)
      ])
  ) as Record<string, string | boolean>;

	const managerInputs = (maintenanceOperation: string) =>
		({
    maintenance_operation: maintenanceOperation
		} satisfies Record<string, string | boolean>);
  if (workflow === 'feature-stack') {
    const encoded = selected.feature_stack_plan_b64;
    if (typeof encoded !== 'string' || !encoded) throw new Error('Feature Stack plan is required');
    return {
      workflowFile,
      inputs: {
        ...managerInputs('merge-feature-stack'),
        feature_stack_plan_b64: encoded,
				feature_stack_run_id: String(selected.feature_stack_run_id ?? '')
      }
    };
  }
  if (workflow === 'rebase-stack') {
    const inputs: Record<string, string | boolean> = managerInputs('manage-prs');
    if ('pr_number' in selected) inputs.pr_number = selected.pr_number;
    if ('branch' in selected) inputs.branch = selected.branch;
    if ('cascade' in selected) inputs.rebase_cascade = selected.cascade;
    return { workflowFile, inputs };
  }
  if (workflow === 'promote-features') {
    const inputs: Record<string, string | boolean> = managerInputs('promote-features');
    if ('dry_run' in selected) inputs.promotion_dry_run = selected.dry_run;
    if ('lookback' in selected) inputs.promotion_lookback = selected.lookback;
    return { workflowFile, inputs };
  }
  if (workflow === 'promote-develop') {
    return { workflowFile, inputs: managerInputs('promote-develop') };
  }
  if (workflow === 'sync-main') {
    return { workflowFile, inputs: managerInputs('sync-main-develop') };
  }
  return { workflowFile, inputs: selected };
};

type FeatureStackPullRequest = {
  number?: number;
  title?: string;
  state?: string;
  draft?: boolean;
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
	base?: { ref?: string };
};

export const canonicalFeatureStackPlanFromPullRequests = (input: {
  name: string;
  sourcePrNumbers: number[];
  targets: string[];
  pullRequests: FeatureStackPullRequest[];
	repository: string;
	stackId: string;
	runId: string;
	autoDecideBranches: boolean;
}) => {
  const headRefs = new Set<string>();
	const sources = input.pullRequests.flatMap((pr, index) => {
    const number = input.sourcePrNumbers[index];
		if (pr.number !== number) {
			throw new Error(`Feature Stack source PR #${number} did not match the requested pull request`);
		}
		// Saved stacks are intentionally reusable. A source can merge or close
		// between runs, so omit completed entries while preserving the exact
		// order of every still-live source. Drafts remain selected in the saved
		// definition but are not eligible for an immutable merge run yet.
		if (pr.state !== 'open' || pr.draft === true) return [];
    const head = String(pr.head?.ref ?? '');
    const sha = String(pr.head?.sha ?? '');
		const base = String(pr.base?.ref ?? '');
		const title = String(pr.title ?? '')
			.trim()
			.slice(0, 200);
    if (
			pr.head?.repo?.full_name !== input.repository ||
			!GIT_REF.test(head) ||
			!GIT_REF.test(base) ||
			!/^[0-9a-f]{40}$/.test(sha) ||
			!title ||
			hasControlCharacter(title) ||
			headRefs.has(head)
    ) {
      throw new Error(`Feature Stack source PR #${number} is not an eligible immutable same-repository PR`);
    }
    headRefs.add(head);
		const targets = featureStackTargetsForSource(base, input.targets, input.autoDecideBranches);
		return targets.length ? [{ base, head, pr: number, sha, targets, title }] : [];
  });
  if (input.targets.some((target) => headRefs.has(target))) {
    throw new Error('A Feature Stack source branch cannot also be a target');
  }
	if (!sources.length) {
		throw new Error('No selected pull request is compatible with the selected target branches');
	}
	const targets = input.targets.filter((target) => sources.some((source) => source.targets.includes(target)));
	return {
		autoDecideBranches: input.autoDecideBranches,
		autoMerge: true as const,
		name: input.name,
		runId: input.runId,
		sources,
		stackId: input.stackId,
		targets,
		version: 3 as const
	};
};

export const buildFeatureStackInputs = async (requestedInputs: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const repository = repositoryName();
  const name = typeof requestedInputs.name === 'string' ? requestedInputs.name.trim() : '';
  const rawNumbers = requestedInputs.source_pr_numbers;
  const rawTargets = requestedInputs.targets;
	const stackId = typeof requestedInputs.stack_id === 'string' ? requestedInputs.stack_id.trim() : '';
	const runId = typeof requestedInputs.run_id === 'string' ? requestedInputs.run_id.trim() : '';
	const autoDecideBranches = requestedInputs.auto_decide_branches !== false;
  if (!name || name.length > 80 || hasControlCharacter(name)) {
    throw new Error('Feature Stack name must be 1-80 printable characters');
  }
	if (!stackId || !/^ci-feature-stack-[0-9a-f-]{36}$/.test(stackId)) {
		throw new Error('Feature Stack id is invalid');
  }
	if (!/^feature-stack-run-[0-9a-f-]{36}$/.test(runId)) throw new Error('Feature Stack run id is invalid');
	if (!Array.isArray(rawNumbers) || rawNumbers.length < 1) {
		throw new Error('Feature Stack needs at least one pull request');
	}
	const sourcePrNumbers = rawNumbers.map((value) => (typeof value === 'number' ? value : Number(String(value ?? ''))));
  if (sourcePrNumbers.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 999_999_999)) {
    throw new Error('Feature Stack contains an invalid pull request number');
  }
  if (new Set(sourcePrNumbers).size !== sourcePrNumbers.length) {
    throw new Error('Feature Stack pull requests must be unique');
  }
	if (!Array.isArray(rawTargets) || rawTargets.length < 1) {
		throw new Error('Feature Stack needs at least one target branch');
  }
  const targets = rawTargets.map((value) => String(value ?? '').trim());
  if (targets.some((target) => !GIT_REF.test(target)) || new Set(targets).size !== targets.length) {
    throw new Error('Feature Stack targets must be unique valid branches');
  }

  const [pullRequests] = await Promise.all([
		Promise.all(sourcePrNumbers.map((number) => githubRequest<FeatureStackPullRequest>(`/repos/${repository}/pulls/${number}`))),
		Promise.all(targets.map((target) => githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(target)}`)))
  ]);
  const plan = canonicalFeatureStackPlanFromPullRequests({
    name,
    sourcePrNumbers,
    targets,
    pullRequests,
		repository,
		stackId,
		runId,
		autoDecideBranches
  });
  return { feature_stack_plan_b64: Buffer.from(JSON.stringify(plan), 'utf8').toString('base64'), feature_stack_run_id: runId };
};

export const dispatchCiWorkflow = async (input: {
  workflow: CiWorkflowKey;
  ref?: string;
  inputs?: Record<string, unknown>;
  actorId: string;
  externalId?: string;
	parentId?: string | null;
  requestedAt?: Date;
}) => {
	const requestedInputs = input.workflow === 'feature-stack' ? await buildFeatureStackInputs(input.inputs ?? {}) : input.inputs;
  const { workflowFile, inputs } = resolveCiWorkflowDispatch(input.workflow, requestedInputs);
  // workflow_dispatch loads its listener from `ref`. Keep that entrypoint on
  // the two reviewed product branches; an arbitrary feature ref could carry
  // executable YAML and would defeat the protected control plane.
  const ref = resolveCiWorkflowEntryRef(input.workflow, input.ref);
  const repository = repositoryName();
  const policy = await getCiAutomationPolicy(repository, input.workflow);
  if (!policy.enabled) throw new Error(`The ${input.workflow} automation is disabled`);
  const requestedAt = input.requestedAt ?? new Date();
  const externalId = input.externalId ?? `${input.workflow}:${requestedAt.toISOString()}:${input.actorId}`;
	const featureStackRunId = input.workflow === 'feature-stack' ? String(inputs.feature_stack_run_id ?? '') : null;
  const dispatch = await upsertCiEntity({
    kind: 'ci-dispatch',
    provider: 'thingtime',
    repository,
    externalId,
    title: `Dispatch ${input.workflow}`,
    status: 'requested',
		parentId: input.parentId ?? null,
    occurredAt: requestedAt,
    data: {
      workflow: input.workflow,
      workflowFile,
      ref,
      controlPlaneRef: DEFAULT_CONTROL_REF,
      executionProvider: policy.executionProvider,
			featureStackRunId,
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
				parentId: input.parentId ?? null,
        occurredAt: new Date(),
        data: {
          workflow: input.workflow,
          workflowFile,
          ref: DEFAULT_CONTROL_REF,
          controlPlaneRef: DEFAULT_CONTROL_REF,
          executionProvider: policy.executionProvider,
					featureStackRunId,
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
		await githubRequest<void>(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`, {
			method: 'POST',
			body: { ref, inputs }
		});
    await upsertCiEntity({
      kind: 'ci-dispatch',
      provider: 'thingtime',
      repository,
      externalId,
      title: `Dispatch ${input.workflow}`,
      status: 'accepted',
		parentId: input.parentId ?? null,
      occurredAt: new Date(),
      data: {
        workflow: input.workflow,
        workflowFile,
        ref,
        controlPlaneRef: DEFAULT_CONTROL_REF,
        executionProvider: policy.executionProvider,
		featureStackRunId,
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
		parentId: input.parentId ?? null,
      occurredAt: new Date(),
      data: {
        workflow: input.workflow,
        workflowFile,
        ref,
        controlPlaneRef: DEFAULT_CONTROL_REF,
        executionProvider: policy.executionProvider,
		featureStackRunId,
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
		const title = String(run.display_title ?? run.name ?? `Run #${run.id}`);
		remember(
			await upsertCiEntity({
        kind: 'ci-workflow-run',
        provider: 'github',
        repository,
        externalId: String(run.id),
				title,
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
					displayTitle: run.display_title ?? null,
					workflowName: run.name ?? null,
					reconciledBy: actorId
				}
			})
		);
		const featureStackRunId = title.match(/\b(feature-stack-run-[0-9a-f-]{36})\b/i)?.[1]?.toLowerCase();
		if (featureStackRunId) {
			await linkFeatureStackWorkflowRun({
				runId: featureStackRunId,
				workflowRunId: Number(run.id),
				url: typeof run.html_url === 'string' ? run.html_url : null,
				title,
				status: String(run.conclusion ?? run.status ?? 'unknown'),
				startedAt: run.run_started_at ?? run.created_at,
				completedAt: run.status === 'completed' ? run.updated_at ?? null : null
			});
		}
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

export const githubAppConfigured = () => ciProviderReadiness().githubAppConfigured;
