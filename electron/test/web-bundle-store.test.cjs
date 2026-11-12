'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { inventoryDirectory } = require('../../native-bundles/inventory.cjs');
const { signDescriptor } = require('../../native-bundles/release.cjs');
const { createWebBundleStore } = require('../lib/web-bundle-store.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-bundle-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundledDirectory = path.join(root, 'bundled');
  await fs.mkdir(bundledDirectory);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const options = {
    cacheDirectory: path.join(root, 'cache'), bundledDirectory,
    host: { platform: 'darwin', arch: 'arm64', runtimeId: 'node-24', nativeAbi: '137', shellVersion: '1.0.0', channel: 'development', minimumSequence: 0 },
    trustedKeys: [{ keyId: 'fixture', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), channels: ['development'], platforms: ['darwin'], runtimes: ['node-24'] }]
  };
  async function release(sequence) {
    const source = path.join(root, `source-${sequence}`);
    await fs.mkdir(path.join(source, 'server'), { recursive: true });
    await fs.writeFile(path.join(source, 'index.html'), `<p>Release ${sequence}</p>`);
    await fs.writeFile(path.join(source, 'server/index.mjs'), `export const release = ${sequence};\n`);
    const descriptor = {
      version: `1.0.${sequence}`, channel: 'development', sequence,
      target: { platform: 'darwin', arch: 'arm64' },
      runtime: { id: 'node-24', nativeAbi: '137', minShellVersion: '1.0.0', maxShellVersion: '1.9.0' },
      entrypoints: { renderer: 'index.html', server: 'server/index.mjs' },
      files: await inventoryDirectory(source)
    };
    const envelope = signDescriptor(descriptor, { keyId: 'fixture', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    return { source, envelope, id: envelope.releaseId };
  }
  return { root, options, release, store: await createWebBundleStore(options) };
}

test('successful launch commits independently retained bytes and survives a cold store', async t => {
  const f = await fixture(t), r = await f.release(1);
  assert.equal((await f.store.prepareLaunch()).source, 'bundled');
  await f.store.stage(r.source, r.envelope);
  await fs.rm(r.source, { recursive: true });
  const trial = await f.store.prepareLaunch();
  assert.equal(trial.source, 'trial');
  assert.equal((await import(pathToFileURL(path.join(trial.directory, 'server/index.mjs')).href)).release, 1);
  await assert.rejects(f.store.confirmLaunch('0'.repeat(64)), /matching bundle launch/);
  await f.store.confirmLaunch(r.id);
  const cold = await createWebBundleStore(f.options);
  assert.equal((await cold.prepareLaunch()).releaseId, r.id);
  assert.equal((await cold.inspect()).pending, null);
});

test('a crash before confirmation rolls back and cannot repeat the same release', async t => {
  const f = await fixture(t), r = await f.release(1);
  await f.store.stage(r.source, r.envelope);
  assert.equal((await f.store.prepareLaunch()).source, 'trial');
  const cold = await createWebBundleStore(f.options);
  assert.equal((await cold.prepareLaunch()).source, 'bundled');
  assert.equal((await cold.inspect()).failed, r.id);
  await assert.rejects(cold.stage(r.source, r.envelope), /sequence did not advance/);
  assert.equal((await cold.prepareLaunch()).source, 'bundled');
});

test('bad candidate and later active tampering retain the previous known-good release', async t => {
  const f = await fixture(t), a = await f.release(1), b = await f.release(2), c = await f.release(3);
  for (const r of [a, b]) {
    await f.store.stage(r.source, r.envelope); await f.store.prepareLaunch(); await f.store.confirmLaunch(r.id);
  }
  await f.store.stage(c.source, c.envelope);
  const payload = id => path.join(f.options.cacheDirectory, 'releases', id, 'payload', 'index.html');
  await fs.writeFile(payload(c.id), 'tampered candidate');
  assert.equal((await f.store.prepareLaunch()).releaseId, b.id);
  await fs.writeFile(payload(b.id), 'tampered active');
  assert.equal((await f.store.prepareLaunch()).releaseId, a.id);
  const state = await f.store.inspect();
  assert.equal(state.active, a.id);
  assert.equal(state.highestSequence, 3);
  await assert.rejects(f.store.stage(b.source, b.envelope), /sequence did not advance/);
});

test('concurrent stores serialize one pending trial and freeze caller-owned envelope bytes', async t => {
  const f = await fixture(t), a = await f.release(1), b = await f.release(2);
  const other = await createWebBundleStore(f.options);
  const first = f.store.stage(a.source, a.envelope);
  a.envelope.descriptor.version = 'changed-after-call';
  const second = other.stage(b.source, b.envelope);
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /trial is already pending/);
  assert.equal((await f.store.inspect()).pending.releaseId, a.id);
});

test('tampered sources and cancellation leave launch pointers unchanged and clean staging', async t => {
  const f = await fixture(t), a = await f.release(1), b = await f.release(2);
  await fs.writeFile(path.join(a.source, 'index.html'), 'untrusted');
  await assert.rejects(f.store.stage(a.source, a.envelope), /inventory mismatch/);
  await assert.rejects(f.store.stage(b.source, b.envelope, { signal: AbortSignal.abort() }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(path.join(f.options.cacheDirectory, 'releases')), []);
  assert.equal((await f.store.inspect()).highestSequence, 0);
  assert.equal((await f.store.prepareLaunch()).source, 'bundled');
});

test('state corruption and cache links fail closed instead of erasing recovery state', async t => {
  const f = await fixture(t), stateFile = path.join(f.options.cacheDirectory, 'state.json');
  await fs.writeFile(stateFile, '{broken');
  await assert.rejects(f.store.prepareLaunch());
  assert.equal(await fs.readFile(stateFile, 'utf8'), '{broken');
  await fs.rm(stateFile);
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(f.root, 'missing-state'), stateFile);
    await assert.rejects(f.store.prepareLaunch());
    assert.equal((await fs.lstat(stateFile)).isSymbolicLink(), true);
  }
});

test('a different channel cannot borrow cached state or a trusted-key policy', async t => {
  const f = await fixture(t), r = await f.release(1);
  await f.store.stage(r.source, r.envelope);
  const other = await createWebBundleStore({ ...f.options, host: { ...f.options.host, channel: 'stable' } });
  await assert.rejects(other.prepareLaunch(), /state is invalid/);
  assert.equal((await f.store.inspect()).pending.releaseId, r.id);
});
