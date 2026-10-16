import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncRun, executeSyncRun, type SyncRun } from './execute';
import { planFileSync, type SyncEntry, type SyncScope } from './reconcile';
import { fingerprintSource, type FingerprintSource } from './contentFingerprint';
import { cloudFileSyncEntry, type CloudFile } from './cloudFile';
import { prepareCloudSyncRun, parseCloudSyncRun } from './cloudWrite';
import { createCloudSyncPort } from './cloudSyncPort.client';
import { createCloudFileTransport, type CloudTransportRuntime } from './cloudTransport';
import { openSyncJournal } from './journal.client';
const scope: SyncScope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'phone' };
const bytes = new Uint8Array([1, 2, 3, 4]);
const source = (): FingerprintSource => ({ size: bytes.length, read: async (offset, size) => bytes.slice(offset, offset + size), check: () => {} });
async function fixture() {
 const fingerprint = await fingerprintSource(source());
 const entry: SyncEntry = { id: 'local-file', version: 'v1', path: 'file.bin', kind: 'file', size: bytes.length, fingerprint, sha256: null };
 let current = { ...scope }, file: CloudFile | null = null, puts = 0, starts = 0, commits = 0, lost = false, ready = false, opens = 0;
 const receipts = new Map<string, { body: string; file: CloudFile }>();
 let hook: ((path: string, body: any) => Response | null) | undefined;
 const runtime: CloudTransportRuntime = { currentScope: () => current, origin: () => scope.origin, requireCapability: async () => {},
  fetch: async (url: any, init: any) => {
   const u = new URL(String(url)), body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
   if (u.origin === 'https://storage.test') {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.referrerPolicy, 'no-referrer');
    assert.deepEqual(Object.keys(init.headers), ['x-amz-checksum-sha256']); assert.deepEqual(init.body, bytes); puts++; return new Response(null);
   }
   assert.equal(u.origin, scope.origin); assert.equal(init.headers['X-Thingtime-Expected-Actor'], scope.ownerId); assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
   assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
   const override = hook?.(u.pathname, body); if (override) return override;
   if (u.pathname === '/api/v1/files') {
    if (!body) return u.searchParams.has('operationId') ? Response.json({ ok: true, receipt: receipts.has(u.searchParams.get('operationId')!) ? { file: receipts.get(u.searchParams.get('operationId')!)!.file } : null }) : file ? Response.json({ ok: true, file }) : Response.json({ ok: false }, { status: 404 });
    const prior = receipts.get(body.operationId);
    if (prior) return prior.body === JSON.stringify(body) ? Response.json({ ok: true, file: prior.file, replayed: true }) : Response.json({ ok: false }, { status: 409 });
    if (body.expectedRevision !== (file?.revision ?? null)) return Response.json({ ok: false }, { status: 409 });
    file = { id: body.id, name: body.name, folderId: body.folderId, revision: randomUUID(), trashed: body.trashed, content: { attachmentId: 'att1', version: 'a'.repeat(64), size: bytes.length, fingerprint } };
    receipts.set(body.operationId, { body: JSON.stringify(body), file: structuredClone(file) }); commits++;
    if (lost) { lost = false; throw Error('Accepted commit response was lost'); }
    return Response.json({ ok: true, file, replayed: false });
   }
   if (u.pathname === '/api/v1/attachments/uploads') { starts++; return Response.json({ ok: true, upload: { id: 'att1', partSizeBytes: fingerprint.partSizeBytes, partCount: 1, ...(ready ? { state: 'ready' } : {}) } }); }
   if (u.pathname.endsWith('/parts')) return Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] });
   if (u.pathname.endsWith('/complete')) { ready = true; return Response.json({ ok: true }); }
   if (u.pathname.endsWith('/content')) return Response.json({ ok: true, id: 'att1', version: 'a'.repeat(64), size: bytes.length, fingerprint });
   throw Error('Unexpected request');
  } };
 const make = () => prepareCloudSyncRun(createSyncRun(planFileSync({ scope, complete: true, entries: [entry] }, { scope, complete: true, entries: [] }, { scope, entries: [] }, { mode: 'backup', propagateDeletes: false })), [{ before: null, folderId: null }]);
 const port = (run: SyncRun, persist: (run: SyncRun) => Promise<void>) => createCloudSyncPort(run, { currentScope: () => current, persist, readLocal: async () => entry, openSource: async () => { opens++; return source(); } }, runtime);
 return { make, port, runtime, entry, file: () => file, counts: () => ({ puts, starts, commits, opens }), lose: () => { lost = true; }, context: (next: SyncScope) => { current = next; }, hook: (next: typeof hook) => { hook = next; } };
}
test('real transport joins executor and durable journal, recovering a lost commit without rereading or uploading bytes', async () => {
 const f = await fixture(), factory = new IDBFactory(); let journal = await openSyncJournal(factory); const run = f.make(); f.lose();
 await assert.rejects(executeSyncRun(run, f.port(run, journal.persist)), /response was lost/);
 assert.deepEqual(f.counts(), { puts: 1, starts: 1, commits: 1, opens: 1 }); journal.close();
 journal = await openSyncJournal(factory); const restored = parseCloudSyncRun((await journal.read(scope))!);
 const result = await executeSyncRun(restored, f.port(restored, journal.persist)); assert.ok(result.operations.every(op => op.confirmed));
 assert.deepEqual(f.counts(), { puts: 1, starts: 1, commits: 1, opens: 1 }); assert.equal(f.file()!.id, run.operations[0].id); journal.close();
});
test('a failed durable write prevents every network request; pinned destinations cannot be changed on retry', async () => {
 const f = await fixture(), run = f.make();
 await assert.rejects(executeSyncRun(run, f.port(run, async () => { throw Error('disk full'); })), /disk full/); assert.equal(f.counts().starts, 0);
 const journal = await openSyncJournal(new IDBFactory()); await journal.persist(run);
 const changed = structuredClone(run); changed.cloudWrites[0].folderId = 'other-folder';
 await assert.rejects(journal.persist(changed), /cannot change/); journal.close();
});
test('completed upload is reused after interruption before file publication', async () => {
 const f = await fixture(), run = f.make(); let fail = true;
 f.hook((path, body) => { if (path === '/api/v1/files' && body && fail) { fail = false; throw Error('before commit'); } return null; });
 await assert.rejects(executeSyncRun(run, f.port(run, async () => {})), /before commit/);
 await executeSyncRun(run, f.port(run, async () => {})); assert.equal(f.counts().puts, 1); assert.equal(f.counts().commits, 1); assert.equal(f.counts().starts, 2);
});
test('stale destination, foreign receipt, wrong source bytes and context changes preserve the pending operation', async () => {
 const f = await fixture(), run = f.make(), write = run.cloudWrites[0];
 f.context({ ...scope, ownerId: 'other' }); await assert.rejects(createCloudFileTransport(f.runtime, write).apply(source()), /context changed/);
 f.context(scope); f.hook(path => path.endsWith('/uploads') ? (f.context({ ...scope, rootId: 'other' }), null) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, write).apply(source()), /context changed/); assert.equal(f.counts().puts, 0);
 f.context(scope); f.hook(undefined);
 const wrong = { ...source(), read: async () => new Uint8Array([4, 3, 2, 1]) };
 // Use a byte-agnostic PUT mock while retaining all API behavior.
 const original = f.runtime.fetch; f.runtime.fetch = async (url: any, init: any) => new URL(String(url)).origin === 'https://storage.test' ? new Response(null) : original(url, init);
 await assert.rejects(createCloudFileTransport(f.runtime, write).apply(wrong), /planned fingerprint/); assert.equal(f.counts().commits, 0);
 f.hook((path, body) => path === '/api/v1/files' && body ? Response.json({ ok: false }, { status: 409 }) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, write).apply(source()), /409/); assert.equal(f.counts().commits, 0);
 f.hook(path => path === '/api/v1/files' ? Response.json({ ok: true, receipt: { file: { id: 'foreign' } } }) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, write).lookup(), /Invalid cloud file/);
});
test('bounded responses, refused capabilities and hostile signed requests stop safely', async () => {
 const f = await fixture(), run = f.make();
 f.runtime.requireCapability = async () => { throw Error('incompatible'); };
 await assert.rejects(createCloudFileTransport(f.runtime, run.cloudWrites[0]).apply(source()), /incompatible/); assert.equal(f.counts().starts, 0);
 f.runtime.requireCapability = async () => {};
 f.hook(() => new Response('x'.repeat(65537))); await assert.rejects(createCloudFileTransport(f.runtime, run.cloudWrites[0]).lookup(), /too large/);
 f.hook(path => path.endsWith('/parts') ? Response.json({ ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', headers: { Authorization: 'forbidden' } }] }) : null);
 await assert.rejects(createCloudFileTransport(f.runtime, run.cloudWrites[0]).apply(source()), /Invalid signed/); assert.equal(f.counts().puts, 0);
});
test('remote Trash uses the pinned original attachment and a guarded receipt, without opening local bytes', async () => {
 const f = await fixture(), first = f.make(); await executeSyncRun(first, f.port(first, async () => {})); const before = f.file()!;
 const expected = cloudFileSyncEntry(before, 'file.bin');
 const run = prepareCloudSyncRun(createSyncRun({ scope, decisions: [{ kind: 'trash', path: 'file.bin', side: 'remote', expected }] }), [{ folderId: null, before }]);
 const port = createCloudSyncPort(run, { currentScope: () => scope, persist: async () => {}, readLocal: async () => null, openSource: async () => { throw Error('must not open'); } }, f.runtime);
 await executeSyncRun(run, port); assert.equal(f.file()!.trashed, true); assert.equal(f.counts().puts, 1);
});

test('full native verification prevents publication after range reads and also checks a ready upload on retry', async () => {
 const f=await fixture(),run=f.make();let checks=0;
 const pinned={...source(),verify:async()=>{checks++;throw Error('Native source changed after its ranges were read');}};
 await assert.rejects(createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(pinned),/Native source changed/);
 assert.equal(f.counts().commits,0);assert.equal(f.counts().puts,1);assert.equal(checks,1);
 await assert.rejects(createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply(pinned),/Native source changed/);
 assert.equal(f.counts().commits,0);assert.equal(f.counts().puts,1);assert.equal(checks,2);
 await createCloudFileTransport(f.runtime,run.cloudWrites[0]).apply({...source(),verify:async()=>{checks++;}});
 assert.equal(f.counts().commits,1);assert.equal(f.counts().puts,1);assert.equal(checks,3);
});
