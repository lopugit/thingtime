import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncStartup, photoStartupOutcome, syncStartupMessage } from './syncStartup';
import type { SyncScope } from './reconcile';
import type { NativePhotoRunStatus } from './nativePhotoRunProgress';

const identity = { ownerId: 'owner', origin: 'https://thingtime.test', generation: 3 };
const scope: SyncScope = { ownerId: identity.ownerId, origin: identity.origin, dataPlane: 'home', rootId: 'photos', deviceId: 'phone' };
const folder = { ...scope, rootId: 'folder' };
const status = (stage: NonNullable<NativePhotoRunStatus['photoRunProgress']>['stage']): NativePhotoRunStatus => ({
 configurationRevision: '2026-11-12T00:00:00Z', photoRunProgress: { stage,
  confirmed: { photos: 0, videos: 0, other: 0, wifiBytes: 0, mobileBytes: 0, unknownBytes: 0 } }
});

test('all-config startup announcement waits for every admitted local config and is deduplicated across foreground wakes', () => {
 const store = createSyncStartup(), pass = store.begin(identity);
 assert.equal(pass.announce(), false);
 pass.observe(scope, 'running'); pass.observe(folder, 'checking');
 assert.equal(pass.announce(), false, 'a second config is not admitted yet');
 pass.observe(folder, 'waiting'); assert.equal(pass.announce(), false, 'the paginated discovery fence is still open');
 pass.finishDiscovery(); assert.equal(pass.announce(), true);
 assert.equal(pass.announce(), false);
 const next = store.begin(identity); next.observe(scope, 'running'); next.observe(folder, 'waiting');
 next.finishDiscovery();
 assert.equal(next.announce(), false, 'focus, pageshow, visibility and route events do not repeat the toast');
 store.activate(identity);
 assert.equal(next.announce(), true, 'a genuine hidden-to-visible activation may acknowledge its next successful start');
 assert.equal(next.announce(), false);
});
test('failed, unsupported and incomplete startup never produce all-config success', () => {
 for (const outcome of ['checking', 'error', 'unavailable'] as const) {
  const store = createSyncStartup(), pass = store.begin(identity);
  pass.observe(scope, 'running'); pass.observe(folder, outcome); pass.finishDiscovery(); assert.equal(pass.announce(), false);
 }
 const pass = createSyncStartup().begin(identity); pass.observe(scope, 'complete');
 assert.equal(pass.announce(), false, 'historical completion is not startup');
});
test('unprocessed or unknown local intent admissions suppress all-config success after the journal batch', () => {
 const store = createSyncStartup(), pass = store.begin(identity);
 pass.observe(scope, 'running'); pass.finishDiscovery();
 for (const count of [3, 1, null]) { pass.pendingIntents(count); assert.equal(pass.announce(), false); }
 pass.pendingIntents(0); assert.equal(pass.announce(), true);
});
test('verified local discovery shows checking while held, then clears or exposes a failure without success', () => {
 const store = createSyncStartup(), pass = store.begin(identity);
 assert.equal(syncStartupMessage(store.read(), scope, 3), '', 'an unverified remote device is not local startup');
 pass.checking(scope);
 assert.equal(syncStartupMessage(store.read(), scope, 3), 'Sync is in progress — checking saved configs');
 assert.equal(pass.announce(), false);
 pass.finishDiscovery(); assert.equal(syncStartupMessage(store.read(), scope, 3), '');
 const failed = store.begin(identity); failed.checking(scope); failed.failDiscovery();
 assert.match(syncStartupMessage(store.read(), scope, 3), /need attention/);
 assert.equal(failed.announce(), false);
});
test('identity changes and discarded startup passes cannot publish stale state or notifications', () => {
 const store = createSyncStartup(), old = store.begin(identity), next = store.begin({ ...identity, generation: 4 });
 old.observe(scope, 'running'); assert.equal(old.announce(), false); assert.deepEqual(store.read()?.entries, []);
 next.observe(scope, 'running');
 assert.equal(syncStartupMessage(store.read(), scope, identity.generation), '');
 store.clear(identity); assert.ok(store.read(), 'old StrictMode cleanup cannot clear a newer identity');
 store.clear({ ...identity, generation: 4 }); assert.equal(store.read(), null);
 next.observe(scope, 'running'); assert.equal(store.read(), null);
});
test('page status is scoped to the selected owner, device, data plane and API origin', () => {
 const store = createSyncStartup(), pass = store.begin(identity); pass.observe(scope, 'running');
 assert.equal(syncStartupMessage(store.read(), scope, 3), 'Sync is in progress');
 for (const patch of [{ ownerId: 'other' }, { deviceId: 'remote' }, { dataPlane: 'app' }, { origin: 'https://other.test' }]) {
  assert.equal(syncStartupMessage(store.read(), { ...scope, ...patch } as SyncScope, 3), '');
 }
 const mac = { ...scope, origin: 'https://selected-api.test' }; pass.observe(mac, 'waiting');
 assert.equal(syncStartupMessage(store.read(), mac, 3, identity.origin), 'Sync is waiting for saved conditions.');
 pass.observe(folder, 'error');
 assert.match(syncStartupMessage(store.read(), scope, 3), /need attention/, 'running work cannot conceal a failed sibling');
});
test('native startup requires a negotiated wake receipt and preserves waiting/refusal truth', () => {
 assert.equal(photoStartupOutcome(status('uploading'), true), 'unavailable');
 assert.equal(photoStartupOutcome(undefined, true), 'unavailable');
 for (const wake of ['running', 'queued', 'waiting', 'refused'] as const) {
  assert.equal(photoStartupOutcome({ ...status('ready'), wake: { status: wake } }, true),
   wake === 'refused' ? 'error' : wake === 'waiting' ? 'waiting' : 'running');
 }
 assert.equal(photoStartupOutcome(status('paused')), 'paused');
 assert.equal(photoStartupOutcome(status('needs-review')), 'error');
 assert.equal(photoStartupOutcome(status('complete')), 'complete');
 assert.equal(photoStartupOutcome(status('waiting')), 'waiting');
});
