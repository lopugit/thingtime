import React from 'react';
import { Box, Center, Flex, Popover, PopoverAnchor, PopoverContent, Spinner, Text } from '@chakra-ui/react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';

import { timeAgo } from '~/components/Feed/feedTypes';
import { ProfileAvatarCircle } from '~/components/Profile/ProfilePage';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// The nav bell 🔔: unread badge + a popover of recent notifications. The
// badge count seeds from the per-user localCache (no flash), reconciles on
// mount / window focus / a slow poll, and zeroes optimistically when the
// popover opens (which also marks everything read server-side — X-style).

const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';
const BORDER = '1px solid var(--tt-border, #ececef)';
const POLL_MS = 90_000;

type BellNotification = {
  id: string;
  type: string;
  actorId: string;
  actorUsername: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
  targetId: string | null;
  postId: string | null;
  preview: string | null;
  readAt: string | null;
  createdAt: string;
};

const TYPE_EMOJI: Record<string, string> = {
  'friend-request': '🤝',
  'friend-accepted': '💚',
  'new-follower': '👀',
  'post-from-followed': '📰',
  'post-from-friend': '🫶',
  comment: '💬',
  reply: '↩️',
  reaction: '🤣',
  share: '🔁',
  mention: '📣',
  groups: '👥'
};

const verbOf = (item: BellNotification): string => {
  switch (item.type) {
    case 'friend-request':
      return 'sent you a friend request';
    case 'friend-accepted':
      return 'accepted your friend request';
    case 'new-follower':
      return 'started following you';
    case 'post-from-followed':
    case 'post-from-friend':
      return 'posted';
    case 'comment':
      return 'commented on your post';
    case 'reply':
      return 'replied to your comment';
    case 'reaction':
      return item.preview ? `reacted ${item.preview}` : 'reacted to your post';
    case 'share':
      return 'reposted your post';
    case 'mention':
      return 'mentioned you';
    default:
      return 'did something ✨';
  }
};

export const NotificationsBell = () => {
  const user = useCurrentUser();
  const api = useApi();
  const navigate = useNavigate();

  const cacheKey = user ? `tt-notif-unread-${user.id}` : null;
  const [unread, setUnread] = React.useState<number>(() =>
    cacheKey ? readLocalCache<number>(cacheKey) || 0 : 0
  );
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<BellNotification[] | null>(null);

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

  const handleItemClick = (item: BellNotification) => {
    setOpen(false);
    if (item.postId) {
      navigate(`/post/${item.postId}`);
      return;
    }
    if (item.actorUsername) {
      navigate(`/profile/${item.actorUsername}`);
    }
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
            <Flex
              key={item.id}
              as="button"
              type="button"
              textAlign="left"
              alignItems="flex-start"
              columnGap={2.5}
              paddingX={2}
              paddingY={2}
              borderRadius="var(--tt-radius-md, 12px)"
              background={item.readAt ? 'transparent' : 'var(--tt-surface-alt, #f5f5f7)'}
              _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
              onClick={() => handleItemClick(item)}
            >
              <Box position="relative" flexShrink={0}>
                <ProfileAvatarCircle
                  avatarUrl={item.actorAvatarUrl}
                  name={item.actorName || item.actorUsername || '?'}
                  size="32px"
                  fontSize="sm"
                />
                <Box position="absolute" bottom="-4px" right="-4px" fontSize="11px" lineHeight="1">
                  {TYPE_EMOJI[item.type] || '✨'}
                </Box>
              </Box>
              <Box minWidth={0} whiteSpace="normal">
                <Text fontSize="xs" color={INK}>
                  <Text as="span" fontWeight={700}>
                    {item.actorName || item.actorUsername || 'Someone'}
                  </Text>{' '}
                  {verbOf(item)}
                </Text>
                {item.preview && item.type !== 'reaction' && (
                  <Text fontSize="xs" color={MUTED} noOfLines={2}>
                    {item.preview}
                  </Text>
                )}
                <Text fontSize="10px" color={MUTED} marginTop={0.5}>
                  {timeAgo(item.createdAt)}
                </Text>
              </Box>
            </Flex>
          ))}
        </Flex>
      </PopoverContent>
    </Popover>
  );
};
