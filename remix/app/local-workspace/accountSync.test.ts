import { createQuotaFactory } from './storageTestFixture';
import { forgetAccountConversation } from './accountReadRevocation';
import { AccountPostCache } from './accountPosts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountThingSync, type AccountThing, type AccountSyncTransport } from './accountSync';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
const setup = (factory = new IDBFactory()) => {
 const db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
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
test('deleting an owned root clears retained descendants and shared references in the same transaction', async () => {
 const f = setup(), cache = new AccountPostCache(f.db, f.scope, f.lease);
 try {
  const root = await f.sync.things.create({ thingtime: ['post'], crystal: { type: 'text', text: 'Owned root' } });
  const post = (id: string, changes: Record<string, unknown> = {}) => ({ id, thingtime: ['post'], type: 'text', text: id, createdAt: root.createdAt, author: { id: 'other' }, comments: [], ...changes });
  await cache.remember([post('reply', { thingtime: ['post', 'comment'], targetId: root.id }), post('shared', { shareOf: post(root.id) })]);
  assert.equal(await cache.get(root.id), null, 'the root itself has never been retained as a read projection');
  const transaction = f.db.transaction.bind(f.db);
  (f.db as any).transaction = (scope: any, mode: IDBTransactionMode, lease: WorkspaceLease, run: any) => transaction(scope, mode, lease, tx => run({ ...tx,
   put: async (collection: string, id: string, value: any) => {
    if (collection === 'account-post-projections' && value.post === null) throw new DOMException('Synthetic cache cleanup quota failure', 'QuotaExceededError');
    return tx.put(collection, id, value);
   }
  }));
  await assert.rejects(f.sync.remove([root.id]), /full|quota/i);
  (f.db as any).transaction = transaction;
  assert.equal((await f.sync.view(root.id))?.crystal.text, 'Owned root', 'cache failure rolls back authored deletion');
  assert.equal((await cache.get('reply'))?.id, 'reply');
  await f.sync.remove([root.id]);
  assert.equal(await f.sync.view(root.id), null);
  assert.equal(await cache.get('reply'), null);
  assert.equal((await cache.get('shared'))?.shareOf ?? null, null);
  assert.ok(await f.db.transaction(f.scope, 'readonly', f.lease, async tx => (await tx.get<any>('account-post-projections', root.id))?.deniedAt));
 } finally { await f.db.close(); }
});
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
test('an orphaned queue entry is quarantined instead of stalling every other pending write', async () => {
 const f = setup(), orphan = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Orphan' } });
 // Content that is gone while its queue entry remains must not block the pass.
 await f.db.transaction(f.scope, 'readwrite', f.lease, tx => tx.delete('things', orphan.id));
 await f.sync.sync(f.transport);
 assert.equal(f.calls.length, 0);
 assert.deepEqual((await f.sync.status()).map(entry => entry.state), ['error']);
 const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Still syncs' } });
 await f.sync.sync(f.transport);
 assert.equal(f.remote.get(row.id)!.crystal.name, 'Still syncs');
 assert.equal((await f.sync.status()).find(entry => entry.id === row.id)!.state, 'synced');
 await f.db.close();
});

test('account moves commit placement and sync intent atomically, survive reopen and wait for new destinations', async () => {
 const f = setup();
 try {
  const first = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'First' } });
  const second = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Second' } });
  await f.sync.sync(f.transport); const before = f.calls.length;
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'New offline folder' } });
  await f.sync.things.move([first.id, second.id], folder.id);
  assert.equal(f.calls.length, before);
  assert.equal((await f.sync.things.list({ folder: folder.id })).things.length, 2);
  assert.ok((await f.sync.status()).every(row => row.state === 'pending'));
  await f.db.close(); const reopened = new WorkspaceDatabase(f.factory), resumed = new AccountThingSync(reopened, f.scope, f.lease);
  try {
   assert.equal((await resumed.things.list({ folder: folder.id })).things.length, 2);
   await resumed.sync(f.transport);
   assert.equal(f.calls[before].id, folder.id);
   for (const id of [first.id, second.id]) { assert.equal(f.remote.get(id)!.folderId, folder.id); assert.deepEqual(f.remote.get(id)!.acl, ['tt:user']); }
   assert.ok((await resumed.status()).every(row => row.state === 'synced'));
   await resumed.things.move([first.id, second.id], null); await resumed.sync(f.transport);
   assert.equal(f.remote.get(first.id)!.folderId, null); assert.equal(f.remote.get(second.id)!.folderId, null);
  } finally { await reopened.close(); }
 } finally { await f.db.close(); }
});

