'use strict';

// Main-process host capability only. Never exposed through renderer IPC.
const crypto = require('node:crypto');
const path = require('node:path');
const HOST_SYMBOL = Symbol.for('thingtime.native.home-profile.v1');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function secret(value) {
 if (typeof value !== 'string') throw Error('Protected native profile keys are unavailable.');
 const bytes = Buffer.from(value, 'base64url');
 if (bytes.length !== 32 || bytes.toString('base64url') !== value) throw Error('Protected native profile keys are unavailable.');
 return bytes;
}
function checkedFile(root, file) {
 if (!path.isAbsolute(root) || root !== path.resolve(root) || typeof file !== 'string' || file !== path.resolve(file) ||
  path.dirname(file) !== root || !/^[a-z0-9][a-z0-9._-]*\.sqlite$/i.test(path.basename(file)))
  throw Error('Native SQLite must use an explicit file inside this protected profile.');
 return file;
}
function binding(state, root, profile) {
 const jwt = secret(state.jwtSecret), vault = secret(state.vaultKey), outbox = secret(profile.outboxKey);
 try { return crypto.createHmac('sha256', vault).update('thingtime-native-home-profile-v1\0').update(JSON.stringify([
  root, profile.sqliteFile, profile.profileId, profile.keyId, jwt.toString('base64url'), outbox.toString('base64url')
 ])).digest('hex'); }
 finally { jwt.fill(0); vault.fill(0); outbox.fill(0); }
}
function validateNativeHomeProfile(state, root) {
 const profile = state.nativeHome;
 if (!profile || profile.format !== 1 || profile.provider !== 'sqlite' || !uuid(profile.profileId) || !uuid(profile.keyId) ||
  Object.keys(profile).some(key => !['format','provider','profileId','keyId','sqliteFile','outboxKey','binding'].includes(key)))
  throw Error('Protected native profile selection is invalid.');
 checkedFile(root, profile.sqliteFile);
 const expected = binding(state, root, profile);
 if (typeof profile.binding !== 'string' || !/^[a-f0-9]{64}$/.test(profile.binding) ||
  !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(profile.binding))) throw Error('Protected native profile identity changed.');
 return profile;
}
function createNativeHomeProfile(state, root, sqliteFile) {
 checkedFile(root, sqliteFile);
 if (state.nativeHome) {
  const existing = validateNativeHomeProfile(state, root);
  if (existing.sqliteFile !== sqliteFile) throw Error('A protected native profile keeps its selected file.');
  return { ...existing };
 }
 const profile = { format: 1, provider: 'sqlite', profileId: crypto.randomUUID(), keyId: crypto.randomUUID(), sqliteFile,
  outboxKey: crypto.randomBytes(32).toString('base64url') };
 return { ...profile, binding: binding(state, root, profile) };
}
function nativeHomeHost(state, root, origin) {
 const profile = validateNativeHomeProfile(state, root);
 const url = new URL(origin);
 if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port)
  throw Error('Native account storage requires its explicit loopback origin.');
 const jwt = state.jwtSecret, vault = state.vaultKey, outbox = profile.outboxKey;
 const result = { format: 1, provider: 'sqlite', profileId: profile.profileId, homePlaneId: 'native-sqlite:' + profile.profileId,
  origin, sqliteFile: profile.sqliteFile, keyId: profile.keyId };
 Object.defineProperty(result, 'protectedKeys', { enumerable: false, value: () => ({ jwt: secret(jwt), vault: secret(vault), outbox: secret(outbox) }) });
 return Object.freeze(result);
}
function publishNativeHomeHost(host, configuration) {
 if (Object.getOwnPropertyDescriptor(host, HOST_SYMBOL)) throw Error('Native home host selection is already installed. Restart to change profiles.');
 if (!configuration) return;
 Object.defineProperty(host, HOST_SYMBOL, { enumerable: false, configurable: false, writable: false, value: configuration });
}
module.exports = { HOST_SYMBOL, createNativeHomeProfile, validateNativeHomeProfile, nativeHomeHost, publishNativeHomeHost };
