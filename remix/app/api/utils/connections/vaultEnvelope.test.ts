import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createVaultDataKey, openVaultValue, sealVaultValue,
  unwrapVaultKeyWithPassword, unwrapVaultKeyWithSession,
  wrapVaultKeyWithPassword, wrapVaultKeyWithSession,
  type PasswordKeyEnvelope, type SessionKeyEnvelope, type VaultEnvelope,
} from '../auth/vaultEnvelope';

const owner = 'fixture-owner';
const secret = 'synthetic-provider-secret';
const failure = { message: 'The saved vault key or value could not be unlocked.' };
const now = 1_800_000_000_000;
const session = { id: 'fixture-session', token: 'synthetic-auth-token', expiresAt: now + 60_000 };
const tamper = (value: string) => (value[0] === 'A' ? 'B' : 'A') + value.slice(1);

test('each vault gets an independent random key and each encryption gets an independent IV', () => {
  const first = createVaultDataKey(), second = createVaultDataKey();
  assert.notEqual(first.id, second.id);
  assert.notDeepEqual(first.bytes, second.bytes);
  const one = sealVaultValue(owner, first, 'record-a', 'oauth', secret);
  const two = sealVaultValue(owner, first, 'record-a', 'oauth', secret);
  assert.notEqual(one.iv, two.iv);
  assert.notEqual(one.cipherText, two.cipherText);
  assert.equal(openVaultValue(owner, first, 'record-a', 'oauth', one), secret);
  assert.equal(openVaultValue(owner, first, 'record-a', 'oauth', two), secret);
  assert.equal(JSON.stringify(one).includes(secret), false);
});

test('encrypted values cannot be moved between owners, records, purposes, or keys', () => {
  const key = createVaultDataKey(), other = createVaultDataKey();
  const value = sealVaultValue(owner, key, 'record-a', 'oauth', secret);
  assert.throws(() => openVaultValue('other-owner', key, 'record-a', 'oauth', value), failure);
  assert.throws(() => openVaultValue(owner, key, 'record-b', 'oauth', value), failure);
  assert.throws(() => openVaultValue(owner, key, 'record-a', 'secret', value), failure);
  assert.throws(() => openVaultValue(owner, other, 'record-a', 'oauth', value), failure);
  assert.throws(() => openVaultValue(owner, { ...other, id: key.id }, 'record-a', 'oauth', value), failure);
  assert.throws(() => openVaultValue(owner, other, 'record-a', 'oauth', { ...value, keyId: other.id }), failure);
});

test('AES-GCM rejects edited ciphertext, nonce, tag, version, and malformed encodings', () => {
  const key = createVaultDataKey(), value = sealVaultValue(owner, key, 'record-a', 'secret', secret);
  const edits = [
    { cipherText: tamper(value.cipherText) }, { iv: tamper(value.iv) }, { tag: tamper(value.tag) },
    { version: 1 }, { tag: '' }, { iv: 'AA' }, { tag: value.tag + '=' },
    { cipherText: '!' }, { cipherText: 'A'.repeat(90_000) }, { keyId: null },
  ];
  for (const edit of edits) {
    assert.throws(() => openVaultValue(owner, key, 'record-a', 'secret', { ...value, ...edit } as VaultEnvelope), failure);
  }
});

test('value size is bounded in bytes and empty values are supported', () => {
  const key = createVaultDataKey();
  for (const value of ['', '🦊'.repeat(16_384)]) {
    assert.equal(openVaultValue(owner, key, 'record-a', 'secret', sealVaultValue(owner, key, 'record-a', 'secret', value)), value);
  }
  assert.throws(() => sealVaultValue(owner, key, 'record-a', 'secret', '🦊'.repeat(16_385)), failure);
  assert.throws(() => sealVaultValue('', key, 'record-a', 'secret', secret), failure);
  assert.throws(() => sealVaultValue(owner, key, '', 'secret', secret), failure);
  assert.throws(() => sealVaultValue(owner, { ...key, bytes: Buffer.alloc(31) }, 'record-a', 'secret', secret), failure);
});

test('password unlock restores the key and rejects the wrong password or owner', async () => {
  const key = createVaultDataKey();
  const envelope = await wrapVaultKeyWithPassword(owner, key, 'synthetic-password');
  assert.deepEqual(await unwrapVaultKeyWithPassword(owner, 'synthetic-password', envelope), key);
  await assert.rejects(unwrapVaultKeyWithPassword(owner, 'wrong-password', envelope), failure);
  await assert.rejects(unwrapVaultKeyWithPassword('other-owner', 'synthetic-password', envelope), failure);
  assert.equal(JSON.stringify(envelope).includes(key.bytes.toString('base64url')), false);
  assert.equal(JSON.stringify(envelope).includes('synthetic-password'), false);
});

test('password rotation rewraps the same data key without rewriting saved credentials', async () => {
  const key = createVaultDataKey(), value = sealVaultValue(owner, key, 'record-a', 'oauth', secret);
  const originalValue = JSON.stringify(value);
  const oldWrapper = await wrapVaultKeyWithPassword(owner, key, 'original-password');
  const unlocked = await unwrapVaultKeyWithPassword(owner, 'original-password', oldWrapper);
  const newWrapper = await wrapVaultKeyWithPassword(owner, unlocked, 'replacement-password');
  const nextKey = await unwrapVaultKeyWithPassword(owner, 'replacement-password', newWrapper);
  assert.deepEqual(nextKey, key);
  assert.notEqual(newWrapper.salt, oldWrapper.salt);
  assert.notEqual(newWrapper.iv, oldWrapper.iv);
  assert.equal(openVaultValue(owner, nextKey, 'record-a', 'oauth', value), secret);
  assert.equal(JSON.stringify(value), originalValue);
  await assert.rejects(unwrapVaultKeyWithPassword(owner, 'original-password', newWrapper), failure);
});

