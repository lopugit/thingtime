import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { audioOfflineCacheKey, audioAttachmentIdentity, isOfflineAudioRecord, readOfflineAudio, removeOfflineAudio, saveOfflineAudio as downloadAudio, captureOfflineAudioContext, type OfflineAudioContext } from './audioPlaybackCache';
import { WorkspaceDatabase, workspaceScopeKey, type WorkspaceLease } from '../../local-workspace/storage';
import { bindLocalWorkspace } from '../../local-workspace/runtime.client';
import { rootIdentity } from '../../utils/rootIdentity';
import type { PublicAttachment } from './attachmentTypes';

const attachment: PublicAttachment = { id: 'track', size: 5, mediaKind: 'audio', contentType: 'audio/mpeg', name: 'track.mp3' };
const scope = { kind: 'account', origin: 'https://audio.test', ownerId: 'owner', dataPlane: 'home' } as const;
const lifetime = () => {
 let current = true; const listeners = new Set<() => void>();
 const lease: WorkspaceLease = { assertCurrent: () => { if (!current) throw Error('Workspace changed'); }, onInvalidate: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; } };
 return { lease, retire: () => { current = false; listeners.forEach(callback => callback()); } };
};
const fixture = (selected: OfflineAudioContext['scope'] = scope) => {
 const local = lifetime(), remote = lifetime();
 const context: OfflineAudioContext = { scope: selected, key: workspaceScopeKey(selected), origin: scope.origin, dataPlane: selected.kind === 'account' ? selected.dataPlane : 'home', lease: local.lease, remoteLease: () => remote.lease };
 const db = new WorkspaceDatabase(new IDBFactory(), 'audio-test', 1000, IDBKeyRange);
 return { context, db, local, remote };
};
const browser = async (run: () => Promise<void>) => {
 const originalWindow = globalThis.window, originalFetch = globalThis.fetch;
 (globalThis as any).window = { location: { origin: scope.origin } };
 try { await run(); } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete (globalThis as any).window; else globalThis.window = originalWindow; }
};
const receiptKey = 'a'.repeat(64) + ':original';
const success = (source?: any, bytes = 'sound') => new URL(String(source || '/'), scope.origin).searchParams.get('cache') === 'validate' ? Response.json({ ok: true, cacheKey: receiptKey, size: 5 }) : new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5', ETag: `"${receiptKey}:v1"` } });
const saveOfflineAudio = (...args: Parameters<typeof downloadAudio>) => downloadAudio(args[0], args[1], args[2], { requireCapability: async () => {}, ...args[3] });

test('cache identity includes origin, selected plane, principal, Character and exact attachment bytes metadata', () => {
 const contexts = [scope, { ...scope, origin: 'https://other.test' }, { ...scope, dataPlane: 'custom-' + 'a'.repeat(64) }, { ...scope, ownerId: 'other' }, { ...scope, ownerId: 'actor', delegatedBy: 'owner' }, { ...scope, ownerId: 'actor' }].map(selected => fixture(selected).context);
 assert.equal(new Set(contexts.map(context => audioOfflineCacheKey(attachment, context))).size, contexts.length);
 assert.notEqual(audioAttachmentIdentity(attachment), audioAttachmentIdentity({ ...attachment, size: 6 }));
 const context = contexts[0], record = { version: 'v2', key: audioOfflineCacheKey(attachment, context), contentType: 'audio/mpeg', contentIdentity: 'b'.repeat(64), size: 5, cachedAt: 123 };
 assert.equal(isOfflineAudioRecord(record, attachment, context), true);
 for (const altered of [{ ...record, version: 'v1' }, { ...record, cachedAt: NaN }, { ...record, size: 4 }, { ...record, contentType: 'audio/mp4' }]) assert.equal(isOfflineAudioRecord(altered, attachment, context), false);
 for (const foreign of contexts.slice(1)) assert.equal(isOfflineAudioRecord(record, attachment, foreign), false);
});

