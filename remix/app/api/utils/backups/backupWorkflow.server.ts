import { getWorkflowMetadata, sleep } from 'workflow';
import { initializeBackupWorkflow, runBackupJobStep } from './backupWorkflowSteps.server';

/** Durable Workflow arguments contain only opaque protected job and dispatch IDs. Every
 * bounded step reloads its immutable selectors and original session reference
 * from the protected home-plane coordinator. Closing a browser changes nothing
 * about delivery; revoking its original session stops dependent effects. */
export async function runBackupWorkflow(jobId: string, dispatchId: string) {
	'use workflow';
	const runId = getWorkflowMetadata().workflowRunId;
	if (!await initializeBackupWorkflow(jobId, dispatchId, runId)) return;
	for (;;) {
		const result = await runBackupJobStep(jobId, runId);
		if (result.stopped) return;
		if (result.delayMs > 0) await sleep(result.delayMs);
	}
}
