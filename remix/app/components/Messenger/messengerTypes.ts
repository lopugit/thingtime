// Client-side mirrors of the /api/v1/chats family wire shapes plus the small
// pure helpers the messenger components share.

import type { PublicAttachment } from '~/components/Attachments/attachmentTypes';
import { getUserDisplayName } from '~/utils/userIdentity';

export type ChatType = 'channel' | 'group' | 'dm';
export type ChatRole = 'owner' | 'admin' | 'member';
export type MemberState = 'active' | 'pending' | 'left' | 'declined';
export type MessengerMode = 'slack' | 'messenger';

export type ImportedAiSource = {
	access?: 'imported';
  provider: 'chatgpt' | 'claude';
  sourceId: string;
  label: string;
  connector: string;
  readOnly: true;
  role?: 'user' | 'assistant' | 'system' | 'unknown';
  authorName?: string | null;
  segmentIndex?: number;
  segmentCount?: number;
};

export type AgentCapability =
	| 'read-history'
	| 'create-session'
	| 'send-message'
	| 'steer-turn'
	| 'interrupt-turn'
	| 'review-approval'
	| 'accessibility'
	| 'explicit-approval'
	| 'attachments';

export type LiveAiSource = {
	access: 'live';
	provider: 'chatgpt' | 'claude';
	sourceId: string;
	label: string;
	connector: string;
	readOnly: false;
	deviceId: string;
	connectorId: string;
	sessionId: string;
	projectId?: string | null;
	projectLabel?: string | null;
	historyCursor?: string | null;
	historyHasMore?: boolean;
	historySyncedAt?: string;
	capabilities: AgentCapability[];
	role?: 'user' | 'assistant' | 'system' | 'unknown';
	authorName?: string | null;
};

// Lopu, the Thingtime assistant: its conversations are ordinary messenger
// rows tagged with this source (chat: readOnly false; assistant turns:
// readOnly true — never editable, deletable with the chat). Mirrors
// PublicLopuExternalAiSource in api/utils/messenger/externalAi.ts.
export type LopuAiSource = {
	access: 'lopu';
	provider: 'lopu';
	sourceId: string;
	label: string;
	connector: string;
	readOnly: boolean;
	role?: 'user' | 'assistant' | 'system' | 'unknown';
	authorName?: string | null;
	messageId?: string | null;
	revision?: number;
	segmentIndex?: number;
	segmentCount?: number;
};

export type ExternalAiSource = ImportedAiSource | LiveAiSource | LopuAiSource;

export const isLiveAiSource = (source: ExternalAiSource | null | undefined): source is LiveAiSource =>
	source?.access === 'live' && source.readOnly === false;

export const isLopuAiSource = (source: ExternalAiSource | null | undefined): source is LopuAiSource =>
	// provider is the fallback discriminator for a row projected without access
	source?.access === 'lopu' || (source as { provider?: unknown } | null | undefined)?.provider === 'lopu';

// The unicorn on a rainbow disc — Lopu's avatar wherever an AI chat/row is drawn.
export const LOPU_RAINBOW_DISC = 'var(--tt-gradient-rainbow, linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6))';

// Avatar treatment for an AI-backed chat or message row: ChatGPT and Claude
// keep their brand discs, Lopu gets the unicorn on the rainbow disc.
export const externalSourceAvatar = (source: ExternalAiSource): { glyph: string; background: string; color: string } =>
	isLopuAiSource(source)
		? { glyph: '🦄', background: LOPU_RAINBOW_DISC, color: 'white' }
		: source.provider === 'chatgpt'
			? { glyph: '◎', background: '#17171c', color: 'white' }
			: { glyph: '✦', background: '#d97757', color: 'white' };

export type MessengerProfile = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
};

export type ChatMember = {
  userId: string;
  profile: MessengerProfile | null;
  role: ChatRole;
  nickname: string | null;
  state: MemberState;
  requestOrigin: 'follower' | 'unknown' | null;
  muted: boolean;
  lastReadMessageId: string | null;
  lastReadAt: string | null;
  joinedAt: string;
};

export type MessagePreview = {
  id: string;
  authorId: string;
  authorName: string | null;
  text: string;
  deleted: boolean;
  systemType: string | null;
	attachmentCount: number;
  createdAt: string;
  externalSource?: ExternalAiSource | null;
};

