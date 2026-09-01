import { createHmac, timingSafeEqual } from 'node:crypto';

import { linkFeatureStackWorkflowRun } from './featureStackStore';
import { recordCiEvent, upsertCiEntity, type CiEntityInput } from './store';

const DEFAULT_REPOSITORY = 'lopugit/thingtime';

const safeString = (value: unknown, max = 500): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const safeNumber = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};

const safeUrl = (value: unknown): string | null => {
  const text = safeString(value, 1500);
  if (!text) return null;
  try {
    const parsed = new URL(text.startsWith('http') ? text : `https://${text}`);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
};

const constantTimeEqual = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
};

export const verifyGitHubWebhookSignature = (rawBody: string, signature: string | null, secret: string): boolean => {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  return constantTimeEqual(signature, expected);
};

export const verifyVercelWebhookSignature = (rawBody: string, signature: string | null, secret: string): boolean => {
  if (!signature || !secret) return false;
  const expected = createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex');
  return constantTimeEqual(signature, expected);
};

const labelsFrom = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((label: any) => safeString(typeof label === 'string' ? label : label?.name, 120))
        .filter(Boolean)
        .slice(0, 50)
    : [];

const promotionSourceFromBody = (body: unknown): number | null => {
  const match = safeString(body, 100_000).match(/<!--\s*promotion-of:\s*(\d+)\s*-->/i);
  return match ? safeNumber(match[1]) : null;
};

const promotionGroupFrom = (body: unknown, labels: string[]): string | null => {
  const text = safeString(body, 100_000);
  const bodyMatch = text.match(/(?:^|\n)\s*Promotion-Group:\s*([^\n]+)|<!--\s*promotion-group:\s*([^>]+)-->/i);
  const label = labels.find((entry) => /^(?:stack|group|feature):/i.test(entry));
  return safeString(bodyMatch?.[1] ?? bodyMatch?.[2] ?? label?.split(':').slice(1).join(':'), 180) || null;
};

export const ciFeatureIdentity = (input: {
  body: unknown;
  labels: string[];
  prNumber: number;
}) => {
  const sourcePrNumber = promotionSourceFromBody(input.body);
  const promotionGroup = promotionGroupFrom(input.body, input.labels);
  const featureKey = promotionGroup
    ? `group:${promotionGroup}`
    : sourcePrNumber
      ? `source-pr:${sourcePrNumber}`
      : `pr:${input.prNumber}`;
  return { featureKey, sourcePrNumber, promotionGroup };
};

const prStatus = (pr: any): string => {
  if (pr?.state === 'closed' && pr?.merged) return 'merged';
  if (pr?.state === 'closed') return 'closed';
  if (pr?.draft) return 'draft';
  const mergeable = safeString(pr?.mergeable, 40).toLowerCase();
  const mergeState = safeString(pr?.mergeable_state ?? pr?.mergeStateStatus, 40).toLowerCase();
  if (mergeable === 'false' || mergeable === 'conflicting' || ['dirty', 'blocked'].includes(mergeState)) return 'conflicting';
  if (mergeable === 'true' || mergeable === 'mergeable' || ['clean', 'unstable', 'has_hooks'].includes(mergeState)) return 'clean';
  return 'unknown';
};

const eventBase = (provider: 'github' | 'vercel', repository: string, deliveryId: string, eventType: string, payload: any) => ({
  provider,
  repository,
  deliveryId,
  eventType,
  action: safeString(payload?.action, 120) || null,
  actor: safeString(payload?.sender?.login ?? payload?.user?.username ?? payload?.user?.name, 180) || null,
  occurredAt:
    payload?.workflow_run?.updated_at ??
    payload?.pull_request?.updated_at ??
    payload?.deployment_status?.updated_at ??
    payload?.deployment?.updated_at ??
    payload?.createdAt ??
    payload?.created_at ??
    new Date()
});

const upsert = async (entity: CiEntityInput, event: ReturnType<typeof eventBase>, data?: Record<string, unknown>) =>
  upsertCiEntity(entity, { ...event, data });

