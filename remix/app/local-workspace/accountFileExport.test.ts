import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync } from './accountFiles';
import { AccountThingSync } from './accountSync';
import { exportAccountThings } from './accountExport';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';

function setup() {
 const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', ownerId: 'owner', origin: 'https://files.test', dataPlane: 'home' } as const;
 let active = true;
 const lease = { assertCurrent() { if (!active) throw Error('Workspace changed'); }, onInvalidate: () => () => {} };
 const sync = new AccountThingSync(db, scope, lease), files = new AccountFileSync(db, scope, lease);
 const deps = { sync, files, db, lease, canRefresh: () => false, remote: async () => { throw Error('Unexpected remote export'); } };
 const bytes = new TextEncoder().encode('An independent offline file.');
 const save = (folderId?: string) => files.things.saveFile({ requestId: randomUUID(), name: 'original.txt', contentType: 'text/plain', bytes, folderId });
 const retain = async () => (await files.retain({ retention: async () => ({ ok: true, cacheKey: 'a'.repeat(64) + ':original', size: bytes.length,
  file: { purpose: 'file', ownerId: scope.ownerId, updatedAt: '2026-10-17T00:00:00Z', folderId: null, attachment: { id: 'canonical-file', name: 'existing.txt', size: bytes.length, contentType: 'text/plain', mediaKind: 'file' } } }), bytes: async () => bytes }, 'canonical-file')).row;
 return { db, scope, lease, sync, files, deps, bytes, save, retain, retire() { active = false; } };
}

test('account folder ZIP uses saved annotated files and round-trips exact bytes through the normal local importer', async () => {
 const f = setup(); try {
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Offline folder' } });
  const note = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Offline note' }, folderId: folder.id });
  const file = await f.save(folder.id);
  await f.files.things.annotateFile({ id: file.id, title: 'Offline file title', description: 'Portable description', filenamePreview: 'Display name' });
  const result = await exportAccountThings({ ids: [folder.id] }, f.deps);
  assert.equal(result.localWorkspace, true);
  const bundle = await bundleFromPlan(result.plan); validateTransfer(bundle.manifest);
  assert.deepEqual(new Set(bundle.manifest.things.map(row => row.id)), new Set([folder.id, note.id, file.id]));
  assert.equal(bundle.manifest.files.length, 1); assert.equal(bundle.manifest.files[0].title, 'Offline file title');
  assert.equal(bundle.manifest.files[0].description, 'Portable description'); assert.equal(bundle.manifest.files[0].filenamePreview, 'Display name');
  assert.deepEqual(bundle.files.get(bundle.manifest.files[0].id), f.bytes);
  assert.doesNotMatch(serializeTransfer(bundle.manifest), /"author"|"acl"|"localAttachment"|"requestId"|"accountFileId"|"revision"/);
  const copies = new LocalThings(f.db, { kind: 'anonymous' }, f.lease);
  const imported = await copies.import(bundle.manifest, null, bundle.files);
  assert.notEqual(imported.idMap[file.id], file.id); assert.equal((await copies.get(imported.idMap[file.id])).folderId, imported.idMap[folder.id]);
  assert.deepEqual((await copies.readFile(imported.idMap[file.id])).bytes, f.bytes);
  const again = await copies.export(imported.roots);
  assert.equal(again.manifest.files[0].sha256, bundle.manifest.files[0].sha256);
  assert.equal(again.manifest.files[0].title, 'Offline file title');
 } finally { await f.db.close(); }
});

test('canonical retained file aliases export the current local metadata once without inventing upload identity', async () => {
 const f = setup(); try {
  const file = await f.retain(); await f.files.things.annotateFile({ id: file.id, title: 'Edited before sync' });
  const result = await exportAccountThings({ ids: ['canonical-file', file.id] }, f.deps);
  const bundle = await bundleFromPlan(result.plan);
  assert.deepEqual(bundle.manifest.roots, [file.id]); assert.equal(bundle.manifest.files.length, 1);
  assert.equal(bundle.manifest.files[0].title, 'Edited before sync'); assert.deepEqual(bundle.files.get(bundle.manifest.files[0].id), f.bytes);
  assert.equal((await f.files.views([file.id]))[0].localAttachment.requestId, undefined);
  assert.equal((await f.sync.status()).length, 0);
  await assert.rejects(exportAccountThings({ ids: ['canonical-file'], includeFiles: false }, f.deps), /include file bytes/);
 } finally { await f.db.close(); }
});

