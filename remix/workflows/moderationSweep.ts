import { start } from 'workflow/api';

import { runModerationSweepBatch, type ModerationSweepBatchResult } from '../app/api/utils/moderation/moderationAdmin';

export type ModerationSweepWorkflowResult = ModerationSweepBatchResult & {
	continuedAs: string | null;
};

// A run owns exactly one small text + attachment pass. When a full pass made
// progress without failures, it starts a fresh run rather than holding a
// request open. This is intentionally continue-as-new: Vercel can upgrade the
// next batch to the latest production deployment while retaining a bounded,
// observable lifecycle for every pass.
export async function drainModerationSweep(): Promise<ModerationSweepWorkflowResult> {
	'use workflow';

	const batch = await runModerationSweepBatchStep();
	const continuedAs = batch.hasMore ? await continueModerationSweep() : null;
	return { ...batch, continuedAs };
}

async function runModerationSweepBatchStep(): Promise<ModerationSweepBatchResult> {
	'use step';

	return runModerationSweepBatch();
}

async function continueModerationSweep(): Promise<string> {
	'use step';

	const run = await start(drainModerationSweep, [], { deploymentId: 'latest' });
	return run.runId;
}

export const startModerationSweepDrain = async (): Promise<string> => {
	const run = await start(drainModerationSweep, [], { deploymentId: 'latest' });
	return run.runId;
};
