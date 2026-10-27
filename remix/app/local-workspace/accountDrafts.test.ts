import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountDraftSync, type AccountDraftTransport } from './accountDrafts';
import { WorkspaceDatabase } from './storage';
import { type AccountDraft, type DraftContent } from '../drafts/draftCore';

const content = (text: string): DraftContent => ({ name: 'Device draft', surface: 'post', context: 'post:new:', snapshot: JSON.stringify({ text }), attachmentIds: [] });
function fixture() {
 const factory = new IDBFactory(), db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', ownerId: 'owner', origin: 'https://draft.test', dataPlane: 'home' } as const;
 let now = Date.now(), live = true;
 const listeners = new Set<() => void>();
 const lease = { assertCurrent() { if (!live) throw new Error('Retired workspace'); }, onInvalidate(callback: () => void) { listeners.add(callback); return () => { listeners.delete(callback); }; } };
 const service = new AccountDraftSync(db, scope, lease, {}, () => now);
 const remote = new Map<string, { draft: AccountDraft; writeId: string; deleted?: boolean }>(), calls: any[] = [];
 const transport: AccountDraftTransport = {
  read: async id => { const found = remote.get(id); if (!found || found.deleted) throw { status: 404 }; return structuredClone(found.draft); },
  write: async command => {
   calls.push(structuredClone(command));
   const before = remote.get(command.id);
   if (command.operation === 'delete') {
    if (!before) throw { status: 404 };
    if (before.deleted) return { ok: true };
    if (before.draft.revision !== command.revision) throw { status: 409 };
    before.deleted = true; return { ok: true };
   }
   if (before?.deleted) throw { status: 410 };
   if (before?.writeId === command.writeId) return { ok: true, draft: structuredClone(before.draft) };
   if ((before?.draft.revision || 0) !== command.revision) throw { status: 409 };
   const stamp = new Date(++now).toISOString();
   const draft: AccountDraft = { ...command.content, id: command.id, mode: command.mode, revision: command.revision + 1, createdAt: before?.draft.createdAt || stamp, updatedAt: stamp };
   remote.set(command.id, { draft, writeId: command.writeId }); return { ok: true, draft: structuredClone(draft) };
  }
 };
 let writes = 0;
 const save = (text: string, revision = 0, id = 'draft') => service.drafts.request({ operation: 'save', id, revision, writeId: 'write-' + ++writes, content: content(text) });
 return { db, scope, lease, service, transport, remote, calls, save, advance() { now += 65_000; }, retire() { live = false; listeners.forEach(fn => fn()); } };
}

test('account drafts complete locally with canonical retries, list/load and independent remote revisions', async () => {
 const f = fixture(); try {
  const first = await f.save('first'); await f.save('second', first.draft.revision);
  assert.equal(f.calls.length, 0); assert.equal((await f.service.drafts.request(undefined, { id: 'draft' })).draft.revision, 2);
  assert.equal((await f.service.sync(f.transport)).completed, 1);
  assert.equal(f.remote.get('draft')!.draft.snapshot, content('second').snapshot);
  assert.equal(f.remote.get('draft')!.draft.revision, 1, 'Unsent device writes coalesce without inventing remote revisions');
  assert.equal((await f.service.drafts.request(undefined, { id: 'draft' })).draft.revision, 2, 'Sync does not invalidate editor revision');
  await f.save('third', 2); await f.service.sync(f.transport);
  assert.equal(f.remote.get('draft')!.draft.revision, 2);
  assert.equal((await f.service.drafts.request()).drafts[0].revision, 3);
 } finally { await f.db.close(); }
});

test('uncertain writes retain their exact identity across reconstruction and before newer edits', async () => {
 const f = fixture(); try {
  await f.save('before loss');
  await f.service.sync({ ...f.transport, write: async command => { await f.transport.write(command, new AbortController().signal); throw new Error('Response lost'); } });
  await f.save('typed after loss', 1); f.advance();
  const restarted = new AccountDraftSync(f.db, f.scope, f.lease);
  await restarted.sync(f.transport);
  assert.deepEqual(f.calls[1], f.calls[0]);
  assert.notEqual(f.calls[2].writeId, f.calls[0].writeId);
  assert.equal(f.remote.get('draft')!.draft.snapshot, content('typed after loss').snapshot);
  assert.equal(f.remote.get('draft')!.draft.revision, 2);
 } finally { await f.db.close(); }
});

