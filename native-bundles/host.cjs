'use strict';
const { createPublicKey } = require('node:crypto');
const { parseVersion } = require('./release.cjs');
const RUNTIME_ID = 'electron-node-middleware-v1';
const ENTRYPOINTS = Object.freeze({ renderer: '.output/public/index.html', server: '.output/server/index.mjs' });
const PLATFORMS = ['darwin', 'linux', 'win32', 'ios'];
function reject(reason) { throw new Error(`Native bundle host rejected: ${reason}`); }
function strictObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string') ||
      Object.getOwnPropertyNames(value).sort().join(',') !== [...fields].sort().join(',')) reject('invalid policy or metadata fields');
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]/.test(value) || /[^A-Za-z0-9._-]/.test(value)) reject('invalid identifier');
  return value;
}
function array(value) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1) reject('invalid policy array');
  return value;
}
function scope(value, allowed) {
  array(value);
  if (!value.length) reject('empty or invalid signing scope');
  const result = value.map(entry => identifier(entry));
  if (new Set(result).size !== result.length || (allowed && result.some(entry => !allowed.includes(entry)))) reject('invalid or duplicated signing scope');
  return Object.freeze(result);
}
function publicKey(value) {
  // createPublicKey also accepts private keys; reject that input before parsing.
  if (typeof value !== 'string') reject('signing policy requires a public PEM');
  const pem = value.trim();
  const match = /^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.exec(pem);
  if (!match || match[0] !== pem) reject('signing policy requires a public-only PEM');
  let key;
  try { key = createPublicKey({ key: pem, type: 'spki', format: 'pem' }); }
  catch { reject('invalid signing public key'); }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') reject('signing policy requires Ed25519');
  return key.export({ format: 'pem', type: 'spki' });
}
function validateTrustPolicy(value) {
  strictObject(value, ['format', 'channel', 'minimumSequence', 'trustedKeys']);
  if (value.format !== 1 || !Number.isSafeInteger(value.minimumSequence) || value.minimumSequence < 0 || !Array.isArray(value.trustedKeys)) reject('invalid trust policy');
  array(value.trustedKeys);
  const channel = identifier(value.channel);
  const seen = new Set();
  const trustedKeys = value.trustedKeys.map(entry => {
    strictObject(entry, ['keyId', 'publicKeyPem', 'channels', 'platforms', 'runtimes']);
    const keyId = identifier(entry.keyId);
    if (seen.has(keyId)) reject('duplicate signing key ID');
    seen.add(keyId);
    return Object.freeze({ keyId, publicKeyPem: publicKey(entry.publicKeyPem), channels: scope(entry.channels),
      platforms: scope(entry.platforms, PLATFORMS), runtimes: scope(entry.runtimes) });
  });
  return Object.freeze({ format: 1, channel, minimumSequence: value.minimumSequence, trustedKeys: Object.freeze(trustedKeys) });
}
function createElectronBundleHost({ platform, arch, versions, shellVersion, policy }) {
  const checked = validateTrustPolicy(policy);
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) reject('unsupported Electron target');
  parseVersion(shellVersion);
  parseVersion(versions?.electron);
  parseVersion(versions?.node);
  if (typeof versions?.modules !== 'string' || !/^(0|[1-9][0-9]*)$/.test(versions.modules) || /[^0-9]/.test(versions.modules)) reject('missing or invalid actual Electron ABI');
  const nativeAbi = identifier(`electron-${versions.electron}-node-${versions.node}-modules-${versions.modules}`);
  return Object.freeze({ platform, arch, runtimeId: RUNTIME_ID, nativeAbi, shellVersion,
    channel: checked.channel, minimumSequence: checked.minimumSequence });
}
function assertElectronBundleMetadata(metadata, host) {
  if (metadata?.nitroPreset !== 'node_middleware' || !metadata.nativeBundle || host?.runtimeId !== RUNTIME_ID ||
      !['darwin', 'linux', 'win32'].includes(host.platform) || !['arm64', 'x64'].includes(host.arch)) reject('incompatible Electron server metadata');
  const bundle = metadata.nativeBundle;
  strictObject(bundle, ['target', 'runtime', 'entrypoints']);
  strictObject(bundle.target, ['platform', 'arch']);
  strictObject(bundle.runtime, ['id', 'nativeAbi', 'shellVersion']);
  strictObject(bundle.entrypoints, ['renderer', 'server']);
  parseVersion(bundle.runtime.shellVersion);
  if (bundle.target.platform !== host.platform || bundle.target.arch !== host.arch || bundle.runtime.id !== host.runtimeId ||
      bundle.runtime.nativeAbi !== host.nativeAbi || bundle.entrypoints.renderer !== ENTRYPOINTS.renderer || bundle.entrypoints.server !== ENTRYPOINTS.server) reject('incompatible Electron target, runtime or entrypoints');
  // A compatible downloaded release may have been built by another shell
  // version. Its verified signed descriptor supplies the accepted shell range.
  return true;
}
module.exports = { validateTrustPolicy, createElectronBundleHost, assertElectronBundleMetadata };
