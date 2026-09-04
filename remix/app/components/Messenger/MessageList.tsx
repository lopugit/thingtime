import React from 'react';
import { Box, Button, Flex, Spinner } from '@chakra-ui/react';

import { MessageRow } from './MessageRow';
import type { ChatMember, ChatMessage, CustomEmoji, CustomEmojiMap, MessengerMode } from './messengerTypes';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type MessageListProps = {
  messages: ChatMessage[]; // newest first, as the API ships them
  mode: MessengerMode;
  viewerId: string | null;
  members: ChatMember[];
  customEmojis: CustomEmojiMap;
  pickerEmojis: CustomEmoji[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  isThreadReply?: boolean;
  showSeenBy?: boolean;
  onReact: (message: ChatMessage, token: string) => void;
  onReply?: (message: ChatMessage) => void;
  onOpenThread?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onDelete?: (message: ChatMessage) => void;
  onUploadEmoji?: () => void;
  emptyLabel?: string;
};

// Chronological pane (oldest at top, pinned to the bottom like every chat
// app): reverses the API's newest-first page, groups consecutive same-author
// messages inside five minutes, computes FB-style seen-by rows from members'
// read receipts, and keeps the scroll position stable while older pages
// prepend.
export const MessageList = (props: MessageListProps) => {
  const { messages, viewerId, members } = props;
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);
  const prevHeightRef = React.useRef(0);
  const prevOldestIdRef = React.useRef<string | null>(null);

  const ordered = React.useMemo(() => [...messages].reverse(), [messages]);

  // seen-by: each member (except the viewer) sits under the newest message
  // they have read; receipts arrive already privacy-filtered from the API
  const seenByMessageId = React.useMemo(() => {
    const map = new Map<string, ChatMember[]>();
    if (!props.showSeenBy) return map;
    for (const member of members) {
      if (!member.lastReadAt || member.userId === viewerId) continue;
      let target: ChatMessage | null = null;
      for (const message of ordered) {
        if (message.createdAt <= member.lastReadAt) target = message;
        else break;
      }
      if (target && target.authorId !== member.userId) {
        if (!map.has(target.id)) map.set(target.id, []);
        map.get(target.id)!.push(member);
      }
    }
    return map;
  }, [members, ordered, props.showSeenBy, viewerId]);

  // pin to bottom on new messages; preserve position when history prepends
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const oldestId = ordered[0]?.id || null;
    if (prevOldestIdRef.current && oldestId !== prevOldestIdRef.current && !stickToBottomRef.current) {
      el.scrollTop += el.scrollHeight - prevHeightRef.current;
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeightRef.current = el.scrollHeight;
    prevOldestIdRef.current = oldestId;
  }, [ordered]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 120 && props.hasMore && !props.loadingMore) {
      prevHeightRef.current = el.scrollHeight;
      props.onLoadMore();
    }
  };

  return (
    <Box ref={scrollRef} flex={1} overflowY="auto" onScroll={handleScroll} paddingY={2}>
      {/* short conversations sit at the BOTTOM of the pane like every chat app */}
      <Flex direction="column" justify="flex-end" minHeight="100%">
      {props.hasMore ? (
        <Flex justify="center" paddingY={2}>
          {props.loadingMore ? (
            <Spinner size="sm" color="var(--tt-muted, #9a9aa6)" />
          ) : (
            <Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" onClick={props.onLoadMore}>
              Load earlier messages
            </Button>
          )}
        </Flex>
      ) : null}
      {!ordered.length ? (
        <Flex justify="center" align="center" height="100%" minHeight="160px">
          <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px" whiteSpace="normal" textAlign="center" paddingX={6}>
            {props.emptyLabel || 'No messages yet — say hi 👋'}
          </Box>
        </Flex>
      ) : null}
      {ordered.map((message, index) => {
        const prev = ordered[index - 1];
        const authorKey = (entry: ChatMessage) =>
          entry.externalSource
            ? `${entry.externalSource.sourceId}:${entry.externalSource.role || 'unknown'}:${entry.externalSource.authorName || ''}`
            : entry.authorId;
        const grouped =
          !!prev &&
          !prev.systemType &&
          !message.systemType &&
          authorKey(prev) === authorKey(message) &&
          new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
        return (
          <MessageRow
            key={message.id}
            message={message}
            mode={props.mode}
            isMine={message.externalSource ? message.externalSource.role === 'user' : message.authorId === viewerId}
            grouped={grouped}
            members={members}
            customEmojis={props.customEmojis}
            pickerEmojis={props.pickerEmojis}
            seenBy={seenByMessageId.get(message.id) || []}
            isThreadReply={props.isThreadReply}
            onReact={props.onReact}
            onReply={props.onReply}
            onOpenThread={props.onOpenThread}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
            onUploadEmoji={props.onUploadEmoji}
          />
        );
      })}
      </Flex>
    </Box>
  );
};
