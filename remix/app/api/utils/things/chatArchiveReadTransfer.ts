import { CHAT_ARCHIVE_KINDS, validateChatArchiveRecords, type ChatArchiveGroup } from '../../../utils/thingTransfer/chatArchive';
import { TRANSFER_LIMITS, type TransferThing } from '../../../utils/thingTransfer/format';
import { customReactionEmojiId } from '../../../utils/reactionTokens';
import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { orderAttachmentDocsByStoredSort, toAttachmentPublicMetadata, type AttachmentPublicMetadata } from '../attachments/attachmentCore';
import { EMOJI_NAME_PATTERN } from '../../../schemas/registry';

const defaults = { collection: getHomeThingsCollection, transaction: withHomeMongoTransaction, custom: isCustomMongoEndpointActive };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const fields: Record<string, string[]> = {
  'chat-archive': ['name', 'topic', 'chatType', 'createdAt', 'selfParticipantId'],
  'chat-archive-participant': ['username', 'displayName', 'nickname', 'avatarFileId', 'joinedAt'],
  'chat-archive-message': ['participantId', 'text', 'createdAt', 'editedAt', 'deleted', 'replyToId', 'threadRootId', 'systemText'],
  'chat-archive-reaction': ['participantId', 'emoji', 'createdAt']
};
const reject = (): never => { throw new Error('Archive history is unavailable'); };
export type OwnedChatArchive = {
  group: ChatArchiveGroup;
  updatedAt: string;
  attachmentTargets: { id: string; targetId: string }[];
  /** Owner-only gallery projection; blocked and noncanonical media are omitted.
   * Targets stay separate above so re-export never silently drops hidden files. */
  attachments?: (AttachmentPublicMetadata & { targetId: string })[];
  emojiIds: string[];
  emojis?: { id: string; name: string; attachmentId: string }[];
};

/** Exactly two bounded snapshot queries, never a per-reaction lookup or live
 * participant/community resolution. Imported emojis are personal and owned. */
export const readArchiveReactionEmojis = async (
  collection: Awaited<ReturnType<typeof getHomeThingsCollection>>,
  session: Parameters<Parameters<typeof withHomeMongoTransaction>[0]>[0],
  ownerId: string, ids: string[]
): Promise<NonNullable<OwnedChatArchive['emojis']>> => {
  if (!ids.length) return [];
  if (ids.length > TRANSFER_LIMITS.things || ids.some(id => !validId(id))) reject();
  const home = (row: any) => row.ownerId === ownerId && row.appId == null && row.sandbox == null && row.sandboxSpace == null;
  const hidden = (row: any) => ['blocked', 'pending', 'nsfw'].includes(row.moderation?.status);
  const docs = await collection.find({ ownerId, thingtime: ['custom-emoji'], targetId: null, shareId: { $in: ids } } as any,
    { session, maxTimeMS: 5000, projection: { shareId: 1, ownerId: 1, targetId: 1, thingtime: 1, emojiAttachmentId: 1,
      appId: 1, sandbox: 1, sandboxSpace: 1, 'crystal.name': 1, 'moderation.status': 1 } }).limit(ids.length + 1).toArray();
  if (docs.length > ids.length) reject();
  const owned = docs.filter(row => home(row) && !hidden(row) && row.targetId == null &&
    row.thingtime?.length === 1 && row.thingtime[0] === 'custom-emoji' && ids.includes(row.shareId) &&
    validId(row.emojiAttachmentId) && typeof row.crystal?.name === 'string' && EMOJI_NAME_PATTERN.test(row.crystal.name));
  if (!owned.length) return [];
  const files = await collection.find({ ownerId, thingtime: ['attachment'], shareId: { $in: owned.map(row => row.emojiAttachmentId) } } as any,
    { session, maxTimeMS: 5000, projection: { shareId: 1, ownerId: 1, targetId: 1, thingtime: 1,
      appId: 1, sandbox: 1, sandboxSpace: 1, attachmentState: 1, attachmentPurpose: 1, attachmentLinked: 1,
      'crystal.name': 1, 'crystal.contentType': 1, 'crystal.size': 1, 'crystal.mediaKind': 1,
      'crystal.title': 1, 'crystal.description': 1, 'crystal.filenamePreview': 1, 'crystal.detectedContentType': 1,
      'crystal.url': 1, 'moderation.status': 1 } }).limit(owned.length + 1).toArray();
  if (files.length > owned.length) reject();
  return owned.flatMap(emoji => {
    const file = files.find(row => row.shareId === emoji.emojiAttachmentId);
    if (!file || !home(file) || hidden(file) || file.targetId !== emoji.shareId || file.attachmentLinked ||
      file.attachmentState !== 'ready' || file.attachmentPurpose !== 'custom-emoji' ||
      file.thingtime?.length !== 1 || file.thingtime[0] !== 'attachment') return [];
    const media = toAttachmentPublicMetadata(file.shareId, file.crystal, file.moderation, { ownerView: true });
    return media?.mediaKind === 'image' && !media.url && !media.nsfw && !media.pending
      ? [{ id: emoji.shareId, name: emoji.crystal.name, attachmentId: file.shareId }] : [];
  });
};

/** API-layer snapshot reader, shared by rendering and re-export adapters.
 * The caller must first enforce first-party token scope. Never resolves archived
 * usernames to accounts. Returned IDs discover media; the canonical attachment
 * service must still authorize/render/download every file (no S3 keys here).
 */