test('account batch move rolls back content and queue together on cycles or missing sync bases', async () => {
 const f = setup();
 try {
  const parent = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Parent' } });
  const child = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Child' }, folderId: parent.id });
  const data = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Data' } });
  await f.sync.sync(f.transport); const before = await f.sync.things.get(data.id), status = await f.sync.status();
  await assert.rejects(f.sync.things.move([data.id, parent.id], child.id), /contain itself/);
  assert.deepEqual(await f.sync.things.get(data.id), before); assert.deepEqual(await f.sync.status(), status);
  const orphan = { ...before, id: 'orphaned-account-cache' };
  await f.db.transaction(f.scope, 'readwrite', f.lease, tx => tx.put('things', orphan.id, orphan));
  await assert.rejects(f.sync.things.move([data.id, orphan.id], parent.id), /Load the account Thing/);
  assert.deepEqual(await f.sync.things.get(data.id), before); assert.deepEqual(await f.sync.status(), status);
 } finally { await f.db.close(); }
});

test('a move during an ambiguous write preserves the frozen retry and syncs the later placement afterward', async () => {
 const f = setup();
 try {
  const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Moving' } });
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Destination' } });
  await f.sync.sync(f.transport);
  await f.sync.things.move([row.id], folder.id);
  await f.sync.sync({ get: async () => { throw new Error('offline'); }, write: async operation => { await f.transport.write(operation, new AbortController().signal); throw new Error('lost acknowledgement'); } });
  const frozen = structuredClone(f.calls.at(-1));
  await f.sync.things.move([row.id], null); await f.sync.retry(row.id); await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.at(-2), frozen);
  assert.equal(f.calls.at(-1).body.folderId, null); assert.equal(f.remote.get(row.id)!.folderId, null);
  assert.equal((await f.sync.status()).find(item => item.id === row.id)!.state, 'synced');
 } finally { await f.db.close(); }
});

test('a remote edit conflicts with an offline move and reviewed keep-local preserves both local content and destination', async () => {
 const f = setup();
 try {
  const row = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Before' } });
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Destination' } });
  await f.sync.sync(f.transport); await f.sync.things.move([row.id], folder.id);
  f.remote.set(row.id, { ...f.remote.get(row.id)!, crystal: { name: 'Other device' }, updatedAt: new Date(Date.now() + 60_000).toISOString() });
  await f.sync.sync(f.transport);
  const review = await f.sync.inspectConflict(f.transport, row.id);
  assert.equal(review.local.folderId, folder.id); assert.equal(review.remote.crystal.name, 'Other device');
  await f.sync.resolveConflict(f.transport, { id: row.id, keep: 'local', localRevision: review.localRevision, remoteUpdatedAt: review.remote.updatedAt });
  await f.sync.sync(f.transport);
  assert.equal(f.remote.get(row.id)!.folderId, folder.id); assert.equal(f.remote.get(row.id)!.crystal.name, 'Before');
 } finally { await f.db.close(); }
});

