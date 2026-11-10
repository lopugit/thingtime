import React from 'react';
import { Box, Button, Flex, Image, Input } from '@chakra-ui/react';

import { timeAgo } from '../Feed/feedTypes';
import { chatDisplayName, externalSourceAvatar, memberDisplayName, type ChatSummary, type MessengerProfile } from './messengerTypes';
import type { MessengerApi } from './useMessengerApi';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

const StackedAvatars = ({ chat, viewerId }: { chat: ChatSummary; viewerId: string | null }) => {
  if (chat.externalSource) {
    // ChatGPT/Claude keep their brand discs; Lopu is the unicorn on a rainbow disc
    const look = externalSourceAvatar(chat.externalSource);
    return (
      <Flex
        width="42px"
        height="42px"
        borderRadius="full"
        align="center"
        justify="center"
        background={look.background}
        color={look.color}
        fontSize="20px"
        fontWeight={700}
        flexShrink={0}
        title={chat.externalSource.label}
      >
        {look.glyph}
      </Flex>
    );
  }
  const others = (chat.members || []).filter((m) => m.userId !== viewerId);
  const shown = others.slice(0, 2);
  if (!shown.length) {
    return (
			<Flex
				width="42px"
				height="42px"
				borderRadius="full"
				align="center"
				justify="center"
				background="var(--tt-surface-alt, #f2f2f5)"
				fontSize="18px"
				flexShrink={0}
			>
        {chat.chatType === 'channel' ? '#' : '💬'}
      </Flex>
    );
  }
  const avatar = (profile: MessengerProfile | null, size: number, offset?: boolean) => {
    const letter = profile ? getUserDisplayName(profile).slice(0, 1).toUpperCase() : '?';
    const common: any = {
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: 'full',
      border: offset ? '2px solid var(--tt-card, #ffffff)' : undefined,
      flexShrink: 0
    };
    return profile?.avatarUrl ? (
      <Image src={profile.avatarUrl} alt={letter} objectFit="cover" {...common} />
    ) : (
      <Flex
        align="center"
        justify="center"
        background="var(--tt-gradient-rainbow, linear-gradient(135deg, #f59e0b, #ec4899, #8b5cf6))"
        color="white"
        fontWeight={700}
        fontSize={`${Math.round(size * 0.42)}px`}
        {...common}
      >
        {letter}
      </Flex>
    );
  };
  if (shown.length === 1) return <Box flexShrink={0}>{avatar(shown[0].profile, 42)}</Box>;
  return (
    <Box position="relative" width="42px" height="42px" flexShrink={0}>
      <Box position="absolute" top={0} left={0}>
        {avatar(shown[0].profile, 30)}
      </Box>
      <Box position="absolute" bottom={0} right={0}>
        {avatar(shown[1].profile, 30, true)}
      </Box>
    </Box>
  );
};

export type InboxSidebarProps = {
  api: MessengerApi;
  chats: ChatSummary[];
  viewerId: string | null;
  selectedChatId: string | null;
  requestsCount: number;
  onSelectChat: (chat: ChatSummary) => void;
  onOpenRequests: () => void;
  onNewGroup: () => void;
  onStartDm: (user: { id: string; username: string }) => void;
};

