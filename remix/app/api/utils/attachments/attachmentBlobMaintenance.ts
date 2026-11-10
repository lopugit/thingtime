import { getHomeThingsCollection } from '../mongodb/collections';
import { attachmentPhysicalObject, sameAttachmentBlobFingerprint } from './attachmentBlobs';
import { consolidateLegacySyncAttachment, findVerifiedBlobCandidate, refundRedundantAttachmentObject, type AttachmentDoc } from './attachmentStore';
import { isAttachmentObjectVersionId } from './attachmentCore';
import { fingerprintFromVerifiedHead } from './contentFingerprint';
import { DOWNLOAD_URL_TTL_SECONDS, getPrivateS3, type AttachmentS3 } from './privateS3';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { syncAttachmentDedupActive } from './attachmentBlobActivation';

const eligible = { thingtime: 'attachment', attachmentPurpose: 'file', attachmentState: 'ready',
  attachmentFileSyncOrigin: { $exists: true }, attachmentLinked: { $ne: true }, attachmentImportDraft: { $ne: true },
  'moderation.status': { $ne: 'blocked' }, objectVersionId: { $type: 'string' }, attachmentBlob: { $exists: false } };
const superseded = { thingtime: 'attachment', attachmentPurpose: 'file', attachmentRedundantDeleteAfter: { $type: 'date' } };
const urlDrainMs = DOWNLOAD_URL_TTL_SECONDS * 1000;
// One existing shareId cursor for each pass. Retain headroom under the
// deployed request budget; invocations continue from these durable cursors.
const workPage = 64;
const workBudgetMs = 20000;
const cursorKey = 'maintenance:sync-attachment-dedup:v1';

export async function purgeRedundantAttachmentObject(s3: AttachmentS3, doc: AttachmentDoc, now: Date): Promise<boolean> {
  if (!doc.attachmentRedundantDeleteAfter || doc.attachmentRedundantDeleteAfter > now) return false;
  const replacement = attachmentPhysicalObject(doc);
  if (doc.objectKey !== 'objects/' + doc.shareId || doc.objectKey === replacement.objectKey ||
    !isAttachmentObjectVersionId(doc.objectVersionId) || !replacement.versionId || !doc.attachmentExpectedFingerprint)
    throw Error('Superseded sync object identity changed');
  const head = await s3.headObject({ objectKey: replacement.objectKey, versionId: replacement.versionId });
  if (head.attachmentId !== replacement.attachmentId || head.versionId !== replacement.versionId || head.sizeBytes !== doc.objectSizeBytes ||
    !sameAttachmentBlobFingerprint(doc.attachmentExpectedFingerprint, fingerprintFromVerifiedHead(head), doc.objectSizeBytes))
    throw Error('Verified replacement sync object is unavailable');
  await s3.deleteObject({ objectKey: doc.objectKey, versionId: doc.objectVersionId });
  return refundRedundantAttachmentObject(doc);
}

export async function countSyncAttachmentDedupPending(): Promise<number> {
  const things = await getHomeThingsCollection();
  return things.countDocuments({ $or: [eligible, superseded] } as any);
}

export async function runSyncAttachmentDedupMigration(
  options: { dryRun: boolean; assertLease?: () => Promise<void> }
) {
  if (isCustomMongoEndpointActive()) throw Error('Sync attachment consolidation requires home storage');
  const things = await getHomeThingsCollection();
  const matched = await countSyncAttachmentDedupPending();
  const notes = ['Preserves logical IDs, versions, ACLs and retention. Refund follows verified exact-version deletion after signed URL expiry.'];
  if (options.dryRun || !matched) return { dryRun: options.dryRun, matched, created: 0, migrated: 0, skipped: 0, notes };
  if (!await syncAttachmentDedupActive()) throw Error('Activate sync attachment deduplication on this compatible home database before consolidation');
  const { getSettingsCollection } = await import('../mongodb/collections');
  const settings = await getSettingsCollection();
  const cursors = await settings.findOne({ key: cursorKey }) as { release?: string; adopt?: string } | null;
  const now = new Date(), deadline = Date.now() + workBudgetMs;
  const s3 = getPrivateS3();
  let created = 0, migrated = 0, skipped = 0, switched = 0;
  const pass = async (step: 'release' | 'adopt', match: object, apply: (doc: AttachmentDoc) => Promise<void>) => {
    const old = cursors?.[step] ?? '';
    const candidates = things.find({ ...match, shareId: { $gt: old } } as any)
      .sort({ shareId: 1 }).limit(workPage);
    let cursor = old, read = 0, interrupted = false;
    try {
      for await (const row of candidates) {
        if (Date.now() >= deadline) { interrupted = true; break; }
        await options.assertLease?.();
        const doc = row as unknown as AttachmentDoc;
        try { await apply(doc); } catch { skipped++; }
        cursor = doc.shareId;
        read++;
      }
    } finally { await candidates.close(); }
    await options.assertLease?.();
    await settings.updateOne({ key: cursorKey }, { $set: { [step]: !interrupted && read < workPage ? '' : cursor, updatedAt: new Date() } }, { upsert: true });
  };
  await pass('release', { ...superseded, attachmentRedundantDeleteAfter: { $lte: now } }, async doc => {
    if (await purgeRedundantAttachmentObject(s3, doc, now)) migrated++;
    else skipped++;
  });
  await pass('adopt', eligible, async doc => {
    if (!isAttachmentObjectVersionId(doc.objectVersionId) || doc.objectKey !== 'objects/' + doc.shareId) { skipped++; return; }
    const head = await s3.headObject({ objectKey: doc.objectKey, versionId: doc.objectVersionId });
    const fingerprint = fingerprintFromVerifiedHead(head);
    if (head.versionId !== doc.objectVersionId || head.attachmentId !== doc.shareId || head.sizeBytes !== doc.objectSizeBytes || !fingerprint) {
      skipped++; return;
    }
    const replacement = await findVerifiedBlobCandidate(doc.ownerId, doc.objectSizeBytes, fingerprint);
    if (replacement) {
      const stored = await s3.headObject({ objectKey: 'objects/' + replacement.objectAttachmentId, versionId: replacement.objectVersionId });
      if (stored.attachmentId !== replacement.objectAttachmentId || stored.versionId !== replacement.objectVersionId ||
        stored.sizeBytes !== doc.objectSizeBytes || !sameAttachmentBlobFingerprint(fingerprint, fingerprintFromVerifiedHead(stored), doc.objectSizeBytes)) {
        skipped++; return;
      }
    }
    await options.assertLease?.();
    const result = await consolidateLegacySyncAttachment(doc, fingerprint, new Date(Date.now() + urlDrainMs), replacement);
    if (result === 'adopted') created++;
    else if (result === 'aliased') switched++;
    else skipped++;
  });
  notes.push(`Canonical objects registered: ${created}; references repointed: ${switched}; old object versions deleted and refunded: ${migrated}. Repeat after the URL expiry window until no work remains.`);
  return { dryRun: false, matched, created, migrated: migrated + switched, skipped, notes };
}
