import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentIdForRequest, createAttachmentService } from './attachments';
import { attachmentDeleteClaimFence, cancelledAttachmentReceipt, isIdempotentLinkedAttachment, type AttachmentDoc, type AttachmentStore } from './attachmentStore';
import { thingStorageSizeBytes } from '../storage/storageCore';

const now = new Date('2026-10-23T00:00:00.000Z');
const input = { requestId: 'gallery-request', url: 'https://example.invalid/photo.png', purpose: 'post' };
const fixture = () => {
  const rows = new Map<string, AttachmentDoc>();
  let writes = 0, nextId = 0, currentTime = now;
  const store = {
    getById: async (id: string) => rows.get(id) || null,
    getOwned: async (owner: string, id: string) => rows.get(id)?.ownerId === owner ? rows.get(id)! : null,
    insertLinkedReady: async (value: any) => {
      if (rows.has(value.id)) throw Object.assign(Error('Duplicate identity'), { code: 11000 });
      const doc: AttachmentDoc = { ...cancelledAttachmentReceipt(value.ownerId, value.id, now), attachmentState: 'ready',
        attachmentCancellationRequested: undefined, attachmentLinked: true, attachmentRequestFingerprint: value.requestFingerprint,
        attachmentPurpose: value.purpose, attachmentExpiresAt: value.expiresAt, crystal: value.crystal, objectKey: `linked/${value.id}` };
      doc.sizeBytes = thingStorageSizeBytes(doc); rows.set(value.id, doc); writes++; return doc;
    },
    reserveCancellation: async (owner: string, id: string) => {
      const existing = rows.get(id);
      if (existing) { assert.equal(existing.ownerId, owner); return existing; }
      const doc = cancelledAttachmentReceipt(owner, id, currentTime); rows.set(id, doc); return doc;
    },
    claimDeleting: async (owner: string, id: string, _states: unknown, scope: any) => {
      const doc = rows.get(id)!;
      assert.equal(doc.ownerId, owner);
      const fence = attachmentDeleteClaimFence(scope);
      assert.equal(fence.attachmentLinked, true);
      assert.equal(fence.attachmentRequestFingerprint, doc.attachmentRequestFingerprint);
      assert.equal(fence.attachmentPurpose, doc.attachmentPurpose);
      if (scope.kind === 'target') assert.equal(fence.targetId, doc.targetId);
      else assert.deepEqual(fence.targetId, { $exists: false });
      assert.equal(scope.expectedUpdatedAt.getTime(), doc.updatedAt.getTime());
      const deleting: AttachmentDoc = { ...doc, attachmentState: 'deleting', attachmentCancellationRequested: true };
      rows.set(id, deleting); return deleting;
    },
    removeDeleting: async (owner: string, id: string) => { rows.set(id, cancelledAttachmentReceipt(owner, id, currentTime)); return true; }
  } as unknown as AttachmentStore;
  const service = createAttachmentService({ store, now: () => currentTime, uuid: () => `legacy-${++nextId}`, customMongoActive: () => false,
    getS3: () => { throw Error('Linked metadata must never access object storage'); } });
  return { service, rows, store, writes: () => writes, setTime: (time: Date) => { currentTime = time; } };
};
const failure = (value: { ok: boolean; status?: number }, status: number) => { assert.equal(value.ok, false); assert.equal(value.status, status); };

test('exact canonical link retries preserve ID, expiry, current annotations and version after binding', async () => {
  const f = fixture();
  const first = await f.service.link('owner', input); assert.equal(first.ok, true); if (!first.ok) return;
  const id = first.attachment.id, doc = f.rows.get(id)!;
  assert.equal(id, attachmentIdForRequest('owner', input.requestId));
  assert.deepEqual(doc.acl, ['tt:user']); assert.equal(doc.objectSizeBytes, 0);
  f.setTime(new Date(now.getTime() + 1000));
  assert.deepEqual(await f.service.link('owner', { ...input, url: '  https://example.invalid/photo.png  ', mediaKind: 'image' }), first);
  assert.equal(f.rows.get(id)!.attachmentExpiresAt, doc.attachmentExpiresAt);
  const changedAt = new Date(now.getTime() + 500);
  f.rows.set(id, { ...doc, targetId: 'post-1', attachmentExpiresAt: undefined, acl: ['tt:inherit'],
    crystal: { ...doc.crystal, title: 'Annotated title' }, updatedAt: changedAt });
  const replay = await f.service.link('owner', input); assert.equal(replay.ok, true); if (!replay.ok) return;
  assert.equal(replay.attachment.id, id); assert.equal(replay.attachment.title, 'Annotated title');
  assert.equal(replay.updatedAt, changedAt.toISOString()); assert.equal(f.writes(), 1);
});

test('link requests reject changed immutable tuples and share neither owner nor upload identity', async () => {
  const f = fixture(); await f.service.link('owner', input);
  for (const patch of [{ url: 'https://example.invalid/other.png' }, { purpose: 'comment' }, { mediaKind: 'file' }])
    failure(await f.service.link('owner', { ...input, ...patch }), 409);
  const other = await f.service.link('other', input); assert.equal(other.ok, true);
  if (other.ok) assert.notEqual(other.attachment.id, attachmentIdForRequest('owner', input.requestId));
  const doc = f.rows.get(attachmentIdForRequest('owner', input.requestId))!;
  for (const patch of [{ attachmentLinked: undefined }, { ownerId: 'other' }, { attachmentRequestFingerprint: '0'.repeat(64) }]) {
    f.rows.set(doc.shareId, { ...doc, ...patch }); failure(await f.service.link('owner', input), 409);
  }
  assert.equal(f.writes(), 2);
});

