export type FeatureStackTimelineLine = {
	key: string;
	at: string | null;
	message: string;
	url?: string | null;
};

const timeValue = (value: string | null | undefined) => {
	const parsed = value ? new Date(value).getTime() : Number.NaN;
	return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

export const sortFeatureStackTimeline = <T extends FeatureStackTimelineLine>(lines: T[]): T[] =>
	lines
		.map((line, index) => ({ line, index }))
		.sort((left, right) => timeValue(left.line.at) - timeValue(right.line.at) || left.index - right.index)
		.map(({ line }) => line);

const TERMINAL = new Set(['cancelled', 'completed', 'failure', 'failed', 'success', 'succeeded']);

export const featureStackRunOutcome = (input: {
	runStatus: unknown;
	allTargetsFinished: boolean;
	hasPublishedTarget: boolean;
	dispatchAccepted: boolean;
}) => {
	const runStatus = String(input.runStatus ?? '').trim().toLowerCase();
	const runFinished = TERMINAL.has(runStatus);
	const runFailed = ['cancelled', 'failure', 'failed'].includes(runStatus);
	const needsAttention = runFinished && !runFailed && !input.allTargetsFinished && !input.hasPublishedTarget;
	return {
		live: !input.allTargetsFinished && !runFinished && input.dispatchAccepted,
		needsAttention,
		state: input.allTargetsFinished
			? 'finished'
			: runFailed
				? runStatus
				: needsAttention
					? 'needs-attention'
					: input.dispatchAccepted
						? 'running'
						: 'waiting'
	};
};

export const legacyFeatureStackWorkflowRunId = (input: {
	startedAt: string;
	runs: Array<{ runId?: unknown; event?: unknown; startedAt?: unknown; createdAt?: unknown; updatedAt?: unknown }>;
	jobs: Array<{ runId?: unknown; title?: unknown }>;
	windowMs?: number;
}): number | null => {
	const startedMs = timeValue(input.startedAt);
	if (startedMs === Number.MAX_SAFE_INTEGER) return null;
	const validationRunIds = new Set(
		input.jobs
			.filter((job) => String(job.title ?? '').includes('Validate the immutable Feature Stack'))
			.map((job) => Number(job.runId))
			.filter(Number.isSafeInteger)
	);
	const windowMs = input.windowMs ?? 120_000;
	const candidates = input.runs
		.map((run) => ({
			runId: Number(run.runId),
			delta: Math.abs(timeValue(String(run.startedAt ?? run.updatedAt ?? run.createdAt ?? '')) - startedMs),
			event: String(run.event ?? '')
		}))
		.filter((run) => Number.isSafeInteger(run.runId) && run.event === 'workflow_dispatch' && run.delta <= windowMs && validationRunIds.has(run.runId))
		.sort((left, right) => left.delta - right.delta);
	return candidates[0]?.runId ?? null;
};
