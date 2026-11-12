import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncTransferDeadline } from './syncTransferDeadline';
import { syncRequestHasPacing } from './resourceGovernor';
test('intentional pacing is excluded while actual stalled network and caller cancellation stay bounded', t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const owner = new AbortController(), deadline = createSyncTransferDeadline(owner.signal, 120000);
 deadline.pause(); t.mock.timers.tick(10 * 60 * 60 * 1000); assert.equal(deadline.signal.aborted, false);
 deadline.resume(); t.mock.timers.tick(119999); assert.equal(deadline.signal.aborted, false);
 t.mock.timers.tick(1); assert.equal(deadline.signal.reason.name, 'TimeoutError'); deadline.dispose();
 const cancelled = createSyncTransferDeadline(owner.signal); cancelled.pause(); owner.abort(); assert.equal(cancelled.signal.aborted, true); cancelled.dispose();
});
test('only explicitly paced native payload actions bypass wall deadlines; control work retains its deadline', () => {
 for (const action of ['upload-file', 'upload-part', 'upload-batch']) assert.equal(syncRequestHasPacing(action, { uploadBytesPerSecond: 312.5 }), true);
 assert.equal(syncRequestHasPacing('stage-download', { downloadBytesPerSecond: 312.5 }), true);
 assert.equal(syncRequestHasPacing('stage-download', { cpuPercent: 5 }), true);
 for (const action of ['context', 'conditions', 'scan-status', 'stage-begin', 'validate-folder-batch']) assert.equal(syncRequestHasPacing(action, { cpuPercent: 5, uploadBytesPerSecond: 312.5 }), false);
 assert.equal(syncRequestHasPacing('upload-part', { downloadBytesPerSecond: 312.5 }), false);
 assert.equal(syncRequestHasPacing('upload-part', { transferConcurrency: 2 }), false);
 for (const action of ['stage-finish', 'publish']) { assert.equal(syncRequestHasPacing(action, { cpuPercent: 5 }), true); assert.equal(syncRequestHasPacing(action, { uploadBytesPerSecond: 312.5, downloadBytesPerSecond: 312.5 }), false); }
});
