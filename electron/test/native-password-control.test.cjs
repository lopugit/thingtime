'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { NativePasswordBroker } = require('../lib/native-passwords/broker.cjs');
const { startPasswordControl } = require('../lib/native-passwords/control.cjs');
const { fail } = require('../lib/native-passwords/contract.cjs');
const { privateWrite } = require('../lib/native-passwords/store.cjs');

const cli = path.join(__dirname, '../scripts/password-agent.mjs');

function invoke(profile, method, params, grantFile) {
  const args = [cli, method, '--profile', profile, ...(grantFile ? ['--grant-file', grantFile] : [])];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, timeout: 30000 });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', value => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', value => { stderr += value; });
    child.stdin.on('error', reject);
    child.once('error', reject);
    child.once('close', (code, signal) => signal ? reject(new Error('The synthetic CLI subprocess terminated.')) : resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(params || {}));
  });
}

function unauthenticatedFrame(socket, token) {
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(socket), chunks = [];
    connection.setTimeout(5000, () => connection.destroy(new Error('The test socket timed out.')));
    connection.on('data', chunk => chunks.push(chunk));
    connection.on('error', error => { if (!['ECONNRESET', 'EPIPE'].includes(error.code)) reject(error); });
    connection.once('close', () => resolve(Buffer.concat(chunks)));
    connection.once('connect', () => {
      const request = Buffer.from(JSON.stringify({ token, request: { method: 'manifest' } }));
      const size = Buffer.alloc(4); size.writeUInt32LE(request.length);
      connection.write(Buffer.concat([size, request]));
    });
  });
}

test('the native CLI uses authenticated local framing and keeps bearer handles and credential values out of output', { timeout: 120000 }, async t => {
  const profile = await fs.mkdtemp(path.join(process.platform === 'win32' ? os.homedir() : '/tmp', 'tt-pw-'));
  const origin = 'https://vault.example', ownerId = 'synthetic-owner';
  const target = { kind: 'website', origin: 'https://login.example' };
  const request = { origin, ownerId, target, taskId: 'synthetic-control-test' };
  const session = {}, entries = new Map();
  const failingId = randomUUID(), privateFailure = 'synthetic-private-diagnostic';
  let state = { version: 1, connection: { origin, ownerId }, pending: {} }, approvals = 0, transport;
  const broker = new NativePasswordBroker({ userData: profile, platform: process.platform === 'win32' ? 'win32' : 'linux',
    context: () => ({ origin, endpoint: origin, session }),
    approve: async scope => { approvals++; assert.deepEqual(scope.target, target); return true; },
    store: { available: () => true, requireAvailable() {}, read: async () => structuredClone(state), write: async next => { state = structuredClone(next); } },
    vault: async (_scope, input, assertCurrent) => {
      assertCurrent?.();
      if (input.id === failingId) throw new Error(privateFailure);
      if (input.operation === 'catalog') return { catalog: [], nextCursor: null };
      if (input.operation === 'save') { entries.set(input.id, structuredClone(input.entry)); return { id: input.id }; }
      if (input.operation === 'read' && entries.has(input.id)) return { id: input.id, entry: structuredClone(entries.get(input.id)) };
      fail('NOT_FOUND', 'The synthetic entry does not exist.');
    },
  });
  t.after(async () => {
    try { await (transport ? transport.close() : broker.close()); }
    finally { await fs.rm(profile, { recursive: true, force: true }); }
  });
  transport = await startPasswordControl(broker, { socketDirectory: path.join(profile, 'sockets') });
  const descriptor = JSON.parse(await fs.readFile(transport.descriptor, 'utf8'));
  const wrongToken = `${descriptor.token[0] === 'A' ? 'B' : 'A'}${descriptor.token.slice(1)}`;
  assert.equal((await unauthenticatedFrame(descriptor.socket, wrongToken)).length, 0);

  const manifest = await invoke(profile, 'manifest');
  assert.equal(manifest.code, 0, manifest.stderr);
  assert.equal(JSON.parse(manifest.stdout).origin, descriptor.origin);
  assert.ok(!manifest.stdout.includes(descriptor.token), 'The transport token must stay private.');

  await privateWrite(transport.descriptor, JSON.stringify({ ...descriptor, origin: 'thingtime-desktop://other-profile' }));
  const wrongManifest = await invoke(profile, 'manifest');
  assert.equal(wrongManifest.code, 1);
  assert.match(wrongManifest.stderr, /compatible origin-scoped/);
  await privateWrite(transport.descriptor, JSON.stringify(descriptor));

  const grantFile = path.join(profile, 'task.grant');
  const authorization = await invoke(profile, 'authorize', request, grantFile);
  assert.equal(authorization.code, 0, authorization.stderr);
  assert.equal(approvals, 1);
  assert.equal(JSON.parse(authorization.stdout).authorized, true);
  const grant = JSON.parse(await fs.readFile(grantFile, 'utf8'));
  assert.equal(grant.origin, descriptor.origin);
  assert.ok(grant.grant && !authorization.stdout.includes(grant.grant), 'The grant must stay in its private file.');

  const requestId = randomUUID(), generation = { requestId, title: 'Synthetic login', username: 'fixture' };
  const generated = await invoke(profile, 'generate', generation, grantFile);
  assert.equal(generated.code, 0, generated.stderr);
  assert.deepEqual(JSON.parse(generated.stdout), { entryId: requestId, saved: true });
  const value = entries.get(requestId)?.fields.find(field => field.id === 'password')?.value;
  assert.ok(value && !generated.stdout.includes(value) && !generated.stderr.includes(value), 'The generated credential must stay in the vault.');

  const error = await invoke(profile, 'generate', { ...generation, requestId: failingId }, grantFile);
  assert.equal(error.code, 1);
  assert.match(error.stderr, /native password operation could not complete/);
  assert.ok(!error.stderr.includes(privateFailure), 'Internal error details must stay out of CLI output.');

  const wrongGrant = path.join(profile, 'other.grant');
  await privateWrite(wrongGrant, JSON.stringify({ ...grant, origin: 'thingtime-desktop://other-profile' }));
  const refused = await invoke(profile, 'generate', { ...generation, requestId: randomUUID() }, wrongGrant);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /grant belongs to a different native app profile/);
  assert.equal(entries.size, 1);

  const released = await invoke(profile, 'release', {}, grantFile);
  assert.equal(released.code, 0, released.stderr);
  await assert.rejects(fs.access(grantFile), { code: 'ENOENT' });
});