test('concurrent request retries create one link, while legacy duplicate URLs still mint separately', async () => {
  const f = fixture(); const results = await Promise.all(Array.from({ length: 8 }, () => f.service.link('owner', input)));
  for (const value of results) assert.deepEqual(value, results[0]); assert.equal(results[0].ok, true);
  assert.equal(f.writes(), 1);
  const legacy = await Promise.all([f.service.link('owner', { url: input.url }), f.service.link('owner', { url: input.url })]);
  assert.equal(legacy[0].ok && legacy[1].ok && legacy[0].attachment.id !== legacy[1].attachment.id, true);
  assert.equal(f.writes(), 3);
});

test('cancelled, deleting and expired link requests never recreate or renew a draft', async () => {
  const f = fixture(); assert.equal((await f.service.cancel('owner', { requestId: input.requestId })).ok, true);
  const cancelled = await f.service.link('owner', input); failure(cancelled, 409);
  if (cancelled.ok === false) assert.equal(cancelled.code, 'upload_cancelled'); assert.equal(f.writes(), 0);
  f.rows.clear(); await f.service.link('owner', input);
  const doc = f.rows.get(attachmentIdForRequest('owner', input.requestId))!;
  for (const patch of [{ attachmentState: 'deleting' as const }, { attachmentExpiresAt: now }, { attachmentExpiresAt: new Date(NaN) }, { attachmentExpiresAt: undefined }]) {
    f.rows.set(doc.shareId, { ...doc, ...patch }); failure(await f.service.link('owner', input), 409);
  }
  assert.equal(f.writes(), 1);
});

test('cancellation racing link insertion wins the shared unique identity', async () => {
  const f = fixture(); const insert = f.store.insertLinkedReady;
  f.store.insertLinkedReady = async value => { await f.store.reserveCancellation(value.ownerId, value.id); return insert(value); };
  const cancelled = await f.service.link('owner', input); failure(cancelled, 409);
  if (cancelled.ok === false) assert.equal(cancelled.code, 'upload_cancelled'); assert.equal(f.writes(), 0);
});

for (const bound of [false, true]) test(`durable ${bound ? 'bound' : 'unbound'} linked cleanup fences the target, purpose, fingerprint and current version`, async () => {
  const f = fixture(); const linked = await f.service.link('owner', input); assert.equal(linked.ok, true); if (!linked.ok) return;
  const id = linked.attachment.id, doc = f.rows.get(id)!;
  if (bound) f.rows.set(id, { ...doc, targetId: 'post-1', attachmentExpiresAt: undefined });
  const deletion = { id, requestId: input.requestId, targetId: 'post-1', expectedUpdatedAt: linked.updatedAt };
  failure(await f.service.remove('owner', { ...deletion, expectedUpdatedAt: new Date(0).toISOString() }), 409);
  failure(await f.service.remove('owner', { ...deletion, targetId: undefined }), 409);
  failure(await f.service.remove('owner', { ...deletion, requestId: 'different' }), 400);
  if (bound) failure(await f.service.remove('owner', { ...deletion, targetId: 'other' }), 409);
  assert.deepEqual(await f.service.remove('owner', deletion), { ok: true, deleted: true, deferred: false });
  assert.deepEqual(await f.service.remove('owner', deletion), { ok: true, deleted: true, deferred: false });
  failure(await f.service.link('owner', input), 409);
  assert.equal(f.writes(), 1);
});

test('legacy, import and profile links cannot opt into request-ID deletion', async () => {
  const f = fixture(); const linked = await f.service.link('owner', input); assert.equal(linked.ok, true); if (!linked.ok) return;
  const doc = f.rows.get(linked.attachment.id)!;
  for (const patch of [{ attachmentRequestFingerprint: undefined }, { attachmentImportDraft: true as const }, { attachmentProfileSlot: 'avatar' as const }, { attachmentPurpose: 'message' as const }]) {
    f.rows.set(doc.shareId, { ...doc, ...patch });
    failure(await f.service.remove('owner', { id: doc.shareId, requestId: input.requestId, targetId: 'post-1', expectedUpdatedAt: linked.updatedAt }), 409);
  }
  assert.equal(isIdempotentLinkedAttachment(doc), true);
  for (const patch of [{ shareId: 'legacy-id' }, { attachmentRequestFingerprint: undefined }, { attachmentLinked: undefined }, { attachmentPurpose: 'file' as const }])
    assert.equal(isIdempotentLinkedAttachment({ ...doc, ...patch }), false);
});

test('closed link input and custom-plane refusal run before storage or object access', async () => {
  const f = fixture();
  for (const body of [null, [], { ...input, requestId: '' }, { ...input, requestId: null }, { ...input, requestId: ' a' }, { ...input, requestId: '/a' },
    { ...input, requestId: 'x'.repeat(129) }, { ...input, ownerId: 'other' }, { ...input, attachmentRequestFingerprint: 'forged' },
    { ...input, url: 'file:///etc/passwd' }, { ...input, purpose: 'message' }, { ...input, mediaKind: 'video' }]) failure(await f.service.link('owner', body), 400);
  const custom = createAttachmentService({ customMongoActive: () => true }); failure(await custom.link('owner', input), 400);
  assert.equal(f.writes(), 0); assert.equal(f.rows.size, 0);
});

test('a linked request cannot be replayed through the byte upload service', async () => {
  const f = fixture(); await f.service.link('owner', input);
  const service = createAttachmentService({ store: { ...f.store, listExpiredOwned: async () => [] }, now: () => now, customMongoActive: () => false,
    getS3: () => new Proxy({} as any, { get() { throw Error('A request collision cannot issue object storage operations'); } }) });
  failure(await service.start('owner', { requestId: input.requestId, filename: 'photo.png', sizeBytes: 1, contentType: 'image/png', purpose: 'post' }), 409);
  assert.equal(f.writes(), 1);
});
