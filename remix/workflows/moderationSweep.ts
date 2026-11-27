import { start } from 'workflow/api';
import { getWorkflowMetadata } from 'workflow';
import type { ScheduledRunCorrelation, ScheduledRunStatus, ScheduledRunSummary } from '../app/api/utils/automation/scheduledRunReporting';

import type { ModerationSweepBatchResult } from '../app/api/utils/moderation/moderationAdmin';

export type ModerationSweepWorkflowResult = ModerationSweepBatchResult & {
	continuedAs: string | null;
};

// A run owns exactly one small text + attachment pass. When a full pass made
// progress without failures, it starts a fresh run rather than holding a
// request open. This is intentionally continue-as-new: Vercel can upgrade the
// next batch to the latest production deployment while retaining a bounded,
// observable lifecycle for every pass.
export async function drainModerationSweep(correlation?: ScheduledRunCorrelation): Promise<ModerationSweepWorkflowResult> {
	'use workflow';

	const childId = getWorkflowMetadata().workflowRunId;
	await reportModerationSweepStep(correlation, childId, 'started');
	try {
		const batch = await runModerationSweepBatchStep();
		const continuedAs = batch.hasMore ? await continueModerationSweep(correlation) : null;
		const failed = batch.text.failed + batch.attachments.failed;
		await reportModerationSweepStep(correlation, childId, failed ? 'failed' : 'completed', {
			outcome: failed ? 'partial-failure' : 'success',
			counts: {
				scanned: batch.text.scanned + batch.attachments.scanned,
				analyzed: batch.text.analyzed + batch.attachments.analyzed,
				flagged: batch.text.flagged + batch.attachments.flagged,
				failed, skipped: batch.attachments.skipped, released: batch.text.released ?? 0
			}
		});
		return { ...batch, continuedAs };
	} catch (error) {
		await reportModerationSweepStep(correlation, childId, 'failed', { outcome: 'failed', counts: {} });
		throw error;
	}
}

async function reportModerationSweepStep(correlation: ScheduledRunCorrelation | undefined, childId: string,
	status: ScheduledRunStatus, summary?: ScheduledRunSummary): Promise<void> {
	'use step';
	if (!correlation) return;
	try {
		const { reportScheduledChildRun } = await import('../app/api/utils/automation/scheduledRunReporting');
		await reportScheduledChildRun(correlation, childId, status, summary);
	} catch { /* Reporting must never retry the moderation pass. */ }
}

async function runModerationSweepBatchStep(): Promise<ModerationSweepBatchResult> {
	'use step';

	const { runModerationSweepBatch } = await import('../app/api/utils/moderation/moderationAdmin');
	return runModerationSweepBatch();
}

async function continueModerationSweep(correlation?: ScheduledRunCorrelation): Promise<string> {
	'use step';

	const run = await start(drainModerationSweep, [correlation], { deploymentId: 'latest' });
	return run.runId;
}

export const startModerationSweepDrain = async (): Promise<string> => {
	'use step';
	const { currentScheduledRunCorrelation } = await import('../app/api/utils/automation/scheduledRunReporting');
	const correlation = currentScheduledRunCorrelation();
	const run = await start(drainModerationSweep, [correlation], { deploymentId: 'latest' });
	return run.runId;
};
