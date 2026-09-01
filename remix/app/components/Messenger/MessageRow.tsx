import React from 'react';
import { Box, Button, Flex, Image, Menu, MenuButton, MenuItem, MenuList, Portal } from '@chakra-ui/react';

import { ReactionControl } from '../Feed/ReactionControl';
import { PostAttachments } from '../Attachments/PostAttachments';
import { timeAgo } from '../Feed/feedTypes';
import { REACTION_EMOJIS } from '~/schemas/registry';
import { getUserDisplayName } from '~/utils/userIdentity';
import { CustomEmojiImage, renderTextWithEmojis } from './CustomEmojiImage';
import { MessengerEmojiPicker } from './MessengerEmojiPicker';
import {
  customTokenId,
  isCustomToken,
  memberDisplayName,
  systemMessageText,
  type ChatMember,
  type ChatMessage,
  type CustomEmoji,
  type CustomEmojiMap,
  type ExternalAiSource,
  type MessengerMode
} from './messengerTypes';

const AVATAR_SIZE = 30;

const Avatar = ({
  profile,
  externalSource,
  size = AVATAR_SIZE
}: {
  profile: ChatMessage['author'];
  externalSource?: ExternalAiSource | null;
  size?: number;
}) => {
  if (externalSource) {
    return (
      <Flex
        width={`${size}px`}
        height={`${size}px`}
        borderRadius="full"
        align="center"
        justify="center"
        background={externalSource.provider === 'chatgpt' ? '#17171c' : '#d97757'}
        color="white"
        fontSize={`${Math.round(size * 0.48)}px`}
        fontWeight={700}
        flexShrink={0}
        title={externalSource.label}
      >
        {externalSource.provider === 'chatgpt' ? '◎' : '✦'}
      </Flex>
    );
  }
  const letter = (profile ? getUserDisplayName(profile) : '?').slice(0, 1).toUpperCase();
  if (profile?.avatarUrl) {
		return (
			<Image src={profile.avatarUrl} alt={letter} width={`${size}px`} height={`${size}px`} borderRadius="full" objectFit="cover" flexShrink={0} />
		);
  }
  return (
    <Flex
      width={`${size}px`}
      height={`${size}px`}
      borderRadius="full"
      align="center"
      justify="center"
      background="var(--tt-gradient-rainbow, linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6))"
      color="white"
      fontSize={`${Math.round(size * 0.45)}px`}
      fontWeight={700}
      flexShrink={0}
    >
      {letter}
    </Flex>
  );
};

export type MessageRowProps = {
  message: ChatMessage;
  mode: MessengerMode;
  isMine: boolean;
  grouped: boolean;
  members: ChatMember[];
  customEmojis: CustomEmojiMap;
  pickerEmojis: CustomEmoji[];
  seenBy: ChatMember[];
  isThreadReply?: boolean;
  onReact: (message: ChatMessage, token: string) => void;
  onReply?: (message: ChatMessage) => void;
  onOpenThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onUploadEmoji?: () => void;
};

