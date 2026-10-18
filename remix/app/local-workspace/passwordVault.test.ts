import { createQuotaFactory, TEST_STORAGE_CAPACITY } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBKeyRange } from 'fake-indexeddb';
import { LocalPasswordVault, type PasswordVaultTransport } from './passwordVault';
import { WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope } from './storage';
import { emptyPasswordEntry } from '../passwords/model';
const origin = 'https://device.example', passphrase = 'A separate device passphrase 🦄';
const anonymous = { kind: 'anonymous' } as const;
const account = { kind: 'account', ownerId: 'owner', origin: 'https://account.example', dataPlane: 'home' } as const;
const entry = { ...emptyPasswordEntry(), title: 'Private fixture title', fields: [{ id: 'secret', label: 'Private field label', type: 'password' as const, value: ' synthetic secret\n  ' }] };
function guard() {
 let active = true; const listeners = new Set<() => void>();
 const lease: WorkspaceLease = { assertCurrent() { if (!active) throw Error('Workspace retired'); }, onInvalidate(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
 return { lease, retire() { active = false; for (const fn of listeners) fn(); } };
}
const database = () => new WorkspaceDatabase(createQuotaFactory(), crypto.randomUUID(), 10_000, IDBKeyRange);
const save = (revision = 0, id = crypto.randomUUID(), title = entry.title) => ({ id, revision, writeId: crypto.randomUUID(), entry: { ...entry, title } });
async function rows(db: WorkspaceDatabase, scope: WorkspaceScope, lease: WorkspaceLease) {
 return db.transaction(scope, 'readonly', lease, async tx => ({ key: await tx.get('password-vault-keys', 'key'), records: await tx.list('password-vault-records'), commands: await tx.list('password-vault-commands'), things: await tx.list('things'), timeline: await tx.list('timeline-events') }));
}
test('anonymous encrypted CRUD survives reopening; secrets and metadata never enter ordinary content, history or an account queue', async () => {
 const db = database(), gate = guard(), vault = new LocalPasswordVault(db, anonymous, gate.lease, origin); let reopened: LocalPasswordVault | undefined;
 try {
  assert.equal(await vault.configured(), false); await assert.rejects(vault.page(), /Unlock/);
  await vault.unlock(passphrase, true); const input = save(); const record = await vault.save(input);
  assert.equal(record.revision, 1); assert.deepEqual((await vault.read(input.id)).entry, entry);
  const stored = await rows(db, anonymous, gate.lease), text = JSON.stringify(stored);
  for (const secret of [entry.title, entry.fields[0].label, entry.fields[0].value, passphrase]) assert.ok(!text.includes(secret));
  assert.deepEqual(stored.commands, []); assert.deepEqual(stored.things, []); assert.deepEqual(stored.timeline, []);
  assert.deepEqual(await rows(db, account, gate.lease), { key: undefined, records: [], commands: [], things: [], timeline: [] });
  vault.dispose(); reopened = new LocalPasswordVault(db, anonymous, gate.lease, origin);
  assert.equal(await reopened.configured(), true); await assert.rejects(reopened.read(input.id), /Unlock/);
  await assert.rejects(reopened.unlock('incorrect passphrase'), /could not be unlocked/);
  await reopened.unlock(passphrase); assert.deepEqual((await reopened.read(input.id)).entry, entry);
  assert.equal((await reopened.page(undefined, true)).entries.length, 1);
  await reopened.remove(input.id, 1); await reopened.remove(input.id, 1);
  assert.deepEqual((await reopened.page()).entries, []);
  await assert.rejects(reopened.save(input), /deleted/);
  const deleted = await rows(db, anonymous, gate.lease); assert.equal((deleted.records[0].value as any).encryptedValue, undefined);
 } finally { vault.dispose(); reopened?.dispose(); await db.close(); }
});
test('concurrent editors compare revisions and exact retry payloads; account commands persist only encrypted data atomically', async () => {
 const db = database(), gate = guard(), one = new LocalPasswordVault(db, account, gate.lease, origin), two = new LocalPasswordVault(db, account, gate.lease, origin);
 try {
  await one.unlock(passphrase, true); await two.unlock(passphrase);
  const input = save(); const result = await one.save(input); assert.deepEqual(await two.save(input), result);
  await assert.rejects(two.save({ ...input, entry: { ...entry, title: 'different payload' } }), /already used/);
  const attempts = await Promise.allSettled([one.save(save(1, input.id, 'First contender')), two.save(save(1, input.id, 'Second contender'))]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  const stored = await rows(db, account, gate.lease); assert.equal(stored.commands.length, 2);
  assert.ok(!JSON.stringify(stored).includes('synthetic secret')); assert.deepEqual(stored.things, []); assert.deepEqual(stored.timeline, []);
  const sameWriteIdOtherRecord = { ...save(), writeId: input.writeId }; await one.save(sameWriteIdOtherRecord);
  assert.equal((await rows(db, account, gate.lease)).commands.length, 3, 'write IDs reused for another record cannot overwrite an intent');
 } finally { one.dispose(); two.dispose(); await db.close(); }
});
test('origin/scope swaps, wrong passphrases and missing key damage cannot unlock or replace retained encrypted records', async () => {
 const db = database(), gate = guard(), vault = new LocalPasswordVault(db, anonymous, gate.lease, origin), otherOrigin = new LocalPasswordVault(db, anonymous, gate.lease, 'https://other.example');
 try {
  await vault.unlock(passphrase, true); const input = save(); await vault.save(input);
  await assert.rejects(otherOrigin.unlock(passphrase), /could not be unlocked/);
  vault.lock(); await db.transaction(anonymous, 'readwrite', gate.lease, tx => tx.delete('password-vault-keys', 'key'));
  await assert.rejects(vault.unlock(passphrase, true), /key is missing/);
  assert.equal((await rows(db, anonymous, gate.lease)).records.length, 1);
 } finally { vault.dispose(); otherOrigin.dispose(); await db.close(); }
});
test('locking, aborting or retiring an operation prevents late crypto and partial account writes', async () => {
 const db = database(), gate = guard(), vault = new LocalPasswordVault(db, account, gate.lease, origin);
 try {
  await vault.unlock(passphrase, true);
  const pending = vault.save(save()); vault.lock(); await assert.rejects(pending, /locked/);
  await vault.unlock(passphrase); const controller = new AbortController(); controller.abort(); await assert.rejects(vault.save(save(), controller.signal), { name: 'AbortError' });
  const original = db.transaction.bind(db);
  db.transaction = ((scope: any, mode: any, lease: any, run: any) => original(scope, mode, lease, tx => run({ ...tx, put: async (...args: Parameters<typeof tx.put>) => {
   if (args[0] === 'password-vault-commands') gate.retire(); return tx.put(...args);
  } }))) as typeof db.transaction;
  await assert.rejects(vault.save(save()), /retired|cancelled|locked/); db.transaction = original;
  const intact = await rows(db, account, guard().lease); assert.deepEqual(intact.records, []); assert.deepEqual(intact.commands, []);
 } finally { vault.dispose(); await db.close(); }
});
test('quota and malformed input preserve encrypted contents and never leave partial write intents', async () => {
 const db = database(), gate = guard(), vault = new LocalPasswordVault(db, account, gate.lease, origin);
 try {
  await vault.unlock(passphrase, true); const input = save(); await vault.save(input);
  await assert.rejects(vault.save({ ...save(), entry: { ...entry, fields: [{ ...entry.fields[0], type: 'totp', value: 'not a totp' }] } }), /./);
  const before = await rows(db, account, gate.lease), usage = await db.transaction(account, 'readonly', gate.lease, tx => tx.usage());
  await db.transaction(account, 'readwrite', gate.lease, async tx => { for (let i = 0; i < 3; i++) await tx.putBytes(`fill-${i}`, new Uint8Array(TEST_STORAGE_CAPACITY.binaryBytes)); await tx.putBytes('fill-final', new Uint8Array(TEST_STORAGE_CAPACITY.binaryBytes - usage.bytes)); });
  await assert.rejects(vault.save(save(1, input.id, 'Larger replacement data')), /workspace is full/);
  assert.deepEqual(await rows(db, account, gate.lease), before);
 } finally { vault.dispose(); await db.close(); }
});

test('idle lock clears access, activity renews the timer, and pagination exports every exact encrypted entry once', async context => {
 const db = database(), gate = guard(), vault = new LocalPasswordVault(db, anonymous, gate.lease, origin);
 try {
  await vault.unlock(passphrase, true);
  const ids = new Set<string>();
  for (let index = 0; index < 52; index++) { const input = save(0, crypto.randomUUID(), `Entry ${index}`); ids.add(input.id); await vault.save(input); }
  const first = await vault.page(undefined, true); assert.equal(first.entries.length, 50); assert.ok(first.nextCursor);
  const next = await vault.page(first.nextCursor!, true); assert.equal(next.entries.length, 2); assert.equal(next.nextCursor, null);
  assert.deepEqual(new Set([...first.entries, ...next.entries].map(row => row.id)), ids);
  await assert.rejects(vault.page('{invalid'), /cursor/);
  context.mock.timers.enable({ apis: ['setTimeout'] });
  vault.touch(); context.mock.timers.tick(299_999); assert.equal(vault.isUnlocked(), true);
  vault.touch(); context.mock.timers.tick(299_999); assert.equal(vault.isUnlocked(), true);
  context.mock.timers.tick(1); assert.equal(vault.isUnlocked(), false); await assert.rejects(vault.page(), /Unlock/);
 } finally { vault.dispose(); context.mock.timers.reset(); await db.close(); }
});

test('copying both wrapped key and ciphertext into a different account, origin or data plane cannot grant decryption', async () => {
 const db = database(), gate = guard(), original = new LocalPasswordVault(db, account, gate.lease, origin); const copies: LocalPasswordVault[] = [];
 try {
  await original.unlock(passphrase, true); await original.save(save()); const stored = await rows(db, account, gate.lease);
  for (const target of [{ ...account, ownerId: 'other' }, { ...account, origin: 'https://other-account.example' }, { ...account, dataPlane: 'other-plane' }]) {
   await db.transaction(target, 'readwrite', gate.lease, async tx => { await tx.put('password-vault-keys', 'key', stored.key); for (const row of stored.records) await tx.put('password-vault-records', row.id, row.value); });
   const copy = new LocalPasswordVault(db, target, gate.lease, origin); copies.push(copy);
   await assert.rejects(copy.unlock(passphrase), /could not be unlocked/); assert.equal(copy.isUnlocked(), false);
  }
 } finally { original.dispose(); copies.forEach(copy => copy.dispose()); await db.close(); }
});

for (const scope of [anonymous, account]) test(`${scope.kind} large password entries survive encrypted save, cold reopen and canonical export`, async () => {
 const db = database(), gate = guard(), vault = new LocalPasswordVault(db, scope, gate.lease, origin);
 let reopened: LocalPasswordVault | undefined;
 const input = { ...save(), entry: { ...entry, passwordType: 'secure-note' as const,
  fields: [{ id: 'notes', label: 'Exact notes', type: 'notes' as const, value: 'exact 🦄\n'.repeat(150_000) }] } };
 try {
  await vault.unlock(passphrase, true);
  await vault.save(input);
  const stored = await rows(db, scope, gate.lease);
  assert.ok(JSON.stringify(stored.records[0]).length > TEST_STORAGE_CAPACITY.recordBytes);
  assert.ok(!JSON.stringify(stored).includes('exact 🦄'));
  assert.equal(stored.commands.length, scope.kind === 'account' ? 1 : 0);
  vault.dispose(); await db.close();
  reopened = new LocalPasswordVault(db, scope, gate.lease, origin); await reopened.unlock(passphrase);
  assert.deepEqual((await reopened.read(input.id)).entry, input.entry);
  const exported = await reopened.fileStorage().exportPage(undefined, new AbortController().signal);
  assert.deepEqual(exported.entries.map(row => row.entry), [input.entry]);
  assert.equal(exported.nextCursor, null);
  if (scope.kind === 'account') {
   const written: unknown[] = [];
   const result = await reopened.synchronize({ async write(command: Parameters<PasswordVaultTransport['write']>[0]) {
    written.push(command.entry); return { record: { id: input.id, revision: 1, title: input.entry.title, passwordType: input.entry.passwordType, updatedAt: new Date().toISOString() } };
   } } as any);
   assert.equal(result.completed, 1); assert.deepEqual(written, [input.entry]);
   assert.deepEqual(await reopened.syncStatus(), []);
  }
 } finally { reopened?.dispose(); vault.dispose(); await db.close(); }
});
