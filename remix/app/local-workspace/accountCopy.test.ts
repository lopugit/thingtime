import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { AccountFileSync } from './accountFiles';
import { AccountThingSync } from './accountSync';
import { exportAccountThings } from './accountExport';
import { forgetAccountConversation } from './accountReadRevocation';
import { WorkspaceDatabase } from './storage';
import { createQuotaFactory } from './storageTestFixture';
import { bundleFromPlan } from '../utils/thingTransfer/browser';

const scope = { kind: 'account', origin: 'https://copy.test', ownerId: 'owner', dataPlane: 'home' } as const;
const bytes = new TextEncoder().encode('Independent copy 独立 🌿');

test('account native copy and fork preserve local files, remap content, and never require upload', async () => {
 const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
 const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), target = new EventTarget();
 let calls = 0;
 const remote = async () => { calls++; throw Error('Unexpected remote request'); };
 Object.assign(globalThis, { window: { location: { origin: scope.origin }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target) }, indexedDB: new IDBFactory(), fetch: remote });
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
 try {
  bindLocalWorkspace(false, rootIdentity.read().generation, scope, false); rootIdentity.confirm(rootIdentity.read().generation);
  const api: any = accountApi({ things: { bulk: remote, fork: remote, import: remote, export: remote } }, { id: scope.ownerId }, scope.dataPlane);
  const folder = await api.things.create({ thingtime: ['folder'], crystal: { name: 'File source' } });
  const saved = await api.attachments.saveLocalFile({ requestId: crypto.randomUUID(), name: 'original.txt', contentType: 'text/plain', bytes, folderId: folder.id });
  const fileId = saved.attachment.id;
  await api.things.create({ thingtime: ['component'], folderId: folder.id, crystal: { name: 'File link', componentKey: 'file-link', version: 1, render: { tag: 'a', props: { href: '/api/v1/attachments/content?id=' + fileId }, children: 'Download' } } });
  const worker = accountWorkspaceWorker(scope);
  const copied = await api.things.bulk({ op: 'copy', ids: [folder.id] });
  assert.equal(copied.savedLocally, true); assert.equal(copied.filesImported, 1);
  const copiedFolder = copied.results[0].newId;
  const copiedFile = (await worker.files.library()).things.find(row => row.folderId === copiedFolder)!;
  const copiedComponent = (await worker.sync.things.snapshot()).find(row => row.folderId === copiedFolder && row.thingtime.includes('component'))!;
  assert.notEqual(copiedFile.id, fileId);
  assert.equal((copiedComponent.crystal.render as { props: { href: string } }).props.href, '/api/v1/attachments/content?id=' + copiedFile.id);
  assert.deepEqual((await worker.files.readFile(copiedFile.id)).bytes, bytes);
  const forked = await api.things.fork({ id: copiedFile.id });
  assert.equal(forked.savedLocally, true); assert.notEqual(forked.id, copiedFile.id);
  assert.deepEqual((await worker.files.readFile(forked.id)).bytes, bytes);
  assert.equal((await worker.files.status()).filter(row => row.state === 'pending').length, 3);
  assert.equal((await worker.sync.status()).find(row => row.id === copiedComponent.id)?.state, 'pending');
  await api.things.bulk({ op: 'delete', ids: [fileId] });
  assert.deepEqual((await worker.files.readFile(copiedFile.id)).bytes, bytes);
  assert.deepEqual((await worker.files.readFile(forked.id)).bytes, bytes);
  const snapshot = await api.things.export({ ids: [copiedFolder] });
  assert.equal((await bundleFromPlan(snapshot.plan)).manifest.files.length, 1);
  const retained = await worker.files.retain({ retention: async () => ({ ok: true, cacheKey: 'a'.repeat(64) + ':original', size: bytes.length,
   file: { purpose: 'file', ownerId: scope.ownerId, updatedAt: '2026-10-23T00:00:00Z', folderId: null, attachment: { id: 'canonical-file', name: 'retained.txt', size: bytes.length, contentType: 'text/plain', mediaKind: 'file' } } }), bytes: async () => bytes }, 'canonical-file');
  const aliasedCopy = await api.things.bulk({ op: 'copy', ids: [retained.row.id, 'canonical-file'] });
  assert.ok(aliasedCopy.results[0].newId); assert.equal(aliasedCopy.results[0].newId, aliasedCopy.results[1].newId);
  assert.deepEqual((await worker.files.readFile(aliasedCopy.results[1].newId)).bytes, bytes);
  const aliasedFork = await api.things.fork({ id: 'canonical-file' });
  assert.ok(aliasedFork.id); assert.deepEqual((await worker.files.readFile(aliasedFork.id)).bytes, bytes);
  const folders = Array.from({ length: 205 }, (_, index) => ({ id: `depth-${index}`, thingtime: ['folder'], crystal: { name: `Depth ${index}` }, ...(index ? { folderId: `depth-${index - 1}` } : {}) }));
  const deep = await api.things.import({ manifest: { format: 'thingtime.transfer', version: 1, roots: ['depth-0'], things: folders, files: [] } });
  await api.things.bulk({ op: 'move', ids: [copiedFolder], folderId: deep.ids['depth-204'] });
  assert.equal((await worker.sync.view(copiedFolder))?.folderId, deep.ids['depth-204']);
  await api.things.bulk({ op: 'delete', ids: Object.values(deep.ids) });
  assert.equal((await worker.sync.view(copiedFolder))?.folderId, null, 'deleting a deep ancestor chain drains the copy to its surviving parent');
  await api.things.bulk({ op: 'delete', ids: [copiedFolder] });
  assert.equal((await worker.files.readFile(copiedFile.id)).row.folderId, null);
  assert.deepEqual((await worker.files.readFile(copiedFile.id)).bytes, bytes, 'folder deletion preserves the file through its dedicated metadata queue');
  assert.equal(calls, 0);
  rootIdentity.changed(); bindLocalWorkspace(true, rootIdentity.read().generation);
  await assert.rejects(api.things.fork({ id: copiedFile.id }), /workspace changed/i);
 } finally {
  bindLocalWorkspace(true, rootIdentity.read().generation); await workspaceDatabase().close();
  Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else delete (globalThis as any).navigator;
 }
});

