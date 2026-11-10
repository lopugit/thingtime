import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createAttachmentService } from '../app/api/utils/attachments/attachments';
import { createLocalAttachmentStorage } from '../app/api/utils/attachments/localAttachmentStorage';
import { attachmentStore } from '../app/api/utils/attachments/attachmentStore';
import { attachmentContentVersion } from '../app/api/utils/attachments/contentFingerprint';
import { activateSyncAttachmentDedup } from '../app/api/utils/attachments/attachmentBlobActivation';
import { runSyncAttachmentDedupMigration, purgeRedundantAttachmentObject } from '../app/api/utils/attachments/attachmentBlobMaintenance';
import { contentPartPlan } from '../app/fileSync/contentFingerprint';
import { getUserStorageUsage } from '../app/api/utils/storage/userStorage';
import { getHomeThingsCollection } from '../app/api/utils/mongodb/collections';

export async function runAttachmentDedupFixture(directory: string, origin: string, owner: string, other: string) {
  const media = join(directory, 'dedup-objects');
  process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = media;
  const storage = createLocalAttachmentStorage({ directory: media });
  let enabled = true, mpus = 0, deletes = 0;
  let clock = new Date();
  const provider = { ...storage,
    createMultipartUpload: (input: Parameters<typeof storage.createMultipartUpload>[0]) => {
      mpus++;
      return storage.createMultipartUpload(input);
    },
    deleteObject: (input: Parameters<typeof storage.deleteObject>[0]) => {
      deletes++;
      return storage.deleteObject(input);
    } };
  const service = createAttachmentService({ getS3: () => provider, now: () => clock, queueModeration: () => {},
    dedupActive: async () => enabled && (await import('../app/api/utils/attachments/attachmentBlobActivation')).syncAttachmentDedupActive() });
  const bytes = new Uint8Array([0, 17, 34, 85, 255]);
  const part = createHash('sha256').update(bytes).digest();
  const contentFingerprint = { algorithm: 'sha256-parts-v1' as const, ...contentPartPlan(bytes.length), sha256: createHash('sha256').update(part).digest('hex') };
  const input = (name: string, sync = true) => ({
    requestId: randomUUID(), filename: name, sizeBytes: bytes.length, purpose: 'file', contentType: 'application/octet-stream',
    fileSyncOrigin: { version: 1, deviceId: randomUUID(), localRootId: randomUUID(), fileId: randomUUID(), folderId: randomUUID(), path: name },
    ...(sync ? { contentFingerprint } : {})
  });
  const start = async (id: string, body: ReturnType<typeof input>) => {
    const result = await service.start(id, body);
    assert.ok(result.ok, result.ok ? undefined : result.error);
    return result.upload as { id: string; state?: 'ready' };
  };
  const finish = async (ownerId: string, uploadId: string) => {
    const signed = await service.signParts(ownerId, { uploadId, parts: [{ partNumber: 1, checksumSha256: part.toString('base64') }] });
    assert.ok(signed.ok, signed.ok ? undefined : signed.error);
    const target = signed.parts[0];
    const put = await storage.handleRequest(new Request(new URL(target.url, origin), { method: 'PUT',
      headers: { ...target.headers, 'Content-Length': String(bytes.length) }, body: bytes }));
    assert.equal(put.status, 200);
    const complete = await service.complete(ownerId, { uploadId });
    assert.ok(complete.ok, complete.ok ? undefined : complete.error);
    const receipt = await service.fingerprint({ id: ownerId }, uploadId);
    assert.ok(receipt.ok);
    assert.deepEqual(receipt.fingerprint, contentFingerprint);
    return receipt;
  };
  const blobCount = () => getHomeThingsCollection().then(c => c.countDocuments({ ownerId: owner, thingtime: 'attachment-content-blob' } as any));
  const initial = (await getUserStorageUsage(owner)).usedBytes!;
  const disabled = await start(owner, input('off.bin'));
  await finish(owner, disabled.id);
  assert.equal(await blobCount(), 0, 'Capability does not activate shared storage');
  assert.ok((await service.remove(owner, { id: disabled.id })).ok);
  await activateSyncAttachmentDedup({ dryRun: false });
  assert.equal((await getUserStorageUsage(owner)).usedBytes, initial);

  const left = input('mac.bin'), right = input('iphone.bin');
  const first = await start(owner, left);
  const busy = await service.start(owner, right);
  assert.ok(!busy.ok && busy.status === 409 && busy.retryable && busy.code === 'upload_initializing');
  const mismatched = await service.signParts(owner, { uploadId: first.id, parts: [{ partNumber: 1, checksumSha256: Buffer.alloc(32).toString('base64') }] });
  assert.ok(!mismatched.ok && mismatched.status === 409, 'A sync digest cannot grant a URL for different bytes');
  const original = await finish(owner, first.id);
  const firstDoc = (await attachmentStore.getOwned(owner, first.id))!;
  const leftUsage = (await getUserStorageUsage(owner)).usedBytes!;
  const [b, replay] = await Promise.all([start(owner, right), start(owner, right)]);
  assert.deepEqual(b, replay);
  assert.equal(b.state, 'ready');
  assert.notEqual(b.id, first.id);
  assert.equal(mpus, 2, 'Only the initial legacy and new canonical bytes receive an MPU');
  assert.equal(await blobCount(), 1);
  const alias = (await attachmentStore.getOwned(owner, b.id))!;
  assert.equal((await getUserStorageUsage(owner)).usedBytes! - leftUsage, alias.sizeBytes);
  assert.equal(firstDoc.attachmentBlob?.objectVersionId, alias.attachmentBlob?.objectVersionId);
  const aliasReceipt = await service.fingerprint({ id: owner }, b.id);
  assert.ok(aliasReceipt.ok && aliasReceipt.version !== original.version);
  assert.deepEqual(aliasReceipt.fingerprint, original.fingerprint);
  const fromOther = await start(other, input('another-owner.bin'));
  assert.equal(fromOther.state, undefined);
  await finish(other, fromOther.id);
  assert.equal(mpus, 3);
  assert.ok(!(await service.download({ id: other }, b.id, true)).ok);
  const downloadable = await service.download({ id: owner }, b.id, true);
  assert.ok(downloadable.ok && downloadable.disposition.includes('iphone.bin'));
  assert.deepEqual(new Uint8Array(await (await storage.handleRequest(new Request(new URL(downloadable.url, origin)))).arrayBuffer()), bytes);
  const different = await service.start(owner, { ...right, contentFingerprint: { ...contentFingerprint, sha256: 'a'.repeat(64) } });
  assert.ok(!different.ok && different.status === 409);
  const beforeDeletes = deletes;
  assert.ok((await service.remove(owner, { id: first.id })).ok);
  assert.equal(deletes, beforeDeletes, 'Deleting the uploader does not delete shared bytes');
  const stillThere = await service.fingerprint({ id: owner }, b.id);
  assert.ok(stillThere.ok);
  assert.ok((await service.remove(owner, { id: b.id })).ok);
  assert.equal(deletes, beforeDeletes + 1);
  assert.equal((await getUserStorageUsage(owner)).usedBytes, initial);
  assert.equal(await blobCount(), 0);

  const emptyFingerprint = { algorithm: 'sha256-parts-v1' as const, ...contentPartPlan(0), sha256: createHash('sha256').digest('hex') };
  const empty = (name: string) => ({ ...input(name), sizeBytes: 0, contentFingerprint: emptyFingerprint });
  const zero1 = await start(owner, empty('zero-one.bin')), zero2 = await start(owner, empty('zero-two.bin'));
  assert.equal(zero1.state, 'ready'); assert.equal(zero2.state, 'ready');
  assert.equal(await blobCount(), 1);
  assert.equal(mpus, 3, 'Empty duplicates never require a multipart upload');
  const zeroDocs = await Promise.all([zero1.id, zero2.id].map(id => attachmentStore.getOwned(owner, id)));
  assert.equal(zeroDocs[0]?.attachmentBlob?.objectVersionId, zeroDocs[1]?.attachmentBlob?.objectVersionId);
  await service.remove(owner, { id: zero1.id }); await service.remove(owner, { id: zero2.id });
  assert.equal((await getUserStorageUsage(owner)).usedBytes, initial);

  enabled = false;
  const old1 = await start(owner, input('old-mac.bin', false)), old2 = await start(owner, input('old-iphone.bin', false));
  await finish(owner, old1.id); await finish(owner, old2.id);
  const oldRows = await Promise.all([old1.id, old2.id].map(id => attachmentStore.getOwned(owner, id)));
  const usage = (await getUserStorageUsage(owner)).usedBytes!;
  const oldVersions = new Map(oldRows.map(row => [row!.shareId, attachmentContentVersion(row!.shareId, row!.objectKey, row!.objectVersionId!)]));
  assert.equal((await runSyncAttachmentDedupMigration({ dryRun: true })).matched, 2);
  await runSyncAttachmentDedupMigration({ dryRun: false });
  assert.equal(await blobCount(), 1);
  assert.equal((await getUserStorageUsage(owner)).usedBytes, usage, 'Refund waits for signed URL drain and exact redundant version deletion');
  const converted = await Promise.all([old1.id, old2.id].map(id => attachmentStore.getOwned(owner, id)));
  const redundant = converted.find(row => row?.attachmentRedundantDeleteAfter)!;
  assert.ok(redundant);
  assert.equal(await purgeRedundantAttachmentObject(provider, redundant, clock), false);
  clock = new Date(redundant.attachmentRedundantDeleteAfter!.getTime() + 1000);
  assert.equal(await purgeRedundantAttachmentObject(provider, redundant, clock), true);
  assert.equal(await purgeRedundantAttachmentObject(provider, redundant, clock), false, 'Lost-reply retry must not refund twice');
  assert.equal((await getUserStorageUsage(owner)).usedBytes, usage - bytes.length);
  for (const row of converted) {
    const found = await service.fingerprint({ id: owner }, row!.shareId);
    assert.ok(found.ok && found.version === oldVersions.get(row!.shareId));
  }
  const finalDeletes = deletes;
  const concurrent = await Promise.all(converted.map(row => service.remove(owner, { id: row!.shareId })));
  assert.ok(concurrent.every(value => value.ok));
  assert.equal(deletes, finalDeletes + 1, 'Concurrent logical cleanup destroys only the last physical object');
  assert.equal((await getUserStorageUsage(owner)).usedBytes, initial);
  assert.equal(await blobCount(), 0);
  return ['same-account-exact-storage', 'concurrent-first-upload-and-reference-replay', 'different-account-separation',
    'logical-disposition-and-version', 'final-reference-only-delete', 'explicit-activation',
    'legacy-version-preserved', 'legacy-exact-delete-before-refund', 'reserved-digest-rejects-mismatched-part', 'empty-exact-byte-reuse'];
}

