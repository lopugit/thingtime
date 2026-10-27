import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { createQuotaFactory } from './storageTestFixture';
import { LocalThings } from './things';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { isLocalAttachment, isLocalLinkedAttachment } from './attachments';
import { localPostProjection } from './posts';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { validateTransfer, type ThingTransfer } from '../utils/thingTransfer/format';

const scope = { kind: 'anonymous' } as const;
const bytes = new Uint8Array([1, 4, 9, 16]);
async function gallery(): Promise<ThingTransfer> {
 return { format: 'thingtime.transfer', version: 1, roots: ['gallery'],
  things: [{ id: 'gallery', thingtime: ['post'], crystal: { type: 'text', text: 'A mixed gallery' } }],
  files: [{ id: 'stored', targetId: 'gallery', path: 'files/000000', name: 'local.png', mime: 'image/png', bytes: bytes.length, sha256: await transferChecksum(bytes) }],
  links: [
   { id: 'image', targetId: 'gallery', url: 'https://media.example/image.png', mediaKind: 'image', title: 'Image title', description: 'One\nTwo', filenamePreview: 'Friendly image' },
   { id: 'video', targetId: 'gallery', url: 'https://media.example/video.mp4', mediaKind: 'video' }
  ], attachmentOrder: ['video', 'stored', 'image'] };
}
const fixture = (factory = new IDBFactory()) => {
 const db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange);
 let current = true;
 const lease: WorkspaceLease = { assertCurrent() { assert.ok(current, 'Retired workspace'); }, onInvalidate: () => () => {} };
 return { db, things: new LocalThings(db, scope, lease), retire() { current = false; } };
};

test('anonymous linked galleries retain canonical metadata, order and annotations through cold reload and portable copies without fetching URLs', async () => {
 const factory = new IDBFactory(), f = fixture(factory), originalFetch = globalThis.fetch;
 globalThis.fetch = async () => { throw Error('Linked imports must never fetch external bytes'); };
 try {
  const imported = await f.things.import(await gallery(), null, new Map([['stored', bytes]]));
  await f.db.close();
  const all = await f.things.snapshot(), root = await f.things.get(imported.roots[0]);
  const projected = localPostProjection(root, all, 'local-workspace');
  assert.deepEqual(projected.attachments.map(item => item.url || item.name), ['https://media.example/video.mp4', 'local.png', 'https://media.example/image.png']);
  const links = all.filter(isLocalLinkedAttachment);
  assert.equal(links.length, 2); assert.ok(links.every(link => link.targetId === root.id && !isLocalAttachment(link)));
  assert.equal((await f.things.list()).things.some(row => links.some(link => row.id === link.id)), false, 'bound links are not independent library files');
  for (const link of links) assert.equal(await f.db.transaction(scope, 'readonly', { assertCurrent() {}, onInvalidate: () => () => {} }, tx => tx.getBinary(link.id)), undefined);
  const image = links.find(link => link.crystal.mediaKind === 'image')!;
  await f.things.annotateFile({ id: image.id, title: 'Renamed link' });
  const exported = await f.things.export([root.id]); validateTransfer(exported.manifest);
  assert.equal(exported.manifest.things.length, 1); assert.equal(exported.manifest.links?.length, 2);
  assert.deepEqual(exported.manifest.attachmentOrder?.map(id => exported.manifest.links?.find(link => link.id === id)?.url || exported.manifest.files.find(file => file.id === id)?.name), ['https://media.example/video.mp4', 'local.png', 'https://media.example/image.png']);
  assert.equal(exported.manifest.links?.find(link => link.url.endsWith('image.png'))?.title, 'Renamed link');
  assert.doesNotMatch(JSON.stringify(exported.manifest), /localLinkedAttachment|localAttachment|objectKey|ownerId|visibility/);
  const copied = await f.things.import(exported.manifest, null, exported.files);
  assert.notEqual(copied.roots[0], root.id);
  const copyMedia = localPostProjection(await f.things.get(copied.roots[0]), await f.things.snapshot(), 'local-workspace').attachments;
  assert.deepEqual(copyMedia.map(item => item.url || item.name), projected.attachments.map(item => item.url || item.name));
  assert.ok(copyMedia.every(item => !projected.attachments.some(original => original.id === item.id)));
  const jsonOnly = await f.things.export([root.id], { includeFiles: false });
  assert.equal(jsonOnly.files.size, 0); assert.equal(jsonOnly.manifest.links?.length, 2); validateTransfer(jsonOnly.manifest);
  const withoutLinks = await f.things.export([root.id], { includeLinks: false });
  assert.equal(withoutLinks.manifest.links, undefined); assert.equal(withoutLinks.files.size, 1);
  await assert.rejects(f.things.readFileBlob(image.id), /not stored/);
  await assert.rejects(f.things.update({ id: image.id, crystal: { url: 'https://other.example/changed.png' } }), /dedicated/);
 } finally { globalThis.fetch = originalFetch; await f.db.close(); }
});

