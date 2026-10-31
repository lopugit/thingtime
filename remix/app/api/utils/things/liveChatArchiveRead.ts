import { getHomeThingsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { relationshipLookupFilter } from '../mongodb/relationshipLookup';
import { TRANSFER_LIMITS } from '../../../utils/thingTransfer/format';

const defaults = { collection: getHomeThingsCollection, transaction: withHomeMongoTransaction,
  custom: isCustomMongoEndpointActive, membershipFilter: relationshipLookupFilter };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);
const reject = (): never => { throw new Error('Complete chat history is unavailable'); };
const home = (row: any) => row.appId == null && row.sandbox == null && row.sandboxSpace == null;
const shape = (row: any, kind: string) => row && validId(row.shareId) && validId(row.ownerId) && home(row) &&
  Array.isArray(row.thingtime) && row.thingtime.length === 1 && row.thingtime[0] === kind;
const envelope = { _id: 0, shareId: 1, ownerId: 1, targetId: 1, thingtime: 1, createdAt: 1, updatedAt: 1,
  appId: 1, sandbox: 1, sandboxSpace: 1 } as const;

/** Server-internal source records, NOT a public response or portable manifest.
 * A downstream whitelist must render system/AI history and resolve public
 * profiles/media before calling projectLiveChatArchive. No storage keys or
 * credential envelopes are selected. Route callers still require first-party
 * user scope; a bare source ID cannot authorize this reader. */
export const readLiveChatArchiveSource = async (viewerId: string, chatId: string, deps = defaults) => {
  if (!validId(viewerId) || !validId(chatId) || deps.custom()) return null;
  // Relationship readiness may migrate canonical keys; do it before opening
  // the read transaction, never on another session inside its snapshot.
  const memberFilter = await deps.membershipFilter('memberKey', `${chatId}:${viewerId}`, { home: true });
  return deps.transaction(async session => {
    const collection = await deps.collection();
    const options = { session, maxTimeMS: 5000 };
    const chat = await collection.findOne({ shareId: chatId, thingtime: 'chat' } as any,
      { ...options, projection: { ...envelope, 'crystal.name': 1, 'crystal.topic': 1, 'crystal.chatType': 1, 'crystal.externalSource': 1 } });
    if (!shape(chat, 'chat') || chat!.shareId !== chatId) return null;
    const member = await collection.findOne({ thingtime: 'chat-member', ...memberFilter } as any,
      { ...options, projection: { ...envelope, 'crystal.state': 1, 'crystal.memberKey': 1 } });
    if (!shape(member, 'chat-member') || member!.ownerId !== viewerId || member!.targetId !== chatId ||
      member!.crystal?.memberKey !== `${chatId}:${viewerId}` || !['active', 'pending'].includes(member!.crystal?.state)) return null;

    const read = async (kind: string, filter: Record<string, unknown>, projection: Record<string, number>, limit: number) => {
      // Mongo's limit(0) means unbounded; always fetch one overflow sentinel,
      // including when no budget remains. Reject impossible budgets first.
      if (!Number.isSafeInteger(limit) || limit < 0) reject();
      const rows = await collection.find({ thingtime: kind, ...filter } as any,
        { ...options, projection: { ...envelope, ...projection } }).sort({ createdAt: 1, shareId: 1 }).limit(limit + 1).toArray();
      if (rows.length > limit || rows.some(row => !shape(row, kind)) || new Set(rows.map(row => row.shareId)).size !== rows.length) reject();
      return rows;
    };
    // Include former members and all threads. Neither state nor threadRootId
    // filters belong here: they would silently remove historical identities.
    const members = await read('chat-member', { targetId: chatId }, { 'crystal.nickname': 1, 'crystal.state': 1 }, TRANSFER_LIMITS.things - 1);
    if (members.some(row => row.targetId !== chatId) || !members.some(row => row.shareId === member!.shareId && row.ownerId === viewerId) ||
      new Set(members.map(row => row.ownerId)).size !== members.length) reject();
    const messages = await read('chat-message', { targetId: chatId }, {
      'crystal.text': 1, 'crystal.deletedAt': 1, 'crystal.editedAt': 1, 'crystal.replyToId': 1, 'crystal.threadRootId': 1,
      'crystal.systemType': 1, 'crystal.systemMeta': 1, 'crystal.externalSource': 1, 'crystal.lopu': 1
    }, TRANSFER_LIMITS.things - 1 - members.length);
    if (messages.some(row => row.targetId !== chatId)) reject();
    const messageIds = messages.map(row => row.shareId);
    const reactions = messageIds.length ? await read('reaction', { targetId: { $in: messageIds } },
      { 'crystal.emoji': 1 }, TRANSFER_LIMITS.things - 1 - members.length - messages.length) : [];
    if (reactions.some(row => !messageIds.includes(row.targetId))) reject();
    const visibleMessages = messages.filter(row => !row.crystal?.deletedAt);
    const visibleIds = visibleMessages.map(row => row.shareId);
    const attachments = visibleIds.length ? await read('attachment', { targetId: { $in: visibleIds }, attachmentState: 'ready', attachmentPurpose: 'message' }, {
      attachmentState: 1, attachmentPurpose: 1, attachmentLinked: 1, attachmentSortIndex: 1,
      'crystal.name': 1, 'crystal.contentType': 1, 'crystal.size': 1, 'crystal.mediaKind': 1,
      'crystal.title': 1, 'crystal.description': 1, 'crystal.filenamePreview': 1, 'crystal.url': 1, 'moderation.status': 1
    }, TRANSFER_LIMITS.files) : [];
    if (attachments.some(row => row.attachmentState !== 'ready' || row.attachmentPurpose !== 'message' ||
      !visibleMessages.some(message => message.shareId === row.targetId && message.ownerId === row.ownerId))) reject();
    const allIds = [chat!.shareId, ...members, ...messages, ...reactions, ...attachments].map(row => typeof row === 'string' ? row : row.shareId);
    if (new Set(allIds).size !== allIds.length) reject();
    const result = { chat: chat!, members, messages, reactions, attachments };
    if (Buffer.byteLength(JSON.stringify(result)) > TRANSFER_LIMITS.manifestBytes) reject();
    return result;
  });
};
