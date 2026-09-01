import { getHomeThingsCollection } from '../mongodb/collections';
import { linkFeatureStackWorkflowRun } from './featureStackStore';
import { recordCiEvent } from './store';

const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const RUN_ID = /^feature-stack-run-[0-9a-f-]{36}$/;
const STACK_ID = /^ci-feature-stack-[0-9a-f-]{36}$/;
const GIT_REF = /^(?![./])(?!.*(?:\.\.|\/\.|\.\/|@\{|\\|[[~^:?*]))[A-Za-z0-9._/-]{1,180}(?<![./])$/;
const TERMINAL = new Set(['success', 'failure', 'cancelled']);
const RUN_STATUSES = new Set(['queued', 'in_progress', ...TERMINAL]);
const TARGET_STATUSES = new Set(['waiting', 'queued', 'in_progress', 'success', 'failure', 'cancelled', 'skipped']);

export const FEATURE_STACK_PROGRESS_MAX_BYTES = 64 * 1024;

export type FeatureStackProgressTarget = {
	target: string;
	status: string;
	phase: string;
	progressPercent: number;
	jobUrl: string | null;
};

export type FeatureStackProgressRequest = {
	deliveryId: string;
	repository: string;
	stackId: string;
	featureStackRunId: string;
	workflowRunId: number;
	workflowRunUrl: string;
	runAttempt: number;
	startedAt: Date;
	reportedAt: Date;
	expectedFinishAt: Date | null;
	status: string;
	message: string;
	progressPercent: number;
	targets: FeatureStackProgressTarget[];
};

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const percent = (value: unknown) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? Math.round(parsed) : null;
};
const date = (value: unknown) => {
	const parsed = new Date(text(value, 80));
	return Number.isFinite(parsed.getTime()) ? parsed : null;
};

export const parseFeatureStackProgressRequest = (
	value: unknown,
	options: { repository: string; now?: number }
): FeatureStackProgressRequest | null => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const body = value as Record<string, unknown>;
	const repository = text(body.repository, 300);
	const stackId = text(body.stackId, 80);
	const featureStackRunId = text(body.featureStackRunId, 80);
	const workflowRunId = Number(body.workflowRunId);
	const runAttempt = Number(body.runAttempt);
	const workflowRunUrl = text(body.workflowRunUrl, 1500);
	const deliveryId = text(body.deliveryId, 300);
	const status = text(body.status, 40);
	const message = text(body.message, 500);
	const progressPercent = percent(body.progressPercent);
	const startedAt = date(body.startedAt);
	const reportedAt = date(body.reportedAt);
	const expectedFinishAt = body.expectedFinishAt == null ? null : date(body.expectedFinishAt);
	const now = options.now ?? Date.now();
	if (
		repository !== options.repository ||
		!STACK_ID.test(stackId) ||
		!RUN_ID.test(featureStackRunId) ||
		!Number.isSafeInteger(workflowRunId) || workflowRunId < 1 ||
		!Number.isSafeInteger(runAttempt) || runAttempt < 1 || runAttempt > 999 ||
		!workflowRunUrl.startsWith(`https://github.com/${repository}/actions/runs/${workflowRunId}`) ||
		!deliveryId.startsWith(`${featureStackRunId}:${workflowRunId}:${runAttempt}:`) ||
		!RUN_STATUSES.has(status) || !message || progressPercent == null ||
		!startedAt || !reportedAt || Math.abs(now - reportedAt.getTime()) > MAX_CLOCK_SKEW_MS ||
		(body.expectedFinishAt != null && !expectedFinishAt) ||
		!Array.isArray(body.targets) || body.targets.length < 1 || body.targets.length > 30
	) return null;
	const targets: FeatureStackProgressTarget[] = [];
	const seen = new Set<string>();
	for (const item of body.targets) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
		const row = item as Record<string, unknown>;
		const target = text(row.target, 180);
		const targetStatus = text(row.status, 40);
		const phase = text(row.phase, 240);
		const targetPercent = percent(row.progressPercent);
		const jobUrl = row.jobUrl == null ? null : text(row.jobUrl, 1500);
		if (!GIT_REF.test(target) || seen.has(target) || !TARGET_STATUSES.has(targetStatus) || !phase || targetPercent == null) return null;
		if (jobUrl && !jobUrl.startsWith(`https://github.com/${repository}/actions/runs/${workflowRunId}/job/`)) return null;
		seen.add(target);
		targets.push({ target, status: targetStatus, phase, progressPercent: targetPercent, jobUrl });
	}
	return {
		deliveryId,
		repository,
		stackId,
		featureStackRunId,
		workflowRunId,
		workflowRunUrl,
		runAttempt,
		startedAt,
		reportedAt,
		expectedFinishAt,
		status,
		message,
		progressPercent,
		targets
	};
};

export const recordFeatureStackProgress = async (input: FeatureStackProgressRequest) => {
	const things = await getHomeThingsCollection();
	const dispatch = await things.findOne({
		thingtime: 'ci-dispatch',
		parentId: input.stackId,
		'crystal.repository': input.repository,
		'crystal.featureStackRunId': input.featureStackRunId
	});
	if (!dispatch) return null;
	await linkFeatureStackWorkflowRun({
		runId: input.featureStackRunId,
		stackId: input.stackId,
		repository: input.repository,
		workflowRunId: input.workflowRunId,
		url: input.workflowRunUrl,
		title: `Feature Stack · ${input.stackId}`,
		status: input.status,
		startedAt: input.startedAt,
		completedAt: TERMINAL.has(input.status) ? input.reportedAt : null
	});
	// A generic workflow-success webhook can only prove that the controller
	// finished, so featureStackStore deliberately labels it controller-completed.
	// The signed progress reporter is stricter: its success is emitted only
	// after every target merge gate confirms the generated PR actually merged.
	if (TERMINAL.has(input.status)) {
		await things.updateOne(
			{
				shareId: input.stackId,
				thingtime: 'ci-feature-stack',
				'crystal.lastFeatureStackRunId': input.featureStackRunId
			},
			{ $set: { 'crystal.status': input.status, updatedAt: input.reportedAt } }
		);
	}
	const event = await recordCiEvent({
		provider: 'thingtime',
		repository: input.repository,
		deliveryId: input.deliveryId,
		eventType: 'feature_stack_progress',
		action: 'heartbeat',
		parentId: String(dispatch.shareId),
		actor: 'github-actions[bot]',
		statusTo: input.status,
		occurredAt: input.reportedAt,
		data: {
			featureStackRunId: input.featureStackRunId,
			workflowRunId: input.workflowRunId,
			workflowRunUrl: input.workflowRunUrl,
			runAttempt: input.runAttempt,
			message: input.message,
			progressPercent: input.progressPercent,
			expectedFinishAt: input.expectedFinishAt?.toISOString() ?? null,
			targets: input.targets
		}
	});
	return { dispatchId: String(dispatch.shareId), eventId: event.id, inserted: event.inserted };
};
