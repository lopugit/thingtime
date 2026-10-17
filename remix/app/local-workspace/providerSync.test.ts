import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceScope } from './storage';
import { LocalProviderVault } from './providerVault';
import { parseUserVaultWriteAcknowledgment, type UserVaultWrite } from '../api/utils/lopu/userVaultWriteContract';
const origin = 'https://fixture.example', scope = { kind: 'account', origin, ownerId: 'fixture-owner', dataPlane: 'home' } as const;
const phrase = 'Synthetic separate device passphrase', gate = { assertCurrent() {}, onInvalidate: () => () => {} };
const command = (action = 'save-secret', values: Record<string, unknown> = {}, id = crypto.randomUUID(), revision = 0) => ({
 action, id, revision, writeId: crypto.randomUUID(), ...(action === 'save-secret' ? { name: 'Fixture', key: 'FIXTURE_KEY', value: ' synthetic secret\n', groupId: null } : {}), ...values
});
async function fixture(selected: WorkspaceScope = scope) {
 const db = new WorkspaceDatabase(new IDBFactory(), crypto.randomUUID(), 10_000, IDBKeyRange), vault = new LocalProviderVault(db, selected, gate, origin);
 await vault.unlock(phrase, true); return { db, vault, close: async () => { vault.dispose(); await db.close(); } };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function remote() {
 const values = new Map<string, string>(), receipts = new Map<string, { command: string; receipt: ReturnType<typeof parseUserVaultWriteAcknowledgment> }>(), calls: UserVaultWrite[] = [];
 let counter = 0;
 const transport = { async write(input: UserVaultWrite, _signal: AbortSignal) {
  calls.push(structuredClone(input)); const replay = receipts.get(input.writeId);
  if (replay) { assert.equal(JSON.stringify(input), replay.command); return structuredClone(replay.receipt); }
  if ((values.get(input.id) ?? null) !== input.expectedVersion) throw Object.assign(Error('synthetic remote error must not persist'), { status: 409 });
  const version = 'vault-state-v1:' + (++counter).toString(16).padStart(64,'0');
  if (input.action === 'delete') values.delete(input.id); else values.set(input.id, version);
  const receipt = parseUserVaultWriteAcknowledgment({ id: input.id, writeId: input.writeId, action: input.action, expectedVersion: input.expectedVersion, resultVersion: input.action === 'delete' ? null : version });
  receipts.set(input.writeId, { command: JSON.stringify(input), receipt }); return receipt;
 } };
 return { values, calls, transport };
}
const stored = (db: WorkspaceDatabase) => db.transaction(scope, 'readonly', gate, async tx => ({ records: await tx.list('provider-vault-records'), commands: await tx.list('provider-vault-commands') }));

test('account writes finish locally, then synchronize ordered environment dependencies and exact versions', async () => {
 const f = await fixture(), r = remote();
 try {
  const group = command('create-group', { name: 'Fixture environment' }), secret = command('save-secret', { groupId: group.id });
  await f.vault.mutate(group); await f.vault.mutate(secret);
  await f.vault.mutate(command('move-entry', { groupId: null }, secret.id, 1));
  await f.vault.mutate(command('delete', {}, group.id, 1));
  assert.equal(r.calls.length, 0); assert.equal((await f.vault.synchronize(r.transport)).completed, 4);
  assert.deepEqual(r.calls.map(x => x.action), ['create-group','save-secret','move-entry','delete']);
  assert.equal(r.calls[0].expectedVersion, null); assert.equal(r.calls[1].expectedVersion, null);
  assert.equal(r.calls[2].expectedVersion, 'vault-state-v1:'+'2'.padStart(64,'0'));
  assert.equal(r.calls[3].expectedVersion, 'vault-state-v1:'+'1'.padStart(64,'0'));
  assert.deepEqual(await f.vault.syncStatus(), []); assert.equal((await f.vault.reveal(secret.id)).value, secret.value);
 } finally { await f.close(); }
});
test('lost acknowledgment survives cold unlock and later edits without changing the frozen body', async () => {
 const f = await fixture(), r = remote(); let reopened: LocalProviderVault | undefined, clock = Date.now(), lost = true;
 const transport = { write: async (...args: Parameters<typeof r.transport.write>) => { const receipt = await r.transport.write(...args); if (lost) { lost = false; throw Error('lost'); } return receipt; } };
 try {
  const one = command(); await f.vault.mutate(one); assert.equal((await f.vault.synchronize(transport, undefined, () => clock)).completed, 0);
  await f.vault.mutate(command('save-secret', { value: 'newer local fixture' }, one.id, 1));
  const raw = JSON.stringify(await stored(f.db)); for (const value of ['synthetic secret','newer local fixture','FIXTURE_KEY','lost']) assert.ok(!raw.includes(value));
  f.vault.dispose(); reopened = new LocalProviderVault(f.db, scope, gate, origin); await reopened.unlock(phrase); clock += 70_000;
  assert.equal((await reopened.synchronize(transport, undefined, () => clock)).completed, 2);
  assert.deepEqual(r.calls[0], r.calls[1]); assert.equal(r.calls[2].expectedVersion, 'vault-state-v1:'+'1'.padStart(64,'0'));
  assert.equal((await reopened.reveal(one.id)).value, 'newer local fixture');
 } finally { reopened?.dispose(); await f.close(); }
});
test('two tabs serialize claims and preserve a newer edit during a delayed acknowledgment', async () => {
 const f = await fixture(), r = remote(), second = new LocalProviderVault(f.db, scope, gate, origin), started = deferred(), release = deferred();
 try {
  await second.unlock(phrase); const one = command(); await f.vault.mutate(one);
  const pending = f.vault.synchronize({ write: async (...args) => { started.resolve(); await release.promise; return r.transport.write(...args); } });
  await started.promise; await second.mutate(command('save-secret', { value: 'later edit' }, one.id, 1));
  assert.equal((await second.synchronize(r.transport)).completed, 0); assert.equal(r.calls.length, 0);
  release.resolve(); assert.equal((await pending).completed, 2); assert.equal((await f.vault.reveal(one.id)).value, 'later edit');
 } finally { release.resolve(); second.dispose(); await f.close(); }
});
test('locking refuses late receipt adoption and retains the original retry', async () => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred(); let clock = Date.now();
 try {
  const one = command(); await f.vault.mutate(one);
  const pending = f.vault.synchronize({ write: async (...args) => { const receipt = await r.transport.write(...args); started.resolve(); await release.promise; return receipt; } }, undefined, () => clock);
  await started.promise; f.vault.lock(); release.resolve(); await assert.rejects(pending, /locked/);
  assert.equal((await stored(f.db)).commands.length, 1); await f.vault.unlock(phrase); clock += 70_000;
  assert.equal((await f.vault.synchronize(r.transport, undefined, () => clock)).completed, 1); assert.deepEqual(r.calls[0], r.calls[1]);
 } finally { release.resolve(); await f.close(); }
});
test('a mismatched receipt stays uncertain, while a definite conflict stops later dependencies', async () => {
 const f = await fixture(), r = remote(); let clock = Date.now();
 try {
  const one = command(); await f.vault.mutate(one); await f.vault.mutate(command());
  assert.equal((await f.vault.synchronize({ write: async (...args) => ({ ...await r.transport.write(...args), id: 'different-record' }) }, undefined, () => clock)).completed, 0);
  assert.equal((await f.vault.syncStatus()).find(row => row.recordId === one.id)!.state, 'frozen'); clock += 70_000;
  assert.equal((await f.vault.synchronize({ write: async () => { throw Object.assign(Error('synthetic remote error must not persist'), { status: 409 }); } }, undefined, () => clock)).completed, 0);
  assert.equal((await f.vault.syncStatus()).find(row => row.recordId === one.id)!.state, 'refused'); assert.equal(r.calls.length, 1);
  assert.ok(!JSON.stringify(await stored(f.db)).includes('synthetic remote error')); assert.equal((await f.vault.reveal(one.id)).value, one.value);
 } finally { await f.close(); }
});
test('anonymous work cannot invoke an account sender', async () => {
 const f = await fixture({ kind: 'anonymous' }), r = remote();
 try { await f.vault.mutate(command()); await assert.rejects(f.vault.synchronize(r.transport), /Anonymous/); assert.equal(r.calls.length, 0); assert.deepEqual(await f.vault.syncStatus(), []); }
 finally { await f.close(); }
});

