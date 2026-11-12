'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const contract = require('./release.cjs');
const { inventoryDirectory, verifyDirectory } = require('./inventory.cjs');
const keys = generateKeyPairSync('ed25519');
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const trustedKeys = [{ keyId: 'fixture-2026', publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }), channels: ['development'], platforms: ['darwin'], runtimes: ['electron-node-middleware-v1'] }];
const host = { platform: 'darwin', arch: 'arm64', runtimeId: 'electron-node-middleware-v1', nativeAbi: 'electron-fixture-modules-140', shellVersion: '1.2.3', channel: 'development', minimumSequence: 10 };
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-web-release-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  await fs.mkdir(path.join(source, '.output/public'), { recursive: true });
  await fs.mkdir(path.join(source, '.output/server'), { recursive: true });
  await fs.writeFile(path.join(source, '.output/public/index.html'), '<div id="root"></div>');
  await fs.writeFile(path.join(source, '.output/server/index.mjs'), 'export const handler = () => "fixture";');
  const metadata = { version: '1.0.0', channel: 'development', sequence: 10, target: { platform: host.platform, arch: host.arch },
    runtime: { id: host.runtimeId, nativeAbi: host.nativeAbi, minShellVersion: '1.2.0', maxShellVersion: '1.3.0' },
    entrypoints: { renderer: '.output/public/index.html', server: '.output/server/index.mjs' } };
  await fs.writeFile(path.join(source, 'metadata.json'), JSON.stringify({ nativeBundle: { target: metadata.target, entrypoints: metadata.entrypoints,
    runtime: { id: host.runtimeId, nativeAbi: host.nativeAbi, shellVersion: host.shellVersion } } }));
  await fs.writeFile(path.join(source, '.output/public/Group 100.png'), 'image fixture');
  const descriptor = { ...metadata, files: await inventoryDirectory(source) };
  const envelope = contract.signDescriptor(descriptor, { keyId: 'fixture-2026', privateKey });
  return { directory, source, metadata, descriptor, envelope };
}
function verify(envelope, overrides = {}) { return contract.verifyEnvelope(envelope, { trustedKeys, host: { ...host, ...overrides } }); }
test('independent signature binds content, key identity, sequence and target', async t => {
  const f = await fixture(t);
  assert.deepEqual(verify(f.envelope), f.descriptor);
  const tampered = structuredClone(f.envelope); tampered.descriptor.sequence++;
  tampered.releaseId = contract.releaseId(tampered.descriptor);
  assert.throws(() => verify(tampered), /signature verification/);
  const wrongSigner = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => verify(contract.signDescriptor(f.descriptor, { keyId: 'fixture-2026', privateKey: wrongSigner })), /signature verification/);
  assert.throws(() => verify({ ...f.envelope, keyId: 'untrusted' }), /untrusted/);
  assert.throws(() => contract.verifyEnvelope(f.envelope, { trustedKeys: [{ ...trustedKeys[0], platforms: ['ios'] }], host }), /scope/);
  assert.throws(() => verify({ ...f.envelope, publicKey: trustedKeys[0].publicKeyPem }), /contract fields/);
});
test('native shell, runtime ABI, target and persisted rollback floor fail closed', async t => {
  const f = await fixture(t);
  for (const override of [{ platform: 'ios' }, { arch: 'x64' }, { runtimeId: 'node-mobile' }, { nativeAbi: 'modules-999' }, { channel: 'stable' },
    { shellVersion: '1.1.99' }, { shellVersion: '1.3.1' }, { minimumSequence: 11 }]) assert.throws(() => verify(f.envelope, override));
  assert.deepEqual(verify(f.envelope, { shellVersion: '1.2.0' }), f.descriptor);
  assert.deepEqual(verify(f.envelope, { shellVersion: '1.3.0' }), f.descriptor);
});
test('full payload verification refuses partial files, extra executables and tampering', async t => {
  const f = await fixture(t);
  assert.equal(await verifyDirectory(f.source, verify(f.envelope)), true);
  const server = path.join(f.source, '.output/server/index.mjs');
  await fs.writeFile(server, 'export const handler = () => "changed";');
  await assert.rejects(verifyDirectory(f.source, f.descriptor), /inventory mismatch/);
  await fs.rm(server);
  await assert.rejects(verifyDirectory(f.source, f.descriptor), /inventory mismatch/);
  await fs.writeFile(server, 'export const handler = () => "fixture";');
  await fs.writeFile(path.join(f.source, '.output/server/extra.mjs'), 'throw 1');
  await assert.rejects(verifyDirectory(f.source, f.descriptor), /inventory mismatch/);
});
test('portable paths reject traversal, volume escapes, aliases and private state', async t => {
  const f = await fixture(t);
  for (const bad of ['../file', '/tmp/file', 'C:/file', 'a\\b', 'a//b', 'a/./b', 'a/%2e%2e/b', 'con.txt', 'a/nul', 'a/file.', '.env', 'a/.env.production', 'a/owner.key', '.git/HEAD', 'state.sqlite']) {
    assert.throws(() => contract.safePath(bad), undefined, bad);
  }
  const collision = structuredClone(f.descriptor);
  collision.files = [{ path: 'A/a', bytes: 0, sha256: '0'.repeat(64) }, { path: 'a/b', bytes: 0, sha256: '0'.repeat(64) }];
  assert.throws(() => contract.validateDescriptor(collision), /colliding/);
  await fs.writeFile(path.join(f.source, '.env'), 'synthetic secret');
  await assert.rejects(inventoryDirectory(f.source), /private state/);
});
test('symlink files, directories and special files are never release payload', async t => {
  const f = await fixture(t);
  await fs.symlink(path.join(f.directory, 'outside'), path.join(f.source, 'escaped'));
  await assert.rejects(inventoryDirectory(f.source), /symbolic link/);
  await fs.rm(path.join(f.source, 'escaped'));
  await fs.symlink(f.directory, path.join(f.source, 'directory-link'));
  await assert.rejects(inventoryDirectory(f.source), /symbolic link/);
  await fs.rm(path.join(f.source, 'directory-link'));
  if (process.platform !== 'win32') {
    assert.equal(spawnSync('mkfifo', [path.join(f.source, 'pipe')]).status, 0);
    await assert.rejects(inventoryDirectory(f.source), /nonregular/);
  }
});
test('packager snapshots actual staged renderer/server deterministically and verifies reused release', async t => {
  const f = await fixture(t);
  const { packageRelease } = await import(pathToFileURL(path.join(__dirname, 'package-release.mjs')));
  const options = { source: f.source, output: path.join(f.directory, 'releases'), metadata: f.metadata, keyId: 'fixture-2026', privateKey, trustedKeys };
  const first = await packageRelease(options), second = await packageRelease(options);
  assert.deepEqual(first, second);
  const packed = JSON.parse(await fs.readFile(path.join(first.directory, 'release.json'), 'utf8'));
  assert.equal(await verifyDirectory(path.join(first.directory, 'payload'), verify(packed)), true);
  await fs.writeFile(path.join(first.directory, 'payload/.output/server/index.mjs'), 'corrupt');
  await assert.rejects(packageRelease(options), /inventory mismatch/);
});
test('packager refuses mismatched real build ABI and missing or out-of-scope signing authority', async t => {
  const f = await fixture(t);
  const { packageRelease } = await import(pathToFileURL(path.join(__dirname, 'package-release.mjs')));
  const options = { source: f.source, output: path.join(f.directory, 'releases'), metadata: f.metadata, keyId: 'fixture-2026', privateKey, trustedKeys };
  await assert.rejects(packageRelease({ ...options, metadata: { ...f.metadata, target: { platform: 'ios', arch: 'arm64' } } }), /actual build/);
  await assert.rejects(packageRelease({ ...options, privateKey: undefined }));
  await assert.rejects(packageRelease({ ...options, trustedKeys: [] }), /untrusted/);
  await assert.rejects(fs.stat(options.output), { code: 'ENOENT' });
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'package-release.mjs')], { encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /packaging failed/);
});

