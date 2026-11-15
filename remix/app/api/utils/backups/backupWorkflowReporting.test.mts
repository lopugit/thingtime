import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let claim: any, outcome: any, finishError: Error | undefined, finished: any[];
mock.module('../deployment/environmentGateway', { namedExports: {
 requireGatewayDatabaseAccess: async () => {}, withGatewayWork: async (work: any) => work(), runAdmittedGatewayWork: async (work: any) => work()
} });
mock.module('./backupJobs', { namedExports: { backupJobs: {
 claim: async () => claim, withLease: async (_lease: any, work: any) => work({}),
 finish: async (_lease: any, result: any) => { if (finishError) throw finishError; finished.push(result); }
} } });
mock.module('./backupEngine.server', { namedExports: { runBackupEngineStep: async () => outcome } });
const { runBackupJobStep } = await import('./backupWorkflowSteps.server');
beforeEach(() => { claim = { lease: null, delayMs: 0, status: 'queued' }; outcome = { kind: 'continue' }; finishError = undefined; finished = []; });
test('no-lease states report only canonical completed status as success', async () => {
 for (const [status, terminalStatus] of [['completed', 'completed'], ['needs-attention', 'failed'], ['cancelled', 'cancelled'], ['paused', 'cancelled'], ['queued', 'cancelled'], ['running', 'cancelled']]) {
  claim.status = status; assert.deepEqual(await runBackupJobStep('job', 'run'), { stopped: true, delayMs: 0, terminalStatus });
 }
 claim.delayMs = 250; assert.deepEqual(await runBackupJobStep('job', 'run'), { stopped: false, delayMs: 250 });
});
test('completion reports only after coordinator finish succeeds', async () => {
 claim.lease = { jobId: 'job' }; outcome = { kind: 'complete' };
 assert.deepEqual(await runBackupJobStep('job', 'run'), { stopped: true, delayMs: 0, terminalStatus: 'completed' }); assert.deepEqual(finished, [{ kind: 'complete' }]);
 finishError = Error('private coordinator failure');
 await assert.rejects(runBackupJobStep('job', 'run'), error => error instanceof Error && error.message === 'The protected backup step stopped; inspect its saved status');
});
test('paused engine is failed and continuing engine remains nonterminal', async () => {
 claim.lease = { jobId: 'job' }; outcome = { kind: 'pause', issue: 'snapshot-expired' };
 assert.deepEqual(await runBackupJobStep('job', 'run'), { stopped: true, delayMs: 0, terminalStatus: 'failed' });
 outcome = { kind: 'continue', delayMs: 90000 }; assert.deepEqual(await runBackupJobStep('job', 'run'), { stopped: false, delayMs: 60000 });
});
