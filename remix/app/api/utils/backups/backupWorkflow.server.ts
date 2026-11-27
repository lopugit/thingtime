import { getWorkflowMetadata, sleep } from 'workflow';
import type { ScheduledRunCorrelation, ScheduledRunStatus } from '../automation/scheduledRunReporting';
import { initializeBackupWorkflow, runBackupJobStep } from './backupWorkflowSteps.server';

/** Durable Workflow arguments contain opaque protected job and dispatch IDs plus optional non-secret scheduled-run correlation. Every
 * bounded step reloads its immutable selectors and original session reference
 * from the protected home-plane coordinator. Closing a browser changes nothing
 * about delivery; revoking its original session stops dependent effects. */
export async function runBackupWorkflow(jobId: string, dispatchId: string, correlation?: ScheduledRunCorrelation) {
	'use workflow';
	const runId = getWorkflowMetadata().workflowRunId;
	await reportBackupWorkflowStep(correlation, runId, 'started');
	try {
		if (!await initializeBackupWorkflow(jobId, dispatchId, runId)) {
			await reportBackupWorkflowStep(correlation, runId, 'cancelled');
			return;
		}
		for (;;) {
			const result = await runBackupJobStep(jobId, runId);
			if (result.stopped) {
				await reportBackupWorkflowStep(correlation, runId, result.terminalStatus ?? 'cancelled');
				return;
			}
			if (result.delayMs > 0) await sleep(result.delayMs);
		}
	} catch (error) {
		await reportBackupWorkflowStep(correlation, runId, 'failed');
		throw error;
	}
}

async function reportBackupWorkflowStep(correlation: ScheduledRunCorrelation | undefined, runId: string,
	status: ScheduledRunStatus): Promise<void> {
	'use step';
	if (!correlation) return;
	try {
		const { reportScheduledChildRun } = await import('../automation/scheduledRunReporting');
		await reportScheduledChildRun(correlation, runId, status, status === 'completed'
			? { outcome: 'success', counts: { completed: 1 } }
			: status === 'failed' ? { outcome: 'failed', counts: { failed: 1 } }
			: status === 'cancelled' ? { outcome: 'dispatched', counts: { cancelled: 1 } } : undefined);
	} catch { /* Reporting must never retry protected backup work. */ }
}