test('schema-based data waits for its copied definition after a failed schema sync', async () => {
 const f = setup();
 try {
  const schema = await f.sync.things.create({ thingtime: ['schema'], crystal: { name: 'Offline shape', fields: [{ name: 'note', type: 'string' }] } });
  const data = await f.sync.things.create({ thingtime: ['data'], crystal: { schemaId: schema.id, note: 'Authored offline' } });
  const attempted: string[] = [];
  await f.sync.sync({ ...f.transport, write: async op => { attempted.push(op.id); if (op.id === schema.id) throw { status: 422 }; return f.transport.write(op, new AbortController().signal); } });
  assert.deepEqual(attempted, [schema.id]); assert.equal(f.remote.size, 0);
  assert.equal((await f.sync.things.get(data.id)).crystal.note, 'Authored offline');
  await f.sync.retry(schema.id); await f.sync.sync(f.transport);
  assert.deepEqual(f.calls.map(call => call.id), [schema.id, data.id]);
  assert.equal(f.remote.get(data.id)!.crystal.schemaId, schema.id);
  assert.ok((await f.sync.status()).every(entry => entry.state === 'synced'));
 } finally { await f.db.close(); }
});


test('catalogue batches retain canonical owned content atomically without replacing pending edits or deletions', async () => {
 const f = setup(createQuotaFactory({ bytes: 1024 * 1024 })), stamp = new Date().toISOString();
 const row = (id: string, text = id) => ({ id, author: { id: 'owner' }, thingtime: ['component'], crystal: { name: text, componentKey: id, version: 1, render: { tag: 'p', children: text } }, createdAt: stamp, updatedAt: stamp, acl: ['tt:user'], visibility: 'private', revision: 1 } as AccountThing);
 try {
  await assert.rejects(f.sync.rememberMany([row('first'), { ...row('foreign'), author: { id: 'other' } }]), /belong/);
  assert.equal((await f.sync.things.snapshot()).length, 0);
  await f.sync.rememberMany([row('first'),row('second')]);
  await f.sync.things.update({ id:'first',crystal:{name:'Pending edit'} }); await f.sync.remove(['second']);
  const retained = await f.sync.rememberMany([row('first','Remote old'),row('second'),row('third')]);
  assert.equal(retained[0]?.crystal.name,'Pending edit'); assert.equal(retained[1],undefined); assert.equal(retained[2]?.id,'third');
  // The simulated browser fills during the batch after the first put.
  await assert.rejects(f.sync.rememberMany([row('rolled-back'),{...row('too-large'),extended:{text:'x'.repeat(1024*1024)}}]), /workspace is full/i);
  assert.equal(await f.sync.view('rolled-back'),null);
  await assert.rejects(f.sync.rememberMany(Array.from({length:51},(_,i)=>row(`row-${i}`))), /page/);
 } finally { await f.db.close(); }
});

test('account post and reply submissions commit locally, preserve replay identity and sync parents first', async () => {
 const f = setup();
 const postInput = { thingtime: ['post'], crystal: { type: 'text', text: 'An offline account post' }, shareId: 'account-post-replay', acl: ['tt:user'] };
 const post = await f.sync.things.savePost(postInput);
 const comment = await f.sync.things.savePost({ thingtime: ['post','comment'], crystal: { type: 'text', text: 'An offline comment' }, targetId: post.id, shareId: 'account-comment-replay' });
 const reply = await f.sync.things.savePost({ thingtime: ['post','comment'], crystal: { type: 'text', text: 'An offline reply' }, targetId: comment.id, shareId: 'account-reply-replay' });
 assert.equal(f.calls.length,0); assert.equal((await f.sync.status()).length,3);
 assert.equal((await f.sync.things.savePost(postInput)).id,post.id);
 await assert.rejects(f.sync.things.savePost({ ...postInput, crystal: { type: 'text', text: 'Different request' } }),/already used/);
 assert.equal((await f.sync.view(comment.id))?.acl[0],'tt:inherit');
 assert.equal((await f.sync.sync(f.transport)).completed,3);
 assert.deepEqual(f.calls.map(call=>call.id),[post.id,comment.id,reply.id]);
 assert.equal((await f.sync.things.savePost(postInput)).id,post.id,'same submission remains idempotent after sync receipt');
 await f.sync.things.savePost({ id:post.id,crystal:{text:'Edited offline'},expectedUpdatedAt:(await f.sync.view(post.id))!.updatedAt },true);
 assert.equal((await f.sync.view(post.id))?.crystal.text,'Edited offline');
 assert.equal((await f.sync.sync(f.transport)).completed,1);
 assert.equal(f.remote.get(post.id)?.crystal.text,'Edited offline');
 await f.db.close();
});

