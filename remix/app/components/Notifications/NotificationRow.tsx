import React from 'react';
import { Box, Center, Flex, Text } from '@chakra-ui/react';

import { timeAgo } from '~/components/Feed/feedTypes';
import { ProfileAvatarCircle } from '~/components/Profile/ProfilePage';
import { NOTIFICATION_CATEGORY_META } from '~/schemas/registry';
import { RAINBOW } from '~/theme/rainbow';
import {
  isSystemNotification,
  notificationCategory,
  notificationEmoji,
  notificationHeadline,
  notificationHref,
  type NotificationItem
} from './notificationCore';

// One notification row, shared by the nav bell popover (dense) and the
// /notifications history page (with category + unread meta). Unread rows sit
// on the alt surface; the type emoji badges the avatar; system notes wear
// Lopu's 🦄 in a rainbow ring instead of a person's avatar.

const MUTED = 'var(--tt-muted, #9a9aa6)';
const INK = 'var(--tt-ink, #16161a)';

const LopuAvatar = ({ size }: { size: string }) => (
  <Center flexShrink={0} width={size} height={size} borderRadius="full" background={RAINBOW} padding="2px" aria-label="Lopu">
    <Center width="100%" height="100%" borderRadius="full" background="var(--tt-card, #ffffff)" fontSize="sm" lineHeight="1">
      🦄
    </Center>
  </Center>
);

const absoluteTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
};

export const NotificationRow = (props: {
  item: NotificationItem;
  onClick?: (item: NotificationItem) => void;
  // popover density: tighter clamps, no category meta
  dense?: boolean;
}) => {
  const { item, dense } = props;
  const headline = notificationHeadline(item);
  const system = isSystemNotification(item);
  const category = notificationCategory(item);
  const href = notificationHref(item);
  const unread = !item.readAt;
  const interactive = !!props.onClick && (!!href || unread);

  return (
    <Flex
      as="button"
      type="button"
      width="100%"
      textAlign="left"
      alignItems="flex-start"
      columnGap={2.5}
      paddingX={2}
      paddingY={2}
      borderRadius="var(--tt-radius-md, 12px)"
      background={unread ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
      cursor={interactive ? 'pointer' : 'default'}
      _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
      aria-label={`${headline.actor ? `${headline.actor} ${headline.text}` : headline.text}${unread ? ' (unread)' : ''}`}
      onClick={() => props.onClick?.(item)}
    >
      <Box position="relative" flexShrink={0}>
        {system ? (
          <LopuAvatar size="32px" />
        ) : (
          <ProfileAvatarCircle avatarUrl={item.actorAvatarUrl} name={item.actorName || item.actorUsername || '?'} size="32px" fontSize="sm" />
        )}
        <Box position="absolute" bottom="-4px" right="-4px" fontSize="11px" lineHeight="1" aria-hidden="true">
          {notificationEmoji(item.type)}
        </Box>
      </Box>
      <Box minWidth={0} flex="1" whiteSpace="normal">
        <Text fontSize="xs" color={INK} overflowWrap="anywhere">
          {headline.actor ? (
            <>
              <Text as="span" fontWeight={700}>
                {headline.actor}
              </Text>{' '}
              {headline.text}
            </>
          ) : (
            <Text as="span" fontWeight={600}>
              {headline.text}
            </Text>
          )}
        </Text>
        {item.preview && item.type !== 'reaction' && (
          <Text fontSize="xs" color={item.outcome === 'error' ? 'var(--tt-danger, #d6455a)' : MUTED} noOfLines={dense ? 2 : 3} overflowWrap="anywhere">
            {item.preview}
          </Text>
        )}
        <Flex alignItems="center" columnGap={1.5} rowGap={0.5} flexWrap="wrap" marginTop={0.5}>
          <Text as="time" dateTime={item.createdAt} title={absoluteTime(item.createdAt)} fontSize="10px" color={MUTED}>
            {timeAgo(item.createdAt)}
          </Text>
          {!dense && (
            <Text
              fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
              fontSize="9px"
              fontWeight={600}
              letterSpacing="0.08em"
              textTransform="uppercase"
              color={MUTED}
              paddingX="6px"
              paddingY="1px"
              borderRadius="999px"
              border="1px solid var(--tt-border, #ececef)"
            >
              {NOTIFICATION_CATEGORY_META[category].emoji} {NOTIFICATION_CATEGORY_META[category].label}
            </Text>
          )}
          {!dense && unread && (
            <Text fontSize="9px" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase" color="var(--tt-accent, #7c5cff)">
              Unread
            </Text>
          )}
        </Flex>
      </Box>
    </Flex>
  );
};