test('saved bytes are partitioned, accounted, removed atomically and invalid metadata cannot seed playback', async () => browser(async () => {
 const { context, db } = fixture(); globalThis.fetch = async source => success(source);
 await saveOfflineAudio(attachment, context, undefined, { db });
 assert.equal(await (await readOfflineAudio(attachment, context, db))!.text(), 'sound');
 const usage = await db.transaction(scope, 'readonly', context.lease, tx => tx.usage()); assert.equal(usage.records, 2); assert.ok(usage.bytes > attachment.size);
 for (const foreign of [{ ...scope, ownerId: 'other' }, { ...scope, origin: 'https://other.test' }, { ...scope, dataPlane: 'custom-' + 'b'.repeat(64) }, { ...scope, ownerId: 'actor', delegatedBy: scope.ownerId }]) assert.equal(await readOfflineAudio(attachment, fixture(foreign).context, db), null);
 assert.equal(await readOfflineAudio({ ...attachment, size: 6 }, context, db), null);
 assert.deepEqual(await db.transaction(scope, 'readonly', context.lease, tx => tx.usage()), usage);
 assert.equal(await (await readOfflineAudio(attachment, context, db))!.text(), 'sound', 'A stale descriptor must preserve the valid current copy');
 await removeOfflineAudio(attachment, context, db);
 assert.deepEqual(await db.transaction(scope, 'readonly', context.lease, tx => tx.usage()), { records: 0, bytes: 0 });
 assert.equal(await readOfflineAudio(attachment, context, db), null); await db.close();
}));

test('untrusted v1 or mismatched records and orphan binary data never seed playback', async () => browser(async () => {
 const { context, db } = fixture();
 for (const record of [{ version: 'v1', attachmentId: 'track', viewerId: 'owner', contentType: 'audio/mpeg', cachedAt: 123 }, { version: 'v2', key: audioOfflineCacheKey(attachment, fixture({ ...scope, origin: 'https://other.test' }).context), contentType: 'audio/mpeg', contentIdentity: 'b'.repeat(64), size: 5, cachedAt: 123 }]) {
  await db.transaction(scope, 'readwrite', context.lease, async tx => { await tx.put('audio-playback-v2', attachment.id, record); await tx.putBlob('audio-playback:' + attachment.id, new Blob(['sound'], { type: 'audio/mpeg' })); });
  assert.equal(await readOfflineAudio(attachment, context, db), null);
 }
 await db.close();
}));

test('late downloads cannot persist after workspace, confirmation or selected-track cancellation', async () => browser(async () => {
 for (const retire of ['local', 'remote', 'selection'] as const) {
  const f = fixture(), selection = new AbortController(); let finish!: (response: Response) => void, started!: () => void; const waiting = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (_source, options) => { assert.ok(options?.signal); return new Promise<Response>(resolve => { finish = resolve; started(); }); };
  const save = saveOfflineAudio(attachment, f.context, undefined, { db: f.db, signal: selection.signal });
  await waiting;
  if (retire === 'selection') selection.abort(); else f[retire].retire();
  finish(success('/api/v1/attachments/content?cache=validate')); await assert.rejects(save, /Workspace changed|abort/i);
  assert.deepEqual(await f.db.transaction(scope, 'readonly', lifetime().lease, tx => tx.usage()), { records: 0, bytes: 0 }); await f.db.close();
 }
}));

