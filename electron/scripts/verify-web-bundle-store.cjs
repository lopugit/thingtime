'use strict';

// Integration fixture for real packaged bytes. This deliberately does not start
// Nitro, access an account, or claim that a synthetic boot acknowledgment is an
// installed application acceptance check.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { signDescriptor } = require('../../native-bundles/release.cjs');
const { createWebBundleStore } = require('../lib/web-bundle-store.cjs');

async function main() {
  const source = path.resolve(__dirname, '../dist/web');
  const built = JSON.parse(await fs.readFile(path.join(source, 'metadata.json'), 'utf8')).nativeBundle;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-real-web-bundle-'));
  const { packageRelease } = await import('../../native-bundles/package-release.mjs');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signer = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const keyId = 'disposable-verification';
  const trustedKeys = [{ keyId, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), channels: ['verification'], platforms: [built.target.platform], runtimes: [built.runtime.id] }];
  const metadata = {
    version: '0.0.1-verification', channel: 'verification', sequence: 1,
    target: built.target,
    runtime: { id: built.runtime.id, nativeAbi: built.runtime.nativeAbi, minShellVersion: built.runtime.shellVersion, maxShellVersion: built.runtime.shellVersion },
    entrypoints: built.entrypoints
  };
  const host = { ...built.target, runtimeId: built.runtime.id, nativeAbi: built.runtime.nativeAbi, shellVersion: built.runtime.shellVersion, channel: 'verification', minimumSequence: 0 };
  let receipt;
  try {
    const output = path.join(temporary, 'published');
    await packageRelease({ source, output, metadata, keyId, privateKey: signer, trustedKeys });
    const ids = await fs.readdir(output);
    assert.equal(ids.length, 1);
    const envelope = JSON.parse(await fs.readFile(path.join(output, ids[0], 'release.json'), 'utf8'));
    const options = { cacheDirectory: path.join(temporary, 'cache'), bundledDirectory: source, trustedKeys, host };
    const store = await createWebBundleStore(options);
    await store.stage(path.join(output, ids[0], 'payload'), envelope);
    await fs.rm(output, { recursive: true });
    const launch = await store.prepareLaunch();
    assert.equal(launch.source, 'trial');
    // Simulate the future host acknowledgment, without importing this API bundle.
    await store.confirmLaunch(launch.releaseId);
    const candidate = signDescriptor({ ...envelope.descriptor, version: '0.0.2-verification', sequence: 2 }, { keyId, privateKey: signer });
    await store.stage(source, candidate);
    assert.equal((await store.prepareLaunch()).source, 'trial');
    const cold = await createWebBundleStore(options);
    const recovered = await cold.prepareLaunch();
    assert.equal(recovered.releaseId, envelope.releaseId);
    assert.equal(recovered.source, 'retained');
    assert.equal((await cold.inspect()).highestSequence, 2);
    receipt = {
      passed: true, observedAt: new Date().toISOString(), source,
      releaseId: envelope.releaseId, rolledBackCandidate: candidate.releaseId,
      fileCount: envelope.descriptor.files.length,
      payloadBytes: envelope.descriptor.files.reduce((sum, file) => sum + file.bytes, 0),
      host, sourcePublicationRemovedBeforeLaunch: true, syntheticSigner: true,
      bootAcknowledgment: 'simulated', serverExecuted: false, installedAppAcceptance: false
    };
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  console.log(JSON.stringify({ ...receipt, temporaryResourcesRemoved: true }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