test('password input remains exact beyond bcrypt length, whitespace, and Unicode normalization', async () => {
  const key = createVaultDataKey();
  const password = `${'a'.repeat(72)} e\u0301 🦊 `;
  const envelope = await wrapVaultKeyWithPassword(owner, key, password);
  assert.deepEqual(await unwrapVaultKeyWithPassword(owner, password, envelope), key);
  for (const wrong of [password.slice(0, 72), password.trim(), password.normalize('NFC')]) {
    await assert.rejects(unwrapVaultKeyWithPassword(owner, wrong, envelope), failure);
  }
});

test('password wrappers reject tampering and do not accept stored KDF work factors', async () => {
  const key = createVaultDataKey(), password = 'synthetic-password';
  const envelope = await wrapVaultKeyWithPassword(owner, key, password);
  for (const edit of [
    { version: 2 }, { kdf: 'scrypt-1-1-1' }, { salt: '' }, { salt: 'A'.repeat(100_000) },
    { keyId: 'vault-key-------------------------------------' }, { salt: tamper(envelope.salt) },
    { cipherText: tamper(envelope.cipherText) }, { tag: tamper(envelope.tag) },
    { keyId: createVaultDataKey().id },
  ]) {
    await assert.rejects(unwrapVaultKeyWithPassword(owner, password, { ...envelope, ...edit } as PasswordKeyEnvelope), failure);
  }
  for (const invalid of ['', 'a'.repeat(4097)]) {
    await assert.rejects(wrapVaultKeyWithPassword(owner, key, invalid), failure);
  }
});

test('session wrapper is bound to its owner, token, session ID, and expiry', () => {
  const key = createVaultDataKey(), envelope = wrapVaultKeyWithSession(owner, key, session, now);
  assert.deepEqual(unwrapVaultKeyWithSession(owner, session, envelope, now), key);
  assert.throws(() => unwrapVaultKeyWithSession('other-owner', session, envelope, now), failure);
  for (const change of [{ token: 'other-token' }, { id: 'other-session' }, { expiresAt: session.expiresAt + 1 }]) {
    assert.throws(() => unwrapVaultKeyWithSession(owner, { ...session, ...change }, envelope, now), failure);
  }
  // Matching edits to both supplied session and stored wrapper still fail AAD authentication.
  const forgedSession = { ...session, id: 'forged-id', expiresAt: session.expiresAt + 1 };
  const forgedEnvelope = { ...envelope, sessionId: forgedSession.id, expiresAt: forgedSession.expiresAt };
  assert.throws(() => unwrapVaultKeyWithSession(owner, forgedSession, forgedEnvelope, now), failure);
});

test('session token rotation and separate sessions unlock the same saved credential', () => {
  const key = createVaultDataKey(), value = sealVaultValue(owner, key, 'record-a', 'oauth', secret);
  const oldWrapper = wrapVaultKeyWithSession(owner, key, session, now);
  const nextSession = { ...session, id: 'another-session', token: 'rotated-auth-token', expiresAt: session.expiresAt + 1000 };
  const nextWrapper = wrapVaultKeyWithSession(owner, unwrapVaultKeyWithSession(owner, session, oldWrapper, now), nextSession, now);
  assert.deepEqual(unwrapVaultKeyWithSession(owner, nextSession, nextWrapper, now), key);
  assert.equal(openVaultValue(owner, unwrapVaultKeyWithSession(owner, nextSession, nextWrapper, now), 'record-a', 'oauth', value), secret);
  assert.throws(() => unwrapVaultKeyWithSession(owner, { ...nextSession, token: session.token }, nextWrapper, now), failure);
  assert.notEqual(nextWrapper.salt, oldWrapper.salt);
});

test('expired sessions and invalid times fail closed at the expiry boundary', () => {
  const key = createVaultDataKey(), envelope = wrapVaultKeyWithSession(owner, key, session, now);
  assert.deepEqual(unwrapVaultKeyWithSession(owner, session, envelope, session.expiresAt - 1), key);
  for (const time of [session.expiresAt, session.expiresAt + 1, NaN, Infinity]) {
    assert.throws(() => unwrapVaultKeyWithSession(owner, session, envelope, time), failure);
    assert.throws(() => wrapVaultKeyWithSession(owner, key, session, time), failure);
  }
  for (const change of [{ token: '' }, { token: 'a'.repeat(16385) }, { id: '' }, { expiresAt: NaN }]) {
    assert.throws(() => wrapVaultKeyWithSession(owner, key, { ...session, ...change }, now), failure);
  }
});

test('session wrappers reject corrupt metadata, values, and another key ID', () => {
  const key = createVaultDataKey(), envelope = wrapVaultKeyWithSession(owner, key, session, now);
  for (const edit of [
    { version: 2 }, { kdf: 'sha256' }, { keyId: createVaultDataKey().id },
    { salt: '' }, { salt: tamper(envelope.salt) }, { iv: tamper(envelope.iv) },
    { tag: tamper(envelope.tag) }, { cipherText: tamper(envelope.cipherText) },
  ]) {
    assert.throws(() => unwrapVaultKeyWithSession(owner, session, { ...envelope, ...edit } as SessionKeyEnvelope, now), failure);
  }
});