test('retirement is local and deletion follows an already-started uncertain save without resurrection', async () => {
 const f = fixture(); try {
  const first = await f.save('never sent'); await f.service.drafts.request({ operation: 'delete', id: 'draft', revision: first.draft.revision });
  await f.service.sync(f.transport); assert.deepEqual(f.calls, []);
  await assert.rejects(f.save('late save', 1), /discarded or published/);
  await f.save('in flight', 0, 'started');
  await f.service.sync({ ...f.transport, write: async command => { await f.transport.write(command, new AbortController().signal); throw new Error('Response lost'); } });
  await f.service.drafts.request({ operation: 'delete', id: 'started', revision: 1 });
  assert.equal((await f.service.drafts.request()).drafts.length, 0);
  f.advance(); await f.service.sync(f.transport);
  assert.deepEqual(f.calls[1], f.calls[0]); assert.equal(f.calls[2].operation, 'delete');
  assert.equal(f.remote.get('started')!.deleted, true);
  await assert.rejects(f.save('late replay', 1, 'started'), /discarded or published/);
 } finally { await f.db.close(); }
});

test('two workers claim once and a completion preserves a newer local edit', async () => {
 const f = fixture(); let release!: () => void; try {
  await f.save('old');
  let entered!: () => void; const ready = new Promise<void>(r => { entered = r; }), hold = new Promise<void>(r => { release = r; });
  const syncing = f.service.sync({ ...f.transport, write: async command => { entered(); await hold; return f.transport.write(command, new AbortController().signal); } }, undefined, 1);
  await ready; await f.save('newer', 1);
  assert.equal((await new AccountDraftSync(f.db, f.scope, f.lease).sync(f.transport)).completed, 0);
  release(); await syncing;
  assert.equal((await f.service.drafts.request(undefined, { id: 'draft' })).draft.snapshot, content('newer').snapshot);
  await f.service.sync(f.transport); assert.equal(f.remote.get('draft')!.draft.snapshot, content('newer').snapshot);
 } finally { release?.(); await f.db.close(); }
});

test('remote conflicts keep both versions and reviewed replacement checks both revisions', async () => {
 const f = fixture(); try {
  await f.save('initial'); await f.service.sync(f.transport);
  const other = f.remote.get('draft')!; other.draft = { ...other.draft, ...content('other device'), revision: 2 }; other.writeId = 'other';
  await f.save('my new input', 1); await f.service.sync(f.transport);
  assert.equal((await f.service.status())[0].state, 'conflict');
  const review = await f.service.inspect(f.transport, 'draft');
  assert.equal(review.local.snapshot, content('my new input').snapshot); assert.equal(review.remote!.snapshot, content('other device').snapshot);
  await f.save('typed during review', 2);
  await assert.rejects(f.service.keepLocal(f.transport, { id: 'draft', localRevision: review.localRevision, remoteRevision: 2 }), /Review it again/);
  await f.service.keepLocal(f.transport, { id: 'draft', localRevision: 3, remoteRevision: 2 });
  await f.service.sync(f.transport); assert.equal(f.remote.get('draft')!.draft.snapshot, content('typed during review').snapshot);
 } finally { await f.db.close(); }
});

test('late remote reads never overwrite local edits or a discarded draft', async () => {
 const f = fixture(); try {
  await f.save('account copy'); await f.service.sync(f.transport);
  const remote = await f.transport.read('draft'), started = Date.now();
  await f.save('local editing', 1);
  assert.equal(await f.service.remember(remote, started), false);
  await f.service.drafts.request({ operation: 'delete', id: 'draft', revision: 2 });
  assert.equal(await f.service.remember(remote, Date.now() + 1000), false);
  assert.deepEqual((await f.service.drafts.request()).drafts, []);
 } finally { await f.db.close(); }
});

test('account boundaries, failed queue admission and scope retirement cannot leak or partly save a draft', async () => {
 const f = fixture(); try {
  assert.throws(() => new AccountDraftSync(f.db, { kind: 'anonymous' }, f.lease), /Anonymous drafts/);
  await f.save('private');
  for (const scope of [{ ...f.scope, ownerId: 'other' }, { ...f.scope, dataPlane: 'other' }, { ...f.scope, origin: 'https://other.test' }])
   assert.deepEqual((await new AccountDraftSync(f.db, scope, f.lease).drafts.request()).drafts, []);
  const original = f.db.transaction.bind(f.db);
  f.db.transaction = (scope, mode, lease, run) => original(scope, mode, lease, tx => run({ ...tx, put: async (collection, id, row) => { if (collection === 'account-drafts') throw Error('Quota'); await tx.put(collection, id, row); } }));
  await assert.rejects(f.save('must roll back', 1), /Quota/); f.db.transaction = original;
  assert.equal((await f.service.drafts.request(undefined, { id: 'draft' })).draft.snapshot, content('private').snapshot);
  await assert.rejects(f.service.sync({ ...f.transport, write: async command => { f.retire(); return f.transport.write(command, new AbortController().signal); } }), /Retired workspace/);
 } finally { await f.db.close(); }
});

