import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { AccountThingSync, type AccountThing, type AccountSyncTransport } from './accountSync';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
const setup = () => {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory);
 let time = Date.now(), active = true;
 const listeners = new Set<() => void>();
 const lease: WorkspaceLease = { assertCurrent() { if (!active) throw new Error('Workspace changed'); }, onInvalidate(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
 const scope = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
 const sync = new AccountThingSync(db, scope, lease, () => time);
 const remote = new Map<string, AccountThing>(), calls: any[] = [];
 const transport: AccountSyncTransport = {
  get: async id => { if (!remote.has(id)) throw { status: 404 }; return structuredClone(remote.get(id)!); },
  write: async operation => {
   calls.push(structuredClone(operation)); const old = remote.get(operation.id);
   if (operation.method === 'create' && old) throw { status: 409 };
   if (operation.method === 'update' && (!old || old.updatedAt !== operation.body.expectedUpdatedAt)) throw { status: 409 };
   const result = { ...operation.body, id: operation.id, author: { id: 'owner' }, createdAt: old?.createdAt || new Date(time).toISOString(), updatedAt: new Date(++time).toISOString(), revision: 1 } as AccountThing;
   remote.set(result.id, result); return result;
  }
 };
 return { factory, db, sync, scope, lease, remote, transport, calls, tick: () => { time += 120000; }, invalidate: () => { active = false; listeners.forEach(fn => fn()); } };
};
test('account creates and updates commit locally first and sync canonical content', async () => {
 const f = setup(); const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Offline', value: 'first' } });
 assert.equal(f.calls.length, 0); assert.equal((await f.sync.status())[0].state, 'pending');
 await f.sync.things.update({ id: row.id, crystal: { value: 'newest' } }); await f.sync.sync(f.transport);
 assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.crystal.value, 'newest'); assert.equal(f.remote.get(row.id)!.visibility, 'private');
 await f.sync.things.update({ id: row.id, crystal: { value: 'updated' } }); await f.sync.sync(f.transport);
 assert.equal(f.calls[1].method, 'update'); assert.ok(f.calls[1].body.expectedUpdatedAt); assert.equal((await f.sync.status())[0].state, 'synced'); await f.db.close();
});
test('lost responses replay one immutable identity after database reopen', async () => {
 const f = setup(); const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Keep me' } });
 await f.sync.sync({ get: async () => { throw new Error('offline'); }, write: async operation => { await f.transport.write(operation, new AbortController().signal); throw new Error('response lost'); } });
 const first = structuredClone(f.calls[0]); f.tick(); await f.db.close();
 const reopened = new WorkspaceDatabase(f.factory), recovered = new AccountThingSync(reopened, f.scope, f.lease);
 await recovered.retry(row.id); await recovered.sync(f.transport);
 assert.deepEqual(f.calls[1], first); assert.equal(f.remote.size, 1); assert.equal((await recovered.status())[0].state, 'synced'); await reopened.close();
});
test('typing during sync retains newer edits and advances from the acknowledged server version', async () => {
 const f = setup(); const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'First' } });
 let release!: () => void, started!: () => void; const ready = new Promise<void>(r => { started = r; }), wait = new Promise<void>(r => { release = r; }); let once = true;
 const running = f.sync.sync({ ...f.transport, write: async op => { if (once) { once = false; started(); await wait; } return f.transport.write(op, new AbortController().signal); } });
 await ready; await f.sync.things.update({ id: row.id, crystal: { name: 'Typed during sync' } }); release(); await running;
 assert.equal(f.calls.length, 2); assert.equal(f.remote.get(row.id)!.crystal.name, 'Typed during sync'); assert.equal((await f.sync.things.get(row.id)).crystal.name, 'Typed during sync'); await f.db.close();
});
test('two tabs claim a write once and an invalidated identity cannot acknowledge it', async () => {
 const f = setup(), secondDb = new WorkspaceDatabase(f.factory), second = new AccountThingSync(secondDb, f.scope, f.lease);
 await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'One' } }); await Promise.all([f.sync.sync(f.transport), second.sync(f.transport)]); assert.equal(f.calls.length, 1);
 const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Retired identity' } });
 await assert.rejects(f.sync.sync({ ...f.transport, write: async op => { const result = await f.transport.write(op, new AbortController().signal); f.invalidate(); return result; } }), /Workspace changed/);
 const resumed = new AccountThingSync(secondDb, f.scope, { assertCurrent() {}, onInvalidate: () => () => {} });
 assert.equal((await resumed.status()).find(e => e.id === row.id)!.state, 'syncing'); await f.db.close(); await secondDb.close();
});
test('remote conflicts preserve edits and cannot retry as an overwrite', async () => {
 const f = setup(), row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Initial' } }); await f.sync.sync(f.transport);
 await f.sync.things.update({ id: row.id, crystal: { name: 'Local edit' } });
 f.remote.set(row.id, { ...f.remote.get(row.id)!, crystal: { name: 'Other device' }, updatedAt: new Date(Date.now() + 60000).toISOString() });
 await f.sync.sync(f.transport); assert.equal((await f.sync.status())[0].state, 'conflict'); assert.equal((await f.sync.things.get(row.id)).crystal.name, 'Local edit');
 await assert.rejects(f.sync.retry(row.id), /conflicting versions/); await f.sync.remember(f.remote.get(row.id)!); assert.equal((await f.sync.things.get(row.id)).crystal.name, 'Local edit'); await f.db.close();
});
test('anonymous and foreign content cannot sync; parents sync before children', async () => {
 const f = setup(); assert.throws(() => new AccountThingSync(f.db, { kind: 'anonymous' } as any, f.lease), /never sync/);
 const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Folder' } });
 const child = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Child' }, folderId: folder.id }); await f.sync.sync(f.transport);
 assert.deepEqual(f.calls.map(c => c.id), [folder.id, child.id]); await assert.rejects(f.sync.remember({ ...f.remote.get(child.id)!, author: { id: 'foreign' } }), /does not belong/); await f.db.close();
});
test('sync acknowledgements preserve the editor token and remote clocks do not hide new versions', async () => {
 const f = setup(), row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'First' } });
 await f.sync.sync(f.transport);
 assert.equal((await f.sync.view(row.id))!.updatedAt, row.updatedAt);
 await f.sync.remember(f.remote.get(row.id)!);
 assert.equal((await f.sync.view(row.id))!.updatedAt, row.updatedAt);
 const edit = await f.sync.things.update({ id: row.id, expectedUpdatedAt: row.updatedAt, crystal: { name: 'Next' } });
 await f.sync.sync(f.transport);
 // Local clock advances far beyond the server: a real newer remote revision
 // must still arrive, while an out-of-order older read must be ignored.
 f.tick(); const future = await f.sync.things.update({ id: row.id, expectedUpdatedAt: edit.updatedAt, crystal: { name: 'Fast clock' } });
 await f.sync.sync(f.transport); const base = f.remote.get(row.id)!;
 const remote = { ...base, crystal: { name: 'Another device' }, updatedAt: new Date(Date.parse(base.updatedAt) + 1).toISOString() };
 await f.sync.remember(remote);
 assert.equal((await f.sync.view(row.id))!.crystal.name, 'Another device');
 assert.notEqual((await f.sync.view(row.id))!.updatedAt, future.updatedAt);
 await f.sync.remember(base); assert.equal((await f.sync.view(row.id))!.crystal.name, 'Another device');
 await assert.rejects(f.sync.things.update({ id: row.id, expectedUpdatedAt: future.updatedAt, crystal: { name: 'Stale editor' } }), /another editor/);
 await f.db.close();
});
test('local tag normalization matches canonical server writes, including lost-response readback', async () => {
 const f = setup();
 const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Tags' }, tags: [' CAFÉ ', 'cafe\u0301', '💛'.repeat(45), '\ud800', ''] });
 assert.deepEqual(row.tags, ['café', '💛'.repeat(40)]);
 await f.sync.sync({ ...f.transport, write: async op => { await f.transport.write(op, new AbortController().signal); throw new Error('Lost response'); } });
 assert.equal((await f.sync.status())[0].state, 'synced'); await f.db.close();
});
test('conflict review fences both versions and keep-local uses the reviewed server version', async () => {
 const f = setup(), row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'First' } }); await f.sync.sync(f.transport);
 await f.sync.things.update({ id: row.id, crystal: { name: 'Local' } });
 const other = { ...f.remote.get(row.id)!, crystal: { name: 'Remote' }, updatedAt: new Date(Date.now() + 10000).toISOString() }; f.remote.set(row.id, other);
 await f.sync.sync(f.transport);
 const review = await f.sync.inspectConflict(f.transport, row.id);
 await f.sync.things.update({ id: row.id, crystal: { name: 'Typed after review' } });
 await assert.rejects(f.sync.resolveConflict(f.transport, { id: row.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt }), /local version changed/);
 const next = await f.sync.inspectConflict(f.transport, row.id);
 f.remote.set(row.id, { ...other, updatedAt: new Date(Date.parse(other.updatedAt) + 1).toISOString() });
 await assert.rejects(f.sync.resolveConflict(f.transport, { id: row.id, keep: 'local', localRevision: next.localRevision, remoteUpdatedAt: next.remote.updatedAt }), /account version changed/);
 const latest = await f.sync.inspectConflict(f.transport, row.id);
 await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'local', localRevision: latest.localRevision, remoteUpdatedAt: latest.remote.updatedAt });
 await f.sync.sync(f.transport); assert.equal(f.remote.get(row.id)!.crystal.name, 'Typed after review');
 assert.equal(f.calls.at(-1).body.expectedUpdatedAt, latest.remote.updatedAt);
 await f.db.close();
});
test('keep-remote is an explicit local replacement and invalidates old editor tokens', async () => {
 const f = setup(), row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'First' } }); await f.sync.sync(f.transport);
 const edit = await f.sync.things.update({ id: row.id, crystal: { name: 'Local' } });
 f.remote.set(row.id, { ...f.remote.get(row.id)!, crystal: { name: 'Remote' }, updatedAt: new Date(Date.now() + 5000).toISOString() }); await f.sync.sync(f.transport);
 const review = await f.sync.inspectConflict(f.transport, row.id); const before = f.calls.length;
 await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'remote', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
 await f.sync.sync(f.transport); assert.equal(f.calls.length, before); assert.equal((await f.sync.view(row.id))!.crystal.name, 'Remote');
 assert.equal((await f.sync.status())[0].state, 'synced');
 await assert.rejects(f.sync.things.update({ id: row.id, expectedUpdatedAt: edit.updatedAt, crystal: { name: 'Stale' } }), /another editor/); await f.db.close();
});
test('a definitive validation refusal can be corrected, while ambiguous outcomes retain their frozen request', async () => {
 const f = setup(), row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Refused' } });
 await f.sync.sync({ ...f.transport, write: async () => { throw { status: 422 }; } });
 assert.equal((await f.sync.status())[0].state, 'error');
 await f.sync.things.update({ id: row.id, crystal: { name: 'Corrected' } });
 await f.sync.retry(row.id); await f.sync.sync(f.transport);
 assert.equal(f.remote.get(row.id)!.crystal.name, 'Corrected'); assert.equal(f.calls.length, 1); await f.db.close();
});
