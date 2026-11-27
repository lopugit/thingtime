import test from 'node:test';
import assert from 'node:assert/strict';
import { newFileSyncConfiguration } from './configuration';
import type { ConfigurationDraft } from './configurationEditor';
import type { SyncJob } from './syncJobJournal';
import type { SyncTaskSnapshot } from './syncTaskRuntime';
import { savedLocalRecoveryPendingOnLane, savedLocalRecoveryProofCurrent, savedLocalRecoveryRetryQueuedOnLane, savedLocalRecoveryWaitsForLane, savedLocalStrictRecoveryEligible, settleSavedLocalRecoveryProof, verifySavedLocalRecoveryCandidate } from './savedIntentRecoveryEligibility';

test('saved local strict recovery is shown as queued only with exact saved policy, journal and foreign active lane', () => {
 const scope = { origin: 'https://thingtime.com', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'config' };
 const saved = { id: scope.rootId, updatedAt: '2026-11-12T00:00:00.000Z', configuration:
  { ...newFileSyncConfiguration({ name: 'Fixture', deviceId: scope.deviceId, localRootId: 'root', remoteFolderId: 'cloud' }), paused: false } };
 const draft: ConfigurationDraft = { version: 1, id: saved.id, baseUpdatedAt: saved.updatedAt, pending: true,
  configuration: saved.configuration, exclusions: '', enrollment: { transport: 'local', intervalMs: 300_000, savedRevision: saved.updatedAt } };
 const job = { version: 1, key: 'fixture', id: 'original', revision: 2, scope, reviewed: saved,
  state: 'attention', failureReason: 'indexing-incomplete', strictCaptureId: 'capture', intervalMs: 300_000 } as SyncJob;
 const task = { active: true, scope: { ...scope, rootId: 'other-config' } } as SyncTaskSnapshot;
 const input = { draft, saved, job, scope, task, automaticEnabled: true, locallyPaused: false };
 assert.equal(savedLocalStrictRecoveryEligible(job, saved, scope, 300_000), true);
 assert.equal(savedLocalRecoveryPendingOnLane(input), true);
 assert.equal(savedLocalRecoveryWaitsForLane(input), true);
 const proof = { draftSignature: JSON.stringify(draft), jobRevision: job.revision, saved };
 assert.equal(savedLocalRecoveryProofCurrent(proof, draft, job, saved), true);
 assert.equal(savedLocalRecoveryProofCurrent(proof, { ...draft }, job, saved), true, 'selection or remount keeps the same exact proof');
 assert.equal(savedLocalRecoveryProofCurrent(proof, draft, job,
  { ...saved, updatedAt: '2026-11-12T00:01:00.000Z' }), false, 'a newer loaded cloud revision invalidates an earlier exact read');
 assert.equal(savedLocalRecoveryProofCurrent(proof, draft, { ...job, revision: job.revision + 1 }, saved), false);
 assert.equal(savedLocalRecoveryProofCurrent(proof, { ...draft, configuration: { ...draft.configuration, name: 'Edited' } }, job, saved), false);
 const oldAttempt = Symbol('old'), newAttempt = Symbol('new');
 assert.equal(settleSavedLocalRecoveryProof({ [saved.id]: proof }, saved.id, oldAttempt, newAttempt, null)[saved.id], proof,
  'a late failure cannot erase a newer successful exact read');
 assert.equal(settleSavedLocalRecoveryProof({ [saved.id]: proof }, saved.id, newAttempt, newAttempt, null)[saved.id], undefined,
  'a current refused read clears an earlier proof');
 assert.equal(savedLocalRecoveryPendingOnLane({ ...input, job: { ...job, failureReason: 'unknown' } }), true,
  'the retained intent may be pending on the lane while its unknown failure remains attention');
 for (const failureReason of ['indexing-incomplete', 'unknown', undefined] as const) {
  assert.equal(savedLocalRecoveryRetryQueuedOnLane({ ...input, job: { ...job, failureReason } }), true,
   'an exact pending automatic recheck makes routine Retry redundant without resolving the prior failure');
 }
 for (const failureReason of ['folder-access', 'cloud-authorization', 'write-approval', 'configuration-changed'] as const) {
  assert.equal(savedLocalRecoveryRetryQueuedOnLane({ ...input, job: { ...job, failureReason } }), false,
   'actionable failures must retain their recovery control');
 }
 assert.equal(savedLocalRecoveryRetryQueuedOnLane({ ...input, task: null, job: { ...job, failureReason: 'unknown' } }), false,
  'ordinary Retry returns when the active lane becomes idle');
 assert.equal(savedLocalRecoveryRetryQueuedOnLane({ ...input, locallyPaused: true, job: { ...job, failureReason: 'unknown' } }), false,
  'Pause retains explicit recovery controls');
 assert.equal(savedLocalRecoveryRetryQueuedOnLane({ ...input, saved: undefined, job: { ...job, failureReason: 'unknown' } }), false,
  'missing exact saved proof never hides Retry');
 for (const changed of [
  { saved: undefined }, { job: undefined }, { task: null }, { task: { ...task, active: false } },
  { task: { ...task, scope: { ...task.scope, ownerId: 'foreign' } } },
  { task: { ...task, scope: { ...task.scope, rootId: saved.id } } },
  { automaticEnabled: false }, { locallyPaused: true },
  { draft: { ...draft, pending: false } }, { draft: { ...draft, configuration: { ...draft.configuration, paused: true } } },
  { draft: { ...draft, enrollment: { ...draft.enrollment!, savedRevision: '2026-11-12T00:01:00.000Z' } } },
  { saved: { ...saved, configuration: { ...saved.configuration, name: 'New policy' } } },
  { job: { ...job, reviewed: { ...saved, updatedAt: '2026-11-12T00:01:00.000Z' } } },
  { job: { ...job, scope: { ...scope, ownerId: 'foreign' } } },
  { job: { ...job, strictCaptureId: undefined } },
  { job: { ...job, nextRunAt: Date.now() + 300_000 } },
  { job: { ...job, folderSetupPaused: true } },
  { job: { ...job, state: 'paused' } },
  { job: { ...job, failureReason: 'unknown' } }, { job: { ...job, failureReason: 'folder-access' } },
  { job: { ...job, failureReason: 'cloud-authorization' } }, { job: { ...job, failureReason: undefined } }
 ]) assert.equal(savedLocalRecoveryWaitsForLane({ ...input, ...changed } as typeof input), false, JSON.stringify(changed));
 assert.equal(savedLocalRecoveryWaitsForLane({ ...input, task: null }), false, 'idle transition returns to ordinary recovery/attention projection');
});