test('release CLI accepts only a protected stdin signer and emits no key material', async t => {
  const f = await fixture(t);
  const metadataFile = path.join(f.directory, 'release-metadata.json'), trustFile = path.join(f.directory, 'trusted-public-keys.json');
  await fs.writeFile(metadataFile, JSON.stringify(f.metadata));
  await fs.writeFile(trustFile, JSON.stringify(trustedKeys));
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'package-release.mjs'), '--source', f.source, '--output', path.join(f.directory, 'cli-releases'),
    '--metadata', metadataFile, '--key-id', 'fixture-2026', '--trusted-keys', trustFile, '--signing-key-stdin'], { encoding: 'utf8', input: privateKey });
  assert.equal(cli.status, 0, cli.stderr);
  const receipt = JSON.parse(cli.stdout);
  assert.equal(receipt.releaseId, f.envelope.releaseId);
  assert.equal(cli.stdout.includes('PRIVATE KEY'), false);
  assert.equal(cli.stderr, '');
});
test('signature bytes match an independently specified canonical envelope', () => {
  const descriptor = { version: '1.0.0', channel: 'dev', sequence: 1, target: { platform: 'ios', arch: 'arm64' },
    runtime: { id: 'fixture', nativeAbi: '1', minShellVersion: '1.0.0', maxShellVersion: '1.0.0' },
    entrypoints: { renderer: 'index.html' }, files: [{ path: 'index.html', bytes: 0, sha256: '0'.repeat(64) }] };
  const expectedDescriptor = '{"channel":"dev","entrypoints":{"renderer":"index.html"},"files":[{"bytes":0,"path":"index.html","sha256":"' + '0'.repeat(64) + '"}],"runtime":{"id":"fixture","maxShellVersion":"1.0.0","minShellVersion":"1.0.0","nativeAbi":"1"},"sequence":1,"target":{"arch":"arm64","platform":"ios"},"version":"1.0.0"}';
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(expectedDescriptor).digest('hex');
  const envelope = contract.signDescriptor(descriptor, { keyId: 'fixture', privateKey });
  assert.equal(envelope.releaseId, digest);
  const expected = 'thingtime.native-web-bundle.v1\n{"descriptor":' + expectedDescriptor + ',"format":1,"keyId":"fixture","releaseId":"' + digest + '"}';
  assert.equal(crypto.verify(null, Buffer.from(expected), keys.publicKey, Buffer.from(envelope.signature, 'base64')), true);
});

