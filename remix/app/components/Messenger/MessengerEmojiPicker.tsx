import React from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';

import { EmojiPicker } from '../Emoji/EmojiPicker';
import { useRecentReactions } from '../Emoji/useRecentReactions';
import { CustomEmojiImage } from './CustomEmojiImage';
import { CUSTOM_TOKEN_PREFIX, customTokenId, isCustomToken, type CustomEmoji } from './messengerTypes';
import { readCustomRecents } from './messengerCache';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// The messenger's reaction picker: the standard unicode EmojiPicker plus a
// Custom tab holding this chat's community emojis and the viewer's personal
// uploads. Custom picks emit `custom:<emoji id>` tokens; unicode picks emit
// plain tokens — the caller treats both the same.
export const MessengerEmojiPicker = ({
  emojis,
  activeTokens,
  onPick,
  onUploadRequest,
  autoFocus
}: {
  emojis: CustomEmoji[];
  activeTokens?: string[];
  onPick: (token: string) => void;
  onUploadRequest?: () => void;
  autoFocus?: boolean;
}) => {
  const user = useCurrentUser();
  const [tab, setTab] = React.useState<'emoji' | 'custom'>('emoji');
  const { recent } = useRecentReactions();
  const customRecents = React.useMemo(() => readCustomRecents(user?.id || null), [user?.id]);
  const emojiById = React.useMemo(() => new Map(emojis.map((e) => [e.id, e])), [emojis]);
  const activeSet = React.useMemo(() => new Set(activeTokens || []), [activeTokens]);

  const recentCustom = customRecents
    .filter((token) => isCustomToken(token) && emojiById.has(customTokenId(token)))
    .slice(0, 8);

  const tabButton = (id: 'emoji' | 'custom', label: string) => (
    <Button
      size="xs"
      variant="ghost"
      onClick={() => setTab(id)}
      background={tab === id ? 'var(--tt-surface-alt, #f2f2f5)' : 'transparent'}
      color={tab === id ? 'var(--tt-ink, #17171c)' : 'var(--tt-muted, #9a9aa6)'}
      borderRadius="var(--tt-radius-pill, 999px)"
      fontWeight={600}
    >
      {label}
    </Button>
  );

  return (
    <Box width="320px" maxWidth="86vw">
      <Flex gap={1} marginBottom={2}>
        {tabButton('emoji', '😀 Emoji')}
        {tabButton('custom', `✨ Custom${emojis.length ? ` (${emojis.length})` : ''}`)}
      </Flex>
      {tab === 'emoji' ? (
        <EmojiPicker onPick={onPick} recent={recent} activeTokens={activeTokens} autoFocus={autoFocus} />
      ) : (
        <Box maxHeight="280px" overflowY="auto">
          {recentCustom.length ? (
            <Box marginBottom={2}>
              <Box fontSize="11px" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
                Recently used
              </Box>
              <Flex wrap="wrap" gap={1}>
                {recentCustom.map((token) => {
                  const emoji = emojiById.get(customTokenId(token))!;
                  return (
                    <CustomEmojiButton
                      key={token}
                      emoji={emoji}
                      active={activeSet.has(token)}
                      onPick={() => onPick(`${CUSTOM_TOKEN_PREFIX}${emoji.id}`)}
                    />
                  );
                })}
              </Flex>
            </Box>
          ) : null}
          <Flex wrap="wrap" gap={1}>
            {emojis.map((emoji) => (
              <CustomEmojiButton
                key={emoji.id}
                emoji={emoji}
                active={activeSet.has(`${CUSTOM_TOKEN_PREFIX}${emoji.id}`)}
                onPick={() => onPick(`${CUSTOM_TOKEN_PREFIX}${emoji.id}`)}
              />
            ))}
            {onUploadRequest ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onUploadRequest}
                height="40px"
                minWidth="40px"
                padding={0}
                borderRadius="var(--tt-radius-md, 10px)"
                border="1px dashed var(--tt-border, #ececef)"
                color="var(--tt-muted, #9a9aa6)"
                title="Upload a custom emoji or gif"
              >
                +
              </Button>
            ) : null}
          </Flex>
          {!emojis.length ? (
            <Box fontSize="12px" color="var(--tt-muted, #9a9aa6)" padding={2} whiteSpace="normal">
              No custom emojis here yet{onUploadRequest ? ' — upload the first one ✨' : ''}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
};

const CustomEmojiButton = ({
  emoji,
  active,
  onPick
}: {
  emoji: CustomEmoji;
  active: boolean;
  onPick: () => void;
}) => (
  <Button
    size="sm"
    variant="ghost"
    onClick={onPick}
    height="40px"
    minWidth="40px"
    padding={1}
    borderRadius="var(--tt-radius-md, 10px)"
    background={active ? 'var(--tt-accent-tint, #f3e8ff)' : 'transparent'}
    boxShadow={active ? 'inset 0 0 0 1.5px var(--tt-accent, #a855f7)' : 'none'}
    title={`:${emoji.name}:`}
  >
    <CustomEmojiImage image={emoji.image} name={emoji.name} size={26} />
  </Button>
);
