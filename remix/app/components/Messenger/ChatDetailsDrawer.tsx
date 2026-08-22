import React from 'react';
import {
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Image,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Portal,
  Switch
} from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import { DRAWER_MODAL_OVERLAY_Z, DRAWER_MODAL_Z } from '~/components/Nav/Drawer/useDrawer';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { chatDisplayName, memberDisplayName, type ChatMember, type ChatSummary } from './messengerTypes';
import type { MessengerApi } from './useMessengerApi';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

// The conversation's control room: rename (groups: anyone, channels: admins),
// member roster with roles/promote/demote/remove, Messenger-style nicknames
// (anyone can nickname anyone), add people, mute, read-receipts privacy and
// leave. All verbs call the members endpoint and refresh from its response.
export const ChatDetailsDrawer = ({
  isOpen,
  onClose,
  api,
  chat,
  onChanged,
  onLeft
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  chat: ChatSummary;
  onChanged: () => void;
  onLeft: () => void;
}) => {
  const user = useCurrentUser();
  const lopu = useLopu();
  const [members, setMembers] = React.useState<ChatMember[]>(chat.members || []);
  const [name, setName] = React.useState(chat.name || '');
  const [readReceipts, setReadReceipts] = React.useState(true);
  const [addQuery, setAddQuery] = React.useState('');
  const [addResults, setAddResults] = React.useState<
    Array<{ id: string; username: string; displayName: string | null; temporary?: boolean }>
  >([]);
  const [nicknameFor, setNicknameFor] = React.useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = React.useState('');

  const myMember = members.find((m) => m.userId === user?.id) || null;
  const iAmAdmin = myMember?.role === 'owner' || myMember?.role === 'admin';
  const canRename = chat.chatType === 'group' || (chat.chatType === 'channel' && iAmAdmin);
  const canAdd = chat.chatType !== 'dm';

  React.useEffect(() => {
    if (!isOpen) return;
    setName(chat.name || '');
    api
      .getChat(chat.id)
      .then((payload: any) => setMembers(payload.members || []))
      .catch(() => {});
    api
      .settings()
      .then((payload: any) => setReadReceipts(payload.readReceipts !== false))
      .catch(() => {});
  }, [api, chat.id, chat.name, isOpen]);

  React.useEffect(() => {
    const q = addQuery.trim();
    if (q.length < 2) {
      setAddResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.searchUsers(q).then((payload: any) => setAddResults(payload.users || [])).catch(() => {});
    }, 200);
    return () => window.clearTimeout(timer);
  }, [addQuery, api]);

  const run = async (body: Record<string, unknown>, successNote?: string) => {
    try {
      const payload = await api.members({ chatId: chat.id, ...body });
      setMembers(payload.members || []);
      onChanged();
      if (successNote) lopu({ title: successNote, status: 'success', duration: 5000 });
      return true;
    } catch (err: any) {
      lopu({ title: err?.error || 'That did not work 😞', status: 'error' });
      return false;
    }
  };

  const saveName = async () => {
    if (!canRename || name.trim() === (chat.name || '')) return;
    try {
      await api.updateChat({ id: chat.id, name: name.trim() });
      onChanged();
      lopu({ title: 'Renamed ✨', status: 'success', duration: 4000 });
    } catch (err: any) {
      lopu({ title: err?.error || 'Rename failed 😞', status: 'error' });
      setName(chat.name || '');
    }
  };

  const saveReceipts = async (enabled: boolean) => {
    setReadReceipts(enabled);
    try {
      await api.saveSettings({ readReceipts: enabled });
      lopu({
        title: enabled ? 'Read receipts on — seen means seen 👀' : 'Read receipts off — you stop sharing and seeing them 🕶️',
        status: 'info',
        duration: 6000
      });
    } catch (err: any) {
      setReadReceipts(!enabled);
      lopu({ title: err?.error || 'Setting did not save 😞', status: 'error' });
    }
  };

  const leave = async () => {
    try {
      await api.leaveChat({ chatId: chat.id });
      onChanged();
      onClose();
      onLeft();
    } catch (err: any) {
      lopu({ title: err?.error || 'Leaving failed 😞', status: 'error' });
    }
  };

  const activeMembers = members.filter((m) => m.state === 'active' || m.state === 'pending');

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="sm">
      <DrawerOverlay zIndex={DRAWER_MODAL_OVERLAY_Z} />
      <DrawerContent
        background="var(--tt-card, #ffffff)"
        color="var(--tt-ink, #17171c)"
        containerProps={{ zIndex: DRAWER_MODAL_Z }}
      >
        <DrawerCloseButton />
        <DrawerHeader fontSize="15px">{chatDisplayName({ ...chat, members }, user?.id || null)}</DrawerHeader>
        <DrawerBody paddingBottom={8}>
          {canRename ? (
            <Box marginBottom={4}>
              <Box fontSize="11px" fontWeight={700} textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
                {chat.chatType === 'channel' ? 'Channel name' : 'Group name'}
              </Box>
              <Flex gap={2}>
                <Input
                  size="sm"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && saveName()}
                  placeholder={chat.chatType === 'channel' ? 'channel-name' : 'Name this group…'}
                  borderRadius="var(--tt-radius-md, 10px)"
                />
                <Button size="sm" onClick={saveName} isDisabled={name.trim() === (chat.name || '')}>
                  Save
                </Button>
              </Flex>
            </Box>
          ) : null}

          <Flex align="center" justify="space-between" marginBottom={2}>
            <Box fontSize="13px">🔕 Mute this chat</Box>
            <Switch isChecked={!!myMember?.muted} onChange={(event) => run({ mute: event.target.checked })} />
          </Flex>
          <Flex align="center" justify="space-between" marginBottom={4} title="Applies to all your chats. Off = you neither share nor see read receipts.">
            <Box fontSize="13px">👀 Read receipts (all chats)</Box>
            <Switch isChecked={readReceipts} onChange={(event) => saveReceipts(event.target.checked)} />
          </Flex>

          <Box fontSize="11px" fontWeight={700} textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={2}>
            {activeMembers.length} member{activeMembers.length === 1 ? '' : 's'}
          </Box>
          {activeMembers.map((member) => {
            const isSelf = member.userId === user?.id;
            const displayName = memberDisplayName(member);
            return (
              <Flex key={member.userId} align="center" gap={2} paddingY="6px">
                <Flex width="30px" height="30px" borderRadius="full" overflow="hidden" align="center" justify="center" background="var(--tt-surface-alt, #f2f2f5)" fontSize="13px" fontWeight={700} flexShrink={0}>
                  {member.profile?.avatarUrl ? (
                    <Image src={member.profile.avatarUrl} width="30px" height="30px" objectFit="cover" />
                  ) : (
                    displayName.slice(0, 1).toUpperCase()
                  )}
                </Flex>
                <Box flex={1} minWidth={0}>
                  <Flex align="center" gap={1}>
                    <Box fontSize="13px" fontWeight={600} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                      {displayName}
                      {isSelf ? ' (you)' : ''}
                    </Box>
                    {member.role !== 'member' ? (
                      <Box fontSize="10px" fontWeight={700} color="var(--tt-accent, #a855f7)" background="var(--tt-accent-tint, #f3e8ff)" borderRadius="var(--tt-radius-pill, 999px)" paddingX="6px">
                        {member.role}
                      </Box>
                    ) : null}
                    {member.state === 'pending' ? (
                      <Box fontSize="10px" color="var(--tt-muted, #9a9aa6)">
                        · invited
                      </Box>
                    ) : null}
                  </Flex>
                  <Box fontSize="11px" color="var(--tt-muted, #9a9aa6)" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {member.profile ? getUserIdentityDetail(member.profile) : '@ghost'}
                    {member.nickname ? ` · “${member.nickname}”` : ''}
                  </Box>
                </Box>
                <Menu isLazy placement="bottom-end">
                  <MenuButton as={Button} size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)">
                    ⋯
                  </MenuButton>
                  <Portal>
                    <MenuList zIndex={10260} fontSize="13px">
                      <MenuItem
                        onClick={() => {
                          setNicknameFor(member.userId);
                          setNicknameDraft(member.nickname || '');
                        }}
                      >
                        🏷️ Set nickname
                      </MenuItem>
                      {iAmAdmin && !isSelf && member.role === 'member' ? (
                        <MenuItem onClick={() => run({ role: { userId: member.userId, role: 'admin' } }, `${displayName} is now an admin 👑`)}>
                          👑 Make admin
                        </MenuItem>
                      ) : null}
                      {iAmAdmin && !isSelf && member.role === 'admin' ? (
                        <MenuItem onClick={() => run({ role: { userId: member.userId, role: 'member' } })}>🧢 Remove admin</MenuItem>
                      ) : null}
                      {iAmAdmin && !isSelf && member.role !== 'owner' ? (
                        <MenuItem color="var(--tt-danger, #e5484d)" onClick={() => run({ remove: member.userId })}>
                          🚪 Remove from chat
                        </MenuItem>
                      ) : null}
                    </MenuList>
                  </Portal>
                </Menu>
              </Flex>
            );
          })}

          {nicknameFor ? (
            <Flex gap={2} marginTop={2} align="center">
              <Input
                size="sm"
                autoFocus
                value={nicknameDraft}
                onChange={(event) => setNicknameDraft(event.target.value)}
                placeholder="Nickname (empty clears)"
                maxLength={40}
                borderRadius="var(--tt-radius-md, 10px)"
                onKeyDown={async (event) => {
                  if (event.key === 'Enter') {
                    const okRun = await run({ nickname: { userId: nicknameFor, nickname: nicknameDraft.trim() || null } });
                    if (okRun) setNicknameFor(null);
                  }
                  if (event.key === 'Escape') setNicknameFor(null);
                }}
              />
              <Button
                size="sm"
                onClick={async () => {
                  const okRun = await run({ nickname: { userId: nicknameFor, nickname: nicknameDraft.trim() || null } });
                  if (okRun) setNicknameFor(null);
                }}
              >
                Save
              </Button>
            </Flex>
          ) : null}

          {canAdd ? (
            <Box marginTop={4}>
              <Box fontSize="11px" fontWeight={700} textTransform="uppercase" color="var(--tt-muted, #9a9aa6)" marginBottom={1}>
                Add people
              </Box>
              <Input
                size="sm"
                value={addQuery}
                onChange={(event) => setAddQuery(event.target.value)}
                placeholder="Search by name…"
                borderRadius="var(--tt-radius-md, 10px)"
              />
              {addResults.map((person) => (
                <Flex key={person.id} align="center" justify="space-between" paddingY="4px" fontSize="13px">
                  <Box>
                    {getUserDisplayName(person)}{' '}
                    <Box as="span" color="var(--tt-muted, #9a9aa6)" fontSize="11px">
                      {getUserIdentityDetail(person)}
                    </Box>
                  </Box>
                  <Button
                    size="xs"
                    onClick={async () => {
                      const okRun = await run({ add: [person.id] }, `${getUserDisplayName(person)} added ✨`);
                      if (okRun) {
                        setAddQuery('');
                        setAddResults([]);
                      }
                    }}
                  >
                    Add
                  </Button>
                </Flex>
              ))}
            </Box>
          ) : null}

          {chat.chatType !== 'dm' ? (
            <Button
              size="sm"
              variant="outline"
              color="var(--tt-danger, #e5484d)"
              borderColor="var(--tt-danger, #e5484d)"
              marginTop={6}
              width="100%"
              onClick={leave}
            >
              🚪 Leave {chat.chatType === 'channel' ? 'channel' : 'group'}
            </Button>
          ) : null}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};
