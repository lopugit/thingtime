import React from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import { chatDisplayName, type ChatSummary } from './messengerTypes';
import type { MessengerApi } from './useMessengerApi';

// Message requests, FB-style: two buckets — people who follow you, and
// unknown connections. Accept opens the chat; decline quietly hides it.
export const RequestsView = ({
  api,
  viewerId,
  onBack,
  onAccepted,
  onChanged
}: {
  api: MessengerApi;
  viewerId: string | null;
  onBack: () => void;
  onAccepted: (chatId: string) => void;
  onChanged: () => void;
}) => {
  const lopu = useLopu();
  const [buckets, setBuckets] = React.useState<{ follower: ChatSummary[]; unknown: ChatSummary[] }>({ follower: [], unknown: [] });
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(() => {
    api
      .requests()
      .then((payload: any) => {
        setBuckets(payload.requests || { follower: [], unknown: [] });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  const respond = async (chat: ChatSummary, accept: boolean) => {
    setBuckets((prev) => ({
      follower: prev.follower.filter((c) => c.id !== chat.id),
      unknown: prev.unknown.filter((c) => c.id !== chat.id)
    }));
    try {
      await api.respondRequest({ chatId: chat.id, accept });
      onChanged();
      if (accept) onAccepted(chat.id);
      else lopu({ title: 'Request declined — they will not be told 🤫', status: 'info', duration: 5000 });
    } catch (err: any) {
      lopu({ title: err?.error || 'That did not work 😞', status: 'error' });
      load();
    }
  };

  const bucket = (title: string, hint: string, chats: ChatSummary[]) => (
    <Box marginBottom={4}>
      <Box fontWeight={700} fontSize="13px" marginBottom={1}>
        {title}
      </Box>
      <Box fontSize="11px" color="var(--tt-muted, #9a9aa6)" marginBottom={2} whiteSpace="normal">
        {hint}
      </Box>
      {!chats.length ? (
        <Box fontSize="12px" color="var(--tt-faint, #b9b9c3)">
          Nothing here 🎉
        </Box>
      ) : (
        chats.map((chat) => (
          <Flex
            key={chat.id}
            align="center"
            gap={2}
            padding={2}
            borderRadius="var(--tt-radius-md, 10px)"
            border="1px solid var(--tt-border-light, #f3f3f5)"
            marginBottom={2}
          >
            <Box flex={1} minWidth={0}>
              <Box fontWeight={600} fontSize="13.5px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {chatDisplayName(chat, viewerId)}
              </Box>
              <Box fontSize="12px" color="var(--tt-muted, #9a9aa6)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
								{chat.lastMessage?.text || (chat.lastMessage?.attachmentCount ? '📎 Attachment' : 'Wants to chat with you')}
              </Box>
            </Box>
            <Button
              size="xs"
              onClick={() => respond(chat, true)}
              background="var(--tt-accent, #a855f7)"
              color="white"
              _hover={{ opacity: 0.9 }}
              borderRadius="var(--tt-radius-pill, 999px)"
            >
              Accept
            </Button>
            <Button size="xs" variant="outline" onClick={() => respond(chat, false)} borderRadius="var(--tt-radius-pill, 999px)">
              Decline
            </Button>
          </Flex>
        ))
      )}
    </Box>
  );

  return (
    <Flex direction="column" height="100%" minHeight={0}>
      <Flex align="center" gap={2} paddingX={3} paddingY={2} borderBottom="1px solid var(--tt-border-light, #f3f3f5)">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ←
        </Button>
        <Box fontWeight={700} fontSize="15px">
          💌 Message requests
        </Box>
      </Flex>
      <Box flex={1} overflowY="auto" padding={3}>
        {loading ? (
          <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)">
            Checking the mailbox…
          </Box>
        ) : (
          <>
            {bucket('From your followers', 'People who follow you on Thingtime but you have not chatted with yet.', buckets.follower)}
            {bucket('Unknown connections', 'People with no connection to you yet — open with care.', buckets.unknown)}
          </>
        )}
      </Box>
    </Flex>
  );
};