export const readOwnedChatArchive = async (ownerId: string | undefined, rootId: string, deps = defaults): Promise<OwnedChatArchive | null> => {
  if (!validId(ownerId) || !validId(rootId) || deps.custom()) return null;
  return deps.transaction(async session => {
    const collection = await deps.collection();
    const scope = { ownerId, archiveRootId: rootId, archiveVersion: 1 };
    const root = await collection.findOne({ ...scope, shareId: rootId, thingtime: ['chat-archive'] } as any, { session, maxTimeMS: 5000 });
    if (!root || root.ownerId !== ownerId || root.archiveDeleting || root.appId != null || root.sandbox != null || root.sandboxSpace != null) return null;
    if (!(root.updatedAt instanceof Date) || !Number.isFinite(root.updatedAt.getTime())) reject();
    const rows = await collection.find(scope as any, { session, maxTimeMS: 5000 }).sort({ createdAt: 1, shareId: 1 }).limit(TRANSFER_LIMITS.things + 1).toArray();
    if (rows.length > TRANSFER_LIMITS.things || new Set(rows.map(row => row.shareId)).size !== rows.length ||
      rows.filter(row => row.shareId === rootId && row.thingtime?.[0] === 'chat-archive').length !== 1) reject();
    const selfId = root.crystal?.selfParticipantId;
    const things: TransferThing[] = rows.map(row => {
      if (!validId(row.shareId) || row.ownerId !== ownerId || row.archiveRootId !== rootId || row.archiveVersion !== 1 ||
        row.archiveDeleting || row.appId != null || row.sandbox != null || row.sandboxSpace != null ||
        !Array.isArray(row.thingtime) || row.thingtime.length !== 1 || !(CHAT_ARCHIVE_KINDS as readonly string[]).includes(row.thingtime[0]) ||
        !row.crystal || typeof row.crystal !== 'object' || Array.isArray(row.crystal)) reject();
      if (row.thingtime[0] === 'chat-archive-participant' && (row.shareId === selfId
        ? row.crystal.archived !== false || row.crystal.userId !== ownerId
        : row.crystal.archived !== true || row.crystal.userId !== undefined)) reject();
      return { id: row.shareId, thingtime: [...row.thingtime],
        crystal: Object.fromEntries(fields[row.thingtime[0]].filter(key => row.crystal[key] !== undefined).map(key => [key, row.crystal[key]])),
        ...(row.targetId ? { targetId: row.targetId } : {}), ...(row.folderId ? { folderId: row.folderId } : {}) };
    });
    const targets = rows.map(row => row.shareId);
    const attachments = await collection.find({ ownerId, thingtime: ['attachment'], targetId: { $in: targets } } as any,
      { session, maxTimeMS: 5000, projection: { shareId: 1, ownerId: 1, targetId: 1, attachmentLinked: 1, attachmentState: 1,
        attachmentPurpose: 1, attachmentSortIndex: 1, createdAt: 1, appId: 1, sandbox: 1, sandboxSpace: 1,
        'crystal.contentType': 1, 'crystal.size': 1, 'crystal.name': 1, 'crystal.mediaKind': 1,
        'crystal.title': 1, 'crystal.description': 1, 'crystal.filenamePreview': 1,
        'crystal.detectedContentType': 1, 'crystal.url': 1, 'moderation.status': 1 } }).limit(TRANSFER_LIMITS.files + 1).toArray();
    if (attachments.length > TRANSFER_LIMITS.files || new Set(attachments.map(row => row.shareId)).size !== attachments.length || attachments.some(row =>
      !validId(row.shareId) || targets.includes(row.shareId) || row.ownerId !== ownerId || !targets.includes(row.targetId) ||
      row.attachmentState !== 'ready' || row.attachmentPurpose !== 'post' || row.appId != null || row.sandbox != null || row.sandboxSpace != null)) reject();
    const emojiIds = [...new Set(things.filter(row => row.thingtime[0] === 'chat-archive-reaction')
      .map(row => customReactionEmojiId(String(row.crystal.emoji))).filter((id): id is string => !!id))];
    const groups = validateChatArchiveRecords({ things,
      files: attachments.filter(row => !row.attachmentLinked).map(row => ({ id: row.shareId, targetId: row.targetId, mime: row.crystal?.contentType, bytes: row.crystal?.size })),
      links: attachments.filter(row => row.attachmentLinked).map(row => ({ id: row.shareId, targetId: row.targetId }))
    }, new Set(emojiIds));
    if (groups.length !== 1 || groups[0].root.id !== rootId) reject();
    const emojis = await readArchiveReactionEmojis(collection, session, ownerId, emojiIds);
    const result = { group: groups[0], updatedAt: root.updatedAt.toISOString(), emojiIds, emojis,
      attachments: orderAttachmentDocsByStoredSort<{
        shareId: string; targetId: string; crystal: unknown; moderation?: unknown; attachmentSortIndex?: unknown;
      }>(attachments as any).flatMap(row => {
        // The enclosing snapshot has already checked exact owner, target,
        // ready state and home namespace for every row. Reuse the gallery's
        // canonical whitelist/moderation projection, never raw crystal/S3 data.
        const media = toAttachmentPublicMetadata(row.shareId, row.crystal, row.moderation, { ownerView: true });
        return media ? [{ ...media, targetId: row.targetId }] : [];
      }),
      attachmentTargets: orderAttachmentDocsByStoredSort<{ shareId: string; targetId: string; attachmentSortIndex?: unknown }>(attachments as any)
        .map(row => ({ id: row.shareId, targetId: row.targetId })) };
    const encoded = JSON.stringify(result);
    if (Buffer.byteLength(encoded) > TRANSFER_LIMITS.manifestBytes) reject();
    return JSON.parse(encoded) as OwnedChatArchive;
  });
};
