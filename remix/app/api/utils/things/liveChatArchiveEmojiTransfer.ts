import { getHomeThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { TRANSFER_LIMITS } from '../../../utils/thingTransfer/format';
import { projectTransferEmojiSource, type TransferEmojiSource } from './emojiTransfer';

const defaults = { collection: getHomeThingsCollection, custom: isCustomMongoEndpointActive };
const reject = (): never => { throw new Error('An archive emoji is unavailable'); };
/** SERVER INTERNAL: IDs must come exclusively from the validated, membership-
 * authorized live-chat snapshot. This is not a standalone emoji lookup API.
 * Batch lookup is bounded and only content is projected. Stored image bytes
 * still require the canonical attachment reader's current access/moderation gate. */
export const readLiveChatArchiveEmojis = async (ids: readonly string[], overrides: Partial<typeof defaults> = {}): Promise<TransferEmojiSource[]> => {
  const deps = { ...defaults, ...overrides };
  if (!ids.length) return [];
  if (deps.custom() || ids.length > TRANSFER_LIMITS.things || new Set(ids).size !== ids.length ||
    ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))) reject();
  const docs = await (await deps.collection()).find({ shareId: { $in: [...ids] }, thingtime: ['custom-emoji'],
    appId: null, sandbox: null, sandboxSpace: null } as any, { maxTimeMS: 5000, projection: {
    shareId: 1, thingtime: 1, appId: 1, sandbox: 1, sandboxSpace: 1, emojiAttachmentId: 1,
    'crystal.name': 1, 'crystal.image': 1, 'moderation.status': 1
  } }).limit(ids.length + 1).toArray();
  if (docs.length !== ids.length || new Set(docs.map(row => row.shareId)).size !== ids.length) reject();
  const byId = new Map<string, (typeof docs)[number]>(docs.map(row => [row.shareId, row]));
  return ids.map(id => {
    const doc = byId.get(id);
    if (!doc || doc.appId != null || doc.sandbox != null || doc.sandboxSpace != null ||
      doc.thingtime?.length !== 1 || doc.thingtime[0] !== 'custom-emoji' ||
      ['blocked', 'pending', 'nsfw'].includes(doc.moderation?.status as string)) return reject();
    return projectTransferEmojiSource(doc, id);
  });
};