test('retained foreign discussions allow local reply storage but never grant server write permission', async () => {
 const f=setup();
 await f.db.transaction(f.scope,'readwrite',f.lease,tx=>tx.put('account-discussion-projections','foreign',{post:{id:'foreign'},at:Date.now(),parent:null}));
 const comment=await f.sync.things.savePost({thingtime:['post','comment'],crystal:{type:'text',text:'Local pending reply'},targetId:'foreign'});
 await f.sync.sync({...f.transport,write:async()=>{throw {status:403};}});
 assert.equal((await f.sync.status())[0].state,'error');
 assert.equal((await f.sync.view(comment.id))?.crystal.text,'Local pending reply'); assert.equal(f.remote.size,0);
 await f.db.transaction(f.scope,'readwrite',f.lease,tx=>tx.put('account-post-projections','foreign',{post:null,at:Date.now()+1,deniedAt:Date.now()+1,parent:null}));
 await assert.rejects(f.sync.things.savePost({thingtime:['post','comment'],crystal:{type:'text',text:'After refusal'},targetId:'foreign'}),/not in this workspace/);
 await f.db.close();
});


test('read refusal retires synced owned projections and fences older reads without discarding pending authorship', async()=>{
 const f=setup(),stamp=new Date().toISOString();
 const root={id:'owned-root',author:{id:'owner'},thingtime:['data'],crystal:{name:'Retained root'},createdAt:stamp,updatedAt:stamp,revision:1,acl:['tt:user'],visibility:'private'} as AccountThing;
 await f.sync.remember(root,1);
 const pending=await f.sync.things.savePost({thingtime:['post','comment'],crystal:{type:'text',text:'Keep unsynced text'},targetId:root.id});
 await f.db.transaction(f.scope,'readwrite',f.lease,tx=>forgetAccountConversation(tx,root.id,10));
 assert.equal(await f.sync.view(root.id),null);
 assert.equal((await f.sync.view(pending.id))?.crystal.text,'Keep unsynced text');
 assert.equal(await f.sync.remember(root,9),undefined);assert.equal(await f.sync.view(root.id),null);
 assert.ok(await f.sync.remember(root,11),'only a later authorized read may restore the remote snapshot');
 await f.db.close();
});


test('a post waits for linked device Things before attempting its account create',async()=>{
 const f=setup();
 const data=await f.sync.things.create({thingtime:['data'],crystal:{name:'Linked local data'}});
 const post=await f.sync.things.savePost({shareId:'0-post-with-dependency',thingtime:['post'],crystal:{type:'thingtime',text:'A linked Thing',thing:{kind:'thing-collection',items:[{id:data.id,mode:'data'}]}}});
 await f.sync.sync({...f.transport,write:async operation=>{assert.equal(operation.id,data.id);throw {status:403};}});
 assert.equal((await f.sync.status()).find(row=>row.id===post.id)?.state,'pending');
 await f.sync.retry(data.id);await f.sync.sync(f.transport);
 assert.deepEqual(f.calls.map(call=>call.id),[data.id,post.id]);
 await f.db.close();
});


