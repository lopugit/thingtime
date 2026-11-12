'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { validateTrustPolicy, createElectronBundleHost, assertElectronBundleMetadata } = require('./host.cjs');
const { signDescriptor, verifyEnvelope } = require('./release.cjs');
const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ format: 'pem', type: 'spki' });
function policy() {
  return { format: 1, channel: 'stable', minimumSequence: 8, trustedKeys: [{ keyId: 'publisher-1', publicKeyPem,
    channels: ['stable'], platforms: ['darwin', 'ios'], runtimes: ['electron-node-middleware-v1', 'ios-fixture-v1'] }] };
}
function actual(overrides = {}) {
  return { platform: 'darwin', arch: 'arm64', versions: { electron: '43.1.0', node: '24.18.0', modules: '148' },
    shellVersion: '2.1.0-beta.2+build.07', policy: policy(), ...overrides };
}
function metadata(host) {
  return { nitroPreset: 'node_middleware', gitCommit: 'synthetic', nativeBundle: {
    target: { platform: host.platform, arch: host.arch },
    runtime: { id: host.runtimeId, nativeAbi: host.nativeAbi, shellVersion: '1.0.0' },
    entrypoints: { renderer: '.output/public/index.html', server: '.output/server/index.mjs' }
  } };
}
test('trust policy snapshots and freezes every nested mutable value without mutating its source', () => {
  const input = policy(), saved = structuredClone(input), checked = validateTrustPolicy(input);
  assert.deepEqual(input, saved);
  assert.notEqual(checked, input);
  assert.notEqual(checked.trustedKeys[0], input.trustedKeys[0]);
  input.channel = 'untrusted'; input.trustedKeys[0].channels.push('untrusted'); input.trustedKeys.length = 0;
  assert.equal(checked.channel, 'stable'); assert.deepEqual(checked.trustedKeys[0].channels, ['stable']);
  assert.throws(() => checked.trustedKeys[0].channels.push('untrusted'), TypeError);
  assert.throws(() => { checked.trustedKeys[0].publicKeyPem = ''; }, TypeError);
  assert.throws(() => { checked.minimumSequence = 0; }, TypeError);
  assert.deepEqual(validateTrustPolicy(checked), checked);
});
test('strict policy rejects private keys, wrong algorithms, duplicate IDs and malformed scope', () => {
  const bad = [];
  const privatePem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'pem', type: 'spki' });
  for (const publicKeyPem of [privatePem, rsa, 'not a public key', policy().trustedKeys[0].publicKeyPem + privatePem]) {
    const p = policy(); p.trustedKeys[0].publicKeyPem = publicKeyPem; bad.push(p);
  }
  const sparse = policy(); sparse.trustedKeys = new Array(1); bad.push(sparse);
  const sparseScope = policy(); sparseScope.trustedKeys[0].channels = new Array(1); bad.push(sparseScope);
  const extraScope = policy(); extraScope.trustedKeys[0].channels.extra = true; bad.push(extraScope);
  const duplicate = policy(); duplicate.trustedKeys.push(structuredClone(duplicate.trustedKeys[0])); bad.push(duplicate);
  for (const patch of [{ channels: [] }, { channels: ['*'] }, { channels: ['stable\n'] }, { platforms: ['unknown'] }, { runtimes: ['runtime', 'runtime'] }, { keyId: '../publisher' }, { extra: true }]) {
    const p = policy(); Object.assign(p.trustedKeys[0], patch); bad.push(p);
  }
  for (const patch of [{ format: 2 }, { format: '1' }, { minimumSequence: -1 }, { minimumSequence: 1.1 }, { minimumSequence: Number.MAX_SAFE_INTEGER + 1 },
    { minimumSequence: '8' }, { channel: '' }, { trustedKeys: null }, { extra: true }]) bad.push({ ...policy(), ...patch });
  for (const invalid of bad) assert.throws(() => validateTrustPolicy(invalid));
});
test('empty shipped trust policy permits offline hosting but authorizes no downloaded release', () => {
  const input = { format: 1, channel: 'stable', minimumSequence: 0, trustedKeys: [] };
  const checked = validateTrustPolicy(input), host = createElectronBundleHost(actual({ policy: input, shellVersion: '2.0.0' }));
  const descriptor = { version: '2.0.0', channel: 'stable', sequence: 1, target: { platform: host.platform, arch: host.arch },
    runtime: { id: host.runtimeId, nativeAbi: host.nativeAbi, minShellVersion: '2.0.0', maxShellVersion: '3.0.0' },
    entrypoints: { renderer: 'index.html' }, files: [{ path: 'index.html', bytes: 0, sha256: '0'.repeat(64) }] };
  const envelope = signDescriptor(descriptor, { keyId: 'publisher-1', privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }) });
  assert.throws(() => verifyEnvelope(envelope, { trustedKeys: checked.trustedKeys, host }), /untrusted/);
});
test('host identity binds actual Electron runtime and shell version to independently validated shipped policy', () => {
  const input = actual(), host = createElectronBundleHost(input);
  assert.deepEqual(host, { platform: 'darwin', arch: 'arm64', runtimeId: 'electron-node-middleware-v1', nativeAbi: 'electron-43.1.0-node-24.18.0-modules-148',
    shellVersion: '2.1.0-beta.2+build.07', channel: 'stable', minimumSequence: 8 });
  input.policy.minimumSequence = 0; input.versions.modules = '999';
  assert.equal(host.minimumSequence, 8); assert.match(host.nativeAbi, /modules-148$/);
  assert.throws(() => { host.nativeAbi = 'caller-changed'; }, TypeError);
  for (const override of [{ platform: 'ios' }, { arch: 'ia32' }, { versions: { node: '24.18.0', modules: '148' } },
    { versions: { electron: '43.1.0', node: '24.18.0', modules: '148\n' } }, { versions: { electron: '43.1.0', node: '24.18.0', modules: '0148' } },
    { versions: { electron: '43.1.0', node: '24.18', modules: '148' } }, { shellVersion: '2.0.0-01' }]) assert.throws(() => createElectronBundleHost(actual(override)));
});
test('packaged metadata fixes server entrypoints and runtime while allowing signed compatible shell-version changes', () => {
  const host = createElectronBundleHost(actual()), built = metadata(host);
  assert.equal(assertElectronBundleMetadata(built, host), true);
  for (const change of [m => { m.nitroPreset = 'node-server'; }, m => { m.nativeBundle.target.platform = 'ios'; },
    m => { m.nativeBundle.target.arch = 'x64'; }, m => { m.nativeBundle.runtime.id = 'node-mobile'; },
    m => { m.nativeBundle.runtime.nativeAbi = 'electron-43.1.0-node-24.18.0-modules-999'; },
    m => { m.nativeBundle.entrypoints.renderer = '../remote.html'; }, m => { m.nativeBundle.entrypoints.server = '.output/server/other.mjs'; },
    m => { m.nativeBundle.entrypoints.extra = 'alternate.mjs'; }, m => { m.nativeBundle.runtime.shellVersion = 'bad'; }]) {
    const changed = structuredClone(built); change(changed); assert.throws(() => assertElectronBundleMetadata(changed, host));
  }
  assert.equal(built.nativeBundle.runtime.shellVersion, '1.0.0');
  assert.equal(host.shellVersion, '2.1.0-beta.2+build.07');
});
