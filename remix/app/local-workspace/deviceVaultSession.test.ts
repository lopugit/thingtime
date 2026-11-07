import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { DeviceVaultSession, deviceVaultCollections } from './deviceVaultSession';
import { LocalPasswordVault } from './passwordVault';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { openDeviceVaultValue, sealDeviceVaultValue } from '../passwords/vaultCrypto';
import type { VaultEnvelope } from '../passwords/vaultEnvelopeContract';
const legacy = JSON.parse(readFileSync(new URL('./deviceVaultSession.legacy.json', import.meta.url), 'utf8'));
const phrase = 'Synthetic independent device vault passphrase';
const scope = { kind: 'anonymous' } as const, origin = 'https://device.example';
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const db = () => new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange);
class Probe extends DeviceVaultSession {
 async encrypt(id: string, value: string) {
  const op = this.operation(undefined, false), sealed = await sealDeviceVaultValue(await this.context, op.key, id, value);
  op.lease.assertCurrent(); return sealed;
 }
 async decrypt(id: string, value: VaultEnvelope) {
  const op = this.operation(undefined, false), plain = await openDeviceVaultValue(await this.context, op.key, id, value);
  op.lease.assertCurrent(); return plain;
 }
 async delayedWrite(wait: Promise<void>, started: () => void) {
  const op = this.operation(undefined, false), controller = new AbortController(), off = op.lease.onInvalidate(() => controller.abort());
  try {
   started(); await wait;
   assert.equal(controller.signal.aborted, true);
   await this.db.transaction(this.scope, 'readwrite', op.lease, tx => tx.put(this.collections.records, 'late', { invalid: true }));
  } finally { off(); }
 }
}
test('shared session opens existing password keys and envelopes without changing their AAD', async () => {
 const store = db(), old = new LocalPasswordVault(store, scope, lease, origin), shared = new Probe(store, scope, lease, origin);
 try {
  const { record: before, entry, header } = legacy, id = before.id, collections = deviceVaultCollections('passwords');
  assert.equal(legacy.phrase, phrase); assert.equal(legacy.origin, origin); assert.deepEqual(legacy.scope, scope);
  await store.transaction(scope, 'readwrite', lease, async tx => { await tx.put(collections.keys, 'key', header); await tx.put(collections.records, id, before); });
  await old.unlock(phrase);
  await shared.unlock(phrase); assert.deepEqual(JSON.parse(await shared.decrypt(id, before.encryptedValue)), entry);
  const next = { ...entry, title: 'Shared lifecycle fixture' }, encryptedValue = await shared.encrypt(id, JSON.stringify(next));
  await store.transaction(scope, 'readwrite', lease, tx => tx.put(collections.records, id, { ...before, encryptedValue }));
  assert.deepEqual((await old.read(id)).entry, next);
 } finally { old.dispose(); shared.dispose(); await store.close(); }
});
test('provider keys are independent and reject copied password headers even with the same passphrase', async () => {
 const store = db(), passwords = new Probe(store, scope, lease, origin), providers = new Probe(store, scope, lease, origin, 'providers');
 let reopened: Probe | undefined;
 try {
  await passwords.unlock(phrase, true); assert.equal(await providers.configured(), false); await providers.unlock(phrase, true);
  const id = crypto.randomUUID(), sealed = await passwords.encrypt(id, 'synthetic password');
  await assert.rejects(providers.decrypt(id, sealed));
  const providerValue = await providers.encrypt(id, 'synthetic provider'); assert.equal(await providers.decrypt(id, providerValue), 'synthetic provider');
  providers.dispose();
  const passwordHeader = await store.transaction(scope, 'readonly', lease, tx => tx.get(deviceVaultCollections('passwords').keys, 'key'));
  await store.transaction(scope, 'readwrite', lease, tx => tx.put(deviceVaultCollections('providers').keys, 'key', passwordHeader));
  reopened = new Probe(store, scope, lease, origin, 'providers'); await assert.rejects(reopened.unlock(phrase));
  assert.equal(reopened.isUnlocked(), false); assert.equal(await passwords.decrypt(id, sealed), 'synthetic password');
 } finally { passwords.dispose(); providers.dispose(); reopened?.dispose(); await store.close(); }
});
test('locking a shared session cancels in-flight work before storage adoption', async () => {
 const store = db(), vault = new Probe(store, scope, lease, origin, 'providers');
 let release!: () => void, started!: () => void;
 const wait = new Promise<void>(yes => { release = yes; }), entered = new Promise<void>(yes => { started = yes; });
 try {
  await vault.unlock(phrase, true); const pending = vault.delayedWrite(wait, started); await entered; vault.lock(); release();
  await assert.rejects(pending, /locked/);
  assert.equal(await store.transaction(scope, 'readonly', lease, tx => tx.get(deviceVaultCollections('providers').records, 'late')), undefined);
 } finally { release(); vault.dispose(); await store.close(); }
});
test('provider background decryption preserves idle deadline and explicit activity renews it', async context => {
 const store = db(), vault = new Probe(store, scope, lease, origin, 'providers');
 try {
  await vault.unlock(phrase, true); const id = crypto.randomUUID(), sealed = await vault.encrypt(id, 'synthetic value');
  context.mock.timers.enable({ apis: ['setTimeout'] }); vault.touch(); context.mock.timers.tick(200_000); vault.touch();
  context.mock.timers.tick(299_999); assert.equal(await vault.decrypt(id, sealed), 'synthetic value');
  context.mock.timers.tick(1); assert.equal(vault.isUnlocked(), false); await assert.rejects(vault.decrypt(id, sealed), /Unlock/);
 } finally { context.mock.timers.reset(); vault.dispose(); await store.close(); }
});
test('missing provider key cannot be silently replaced beside saved encrypted work', async () => {
 const store = db(), vault = new Probe(store, scope, lease, origin, 'providers'), collections = deviceVaultCollections('providers');
 try {
  const preserved = { encryptedValue: { ciphertext: 'synthetic damaged record' } };
  await store.transaction(scope, 'readwrite', lease, tx => tx.put(collections.records, 'existing', preserved));
  await assert.rejects(vault.unlock(phrase, true), /key is missing/);
  assert.equal(await vault.configured(), false);
  assert.deepEqual(await store.transaction(scope, 'readonly', lease, tx => tx.get(collections.records, 'existing')), preserved);
 } finally { vault.dispose(); await store.close(); }
});
test('provider wrapped keys stay bound to account, origin, data plane and anonymous namespace', async () => {
 const store = db(), account = { kind: 'account', ownerId: 'owner-a', origin, dataPlane: 'home' } as const;
 const vault = new Probe(store, account, lease, origin, 'providers');
 try {
  await vault.unlock(phrase, true);
  const collections = deviceVaultCollections('providers'), header = await store.transaction(account, 'readonly', lease, tx => tx.get(collections.keys, 'key'));
  for (const other of [{ kind: 'anonymous' } as const, { ...account, ownerId: 'owner-b' }, { ...account, origin: 'https://other.example' }, { ...account, dataPlane: 'other' }]) {
   await store.transaction(other, 'readwrite', lease, tx => tx.put(collections.keys, 'key', header));
   const rejected = new Probe(store, other, lease, origin, 'providers');
   try { await assert.rejects(rejected.unlock(phrase)); assert.equal(rejected.isUnlocked(), false); }
   finally { rejected.dispose(); }
  }
  assert.equal(vault.isUnlocked(), true);
 } finally { vault.dispose(); await store.close(); }
});
test('retiring the workspace locks an unlocked provider key immediately', async () => {
 const store = db(), listeners = new Set<() => void>(); let active = true;
 const bound: WorkspaceLease = { assertCurrent() { if (!active) throw Error('workspace retired'); }, onInvalidate(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; } };
 const vault = new Probe(store, scope, bound, origin, 'providers');
 try {
  await vault.unlock(phrase, true); const id = crypto.randomUUID(), sealed = await vault.encrypt(id, 'synthetic provider');
  active = false; listeners.forEach(callback => callback()); assert.equal(vault.isUnlocked(), false);
  await assert.rejects(vault.decrypt(id, sealed), /retired/); await assert.rejects(vault.unlock(phrase), /retired/);
 } finally { vault.dispose(); await store.close(); }
});