// Messenger-mode inbox: search-to-DM typeahead, the requests folder, then
// conversations newest-first with unread emphasis — the FB Messenger shape.
export const InboxSidebar = (props: InboxSidebarProps) => {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<
    Array<{ id: string; username: string; displayName: string | null; temporary?: boolean; avatarUrl: string | null }>
  >([]);
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++seqRef.current;
    const timer = window.setTimeout(() => {
      props.api
        .searchUsers(q)
        .then((payload: any) => {
          if (seq === seqRef.current) setResults(payload.users || []);
        })
        .catch(() => {});
    }, 200);
    return () => window.clearTimeout(timer);
  }, [props.api, query]);

  const conversations = props.chats.filter((c) => c.chatType !== 'channel');

  return (
    <Flex direction="column" height="100%" minHeight={0}>
      <Flex direction="column" gap={2} padding={3} paddingBottom={2}>
        <Flex align="center" justify="space-between">
          <Box fontWeight={800} fontSize="16px">
            Chats
          </Box>
          <Button size="sm" variant="ghost" onClick={props.onNewGroup} title="New group">
            👥➕
          </Button>
        </Flex>
        <Input
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people to message…"
          borderRadius="var(--tt-radius-pill, 999px)"
          background="var(--tt-surface, #fafafa)"
        />
      </Flex>

      {results.length ? (
        <Box paddingX={2} paddingBottom={2} borderBottom="1px solid var(--tt-border-light, #f3f3f5)">
          {results.map((person) => (
            <Flex
              key={person.id}
              as="button"
              width="100%"
              textAlign="left"
              align="center"
              gap={2}
              paddingX={2}
              paddingY="6px"
              borderRadius="var(--tt-radius-md, 10px)"
              _hover={{ background: 'var(--tt-surface-hover, #f7f7f9)' }}
              onClick={() => {
                setQuery('');
                setResults([]);
                props.onStartDm(person);
              }}
            >
							<Flex
								width="28px"
								height="28px"
								borderRadius="full"
								align="center"
								justify="center"
								background="var(--tt-surface-alt, #f2f2f5)"
								overflow="hidden"
								flexShrink={0}
							>
								{person.avatarUrl ? (
									<Image src={person.avatarUrl} width="28px" height="28px" objectFit="cover" />
								) : (
									getUserDisplayName(person).slice(0, 1).toUpperCase()
								)}
              </Flex>
              <Box fontSize="13px">
                <Box fontWeight={600}>{getUserDisplayName(person)}</Box>
                <Box color="var(--tt-muted, #9a9aa6)" fontSize="11px">
                  {getUserIdentityDetail(person)}
                </Box>
              </Box>
            </Flex>
          ))}
        </Box>
      ) : null}

      <Box flex={1} overflowY="auto" paddingX={2} paddingBottom={2}>
        <Flex
          as="button"
          width="100%"
          textAlign="left"
          align="center"
          gap={2}
          paddingX={2}
          paddingY="8px"
          borderRadius="var(--tt-radius-md, 10px)"
          _hover={{ background: 'var(--tt-surface-hover, #f7f7f9)' }}
          onClick={props.onOpenRequests}
        >
					<Flex
						width="42px"
						height="42px"
						borderRadius="full"
						align="center"
						justify="center"
						background="var(--tt-surface-alt, #f2f2f5)"
						fontSize="18px"
						flexShrink={0}
					>
            💌
          </Flex>
          <Box flex={1} fontSize="13.5px" fontWeight={600}>
            Message requests
          </Box>
          {props.requestsCount > 0 ? (
						<Box
							background="var(--tt-accent, #a855f7)"
							color="white"
							fontSize="10px"
							fontWeight={700}
							borderRadius="var(--tt-radius-pill, 999px)"
							paddingX="6px"
							paddingY="1px"
						>
              {props.requestsCount}
            </Box>
          ) : null}
        </Flex>

        {conversations.map((chat) => {
          const unread = chat.unreadCount > 0;
          const last = chat.lastMessage;
          const lastAuthor =
            last?.externalSource?.role === 'user'
              ? 'You'
              : last?.externalSource
                ? last.externalSource.authorName || last.externalSource.label
                : last && last.authorId === props.viewerId
                  ? 'You'
              : last
                ? memberDisplayName((chat.members || []).find((m) => m.userId === last.authorId)) || last.authorName || ''
                : '';
          const preview = last
            ? last.deleted
              ? 'Message deleted'
              : last.systemType
                ? '· activity ·'
							: `${lastAuthor ? `${lastAuthor}: ` : ''}${last.text || (last.attachmentCount ? '📎 Attachment' : '…')}`
            : 'Say hi 👋';
          return (
            <Flex
              key={chat.id}
              as="button"
              width="100%"
              textAlign="left"
              align="center"
              gap={2}
              paddingX={2}
              paddingY="8px"
              borderRadius="var(--tt-radius-md, 10px)"
              background={chat.id === props.selectedChatId ? 'var(--tt-surface-alt, #f2f2f5)' : 'transparent'}
              _hover={{ background: 'var(--tt-surface-hover, #f7f7f9)' }}
              onClick={() => props.onSelectChat(chat)}
              minWidth={0}
            >
              <StackedAvatars chat={chat} viewerId={props.viewerId} />
              <Box flex={1} minWidth={0}>
                <Flex align="baseline" gap={2}>
									<Box fontSize="13.5px" fontWeight={unread ? 800 : 600} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" flex={1}>
                    {chat.chatType === 'group' && !chat.name ? '👥 ' : ''}
                    {chatDisplayName(chat, props.viewerId)}
                  </Box>
                  {last ? (
                    <Box fontSize="10px" color="var(--tt-faint, #b9b9c3)" flexShrink={0}>
                      {timeAgo(last.createdAt)}
                    </Box>
                  ) : null}
                </Flex>
                <Flex align="center" gap={1}>
                  <Box
                    fontSize="12px"
                    color={unread ? 'var(--tt-ink, #17171c)' : 'var(--tt-muted, #9a9aa6)'}
                    fontWeight={unread ? 600 : 400}
                    overflow="hidden"
                    textOverflow="ellipsis"
                    whiteSpace="nowrap"
                    flex={1}
                  >
                    {chat.myMember?.muted ? '🔕 ' : ''}
                    {preview}
                  </Box>
                  {unread ? <Box width="8px" height="8px" borderRadius="full" background="var(--tt-accent, #a855f7)" flexShrink={0} /> : null}
                </Flex>
              </Box>
            </Flex>
          );
        })}
        {!conversations.length ? (
          <Box padding={4} fontSize="13px" color="var(--tt-muted, #9a9aa6)" textAlign="center" whiteSpace="normal">
            No conversations yet — search for someone above to start one 💬
          </Box>
        ) : null}
      </Box>
    </Flex>
  );
};