test('ordinary local post edits preserve imported links and deliberate removal or parent deletion removes only their metadata', async () => {
 const f = fixture();
 try {
  const imported = await f.things.import(await gallery(), null, new Map([['stored', bytes]])), id = imported.roots[0];
  await f.things.savePost({ id, crystal: { text: 'Edited offline' } }, true);
  const before = localPostProjection(await f.things.get(id), await f.things.snapshot(), 'local-workspace');
  assert.equal(before.attachments.length, 3);
  const keep = before.attachments.filter(item => item.mediaKind !== 'video').map(item => item.id);
  await f.things.savePost({ id, crystal: { text: 'Keep two' }, attachmentIds: keep }, true);
  assert.equal((await f.things.snapshot()).filter(isLocalLinkedAttachment).length, 1);
  assert.deepEqual(localPostProjection(await f.things.get(id), await f.things.snapshot(), 'local-workspace').attachments.map(item => item.id), keep);
  await f.things.remove([id]);
  assert.equal((await f.things.snapshot()).filter(row => row.targetId === id || row.id === id).length, 0);
 } finally { await f.db.close(); }
});

test('embedded linked media requires its editable owning gallery in an exported bundle', async () => {
 const f = fixture();
 try {
  const manifest: ThingTransfer = { format: 'thingtime.transfer', version: 1, roots: ['page'], things: [
   { id: 'source', thingtime: ['post'], crystal: { type: 'text', text: 'Source gallery' } },
   { id: 'page', thingtime: ['webpage'], crystal: { name: 'Linked page', blocks: [{ id: 'media', type: 'media', src: '/api/v1/attachments/content?id=image' }] } }
  ], files: [], links: [{ id: 'image', targetId: 'source', url: 'https://media.example/image.png', mediaKind: 'image' }], attachmentOrder: ['image'] };
  const imported = await f.things.import(manifest), page = await f.things.get(imported.roots[0]);
  const link = (await f.things.snapshot()).find(isLocalLinkedAttachment)!;
  assert.equal((page.crystal.blocks as any[])[0].src, '/api/v1/attachments/content?id=' + link.id);
  await assert.rejects(f.things.export([page.id]), /owning post/);
  const exported = await f.things.export([page.id, imported.idMap.source]); validateTransfer(exported.manifest);
  assert.equal(exported.manifest.links?.[0].targetId, imported.idMap.source);
  assert.equal(exported.manifest.things.length, 2); assert.equal(exported.files.size, 0);
  const copied = await f.things.import(exported.manifest);
  const copy = await f.things.get(copied.roots[0]), copyLink = (await f.things.snapshot()).filter(isLocalLinkedAttachment).find(row => row.targetId === copied.idMap[imported.idMap.source])!;
  assert.notEqual(copyLink.id, link.id);
  assert.equal((copy.crystal.blocks as any[])[0].src, '/api/v1/attachments/content?id=' + copyLink.id);
 } finally { await f.db.close(); }
});

test('linked imports refuse forged authority, unsafe URLs, protected children and missing placement without partial content', async () => {
 const f = fixture();
 try {
  const valid = await gallery();
  for (const patch of [{ url: 'javascript:alert(1)' }, { url: 'https://user:password@example.com/x.png' }, { mediaKind: 'audio' }, { ownerId: 'other' }]) {
   const bad = structuredClone(valid); Object.assign(bad.links![0], patch);
   await assert.rejects(f.things.import(bad, null, new Map([['stored', bytes]])));
  }
  await assert.rejects(f.things.import(valid, 'missing-folder', new Map([['stored', bytes]])), /not in this workspace/);
  const arbitrary = structuredClone(valid); arbitrary.things[0] = {id:'gallery',thingtime:['data'],crystal:{name:'Unreachable gallery'}};
  await assert.rejects(f.things.import(arbitrary, null, new Map([['stored', bytes]])), /post or comment/);
  const theme: ThingTransfer = { format: 'thingtime.transfer', version: 1, roots: ['theme'], things: [{ id: 'theme', thingtime: ['theme'], crystal: { name: 'Theme', theme: {} } }], files: [], links: [{ id: 'link', targetId: 'theme', url: 'https://media.example/x.png', mediaKind: 'image' }], attachmentOrder: ['link'] };
  await assert.rejects(f.things.import(theme), /cannot contain child/);
  assert.deepEqual(await f.things.snapshot(), []);
 } finally { await f.db.close(); }
});

test('linked import quota failure rolls back metadata, bytes and History, and retired workspaces cannot export', async () => {
 const factory = createQuotaFactory({ records: 2 }), f = fixture(factory);
 try {
  await assert.rejects(f.things.import(await gallery(), null, new Map([['stored', bytes]])), /space|quota|storage/i);
  assert.deepEqual(await f.things.snapshot(), []);
  const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
  assert.deepEqual(await f.db.transaction(scope, 'readonly', lease, tx => tx.list('timeline-events')), []);
  factory.capacity.records = 100;
  const imported = await f.things.import(await gallery(), null, new Map([['stored', bytes]]));
  const exported = await f.things.export(imported.roots); f.retire();
  await assert.rejects(exported.assertCurrent(), /Retired workspace/);
 } finally { await f.db.close(); }
});
