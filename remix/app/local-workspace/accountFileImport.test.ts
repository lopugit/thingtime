import { createQuotaFactory } from './storageTestFixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { AccountThingSync, type AccountSyncTransport, type AccountThing } from './accountSync';
import { accountImportSupported } from './accountImport';
import { exportAccountThings } from './accountExport';
import { WorkspaceDatabase } from './storage';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { recordingTransferFile } from '../utils/thingTransfer/recording';
import { resolveTemplate } from '../components/ComponentsLibrary/componentTemplate';
import { validateTransfer } from '../utils/thingTransfer/format';

async function fixture(factory = new IDBFactory()) {
 const db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
 const scope = { kind: 'account', origin: 'https://import.test', ownerId: 'owner', dataPlane: 'home' } as const;
 let active = true, now = Date.now();
 const lease = { assertCurrent() { if (!active) throw Error('Workspace changed'); }, onInvalidate: () => () => {} };
 const files = new AccountFileSync(db, scope, lease, () => now), sync = new AccountThingSync(db, scope, lease, () => now, undefined, files.contentHooks);
 const bytes = new TextEncoder().encode('Independent imported file');
 const manifest = validateTransfer({ format: 'thingtime.transfer', version: 1, roots: ['folder'], things: [
  { id: 'component', thingtime: ['component'], folderId: 'folder', crystal: { name: 'Imported link', componentKey: 'imported-link', version: 1, render: { tag: 'a', props: { href: '/api/v1/attachments/content?id=portable-bytes' }, children: 'Original file' } } },
  { id: 'folder', thingtime: ['folder'], crystal: { name: 'Imported files' } },
  { id: 'file', thingtime: ['attachment'], folderId: 'folder', crystal: { recordingFileId: 'portable-bytes', filePurpose: 'file' } }
 ], files: [{ id: 'portable-bytes', targetId: 'file', path: 'files/000000', name: 'original.txt', mime: 'text/plain', bytes: bytes.length, sha256: await transferChecksum(bytes), title: 'Portable title', description: 'Portable description' }] });
 const remote = new Map<string, AccountThing>(), writes: any[] = [], uploads: any[] = [];
 const content: AccountSyncTransport = { get: async id => { if (!remote.has(id)) throw { status: 404 }; return structuredClone(remote.get(id)!); }, write: async op => {
  writes.push(structuredClone(op));
  const row = { ...op.body, id: op.id, author: { id: scope.ownerId }, createdAt: new Date(now).toISOString(), updatedAt: new Date(++now).toISOString(), revision: 1 } as AccountThing;
  remote.set(row.id, row); return row;
 } };
 const fileTransport: AccountFileTransport = { start: async request => { uploads.push(structuredClone(request)); return { id: 'account-imported-file', partSizeBytes: bytes.length, partCount: 1 }; },
  parts: async (_id, parts) => parts.map(part => ({ ...part, url: 'https://storage.test/part', expiresAt: '2026-10-17', headers: {} })), put: async (_part, body) => { assert.deepEqual(body, bytes); },
  complete: async () => ({ id: 'account-imported-file', name: 'original.txt', size: bytes.length, contentType: 'text/plain', mediaKind: 'file' }) };
 const importing = () => sync.things.import(manifest, null, new Map([['portable-bytes', bytes]]));
 return { db, scope, lease, files, sync, manifest, bytes, remote, writes, uploads, content, fileTransport, importing, tick() { now += 120000; }, retire() { active = false; } };
}

test('account imports commit files, content and both queues atomically before any upload', async () => {
 const f = await fixture(); try {
  assert.equal(accountImportSupported(f.manifest), true);
  const imported = await f.importing(), fileId = imported.idMap.file;
  assert.match(fileId, /^local-file-[0-9a-f-]{36}$/); assert.deepEqual(f.uploads, []); assert.deepEqual(f.writes, []);
  assert.equal((await f.sync.status()).length, 2); assert.equal((await f.files.status()).length, 1);
  const file = (await f.files.readFile(fileId)).row;
  assert.equal(file.localAttachment.requestId, fileId.slice('local-file-'.length)); assert.equal(file.folderId, imported.idMap.folder); assert.equal(file.crystal.title, 'Portable title');
  assert.deepEqual((await f.files.readFile(fileId)).bytes, f.bytes);
  const component = (await f.sync.view(imported.idMap.component))!;
  assert.equal((component.crystal.render as any).props.href, '/api/v1/attachments/content?id=' + fileId);
  const exported = await exportAccountThings({ ids: imported.roots }, { sync: f.sync, files: f.files, db: f.db, lease: f.lease, canRefresh: () => false, remote: async () => { throw Error('Unexpected remote export'); } });
  recordingTransferFile(exported.plan.things.find((row: any) => row.id === fileId), { format: 'thingtime.transfer', version: 1, ...exported.plan });
  assert.equal(accountImportSupported({ format: 'thingtime.transfer', version: 1, ...exported.plan }), true);
  assert.equal(exported.plan.files[0].title, 'Portable title'); assert.deepEqual(await exported.plan.readLocalFile(exported.plan.files[0].id), f.bytes);
  const again = await f.importing(); assert.notEqual(again.idMap.file, fileId); assert.notEqual((await f.files.readFile(again.idMap.file)).row.localAttachment.requestId, file.localAttachment.requestId);
 } finally { await f.db.close(); }
});

