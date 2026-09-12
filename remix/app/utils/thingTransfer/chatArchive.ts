import { CHAT_ARCHIVE_THINGTIME, MAX_CHAT_NAME_CHARS, MAX_CHAT_TOPIC_CHARS, MAX_MESSAGE_CHARS, MAX_NICKNAME_CHARS } from '../../schemas/registry';
import { customReactionEmojiId, sanitizeChatReactionToken } from '../reactionTokens';
import { validateTransfer, type TransferThing } from './format';

// Portable historical records, never live users, memberships or send commands.
// The dedicated writer must store these as separate private, importer-owned
// Things. This module deliberately has no API/storage/notification side effects.
export const CHAT_ARCHIVE_KINDS = CHAT_ARCHIVE_THINGTIME;
export const isTransferChatArchive = (thing: Pick<TransferThing, 'thingtime'>) =>
  thing.thingtime.length === 1 && (CHAT_ARCHIVE_KINDS as readonly string[]).includes(thing.thingtime[0]);

const reject = (): never => { throw new Error('Invalid private chat archive'); };
const text = (value: unknown, max: number, required = false): value is string =>
  typeof value === 'string' && value.length <= max && (!required || !!value.trim()) && !value.includes('\0');
const date = (value: unknown) => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const fields = (thing: TransferThing, allowed: string[]) => {
  if (!isTransferChatArchive(thing) || thing.extended !== undefined || thing.tags?.length ||
    Object.keys(thing.crystal).some(key => !allowed.includes(key))) reject();
};

export type ChatArchiveGroup = {
  root: TransferThing;
  self: TransferThing;
  participants: TransferThing[];
  messages: TransferThing[];
  reactions: TransferThing[];
};

/** Validate a whole relational archive, not just an individual forged row.
 * Local IDs have meaning only inside this envelope. In particular no username,
 * source account ID, role, ACL or membership can grant real account authority.
 */
