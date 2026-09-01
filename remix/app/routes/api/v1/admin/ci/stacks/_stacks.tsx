import { randomUUID } from 'node:crypto';

import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { cancelGitHubWorkflowRun, dispatchCiWorkflow, findFeatureStackWorkflowRunNear, repositoryName } from '~/api/utils/ciControl/githubClient';
import { featureStackRunCanCancel, featureStackLifecycleStatus } from '~/api/utils/ciControl/featureStackLifecycleCore';
import {
	archiveFeatureStack,
	getFeatureStack,
	listFeatureStacks,
	markFeatureStackLifecycleStatus,
	markFeatureStackRun,
	markFeatureStackRunLinkChecked,
	reconcileLegacyFeatureStackRun,
	saveFeatureStack
} from '~/api/utils/ciControl/featureStackStore';
import { recordCiEvent } from '~/api/utils/ciControl/store';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

type FeatureStack = Awaited<ReturnType<typeof getFeatureStack>>;

const dispatchSavedFeatureStack = async (stack: FeatureStack, actorId: string) => {
	const requestedAt = new Date();
	const runId = `feature-stack-run-${randomUUID()}`;
	const result = await dispatchCiWorkflow({
		workflow: 'feature-stack',
		ref: 'develop',
		actorId,
		externalId: `feature-stack:${stack.id}:${runId}`,
		parentId: stack.id,
		requestedAt,
		inputs: {
			name: stack.name,
			stack_id: stack.id,
			run_id: runId,
			source_pr_numbers: stack.sourcePrNumbers,
			targets: stack.targets,
			auto_decide_branches: stack.autoDecideBranches
		}
	});
	await markFeatureStackRun(stack.id, result.dispatchId, runId, requestedAt);
	return result;
};

const cancelLatestRunWhenActive = async (stack: FeatureStack) => {
	const current = stack.runs[0] ?? null;
	if (!current || !featureStackRunCanCancel(current.status)) {
		return { cancelled: false as const, status: current?.status ?? 'no_run' };
	}
	if (!current.workflowRunId) {
		throw new Error('The exact GitHub run link is still pending. Refresh and try again in a moment so no unrelated run can be cancelled.');
	}
	return cancelGitHubWorkflowRun(current.workflowRunId);
};

const recordLifecycleAction = async (stack: FeatureStack, action: string, actorId: string, statusTo: string) => {
	await recordCiEvent({
		provider: 'thingtime',
		repository: repositoryName(),
		deliveryId: `feature-stack-lifecycle:${stack.id}:${action}:${randomUUID()}`,
		eventType: 'feature_stack_lifecycle',
		action,
		parentId: stack.lastDispatchId,
		actor: actorId,
		statusFrom: stack.status,
		statusTo,
		occurredAt: new Date(),
		data: { stackId: stack.id }
	});
};

const listFeatureStacksWithLegacyRunLinks = async () => {
	const stacks = await listFeatureStacks();
	const retryBefore = Date.now() - 15 * 60_000;
	const candidate = stacks
		.flatMap((stack) => stack.runs.filter((run) => !run.url).map((run) => ({ stack, run })))
		.find(({ run }) => !run.linkCheckedAt || new Date(run.linkCheckedAt).getTime() < retryBefore);
	if (!candidate) return stacks;
	try {
		const match = await findFeatureStackWorkflowRunNear(candidate.run.startedAt);
		if (match) {
			await reconcileLegacyFeatureStackRun(candidate.run.id, match);
			return listFeatureStacks();
		}
	} catch {
		// The saved stack remains usable from its local audit record. A later
		// admin refresh will retry the bounded GitHub reconciliation.
	}
	await markFeatureStackRunLinkChecked(candidate.run.id);
	return stacks;
};

export const loader = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
		return json({ ok: true, stacks: await listFeatureStacksWithLegacyRunLinks() }, { headers: privateHeaders });
	});

export const action = ({ request }: { request: Request }) =>
	withAdminPrivateResponse(async () => {
		const gate = await requireAdmin(request);
		if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
		const body = await readJsonBody(request, 512 * 1024);
		try {
			if (body?.action === 'save') {
				const stack = await saveFeatureStack(body, gate.user.id);
				return json({ ok: true, stack, stacks: await listFeatureStacks() }, { headers: privateHeaders });
			}
			if (body?.action === 'delete') {
				await archiveFeatureStack(body.id);
				return json({ ok: true, stacks: await listFeatureStacks() }, { headers: privateHeaders });
			}
			if (body?.action === 'run') {
				const stack = await getFeatureStack(body.id);
				if (['paused', 'stopped'].includes(stack.status.toLowerCase())) {
					throw new Error(`This Feature Stack is ${stack.status}. Use Restart to begin a fresh run.`);
				}
				const result = await dispatchSavedFeatureStack(stack, gate.user.id);
				return json({ ok: true, dispatch: result, stacks: await listFeatureStacks() }, { status: 202, headers: privateHeaders });
			}
			if (body?.action === 'pause' || body?.action === 'stop') {
				const stack = await getFeatureStack(body.id);
				const cancellation = await cancelLatestRunWhenActive(stack);
				const status = featureStackLifecycleStatus(body.action);
				await markFeatureStackLifecycleStatus(stack.id, status, gate.user.id);
				await recordLifecycleAction(stack, body.action, gate.user.id, status);
				return json({ ok: true, cancellation, stacks: await listFeatureStacks() }, { headers: privateHeaders });
			}
			if (body?.action === 'restart') {
				const stack = await getFeatureStack(body.id);
				const cancellation = await cancelLatestRunWhenActive(stack);
				const result = await dispatchSavedFeatureStack(stack, gate.user.id);
				await recordLifecycleAction(stack, 'restart', gate.user.id, 'running');
				return json({ ok: true, cancellation, dispatch: result, stacks: await listFeatureStacks() }, { status: 202, headers: privateHeaders });
			}
			return json({ ok: false, error: 'Choose save, run, pause, stop, restart, or delete.' }, { status: 400, headers: privateHeaders });
		} catch (error) {
			return json(
				{ ok: false, error: error instanceof Error ? error.message : 'Feature Stack change failed.' },
				{ status: 409, headers: privateHeaders }
			);
		}
	});