test('only media-dependent account writes wait for upload receipts and then use real account IDs', async () => {
 const f = await fixture(); try {
  const imported = await f.importing();
  const independent = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Independent' } });
  await f.sync.sync(f.content);
  assert.ok(f.remote.has(independent.id)); assert.ok(f.remote.has(imported.idMap.folder)); assert.ok(!f.remote.has(imported.idMap.component));
  await f.files.sync(f.fileTransport); await f.sync.sync(f.content);
  assert.equal(f.uploads.length, 1); assert.equal(f.uploads[0].purpose, 'file');
  const remote = f.remote.get(imported.idMap.component)!;
  assert.equal((remote.crystal.render as any).props.href, '/api/v1/attachments/content?id=account-imported-file');
  assert.deepEqual(remote.acl, ['tt:user']); assert.equal(remote.author.id, f.scope.ownerId);
  assert.ok((await f.sync.status()).every(row => row.state === 'synced'));
  assert.deepEqual((await f.files.readFile(imported.idMap.file)).bytes, f.bytes);
 } finally { await f.db.close(); }
});

test('queued media writes retain exact canonical requests after an uncertain response and a newer local edit', async () => {
 const f = await fixture(); try {
  const imported = await f.importing(); await f.sync.sync(f.content); await f.files.sync(f.fileTransport);
  await f.sync.sync({ ...f.content, write: async op => { await f.content.write(op, new AbortController().signal); throw Error('Lost'); }, get: async () => { throw Error('Offline'); } });
  const frozen = structuredClone(f.writes.at(-1));
  await f.sync.things.update({ id: imported.idMap.component, crystal: { name: 'Edited during uncertain sync' } }); f.tick();
  await f.sync.sync(f.content);
  assert.deepEqual(f.writes.at(-2), frozen);
  assert.equal(f.remote.get(imported.idMap.component)!.crystal.name, 'Edited during uncertain sync');
  assert.equal((f.remote.get(imported.idMap.component)!.crystal.render as any).props.href, '/api/v1/attachments/content?id=account-imported-file');
 } finally { await f.db.close(); }
});

test('cancelled file dependencies surface an actionable content error without stopping independent writes', async () => {
 const f = await fixture(); try {
  const imported = await f.importing(); await f.files.cancel(imported.idMap.file);
  const independent = await f.sync.things.create({ thingtime: ['data'], crystal: { name: 'Independent' } }); await f.sync.sync(f.content);
  assert.ok(f.remote.has(independent.id)); assert.ok(!f.remote.has(imported.idMap.component));
  const status = (await f.sync.status()).find(row => row.id === imported.idMap.component)!;
  assert.equal(status.state, 'error'); assert.match(status.error!, /referenced device file was removed/);
 } finally { await f.db.close(); }
});

test('bad bytes, missing placement, quota refusal and abort roll back content, files and all queues', async () => {
 for (const failure of ['bytes','folder','quota','abort']) {
  const f = await fixture(createQuotaFactory()); try {
   let bytes = f.bytes;
   if (failure === 'quota') {
    await f.db.transaction(f.scope, 'readwrite', f.lease, async tx => { for (let n = 0; n < 4; n++) await tx.putBytes('filler-' + n, new Uint8Array((n === 3 ? 15 : 16) * 1024 * 1024)); });
    bytes = new Uint8Array(2 * 1024 * 1024); f.manifest.files[0].bytes = bytes.length; f.manifest.files[0].sha256 = await transferChecksum(bytes);
   }
   const controller = new AbortController(); if (failure === 'abort') controller.abort();
   await assert.rejects(f.sync.things.import(f.manifest, failure === 'folder' ? 'missing' : null, new Map([['portable-bytes', failure === 'bytes' ? new Uint8Array(bytes.length) : bytes]]), controller.signal));
   assert.deepEqual(await f.sync.status(), []); assert.deepEqual(await f.files.status(), []); assert.deepEqual(await f.files.metadata.status(), []); assert.deepEqual(await f.sync.things.snapshot(), []);
  } finally { await f.db.close(); }
 }
});