// One message. Slack mode: flat left-aligned rows with hover toolbar and
// thread chips. Messenger mode: bubbles (mine right / theirs left) with
// reaction chips hugging the bubble corner and FB-style seen-by avatars.
export const MessageRow = (props: MessageRowProps) => {
  const { message, mode, isMine, grouped, members, customEmojis, seenBy } = props;
  const [hovered, setHovered] = React.useState(false);

  const emojiByName = React.useMemo(() => {
    const map = new Map<string, { id: string; image: string }>();
    for (const emoji of props.pickerEmojis) map.set(emoji.name, { id: emoji.id, image: emoji.image });
    return map;
  }, [props.pickerEmojis]);

  if (message.systemType) {
    return (
      <Flex justify="center" paddingY={1} paddingX={4}>
        <Box fontSize="12px" color="var(--tt-faint, #b9b9c3)" textAlign="center" whiteSpace="normal">
          {systemMessageText(message, members)}
        </Box>
      </Flex>
    );
  }

  const member = members.find((m) => m.userId === message.authorId) || null;
  const displayName = message.externalSource
    ? message.externalSource.role === 'user'
      ? `You · ${message.externalSource.label}`
      : message.externalSource.authorName || message.externalSource.label
    : member
      ? memberDisplayName(member)
      : message.author
        ? getUserDisplayName(message.author)
        : 'Someone';
  const bodyText = message.deleted ? null : renderTextWithEmojis(message.text, emojiByName, mode === 'messenger' ? 20 : 20);

  const reactionEntries = Object.entries(message.reactionCounts).sort((a, b) => b[1] - a[1]);
  const viewerSet = new Set(message.viewerReactions);

  const reactionChip = ([token, count]: [string, number]) => {
    const mine = viewerSet.has(token);
    return (
      <Button
        key={token}
        size="xs"
        height="22px"
        minWidth="0"
        paddingX="7px"
        variant="ghost"
        onClick={() => props.onReact(message, token)}
        background={mine ? 'var(--tt-accent-tint, #f3e8ff)' : 'var(--tt-surface-alt, #f2f2f5)'}
        boxShadow={mine ? 'inset 0 0 0 1px var(--tt-accent, #a855f7)' : 'none'}
        borderRadius="var(--tt-radius-pill, 999px)"
        fontSize="12px"
        display="inline-flex"
        alignItems="center"
        gap="4px"
      >
        {isCustomToken(token) ? (
          <CustomEmojiImage image={customEmojis[customTokenId(token)]?.image} name={customEmojis[customTokenId(token)]?.name} size={15} />
        ) : (
          <span>{token}</span>
        )}
        <Box as="span" color="var(--tt-muted, #9a9aa6)" fontWeight={600}>
          {count}
        </Box>
      </Button>
    );
  };

  const pickerContent = (close: () => void) => (
    <Box padding={2}>
      <Flex gap={1} marginBottom={2}>
        {REACTION_EMOJIS.map((emoji) => (
          <Button
            key={emoji}
            size="sm"
            variant="ghost"
            paddingX={2}
            fontSize="18px"
            background={viewerSet.has(emoji) ? 'var(--tt-accent-tint, #f3e8ff)' : 'transparent'}
            onClick={() => {
              props.onReact(message, emoji);
              close();
            }}
          >
            {emoji}
          </Button>
        ))}
      </Flex>
      <MessengerEmojiPicker
        emojis={props.pickerEmojis}
        activeTokens={message.viewerReactions}
        onPick={(token) => {
          props.onReact(message, token);
          close();
        }}
				onUploadRequest={
					props.onUploadEmoji
						? () => {
								close();
								props.onUploadEmoji!();
						  }
						: undefined
				}
      />
    </Box>
  );

  const toolbar = message.deleted ? null : (
		<Flex gap={0} opacity={{ base: 1, md: hovered ? 1 : 0 }} transition="opacity 0.12s ease" align="center" flexShrink={0}>
      <ReactionControl
        trigger={
          <Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" title="React">
            😀
          </Button>
        }
        content={pickerContent}
        onQuickTap={() => {}}
        tapOpens
      />
      {mode === 'messenger' && props.onReply ? (
        <Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" title="Reply" onClick={() => props.onReply!(message)}>
          ↩
        </Button>
      ) : null}
      {mode === 'slack' && props.onOpenThread && !props.isThreadReply ? (
        <Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" title="Reply in thread" onClick={() => props.onOpenThread!(message)}>
          🧵
        </Button>
      ) : null}
      {!message.externalSource && ((isMine && props.onEdit) || props.onDelete) ? (
        <Menu isLazy placement="bottom-end">
          <MenuButton as={Button} size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)">
            ⋯
          </MenuButton>
          <Portal>
            <MenuList zIndex={10260} minWidth="140px" fontSize="13px">
              {isMine && props.onEdit ? <MenuItem onClick={() => props.onEdit!(message)}>✏️ Edit</MenuItem> : null}
              {props.onDelete ? (
                <MenuItem color="var(--tt-danger, #e5484d)" onClick={() => props.onDelete!(message)}>
                  🗑️ Delete
                </MenuItem>
              ) : null}
            </MenuList>
          </Portal>
        </Menu>
      ) : null}
    </Flex>
  );

  const quotedReply = message.replyTo ? (
    <Box
      fontSize="12px"
      color="var(--tt-muted, #9a9aa6)"
      borderLeft="2px solid var(--tt-border, #ececef)"
      paddingLeft={2}
      marginBottom={1}
      whiteSpace="normal"
    >
      <Box as="span" fontWeight={600}>
        {message.replyTo.authorName || 'Someone'}
      </Box>{' '}
			{message.replyTo.deleted ? 'Deleted message' : message.replyTo.text || (message.replyTo.attachmentCount ? '📎 Attachment' : '…')}
    </Box>
  ) : null;

  const deletedBody = (
    <Box as="span" fontStyle="italic" color="var(--tt-faint, #b9b9c3)">
      This message was deleted
    </Box>
  );

  const seenRow = seenBy.length ? (
    <Flex justify="flex-end" gap="2px" paddingX={2} marginTop="2px" title={`Seen by ${seenBy.map((m) => memberDisplayName(m)).join(', ')}`}>
      {seenBy.slice(0, 8).map((m) => (
        <Avatar key={m.userId} profile={m.profile} size={14} />
      ))}
    </Flex>
  ) : null;

  if (mode === 'messenger') {
    return (
      <Box paddingX={3} marginTop={grouped ? '2px' : 3}>
        <Flex
          direction={isMine ? 'row-reverse' : 'row'}
          align="flex-end"
          gap={2}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {!isMine ? (
            <Box width={`${AVATAR_SIZE}px`} flexShrink={0}>
              {!grouped ? <Avatar profile={member?.profile || message.author} externalSource={message.externalSource} /> : null}
            </Box>
          ) : null}
          <Box maxWidth="min(72%, 480px)">
            {!isMine && !grouped ? (
              <Box fontSize="11px" color="var(--tt-muted, #9a9aa6)" marginBottom="2px" marginLeft={2}>
                {displayName}
              </Box>
            ) : null}
            {quotedReply}
            <Box position="relative">
              <Box
                paddingX="12px"
                paddingY="7px"
                borderRadius="18px"
                background={isMine ? 'var(--tt-accent, #a855f7)' : 'var(--tt-surface-alt, #f2f2f5)'}
                color={isMine ? '#ffffff' : 'var(--tt-ink, #17171c)'}
                fontSize="14px"
                overflowWrap="anywhere"
                title={`${new Date(message.createdAt).toLocaleString()}${message.editedAt ? ' · edited' : ''}`}
              >
								{message.deleted ? (
									deletedBody
								) : (
									<Flex flexDirection="column" rowGap={message.text ? 2 : 0}>
										<PostAttachments attachments={message.attachments} compact ariaLabel="Message attachments" />
										{bodyText}
									</Flex>
								)}
                {message.editedAt && !message.deleted ? (
                  <Box as="span" fontSize="10px" opacity={0.7} marginLeft={1}>
                    (edited)
                  </Box>
                ) : null}
              </Box>
              {reactionEntries.length ? (
								<Flex position="absolute" bottom="-11px" right={isMine ? 'auto' : '6px'} left={isMine ? '6px' : 'auto'} gap="2px">
                  {reactionEntries.map(reactionChip)}
                </Flex>
              ) : null}
            </Box>
            {reactionEntries.length ? <Box height="12px" /> : null}
          </Box>
          {toolbar}
        </Flex>
        {seenRow}
      </Box>
    );
  }

  // slack mode — flat rows
  return (
    <Box
      paddingX={4}
      paddingY={grouped ? '1px' : undefined}
      marginTop={grouped ? 0 : 2}
      _hover={{ background: 'var(--tt-surface-hover, #f7f7f9)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      borderRadius="var(--tt-radius-sm, 6px)"
    >
      <Flex gap={2} align="flex-start">
        <Box width={`${AVATAR_SIZE}px`} flexShrink={0} paddingTop="2px">
          {!grouped ? <Avatar profile={member?.profile || message.author} externalSource={message.externalSource} /> : null}
        </Box>
        <Box flex={1} minWidth={0}>
          {!grouped ? (
            <Flex align="baseline" gap={2}>
              <Box fontWeight={700} fontSize="13.5px">
                {displayName}
              </Box>
              {message.externalSource ? (
                <Box
                  as="span"
                  fontSize="9px"
                  lineHeight="16px"
                  paddingX="6px"
                  borderRadius="var(--tt-radius-pill, 999px)"
                  background="var(--tt-surface-alt, #f2f2f5)"
                  color="var(--tt-muted, #777782)"
                >
                  imported
                </Box>
              ) : null}
              <Box fontSize="11px" color="var(--tt-faint, #b9b9c3)">
                {timeAgo(message.createdAt)}
              </Box>
            </Flex>
          ) : null}
          {quotedReply}
          <Box fontSize="14px" overflowWrap="anywhere">
            {message.deleted ? deletedBody : bodyText}
            {message.editedAt && !message.deleted ? (
              <Box as="span" fontSize="10px" color="var(--tt-faint, #b9b9c3)" marginLeft={1}>
                (edited)
              </Box>
            ) : null}
          </Box>
					{!message.deleted && message.attachments.length ? (
						<Box marginTop={message.text ? 2 : 0} maxWidth="560px">
							<PostAttachments attachments={message.attachments} compact ariaLabel="Message attachments" />
						</Box>
					) : null}
          {reactionEntries.length ? (
            <Flex gap="4px" marginTop="4px" wrap="wrap">
              {reactionEntries.map(reactionChip)}
            </Flex>
          ) : null}
          {message.threadCount > 0 && props.onOpenThread && !props.isThreadReply ? (
            <Button
              size="xs"
              variant="ghost"
              marginTop="2px"
              color="var(--tt-link, #6366f1)"
              fontWeight={600}
              onClick={() => props.onOpenThread!(message)}
            >
              🧵 {message.threadCount} {message.threadCount === 1 ? 'reply' : 'replies'}
              {message.threadLastAt ? (
                <Box as="span" color="var(--tt-faint, #b9b9c3)" fontWeight={400} marginLeft={1}>
                  · {timeAgo(message.threadLastAt)}
                </Box>
              ) : null}
            </Button>
          ) : null}
        </Box>
        {toolbar}
      </Flex>
      {seenRow}
    </Box>
  );
};
