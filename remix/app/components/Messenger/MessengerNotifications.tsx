import React from 'react';
import { useLocation } from 'react-router';

import { useLopu } from '../Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { MESSENGER_REFRESH_EVENT, readUnread, writeUnread } from './messengerCache';
import { chatDisplayName, isLopuAiSource, type ChatSummary } from './messengerTypes';

const IDLE_POLL_MS = 25_000;
const TOAST_THROTTLE_MS = 30_000;

// Global new-message watcher, mounted once in the app root. Visibility-aware
// 25s poll of /api/v1/chats/updates while logged in; on a fresh incoming
// message in a chat that is not muted and not currently open it pops ONE Lopu
// toast per chat per 30s with a link into the conversation. It also keeps the
// cached unread total fresh and broadcasts it for the nav badge.
export const MESSENGER_UNREAD_EVENT = 'thingtime:messenger-unread';

export const MessengerNotifications = () => {
  const user = useCurrentUser();
  const lopu = useLopu();
  const location = useLocation();
  const lastSeenRef = React.useRef<Map<string, string>>(new Map());
  const primedRef = React.useRef(false);
  const lastToastAtRef = React.useRef<Map<string, number>>(new Map());
  const locationRef = React.useRef(location);
  locationRef.current = location;

  React.useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const broadcast = (total: number, requests: number) => {
      writeUnread(user.id, total);
      window.dispatchEvent(new CustomEvent(MESSENGER_UNREAD_EVENT, { detail: { total, requests } }));
    };
    // seed the badge instantly from cache while the first poll flies
    broadcast(readUnread(user.id), 0);

    const poll = async () => {
      // the /messages page runs its own (faster) list poll and broadcasts the
      // same unread event — doubling up would just double the aggregate load
      if (locationRef.current.pathname === '/messages') return;
      try {
        const response = await fetch('/api/v1/chats/updates', {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled || payload?.ok !== true) return;
        const chats: ChatSummary[] = payload.chats || [];
        broadcast(payload.totalUnread || 0, payload.requestsCount || 0);

        const onMessengerPage = locationRef.current.pathname === '/messages';
        const openChatId = onMessengerPage ? new URLSearchParams(locationRef.current.search).get('chat') : null;

        for (const chat of chats) {
          const last = chat.lastMessage;
          if (!last) continue;
          // Lopu answers the user's own turns while they watch — never a toast
          if (isLopuAiSource(chat.externalSource)) continue;
          const prev = lastSeenRef.current.get(chat.id);
          lastSeenRef.current.set(chat.id, last.id);
          if (!primedRef.current) continue; // first poll only primes the diff
          if (prev === last.id) continue;
          if (last.authorId === user.id) continue;
          if (chat.myMember?.muted) continue;
          if (chat.unreadCount === 0) continue;
          if (openChatId === chat.id && document.visibilityState === 'visible') continue;
          const throttleAt = lastToastAtRef.current.get(chat.id) || 0;
          if (Date.now() - throttleAt < TOAST_THROTTLE_MS) continue;
          lastToastAtRef.current.set(chat.id, Date.now());
          const from = last.authorName || 'Someone';
          const where = chatDisplayName(chat, user.id);
          lopu({
            title: `💬 ${from}${chat.chatType === 'dm' ? '' : ` in ${where}`}`,
						description: last.systemType ? undefined : last.text.slice(0, 120) || (last.attachmentCount ? '📎 Attachment' : undefined),
            status: 'info',
            duration: 8000,
            link: { label: 'Open chat', href: `/messages?chat=${chat.id}` }
          });
        }
        primedRef.current = true;
      } catch {
        // transient network noise — next poll retries
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, IDLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    const onRefresh = () => void poll();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(MESSENGER_REFRESH_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(MESSENGER_REFRESH_EVENT, onRefresh);
    };
  }, [lopu, user?.id]);

  return null;
};

// Tiny badge for nav/drawer rows — subscribes to the watcher's broadcasts and
// seeds from the cached count so it paints on first render.
export const MessengerUnreadBadge = () => {
  const user = useCurrentUser();
  const [count, setCount] = React.useState(() => readUnread(user?.id || null));
  React.useEffect(() => {
    setCount(readUnread(user?.id || null));
    const onUnread = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setCount((detail?.total || 0) + (detail?.requests || 0));
    };
    window.addEventListener(MESSENGER_UNREAD_EVENT, onUnread);
    return () => window.removeEventListener(MESSENGER_UNREAD_EVENT, onUnread);
  }, [user?.id]);
  if (!user || count <= 0) return null;
  return (
    <span
      style={{
        background: 'var(--tt-accent, #a855f7)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        borderRadius: 999,
        padding: '1px 6px',
        marginLeft: 6,
        display: 'inline-block',
        lineHeight: '14px'
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};
