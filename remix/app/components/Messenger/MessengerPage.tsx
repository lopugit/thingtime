import React from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router';

import { useLopu } from '../Lopu/useLopu';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useIsMobileViewport } from '../Nav/Drawer/useDrawer';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { ChatDetailsDrawer } from './ChatDetailsDrawer';
import { AiConnectionsModal } from './AiConnectionsModal';
import { ChatView } from './ChatView';
import { InboxSidebar } from './InboxSidebar';
import {
  BrowseChannelsModal,
  CommunityCreateModal,
  CommunityJoinModal,
  InputModal,
  InvitePeopleModal,
  NewChannelModal,
  NewChatModal,
  type InputModalRequest
} from './MessengerModals';
import { RequestsView } from './RequestsView';
import { SlackSidebar } from './SlackSidebar';
import { MESSENGER_REFRESH_EVENT, modeKey, readChatList, readCommunities, writeChatList, writeCommunities, writeUnread } from './messengerCache';
import type { ChatSummary, Community, MessengerMode } from './messengerTypes';
import { useMessengerApi } from './useMessengerApi';

const LIST_POLL_MS = 15_000;

// The Messenger page: one data spine (chat list + communities, cache-seeded,
// visibility-aware polling) feeding two presentations — Spaces (Slack-style
// workspaces with channels/sections/threads) and Chats (FB-Messenger-style
// inbox with requests) — swapped by the header toggle. Desktop is a two-pane
// split; mobile pushes between list → conversation → details.
export const MessengerPage = () => {
  const user = useCurrentUser();
  const userId = user?.id || null;
  const api = useMessengerApi();
  const lopu = useLopu();
  const isMobile = useIsMobileViewport();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

	const [mode, setMode] = React.useState<MessengerMode>(() => (readLocalCache<MessengerMode>(modeKey(userId)) === 'slack' ? 'slack' : 'messenger'));
  const [chats, setChats] = React.useState<ChatSummary[]>(() => readChatList(userId));
  const [communities, setCommunities] = React.useState<Community[]>(() => readCommunities(userId));
  const [requestsCount, setRequestsCount] = React.useState(0);
  const [selectedChatId, setSelectedChatId] = React.useState<string | null>(searchParams.get('chat'));
  const [activeCommunityId, setActiveCommunityId] = React.useState<string | null>(null);
  const [showRequests, setShowRequests] = React.useState(searchParams.get('view') === 'requests');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [aiConnectionsOpen, setAiConnectionsOpen] = React.useState(false);
  const [inputRequest, setInputRequest] = React.useState<InputModalRequest | null>(null);
  const [modal, setModal] = React.useState<
    | { kind: 'new-dm' }
    | { kind: 'new-group' }
    | { kind: 'new-community' }
    | { kind: 'join-community' }
    | { kind: 'new-channel'; sectionId: string | null }
    | { kind: 'browse-channels' }
    | { kind: 'invite' }
    | null
  >(null);

  const selectedChat = chats.find((c) => c.id === selectedChatId) || null;
  const activeCommunity = communities.find((c) => c.id === activeCommunityId) || communities[0] || null;

  const refresh = React.useCallback(async () => {
    try {
      const [chatsPayload, communitiesPayload] = await Promise.all([api.listChats(), api.communities()]);
      setChats(chatsPayload.chats || []);
      setRequestsCount(chatsPayload.requestsCount || 0);
      setCommunities(communitiesPayload.communities || []);
      writeChatList(userId, chatsPayload.chats || []);
      writeCommunities(userId, communitiesPayload.communities || []);
      writeUnread(userId, chatsPayload.totalUnread || 0);
      // the global notifier skips polling while this page is open — feed the
      // nav badge from here instead
      window.dispatchEvent(
        new CustomEvent('thingtime:messenger-unread', {
          detail: { total: chatsPayload.totalUnread || 0, requests: chatsPayload.requestsCount || 0 }
        })
      );
    } catch (err: any) {
      // guests get bounced by the route loader; transient errors keep cache
      if (err?.error === 'Unauthorized') navigate('/login');
    }
  }, [api, navigate, userId]);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, LIST_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onRefreshEvent = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(MESSENGER_REFRESH_EVENT, onRefreshEvent);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(MESSENGER_REFRESH_EVENT, onRefreshEvent);
    };
  }, [refresh]);

  // deep links stay shareable: ?chat= opens a conversation, ?view=requests
  // (the drawer's Requests entry) opens the requests pane
  React.useEffect(() => {
    const fromUrl = searchParams.get('chat');
    if (fromUrl && fromUrl !== selectedChatId) setSelectedChatId(fromUrl);
    if (searchParams.get('view') === 'requests') {
      setShowRequests(true);
      setSelectedChatId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const selectChat = (chat: ChatSummary | string | null) => {
    const id = typeof chat === 'string' ? chat : chat?.id || null;
    setSelectedChatId(id);
    setShowRequests(false);
    setSearchParams(id ? { chat: id } : {}, { replace: true });
    if (id) void refresh();
  };

  const switchMode = (next: MessengerMode) => {
    setMode(next);
    writeLocalCache(modeKey(userId), next);
  };

  const startDm = async (person: { id: string; username: string }) => {
    try {
      const payload = await api.createChat({ chatType: 'dm', memberIds: [person.id] });
      await refresh();
      selectChat(payload.chat.id);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not start the chat 😞', status: 'error' });
    }
  };

  const modeToggle = (
		<Flex background="var(--tt-surface-alt, #f2f2f5)" borderRadius="var(--tt-radius-pill, 999px)" padding="3px" gap={0} flexShrink={0}>
      {(
        [
          ['slack', '🏛️ Spaces'],
          ['messenger', '💬 Chats']
        ] as [MessengerMode, string][]
      ).map(([id, label]) => (
        <Button
          key={id}
          size="xs"
          variant="ghost"
          onClick={() => switchMode(id)}
          background={mode === id ? 'var(--tt-card, #ffffff)' : 'transparent'}
          boxShadow={mode === id ? 'var(--tt-shadow-card, 0 1px 4px rgba(0,0,0,0.08))' : 'none'}
          borderRadius="var(--tt-radius-pill, 999px)"
          fontWeight={700}
          fontSize="12px"
          color={mode === id ? 'var(--tt-ink, #17171c)' : 'var(--tt-muted, #9a9aa6)'}
        >
          {label}
        </Button>
      ))}
    </Flex>
  );

	const sidebar =
		mode === 'slack' ? (
    <SlackSidebar
      communities={communities}
      activeCommunityId={activeCommunity?.id || null}
      onSelectCommunity={(id) => setActiveCommunityId(id)}
      chats={chats}
      viewerId={userId}
      selectedChatId={selectedChatId}
      onSelectChat={selectChat}
      onCreateCommunity={() => setModal({ kind: 'new-community' })}
      onJoinCommunity={() => setModal({ kind: 'join-community' })}
      onCreateChannel={(sectionId) => setModal({ kind: 'new-channel', sectionId: sectionId ?? null })}
      onBrowseChannels={() => setModal({ kind: 'browse-channels' })}
      onInvitePeople={() => setModal({ kind: 'invite' })}
      onCommunitySettings={() => setModal({ kind: 'invite' })}
      onRenameChat={(chat) =>
        setInputRequest({
          title: 'Rename channel',
          placeholder: 'channel-name',
          initial: chat.name || '',
          submitLabel: 'Rename',
          onSubmit: (name) =>
            api
              .updateChat({ id: chat.id, name })
              .then(() => refresh())
              .catch((err: any) => lopu({ title: err?.error || 'Rename failed 😞', status: 'error' }))
        })
      }
      onCreateSection={() =>
        setInputRequest({
          title: 'New section',
          placeholder: 'Section name',
          submitLabel: 'Create',
          maxLength: 60,
          onSubmit: (name) => {
            if (!activeCommunity) return;
            api
              .sections({ communityId: activeCommunity.id, create: { name } })
              .then(() => refresh())
              .catch((err: any) => lopu({ title: err?.error || 'Section did not create 😞', status: 'error' }));
          }
        })
      }
      onRenameSection={(sectionId, currentName) =>
        setInputRequest({
          title: 'Rename section',
          placeholder: 'Section name',
          initial: currentName,
          submitLabel: 'Rename',
          maxLength: 60,
          onSubmit: (name) => {
            if (!activeCommunity) return;
            api
              .sections({ communityId: activeCommunity.id, rename: { id: sectionId, name } })
              .then(() => refresh())
              .catch((err: any) => lopu({ title: err?.error || 'Rename failed 😞', status: 'error' }));
          }
        })
      }
      onNewDm={() => setModal({ kind: 'new-dm' })}
    />
  ) : (
    <InboxSidebar
      api={api}
      chats={chats}
      viewerId={userId}
      selectedChatId={selectedChatId}
      requestsCount={requestsCount}
      onSelectChat={selectChat}
      onOpenRequests={() => {
        setShowRequests(true);
        setSelectedChatId(null);
        setSearchParams({}, { replace: true });
      }}
      onNewGroup={() => setModal({ kind: 'new-group' })}
      onStartDm={startDm}
    />
  );

  const mainPane = showRequests ? (
    <RequestsView
      api={api}
      viewerId={userId}
      onBack={() => setShowRequests(false)}
      onAccepted={(chatId) => {
        void refresh().then(() => selectChat(chatId));
      }}
      onChanged={() => void refresh()}
    />
  ) : selectedChat ? (
    <ChatView
      key={selectedChat.id}
      api={api}
      chatSummary={selectedChat}
      mode={mode}
      onBack={isMobile ? () => selectChat(null) : undefined}
      onOpenDetails={() => setDetailsOpen(true)}
      onChatsChanged={() => void refresh()}
    />
  ) : (
    <Flex align="center" justify="center" height="100%" color="var(--tt-muted, #9a9aa6)" fontSize="14px" paddingX={8}>
      <Box textAlign="center" whiteSpace="normal">
        <Box fontSize="40px" marginBottom={2}>
          {mode === 'slack' ? '🏛️' : '💬'}
        </Box>
        {mode === 'slack'
          ? 'Pick a channel, or create a community to get the party started'
          : 'Pick a conversation, or search for someone to message'}
      </Box>
    </Flex>
  );

  const showSidebar = !isMobile || (!selectedChat && !showRequests);
  const showMain = !isMobile || selectedChat || showRequests;

  return (
    <Flex
      direction="column"
      height="100dvh"
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
      maxWidth="1400px"
      marginX="auto"
      width="100%"
    >
      <Flex
        flex={1}
        minHeight={0}
        border={{ md: '1px solid var(--tt-border-light, #f3f3f5)' }}
        borderRadius={{ md: 'var(--tt-radius-lg, 16px)' }}
        margin={{ md: 3 }}
        marginTop={{ base: 0, md: 3 }}
        overflow="hidden"
        background="var(--tt-card, #ffffff)"
      >
        {showSidebar ? (
          <Flex
            direction="column"
            width={{ base: '100%', md: mode === 'slack' ? '300px' : '340px' }}
            flexShrink={0}
            borderRight={{ md: '1px solid var(--tt-border-light, #f3f3f5)' }}
            minHeight={0}
          >
						<Flex align="center" justify="center" padding={2} borderBottom="1px solid var(--tt-border-light, #f3f3f5)" position="relative">
              {modeToggle}
              <Button
                size="xs"
                variant="ghost"
                position="absolute"
                right={2}
                borderRadius="var(--tt-radius-pill, 999px)"
                onClick={() => setAiConnectionsOpen(true)}
                aria-label="Connect AI apps"
                title="Connect ChatGPT and Claude"
              >
                ✦ AI
              </Button>
            </Flex>
            <Box flex={1} minHeight={0}>
              {sidebar}
            </Box>
          </Flex>
        ) : null}
        {showMain ? (
          <Box flex={1} minWidth={0} position="relative">
            {mainPane}
          </Box>
        ) : null}
      </Flex>

      {/* modals */}
      <NewChatModal
        isOpen={modal?.kind === 'new-dm' || modal?.kind === 'new-group'}
        groupOnly={modal?.kind === 'new-group'}
        onClose={() => setModal(null)}
        api={api}
        onCreated={(chatId) => void refresh().then(() => selectChat(chatId))}
      />
      <CommunityCreateModal
        isOpen={modal?.kind === 'new-community'}
        onClose={() => setModal(null)}
        api={api}
        onCreated={(community) => {
          setActiveCommunityId(community.id);
          switchMode('slack');
          void refresh();
        }}
      />
      <CommunityJoinModal
        isOpen={modal?.kind === 'join-community'}
        onClose={() => setModal(null)}
        api={api}
        onJoined={(community) => {
          setActiveCommunityId(community.id);
          switchMode('slack');
          void refresh();
        }}
      />
      <NewChannelModal
        isOpen={modal?.kind === 'new-channel'}
        onClose={() => setModal(null)}
        api={api}
        community={activeCommunity}
        sectionId={modal?.kind === 'new-channel' ? modal.sectionId : null}
        onCreated={(chatId) => void refresh().then(() => selectChat(chatId))}
      />
      <BrowseChannelsModal
        isOpen={modal?.kind === 'browse-channels'}
        onClose={() => setModal(null)}
        api={api}
        community={activeCommunity}
        onJoined={(chatId) => void refresh().then(() => selectChat(chatId))}
      />
      <InvitePeopleModal isOpen={modal?.kind === 'invite'} onClose={() => setModal(null)} api={api} community={activeCommunity} />
      <InputModal request={inputRequest} onClose={() => setInputRequest(null)} />
      <AiConnectionsModal
        isOpen={aiConnectionsOpen}
        onClose={() => setAiConnectionsOpen(false)}
        api={api}
				chats={chats}
		onSynced={refresh}
      />
      {selectedChat ? (
        <ChatDetailsDrawer
          isOpen={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          api={api}
          chat={selectedChat}
          onChanged={() => void refresh()}
          onLeft={() => selectChat(null)}
        />
      ) : null}
    </Flex>
  );
};
