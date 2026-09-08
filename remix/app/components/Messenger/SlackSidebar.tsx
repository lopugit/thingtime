import React from 'react';
import { Box, Button, Flex, Menu, MenuButton, MenuItem, MenuList, Portal } from '@chakra-ui/react';

import { chatDisplayName, isLopuAiSource, type ChatSummary, type Community } from './messengerTypes';

const UnreadBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <Box
      as="span"
      background="var(--tt-accent, #a855f7)"
      color="white"
      fontSize="10px"
      fontWeight={700}
      borderRadius="var(--tt-radius-pill, 999px)"
      paddingX="6px"
      paddingY="1px"
      flexShrink={0}
    >
      {count > 99 ? '99+' : count}
    </Box>
  ) : null;

const RowButton = ({
  active,
  unread,
  onClick,
  onContextAction,
  contextActions,
  children
}: {
  active: boolean;
  unread: number;
  onClick: () => void;
  onContextAction?: (action: string) => void;
  contextActions?: { id: string; label: string }[];
  children: React.ReactNode;
}) => {
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <Flex
        as="button"
        onClick={onClick}
        onContextMenu={
          contextActions?.length
            ? (event: React.MouseEvent) => {
                event.preventDefault();
                setMenuPos({ x: event.clientX, y: event.clientY });
              }
            : undefined
        }
        align="center"
        gap={2}
        width="100%"
        textAlign="left"
        paddingX={2}
        paddingY="5px"
        borderRadius="var(--tt-radius-md, 10px)"
        background={active ? 'var(--tt-surface-alt, #f2f2f5)' : 'transparent'}
        _hover={{ background: 'var(--tt-surface-hover, #f7f7f9)' }}
        fontSize="13.5px"
        fontWeight={unread > 0 ? 700 : 500}
        color={unread > 0 ? 'var(--tt-ink, #17171c)' : 'var(--tt-text, #3f3f46)'}
        minWidth={0}
      >
        <Box flex={1} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
          {children}
        </Box>
        <UnreadBadge count={unread} />
      </Flex>
      {menuPos && contextActions?.length ? (
        <Portal>
          <Box position="fixed" inset={0} zIndex={10259} onClick={() => setMenuPos(null)} onContextMenu={(e) => e.preventDefault()}>
            <Box
              position="fixed"
              left={`${Math.min(menuPos.x, (typeof window !== 'undefined' ? window.innerWidth : 999) - 180)}px`}
              top={`${menuPos.y}px`}
              zIndex={10260}
              background="var(--tt-card, #ffffff)"
              border="1px solid var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-md, 10px)"
              boxShadow="var(--tt-shadow-popover, 0 8px 30px rgba(0,0,0,0.12))"
              paddingY={1}
              minWidth="160px"
            >
              {contextActions.map((action) => (
                <Box
                  key={action.id}
                  as="button"
                  display="block"
                  width="100%"
                  textAlign="left"
                  paddingX={3}
                  paddingY="6px"
                  fontSize="13px"
                  _hover={{ background: 'var(--tt-surface-hover, #f7f7f9)' }}
                  onClick={() => {
                    setMenuPos(null);
                    onContextAction?.(action.id);
                  }}
                >
                  {action.label}
                </Box>
              ))}
            </Box>
          </Box>
        </Portal>
      ) : null}
    </>
  );
};

export type SlackSidebarProps = {
  communities: Community[];
  activeCommunityId: string | null;
  onSelectCommunity: (id: string) => void;
  chats: ChatSummary[];
  viewerId: string | null;
  selectedChatId: string | null;
  onSelectChat: (chat: ChatSummary) => void;
  onCreateCommunity: () => void;
  onJoinCommunity: () => void;
  onCreateChannel: (sectionId?: string | null) => void;
  onBrowseChannels: () => void;
  onInvitePeople: () => void;
  onCommunitySettings: () => void;
  onRenameChat: (chat: ChatSummary) => void;
  onCreateSection: () => void;
  onRenameSection: (sectionId: string, name: string) => void;
  onNewDm: () => void;
};

