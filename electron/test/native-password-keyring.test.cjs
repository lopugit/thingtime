'use strict';

const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const { keyringState, unlockKeyring } = require('../lib/native-passwords/consumers.cjs');
const { fail } = require('../lib/native-passwords/contract.cjs');

const execute = promisify(execFile);
const fixtureFlag = 'THINGTIME_NATIVE_KEYRING_FIXTURE';

async function refuseWrongPeer(secret, locked) {
  const runtime = process.env.XDG_RUNTIME_DIR;
  const directory = path.join(runtime, 'fake-peer');
  await fs.mkdir(directory, { mode: 0o700 });
  const connections = new Set();
  let bytes = 0;
  const server = net.createServer(socket => {
    connections.add(socket);
    socket.on('data', chunk => { bytes += chunk.length; });
    socket.on('error', () => {});
    socket.once('close', () => connections.delete(socket));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path.join(directory, 'control'), resolve); });
  delete process.env.XDG_RUNTIME_DIR;
  process.env.GNOME_KEYRING_CONTROL = directory;
  let authorized = false;
  try {
    await assert.rejects(unlockKeyring(secret, locked, () => { authorized = true; }), { code: 'CONSUMER_REFUSED' });
    assert.equal(authorized, false);
    assert.equal(bytes, 0);
  } finally {
    process.env.XDG_RUNTIME_DIR = runtime;
    delete process.env.GNOME_KEYRING_CONTROL;
    for (const socket of connections) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

async function runFixture() {
  const secret = randomBytes(32).toString('base64url');
  const child = spawn('/usr/bin/gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const stopped = new Promise(resolve => child.once('close', resolve));
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(secret);
  try {
    let opened;
    for (let attempt = 0; attempt < 20 && !opened; attempt++) {
      opened = await keyringState().catch(() => undefined);
      if (!opened) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(opened?.pid, child.pid);
    assert.equal(opened?.locked, false);
    await execute('/usr/bin/gdbus', ['call', '--session', '--dest', opened.owner, '--object-path', '/org/freedesktop/secrets', '--method', 'org.freedesktop.Secret.Service.Lock', "['/org/freedesktop/secrets/collection/login']"], { timeout: 5000 });
    const locked = await keyringState();
    assert.equal(locked.locked, true);
    assert.equal(locked.pid, opened.pid);
    await assert.rejects(unlockKeyring(secret, locked, () => fail('GRANT_EXPIRED', 'Synthetic revocation.')), { code: 'GRANT_EXPIRED' });
    assert.equal((await keyringState()).locked, true);
    await assert.rejects(unlockKeyring(randomBytes(32).toString('base64url'), locked, () => {}), { code: 'CONSUMER_REFUSED' });
    assert.equal((await keyringState()).locked, true);
    await refuseWrongPeer(secret, locked);
    assert.equal((await keyringState()).locked, true);
    await unlockKeyring(secret, locked, () => {});
    assert.deepEqual(await keyringState(), opened);
  } finally {
    child.kill();
    await stopped;
  }
}

if (process.env[fixtureFlag] === '1') {
  runFixture().catch(error => { process.stderr.write(`${error.code || error.name}: ${error.message}\n`); process.exitCode = 1; });
} else {
  test('the broker unlocks the exact existing GNOME keyring and refuses wrong credentials or revoked scope', {
    skip: process.platform !== 'linux' || process.env.THINGTIME_TEST_NATIVE_KEYRING !== '1', timeout: 45000,
  }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-keyring-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'home'), runtime = path.join(root, 'run');
    const env = { ...process.env, [fixtureFlag]: '1', HOME: home, XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share') };
    delete env.GNOME_KEYRING_CONTROL;
    await Promise.all([home, runtime, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME].map(directory => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
    await execute('/usr/bin/dbus-run-session', ['--', process.execPath, __filename], { env, timeout: 30000, maxBuffer: 32768 });
  });
}
