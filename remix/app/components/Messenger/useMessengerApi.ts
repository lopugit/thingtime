// Feature-scoped API surface for the messenger, built on the same primitives
// as useApi (credentialed getJson + useAsyncFetcher's throw-payload-on-!ok
// submit) so error handling reads identically: `catch (err) { err?.error }`.
import { useCallback, useMemo } from 'react';
import { useAsyncFetcher } from '~/hooks/useAsyncFetcher';

const getJson = async (url: string) => {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw payload;
  return payload;
};

const postJson = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw payload;
  return payload;
};

const toQuery = (args: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

export const useMessengerApi = () => {
  const fetcher = useAsyncFetcher();
  const submit = fetcher.submit;
  const post = useCallback(
    (action: string) => (data?: Record<string, unknown>) => submit(data || {}, { action }),
    [submit]
  );

  return useMemo(
    () => ({
      listChats: () => getJson('/api/v1/chats'),
      aiConnections: () => getJson('/api/v1/ai/connections'),
      syncAiConnections: (batch: Record<string, unknown>) => postJson('/api/v1/ai/connections', batch),
      updates: () => getJson('/api/v1/chats/updates'),
      getChat: (id: string) => getJson(`/api/v1/chats/get${toQuery({ id })}`),
      createChat: post('/api/v1/chats'),
      updateChat: post('/api/v1/chats/update'),
      members: post('/api/v1/chats/members'),
      leaveChat: post('/api/v1/chats/leave'),
      messages: (args: { chatId: string; cursor?: string | null; limit?: number; threadRootId?: string | null }) =>
        getJson(`/api/v1/chats/messages${toQuery(args)}`),
      sendMessage: post('/api/v1/chats/messages'),
      editMessage: post('/api/v1/chats/messages/edit'),
      deleteMessage: post('/api/v1/chats/messages/delete'),
      react: post('/api/v1/chats/react'),
      markRead: post('/api/v1/chats/read'),
      requests: () => getJson('/api/v1/chats/requests'),
      respondRequest: post('/api/v1/chats/requests'),
      settings: () => getJson('/api/v1/chats/settings'),
      saveSettings: post('/api/v1/chats/settings'),
      communities: () => getJson('/api/v1/communities'),
      createCommunity: post('/api/v1/communities'),
      getCommunity: (id: string) => getJson(`/api/v1/communities/get${toQuery({ id })}`),
      updateCommunity: post('/api/v1/communities/update'),
      communityMembers: post('/api/v1/communities/members'),
      invites: (communityId: string) => getJson(`/api/v1/communities/invites${toQuery({ communityId })}`),
      createInvite: post('/api/v1/communities/invites'),
      joinCommunity: post('/api/v1/communities/join'),
      sections: post('/api/v1/communities/sections'),
      emojis: (args: { chatId?: string | null; communityId?: string | null; ids?: string[] }) =>
        getJson(`/api/v1/emojis${toQuery({ ...args, ids: args.ids?.length ? args.ids.join(',') : undefined })}`),
      uploadEmoji: post('/api/v1/emojis'),
      deleteEmoji: post('/api/v1/emojis/delete'),
      searchUsers: (q: string) => getJson(`/api/v1/users/search${toQuery({ q, limit: 8 })}`),
      followStatus: (args: { username?: string; userId?: string }) => getJson(`/api/v1/users/follow${toQuery(args)}`),
      follow: post('/api/v1/users/follow')
    }),
    [post]
  );
};

export type MessengerApi = ReturnType<typeof useMessengerApi>;