test('metadata-only entries use the exact remote token without retaining or fetching the credential', async () => {
 const f = await fixture(), r = remote(), id = crypto.randomUUID(), version = 'vault-state-v1:'+'a'.repeat(64);
 try {
  r.values.set(id, version);
  await f.vault.reconcileMetadata({ metadata: async () => ({ complete: true, groups: [], entries: [{
   id, kind: 'provider', name: 'Remote fixture', provider: 'compatible', endpoint: 'https://provider.example/v1',
   hasValue: true, groupId: null, version, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z'
  }] }) });
  const entry = (await f.vault.list()).entries[0]; assert.equal(entry.valueAvailableOffline, false);
  await f.vault.mutate(command('save-provider', { name: 'Updated fixture', provider: 'compatible', endpoint: 'https://provider.example/v1', token: null }, id, entry.revision));
  assert.equal((await f.vault.synchronize(r.transport)).completed, 1); assert.equal(r.calls[0].expectedVersion, version);
  assert.ok(r.calls[0].action === 'save-provider'); assert.equal(r.calls[0].token, null);
  await assert.rejects(f.vault.reveal(id), /not been retained/);
 } finally { await f.close(); }
});

test('expired claims reuse the frozen request and an older failure cannot undo the winning acknowledgment', async () => {
 const f = await fixture(), r = remote(), second = new LocalProviderVault(f.db, scope, gate, origin), started = deferred(), release = deferred(); let clock = Date.now();
 try {
  await second.unlock(phrase); const one = command(); await f.vault.mutate(one);
  const pending = f.vault.synchronize({ write: async (...args) => { await r.transport.write(...args); started.resolve(); await release.promise; throw Error('old lost response'); } }, undefined, () => clock);
  await started.promise; clock += 70_000;
  assert.equal((await second.synchronize(r.transport, undefined, () => clock)).completed, 1); release.resolve();
  assert.equal((await pending).completed, 0); assert.equal(r.values.size, 1); assert.deepEqual(r.calls[0], r.calls[1]);
  assert.deepEqual(await f.vault.syncStatus(), []); assert.equal((await f.vault.reveal(one.id)).value, one.value);
 } finally { release.resolve(); second.dispose(); await f.close(); }
});