test('regular-file to FIFO substitution cannot hang verification', { skip: process.platform === 'win32' }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-inventory-race-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'victim.mjs'), 'regular before lstat');
  const script = `
    const fs = require('node:fs/promises');
    const sync = require('node:fs');
    const path = require('node:path');
    const { spawnSync } = require('node:child_process');
    const { inventoryDirectory } = require(${JSON.stringify(path.join(__dirname, 'inventory.cjs'))});
    const root = process.argv[1], victim = path.join(root, 'victim.mjs');
    const originalOpen = fs.open;
    fs.open = async (location, flags) => {
      if (location === victim) {
        // Deterministic substitution precisely after inventory's successful
        // regular-file lstat and before its actual OS open call.
        sync.unlinkSync(victim);
        if (spawnSync('mkfifo', [victim]).status !== 0) throw new Error('fixture FIFO setup failed');
      }
      return originalOpen(location, flags);
    };
    inventoryDirectory(root).then(() => process.exit(2), error => {
      if (!/changed during verification/.test(error.message)) { console.error(error.message); process.exit(3); }
    });
  `;
  // The previous blocking open is killed by the parent deadline; it cannot
  // wedge the test runner or require a writer to make the regression finish.
  const child = spawnSync(process.execPath, ['-e', script, directory], { encoding: 'utf8', timeout: 3000 });
  assert.notEqual(child.error?.code, 'ETIMEDOUT', 'inventory blocked opening a substituted FIFO');
  assert.equal(child.status, 0, child.stderr);
});
test('SemVer precedence covers prereleases, numeric identifiers and ignored build metadata', () => {
  // Standard precedence chain, extended past Number.MAX_SAFE_INTEGER.
  const ascending = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0', '9007199254740992.0.0', '9007199254740993.0.0'];
  for (let i = 0; i < ascending.length - 1; i++) {
    assert.equal(contract.compareVersion(ascending[i], ascending[i + 1]), -1);
    assert.equal(contract.compareVersion(ascending[i + 1], ascending[i]), 1);
  }
  assert.equal(contract.compareVersion('1.2.3-1', '1.2.3-a'), -1);
  assert.equal(contract.compareVersion('1.2.3-9007199254740992', '1.2.3-9007199254740993'), -1);
  assert.equal(contract.compareVersion('1.2.3-beta.1+build.001', '1.2.3-beta.1+different.999'), 0);
  assert.equal(contract.compareVersion('1.2.3+001', '1.2.3'), 0);
  for (const invalid of ['01.0.0', '1.01.0', '1.0.01', '1.0', 'v1.0.0', '1.0.0-', '1.0.0-alpha..1', '1.0.0-01', '1.0.0-alpha.01', '1.0.0+', '1.0.0+build..1', '1.0.0\n']) {
    assert.throws(() => contract.compareVersion(invalid, '1.0.0'), /semantic version/, invalid);
  }
});
test('prerelease shells retain their exact compatibility boundaries', async t => {
  const f = await fixture(t);
  const descriptor = { ...f.descriptor, version: '1.4.0-beta.2.unsigned+build.007', runtime: { ...f.descriptor.runtime, minShellVersion: '1.4.0-beta.2', maxShellVersion: '1.4.0-rc.1' } };
  const envelope = contract.signDescriptor(descriptor, { keyId: 'fixture-2026', privateKey });
  assert.deepEqual(verify(envelope, { shellVersion: '1.4.0-beta.2.unsigned+build.007' }), descriptor);
  assert.deepEqual(verify(envelope, { shellVersion: '1.4.0-beta.2+different-build' }), descriptor);
  assert.throws(() => verify(envelope, { shellVersion: '1.4.0-beta.1' }), /shell upgrade/);
  assert.throws(() => verify(envelope, { shellVersion: '1.4.0' }), /shell upgrade/);
  assert.throws(() => verify(f.envelope, { shellVersion: '1.2.0-beta.1' }), /shell upgrade/);
});
