import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createAttachmentService } from '../app/api/utils/attachments/attachments';
import { createLocalAttachmentStorage } from '../app/api/utils/attachments/localAttachmentStorage';
import { attachmentStore, consolidateLegacySyncAttachment, findVerifiedBlobCandidate } from '../app/api/utils/attachments/attachmentStore';
import { attachmentContentVersion } from '../app/api/utils/attachments/contentFingerprint';
import { activateSyncAttachmentDedup } from '../app/api/utils/attachments/attachmentBlobActivation';
import { runSyncAttachmentDedupMigration, purgeRedundantAttachmentObject } from '../app/api/utils/attachments/attachmentBlobMaintenance';
import { contentPartPlan } from '../app/fileSync/contentFingerprint';
import { getUserStorageUsage } from '../app/api/utils/storage/userStorage';
import { getHomeThingsCollection } from '../app/api/utils/mongodb/collections';
import { reviewAttachmentModeration } from '../app/api/utils/moderation/moderationAdmin';
import { DOWNLOAD_URL_TTL_SECONDS } from '../app/api/utils/attachments/privateS3';

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
  const afterOriginal = await start(owner, input('remaining-alias.bin'));
  assert.equal(afterOriginal.state, 'ready', 'A readable surviving reference can authorize reuse');
  assert.equal(mpus, 3);
  assert.ok((await service.remove(owner, { id: afterOriginal.id })).ok);
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

  const blocked = await start(owner, input('blocked.bin'));
  await finish(owner, blocked.id);
  assert.ok((await reviewAttachmentModeration(blocked.id, 'block', 'test-moderator')).ok);
  const denied = await service.download({ id: owner }, blocked.id, true);
  assert.ok(!denied.ok && denied.status === 404);
  const beforeFallback = await getUserStorageUsage(owner);
  const beforeFallbackUploads = mpus;
  const fallback = await start(owner, input('same-digest.bin'));
  assert.equal(fallback.state, undefined, 'A blocked-only fingerprint cannot create a readable alias');
  assert.equal(mpus, beforeFallbackUploads + 1);
  assert.ok(!(await service.download({ id: owner }, fallback.id, true)).ok);
  const wrong = await service.signParts(owner, { uploadId: fallback.id, parts: [{ partNumber: 1, checksumSha256: Buffer.alloc(32).toString('base64') }] });
  assert.ok(!wrong.ok && wrong.status === 409, 'Fallback still requires the original digest');
  await finish(owner, fallback.id);
  const standalone = (await attachmentStore.getOwned(owner, fallback.id))!;
  assert.equal(standalone.attachmentBlob, undefined);
  assert.equal((await getUserStorageUsage(owner)).usedBytes! - beforeFallback.usedBytes!, standalone.sizeBytes);
  assert.equal(await blobCount(), 1);
  assert.ok((await service.remove(owner, { id: fallback.id })).ok);
  assert.ok((await service.remove(owner, { id: blocked.id })).ok);
  assert.equal((await getUserStorageUsage(owner)).usedBytes, initial);

  enabled = false;
  const old1 = await start(owner, input('old-mac.bin', false)), old2 = await start(owner, input('old-iphone.bin', false));
  await finish(owner, old1.id); await finish(owner, old2.id);
  const oldRows = await Promise.all([old1.id, old2.id].map(id => attachmentStore.getOwned(owner, id)));
  const usage = (await getUserStorageUsage(owner)).usedBytes!;
  const oldVersions = new Map(oldRows.map(row => [row!.shareId, attachmentContentVersion(row!.shareId, row!.objectKey, row!.objectVersionId!)]));
  assert.equal((await runSyncAttachmentDedupMigration({ dryRun: true })).matched, 2);
  const [oldCanonical, oldAlias] = oldRows;
  assert.equal(await consolidateLegacySyncAttachment(oldCanonical!, contentFingerprint, null), 'adopted');
  const replacement = await findVerifiedBlobCandidate(owner, bytes.length, contentFingerprint);
  assert.ok(replacement);
  const signedBeforeCommit: { url: string; expiresAt: string }[] = [];
  const aliasWriteStarted = Date.now();
  assert.equal(await consolidateLegacySyncAttachment(oldAlias!, contentFingerprint, replacement, async () => {
    // The alias is written inside the transaction, but the old locator is still
    // live to an independent authorized reader until that transaction commits.
    const current = await attachmentStore.getOwned(owner, oldAlias!.shareId);
    assert.equal(current?.attachmentBlob, undefined);
    const link = await service.download({ id: owner }, oldAlias!.shareId, true);
    assert.ok(link.ok);
    signedBeforeCommit.push(link);
  }), 'aliased');
  assert.equal(await blobCount(), 1);
  assert.equal((await getUserStorageUsage(owner)).usedBytes, usage, 'Refund waits for signed URL drain and exact redundant version deletion');
  const converted = await Promise.all([old1.id, old2.id].map(id => attachmentStore.getOwned(owner, id)));
  const redundant = converted.find(row => row?.attachmentRedundantDeleteAfter === null)!;
  assert.ok(redundant);
  const lateLink = signedBeforeCommit.at(-1);
  assert.ok(lateLink, 'An old URL was signed after the alias write and before commit');
  assert.ok(Date.parse(lateLink.expiresAt) >= aliasWriteStarted + DOWNLOAD_URL_TTL_SECONDS * 1000);
  assert.equal(await purgeRedundantAttachmentObject(provider, redundant, new Date(Date.now() + 86_400_000)), false,
    'The committed alias has no deletion authority before a later observation');
  const observedAfterCommit = Date.now();
  await runSyncAttachmentDedupMigration({ dryRun: false });
  const draining = (await attachmentStore.getOwned(owner, redundant.shareId))!;
  const drainEnds = draining.attachmentRedundantDeleteAfter!;
  assert.ok(drainEnds.getTime() >= observedAfterCommit + DOWNLOAD_URL_TTL_SECONDS * 1000);
  assert.ok(drainEnds.getTime() >= Date.parse(lateLink.expiresAt));
  assert.equal(await purgeRedundantAttachmentObject(provider, draining, new Date(drainEnds.getTime() - 1)), false);
  assert.equal((await storage.handleRequest(new Request(new URL(lateLink.url, origin)))).status, 200);
  clock = new Date(drainEnds.getTime() + 1000);
  assert.equal(await purgeRedundantAttachmentObject(provider, draining, clock), true);
  assert.equal(await purgeRedundantAttachmentObject(provider, draining, clock), false, 'Lost-reply retry must not refund twice');
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

  clock = new Date();
  const oldDelete1 = await start(owner, input('delete-before-drain-one.bin', false));
  const oldDelete2 = await start(owner, input('delete-before-drain-two.bin', false));
  await finish(owner, oldDelete1.id); await finish(owner, oldDelete2.id);
  await runSyncAttachmentDedupMigration({ dryRun: false });
  const deletePair = await Promise.all([oldDelete1.id, oldDelete2.id].map(id => attachmentStore.getOwned(owner, id)));
  const undrained = deletePair.find(row => row?.attachmentRedundantDeleteAfter === null)!;
  const canonical = deletePair.find(row => row?.attachmentRedundantDeleteAfter === undefined)!;
  assert.ok(undrained && canonical);
  const beforeDrainDeletes = deletes;
  const deferred = await service.remove(owner, { id: undrained.shareId });
  assert.ok(deferred.ok && deferred.deferred && deferred.retryAt);
  assert.equal(deletes, beforeDrainDeletes, 'Ordinary claimed delete cannot bypass a postcommit drain');
  assert.ok((await service.fingerprint({ id: owner }, canonical.shareId)).ok);
  clock = new Date(Date.parse(deferred.retryAt) + 1000);
  assert.ok((await service.remove(owner, { id: undrained.shareId })).ok);
  assert.equal(deletes, beforeDrainDeletes + 1);
  assert.ok((await service.remove(owner, { id: canonical.shareId })).ok);
  assert.equal((await getUserStorageUsage(owner)).usedBytes, initial);
  return ['same-account-exact-storage', 'concurrent-first-upload-and-reference-replay', 'different-account-separation',
    'logical-disposition-and-version', 'final-reference-only-delete', 'explicit-activation',
    'legacy-version-preserved', 'legacy-exact-delete-before-refund', 'reserved-digest-rejects-mismatched-part', 'empty-exact-byte-reuse',
    'remaining-readable-reference-authorizes-reuse', 'blocked-only-fallback-requires-exact-bytes',
    'postcommit-url-drain-and-late-signed-read', 'ordinary-delete-defers-undrained-object'];
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
  const reserve = (name: string, id: string, operationId: string) => post(start.action, '/api/v1/attachments/uploads', {
    filename: name, requestId: operationId, contentType: 'application/octet-stream', purpose: 'file', sizeBytes: bytes.length, contentFingerprint,
    fileSyncOrigin: { version: 1, deviceId: randomUUID(), localRootId: randomUUID(), fileId: id, folderId: null, path: name }
  });
  const uploadBytes = async (attachmentId: string) => {
    const signed = await post(parts.action, '/api/v1/attachments/uploads/parts', {
      uploadId: attachmentId, parts: [{ partNumber: 1, checksumSha256: checksum.toString('base64') }]
    });
    const target = signed.parts[0];
    const put = await handleLocalAttachmentStorageRequest(new Request(new URL(target.url, origin), {
      method: 'PUT', headers: { ...target.headers, 'Content-Length': String(bytes.length) }, body: bytes
    }));
    assert.equal(put.status, 200);
    await post(complete.action, '/api/v1/attachments/uploads/complete', { uploadId: attachmentId });
  };
  const result: { name: string; id: string; attachmentId: string; version: string }[] = [];
  for (const name of ['routes-first.bin', 'routes-second.bin', 'routes-unbound.bin']) {
    const id = randomUUID(), operationId = randomUUID();
    const started = await reserve(name, id, operationId);
    const attachmentId = started.upload.id;
    if (!result.length) {
      assert.notEqual(started.upload.state, 'ready');
      await uploadBytes(attachmentId);
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
  for (const { attachmentId } of result.slice(0, 2)) {
    assert.ok((await reviewAttachmentModeration(attachmentId, 'block', 'test-moderator')).ok);
    assert.equal((await content.loader({ request: req('/api/v1/attachments/content?id=' + attachmentId + '&download=1') })).status, 404);
  }
  const fallback = await reserve('routes-blocked-digest.bin', randomUUID(), randomUUID());
  assert.notEqual(fallback.upload.state, 'ready');
  assert.equal((await content.loader({ request: req('/api/v1/attachments/content?id=' + fallback.upload.id + '&download=1') })).status, 404);
  await uploadBytes(fallback.upload.id);
  const fallbackDoc = await attachmentStore.getOwned(owner, fallback.upload.id);
  assert.ok(fallbackDoc && !fallbackDoc.attachmentBlob && fallbackDoc.objectSizeBytes === bytes.length);
  await post(remove.action, '/api/v1/attachments/delete', { id: fallback.upload.id });
  return ['production-upload-parts-complete-delete-handlers', 'two-canonical-file-publications-and-owner-only-readback',
    'blocked-digest-route-requires-a-new-upload'];
}