test('a replay acknowledgment after remote deletion does not recreate the mutable target', async () => {
 const f = await fixture(), r = remote(); let clock = Date.now();
 try {
  const one = command(); await f.vault.mutate(one);
  await f.vault.synchronize({ write: async (...args) => { await r.transport.write(...args); throw Error('lost'); } }, undefined, () => clock);
  r.values.delete(one.id); clock += 70_000;
  assert.equal((await f.vault.synchronize(r.transport, undefined, () => clock)).completed, 1);
  assert.equal(r.values.has(one.id), false); assert.deepEqual(r.calls[0], r.calls[1]);
  await f.vault.reconcileMetadata({ metadata: async () => ({ complete: true, groups: [], entries: [] }) });
  assert.equal((await f.vault.list()).entries.length, 0);
 } finally { await f.close(); }
});

test('corrupt queue identity fails closed without transmitting or erasing saved work', async () => {
 const f = await fixture(), r = remote();
 try {
  const one = command(); await f.vault.mutate(one);
  await f.db.transaction(scope, 'readwrite', gate, async tx => {
   const rows = await tx.list<any>('provider-vault-commands'); await tx.put('provider-vault-commands', rows[0].id, { ...rows[0].value, recordId: 'different-record' });
  });
  const before = await stored(f.db); await assert.rejects(f.vault.synchronize(r.transport), /sync queue is invalid/);
  assert.deepEqual(await stored(f.db), before); assert.equal(r.calls.length, 0);
 } finally { await f.close(); }
});

test('cancellation during transmission keeps its immutable request for a later verified retry', async () => {
 const f = await fixture(), r = remote(), started = deferred(), release = deferred(), controller = new AbortController(); let clock = Date.now();
 try {
  const one = command(); await f.vault.mutate(one);
  const pending = f.vault.synchronize({ write: async (...args) => { const receipt = await r.transport.write(...args); started.resolve(); await release.promise; return receipt; } }, controller.signal, () => clock);
  await started.promise; controller.abort(); release.resolve(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal((await stored(f.db)).commands.length, 1); clock += 70_000;
  assert.equal((await f.vault.synchronize(r.transport, undefined, () => clock)).completed, 1); assert.deepEqual(r.calls[0], r.calls[1]);
 } finally { release.resolve(); await f.close(); }
});