test('saved pages wait for acknowledged nested Components while unrelated account writes drain', async () => {
 const f = setup();
 let sequence = 0;
 // The Component sorts LAST in IndexedDB, guaranteeing the page is considered
 // before its dependency even though the Component was authored first.
 const sync = new AccountThingSync(f.db, f.scope, f.lease, () => Date.now(), () => ++sequence === 1
  ? 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  : `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`);
 try {
  const component = await sync.things.create({ thingtime: ['component'], crystal: { name: 'Offline control', componentKey: 'offline-control', version: 1, render: { tag: 'button', children: 'Local control' } } });
  const page = await sync.things.create({ thingtime: ['webpage'], crystal: { name: 'Offline page', blocks: [
   { id: 'outer', type: 'container', children: [{ id: 'inner', type: 'container', children: [{ id: 'control', type: 'component', component: component.id }] }] },
   // Ordinary text containing an id is not a stored composition dependency.
   { id: 'description', type: 'text', text: 'unrelated-id' }
  ] } });
  const unrelated = await sync.things.create({ thingtime: ['data'], crystal: { name: 'Independent edit' } });
  const attempted: string[] = [];
  await sync.sync({ ...f.transport, write: async op => {
   attempted.push(op.id);
   if (op.id === component.id) throw { status: 422 };
   return f.transport.write(op, new AbortController().signal);
  } });
  assert.ok(attempted.includes(unrelated.id), 'An unavailable Component must not block independent content');
  assert.ok(attempted.includes(component.id));
  assert.ok(!attempted.includes(page.id), 'Never publish a page whose saved Component is still absent');
  assert.equal((await sync.status()).find(row => row.id === page.id)?.state, 'pending');
  assert.deepEqual((await sync.things.get(page.id)).crystal.blocks, page.crystal.blocks);
  await sync.retry(component.id);
  await sync.sync({ ...f.transport, write: async op => {
   if (op.id === page.id) assert.ok(f.remote.has(component.id), 'Component acknowledgment precedes page publication');
   return f.transport.write(op, new AbortController().signal);
  } });
  assert.ok(f.remote.has(page.id));
  assert.ok((await sync.status()).every(row => row.state === 'synced'));
 } finally { await f.db.close(); }
});


test('a frozen page retry recovers before a newer edit waits for its unavailable Component', async () => {
 const f = setup();
 let sequence = 0;
 const sync = new AccountThingSync(f.db, f.scope, f.lease, () => Date.now(), () => ++sequence === 1
  ? '00000000-0000-4000-8000-000000000001'
  : `ffffffff-ffff-4fff-8fff-${sequence.toString().padStart(12, '0')}`);
 try {
  const page = await sync.things.create({ thingtime: ['webpage'], crystal: { name: 'Original page', blocks: [{ id: 'text', type: 'text', text: 'Original frozen content' }] } });
  await sync.sync({ get: async () => { throw new Error('Readback unavailable'); }, write: async operation => {
   await f.transport.write(operation, new AbortController().signal);
   throw new Error('Write response lost');
  } }, undefined, 1);
  const frozen = structuredClone(f.calls[0]);
  const acknowledgedVersion = f.remote.get(page.id)!.updatedAt;
  const component = await sync.things.create({ thingtime: ['component'], crystal: { name: 'New offline control', componentKey: 'new-offline-control', version: 1, render: { tag: 'button', children: 'New control' } } });
  const newerBlocks = [{ id: 'control', type: 'component', component: component.id }];
  await sync.things.update({ id: page.id, crystal: { name: 'Newer local page', blocks: newerBlocks } });
  await sync.retry(page.id);
  const recovered = await sync.sync({ ...f.transport, write: async operation => {
   if (operation.id === component.id) throw { status: 422 };
   return f.transport.write(operation, new AbortController().signal);
  } });
  assert.equal(recovered.completed, 1, 'Recover the original request despite the newer unavailable dependency');
  assert.deepEqual(f.calls[1], frozen, 'Replay exactly the immutable original payload and operation identity');
  assert.equal(f.remote.get(page.id)?.crystal.name, 'Original page');
  assert.equal((await sync.things.get(page.id)).crystal.name, 'Newer local page');
  assert.deepEqual((await sync.things.get(page.id)).crystal.blocks, newerBlocks);
  assert.equal((await sync.status()).find(row => row.id === page.id)?.state, 'pending');
  assert.equal((await sync.status()).find(row => row.id === component.id)?.state, 'error');
  await sync.retry(component.id);
  await sync.sync(f.transport);
  const finalPageWrite = f.calls.find(call => call.id === page.id && call.method === 'update');
  assert.equal(finalPageWrite.body.expectedUpdatedAt, acknowledgedVersion);
  assert.equal(f.remote.get(page.id)?.crystal.name, 'Newer local page');
  assert.ok((await sync.status()).every(row => row.state === 'synced'));
 } finally { await f.db.close(); }
});
