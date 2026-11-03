'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AgentBrowserManager } = require('../lib/agent-browsers/manager.cjs');
const { dispatch } = require('../lib/agent-browsers/control.cjs');

test('shared manager fences ownership, freezes security and cleans expired sessions without takeover', async () => {
  let now = 100;
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-agent-manager-'));
  const images = new EventEmitter();
  images.records = new Map([['install-a', { imageId: 'image-a' }], ['install-b', { imageId: 'image-b' }]]);
  images.initialize = async () => {}; images.snapshot = () => ({ installs: [], downloads: [] });
  const created = [];
  const manager = await new AgentBrowserManager({ stateRoot, images, now: () => now, createSession: options => {
    const session = { id: options.imageId, policy: options.networkPolicy, start: async () => { session.ready = true; },
      call: async method => ({ method }), close: async () => { session.closed = true; } };
    created.push(session); return session;
  } }).initialize();
  try {
    await assert.rejects(dispatch(manager, { method: 'defaults.set', params: { network: { mode: 'unrestricted' } } }), /desktop controls/);
    assert.throws(() => manager.claim({ taskId: 'missing', installId: 'install-a', agentId: 'a' }), /Open this task/);
    manager.registerTask({ taskId: 'task-a' }); manager.registerTask({ taskId: 'task-b' });
    const a = manager.claim({ taskId: 'task-a', installId: 'install-a', agentId: 'a' });
    const b = manager.claim({ taskId: 'task-b', installId: 'install-b', agentId: 'b' });
    const ca = { leaseId: a.id, token: a.token }, cb = { leaseId: b.id, token: b.token };
    await manager.setDefaults({ mode: 'unrestricted' });
    await Promise.all([manager.launch(ca), manager.launch(cb)]);
    assert.equal(created[0].policy.mode, 'isolated'); assert.equal(created[1].policy.mode, 'isolated');
    assert.throws(() => manager.command({ leaseId: b.id, token: a.token }, 'tabs'), /lease is required/);
    await assert.rejects(manager.removeInstall('install-a'), /Release/);
    const snapshot = manager.snapshot(); snapshot.leases[0].policy.mode = 'unrestricted';
    assert.equal(manager.leases.require(ca).policy.mode, 'isolated');
    await manager.release(ca); assert.equal(created[0].closed, true); assert.equal(created[1].closed, undefined);
    now += 16 * 60 * 1000; await manager.expire(); assert.equal(created[1].closed, true);
    assert.throws(() => manager.claim({ taskId: 'task-a', installId: 'install-b', agentId: 'a' }), /already claimed/);
    await manager.release(cb);
  } finally { await manager.close(); await fs.rm(stateRoot, { recursive: true, force: true }); }
});

test('shutdown attempts every cleanup path and retains failed sessions for retry', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-agent-shutdown-'));
  const images = new EventEmitter(), bundles = new EventEmitter();
  const closed = [];
  for (const [name, installer] of [['images', images], ['bundles', bundles]]) {
    installer.initialize = async () => {};
    installer.close = async () => { closed.push(name); };
  }
  const manager = await new AgentBrowserManager({ stateRoot, images, bundles }).initialize();
  let fails = true;
  manager.sessions.set('owned', { close: async () => { if (fails) throw new Error('Daemon unavailable'); } });
  try {
    await assert.rejects(manager.close(), /Cleanup remains retryable/);
    assert.deepEqual(new Set(closed), new Set(['images', 'bundles']));
    assert.equal(manager.sessions.has('owned'), true);
    await fs.access(path.join(stateRoot, 'owner.json'));
    fails = false;
    await manager.close();
    assert.equal(manager.sessions.size, 0);
    await assert.rejects(fs.access(path.join(stateRoot, 'owner.json')), { code: 'ENOENT' });
  } finally { await fs.rm(stateRoot, { recursive: true, force: true }); }
});