// Slack-mode sidebar: community switcher rail at the top, then the active
// community's sections with their channels, then DMs/groups shared with
// messenger mode. Channels support right-click rename; sections rename via
// their own context menu.
export const SlackSidebar = (props: SlackSidebarProps) => {
  const active = props.communities.find((c) => c.id === props.activeCommunityId) || props.communities[0] || null;
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  const channels = props.chats.filter((c) => c.chatType === 'channel' && c.communityId === active?.id);
  const dms = props.chats.filter((c) => c.chatType !== 'channel');
  const isAdmin = !active?.externalSource && (active?.myRole === 'owner' || active?.myRole === 'admin');

  const sectionsWithChannels: { id: string | null; name: string; channels: ChatSummary[] }[] = React.useMemo(() => {
    const sections = active?.sections || [];
    const bySection = new Map<string | null, ChatSummary[]>();
    for (const channel of channels) {
      const key = channel.sectionId && sections.some((s) => s.id === channel.sectionId) ? channel.sectionId : null;
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key)!.push(channel);
    }
    const out: { id: string | null; name: string; channels: ChatSummary[] }[] = sections.map((s) => ({
      id: s.id,
      name: s.name,
      channels: bySection.get(s.id) || []
    }));
    out.push({ id: null, name: 'Channels', channels: bySection.get(null) || [] });
    return out;
  }, [active?.sections, channels]);

  return (
    <Flex direction="column" height="100%" minHeight={0}>
      {/* community switcher */}
      <Flex align="center" gap={1} padding={2} borderBottom="1px solid var(--tt-border-light, #f3f3f5)" overflowX="auto">
        {props.communities.map((community) => (
          <Button
            key={community.id}
            size="sm"
            variant="ghost"
            onClick={() => props.onSelectCommunity(community.id)}
            background={community.id === active?.id ? 'var(--tt-accent-tint, #f3e8ff)' : 'var(--tt-surface-alt, #f2f2f5)'}
            boxShadow={community.id === active?.id ? 'inset 0 0 0 1.5px var(--tt-accent, #a855f7)' : 'none'}
            borderRadius="var(--tt-radius-md, 10px)"
            fontWeight={700}
            fontSize="12px"
            flexShrink={0}
            title={community.name}
          >
            {community.name.slice(0, 2).toUpperCase()}
          </Button>
        ))}
        <Menu isLazy placement="bottom-start">
          <MenuButton
            as={Button}
            size="sm"
            variant="ghost"
            borderRadius="var(--tt-radius-md, 10px)"
            border="1px dashed var(--tt-border, #ececef)"
            color="var(--tt-muted, #9a9aa6)"
            flexShrink={0}
          >
            +
          </MenuButton>
          <Portal>
            <MenuList zIndex={10260} fontSize="13px">
              <MenuItem onClick={props.onCreateCommunity}>🏗️ Create a community</MenuItem>
              <MenuItem onClick={props.onJoinCommunity}>🎟️ Join with invite code</MenuItem>
            </MenuList>
          </Portal>
        </Menu>
      </Flex>

      <Box flex={1} overflowY="auto" padding={2}>
        {active ? (
          <>
            <Flex align="center" justify="space-between" paddingX={1} marginBottom={1}>
              <Box fontWeight={800} fontSize="14px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                {active.name}
              </Box>
              <Menu isLazy placement="bottom-end">
                <MenuButton as={Button} size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)">
                  ⚙️
                </MenuButton>
                <Portal>
                  <MenuList zIndex={10260} fontSize="13px">
                    {active.externalSource ? (
                      <MenuItem isDisabled>✦ Managed by {active.externalSource.label}</MenuItem>
                    ) : (
                      <>
                        <MenuItem onClick={props.onInvitePeople}>💌 Invite people</MenuItem>
                        <MenuItem onClick={props.onBrowseChannels}>🔭 Browse channels</MenuItem>
                      </>
                    )}
                    {isAdmin ? <MenuItem onClick={props.onCreateSection}>📁 New section</MenuItem> : null}
                    {isAdmin ? <MenuItem onClick={props.onCommunitySettings}>🛠️ Community settings</MenuItem> : null}
                  </MenuList>
                </Portal>
              </Menu>
            </Flex>

            {sectionsWithChannels.map((section) => (
              <Box key={section.id || 'root'} marginBottom={2}>
                <Flex align="center" paddingX={1}>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [section.id || 'root']: !prev[section.id || 'root'] }))}
                    color="var(--tt-muted, #9a9aa6)"
                    fontSize="11px"
                    fontWeight={700}
                    textTransform="uppercase"
                    letterSpacing="0.04em"
                    paddingX={1}
                  >
                    {collapsed[section.id || 'root'] ? '▸' : '▾'} {section.name}
                  </Button>
                  {isAdmin && section.id ? (
                    <Menu isLazy placement="bottom-start">
                      <MenuButton as={Button} size="xs" variant="ghost" color="var(--tt-faint, #b9b9c3)" marginLeft="auto">
                        ⋯
                      </MenuButton>
                      <Portal>
                        <MenuList zIndex={10260} fontSize="13px">
                          <MenuItem onClick={() => props.onRenameSection(section.id!, section.name)}>
                            ✏️ Rename section
                          </MenuItem>
                          <MenuItem onClick={() => props.onCreateChannel(section.id)}>➕ Add channel here</MenuItem>
                        </MenuList>
                      </Portal>
                    </Menu>
                  ) : null}
                </Flex>
                {!collapsed[section.id || 'root']
                  ? section.channels.map((chat) => (
                      <RowButton
                        key={chat.id}
                        active={chat.id === props.selectedChatId}
                        unread={chat.unreadCount}
                        onClick={() => props.onSelectChat(chat)}
                        contextActions={chat.externalSource ? [] : [{ id: 'rename', label: '✏️ Rename channel' }]}
                        onContextAction={
                          chat.externalSource
                            ? undefined
                            : (action) => {
                                if (action === 'rename') props.onRenameChat(chat);
                              }
                        }
                      >
                        <Box as="span" color="var(--tt-muted, #9a9aa6)" marginRight={1}>
                          #
                        </Box>
                        {chat.name}
                      </RowButton>
                    ))
                  : null}
              </Box>
            ))}
            {!active.externalSource ? (
              <Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" onClick={() => props.onCreateChannel(null)}>
                ➕ Add channel
              </Button>
            ) : null}
          </>
        ) : (
          <Box padding={3} fontSize="13px" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
            No communities yet. Create one to unlock channels, sections, invites and custom emojis ✨
            <Flex direction="column" gap={2} marginTop={3}>
              <Button size="sm" onClick={props.onCreateCommunity} background="var(--tt-accent, #a855f7)" color="white" _hover={{ opacity: 0.9 }}>
                Create a community
              </Button>
              <Button size="sm" variant="outline" onClick={props.onJoinCommunity}>
                Join with invite code
              </Button>
            </Flex>
          </Box>
        )}

        <Box marginTop={3}>
          <Flex align="center" justify="space-between" paddingX={1}>
            <Box fontSize="11px" fontWeight={700} textTransform="uppercase" letterSpacing="0.04em" color="var(--tt-muted, #9a9aa6)">
              Direct messages
            </Box>
            <Button size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)" onClick={props.onNewDm} title="New message">
              ➕
            </Button>
          </Flex>
          {dms.map((chat) => (
            <RowButton
              key={chat.id}
              active={chat.id === props.selectedChatId}
              unread={chat.unreadCount}
              onClick={() => props.onSelectChat(chat)}
            >
              {isLopuAiSource(chat.externalSource) ? '🦄 ' : chat.chatType === 'group' ? '👥 ' : ''}
              {chatDisplayName(chat, props.viewerId)}
            </RowButton>
          ))}
        </Box>
      </Box>
    </Flex>
  );
};
