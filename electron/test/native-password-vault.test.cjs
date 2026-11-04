'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVaultTransport } = require('../lib/native-passwords/vault.cjs');
const { PasswordBridgeStore } = require('../lib/native-passwords/store.cjs');

test('vault negotiation is public and selected-origin bound; POST is pinned to the active proxy', async () => {
  const seen = [], endpoint = 'https://vault.example', origin = 'http://127.0.0.1:28630';
  const session = { fetch: async (url, options) => {
    seen.push([url, options]);
    const value = url.includes('.well-known') ? { schemaVersion: 1, origin: endpoint, features: { 'api.passwords': { version: '1.7.0' } } } : { ok: true, ownerId: 'owner', catalog: [] };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'x-thingtime-api-fallback': endpoint } });
  } };
  const call = createVaultTransport({ context: () => ({ endpoint, origin, session }) });
  await call({ origin: endpoint, ownerId: 'owner' }, { operation: 'catalog' });
  assert.equal(seen[0][0], `${endpoint}/.well-known/thingtime-capabilities.json`); assert.equal(seen[0][1].credentials, 'omit');
  assert.equal(seen[1][0], `${origin}/api/v1/passwords`); assert.equal(seen[1][1].headers['X-Thingtime-Expected-Api-Origin'], endpoint);
  assert.equal(seen[1][1].headers['X-Thingtime-Expected-Actor'], 'owner');
  for (const [, options] of seen) { assert.equal(options.redirect, 'error'); assert.equal(options.bypassCustomProtocolHandlers, true); assert.equal(options.headers?.Cookie, undefined); }
});
test('wrong origins, breaking capabilities, missing proxy proof and changed owner are refused', async () => {
  for (const mode of ['wrong-origin', 'breaking', 'proxy-drift', 'owner-change']) {
    const endpoint = 'https://vault.example', origin = 'http://127.0.0.1:28630'; let calls = 0;
    const session = { fetch: async url => {
      calls++;
      const value = url.includes('.well-known') ? { schemaVersion: 1, origin: mode === 'wrong-origin' ? 'https://other.example' : endpoint, features: { 'api.passwords': { version: mode === 'breaking' ? '2.0.0' : '1.7.0' } } } : { ok: true, ownerId: mode === 'owner-change' ? 'other' : 'owner', catalog: [] };
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'x-thingtime-api-fallback': mode === 'proxy-drift' ? 'https://other.example' : endpoint } });
    } };
    const call = createVaultTransport({ context: () => ({ endpoint, origin, session }) });
    await assert.rejects(call({ origin: endpoint, ownerId: 'owner' }, { operation: 'catalog' }));
    if (['wrong-origin', 'breaking'].includes(mode)) assert.equal(calls, 1, 'Incompatible origins receive no credential operation');
  }
});
test('Linux plaintext/unknown storage is refused even if Electron reports encryption available', () => {
  for (const backend of ['basic_text', 'unknown', '']) {
    const store = new PasswordBridgeStore({ directory: '/unused', platform: 'linux', safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => backend } });
    assert.equal(store.available(), false); assert.throws(() => store.requireAvailable(), { code: 'KEYRING_UNAVAILABLE' });
  }
  const store = new PasswordBridgeStore({ directory: '/unused', platform: 'win32', safeStorage: { isEncryptionAvailable: () => true } }); assert.equal(store.available(), true);
});