test('a delayed exact cloud reply cannot prove an old queued revision after a newer list arrives', async () => {
 const scope = { origin: 'https://thingtime.com', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'config' };
 const saved = { id: scope.rootId, updatedAt: '2026-11-12T00:00:00.000Z', configuration:
  { ...newFileSyncConfiguration({ name: 'Fixture', deviceId: scope.deviceId, localRootId: 'root', remoteFolderId: 'cloud' }), paused: false } };
 const draft: ConfigurationDraft = { version: 1, id: saved.id, baseUpdatedAt: saved.updatedAt, pending: true,
  configuration: saved.configuration, exclusions: '', enrollment: { transport: 'local', intervalMs: 300_000, savedRevision: saved.updatedAt } };
 const job = { version: 1, key: 'fixture', id: 'original', revision: 2, scope, reviewed: saved,
  state: 'attention', failureReason: 'indexing-incomplete', strictCaptureId: 'capture', intervalMs: 300_000 } as SyncJob;
 const row = { id: saved.id, updatedAt: saved.updatedAt, crystal: saved.configuration,
  author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'] };
 let resolve!: (value: unknown) => void;
 let latest = saved.updatedAt;
 const pending = verifySavedLocalRecoveryCandidate(draft, scope, job, () => new Promise(done => { resolve = done; }),
  () => { if (latest !== saved.updatedAt) throw Error('A newer cloud revision was loaded.'); });
 latest = '2026-11-12T00:01:00.000Z';
 resolve(row);
 await assert.rejects(pending, /newer cloud revision/);
 latest = saved.updatedAt;
 const proof = await verifySavedLocalRecoveryCandidate(draft, scope, job, async () => row, () => {});
 assert.equal(savedLocalRecoveryProofCurrent(proof ?? undefined, draft, job, saved), true);
});
