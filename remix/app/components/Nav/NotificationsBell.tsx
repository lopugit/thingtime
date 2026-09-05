import React from 'react';
import { Box, Center, Flex, Popover, PopoverAnchor, PopoverContent, Spinner, Text } from '@chakra-ui/react';
import { Bell } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

import { NotificationRow } from '~/components/Notifications/NotificationRow';
import { notificationHref, type NotificationItem } from '~/components/Notifications/notificationCore';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// The nav bell 🔔: unread badge + a popover of recent notifications. The
// badge count seeds from the per-user localCache (no flash), reconciles on
// mount / window focus / a slow poll, and zeroes optimistically when the
// popover opens (which also marks everything read server-side — X-style).
// The full, searchable history lives at /notifications ("See all").

const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const POLL_MS = 90_000;

export const NotificationsBell = () => {
  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();

  const cacheKey = user ? `tt-notif-unread-${user.id}` : null;
  const [unread, setUnread] = React.useState<number>(() =>
    cacheKey ? readLocalCache<number>(cacheKey) || 0 : 0
  );
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[] | null>(null);

  const listRef = React.useRef(api.v1.notifications.list);
  listRef.current = api.v1.notifications.list;
  const markReadRef = React.useRef(api.v1.notifications.markRead);
  markReadRef.current = api.v1.notifications.markRead;

  const setUnreadPersisted = React.useCallback(
    (count: number) => {
      setUnread(count);
      if (cacheKey) writeLocalCache(cacheKey, count);
    },
    [cacheKey]
  );

  // badge reconcile: mount + focus + slow poll (cheap indexed count read)
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = () => {
      listRef.current({ limit: 1 })
        .then((resp: any) => {
          if (!cancelled && typeof resp?.unreadCount === 'number') setUnreadPersisted(resp.unreadCount);
        })
        .catch(() => {});
    };
    setUnread(cacheKey ? readLocalCache<number>(cacheKey) || 0 : 0);
    refresh();
    // Poll only while the tab is actually being looked at — every other poller
    // in the app (MessengerPage, MessengerNotifications, ChatView) gates on
    // visibilityState, and without it a backgrounded tab keeps counting
    // notifications forever. visibilitychange re-reconciles on return, so
    // hiding the tab costs freshness for exactly as long as it stays hidden.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // per-user: switcher swaps identity under the same mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleOpen = () => {
    setOpen((prev) => !prev);
    if (open) return;
    setItems(null);
    listRef.current({ limit: 20 })
      .then((resp: any) => {
        setItems(Array.isArray(resp?.notifications) ? resp.notifications : []);
        // opening the bell reads everything (X-style) — badge zeroes now,
        // server flips readAt in the background
        if ((resp?.unreadCount || 0) > 0) {
          markReadRef.current({ all: true }).catch(() => {});
        }
        setUnreadPersisted(0);
      })
      .catch(() => setItems([]));
  };

  const handleItemClick = (item: NotificationItem) => {
    setOpen(false);
    const href = notificationHref(item);
    if (href) navigate(href);
  };

  if (!user) return null;

  return (
    <Popover isOpen={open} onClose={() => setOpen(false)} placement="bottom-end" isLazy>
      <PopoverAnchor>
        <Center
          as="button"
          type="button"
          position="relative"
          cursor="pointer"
          aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
          title="Notifications 🔔"
          onClick={handleOpen}
          sx={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
        >
          <Bell size={16} strokeWidth={1.9} />
          {unread > 0 && (
            <Center
              position="absolute"
              top="-6px"
              right="-8px"
              minWidth="15px"
              height="15px"
              paddingX="4px"
              borderRadius="999px"
              background="var(--tt-rainbow-1, #e85555)"
              color="white"
              fontSize="9px"
              fontWeight={700}
              lineHeight="1"
              pointerEvents="none"
            >
              {unread > 9 ? '9+' : unread}
            </Center>
          )}
        </Center>
      </PopoverAnchor>
      <PopoverContent
        width={['calc(100vw - 24px)', '360px']}
        maxWidth="calc(100vw - 24px)"
        maxHeight="70vh"
        overflowY="auto"
        border={BORDER}
        borderRadius="var(--tt-radius-lg, 16px)"
        boxShadow="0 12px 40px rgba(22, 22, 26, 0.14)"
        background="var(--tt-card, #ffffff)"
        _focusVisible={{ outline: 'none' }}
      >
        <Flex flexDirection="column" padding={2}>
          <Flex alignItems="center" paddingX={2} paddingY={1.5}>
            <Text
              fontFamily="mono"
              fontSize="10px"
              fontWeight={600}
              letterSpacing="0.08em"
              textTransform="uppercase"
              color={MUTED}
            >
              Notifications 🔔
            </Text>
            <Box flex={1} />
            <Link to="/notifications" onClick={() => setOpen(false)}>
              <Text as="span" fontSize="xs" fontWeight={600} color="var(--tt-accent, #7c5cff)" _hover={{ textDecoration: 'underline' }}>
                See all →
              </Text>
            </Link>
          </Flex>

          {items === null && (
            <Center paddingY={8}>
              <Spinner size="sm" color={MUTED} />
            </Center>
          )}

          {items !== null && items.length === 0 && (
            <Flex flexDirection="column" alignItems="center" rowGap={1} paddingY={8}>
              <Text fontSize="2xl">🕊️</Text>
              <Text fontSize="xs" color={MUTED}>
                All quiet — nothing new yet
              </Text>
            </Flex>
          )}

          {items?.map((item) => (
            <NotificationRow key={item.id} item={item} dense onClick={handleItemClick} />
          ))}
        </Flex>
      </PopoverContent>
    </Popover>
  );
};