test('local page media references to retained account aliases become independent portable file references', async () => {
 const f = setup(); try {
  const file = await f.retain();
  const component = await f.sync.things.create({ thingtime: ['component'], crystal: { name: 'File link', componentKey: 'file-link', version: 1, render: { tag: 'a', props: { href: '/api/v1/attachments/content?id=canonical-file' }, children: 'Download file' } } });
  const page = await f.sync.things.create({ thingtime: ['webpage'], crystal: { name: 'File page', blocks: [{ id: 'file', type: 'component', component: component.id }] } });
  const result = await exportAccountThings({ ids: [page.id] }, f.deps);
  const bundle = await bundleFromPlan(result.plan);
  assert.equal(bundle.manifest.files.length, 1);
  assert.equal(bundle.manifest.files[0].id, file.id + ':bytes');
  assert.doesNotMatch(serializeTransfer(bundle.manifest), /canonical-file/);
  assert.deepEqual(bundle.files.get(bundle.manifest.files[0].id), f.bytes);
  await f.sync.sync({ get: async () => { throw { status: 404 }; }, write: async op => ({ id: op.id, thingtime: op.body.thingtime as string[], crystal: op.body.crystal as any, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:01Z', revision: 1, author: { id: f.scope.ownerId }, acl: ['tt:user'], visibility: 'private' }) });
  const after = await bundleFromPlan((await exportAccountThings({ ids: [page.id] }, f.deps)).plan);
  assert.equal(serializeTransfer(after.manifest), serializeTransfer(bundle.manifest));
 } finally { await f.db.close(); }
});

test('cancelled and deleted account files cannot reappear from a retained export snapshot', async () => {
 const f = setup(); try {
  const folder = await f.sync.things.create({ thingtime: ['folder'], crystal: { name: 'Folder' } });
  const file = await f.save(folder.id);
  assert.equal((await exportAccountThings({ ids: [folder.id] }, f.deps)).plan.files.length, 1);
  await f.files.cancel(file.id);
  const result = await exportAccountThings({ ids: [folder.id] }, f.deps);
  assert.deepEqual(result.plan.files, []); assert.deepEqual(result.plan.things.map((row: any) => row.id), [folder.id]);
  const retained = await f.retain(); await exportAccountThings({ ids: ['canonical-file'] }, f.deps);
  await f.files.remove(retained.id);
  await assert.rejects(exportAccountThings({ ids: ['canonical-file'] }, f.deps), /deleted/);
  await assert.rejects(exportAccountThings({ ids: [retained.id] }, f.deps), /Missing Thing/);
 } finally { await f.db.close(); }
});

test('file downloads reject damaged bytes and missing workspace data without returning a partial plan', async () => {
 const f = setup(); try {
  const file = await f.save();
  await f.db.transaction(f.scope, 'readwrite', f.lease, tx => tx.putBytes(file.id, new Uint8Array(f.bytes.length)));
  await assert.rejects(exportAccountThings({ ids: [file.id] }, f.deps), /bytes are missing or changed/);
  const otherScope = { ...f.scope, ownerId: 'other' }, otherSync = new AccountThingSync(f.db, otherScope, f.lease), otherFiles = new AccountFileSync(f.db, otherScope, f.lease);
  await assert.rejects(exportAccountThings({ ids: [file.id] }, { ...f.deps, sync: otherSync, files: otherFiles }), /Missing Thing/);
  const saved = await f.db.transaction(f.scope, 'readonly', f.lease, tx => tx.list('thing-export-snapshots'));
  assert.deepEqual(saved, []);
 } finally { await f.db.close(); }
});

test('export readers return immutable copies and fence cancellation and a retired account', async () => {
 const f = setup(); try {
  const file = await f.save(), result = await exportAccountThings({ ids: [file.id] }, f.deps), fileId = result.plan.files[0].id;
  const first = await result.plan.readLocalFile(fileId); first.fill(0);
  assert.deepEqual(await result.plan.readLocalFile(fileId), f.bytes);
  await assert.rejects(result.plan.readLocalFile('unrelated'), /not in this export/);
  const controller = new AbortController(); controller.abort(); await assert.rejects(result.plan.readLocalFile(fileId, controller.signal));
  await f.files.things.annotateFile({ id: file.id, title: 'Later metadata' });
  assert.equal(result.plan.files[0].title, undefined, 'An already prepared plan describes one immutable snapshot');
  f.retire(); await assert.rejects(result.plan.readLocalFile(fileId), /Workspace changed/);
 } finally { await f.db.close(); }
});


test('excluding file bytes preserves original account media references', async () => {
 const f = setup(); try {
  await f.retain();
  const component = await f.sync.things.create({ thingtime: ['component'], crystal: { name: 'File link', componentKey: 'file-link', version: 1, render: { tag: 'a', props: { href: '/api/v1/attachments/content?id=canonical-file' }, children: 'Download' } } });
  const result = await exportAccountThings({ ids: [component.id], includeFiles: false }, f.deps);
  assert.deepEqual(result.plan.files, []); assert.equal(result.plan.things[0].crystal.render.props.href, '/api/v1/attachments/content?id=canonical-file');
 } finally { await f.db.close(); }
});

test('an online managed-content fallback cannot silently omit pending device file edits', async () => {
 const f = setup(); try {
  const remoteFolder = { id: 'server-folder', thingtime: ['folder'], crystal: { name: 'Folder' }, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', revision: 1, author: { id: 'owner' }, acl: ['tt:user'], visibility: 'private' };
  await f.sync.remember(remoteFolder);
  const unrelated = await f.save();
  const remote = async () => ({ ok: true, plan: { roots: [remoteFolder.id], things: [remoteFolder], files: [{ id: 'unretained-file' }] } });
  assert.equal((await exportAccountThings({ ids: [remoteFolder.id] }, { ...f.deps, canRefresh: () => true, remote })).ok, true, 'An unrelated upload does not block an online download');
  await f.files.things.move([unrelated.id], remoteFolder.id);
  await assert.rejects(exportAccountThings({ ids: [remoteFolder.id] }, { ...f.deps, canRefresh: () => true, remote: async () => ({ ok: true, plan: { roots: [remoteFolder.id], things: [remoteFolder], files: [{ id: 'unretained-file' }] } }) }), /Sync your device edits/);
 } finally { await f.db.close(); }
});
