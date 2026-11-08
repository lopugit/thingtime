import { createHash } from 'node:crypto';
import { canonicalJsonBytes } from '../../../utils/canonicalJsonStream';
import type { ThingMetadata } from '../../../utils/thingMetadata';
import { attachmentObjectSizeBytesForAccounting, isAttachmentObjectVersionId } from '../attachments/attachmentCore';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import type { AttachmentDoc } from '../attachments/attachmentStore';
import { thingStorageJsonPayload } from '../storage/storageCore';

export function measureThingJson(source: { crystal?: unknown; extended?: unknown; tags?: unknown }, check?: () => void) {
  const payload = thingStorageJsonPayload(source);
  const measure = (json: unknown) => {
    const hash = createHash('sha256');
    let jsonBytes = 0;
    for (const chunk of canonicalJsonBytes(json, check)) {
      hash.update(chunk);
      jsonBytes += chunk.byteLength;
    }
    return { sourceHash: hash.digest('hex'), jsonBytes, canonicalVersion: 1 as const };
  };
  // Stored content uses inert JSON. Older BSON rows can contain real Dates
  // and optional values. Use their exact JSON wire representation, as the
  // logical storage meter does, and then canonicalize its object order.
  try { return measure(payload); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Canonical JSON ')) throw error;
    return measure(JSON.parse(JSON.stringify(payload)));
  }
}

/** Only the upload-owned envelope can establish a byte count. Author-provided
 * size fields and external link lengths are outside this evidence. */
export function storedAttachmentBytes(doc: AttachmentDoc, version?: string): number | null {
  if (doc.attachmentState !== 'ready' || doc.attachmentLinked || !isAttachmentObjectVersionId(doc.objectVersionId)) return null;
  const bytes = attachmentObjectSizeBytesForAccounting(doc);
  if (bytes == null) return null;
  if (version !== undefined && attachmentContentVersion(doc.shareId, doc.objectKey, doc.objectVersionId!) !== version) return null;
  return bytes;
}

export function summarizeThingAttachments(attachments: Iterable<number | null>): Pick<ThingMetadata,
  'attachedBytes' | 'knownAttachedBytes' | 'attachmentCount' | 'unavailableAttachmentCount'> {
  let knownAttachedBytes = 0, attachmentCount = 0, unavailableAttachmentCount = 0;
  for (const bytes of attachments) {
    attachmentCount++;
    if (bytes === null) unavailableAttachmentCount++;
    else knownAttachedBytes += bytes;
  }
  if (!Number.isSafeInteger(knownAttachedBytes)) throw new RangeError('Attachment byte total exceeds the exact counter range');
  return { attachedBytes: unavailableAttachmentCount ? null : knownAttachedBytes, knownAttachedBytes, attachmentCount, unavailableAttachmentCount };
}
