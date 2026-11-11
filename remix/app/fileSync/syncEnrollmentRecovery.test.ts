import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSavedIntentRecovery } from './syncEnrollmentRecovery.client';
import type { RemoteSyncStatus } from './remoteSyncProtocol';

test('saved intent chooses direct recovery only with compatible origin and executing worker on an idle exact attention job', () => {
 const job: RemoteSyncStatus['jobs'][number] = { connectionId: 'config', state: 'attention', intervalMs: 300_000, strictCapturePending: true };
 const status = { deviceId: 'device', folderEnrollmentVersion: '1.0.0', folderEnrollmentRecoveryVersion: '1.0.0', task: null } as RemoteSyncStatus;
 assert.equal(chooseSavedIntentRecovery(status, job, 'device', 300_000, true), true);
 for (const version of ['1.0.1', '1.1.0'])
  assert.equal(chooseSavedIntentRecovery({ ...status, folderEnrollmentRecoveryVersion: version }, job, 'device', 300_000, true), true);
 for (const changed of [
  { status: { ...status, folderEnrollmentRecoveryVersion: undefined } },
  { status: { ...status, folderEnrollmentRecoveryVersion: '2.0.0' } },
  { status: { ...status, deviceId: 'other' } },
  { status: { ...status, task: { active: true } } },
  { job: { ...job, state: 'scheduled' } },
  { job: { ...job, strictCapturePending: undefined } },
  { job: { ...job, nextRunAt: Date.now() + 300_000 } },
  { job: { ...job, pendingFolderValidation: true } },
  { job: { ...job, intervalMs: 900_000 } }
 ]) {
  assert.equal(chooseSavedIntentRecovery((changed.status ?? status) as RemoteSyncStatus,
   (changed.job ?? job) as RemoteSyncStatus['jobs'][number], 'device', 300_000, true), false);
 }
 assert.equal(chooseSavedIntentRecovery(status, job, 'device', 300_000, false), false, 'an old or breaking origin cannot opt in');
});
