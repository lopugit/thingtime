import { githubRequest, repositoryName } from './githubClient';
import type { CiPreviewEnvironment, CiPreviewPolicy } from './previewPolicyCore';
import { listCiPreviewPolicies, recordCiEvent } from './store';

const CONTROLLER_DISPATCH_TYPE = 'develop-pr-preview-controller';
const ADMIN_DISPATCH_MARKER = '1';
const REF_PATTERN = /^(?![./])(?!.*(?:\.\.|\/\.|\.\/|@\{|\\|\[|~|\^|:|\?|\*))[A-Za-z0-9._/-]{1,255}(?<![./])$/;
const PREVIEW_REFRESH_ACTIONS = new Set(['opened', 'reopened', 'ready_for_review', 'synchronize']);

export type PreviewPullRequest = {
  number: number;
  state: string;
  draft: boolean;
  base?: { repo?: { id?: number; full_name?: string } };
  head?: { ref?: string; sha?: string; repo?: { id?: number; full_name?: string } };
};

export const ciAdminPreviewReadiness = () => {
  const requiredNames = ['THINGTIME_GITHUB_APP_ID', 'THINGTIME_GITHUB_APP_INSTALLATION_ID', 'THINGTIME_GITHUB_APP_PRIVATE_KEY'];
  const missing = requiredNames.filter((name) => !process.env[name]?.trim());
  return { configured: missing.length === 0, missing };
};

export const validatedPreviewPullRequest = async (prNumber: number): Promise<PreviewPullRequest> => {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('Choose a valid pull request');
  const repository = repositoryName();
  const pr = await githubRequest<PreviewPullRequest>(`/repos/${repository}/pulls/${prNumber}`);
  if (pr.state !== 'open' || pr.draft) throw new Error('Preview builds require an open, ready pull request');
  if (pr.base?.repo?.full_name !== repository || pr.head?.repo?.full_name !== repository) {
    throw new Error('Production-data previews are limited to same-repository pull requests');
  }
  if (
    !Number.isSafeInteger(Number(pr.base?.repo?.id)) ||
    Number(pr.base?.repo?.id) < 1 ||
    !/^[0-9a-f]{40}$/.test(pr.head?.sha ?? '') ||
    !REF_PATTERN.test(pr.head?.ref ?? '')
  ) {
    throw new Error('The live pull request head is not deployable');
  }
  return pr;
};

export const enabledAdminPreviewEnvironments = (policy: Pick<CiPreviewPolicy, 'develop' | 'production'>): CiPreviewEnvironment[] =>
  (['develop', 'production'] as const).filter((environment) => policy[environment] === true);

export const adminPreviewDispatchPayload = (input: {
  pr: PreviewPullRequest;
  policy: Pick<CiPreviewPolicy, 'develop' | 'production'>;
  action: 'configure' | 'synchronize' | 'closed';
}) => {
  const prNumber = Number(input.pr.number);
  const headSha = String(input.pr.head?.sha ?? '');
  const headRef = String(input.pr.head?.ref ?? '');
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !/^[0-9a-f]{40}$/.test(headSha) || !REF_PATTERN.test(headRef)) {
    throw new Error('The preview controller dispatch source is invalid');
  }
  return {
    event_type: CONTROLLER_DISPATCH_TYPE,
    client_payload: {
      admin_preview: ADMIN_DISPATCH_MARKER,
      pr_number: String(prNumber),
      head_sha: headSha,
      head_ref: headRef,
      action: input.action,
      environments: enabledAdminPreviewEnvironments(input.policy)
    }
  };
};

export const dispatchAdminPrPreviewController = async (input: {
  pr: PreviewPullRequest;
  policy: CiPreviewPolicy;
  action: 'configure' | 'synchronize' | 'closed';
  actorId: string;
}) => {
  const repository = repositoryName();
  const payload = adminPreviewDispatchPayload(input);
  await githubRequest<void>(`/repos/${repository}/dispatches`, { method: 'POST', body: payload });
  await recordCiEvent({
    provider: 'thingtime',
    repository,
    deliveryId: `admin-preview-controller:${input.pr.number}:${input.pr.head?.sha}:${input.action}:${payload.client_payload.environments.join(',')}`,
    eventType: 'admin_preview_controller_dispatch',
    action: input.action,
    actor: input.actorId,
    parentId: input.policy.id,
    statusFrom: null,
    statusTo: 'dispatched',
    occurredAt: new Date(),
    data: {
      prNumber: input.pr.number,
      environments: payload.client_payload.environments,
      controllerRef: 'github-actions'
    }
  }).catch(() => undefined);
  return {
    status: 'dispatched' as const,
    controllerRef: 'github-actions' as const,
    environments: payload.client_payload.environments
  };
};

export const syncAdminPrPreviewsForPullRequest = async (prNumber: number, action: string) => {
  const repository = repositoryName();
  const policy = (await listCiPreviewPolicies(repository)).find((candidate) => candidate.prNumber === prNumber);
  if (!policy) return { attempted: 0, failures: 0 };
  if (action !== 'closed' && !PREVIEW_REFRESH_ACTIONS.has(action)) return { attempted: 0, failures: 0 };
  const pr =
    action === 'closed'
      ? await githubRequest<PreviewPullRequest>(`/repos/${repository}/pulls/${prNumber}`)
      : await validatedPreviewPullRequest(prNumber);
  try {
    await dispatchAdminPrPreviewController({
      pr,
      policy,
      action: action === 'closed' ? 'closed' : 'synchronize',
      actorId: 'github-webhook'
    });
    return { attempted: enabledAdminPreviewEnvironments(policy).length, failures: 0 };
  } catch {
    return { attempted: enabledAdminPreviewEnvironments(policy).length, failures: 1 };
  }
};
