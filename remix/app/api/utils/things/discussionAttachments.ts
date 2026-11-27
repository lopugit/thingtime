import { orderAttachmentDocsByStoredSort, toAttachmentPublicMetadata, type AttachmentPublicMetadata } from '../attachments/attachmentCore';

type Source = { ownerId: string; purpose: 'post' | 'comment' };
/** A discussion keeps every authorized attachment in stored display order.
 * The query performs live ACL/moderation gates; this projection independently
 * refuses foreign owners, mismatched purposes and standalone attachments. */
export function discussionAttachmentMap(docs: any[], sources: ReadonlyMap<string, Source>, viewerId: string | null): Map<string, AttachmentPublicMetadata[]> {
  const result = new Map<string, AttachmentPublicMetadata[]>();
  for (const doc of orderAttachmentDocsByStoredSort(docs)) {
    const source = sources.get(doc.targetId);
    if (!source || doc.ownerId !== source.ownerId || doc.attachmentState !== 'ready' || !Array.isArray(doc.acl) || doc.acl.length !== 1 || doc.acl[0] !== 'tt:inherit' || doc.appId != null || (source.purpose === 'comment' ? doc.attachmentPurpose !== 'comment' : ![undefined, null, 'post'].includes(doc.attachmentPurpose))) continue;
    const attachment = toAttachmentPublicMetadata(doc.shareId, doc.crystal, doc.moderation, { ownerView: doc.ownerId === viewerId });
    if (!attachment) continue;
    const attachments = result.get(doc.targetId) || [];
    attachments.push(attachment); result.set(doc.targetId, attachments);
  }
  return result;
}
