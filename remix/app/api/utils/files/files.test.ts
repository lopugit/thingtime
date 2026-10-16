import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCloudFileService } from './files';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { thingStorageSizeBytes, USER_STORAGE_ACCOUNTING_VERSION } from '../storage/storageCore';
import { COLLECTION_SCHEMA_VERSIONS, isProtectedThingtime } from '../../../schemas/registry';
import { contentPartPlan } from '../../../fileSync/contentFingerprint';
import { cloudFileSyncEntry, parseCloudFileCommit } from '../../../fileSync/cloudFile';
function fixture() {
 let docs = new Map<string, any>(), events = new Map<string, any>(), charged = 0, failAppend = false, fingerprints = 0;
 const now = new Date('2026-10-17T00:00:00Z');
 const matches = (doc: any, filter: any) => Object.entries(filter).every(([k, v]: any) => {
  if (v && typeof v === 'object' && '$in' in v) return v.$in.some((x: any) => x == null ? doc[k] == null : doc[k] === x);
  return Array.isArray(doc[k]) && typeof v === 'string' ? doc[k].includes(v) : doc[k] instanceof Date && v instanceof Date ? +doc[k] === +v : doc[k] === v;
 });
 const collection = { async findOne(filter: any) { return structuredClone([...docs.values()].find(d => matches(d, filter)) ?? null); },
  async insertOne(doc: any) { if (docs.has(doc.shareId)) throw Error('duplicate'); doc._id = doc.shareId; docs.set(doc.shareId, structuredClone(doc)); },
  async updateOne(filter: any, update: any) { const doc = [...docs.values()].find(d => matches(d, filter)); if (!doc) return { matchedCount: 0 }; Object.assign(doc, structuredClone(update.$set)); return { matchedCount: 1 }; }
 };
 const service = createCloudFileService({ collection: async () => collection, customPlane: () => false, now: () => now,
  transaction: async work => { const before = structuredClone({ docs, events, charged }); try { return await work({}); } catch (error) { docs = before.docs; events = before.events; charged = before.charged; throw error; } },
  fingerprint: async (_viewer, id) => { fingerprints++; const doc = docs.get(String(id)); if (!doc || doc.ownerId !== 'owner') return { ok: false, status: 404, error: 'missing' };
   return { ok: true, id: doc.shareId, version: attachmentContentVersion(doc.shareId, doc.objectKey, doc.objectVersionId), size: 2,
    fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(2), sha256: doc.shareId.endsWith('1') ? 'a'.repeat(64) : 'b'.repeat(64) } }; },
  entries: async (_things, _owner, ids) => ids.filter(id => events.has(id)).map(id => ({ event: structuredClone(events.get(id)) } as any)),
  append: async (_things, event) => { if (failAppend) throw Error('append failed'); events.set(event.id, structuredClone(event)); return { event } as any; },
  debit: async (_owner, bytes) => { charged += bytes; }, lockFolder: async () => null
 });
 function upload(id: string, patch: any = {}) { const doc: any = { _id: id, shareId: id, ownerId: 'owner', schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['attachment'],
  crystal: { name: 'fixture.bin', size: 2, contentType: 'application/octet-stream', mediaKind: 'file' }, extended: null, tags: [], acl: ['tt:user'],
  attachmentState: 'ready', attachmentPurpose: 'file', attachmentEnvelopeVersion: 1, objectKey: 'objects/'+id, objectVersionId: 'version-'+id, objectSizeBytes: 2,
  storageClass: 'content', storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION, createdAt: now, updatedAt: now, ...patch };
  try { doc.sizeBytes = thingStorageSizeBytes(doc); } catch { doc.sizeBytes = 0; } docs.set(id, doc); return attachmentContentVersion(id, doc.objectKey, doc.objectVersionId); }
 return { service, upload, docs: () => docs, events: () => events, charged: () => charged, fingerprints: () => fingerprints, failAppend: () => { failAppend = true; } };
}
const input = (contentVersion: string) => ({ id: randomUUID(), operationId: randomUUID(), expectedRevision: null, name: 'fixture.bin', folderId: null, attachmentId: 'att1', contentVersion, trashed: false });
test('stable identity, exact retries, retained versions, trash and restore share Timeline', async () => {
 const f = fixture(); const create = input(f.upload('att1')); const first: any = await f.service.commit('owner', create); assert.ok(first.ok);
 assert.equal(isProtectedThingtime(['file']), true); assert.equal(f.docs().get('att1').targetId, create.id);
 const change = { ...create, operationId: randomUUID(), expectedRevision: first.file.revision, attachmentId: 'att2', contentVersion: f.upload('att2') };
 const second: any = await f.service.commit('owner', change); assert.ok(second.ok); assert.equal(second.file.id, first.file.id); assert.notEqual(second.file.revision, first.file.revision);
 assert.equal(f.docs().get('att1').attachmentState, 'ready'); const charges = f.charged(), count = f.fingerprints();
 const replay: any = await f.service.commit('owner', create); assert.ok(replay.ok); assert.deepEqual(replay.file, first.file);
 assert.equal(f.charged(), charges); assert.equal(f.fingerprints(), count); assert.equal(f.events().size, 2);
 assert.equal((await f.service.commit('owner', { ...create, name: 'different' })).ok, false);
 assert.equal((await f.service.commit('owner', { ...change, operationId: randomUUID(), expectedRevision: first.file.revision })).ok, false);
 const trash: any = await f.service.commit('owner', { ...change, operationId: randomUUID(), expectedRevision: second.file.revision, trashed: true }); assert.ok(trash.ok);
 assert.throws(() => cloudFileSyncEntry(trash.file, 'fixture.bin'));
 const restored: any = await f.service.commit('owner', { ...create, operationId: randomUUID(), expectedRevision: trash.file.revision }); assert.ok(restored.ok);
 assert.equal(cloudFileSyncEntry(restored.file, 'fixture.bin').fingerprint?.sha256, 'a'.repeat(64)); assert.equal(f.events().size, 4); assert.equal(f.docs().get('att2').targetId, create.id);
 assert.equal((await f.service.read('other', create.id)).ok, false);
});
test('a failed history transaction cannot bind uploads, charge metadata or publish a file', async () => {
 const f = fixture(); const create = input(f.upload('att1')); f.failAppend(); assert.equal((await f.service.commit('owner', create)).ok, false);
 assert.equal(f.docs().has(create.id), false); assert.equal(f.docs().get('att1').targetId, undefined); assert.equal(f.charged(), 0);
});
test('foreign, bound, blocked, expiring, linked or unaccounted bytes cannot be published', async () => {
 for (const patch of [{ ownerId: 'other' }, { targetId: 'other-file' }, { moderation: { status: 'blocked' } }, { attachmentExpiresAt: new Date() },
  { attachmentLinked: true }, { sandboxSpace: 'isolated' }, { thingtime: ['attachment', 'file'] }, { storageAccountingVersion: -1 }, { attachmentPurpose: 'post' }, { attachmentState: 'deleting' }]) {
  const f = fixture(), create = input(f.upload('att1', patch)); assert.equal((await f.service.commit('owner', create)).ok, false); assert.equal(f.docs().has(create.id), false);
 }
 const f = fixture(), create = input(f.upload('att1'));
 for (const patch of [{ id: 'timeline-reserved' }, { operationId: 'non-uuid' }, { expectedRevision: undefined }, { name: '../file' }, { contentVersion: 'wrong' }, { trashed: true }, { surprise: 'field' }]) assert.throws(() => parseCloudFileCommit({ ...create, ...patch }));
});

