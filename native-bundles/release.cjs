'use strict';
// Portable JSON contract. Native hosts must implement these same canonical bytes
// and pin trust policy in their shipped shell, never in a downloaded release.
const { createHash, createPrivateKey, createPublicKey, sign, verify } = require('node:crypto');
const FORMAT = 1;
const DOMAIN = 'thingtime.native-web-bundle.v1\n';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
function fail(reason) { throw new Error(`Native bundle rejected: ${reason}`); }
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('invalid contract fields');
}
function identifier(value) { if (typeof value !== 'string' || !ID.test(value)) fail('invalid identifier'); }
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  fail('noncanonical JSON');
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function safePath(value) {
  // The same path must mean the same thing on Windows, POSIX, ZIP and URLs.
  if (typeof value !== 'string' || !value || value.includes('\\') || value.split('/').some(part =>
    !/^[\x20-\x7e]+$/.test(part) || /[<>:\"\\|?*%]/.test(part) || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('unsafe file path');
  if (value.split('/').some(part => /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.npmrc|\.netrc|\.local(?:-state)?|\.DS_Store|id_(?:rsa|ed25519)|credentials(?:\.json)?|.*\.(?:p8|key|sqlite|sqlite3|db))$/i.test(part))) fail('private state is not a release asset');
  return value;
}
function parseVersion(value) {
  const match = typeof value === 'string' && VERSION.exec(value);
  if (!match || match[0] !== value) fail('invalid semantic version');
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) fail('invalid semantic version');
  return { core: match.slice(1, 4), prerelease };
}
function numericCompare(left, right) {
  // SemVer integers have no precision limit. Compare their decimal spellings
  // without converting to a lossy JavaScript Number.
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}
function compareVersion(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const compared = numericCompare(left.core[i], right.core[i]);
    if (compared) return compared;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const l = left.prerelease[i], r = right.prerelease[i];
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l), rn = /^\d+$/.test(r);
    return ln && rn ? numericCompare(l, r) : ln !== rn ? ln ? -1 : 1 : l < r ? -1 : 1;
  }
  return 0;
}
function validateDescriptor(descriptor) {
  object(descriptor, ['version', 'channel', 'sequence', 'target', 'runtime', 'entrypoints', 'files']);
  parseVersion(descriptor.version); identifier(descriptor.channel);
  if (!Number.isSafeInteger(descriptor.sequence) || descriptor.sequence < 1) fail('invalid release sequence');
  object(descriptor.target, ['platform', 'arch']);
  if (!['darwin', 'linux', 'win32', 'ios'].includes(descriptor.target.platform) || !['arm64', 'x64'].includes(descriptor.target.arch)) fail('unsupported target');
  object(descriptor.runtime, ['id', 'nativeAbi', 'minShellVersion', 'maxShellVersion']);
  identifier(descriptor.runtime.id); identifier(descriptor.runtime.nativeAbi);
  if (compareVersion(descriptor.runtime.minShellVersion, descriptor.runtime.maxShellVersion) > 0) fail('inverted shell range');
  const entryKeys = descriptor.entrypoints && Object.keys(descriptor.entrypoints).sort().join(',');
  if (entryKeys !== 'renderer' && entryKeys !== 'renderer,server') fail('invalid entrypoints');
  for (const entry of Object.values(descriptor.entrypoints)) safePath(entry);
  if (!Array.isArray(descriptor.files) || !descriptor.files.length) fail('empty file inventory');
  let previous = '';
  const paths = new Set();
  const spelling = new Map();
  const filePaths = new Set(descriptor.files.map(file => file?.path));
  for (const file of descriptor.files) {
    object(file, ['path', 'bytes', 'sha256']); safePath(file.path);
    if (file.path <= previous || paths.has(file.path.toLowerCase())) fail('unordered or colliding file inventory');
    previous = file.path; paths.add(file.path.toLowerCase());
    const parts = file.path.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), folded = prefix.toLowerCase();
      if ((spelling.has(folded) && spelling.get(folded) !== prefix) || (i < parts.length && filePaths.has(prefix))) fail('colliding file paths');
      spelling.set(folded, prefix);
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || typeof file.sha256 !== 'string' || !HASH.test(file.sha256)) fail('invalid file integrity');
  }
  for (const entry of Object.values(descriptor.entrypoints)) if (!descriptor.files.some(file => file.path === entry)) fail('missing entrypoint');
  return descriptor;
}
function releaseId(descriptor) { validateDescriptor(descriptor); return sha256(canonical(descriptor)); }
function signingBytes(envelope) {
  return Buffer.from(DOMAIN + canonical({ format: envelope.format, keyId: envelope.keyId, releaseId: envelope.releaseId, descriptor: envelope.descriptor }), 'utf8');
}
function signDescriptor(descriptor, { keyId, privateKey }) {
  identifier(keyId);
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') fail('signer must use Ed25519');
  const envelope = { format: FORMAT, keyId, releaseId: releaseId(descriptor), descriptor };
  return { ...envelope, signature: sign(null, signingBytes(envelope), key).toString('base64') };
}
function assertCompatible(descriptor, host) {
  validateDescriptor(descriptor);
  object(host, ['platform', 'arch', 'runtimeId', 'nativeAbi', 'shellVersion', 'channel', 'minimumSequence']);
  if (!Number.isSafeInteger(host.minimumSequence) || host.minimumSequence < 0) fail('invalid rollback floor');
  if (descriptor.target.platform !== host.platform || descriptor.target.arch !== host.arch || descriptor.runtime.id !== host.runtimeId || descriptor.runtime.nativeAbi !== host.nativeAbi) fail('incompatible target or runtime ABI');
  if (descriptor.channel !== host.channel || descriptor.sequence < host.minimumSequence) fail('channel or rollback floor mismatch');
  if (compareVersion(host.shellVersion, descriptor.runtime.minShellVersion) < 0 || compareVersion(host.shellVersion, descriptor.runtime.maxShellVersion) > 0) fail('native shell upgrade required');
  return descriptor;
}
function verifyEnvelope(envelope, { trustedKeys, host }) {
  object(envelope, ['format', 'keyId', 'releaseId', 'descriptor', 'signature']);
  if (envelope.format !== FORMAT) fail('unsupported format');
  identifier(envelope.keyId);
  if (envelope.releaseId !== releaseId(envelope.descriptor)) fail('descriptor digest mismatch');
  if (typeof envelope.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) fail('invalid signature encoding');
  const trusted = trustedKeys?.find(key => key.keyId === envelope.keyId);
  if (!trusted || !trusted.channels?.includes(envelope.descriptor.channel) || !trusted.platforms?.includes(envelope.descriptor.target.platform) || !trusted.runtimes?.includes(envelope.descriptor.runtime.id)) fail('untrusted signing key or scope');
  const key = createPublicKey(trusted.publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, signingBytes(envelope), key, Buffer.from(envelope.signature, 'base64'))) fail('signature verification failed');
  assertCompatible(envelope.descriptor, host);
  return JSON.parse(canonical(envelope.descriptor));
}
module.exports = { FORMAT, DOMAIN, canonical, sha256, safePath, parseVersion, compareVersion, validateDescriptor, releaseId, signDescriptor, assertCompatible, verifyEnvelope };