test('downloads carry exact actor/plane fences and reject borrowed shared or device grants before fetching', async () => browser(async () => {
 const f = fixture({ ...scope, ownerId: 'actor', delegatedBy: scope.ownerId }); let calls = 0;
 globalThis.fetch = async (source, options) => {
  calls++; const url = new URL(String(source), scope.origin); assert.equal(url.searchParams.get('character'), null); assert.equal(url.searchParams.get('id'), 'track');
  const headers = new Headers(options?.headers); assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home'); assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'actor'); assert.equal(headers.get('X-Thingtime-Character'), 'actor');
  if (url.searchParams.get('cache') === 'original-bytes') assert.equal(headers.get('If-Match'), `"${receiptKey}:v1"`);
  return success(source);
 };
 await saveOfflineAudio(attachment, f.context, url => url + '&character=actor', { db: f.db });
 for (const url of ['/api/v1/attachments/content?id=track&key=secret', '/api/v1/attachments/content?id=track&sharedRoot=page', '/api/v1/attachments/content?id=track&character=other', '/api/v1/attachments/content?id=other', 'blob:https://audio.test/example', 'https://foreign.test/api/v1/attachments/content?id=track']) await assert.rejects(saveOfflineAudio(attachment, f.context, () => url, { db: f.db }), /context/);
 await assert.rejects(saveOfflineAudio(attachment, f.context, () => '', { db: f.db }), /not ready/);
 assert.equal(calls, 3); await f.db.close();
}));

test('exact-size reads refuse oversized/incomplete bytes; known refusal removes a copy but transient failure preserves it', async () => browser(async () => {
 const f = fixture(); globalThis.fetch = async source => success(source); await saveOfflineAudio(attachment, f.context, undefined, { db: f.db });
 for (const status of [500, 503]) { globalThis.fetch = async () => new Response(null, { status }); await assert.rejects(saveOfflineAudio(attachment, f.context, undefined, { db: f.db })); assert.ok(await readOfflineAudio(attachment, f.context, f.db)); }
 for (const bytes of ['soun', 'sound-too-large']) { globalThis.fetch = async source => success(source, bytes); await assert.rejects(saveOfflineAudio(attachment, f.context, undefined, { db: f.db }), /incomplete|exceeds/); }
 for (const status of [401, 403, 404, 410]) { globalThis.fetch = async source => success(source); await saveOfflineAudio(attachment, f.context, undefined, { db: f.db }); globalThis.fetch = async () => Response.json({ ok: false, error: 'Not available' }, { status }); await assert.rejects(saveOfflineAudio(attachment, f.context, undefined, { db: f.db })); assert.equal(await readOfflineAudio(attachment, f.context, f.db), null); }
 await f.db.close();
}));

test('context capture follows only the current root workspace and keeps delegation distinct', async () => browser(async () => {
 bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
 assert.equal(captureOfflineAudioContext('owner', 'home')?.key, workspaceScopeKey(scope));
 assert.equal(captureOfflineAudioContext('actor', 'home')?.key, workspaceScopeKey({ ...scope, ownerId: 'actor', delegatedBy: scope.ownerId }));
 assert.equal(captureOfflineAudioContext('owner', 'custom-' + 'a'.repeat(64)), null);
 rootIdentity.changed(); assert.equal(captureOfflineAudioContext('owner', 'home'), null); assert.equal(captureOfflineAudioContext(null, 'home'), null);
 rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
 const offline = captureOfflineAudioContext(null, 'home')!; offline.lease.assertCurrent(); assert.throws(() => offline.remoteLease().assertCurrent(), /offline/);
 bindLocalWorkspace(true, rootIdentity.read().generation); assert.ok(captureOfflineAudioContext(null, 'home')); assert.equal(captureOfflineAudioContext('actor', 'home'), null);
}));

test('exact-version preconditions and a final receipt prevent admission of changed content', async () => browser(async () => {
 for (const failure of ['etag', 'length', 'version', 'size'] as const) {
  const f = fixture(); let receipts = 0;
  globalThis.fetch = async source => {
   const validating = new URL(String(source), scope.origin).searchParams.get('cache') === 'validate';
   if (validating) { receipts++; return Response.json({ ok: true, cacheKey: (failure === 'version' && receipts > 1 ? 'b'.repeat(64) + ':original' : receiptKey), size: failure === 'size' ? 6 : 5 }); }
   return new Response('sound', { headers: { 'Content-Length': failure === 'length' ? '6' : '5', ETag: failure === 'etag' ? '"changed"' : `"${receiptKey}:v1"` } });
  };
  await assert.rejects(saveOfflineAudio(attachment, f.context, undefined, { db: f.db }), /changed|match/);
  assert.deepEqual(await f.db.transaction(scope, 'readonly', f.context.lease, tx => tx.usage()), { records: 0, bytes: 0 }); await f.db.close();
 }
}));

