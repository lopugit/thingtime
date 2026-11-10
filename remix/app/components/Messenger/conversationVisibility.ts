import { isLopuAiSource, type ChatSummary } from './messengerTypes';

export const showLopuChatsKey = (userId: string | null) => `tt-messenger-show-lopu:${userId || 'anon'}`;

// Filter presentation only: retain the full list for explicit conversation links.
export const messengerVisibleChats = (chats: ChatSummary[], showLopuChats = false): ChatSummary[] =>
  showLopuChats ? chats : chats.filter((chat) => !isLopuAiSource(chat.externalSource));

export const spaceDirectMessages = (chats: ChatSummary[], communityId: string | null): ChatSummary[] =>
  communityId ? chats.filter((chat) => chat.chatType !== 'channel' && chat.communityId === communityId) : [];
