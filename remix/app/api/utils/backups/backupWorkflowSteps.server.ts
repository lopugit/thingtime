/** Vercel Workflow step boundary follows the canonical gateway-admitted worker
 * pattern. Engine/provider imports stay outside the deterministic Workflow VM. */
export async function initializeBackupWorkflow(jobId: string, dispatchId: string, runId: string) {
	'use step';
	const { requireGatewayDatabaseAccess, withGatewayWork, runAdmittedGatewayWork } = await import('../deployment/environmentGateway');
	return withGatewayWork(async () => {
		await requireGatewayDatabaseAccess();
		return runAdmittedGatewayWork(async () => {
			const { backupJobs } = await import('./backupJobs');
			const attached = await backupJobs.attachWorkflow(jobId, dispatchId, runId);
			if (attached) {
				const { getGatewaySettings } = await import('../deployment/environmentGateway');
				const deploymentId = getGatewaySettings()?.deploymentId ?? process.env.VERCEL_DEPLOYMENT_ID;
				if (deploymentId) await backupJobs.confirmWorkflowExecution(jobId, dispatchId, runId, deploymentId);
			}
			return attached;
		});
	});
}

export async function runBackupJobStep(jobId: string, runId: string): Promise<{ stopped: boolean; delayMs: number }> {
	'use step';
	const { requireGatewayDatabaseAccess, withGatewayWork, runAdmittedGatewayWork } = await import('../deployment/environmentGateway');
	return withGatewayWork(async () => {
		await requireGatewayDatabaseAccess();
		return runAdmittedGatewayWork(async () => {
			const { backupJobs } = await import('./backupJobs');
			const { runBackupEngineStep } = await import('./backupEngine.server');
			const claim = await backupJobs.claim(jobId, runId);
			if (!claim.lease) return { stopped: claim.delayMs === 0, delayMs: claim.delayMs };
			try {
				const outcome = await backupJobs.withLease(claim.lease, context => runBackupEngineStep(context));
				await backupJobs.finish(claim.lease, outcome);
				return { stopped: outcome.kind !== 'continue', delayMs: outcome.kind === 'continue' ? Math.max(0, Math.min(60_000, outcome.delayMs ?? 0)) : 0 };
			} catch {
				// Never replay an uncertain provider action here. The engine's next
				// explicit retry must recover its original immutable receipts.
				await backupJobs.finish(claim.lease, { kind: 'pause', issue: 'step-failed' }).catch(() => {});
				// Provider errors may contain request details. Workflow diagnostics
				// receive a fixed label, never the original exception or its cause.
				throw Error('The protected backup step stopped; inspect its saved status');
			}
		});
	});
}