test('copy import rechecks deletion, refusal, missing bytes, retirement and quota inside its atomic commit', async () => {
 for (const failure of ['delete', 'refuse', 'missing-bytes', 'retire', 'quota', 'cancel'] as const) {
  const factory = createQuotaFactory(), db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
  let active = true;
  const lease = { assertCurrent() { if (!active) throw Error('Workspace changed'); }, onInvalidate: () => () => {} };
  const files = new AccountFileSync(db, scope, lease), sync = new AccountThingSync(db, scope, lease, undefined, undefined, files.contentHooks);
  try {
   const folder = await sync.things.create({ thingtime: ['folder'], crystal: { name: 'Source' } });
   const file = await files.things.saveFile({ requestId: crypto.randomUUID(), name: 'source.txt', contentType: 'text/plain', bytes, folderId: folder.id });
   const { plan } = await exportAccountThings({ ids: [folder.id] }, { sync, files, db, lease, canRefresh: () => false, remote: async () => { throw Error('Unexpected network'); } });
   const bundle = await bundleFromPlan(plan), controller = new AbortController();
   const original = db.transaction.bind(db);
   let armed = true, interrupted = false;
	   db.transaction = (async (...args: Parameters<typeof db.transaction>) => {
    if (armed && args[1] === 'readwrite') {
     armed = false;
     // This boundary is reached only after import has hashed the Blob files.
     if (failure === 'delete') await sync.remove([folder.id]);
     if (failure === 'refuse') await original(scope, 'readwrite', lease, tx => forgetAccountConversation(tx, folder.id, Date.now()));
     if (failure === 'missing-bytes') await original(scope, 'readwrite', lease, tx => tx.deleteBytes(file.id));
     if (failure === 'retire') active = false;
     if (failure === 'cancel') controller.abort();
     if (failure === 'quota') factory.capacity.records = (await original(scope, 'readonly', lease, tx => tx.usage())).records + 1;
     interrupted = true;
    }
    return original(...args);
   }) as typeof db.transaction;
   const expected = failure === 'retire' ? /Workspace changed/ : failure === 'cancel' ? /abort/i : failure === 'quota' ? { code: 'LOCAL_QUOTA' } : /no longer available/;
   await assert.rejects(sync.things.import(bundle.manifest, null, bundle.files, controller.signal, plan.assertCurrentInTransaction), expected);
   assert.equal(interrupted, true, `${failure} did not reach the prepared-copy boundary`);
   active = true; db.transaction = original;
   const rows = await sync.things.snapshot();
   assert.ok(rows.every(row => [folder.id, file.id].includes(row.id)), `${failure} left copied content`);
   assert.ok((await files.status()).every(row => row.id === file.id), `${failure} left a copied file intent`);
   assert.ok((await sync.status()).every(row => row.id === folder.id), `${failure} left a copied content intent`);
  } finally { await db.close(); }
 }
});

