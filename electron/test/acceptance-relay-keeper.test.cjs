'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renewOnce, runKeeper, relayMatches } = require('../scripts/acceptance-relay-keeper.cjs');
const root = '/private/fixture-one';
const binding = async stateRoot => { assert.equal(stateRoot, root); return { root, socketPath: root + '/browser.sock', leaseId: 'lease-one' }; };
test('keeper derives socket and lease file from the same validated state', async () => {
  const calls = [];
  const result = await renewOnce({ stateRoot: root, relayPid: 123 }, { binding, execute: async (bin, args) => {
    calls.push(args);
    return bin === '/bin/ps' ? { stdout: 'node /task/test-agent-desktop-relay.cjs ' + root + ' sha256:image 28671' } : { stdout: JSON.stringify({ id: 'lease-one', expiresAt: Date.now() + 60000, token: 'MUST_NOT_SURFACE' }) };
  } });
  assert.deepEqual(calls[1].slice(-4), ['--socket', root + '/browser.sock', '--lease-file', root + '/browser-lease.json']);
  assert.equal(Object.hasOwn(result, 'token'), false);
  assert.equal(relayMatches('node /task/test-agent-desktop-relay.cjs /private/fixture-one-other image port', root), false);
});
test('bad descriptor paths, foreign relay and renewal failure stop before further work', async () => {
  let commands = 0;
  await assert.rejects(renewOnce({ stateRoot: root, relayPid: 123 }, { binding: async () => { throw new Error('foreign socket or lease'); }, execute: async () => { commands++; } }), { code: 'state' });
  assert.equal(commands, 0);
  await assert.rejects(renewOnce({ stateRoot: root, relayPid: 123 }, { binding, execute: async () => ({ stdout: 'node /other/task.cjs' }) }), { code: 'process' });
  await assert.rejects(renewOnce({ stateRoot: root, relayPid: 123 }, { binding, execute: async bin => bin === '/bin/ps' ? { stdout: 'node /task/test-agent-desktop-relay.cjs ' + root + ' image port' } : { stdout: '{"id":"other","expiresAt":9999999999999}' } }), { code: 'renewal' });
});
test('renewal error is durably surfaced once with no retry or secret diagnostics', async () => {
  const statuses = []; let attempts = 0, waits = 0;
  const time = Date.now();
  await assert.rejects(runKeeper({ stateRoot: root, relayPid: 123, deadline: new Date(time + 60000).toISOString() }, { now: () => time, renew: async () => { attempts++; throw Object.assign(new Error('SECRET'), { code: 'renewal' }); }, status: async value => statuses.push(value), wait: async () => { waits++; } }), { code: 'renewal' });
  assert.equal(attempts, 1); assert.equal(waits, 0);
  assert.equal(statuses.at(-1).state, 'failed');
  assert.equal(JSON.stringify(statuses).includes('SECRET'), false);
});
test('bounded keeper records actual renewal then stops at its original deadline', async () => {
  let time = Date.now(), stopped = 0; const statuses = [], end = time + 1000;
  await runKeeper({ stateRoot: root, relayPid: 123, deadline: new Date(end).toISOString() }, { now: () => time, renew: async () => ({ leaseId: 'lease-one', expiresAt: end + 60000 }), status: async value => statuses.push(value), wait: async ms => { time += ms; }, stop: async () => { stopped++; } });
  assert.equal(statuses[0].state, 'active'); assert.equal(statuses[0].expiresAt, end + 60000);
  assert.equal(statuses.at(-1).state, 'complete'); assert.equal(stopped, 1);
});


test('keeper closes CLI stdin so lease renewal can complete', async () => {
  const { exec } = require('../scripts/acceptance-relay-keeper.cjs');
  const result = await exec(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>console.log("stdin-closed"))'], { timeout: 2000 });
  assert.equal(result.stdout.trim(), 'stdin-closed');
});

test('real private descriptor refuses crossed state, socket and lease paths before renewal', async t => {
  const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'keeper-path-test-')));
  await fs.chmod(root, 0o700);
  const socketPath = path.join(root, 'browser.sock'), leaseFile = path.join(root, 'browser-lease.json');
  const server = net.createServer(); await new Promise(resolve => server.listen(socketPath, resolve)); await fs.chmod(socketPath, 0o600);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const descriptor = { origin: 'http://127.0.0.1:28671', ready: true, isolation: { isolated: true }, socketPath, leaseFile, taskId: 'task', sessionId: 'session', browserTabs: [{ id: '1' }] };
  const lease = { socketPath, taskId: 'task', id: 'lease', token: 'SYNTHETIC' };
  for (const field of ['socketPath', 'leaseFile', 'leaseSocketPath', 'stateRoot']) {
    await fs.writeFile(path.join(root, 'relay.json'), JSON.stringify({ ...descriptor, ...(field === 'socketPath' ? { socketPath: '/private/other/browser.sock' } : {}), ...(field === 'leaseFile' ? { leaseFile: '/private/other/browser-lease.json' } : {}) }), { mode: 0o600 });
    await fs.writeFile(leaseFile, JSON.stringify({ ...lease, ...(field === 'leaseSocketPath' ? { socketPath: '/private/other/browser.sock' } : {}) }), { mode: 0o600 });
    let executions = 0;
    await assert.rejects(renewOnce({ stateRoot: field === 'stateRoot' ? root + '/foreign' : root, relayPid: 123 }, { execute: async () => { executions++; } }), { code: 'state' });
    assert.equal(executions, 0);
  }
});
