'use strict';
const { createHash } = require('node:crypto');

const VERSION = '1.0.0';
const METHODS = Object.freeze(['manifest', 'status', 'authorize', 'catalog', 'generate', 'open-browser', 'fill', 'unlock-keyring', 'release']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class PasswordBridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new PasswordBridgeError(code, message); };
function exactOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('INVALID_SCOPE', 'Choose an exact website origin.'); }
  if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) fail('INVALID_SCOPE', 'Use HTTPS or an explicit loopback test origin.');
  return url.origin;
}
function targetScope(value, platform = process.platform) {
  if (value?.kind === 'website' && value.origin?.startsWith('https://')) return { kind: 'website', origin: exactOrigin(value.origin) };
  if (value?.kind === 'local-app' && value.id === 'org.gnome.keyring' && platform === 'linux') return { kind: 'local-app', id: value.id };
  fail('UNSUPPORTED_TARGET', 'This target has no supported direct credential consumer.');
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const identity = userData => createHash('sha256').update(userData).digest('hex').slice(0, 24);
function manifest(userData, platform = process.platform) {
  return { schemaVersion: 1, origin: `thingtime-desktop://${identity(userData)}`, features: {
    'native.passwords': { version: VERSION, methods: METHODS },
  }, platform, capabilities: { browserAutofill: ['linux', 'win32'].includes(platform), systemAutofill: false, passkeys: false, rawCredentialRetrieval: false,
    localConsumers: platform === 'linux' ? ['org.gnome.keyring'] : [] } };
}
function field(entry, id, types) {
  return entry?.fields?.find(f => f.id === id && types.includes(f.type) && f.structured !== true)?.value;
}
function entryMatches(entry, target) {
  if (!entry || !['login', 'password', 'email-account'].includes(entry.passwordType) || typeof field(entry, 'password', ['password']) !== 'string') return false;
  if (target.kind === 'local-app') return field(entry, 'native-consumer', ['text']) === target.id;
  return entry.fields.some(f => {
    if (f.type !== 'url' || f.structured || f.concealed || typeof f.value !== 'string' || /[\s\\]/u.test(f.value) || f.value.startsWith('//')) return false;
    try { const url = new URL(f.value.includes('://') ? f.value : `https://${f.value}`); return url.protocol === 'https:' && !url.username && !url.password && !url.hostname.includes('*') && url.origin === target.origin; } catch { return false; }
  });
}
module.exports = { VERSION, METHODS, UUID, PasswordBridgeError, fail, exactOrigin, targetScope, same, identity, manifest, field, entryMatches };