test('bound media and mixed managed imports keep their dedicated account path', async () => {
 const f = await fixture(); try {
  const bound = structuredClone(f.manifest); bound.things = bound.things.filter(row => row.id !== 'file'); bound.files[0].targetId = 'component';
  assert.equal(accountImportSupported(bound), false); await assert.rejects(f.sync.things.import(bound, null, new Map([['portable-bytes', f.bytes]])), /dedicated account import/);
  const missing = structuredClone(f.manifest); missing.files = []; assert.equal(accountImportSupported(missing), false);
  assert.deepEqual(await f.sync.things.snapshot(), []);
 } finally { await f.db.close(); }
});


test('split templates, CSS, authored HTML and persisted arguments keep editable media after account sync', async () => {
 const f = await fixture(); try {
  f.manifest.things[0].crystal = { name: 'Editable media', componentKey: 'editable-media', version: 1,
   savedArgs: { prefix: 'portable-', suffix: 'bytes', exact: 'portable-bytes' },
   render: { tag: 'img', props: { src: '/api/v1/attachments/content?id={prefix}{suffix}', title: '{prefix}{suffix}',
    _hover: { backgroundImage: 'url(/api/v1/attachments/content?id={prefix}{suffix})' } } } };
  f.manifest.things.push({ id: 'page', thingtime: ['webpage'], folderId: 'folder', crystal: { name: 'HTML media', blocks: [
   { id: 'html', type: 'html', html: '<img src="/api/v1/attachments/content?id=portable-bytes" />' },
   { id: 'instance', type: 'component', component: 'component', args: { exact: 'portable-bytes' } }
  ] } });
  const imported = await f.importing(); await f.sync.sync(f.content);
  assert.ok(!f.remote.has(imported.idMap.component)); assert.ok(!f.remote.has(imported.idMap.page));
  await f.files.sync(f.fileTransport); await f.sync.sync(f.content);
  const crystal = f.remote.get(imported.idMap.component)!.crystal;
  const rendered = resolveTemplate(crystal.render, crystal.savedArgs as Record<string, unknown>) as any;
  assert.equal(rendered.props.src, '/api/v1/attachments/content?id=account-imported-file');
  assert.equal(rendered.props.title, 'portable-bytes');
  assert.match(rendered.props._hover.backgroundImage, /account-imported-file/);
  assert.equal((crystal.savedArgs as any).exact, 'account-imported-file');
  const blocks = f.remote.get(imported.idMap.page)!.crystal.blocks as any[];
  assert.match(blocks[0].html, /id=account-imported-file/); assert.equal(blocks[1].args.exact, 'account-imported-file');
 } finally { await f.db.close(); }
});


test('recording imports preserve purpose through local bytes, export and verified upload', async () => {
 const f=await fixture();try {
  delete f.manifest.things.find(row=>row.id==='file')!.crystal.filePurpose;
  assert.equal(accountImportSupported(f.manifest),true);
  const imported=await f.importing(), id=imported.idMap.file;
  const local=(await f.files.readFile(id)).row;
  assert.equal(local.localAttachment.purpose,'recording');assert.equal(local.localAttachment.expiresAt,undefined);
  const exported=await exportAccountThings({ids:imported.roots},{sync:f.sync,files:f.files,db:f.db,lease:f.lease,canRefresh:()=>false,remote:async()=>{throw Error('No network');}});
  const row=exported.plan.things.find((row:any)=>row.id===id)!;
  assert.equal(row.crystal.filePurpose,undefined);
  recordingTransferFile(row,{format:'thingtime.transfer',version:1,...exported.plan});
  await f.sync.sync(f.content);await f.files.sync(f.fileTransport);await f.sync.sync(f.content);
  assert.equal(f.uploads[0].purpose,'recording');assert.equal((await f.files.library()).aliases.get('account-imported-file'),id);
  assert.deepEqual((await f.files.readFile(id)).bytes,f.bytes);
 }finally{await f.db.close();}
});