export const ingestGitHubWebhook = async (input: {
  eventType: string;
  deliveryId: string;
  payload: any;
}): Promise<{ accepted: boolean; touched: string[]; ignoredReason?: string }> => {
  const payload = input.payload ?? {};
  const repository = safeString(payload?.repository?.full_name, 300);
  const allowedRepository =
    safeString(process.env.THINGTIME_GITHUB_REPOSITORY, 300) || DEFAULT_REPOSITORY;
  if (!repository) return { accepted: false, touched: [], ignoredReason: 'missing repository' };
  if (allowedRepository && repository.toLowerCase() !== allowedRepository.toLowerCase()) {
    return { accepted: false, touched: [], ignoredReason: 'repository not allowed' };
  }

  const event = eventBase('github', repository, input.deliveryId, input.eventType, payload);
  const touched: string[] = [];
  const remember = (result: { id: string }) => touched.push(result.id);
  const repo = payload.repository;
  remember(
    await upsert(
      {
        kind: 'ci-repository',
        provider: 'github',
        repository,
        externalId: String(repo?.id ?? repository),
        title: repository,
        status: repo?.archived ? 'archived' : 'active',
        url: safeUrl(repo?.html_url),
        occurredAt: repo?.updated_at ?? event.occurredAt,
        data: {
          defaultBranch: safeString(repo?.default_branch, 180) || null,
          private: repo?.private === true,
          archived: repo?.archived === true,
          installationId: safeNumber(payload?.installation?.id)
        }
      },
      event
    )
  );

  if (input.eventType === 'ping') return { accepted: true, touched };

  if (input.eventType === 'push') {
    const ref = safeString(payload.ref, 300).replace(/^refs\/heads\//, '');
    if (ref) {
      remember(
        await upsert(
          {
            kind: 'ci-branch',
            provider: 'github',
            repository,
            externalId: ref,
            title: ref,
            status: payload.deleted ? 'deleted' : 'active',
            url: safeUrl(`https://github.com/${repository}/tree/${encodeURIComponent(ref)}`),
            occurredAt: payload?.head_commit?.timestamp ?? event.occurredAt,
            data: {
              ref,
              sha: safeString(payload.after, 64) || null,
              beforeSha: safeString(payload.before, 64) || null,
              forced: payload.forced === true,
              deleted: payload.deleted === true,
              actor: event.actor
            }
          },
          event
        )
      );
    }
  }

  if ((input.eventType === 'create' || input.eventType === 'delete') && payload.ref_type === 'branch') {
    const ref = safeString(payload.ref, 300);
    if (ref) {
      remember(
        await upsert(
          {
            kind: 'ci-branch',
            provider: 'github',
            repository,
            externalId: ref,
            title: ref,
            status: input.eventType === 'delete' ? 'deleted' : 'active',
            url: safeUrl(`https://github.com/${repository}/tree/${encodeURIComponent(ref)}`),
            occurredAt: event.occurredAt,
            data: { ref, deleted: input.eventType === 'delete', actor: event.actor }
          },
          event
        )
      );
    }
  }

  if (input.eventType === 'pull_request' && payload.pull_request) {
    const pr = payload.pull_request;
    const number = safeNumber(payload.number ?? pr.number);
    if (number) {
      const labels = labelsFrom(pr.labels);
      const { featureKey: featureExternalId, sourcePrNumber, promotionGroup: group } = ciFeatureIdentity({
        body: pr.body,
        labels,
        prNumber: number
      });
      const feature = await upsert(
        {
          kind: 'ci-feature',
          provider: 'github',
          repository,
          externalId: featureExternalId,
          title: safeString(pr.title, 500) || `PR #${number}`,
          status: prStatus(pr),
          url: safeUrl(pr.html_url),
          occurredAt: pr.updated_at,
          data: {
            featureKey: featureExternalId,
            sourcePrNumber,
            promotionGroup: group,
            primaryPrNumber: sourcePrNumber ?? number
          }
        },
        event
      );
      remember(feature);
      const prEntity = await upsert(
        {
          kind: 'ci-pull-request',
          provider: 'github',
          repository,
          externalId: String(number),
          title: safeString(pr.title, 500) || `PR #${number}`,
          status: prStatus(pr),
          url: safeUrl(pr.html_url),
          parentId: feature.id,
          occurredAt: pr.updated_at,
          data: {
            number,
            state: safeString(pr.state, 30),
            draft: pr.draft === true,
            merged: pr.merged === true,
            mergeable: pr.mergeable ?? null,
            mergeStateStatus: safeString(pr.mergeable_state ?? pr.mergeStateStatus, 60) || null,
            headRef: safeString(pr?.head?.ref, 300),
            headSha: safeString(pr?.head?.sha, 64),
            baseRef: safeString(pr?.base?.ref, 300),
            baseSha: safeString(pr?.base?.sha, 64),
            labels,
            author: safeString(pr?.user?.login, 180) || null,
            featureKey: featureExternalId,
            sourcePrNumber,
            promotionGroup: group
          }
        },
        event
      );
      remember(prEntity);
    }
  }

  if (input.eventType === 'workflow_run' && payload.workflow_run) {
    const run = payload.workflow_run;
    const id = safeNumber(run.id);
    if (id) {
			const title = safeString(run.display_title ?? run.name, 500) || `Run #${id}`;
			const status = safeString(run.conclusion ?? run.status, 80) || 'unknown';
      remember(
        await upsert(
          {
            kind: 'ci-workflow-run',
            provider: 'github',
            repository,
            externalId: String(id),
            title,
            status,
            url: safeUrl(run.html_url),
            occurredAt: run.updated_at ?? run.created_at,
            data: {
              runId: id,
              runNumber: safeNumber(run.run_number),
              workflowId: safeNumber(run.workflow_id),
					displayTitle: safeString(run.display_title, 500) || null,
					workflowName: safeString(run.name, 500) || null,
              event: safeString(run.event, 80),
              status: safeString(run.status, 80),
              conclusion: safeString(run.conclusion, 80) || null,
              headRef: safeString(run.head_branch, 300) || null,
              headSha: safeString(run.head_sha, 64) || null,
              actor: safeString(run?.actor?.login, 180) || event.actor,
              startedAt: run.run_started_at ?? run.created_at ?? null,
              completedAt: run.status === 'completed' ? run.updated_at ?? null : null
            }
          },
          event
        )
      );
			const featureStackRunId = title.match(/\b(feature-stack-run-[0-9a-f-]{36})\b/i)?.[1]?.toLowerCase();
			if (featureStackRunId) {
				await linkFeatureStackWorkflowRun({
					runId: featureStackRunId,
					workflowRunId: id,
					url: safeUrl(run.html_url),
					title,
					status,
					startedAt: run.run_started_at ?? run.created_at ?? event.occurredAt,
					completedAt: run.status === 'completed' ? run.updated_at ?? null : null
				});
			}
    }
  }

  if (input.eventType === 'workflow_job' && payload.workflow_job) {
    const job = payload.workflow_job;
    const id = safeNumber(job.id);
    if (id) {
      remember(
        await upsert(
          {
            kind: 'ci-workflow-run',
            provider: 'github',
            repository,
            externalId: `job:${id}`,
            title: safeString(job.name, 500) || `Job #${id}`,
            status: safeString(job.conclusion ?? job.status, 80) || 'unknown',
            url: safeUrl(job.html_url),
            occurredAt: job.completed_at ?? job.started_at ?? event.occurredAt,
            data: {
              entityType: 'job',
              jobId: id,
              runId: safeNumber(job.run_id),
              status: safeString(job.status, 80),
              conclusion: safeString(job.conclusion, 80) || null,
              headSha: safeString(job.head_sha, 64) || null,
              startedAt: job.started_at ?? null,
              completedAt: job.completed_at ?? null,
              runnerName: safeString(job.runner_name, 180) || null
            }
          },
          event
        )
      );
    }
  }

  if (input.eventType === 'deployment' && payload.deployment) {
    const deployment = payload.deployment;
    const id = safeNumber(deployment.id);
    if (id) {
      remember(
        await upsert(
          {
            kind: 'ci-deployment',
            provider: 'github',
            repository,
            externalId: String(id),
            title: safeString(deployment.environment, 300) || `Deployment #${id}`,
            status: 'created',
            url: safeUrl(deployment.url),
            occurredAt: deployment.created_at,
            data: {
              deploymentId: id,
              environment: safeString(deployment.environment, 180) || null,
              ref: safeString(deployment.ref, 300) || null,
              sha: safeString(deployment.sha, 64) || null,
              task: safeString(deployment.task, 120) || null
            }
          },
          event
        )
      );
    }
  }

  if (input.eventType === 'deployment_status' && payload.deployment_status && payload.deployment) {
    const deployment = payload.deployment;
    const status = payload.deployment_status;
    const id = safeNumber(deployment.id);
    if (id) {
      const deploymentEntity = await upsert(
        {
          kind: 'ci-deployment',
          provider: 'github',
          repository,
          externalId: String(id),
          title: safeString(deployment.environment, 300) || `Deployment #${id}`,
          status: safeString(status.state, 80) || 'unknown',
          url: safeUrl(status.environment_url ?? status.target_url),
          occurredAt: status.updated_at ?? status.created_at,
          data: {
            deploymentId: id,
            environment: safeString(status.environment ?? deployment.environment, 180) || null,
            environmentUrl: safeUrl(status.environment_url),
            targetUrl: safeUrl(status.target_url),
            ref: safeString(deployment.ref, 300) || null,
            sha: safeString(deployment.sha, 64) || null,
            description: safeString(status.description, 500) || null
          }
        },
        event
      );
      remember(deploymentEntity);
      const previewUrl = safeUrl(status.environment_url ?? status.target_url);
      if (previewUrl) {
        remember(
          await upsert(
            {
              kind: 'ci-preview',
              provider: 'github',
              repository,
              externalId: String(id),
              title: safeString(status.environment ?? deployment.environment, 300) || `Preview #${id}`,
              status: safeString(status.state, 80) || 'unknown',
              url: previewUrl,
              parentId: deploymentEntity.id,
              occurredAt: status.updated_at ?? status.created_at,
              data: {
                deploymentId: id,
                environment: safeString(status.environment ?? deployment.environment, 180) || null,
                ref: safeString(deployment.ref, 300) || null,
                sha: safeString(deployment.sha, 64) || null
              }
            },
            event
          )
        );
      }
    }
  }

  if (!touched.length) {
    await recordCiEvent({
      ...event,
      eventType: input.eventType,
      parentId: null,
      data: { unsupportedProjection: true }
    });
  }
  return { accepted: true, touched };
};

export const ingestVercelWebhook = async (input: {
  eventType: string;
  deliveryId: string;
  payload: any;
}): Promise<{ accepted: boolean; touched: string[]; ignoredReason?: string }> => {
  const payload = input.payload ?? {};
  const data = payload.payload ?? payload.data ?? payload;
  const deployment = data.deployment ?? data;
  const meta = deployment.meta ?? data.meta ?? {};
  const githubOrg = safeString(meta.githubCommitOrg, 180);
  const githubRepo = safeString(meta.githubCommitRepo, 180);
  const repository =
    (githubOrg && githubRepo ? `${githubOrg}/${githubRepo}` : '') ||
    safeString(process.env.THINGTIME_GITHUB_REPOSITORY, 300) ||
    DEFAULT_REPOSITORY;
  const projectId = safeString(deployment.projectId ?? data.projectId, 180);
  const deploymentId = safeString(deployment.id ?? data.id, 180);
  if (!deploymentId) return { accepted: false, touched: [], ignoredReason: 'missing deployment id' };

  const statusFromType = input.eventType.split('.').pop()?.toLowerCase() || 'unknown';
  const status = safeString(deployment.readyState ?? deployment.state ?? statusFromType, 80).toLowerCase();
  const url = safeUrl(deployment.url ?? data.url);
  const event = eventBase('vercel', repository, input.deliveryId, input.eventType, payload);
  const deploymentEntity = await upsert(
    {
      kind: 'ci-deployment',
      provider: 'vercel',
      repository,
      externalId: deploymentId,
      title: safeString(deployment.name ?? data.name, 300) || `Vercel deployment ${deploymentId}`,
      status,
      url,
      occurredAt: deployment.createdAt ?? payload.createdAt ?? event.occurredAt,
      data: {
        deploymentId,
        projectId: projectId || null,
        projectName: safeString(deployment.name ?? data.name, 180) || null,
        ref: safeString(meta.githubCommitRef, 300) || null,
        sha: safeString(meta.githubCommitSha, 64) || null,
        prNumber: safeNumber(meta.githubPrId),
        previewEnvironment: safeString(meta.thingtimePreviewEnvironment, 40) || null,
        thingtimeAdminPrPreview: meta.thingtimeAdminPrPreview === '1',
        commitAuthor: safeString(meta.githubCommitAuthorLogin, 180) || null,
        target: safeString(deployment.target, 80) || null,
        readyState: status
      }
    },
    event
  );
  const touched = [deploymentEntity.id];
  if (url) {
    const preview = await upsert(
      {
        kind: 'ci-preview',
        provider: 'vercel',
        repository,
        externalId: deploymentId,
        title: safeString(deployment.name ?? data.name, 300) || `Preview ${deploymentId}`,
        status,
        url,
        parentId: deploymentEntity.id,
        occurredAt: deployment.createdAt ?? payload.createdAt ?? event.occurredAt,
        data: {
          deploymentId,
          projectId: projectId || null,
          ref: safeString(meta.githubCommitRef, 300) || null,
          sha: safeString(meta.githubCommitSha, 64) || null,
          prNumber: safeNumber(meta.githubPrId),
          previewEnvironment: safeString(meta.thingtimePreviewEnvironment, 40) || null,
          thingtimeAdminPrPreview: meta.thingtimeAdminPrPreview === '1',
          target: safeString(deployment.target, 80) || null
        }
      },
      event
    );
    touched.push(preview.id);
  }
  return { accepted: true, touched };
};
