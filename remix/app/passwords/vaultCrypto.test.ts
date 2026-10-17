import assert from 'node:assert/strict';
import test from 'node:test';
import { createVaultDataKey, sealVaultValue, openVaultValue, wrapVaultKeyWithPassword, unwrapVaultKeyWithPassword } from '../api/utils/auth/vaultEnvelope';
import { createDeviceVaultKey, sealDeviceVaultValue, openDeviceVaultValue, wrapDeviceVaultKey, unwrapDeviceVaultKey } from './vaultCrypto';
const owner = 'device-vault:fixture';
const passphrase = '  exact 🦄 passphrase with whitespace  ';

test('device and server vault envelopes and password wrappers interoperate in both directions', async () => {
 const key = createDeviceVaultKey(), server = { id: key.id, bytes: Buffer.from(key.bytes) };
 const value = JSON.stringify({ fields: [{ value: 'exact secret\n🦄  ' }] });
 assert.equal(openVaultValue(owner, server, 'record', 'secret', await sealDeviceVaultValue(owner, key, 'record', value)), value);
 assert.equal(await openDeviceVaultValue(owner, key, 'record', sealVaultValue(owner, server, 'record', 'secret', value)), value);
 const wrapped = await wrapDeviceVaultKey(owner, key, passphrase), fromServer = await unwrapVaultKeyWithPassword(owner, passphrase, wrapped);
 assert.deepEqual(fromServer.bytes, server.bytes);
 const fromDevice = await unwrapDeviceVaultKey(owner, passphrase, await wrapVaultKeyWithPassword(owner, server, passphrase));
 assert.deepEqual(fromDevice.bytes, key.bytes);
 key.bytes.fill(0); server.bytes.fill(0); fromDevice.bytes.fill(0); fromServer.bytes.fill(0);
});

test('device decrypt fails for wrong owner, record, key, tampered bytes and unsupported envelopes', async () => {
 const key = createDeviceVaultKey(), envelope = await sealDeviceVaultValue(owner, key, 'one', 'synthetic secret');
 for (const [otherOwner, id, value] of [[owner + '-other', 'one', envelope], [owner, 'two', envelope],
  [owner, 'one', { ...envelope, tag: envelope.tag.replace(/^./, envelope.tag[0] === 'A' ? 'B' : 'A') }],
  [owner, 'one', { ...envelope, version: 1 }], [owner, 'one', { ...envelope, iv: 'x'.repeat(1000) }]] as const) {
  await assert.rejects(openDeviceVaultValue(otherOwner, key, id, value as any), /could not be unlocked/);
 }
 await assert.rejects(openDeviceVaultValue(owner, createDeviceVaultKey(), 'one', envelope), /could not be unlocked/);
 await assert.rejects(sealDeviceVaultValue(owner, key, 'one', 'x'.repeat(65537)), /could not be unlocked/);
});

test('device unlock uses exact passwords, fixed KDF bounds and cancellation while deriving', async () => {
 const key = createVaultDataKey(), wrapped = await wrapVaultKeyWithPassword(owner, key, passphrase);
 await assert.rejects(unwrapDeviceVaultKey(owner, passphrase.trim(), wrapped), /could not be unlocked/);
 await assert.rejects(unwrapDeviceVaultKey(owner, passphrase, { ...wrapped, kdf: 'cheap' } as any), /could not be unlocked/);
 await assert.rejects(unwrapDeviceVaultKey(owner, 'x'.repeat(4097), wrapped), /could not be unlocked/);
 let calls = 0;
 await assert.rejects(unwrapDeviceVaultKey(owner, passphrase, wrapped, () => { if (++calls > 2) throw Error('Retired workspace'); }), /Retired workspace/);
 assert.ok(calls > 2); key.bytes.fill(0);
});