export type ChatSummary = {
  id: string;
  chatType: ChatType;
  name: string | null;
  topic: string | null;
  communityId: string | null;
  sectionId: string | null;
  channelVisibility: 'public' | 'private' | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  myMember: Omit<ChatMember, 'profile'> | null;
  members: ChatMember[] | null;
  memberCount: number;
  unreadCount: number;
  lastMessage: MessagePreview | null;
  externalSource?: ExternalAiSource | null;
};

export type ChatMessage = {
  id: string;
  chatId: string;
  authorId: string;
  author: MessengerProfile | null;
  text: string;
	attachments: PublicAttachment[];
  deleted: boolean;
  editedAt: string | null;
  threadRootId: string | null;
  replyToId: string | null;
	replyTo: { id: string; authorId: string; authorName: string | null; text: string; deleted: boolean; attachmentCount: number } | null;
  systemType: string | null;
  systemMeta: Record<string, unknown> | null;
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  threadCount: number;
  threadLastAt: string | null;
  createdAt: string;
  externalSource?: ExternalAiSource | null;
};

export type CustomEmojiMap = Record<string, { name: string; image: string; animated: boolean }>;

export type CustomEmoji = {
  id: string;
  name: string;
  image: string;
  animated: boolean;
  scope: 'community' | 'personal';
  communityId: string | null;
  createdBy: string;
  createdAt: string;
};

export type Community = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  myRole: ChatRole | null;
  memberCount: number;
  createdAt: string;
  sections: { id: string; name: string; order: number }[];
  externalSource?: ExternalAiSource | null;
};

export type CommunityChannel = {
  id: string;
  name: string | null;
  topic: string | null;
  sectionId: string | null;
  channelVisibility: 'public' | 'private';
  memberCount: number;
  joined: boolean;
  createdAt: string;
};

export const CUSTOM_TOKEN_PREFIX = 'custom:';

export const isCustomToken = (token: string) => token.startsWith(CUSTOM_TOKEN_PREFIX);
export const customTokenId = (token: string) => token.slice(CUSTOM_TOKEN_PREFIX.length);

// Display name resolution: nickname (Messenger style) beats displayName beats
// username; falls back to a friendly placeholder for vanished accounts.
export const memberDisplayName = (member: ChatMember | null | undefined): string => {
  if (!member) return 'Someone';
  return member.nickname || (member.profile ? getUserDisplayName(member.profile) : 'Someone');
};

// What a chat is called in lists and headers: explicit name first, else the
// other members' names (DM = the other person).
export const chatDisplayName = (chat: ChatSummary, viewerId: string | null): string => {
  if (chat.name) return chat.chatType === 'channel' ? `#${chat.name}` : chat.name;
  const others = (chat.members || []).filter((m) => m.userId !== viewerId);
  if (!others.length) return chat.chatType === 'dm' ? 'Direct message' : 'Group chat';
  const names = others.slice(0, 3).map((m) => memberDisplayName(m));
  const suffix = others.length > 3 ? ` +${others.length - 3}` : '';
  return names.join(', ') + suffix;
};

export const systemMessageText = (message: ChatMessage, members: ChatMember[]): string => {
	const nameOf = (userId: unknown) => memberDisplayName(members.find((m) => m.userId === userId)) || 'Someone';
  const actor = nameOf(message.authorId);
  const subjectIds = Array.isArray(message.systemMeta?.subjectIds) ? (message.systemMeta!.subjectIds as unknown[]) : null;
  const subject = subjectIds?.length
    ? subjectIds.slice(0, 3).map(nameOf).join(', ') + (subjectIds.length > 3 ? ` +${subjectIds.length - 3}` : '')
    : message.systemMeta?.subjectId
      ? nameOf(message.systemMeta.subjectId)
      : null;
  const value = typeof message.systemMeta?.value === 'string' ? message.systemMeta.value : null;
  switch (message.systemType) {
    case 'chat-created':
      return value ? `${actor} created ${value}` : `${actor} started the conversation`;
    case 'chat-renamed':
      return `${actor} renamed the chat to ${value ?? 'something new'}`;
    case 'topic-changed':
      return value ? `${actor} set the topic: ${value}` : `${actor} cleared the topic`;
    case 'member-added':
      return subject && subject !== actor ? `${actor} added ${subject}` : `${actor} joined`;
    case 'member-left':
      return `${actor} left`;
    case 'member-removed':
      return `${actor} removed ${subject ?? 'someone'}`;
    default:
      return `${actor} did something mysterious`;
  }
};
