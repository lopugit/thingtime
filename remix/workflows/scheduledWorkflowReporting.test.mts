import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { beforeEach, mock, test } from 'node:test';
const correlation = { runId: 'cron-parent', jobName: 'Sweep moderation', path: '/api/v1/moderation/sweep', startedAt: '2026-11-15T00:00:00Z' };
let reports: any[] = [], starts: any[] = [], reportFails = false, batchError: Error | undefined;
let batch = { text: { scanned: 2, analyzed: 1, flagged: 1, failed: 0, skippedOff: false, released: 1 }, attachments: { scanned: 3, analyzed: 2, flagged: 1, failed: 0, skipped: 1 }, hasMore: false };
let initialized = true, backupSteps: any[] = [], backupCalls = 0, sleeps: number[] = [];
mock.module(createRequire(import.meta.url).resolve('workflow'), { namedExports: { getWorkflowMetadata: () => ({ workflowRunId: 'workflow-instance' }), sleep: async (ms: number) => { sleeps.push(ms); } } });
mock.module('workflow/api', { namedExports: { start: async (...args: any[]) => { starts.push(args); return { runId: 'continuation-instance' }; } } });
mock.module('../app/api/utils/automation/scheduledRunReporting', { namedExports: {
 currentScheduledRunCorrelation: () => correlation,
 reportScheduledChildRun: async (...args: any[]) => { reports.push(args); if (reportFails) throw Error('private reporting failure'); }
} });
mock.module('../app/api/utils/moderation/moderationAdmin', { namedExports: { runModerationSweepBatch: async () => { if (batchError) throw batchError; return batch; } } });
mock.module('../app/api/utils/backups/backupWorkflowSteps.server', { namedExports: {
 initializeBackupWorkflow: async () => initialized,
 runBackupJobStep: async () => { backupCalls++; const result = backupSteps.shift(); if (result instanceof Error) throw result; return result; }
} });
const { drainModerationSweep, startModerationSweepDrain } = await import('./moderationSweep');
const { runBackupWorkflow } = await import('../app/api/utils/backups/backupWorkflow.server');
beforeEach(() => {
 reports = []; starts = []; reportFails = false; batchError = undefined; batch.hasMore = false; batch.text.failed = 0;
 initialized = true; backupCalls = 0; backupSteps = []; sleeps = [];
});
test('moderation persists original cron correlation through start and continuation', async () => {
 assert.equal(await startModerationSweepDrain(), 'continuation-instance'); assert.deepEqual(starts[0][1], [correlation]);
 batch.hasMore = true; const result = await drainModerationSweep(correlation as any);
 assert.equal(result.continuedAs, 'continuation-instance'); assert.deepEqual(starts[1][1], [correlation]);
 assert.deepEqual(reports.map(row => row[2]), ['started', 'completed']); assert.equal(reports[1][0], correlation);
 assert.deepEqual(reports[1][3], { outcome: 'success', counts: { scanned: 5, analyzed: 3, flagged: 2, failed: 0, skipped: 1, released: 1 } });
});
test('moderation partial failures remain failed while preserving result', async () => {
 batch.text.failed = 1; const result = await drainModerationSweep(correlation as any);
 assert.equal(result.text.failed, 1); assert.equal(reports.at(-1)[2], 'failed'); assert.equal(reports.at(-1)[3].outcome, 'partial-failure');
});
test('reporting outages never retry or replace moderation failure', async () => {
 batchError = Error('private provider detail'); reportFails = true;
 await assert.rejects(drainModerationSweep(correlation as any), error => error === batchError);
 assert.deepEqual(reports.map(row => row[2]), ['started', 'failed']); assert.equal(JSON.stringify(reports).includes(batchError.message), false); assert.equal(starts.length, 0);
});
test('backup reports actual durable completion after continuation steps', async () => {
 backupSteps = [{ stopped: false, delayMs: 50 }, { stopped: true, delayMs: 0, terminalStatus: 'completed' }];
 await runBackupWorkflow('protected-job', 'protected-dispatch', correlation as any);
 assert.deepEqual(sleeps, [50]); assert.equal(backupCalls, 2); assert.deepEqual(reports.map(row => row[2]), ['started', 'completed']);
 assert.deepEqual(reports.at(-1)[3], { outcome: 'success', counts: { completed: 1 } }); assert.equal(JSON.stringify(reports).includes('protected-job'), false);
});
test('failed, stopped and superseded backups never become successful completion', async () => {
 for (const terminalStatus of ['failed', 'cancelled', undefined]) {
  reports = []; backupSteps = [{ stopped: true, delayMs: 0, terminalStatus }]; await runBackupWorkflow('job', 'dispatch', correlation as any);
  assert.equal(reports.at(-1)[2], terminalStatus ?? 'cancelled'); assert.notEqual(reports.at(-1)[3].outcome, 'success');
 }
 reports = []; initialized = false; await runBackupWorkflow('job', 'dispatch', correlation as any); assert.equal(reports.at(-1)[2], 'cancelled');
});
test('backup preserves protected step error during reporting outage', async () => {
 const error = Error('protected failure'); backupSteps = [error]; reportFails = true;
 await assert.rejects(runBackupWorkflow('job', 'dispatch', correlation as any), actual => actual === error);
 assert.equal(backupCalls, 1); assert.deepEqual(reports.map(row => row[2]), ['started', 'failed']);
});
test('non-cron workflows do not manufacture cron parent', async () => {
 backupSteps = [{ stopped: true, delayMs: 0, terminalStatus: 'completed' }]; await runBackupWorkflow('job', 'dispatch'); await drainModerationSweep(); assert.deepEqual(reports, []);
});
