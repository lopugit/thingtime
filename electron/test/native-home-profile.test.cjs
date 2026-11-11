'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { HOST_SYMBOL, createNativeHomeProfile, validateNativeHomeProfile, nativeHomeHost, publishNativeHomeHost } = require('../lib/native-home-profile.cjs');
const state = () => ({ jwtSecret: crypto.randomBytes(32).toString('base64url'), vaultKey: crypto.randomBytes(32).toString('base64url') });
const root = path.resolve('/tmp/task-native-profile/local-runtime');
test('profile creation and reopen preserve existing JWT/vault bytes and one protected outbox key', () => {
 const original = state(), file = path.join(root, 'home.sqlite');
 const profile = createNativeHomeProfile(original, root, file), reopened = { ...original, nativeHome: JSON.parse(JSON.stringify(profile)) };
 assert.equal(original.nativeHome, undefined, 'Construction does not mutate prior protected state');
 assert.equal(validateNativeHomeProfile(reopened, root).keyId, profile.keyId);
 assert.deepEqual(createNativeHomeProfile(reopened, root, file), profile);
 const host = nativeHomeHost(reopened, root, 'http://127.0.0.1:29481'), first = host.protectedKeys(), next = host.protectedKeys();
 assert.equal(first.jwt.toString('base64url') === original.jwtSecret, true);
 assert.equal(first.vault.toString('base64url') === original.vaultKey, true);
 assert.equal(first.outbox.length, 32); assert.equal(crypto.timingSafeEqual(first.outbox, next.outbox), true);
 first.outbox.fill(0); assert.equal(next.outbox.some(value => value !== 0), true, 'Every consumer receives defensive key copies');
 assert.equal(Object.isFrozen(host), true);
 const serialized = JSON.stringify(host);
 for (const key of [original.jwtSecret, original.vaultKey, profile.outboxKey]) assert.equal(serialized.includes(key), false);
});
test('protected identity refuses changed keys, paths, profile metadata and cross-profile reuse', () => {
 const original = state(), file = path.join(root, 'home.sqlite');
 const selected = { ...original, nativeHome: createNativeHomeProfile(original, root, file) };
 for (const mutation of [
  { jwtSecret: crypto.randomBytes(32).toString('base64url') }, { vaultKey: crypto.randomBytes(32).toString('base64url') },
  { nativeHome: { ...selected.nativeHome, sqliteFile: path.join(root, 'other.sqlite') } },
  { nativeHome: { ...selected.nativeHome, profileId: crypto.randomUUID() } },
  { nativeHome: { ...selected.nativeHome, keyId: crypto.randomUUID() } },
  { nativeHome: { ...selected.nativeHome, outboxKey: crypto.randomBytes(32).toString('base64url') } },
  { nativeHome: { ...selected.nativeHome, extra: true } }
 ]) assert.throws(() => validateNativeHomeProfile({ ...selected, ...mutation }, root));
 assert.throws(() => validateNativeHomeProfile(selected, path.resolve('/tmp/other-profile/local-runtime')));
 assert.throws(() => createNativeHomeProfile(selected, root, path.join(root, 'other.sqlite')));
 for (const file of ['relative.sqlite', path.join(root, '../escape.sqlite'), path.join(root, 'home.db')]) assert.throws(() => createNativeHomeProfile(original, root, file));
 for (const origin of ['https://thingtime.com', 'http://user:secret@127.0.0.1:29481', 'http://127.0.0.1:29481/path'])
  assert.throws(() => nativeHomeHost(selected, root, origin));
});
test('independent selected files get independent protected identity and no renderer-readable host capability', () => {
 const original = state(), a = createNativeHomeProfile(original, root, path.join(root, 'a.sqlite')), b = createNativeHomeProfile(original, root, path.join(root, 'b.sqlite'));
 assert.notEqual(a.profileId, b.profileId); assert.notEqual(a.keyId, b.keyId); assert.notEqual(a.outboxKey === b.outboxKey, true);
 const host = {}, config = nativeHomeHost({ ...original, nativeHome: a }, root, 'http://127.0.0.1:29481');
 publishNativeHomeHost(host, config); assert.deepEqual(Object.keys(host), []); assert.equal(host[HOST_SYMBOL], config);
 assert.equal(Object.getOwnPropertyDescriptor(host, HOST_SYMBOL).writable, false);
 assert.throws(() => publishNativeHomeHost(host, config));
 assert.throws(() => createNativeHomeProfile({ ...original, vaultKey: 'malformed' }, root, path.join(root, 'bad.sqlite')));
});
