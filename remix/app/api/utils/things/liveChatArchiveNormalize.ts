import { systemMessageText, type ChatMember, type ChatMessage } from '../../../components/Messenger/messengerTypes';
import { getUserDisplayName } from '../../../utils/userIdentity';
import type { FeedAuthor } from '../../../components/Feed/feedTypes';
import { projectLiveChatArchive, type LiveChatArchiveSnapshot } from './liveChatArchiveCore';
import { projectAiChatArchive } from './aiChatArchiveProjection';
import type { readLiveChatArchiveSource } from './liveChatArchiveRead';

type Source = NonNullable<Awaited<ReturnType<typeof readLiveChatArchiveSource>>>;
type Media = Pick<LiveChatArchiveSnapshot, 'files' | 'links'> & {
  /** Resolved stored avatar bytes, keyed by source user ID. Never a URL fetch
   * instruction. Public/external avatars need a separate authorized adapter. */
  avatars: ReadonlyMap<string, string>;
};
const reject = (): never => { throw new Error('Complete chat presentation is unavailable'); };
const date = (value: unknown): string => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return reject();
  return value.toISOString();
};
// Root timestamps are BSON Dates, but Messenger's edit/delete writers store
// ISO strings inside crystal. Accept that exact canonical spelling, not loose
// Date parsing (which normalizes invalid days, offsets or numeric strings).
const eventDate = (value: unknown): string => {
  if (value instanceof Date) return date(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return reject();
  return value;
};
const string = (value: unknown, fallback = ''): string => value == null ? fallback : typeof value === 'string' ? value : reject();
const optionalId = (value: unknown): string | undefined => value == null ? undefined : string(value);

/** Converts an authorized internal source snapshot plus canonical PUBLIC
 * profiles and authorized media descriptors. No account lookup, URL fetch,
 * live memberships or notifications occur here. Do not pass raw user records.
 * Keep message text exact; render system rows with the same helper as chat UI.
 */
export const normalizeLiveChatArchive = (source: Source, viewerId: string,
  profiles: ReadonlyMap<string, FeedAuthor>, media: Media, options: { aiHistory?: boolean } = {}) => {
  const { chat, members, messages, reactions, attachments } = source;
  // AI/imported-device conversations need their own historical author mapping:
  // assistant rows often use the human owner's ownerId. Never misattribute them
  // or export live connectors/tool commands as if they were ordinary messages.
  const ai = !!chat.crystal?.externalSource;
  if ((ai && !options.aiHistory) || (!ai && messages.some(row => !row.crystal?.deletedAt && (row.crystal?.externalSource || row.crystal?.lopu)))) reject();
  const participants: LiveChatArchiveSnapshot['participants'] = members.map(member => {
    const profile = profiles.get(member.ownerId);
    if (!profile || profile.id !== member.ownerId || typeof profile.username !== 'string' || !profile.username.trim()) return reject();
    const avatarFileId = media.avatars.get(member.ownerId);
    if (!!profile.avatarUrl !== !!avatarFileId) reject();
    return { id: member.shareId, userId: member.ownerId, username: profile.username,
      displayName: getUserDisplayName(profile), nickname: string(member.crystal?.nickname),
      joinedAt: date(member.createdAt), ...(avatarFileId ? { avatarFileId } : {}) };
  });
  if ([...media.avatars.keys()].some(id => !participants.some(row => row.userId === id))) reject();
  const publicMembers = participants.map(person => ({ userId: person.userId, nickname: person.nickname,
    profile: { id: person.userId, username: person.username, displayName: person.displayName } })) as ChatMember[];
  // Every requested byte/link must correspond to a source message attachment
  // or one explicit participant avatar. Conversely nothing may disappear.
  const expected = new Map<string, { targetId: string; linked: boolean }>(attachments.map(row =>
    [row.shareId, { targetId: row.targetId, linked: row.attachmentLinked === true }]));
  for (const person of participants) if (person.avatarFileId) {
    if (expected.has(person.avatarFileId)) reject();
    expected.set(person.avatarFileId, { targetId: person.id, linked: false });
  }
  const supplied = [...media.files.map(row => ({ ...row, linked: false })), ...media.links.map(row => ({ ...row, linked: true }))];
  if (expected.size !== supplied.length || new Set(supplied.map(row => row.id)).size !== supplied.length || supplied.some(row => {
    const wanted = expected.get(row.id); return !wanted || wanted.targetId !== row.targetId || wanted.linked !== row.linked;
  })) reject();
  const snapshot: LiveChatArchiveSnapshot = {
    chat: { id: chat.shareId, name: string(chat.crystal?.name), topic: string(chat.crystal?.topic),
      chatType: chat.crystal?.chatType, createdAt: date(chat.createdAt) }, participants,
    messages: messages.map(row => {
      const crystal = row.crystal || {};
      const deleted = crystal.deletedAt != null;
      if (deleted) eventDate(crystal.deletedAt);
      const systemText = !deleted && crystal.systemType ? systemMessageText({ authorId: row.ownerId,
        systemType: crystal.systemType, systemMeta: crystal.systemMeta } as ChatMessage, publicMembers) : undefined;
      return { id: row.shareId, authorId: row.ownerId, text: deleted ? '' : string(crystal.text),
        createdAt: date(row.createdAt), deleted,
        ...(crystal.editedAt == null ? {} : { editedAt: eventDate(crystal.editedAt) }),
        ...(optionalId(crystal.replyToId) === undefined ? {} : { replyToId: optionalId(crystal.replyToId) }),
        ...(optionalId(crystal.threadRootId) === undefined ? {} : { threadRootId: optionalId(crystal.threadRootId) }),
        ...(systemText === undefined ? {} : { systemText }) };
    }),
    reactions: reactions.map(row => ({ id: row.shareId, messageId: row.targetId, userId: row.ownerId,
      emoji: string(row.crystal?.emoji), createdAt: date(row.createdAt) })),
    files: media.files, links: media.links
  };
  // Internal opt-in only until avatar/tool presentation is complete. Existing
  // route callers retain their refusal; portable input cannot enable this.
  return ai ? projectAiChatArchive(snapshot, viewerId, chat.crystal.externalSource,
    new Map(messages.map(row => [row.shareId, { externalSource: row.crystal?.externalSource, lopu: row.crystal?.lopu }])))
    : projectLiveChatArchive(snapshot, viewerId);
};