/** Real production route handlers, session cookies, private approval, file
 * commits and signed byte reads. No seeded user state or bypassed upload guard. */
export async function runAttachmentDedupRoutes(origin: string, owner: string, cookie: string, otherCookie: string) {
  const [start, parts, complete, content, remove, files] = await Promise.all([
    import('../app/routes/api/v1/attachments/uploads/_uploads'),
    import('../app/routes/api/v1/attachments/uploads/parts/_parts'),
    import('../app/routes/api/v1/attachments/uploads/complete/_complete'),
    import('../app/routes/api/v1/attachments/content/_content'),
    import('../app/routes/api/v1/attachments/delete/_delete'),
    import('../app/routes/api/v1/files/_files')
  ]);
  const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
  const req = (path: string, body?: unknown, session = cookie) => new Request(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: session, Origin: origin, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const post = async (handler: (args: any) => Promise<Response>, path: string, input: object) => {
    const response = await handler({ request: req(path, input) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  const bytes = new Uint8Array([16, 35, 66, 99, 8, 6]);
  const checksum = createHash('sha256').update(bytes).digest();
  const contentFingerprint = { algorithm: 'sha256-parts-v1', ...contentPartPlan(bytes.length), sha256: createHash('sha256').update(checksum).digest('hex') };
  const result: { name: string; id: string; attachmentId: string; version: string }[] = [];
  for (const name of ['routes-first.bin', 'routes-second.bin', 'routes-unbound.bin']) {
    const id = randomUUID(), operationId = randomUUID();
    const started = await post(start.action, '/api/v1/attachments/uploads', {
      filename: name, requestId: operationId, contentType: 'application/octet-stream', purpose: 'file', sizeBytes: bytes.length, contentFingerprint,
      fileSyncOrigin: { version: 1, deviceId: randomUUID(), localRootId: randomUUID(), fileId: id, folderId: null, path: name }
    });
    const attachmentId = started.upload.id;
    if (!result.length) {
      assert.notEqual(started.upload.state, 'ready');
      const signed = await post(parts.action, '/api/v1/attachments/uploads/parts', {
        uploadId: attachmentId, parts: [{ partNumber: 1, checksumSha256: checksum.toString('base64') }]
      });
      const target = signed.parts[0];
      const put = await handleLocalAttachmentStorageRequest(new Request(new URL(target.url, origin), {
        method: 'PUT', headers: { ...target.headers, 'Content-Length': String(bytes.length) }, body: bytes
      }));
      assert.equal(put.status, 200);
      await post(complete.action, '/api/v1/attachments/uploads/complete', { uploadId: attachmentId });
    } else assert.equal(started.upload.state, 'ready');
    const query = '/api/v1/attachments/content?id=' + attachmentId + '&fingerprint=1';
    const fingerprint = await content.loader({ request: req(query) });
    assert.equal(fingerprint.status, 200);
    const { version, fingerprint: found } = await fingerprint.json();
    assert.deepEqual(found, contentFingerprint);
    assert.equal((await content.loader({ request: req(query, undefined, otherCookie) })).status, 404);
    if (result.length < 2) {
      const commit = await post(files.action, '/api/v1/files', { id, operationId, expectedRevision: null, name, folderId: null, attachmentId, contentVersion: version, trashed: false });
      assert.deepEqual(commit.file.content, { attachmentId, version, fingerprint: contentFingerprint, size: bytes.length });
    }
    result.push({ name, id, attachmentId, version });
  }
  assert.notEqual(result[0].version, result[1].version);
  const rows = await Promise.all(result.map(value => attachmentStore.getOwned(owner, value.attachmentId)));
  assert.equal(new Set(rows.map(row => row?.attachmentBlob?.objectVersionId)).size, 1);
  await post(remove.action, '/api/v1/attachments/delete', { id: result[2].attachmentId });
  assert.equal(await attachmentStore.getOwned(owner, result[2].attachmentId), null);
  const confirmed = await files.loader({ request: req('/api/v1/files?id=' + result[1].id) });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).file.content.version, result[1].version);
  const response = await content.loader({ request: req('/api/v1/attachments/content?id=' + result[1].attachmentId + '&download=1') });
  assert.equal(response.status, 302);
  const stored = await handleLocalAttachmentStorageRequest(new Request(new URL(response.headers.get('location')!, origin)));
  assert.match(stored.headers.get('Content-Disposition')!, /routes-second\.bin/);
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
  return ['production-upload-parts-complete-delete-handlers', 'two-canonical-file-publications-and-owner-only-readback'];
}
