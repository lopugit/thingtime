// Synchronous first-paint tier for the messenger (house optimistic-rendering
// rule): the chat list, per-chat message pages, the emoji map and the unread
// badge all seed from localStorage instantly and reconcile when fresh data
// lands. Keys are per-account so switching users never bleeds conversations.
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import type { ChatMessage, ChatSummary, Community, CustomEmojiMap } from './messengerTypes';

const CACHED_MESSAGES_PER_CHAT = 50;

export const chatListKey = (userId: string | null) => `tt-messenger-chats:${userId || 'anon'}`;
export const communitiesKey = (userId: string | null) => `tt-messenger-communities:${userId || 'anon'}`;
export const messagesKey = (userId: string | null, chatId: string) => `tt-messenger-msgs:${userId || 'anon'}:${chatId}`;
export const emojiMapKey = (userId: string | null) => `tt-messenger-emojis:${userId || 'anon'}`;
export const unreadKey = (userId: string | null) => `tt-messenger-unread:${userId || 'anon'}`;
export const modeKey = (userId: string | null) => `tt-messenger-mode:${userId || 'anon'}`;
export const customRecentsKey = (userId: string | null) => `tt-messenger-recent-custom:${userId || 'anon'}`;

export const readChatList = (userId: string | null): ChatSummary[] =>
  readLocalCache<ChatSummary[]>(chatListKey(userId)) || [];
export const writeChatList = (userId: string | null, chats: ChatSummary[]) =>
  writeLocalCache(chatListKey(userId), chats);

export const readCommunities = (userId: string | null): Community[] =>
  readLocalCache<Community[]>(communitiesKey(userId)) || [];
export const writeCommunities = (userId: string | null, communities: Community[]) =>
  writeLocalCache(communitiesKey(userId), communities);

// Per-chat message caches are individually capped AND collectively evicted
// (LRU over chat ids) so an account with hundreds of conversations never
// crowds the localStorage quota.
const CACHED_CHAT_LIMIT = 20;
const messagesIndexKey = (userId: string | null) => `tt-messenger-msgs-index:${userId || 'anon'}`;

export const readMessages = (userId: string | null, chatId: string): ChatMessage[] =>
  readLocalCache<ChatMessage[]>(messagesKey(userId, chatId)) || [];
export const writeMessages = (userId: string | null, chatId: string, messages: ChatMessage[]) => {
  writeLocalCache(messagesKey(userId, chatId), messages.slice(0, CACHED_MESSAGES_PER_CHAT));
  const index = readLocalCache<string[]>(messagesIndexKey(userId)) || [];
  const next = [chatId, ...index.filter((id) => id !== chatId)];
  for (const evicted of next.slice(CACHED_CHAT_LIMIT)) {
    try {
      window.localStorage.removeItem(messagesKey(userId, evicted));
    } catch {
      // storage may be unavailable — the write helper already swallows this
    }
  }
  writeLocalCache(messagesIndexKey(userId), next.slice(0, CACHED_CHAT_LIMIT));
};

// The emoji map keeps at most a few dozen entries and an incoming entry
// without an image (message payloads ship name/animated only) never clobbers
// a cached one that has the image bytes.
const CACHED_EMOJI_LIMIT = 60;

export const readEmojiMap = (userId: string | null): CustomEmojiMap =>
  readLocalCache<CustomEmojiMap>(emojiMapKey(userId)) || {};
export const mergeEmojiMap = (userId: string | null, incoming: CustomEmojiMap): CustomEmojiMap => {
  const current = readEmojiMap(userId);
  const merged: CustomEmojiMap = { ...current };
  for (const [id, entry] of Object.entries(incoming)) {
    const existing = merged[id];
    merged[id] = entry.image || !existing ? { ...existing, ...entry, image: entry.image || existing?.image || '' } : existing;
  }
  const ids = Object.keys(merged);
  if (ids.length > CACHED_EMOJI_LIMIT) {
    for (const id of ids.slice(0, ids.length - CACHED_EMOJI_LIMIT)) delete merged[id];
  }
  writeLocalCache(emojiMapKey(userId), merged);
  return merged;
};

export const readUnread = (userId: string | null): number => readLocalCache<number>(unreadKey(userId)) || 0;
export const writeUnread = (userId: string | null, count: number) => writeLocalCache(unreadKey(userId), count);

export const readCustomRecents = (userId: string | null): string[] =>
  readLocalCache<string[]>(customRecentsKey(userId)) || [];
export const pushCustomRecent = (userId: string | null, token: string) => {
  const next = [token, ...readCustomRecents(userId).filter((t) => t !== token)].slice(0, 24);
  writeLocalCache(customRecentsKey(userId), next);
  return next;
};

// cross-component "something changed, repaint" signal (the root-data-refresh
// event-bus pattern) — the page and the global notifier both listen
export const MESSENGER_REFRESH_EVENT = 'thingtime:messenger-refresh';
export const emitMessengerRefresh = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MESSENGER_REFRESH_EVENT));
};
