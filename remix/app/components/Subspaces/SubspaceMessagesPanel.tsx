import React from 'react';
import { SUBSPACE_MESSAGES_REQUIREMENTS } from './subspaceMessagesCapabilities';
import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { ChatView } from '../Messenger/ChatView';
import { ChatDetailsDrawer } from '../Messenger/ChatDetailsDrawer';
import { useMessengerApi } from '../Messenger/useMessengerApi';
import type { ChatSummary } from '../Messenger/messengerTypes';
import type { PublicSubspace } from './subspaceTypes';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';

// This module is loaded only when Messages is first requested. The parent
// retains the mounted panel when Posts returns, preserving the live composer.
export function SubspaceMessagesPanel({ subspace, active = true }: { subspace: PublicSubspace; active?: boolean }) {
  const api = useMessengerApi();
  const [chat, setChat] = React.useState<ChatSummary | null>(null);
  const [error, setError] = React.useState('');
  const [details, setDetails] = React.useState(false);
  const [retry, setRetry] = React.useState(0);
  const chatId = subspace.messagesChatId;
  const generation = React.useRef(0);
  const refresh = React.useCallback(async () => {
    if (!chatId) return;
    const request = ++generation.current;
    try {
      await Promise.all(Object.entries(SUBSPACE_MESSAGES_REQUIREMENTS).map(([feature, version]) => requireThingtimeCapability(feature, version)));
      const payload = await api.getChat(chatId);
      if (request !== generation.current) return;
      setChat({ ...payload.chat, members: payload.members || payload.chat.members || [], myMember: payload.myMember || payload.chat.myMember || null }); setError('');
    } catch (failure: any) {
      if (request !== generation.current) return;
      // A refused read cannot keep a formerly authorized conversation visible.
      if ([401, 403, 404].includes(Number(failure?.status))) setChat(null);
      setError(failure?.error || 'Could not load messages. Your draft is preserved; try again.');
    }
  }, [api, chatId]);
  React.useEffect(() => {
    void refresh();
    // Invalidates this request generation, not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; };
  }, [refresh, retry]);

  if (!chatId) return <Text role="status" fontSize="sm">Messages are not available on this server yet.</Text>;
  return <Flex direction="column" minW={0} border="1px solid var(--tt-border, #ececef)" borderRadius="var(--tt-radius-lg, 16px)" overflow="hidden" background="var(--tt-card, #fff)" data-testid="subspace-messages">
    {error && <Flex align="center" gap={2} p={3}><Text role="alert" fontSize="sm">{error}</Text><Button size="xs" onClick={() => setRetry(value => value + 1)}>Retry messages</Button></Flex>}
    {chat ? <Box height="max(480px, calc(100dvh - 300px))" minW={0}>
      <ChatView key={chat.id} api={api} active={active} chatSummary={chat} mode="slack" onAccessRevoked={() => { generation.current++; setChat(null); setDetails(false); setError('You no longer have access to these messages.'); }} onOpenDetails={() => setDetails(true)} onChatsChanged={() => void refresh()} />
      <ChatDetailsDrawer isOpen={details} onClose={() => setDetails(false)} api={api} chat={chat} onChanged={() => void refresh()} onLeft={() => { setDetails(false); void refresh(); }} />
    </Box> : !error ? <Text role="status" p={4} fontSize="sm">Opening messages…</Text> : null}
  </Flex>;
}