test('a malformed acknowledgement never advances the account revision or drops the frozen save', async () => {
 const f = fixture(); try {
  await f.save('exact');
  await f.service.sync({ ...f.transport, write: async command => { const reply = await f.transport.write(command, new AbortController().signal); return { ...reply, draft: { ...reply.draft!, ...content('wrong') } }; } });
  assert.equal((await f.service.status())[0].state, 'pending'); f.advance();
  await f.service.sync(f.transport); assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal((await f.service.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});


test('rate-limited uncertain saves respect the server delay and preserve their immutable body', async () => {
 const f = fixture(); try {
  await f.save('rate limited');
  await f.service.sync({ ...f.transport, write: async command => { f.calls.push(structuredClone(command)); throw { status: 429, retryAfterMs: 120_000 }; } });
  f.advance(); await f.service.sync(f.transport); assert.equal(f.calls.length, 1);
  f.advance(); await f.service.sync(f.transport); assert.deepEqual(f.calls[1], f.calls[0]);
  assert.equal((await f.service.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});

test('invalid acknowledgement snapshots retain the uncertain save and report a bounded protocol error', async () => {
 const f = fixture(); try {
  await f.save('valid input');
  await f.service.sync({ ...f.transport, write: async command => { const response = await f.transport.write(command, new AbortController().signal); return { ...response, draft: { ...response.draft!, snapshot: 'invalid JSON' } }; } });
  assert.equal((await f.service.status())[0].state, 'pending');
  assert.match((await f.service.status())[0].error!, /invalid draft snapshot/);
  f.advance(); await f.service.sync(f.transport); assert.deepEqual(f.calls[1], f.calls[0]);
  assert.equal((await f.service.status())[0].state, 'synced');
 } finally { await f.db.close(); }
});


test('conflict reads are cancelled and refused before transport after scope retirement', async () => {
 const f = fixture(); try {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let calls = 0;
  const transport = { ...f.transport, read: async (_id: string, signal?: AbortSignal): Promise<AccountDraft> => {
   calls++; entered();
   return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(Error('Retired read')), { once: true }));
  } };
  const reviewing = f.service.inspect(transport, 'draft');
  await ready; f.retire(); await assert.rejects(reviewing, /Retired|interrupted|cancelled/i);
  await assert.rejects(f.service.keepLocal(transport, { id: 'draft', localRevision: 1, remoteRevision: 1 }), /Retired workspace/);
  assert.equal(calls, 1);
 } finally { await f.db.close(); }
});

test('keeping the reviewed account version fences both revisions and creates a fresh local revision',async()=>{
 const f=fixture();try{
  await f.save('initial');await f.service.sync(f.transport);
  const other=f.remote.get('draft')!;other.draft={...other.draft,...content('account edit'),revision:2};other.writeId='other';
  await f.save('device edit',1);await f.service.sync(f.transport);
  const review=await f.service.inspect(f.transport,'draft');
  await assert.rejects(f.service.acceptReviewed({...review.remote!,revision:3},review.localRevision,2,Date.now()+1000),/account draft changed/);
  await f.save('typing during review',2);
  await assert.rejects(f.service.acceptReviewed(review.remote!,review.localRevision,2,Date.now()+1000),/device draft changed/);
  const accepted=await f.service.acceptReviewed(review.remote!,3,2,Date.now()+1000);
  assert.equal(accepted.revision,4);assert.equal(accepted.snapshot,content('account edit').snapshot);
  assert.equal((await f.service.status())[0].state,'synced');
  await assert.rejects(f.save('stale editor',3),/changed/i);
  await f.save('next edit',4);await f.service.sync(f.transport);
  assert.equal(f.remote.get('draft')!.draft.revision,3);
  assert.equal(f.remote.get('draft')!.draft.snapshot,content('next edit').snapshot);
 }finally{await f.db.close();}
});
