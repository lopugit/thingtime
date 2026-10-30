'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserLeases } = require('../lib/agent-browsers/leases.cjs');

test('two agents cannot claim, operate, or release each other\'s install', () => {
  const leases = new BrowserLeases();
  const a = leases.claim({ installId: 'browser-a', taskId: 'task-a', agentId: 'agent-a' });
  const b = leases.claim({ installId: 'browser-b', taskId: 'task-b', agentId: 'agent-b' });
  assert.throws(() => leases.claim({ installId: 'browser-a', taskId: 'task-b', agentId: 'agent-b' }), /already claimed/);
  assert.throws(() => leases.require({ leaseId: a.id, token: b.token }), /lease is required/);
  assert.throws(() => leases.release({ leaseId: a.id, token: b.token }), /lease is required/);
  assert.equal(leases.require({ leaseId: a.id, token: a.token }).taskId, 'task-a');
  assert.ok(!JSON.stringify(leases.list()).includes(a.token));
  assert.ok(!JSON.stringify(leases.list()).includes('tokenHash'));
});

test('expiry refuses operations but permits owned cleanup, and stale handles cannot release a replacement', () => {
  let now = 0;
  const leases = new BrowserLeases({ now: () => now, durationMs: 100 });
  const old = leases.claim({ installId: 'browser', taskId: 'task', agentId: 'agent' });
  now = 101;
  assert.throws(() => leases.require({ leaseId: old.id, token: old.token }), /expired/);
  assert.throws(() => leases.claim({ installId: 'browser', taskId: 'new-task', agentId: 'new-agent' }), /already claimed/);
  leases.release({ leaseId: old.id, token: old.token });
  const replacement = leases.claim({ installId: 'browser', taskId: 'new-task', agentId: 'new-agent' });
  assert.throws(() => leases.release({ leaseId: old.id, token: old.token }));
  assert.equal(leases.require({ leaseId: replacement.id, token: replacement.token }).taskId, 'new-task');
});