test('identity invalidation during Blob persistence aborts metadata, bytes and usage together', async () => browser(async () => {
 const f = fixture(); globalThis.fetch = async source => success(source);
 const transaction = f.db.transaction.bind(f.db);
 f.db.transaction = (selected, mode, lease, run) => transaction(selected, mode, lease, tx => run({ ...tx, putBlob: async (id, bytes) => { await tx.putBlob(id, bytes); f.local.retire(); } }));
 await assert.rejects(saveOfflineAudio(attachment, f.context, undefined, { db: f.db }), /Workspace changed/);
 assert.deepEqual(await transaction(scope, 'readonly', lifetime().lease, tx => tx.usage()), { records: 0, bytes: 0 }); await f.db.close();
}));

test('public anonymous downloads use ordinary authorization; missing capability never starts a byte request', async () => browser(async () => {
 const f = fixture({ kind: 'anonymous' }); let calls = 0;
 globalThis.fetch = async (source, options) => { calls++; assert.equal(new Headers(options?.headers).has('X-Thingtime-Expected-Actor'), false); return success(source); };
 await saveOfflineAudio(attachment, f.context, undefined, { db: f.db }); assert.equal(calls, 3); assert.ok(await readOfflineAudio(attachment, f.context, f.db));
 await assert.rejects(saveOfflineAudio(attachment, f.context, undefined, { db: f.db, requireCapability: async () => { throw Error('Incompatible selected origin'); } }), /Incompatible/);
 assert.equal(calls, 3); await f.db.close();
}));


test('stale MIME and anonymous-plane readers preserve the newer exact saved copy', async () => browser(async () => {
 const f = fixture({ kind: 'anonymous' });
 const home = { ...f.context, key: JSON.stringify(['anonymous', scope.origin, 'home']) };
 const other = { ...home, key: JSON.stringify(['anonymous', scope.origin, 'custom-' + 'a'.repeat(64)]), dataPlane: 'custom-' + 'a'.repeat(64) };
 const current = { ...attachment, contentType: 'audio/wav' }; globalThis.fetch = async source => success(source);
 await saveOfflineAudio(current, home, undefined, { db: f.db });
 const before = await f.db.transaction(home.scope, 'readonly', home.lease, tx => tx.usage());
 assert.equal(await readOfflineAudio(attachment, home, f.db), null);
 assert.equal(await readOfflineAudio(current, other, f.db), null);
 assert.deepEqual(await f.db.transaction(home.scope, 'readonly', home.lease, tx => tx.usage()), before);
 assert.equal(await (await readOfflineAudio(current, home, f.db))!.text(), 'sound');
 await f.db.close();
}));

test('corruption cleanup requires an exact matching descriptor rather than a foreign cache key', async () => browser(async () => {
 const f = fixture(); globalThis.fetch = async source => success(source);
 await saveOfflineAudio(attachment, f.context, undefined, { db: f.db });
 await f.db.transaction(scope, 'readwrite', f.context.lease, async tx => {
  const record = await tx.get<any>('audio-playback-v2', attachment.id); await tx.put('audio-playback-v2', attachment.id, { ...record, cachedAt: null });
 });
 assert.equal(await readOfflineAudio({ ...attachment, size: 6 }, f.context, f.db), null);
 assert.equal((await f.db.transaction(scope, 'readonly', f.context.lease, tx => tx.usage())).records, 2, 'An unmatched reader cannot clean even a malformed foreign descriptor');
 assert.equal(await readOfflineAudio(attachment, f.context, f.db), null);
 assert.deepEqual(await f.db.transaction(scope, 'readonly', f.context.lease, tx => tx.usage()), { records: 0, bytes: 0 }); await f.db.close();
}));
