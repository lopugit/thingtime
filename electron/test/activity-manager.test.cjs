'use strict';
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DesktopActivityManager, NODE_ID, VERSION } = require('../lib/activity-manager.cjs');

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'thingtime-activity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const actions = []; let running = true;
  const options = { filePath: path.join(root, 'preferences.json'),
    app: { getAppMetrics: () => [{ cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 100 } }, { cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 200 } }] },
    nodeAvailable: () => true, nodeStatus: async () => ({ serviceStatus: running ? 'running' : 'stopped', rawStatus: { credential: 'never-publish' } }),
    controlNode: async enabled => { actions.push(enabled); running = enabled; }, ...overrides };
  const manager = new DesktopActivityManager(options); await manager.initialize();
  return { manager, options, actions };
}
const request = enabled => ({ version: VERSION, action: 'set-enabled', id: NODE_ID, enabled });

test('disable persists intent and invokes actual stop; restart restores it without work', async t => {
  const { manager, options, actions } = await fixture(t);
  const stopped = await manager.request(request(false));
  assert.deepEqual(actions, [false]);
  assert.equal(stopped.activities[0].enabled, false); assert.equal(stopped.activities[0].running, false);
  const restored = new DesktopActivityManager(options); await restored.initialize();
  assert.equal(restored.nodeEnabled(), false); assert.deepEqual(actions, [false]);
  const enabled = await restored.request(request(true));
  assert.equal(enabled.activities[0].enabled, true); assert.equal(enabled.activities[0].running, true);
  assert.deepEqual(actions, [false, true]);
});
test('failed stop preserves disabled intent but reports running work; retry cleans it', async t => {
  let attempts = 0;
  const { manager, options } = await fixture(t, { controlNode: async () => { if (++attempts === 1) throw Error('failed'); } });
  await assert.rejects(manager.request(request(false)), /failed/);
  const state = await manager.request({ version: VERSION, action: 'list' });
  assert.equal(state.activities[0].enabled, false); assert.equal(state.activities[0].running, true);
  const restored = new DesktopActivityManager(options); await restored.initialize(); assert.equal(restored.nodeEnabled(), false);
  await manager.request(request(false)); assert.equal(attempts, 2);
});
test('pins contract and essential guards; rejects unavailable owner before any mutation', async t => {
  const { manager, actions } = await fixture(t, { nodeAvailable: () => false });
  await assert.rejects(manager.request({ version: '2.0.0', action: 'list' }), /contract/);
  await assert.rejects(manager.request({ ...request(false), id: 'desktop.browser-lease-guard' }), /cannot be changed/);
  await assert.rejects(manager.request(request(false)), /cannot be changed/);
  await assert.rejects(manager.request({ version: VERSION, action: 'list', privatePath: '/tmp' }), /Invalid/);
  assert.deepEqual(actions, []);
});
test('resource totals contain only measured metrics and never raw native status', async t => {
  const { manager } = await fixture(t);
  const state = await manager.request({ version: VERSION, action: 'list' });
  assert.deepEqual(state.metrics, { scope: 'electron-processes', processCount: 2, cpuPercent: 5, rssBytes: 307200 });
  assert.ok(!JSON.stringify(state).includes('never-publish'));
  const { manager: unavailable } = await fixture(t, { app: { getAppMetrics: () => [{ memory: {} }] }, nodeStatus: async () => { throw Error('offline'); } });
  const missing = await unavailable.snapshot(); assert.equal(missing.metrics.cpuPercent, null); assert.equal(missing.metrics.rssBytes, null);
  assert.equal(missing.activities[0].running, null);
});
test('corrupt preferences fail closed and do not silently enable work', async t => {
  const { options } = await fixture(t);
  await writeFile(options.filePath, '{broken');
  const manager = new DesktopActivityManager(options);
  await assert.rejects(manager.initialize(), /could not be read/);
  await assert.rejects(manager.request({ version: VERSION, action: 'list' }), /not ready/);
});
test('concurrent toggles serialize teardown before reenable', async t => {
  const events = [];
  const { manager } = await fixture(t, { controlNode: async enabled => { events.push(enabled ? 'start' : 'stop'); await Promise.resolve(); events.push('done'); } });
  await Promise.all([manager.request(request(false)), manager.request(request(true))]);
  assert.deepEqual(events, ['stop', 'done', 'start', 'done']); assert.equal(manager.nodeEnabled(), true);
});
test('failed preference write leaves native service and in-memory preference unchanged', async t => {
  const { manager, actions } = await fixture(t);
  manager.persist = async () => { throw Error('disk unavailable'); };
  await assert.rejects(manager.request(request(false)), /disk unavailable/);
  assert.equal(manager.nodeEnabled(), true);
  assert.deepEqual(actions, []);
});

test('partial enable failure restores a previously disabled service', async t => {
  let running = false;
  const calls = [];
  const { manager } = await fixture(t, {
    nodeStatus: async () => ({ serviceStatus: running ? 'running' : 'stopped' }),
    controlNode: async enabled => { calls.push(enabled); running = enabled; if (enabled) throw Error('settings write failed after start'); }
  });
  await manager.request(request(false));
  await assert.rejects(manager.request(request(true)), /settings write failed/);
  assert.deepEqual(calls, [false, true, false]);
  const state = await manager.snapshot();
  assert.equal(state.activities[0].enabled, false);
  assert.equal(state.activities[0].running, false);
});