test('a client-authored Timeline draft cannot impersonate an API file receipt', async () => {
 const f = fixture(), create = input(f.upload('att1')); const result: any = await f.service.commit('owner', create); assert.ok(result.ok);
 const event = f.events().get(result.file.revision); event.mode = 'draft'; event.source = 'client';
 assert.equal((await f.service.read('owner', create.id, create.operationId)).ok, false);
 assert.equal((await f.service.commit('owner', create)).ok, false);
});

test('custom data planes and mismatched content versions fail before any publication', async () => {
 const custom = createCloudFileService({ customPlane: () => true, collection: async () => { throw Error('must not access home'); } });
 assert.equal((await custom.read('owner', randomUUID())).ok, false);
 assert.equal((await custom.commit('owner', {})).ok, false);
 const f = fixture(), create = input(f.upload('att1')); const result = await f.service.commit('owner', { ...create, contentVersion: '0'.repeat(64) });
 assert.equal(result.ok, false); assert.equal(f.docs().has(create.id), false); assert.equal(f.docs().get('att1').targetId, undefined);
});


test('an attached or app-sandbox file root is not adopted by the home file writer', async () => {
 const f = fixture(), create = input(f.upload('att1')); const first: any = await f.service.commit('owner', create); assert.ok(first.ok);
 const original = structuredClone(f.docs().get(create.id));
 for (const patch of [{ targetId: 'parent' }, { appId: 'app' }, { sandboxSpace: 'isolated' }]) {
  f.docs().set(create.id, { ...original, ...patch });
  assert.equal((await f.service.read('owner', create.id)).ok, false);
  assert.equal((await f.service.commit('owner', { ...create, operationId: randomUUID(), expectedRevision: first.file.revision })).ok, false);
 }
});