test('native account writers accept selections above the old 200-item operation cap', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const sync = new AccountThingSync(db, scope, lease);
 try {
  const definitions = Array.from({ length: 205 }, (_, index) => ({ id: `item-${index}`, thingtime: ['data'], crystal: { name: `Item ${index}` } }));
  const imported = await sync.things.import({ format: 'thingtime.transfer', version: 1, roots: definitions.map(row => row.id), things: definitions, files: [] });
  const folder = await sync.things.create({ thingtime: ['folder'], crystal: { name: 'Destination' } });
  await sync.things.move(imported.roots, folder.id);
  assert.equal((await sync.things.snapshot()).filter(row => row.folderId === folder.id).length, 205);
  await sync.remove(imported.roots);
  assert.deepEqual((await sync.things.snapshot()).map(row => row.id), [folder.id]);
 } finally { await db.close(); }
});

test('prepared text-only bearer exports keep their observed access fence during local copy admission', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const sync = new AccountThingSync(db, scope, lease);
 try {
  const row = await sync.things.create({ thingtime: ['data'], crystal: { name: 'Authorized text' } });
  const { plan } = await exportAccountThings({ ids: [row.id], key: 'authorized-fixture-key' }, { sync, db, lease, canRefresh: () => true,
   remote: async () => ({ ok: true, plan: { roots: [row.id], things: [{ id: row.id, thingtime: row.thingtime, crystal: row.crystal }], files: [] } }) });
  const bundle = await bundleFromPlan(plan);
  await db.transaction(scope, 'readwrite', lease, tx => forgetAccountConversation(tx, row.id, Date.now()));
  await assert.rejects(sync.things.import(bundle.manifest, null, bundle.files, undefined, plan.assertCurrentInTransaction), /no longer available/);
  assert.deepEqual((await sync.things.snapshot()).map(item => item.id), [row.id], 'authored source remains recoverable, but the refused plan cannot mint a copy');
 } finally { await db.close(); }
});

test('prepared bearer URL copies refuse a known device link removed at import admission', async () => {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), lease = { assertCurrent() {}, onInvalidate: () => () => {} };
 const files = new AccountFileSync(db, scope, lease), sync = new AccountThingSync(db, scope, lease, undefined, undefined, files.contentHooks);
 try {
  const link = await files.things.saveLinkedFile({ requestId: crypto.randomUUID(), url: 'https://example.invalid/known-link.png' });
  const post = await sync.things.savePost({ shareId: 'known-link-post', thingtime: ['post'], crystal: { type: 'text', text: 'Original' }, attachmentIds: [link.id] });
  const { transferChecksum } = await import('../utils/thingTransfer/archive');
  const remoteId = 'att_' + await transferChecksum(new TextEncoder().encode('thingtime-attachment-request-v1\0' + scope.ownerId + '\0' + link.localLinkedAttachment.requestId));
  const unexpected = async (): Promise<never> => { throw Error('URL media must not upload bytes'); };
  await files.sync({ start: unexpected, parts: unexpected, put: unexpected, complete: unexpected,
   link: async () => ({ attachment: { id: remoteId, ...link.crystal } as any, updatedAt: '2026-10-23T00:00:00Z' }) });
  assert.equal(await files.remoteId(link.id), remoteId);
  const { plan } = await exportAccountThings({ ids: [post.id], key: 'authorized-fixture-key' }, { sync, files, db, lease, canRefresh: () => true,
   remote: async () => ({ ok: true, plan: { roots: [post.id], things: [{ id: post.id, thingtime: post.thingtime, crystal: post.crystal }], files: [],
    links: [{ id: remoteId, targetId: post.id, url: link.crystal.url, mediaKind: link.crystal.mediaKind }], attachmentOrder: [remoteId] } }) });
  const bundle = await bundleFromPlan(plan); await plan.assertCurrent();
  const original = db.transaction.bind(db); let armed = true, removed = false;
  db.transaction = (async (...args: Parameters<typeof db.transaction>) => {
   if (armed && args[1] === 'readwrite') { armed = false; await files.removeBound(link.id, post.id); removed = true; }
   return original(...args);
  }) as typeof db.transaction;
  await assert.rejects(sync.things.import(bundle.manifest, null, bundle.files, undefined, plan.assertCurrentInTransaction), /not in this workspace/);
  db.transaction = original; assert.equal(removed, true);
  assert.deepEqual((await sync.things.snapshot()).map(row => row.id), [post.id]);
  assert.deepEqual((await files.status()).map(row => row.id), [link.id]);
  assert.deepEqual((await sync.status()).map(row => row.id), [post.id]);
 } finally { await db.close(); }
});
