import { validateChatArchiveRecords, type ChatArchiveGroup } from '../../../utils/thingTransfer/chatArchive';
import { TRANSFER_LIMITS, type TransferThing } from '../../../utils/thingTransfer/format';
import { customReactionEmojiId } from '../../../utils/reactionTokens';

/** Internal input, not an API request or permission grant. A membership-gated
 * reader must supply one complete snapshot, including former authors/reactors
 * and every thread. Do not feed paginated listMessages results into this. */
export type LiveChatArchiveSnapshot = {
  chat: { id: string; name: string; topic: string; chatType: 'dm' | 'group' | 'channel'; createdAt: string };
  participants: { id: string; userId: string; username: string; displayName: string; nickname: string;
    joinedAt: string; avatarFileId?: string }[];
  messages: { id: string; authorId: string; text: string; createdAt: string; editedAt?: string;
    deleted: boolean; replyToId?: string; threadRootId?: string; systemText?: string }[];
  reactions: { id: string; messageId: string; userId: string; emoji: string; createdAt: string }[];
  files: { id: string; targetId: string; mime: string; bytes: number }[];
  links: { id: string; targetId: string }[];
};

const reject = (): never => { throw new Error('Complete chat history is required for export'); };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id);

/** Pure whitelist projection. Source account IDs are used only for matching;
 * portable rows never carry live user IDs, roles, receipts or membership state.
 * The existing archive importer later replaces self with its current owner. */
export const projectLiveChatArchive = (snapshot: LiveChatArchiveSnapshot, viewerId: string): {
  group: ChatArchiveGroup; emojiIds: string[]; attachmentTargets: { id: string; targetId: string }[];
} => {
  const { chat, participants, messages, reactions, files, links } = snapshot;
  if (!validId(viewerId) || !validId(chat.id) ||
    1 + participants.length + messages.length + reactions.length > TRANSFER_LIMITS.things ||
    files.length + links.length > TRANSFER_LIMITS.files) reject();
  const ids = [chat.id, ...participants.map(row => row.id), ...messages.map(row => row.id), ...reactions.map(row => row.id)];
  if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) reject();
  const userIds = participants.map(row => row.userId);
  if (userIds.some(id => !validId(id)) || new Set(userIds).size !== userIds.length) reject();
  const byUser = new Map(participants.map(row => [row.userId, row.id]));
  const self = byUser.get(viewerId);
  if (!self) reject();
  const participant = (id: string) => byUser.get(id) || reject();
  const things: TransferThing[] = [{ id: chat.id, thingtime: ['chat-archive'], crystal: {
    name: chat.name, topic: chat.topic, chatType: chat.chatType, createdAt: chat.createdAt, selfParticipantId: self!
  } }];
  for (const row of participants) things.push({ id: row.id, targetId: chat.id, thingtime: ['chat-archive-participant'], crystal: {
    username: row.username, displayName: row.displayName, nickname: row.nickname, joinedAt: row.joinedAt,
    ...(row.avatarFileId === undefined ? {} : { avatarFileId: row.avatarFileId })
  } });
  for (const row of messages) things.push({ id: row.id, targetId: chat.id, thingtime: ['chat-archive-message'], crystal: {
    participantId: participant(row.authorId), text: row.deleted ? '' : row.text, createdAt: row.createdAt, deleted: row.deleted,
    ...(row.editedAt === undefined ? {} : { editedAt: row.editedAt }),
    ...(row.replyToId === undefined ? {} : { replyToId: row.replyToId }),
    ...(row.threadRootId === undefined ? {} : { threadRootId: row.threadRootId }),
    ...(row.systemText === undefined || row.deleted ? {} : { systemText: row.systemText })
  } });
  for (const row of reactions) things.push({ id: row.id, targetId: row.messageId, thingtime: ['chat-archive-reaction'], crystal: {
    participantId: participant(row.userId), emoji: row.emoji, createdAt: row.createdAt
  } });
  const media = [...files, ...links];
  if (media.some(row => !validId(row.id) || ids.includes(row.id) || !ids.includes(row.targetId)) ||
    new Set(media.map(row => row.id)).size !== media.length) reject();
  const emojiIds = [...new Set(reactions.map(row => customReactionEmojiId(row.emoji)).filter((id): id is string => !!id))];
  const groups = validateChatArchiveRecords({ things, files, links }, new Set(emojiIds));
  if (groups.length !== 1) reject();
  const result = { group: groups[0], emojiIds, attachmentTargets: media.map(({ id, targetId }) => ({ id, targetId })) };
  if (Buffer.byteLength(JSON.stringify(result)) > TRANSFER_LIMITS.manifestBytes) reject();
  // No references to mutable reader records survive the projection boundary.
  return structuredClone(result);
};
