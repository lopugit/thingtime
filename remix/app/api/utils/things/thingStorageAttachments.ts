import { collectWebpageAttachmentIds } from '../../../components/Builder/webpageAttachmentRefs';
import type { ThingStorageAttachment, ThingStorageAttachmentPage } from '../../../utils/thingStoragePolicy';
import { ATTACHMENT_THINGTIME, isAttachmentThing, VAULT_ATTACHMENT_PURPOSE } from '../attachments/attachmentCore';
import type { AttachmentDoc } from '../attachments/attachmentStore';
import { getAttachmentFingerprint } from '../attachments/attachments';
import { attachmentContentVersion } from '../attachments/contentFingerprint';
import { getHomeThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { storedAttachmentBytes } from './thingMetadataCore';
import { storagePolicyFail, storagePolicySource } from './thingStoragePolicy';
import { findThingMetadataSource, type Fail, type Viewer } from './things';
import { isStorageDeviceId } from './thingStoragePolicyCore';

// Per-request working page, not a limit on the source or number of assets.
const PAGE = 16;
const unavailable = (id: string): ThingStorageAttachment => ({ id, version: null, size: null, fingerprint: null });

async function inspectAttachment(id: string, viewer: NonNullable<Viewer>, doc?: AttachmentDoc | null, expectedVersion?: string): Promise<ThingStorageAttachment> {
  if (!doc || doc.ownerId !== viewer.id || doc.attachmentPurpose === VAULT_ATTACHMENT_PURPOSE || doc.attachmentImportDraft === true)
    return unavailable(id);
  const size = storedAttachmentBytes(doc, expectedVersion);
  if (size === null) return unavailable(id);
  const version = attachmentContentVersion(doc.shareId, doc.objectKey, doc.objectVersionId!);
  const receipt = await getAttachmentFingerprint(viewer, id);
  if (!receipt.ok || receipt.id !== id || receipt.version !== version || receipt.size !== size) return unavailable(id);
  return { id, version, size, fingerprint: receipt.fingerprint };
}

export async function readThingStorageAttachments(viewer: Viewer, id: string, cursor: string | null, signal?: AbortSignal): Promise<ThingStorageAttachmentPage | Fail> {
  if (!viewer?.id || viewer.pat) return storagePolicyFail(401, 'A full user session is required');
  if (isCustomMongoEndpointActive()) return storagePolicyFail(409, 'Attachment placement requires the home data plane');
  try {
    const source = await findThingMetadataSource(id, viewer);
    if (!source || source.ownerId !== viewer.id) return storagePolicyFail(404, 'Thing not found');
    const projection = storagePolicySource(source, signal);
    const things = await getHomeThingsCollection(), options = signal ? { signal } : {};
    const owned = { ownerId: viewer.id, thingtime: [ATTACHMENT_THINGTIME], appId: null, sandboxSpace: null, sandboxExpiresAt: null };
    let items: ThingStorageAttachment[], nextCursor: string | null = null;
    if (source.thingtime?.length === 1 && source.thingtime[0] === 'file') {
      const content = source.crystal?.content;
      if (cursor || !isStorageDeviceId(content?.attachmentId) || typeof content.version !== 'string' || !/^[a-f0-9]{64}$/.test(content.version))
        return storagePolicyFail(409, 'The current file attachment is unavailable');
      const doc = await things.findOne({ ...owned, shareId: content.attachmentId, targetId: source.shareId, attachmentPurpose: 'file' }, options) as unknown as AttachmentDoc | null;
      items = [await inspectAttachment(content.attachmentId, viewer, doc, content.version)];
    } else if (isAttachmentThing(source)) {
      if (cursor) return storagePolicyFail(400, 'This attachment page has no continuation');
      items = [await inspectAttachment(source.shareId, viewer, source as unknown as AttachmentDoc)];
    } else {
      const bound = await things.find({ ...owned, targetId: source.shareId, attachmentPurpose: { $in: [null, 'post', 'comment'] },
        ...(cursor ? { shareId: { $gt: cursor } } : {}) }, options).sort({ shareId: 1 }).limit(PAGE + 1).toArray() as unknown as AttachmentDoc[];
      const references = source.thingtime?.includes('webpage') ? collectWebpageAttachmentIds(source.crystal) : [];
      const ids = [...new Set([...bound.map(doc => doc.shareId), ...references.filter(reference => !cursor || reference > cursor)])].sort().slice(0, PAGE + 1);
      if (ids.length > PAGE) { ids.pop(); nextCursor = ids.at(-1)!; }
      const byId = new Map(bound.map(doc => [doc.shareId, doc]));
      const unbound = ids.filter(id => !byId.has(id));
      if (unbound.length) {
        const candidates = await things.find({ ...owned, shareId: { $in: unbound } }, options).toArray() as unknown as AttachmentDoc[];
        for (const doc of candidates) byId.set(doc.shareId, doc);
      }
      items = [];
      // A small simultaneous HEAD batch keeps request and object-store
      // concurrency bounded while still processing every continuation page.
      for (let offset = 0; offset < ids.length; offset += 4) {
        signal?.throwIfAborted();
        items.push(...await Promise.all(ids.slice(offset, offset + 4).map(id => inspectAttachment(id, viewer, byId.get(id)))));
      }
    }
    const current = await findThingMetadataSource(id, viewer);
    if (!current || current.ownerId !== viewer.id) return storagePolicyFail(404, 'Thing not found');
    const checked = storagePolicySource(current, signal);
    if (checked.revision !== projection.revision || checked.sourceHash !== projection.sourceHash)
      return storagePolicyFail(409, 'The Thing changed while its attachments were verified');
    return { ok: true, source: projection, attachments: { items, nextCursor } };
  } catch { return storagePolicyFail(503, 'Thing attachments are temporarily unavailable'); }
}
