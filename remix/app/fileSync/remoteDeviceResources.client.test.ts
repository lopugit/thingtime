import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteDeviceStatusSession } from './remoteDeviceResources.client';
const policy = { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 };
const status = { version: 1 as const, deviceId: 'device', observedAt: '2026-11-03T00:00:00.000Z', roots: [], rootsReady: false, jobs: [], task: null,
 capabilities: { platform: 'macos', fileAccessVersion: '1.16.0', fileResourceLimitsVersion: '1.1.0' }, resourceUsage: { deviceResourceLimits: policy } };
test('overview and manager share a coalesced heartbeat; save selected-device policy while paused', async t => {
 t.mock.timers.enable({ apis: ['Date'], now: 100_000 });
 let reads = 0, saves = 0, visible = true, onVisibility = () => {}, active = true;
 const session = createRemoteDeviceStatusSession({ origin: 'https://device.test', ownerId: 'owner', deviceId: 'device', visible: () => visible,
  assertCurrent: () => { if (!active) throw Error('identity changed'); }, subscribeVisibility: fn => { onVisibility = fn; return () => {}; },
  createClient: () => ({ send: async (command: any) => {
   if (command.action === 'resources') { saves++; return { deviceResourceLimits: command.deviceResourceLimits }; }
   reads++;
   if (command.cursor) t.mock.timers.setTime(110_000);
   return command.cursor ? { ...status, observedAt: '2026-11-03T00:00:01.000Z', resourceUsage: undefined } : { ...status, nextCursor: '32' };
  } }) as any });
 const releaseOverview = session.retain(), releaseManager = session.retain();
 await Promise.all([session.refresh(), session.refresh()]);
 assert.equal(reads, 2); assert.deepEqual(session.read().status?.resourceUsage, { deviceResourceLimits: policy });
 assert.equal(session.read().receivedAt, 100_000, 'the receipt is anchored to the first status page');
 t.mock.timers.setTime(120_000);
 assert.deepEqual(await session.save({ ...policy, cpuPercent: 12 }), { ...policy, cpuPercent: 12 }); assert.equal(saves, 1);
 assert.deepEqual(session.read().status?.resourceUsage?.deviceResourceLimits, { ...policy, cpuPercent: 12 });
 assert.equal(session.read().status?.observedAt, status.observedAt, 'neither later pages nor a policy save are a fresh status heartbeat');
 assert.equal(session.read().receivedAt, 100_000, 'saving cannot refresh the status receipt');
 visible = false; onVisibility(); await session.refresh(); assert.equal(reads, 2);
 active = false; await assert.rejects(session.save(policy), /identity changed/); releaseOverview(); releaseManager();
});
test('identity invalidation fences late replies and removes prior measurements', async () => {
 let finish!: (value: any) => void;
 const session = createRemoteDeviceStatusSession({ origin: 'https://device.test', ownerId: 'owner', deviceId: 'device', visible: () => true, assertCurrent() {},
  createClient: () => ({ send: () => new Promise(resolve => { finish = resolve; }) }) as any });
 const release = session.retain(), pending = session.refresh(); session.invalidate(); finish(status); await pending;
 assert.equal(session.read().status, null); assert.equal(session.read().online, false); release();
});

test('directional cached status is used only after negotiating the additive contract and worker projection', async () => {
 for (const [ready, version] of [[false, '1.0.0'], [true, undefined], [true, '1.0.0']] as const) {
  const progress = { stage: 'transferring', totalFinal: false, directions: { upload: { operations: 1, confirmed: 0, bytesTotal: '3', bytesConfirmed: '0' }, download: { operations: 0, confirmed: 0, bytesTotal: '0', bytesConfirmed: '0' } } };
  const session = createRemoteDeviceStatusSession({ origin: 'https://device.test', ownerId: 'owner', deviceId: 'device', visible: () => true, assertCurrent() {}, negotiateDirections: async () => ready,
   createClient: () => ({ send: async () => ({ ...status, directionalProgressVersion: version, jobs: [{ connectionId: 'connection', state: 'paused', progress }] }) }) as any });
  const release = session.retain(); await session.refresh();
  assert.equal(!!session.read().status?.jobs[0].progress, ready && version === '1.0.0'); release();
 }
});

test('the shared remote heartbeat projects activity only from a negotiated source without losing null or zero', async () => {
 const record = { id: 'attempt', startedAt: 10, lastActivityAt: 20, endedAt: 20, status: 'complete', sentBytes: 0, receivedBytes: null };
 const activity = { startedAt: 30, lastActivityAt: 40, sentBytes: null, receivedBytes: 5 };
 for (const [ready, version] of [[false, '1.0.0'], [true, undefined], [true, '1.0.0']] as const) {
  const session = createRemoteDeviceStatusSession({ origin: 'https://device.test', ownerId: 'owner', deviceId: 'device', visible: () => true, assertCurrent() {},
   negotiateActivity: async () => ready,
   createClient: () => ({ send: async () => ({ ...status, connectionActivityVersion: version,
    jobs: [{ connectionId: 'config', state: 'scheduled', activity: record }],
    task: { connectionId: 'config', active: true, activity, progress: { stage: 'transferring', confirmed: 0, total: 1 } } }) }) as any });
  const release = session.retain(); await session.refresh();
  const projected = ready && version === '1.0.0';
  assert.deepEqual(session.read().status?.jobs[0].activity, projected ? record : undefined);
  assert.deepEqual(session.read().status?.task?.activity, projected ? activity : undefined);
  release();
 }
});