export const validateChatArchives = (input: unknown): ChatArchiveGroup[] => {
  const manifest = validateTransfer(input);
  const archives = manifest.things.filter(thing => thing.thingtime.includes('chat-archive'));
  const consumed = new Set<string>();
  const groups: ChatArchiveGroup[] = [];
  for (const root of archives) {
    fields(root, ['name', 'topic', 'chatType', 'createdAt', 'selfParticipantId']);
    if (root.targetId || !text(root.crystal.name, MAX_CHAT_NAME_CHARS) || !text(root.crystal.topic, MAX_CHAT_TOPIC_CHARS) ||
      !['dm', 'group', 'channel'].includes(String(root.crystal.chatType)) || !date(root.crystal.createdAt)) reject();
    consumed.add(root.id);
    const children = manifest.things.filter(thing => thing.targetId === root.id);
    const participants = children.filter(thing => thing.thingtime[0] === 'chat-archive-participant');
    const messages = children.filter(thing => thing.thingtime[0] === 'chat-archive-message');
    if (!participants.length || children.length !== participants.length + messages.length) reject();
    const people = new Map(participants.map(thing => [thing.id, thing]));
    const self = people.get(String(root.crystal.selfParticipantId));
    if (!self) reject();
    for (const person of participants) {
      fields(person, ['username', 'displayName', 'nickname', 'avatarFileId', 'joinedAt']);
      if (person.folderId || !text(person.crystal.username, 200, true) ||
        !text(person.crystal.displayName, 500) || !text(person.crystal.nickname, MAX_NICKNAME_CHARS) || !date(person.crystal.joinedAt)) reject();
      const files = manifest.files.filter(file => file.targetId === person.id);
      if (person.crystal.avatarFileId !== undefined) {
        if (files.length !== 1 || files[0].id !== person.crystal.avatarFileId ||
          !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(files[0].mime) || files[0].bytes <= 0) reject();
      } else if (files.length) reject();
      if (manifest.links?.some(link => link.targetId === person.id)) reject();
      consumed.add(person.id);
    }
    const rows = new Map(messages.map(thing => [thing.id, thing]));
    for (const message of messages) {
      fields(message, ['participantId', 'text', 'createdAt', 'editedAt', 'deleted', 'replyToId', 'threadRootId', 'systemText']);
      if (message.folderId || !people.has(String(message.crystal.participantId)) || !text(message.crystal.text, MAX_MESSAGE_CHARS) ||
        !date(message.crystal.createdAt) || typeof message.crystal.deleted !== 'boolean' ||
        (message.crystal.editedAt !== undefined && !date(message.crystal.editedAt)) ||
        (message.crystal.systemText !== undefined && !text(message.crystal.systemText, 10_000))) reject();
      for (const key of ['replyToId', 'threadRootId']) {
        const target = message.crystal[key];
        if (target !== undefined && (typeof target !== 'string' || target === message.id || !rows.has(target))) reject();
      }
      if (message.crystal.deleted && (message.crystal.text || message.crystal.systemText ||
        manifest.files.some(file => file.targetId === message.id) || manifest.links?.some(link => link.targetId === message.id))) reject();
      // Thread roots are top-level messages; no recursive thread topology.
      const thread = rows.get(String(message.crystal.threadRootId));
      if (thread?.crystal.threadRootId !== undefined) reject();
      const seenReplies = new Set([message.id]);
      let reply = rows.get(String(message.crystal.replyToId));
      while (reply) {
        if (seenReplies.has(reply.id)) reject();
        seenReplies.add(reply.id);
        reply = rows.get(String(reply.crystal.replyToId));
      }
      consumed.add(message.id);
    }
    const reactions = manifest.things.filter(thing => thing.targetId && rows.has(thing.targetId));
    const reactionKeys = new Set<string>();
    for (const reaction of reactions) {
      fields(reaction, ['participantId', 'emoji', 'createdAt']);
      if (reaction.thingtime[0] !== 'chat-archive-reaction' || reaction.folderId ||
        !people.has(String(reaction.crystal.participantId)) || typeof reaction.crystal.emoji !== 'string' ||
        !date(reaction.crystal.createdAt)) reject();
      const token = sanitizeChatReactionToken(reaction.crystal.emoji);
      if (!token || token !== reaction.crystal.emoji) reject();
      const customId = customReactionEmojiId(token);
      if (customId && !manifest.things.some(thing => thing.id === customId && thing.thingtime.length === 1 && thing.thingtime[0] === 'custom-emoji')) reject();
      const key = JSON.stringify([reaction.targetId, reaction.crystal.participantId, reaction.crystal.emoji]);
      if (reactionKeys.has(key)) reject();
      reactionKeys.add(key); consumed.add(reaction.id);
    }
    const leafOwners = new Set([...participants, ...messages].map(thing => thing.id));
    for (const thing of [...participants, ...reactions]) {
      if (manifest.things.some(child => child.targetId === thing.id)) reject();
    }
    for (const item of [...manifest.files, ...(manifest.links || [])]) {
      if ((item.targetId === root.id || reactions.some(row => row.id === item.targetId)) && !leafOwners.has(item.targetId)) reject();
    }
    groups.push({ root, self: self!, participants, messages, reactions });
  }
  for (const thing of manifest.things) {
    if (thing.thingtime.some(kind => (CHAT_ARCHIVE_KINDS as readonly string[]).includes(kind)) && !consumed.has(thing.id)) reject();
    if (thing.folderId && consumed.has(thing.folderId)) reject();
  }
  return groups;
};

export type ArchiveAuthor =
  | { archived: false; userId: string }
  | { archived: true; participantId: string; username: string; displayName: string; avatarFileId?: string };

/** Call only after validating the archive; no lookup by historical username.
 * The importing account replaces the exporting participant on every message.
 * Others resolve only through the new archive-local participant identities.
 */
export const archiveAuthor = (group: ChatArchiveGroup, participantId: string, importerId: string,
  importedParticipantIds: ReadonlyMap<string, string>, importedFileIds: ReadonlyMap<string, string>): ArchiveAuthor => {
  if (!importerId) reject();
  const originalIds = new Set(group.participants.map(person => person.id));
  const freshIds = group.participants.filter(person => person.id !== group.self.id).map(person => importedParticipantIds.get(person.id));
  if (freshIds.some(id => !id || originalIds.has(id) || id === importerId) || new Set(freshIds).size !== freshIds.length) reject();
  const participant = group.participants.find(person => person.id === participantId);
  if (!participant) return reject();
  if (participant.id === group.self.id) return { archived: false, userId: importerId };
  const freshId = importedParticipantIds.get(participant.id);
  if (!freshId || freshId === participant.id || freshId === importerId) return reject();
  const avatar = participant.crystal.avatarFileId;
  const avatarFileId = typeof avatar === 'string' ? importedFileIds.get(avatar) : undefined;
  if (avatar !== undefined && (!avatarFileId || avatarFileId === avatar)) return reject();
  return { archived: true, participantId: freshId, username: String(participant.crystal.username),
    displayName: String(participant.crystal.displayName), ...(avatarFileId ? { avatarFileId } : {}) };
};
