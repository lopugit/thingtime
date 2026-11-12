import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttachmentService } from './attachments';
import type { AttachmentDoc } from './attachmentStore';

test('recording import intents preserve purpose and reserve once without replaying durable recordings', async () => {
  const now = new Date('2026-09-11T00:00:00Z');
  const docs = new Map<string, AttachmentDoc>();
  let reservations = 0;
  let multipartStarts = 0;
  const service = createAttachmentService({
    now: () => now, customMongoActive: () => false,
    getS3: () => ({ createMultipartUpload: async () => { multipartStarts++; return { uploadId: 'mpu' }; } }) as any,
    store: {
      listExpiredOwned: async () => [],
      getById: async (id: string) => docs.get(id) || null,
      reservePending: async (input: any) => {
        reservations++;
        assert.equal(input.purpose, 'recording');
        assert.equal(input.recordingImportDraft, true);
        const doc = { shareId: input.id, ownerId: input.ownerId, crystal: input.crystal,
          attachmentPurpose: input.purpose, attachmentImportDraft: true, attachmentState: 'pending',
          attachmentExpiresAt: input.expiresAt, attachmentRequestFingerprint: input.requestFingerprint } as AttachmentDoc;
        docs.set(input.id, doc); return doc;
      },
      setUploadId: async (_owner: string, id: string, uploadId: string) => {
        const doc = { ...docs.get(id)!, uploadId }; docs.set(id, doc); return doc;
      }
    } as any
  });
  const input = { purpose: 'recording-import', requestId: 'import-recording-1', filename: 'clip.wav', contentType: 'audio/wav', sizeBytes: 4 };
  const start = await service.start('owner', input);
  assert.ok(start.ok); if (!start.ok) return;
  const id = String(start.upload.id);
  assert.ok((await service.start('owner', input)).ok);
  assert.equal(reservations, 1); assert.equal(multipartStarts, 1);
  for (const purpose of ['recording', 'post', 'message']) {
    const conflict = await service.start('owner', { ...input, purpose });
    assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.status, 409);
  }
  const ready = { ...docs.get(id)!, attachmentState: 'ready' as const, uploadId: undefined };
  docs.set(id, ready);
  const replay = await service.start('owner', input);
  assert.ok(replay.ok); if (replay.ok) {
    assert.equal(replay.upload.state, 'ready');
    assert.equal(replay.upload.expiresAt, ready.attachmentExpiresAt!.toISOString());
  }
  for (const patch of [{ attachmentImportDraft: undefined }, { attachmentExpiresAt: undefined },
    { attachmentExpiresAt: now }, { attachmentExpiresAt: new Date(NaN) }]) {
    docs.set(id, { ...ready, ...patch });
    const denied = await service.start('owner', input);
    assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.status, 409);
  }
  assert.equal(reservations, 1); assert.equal(multipartStarts, 1);
});
