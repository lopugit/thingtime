import React from 'react';
import {
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Textarea
} from '@chakra-ui/react';

import { useLopu } from '../Lopu/useLopu';
import type { Community, CommunityChannel } from './messengerTypes';
import type { MessengerApi } from './useMessengerApi';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

const shell = (children: React.ReactNode) => children;

const TtModal = ({
  isOpen,
  onClose,
  title,
  children,
  footer
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) => (
  <Modal isOpen={isOpen} onClose={onClose} isCentered>
    <ModalOverlay zIndex={10240} />
    <ModalContent
      containerProps={{ zIndex: 10250 }}
      background="var(--tt-card, #ffffff)"
      color="var(--tt-ink, #17171c)"
      borderRadius="var(--tt-radius-lg, 16px)"
      marginX={4}
    >
      <ModalHeader fontSize="16px">{title}</ModalHeader>
      <ModalCloseButton />
      <ModalBody>{children}</ModalBody>
      {footer ? <ModalFooter gap={2}>{footer}</ModalFooter> : null}
    </ModalContent>
  </Modal>
);

const primaryButton = (label: string, onClick: () => void, opts: { loading?: boolean; disabled?: boolean } = {}) => (
  <Button
    size="sm"
    onClick={onClick}
    isLoading={opts.loading}
    isDisabled={opts.disabled}
    background="var(--tt-accent, #a855f7)"
    color="white"
    _hover={{ opacity: 0.9 }}
    borderRadius="var(--tt-radius-pill, 999px)"
  >
    {label}
  </Button>
);

// ── tiny themed prompt (the house has no window.prompt — same family as the
// banned alert(); this one respects the theme vars and the z ladder) ──

export type InputModalRequest = {
  title: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  maxLength?: number;
  onSubmit: (value: string) => void;
};

export const InputModal = ({ request, onClose }: { request: InputModalRequest | null; onClose: () => void }) => {
  const [value, setValue] = React.useState('');
  React.useEffect(() => {
    setValue(request?.initial || '');
  }, [request]);
  const submit = () => {
    if (!request || !value.trim()) return;
    request.onSubmit(value.trim());
    onClose();
  };
  return (
    <TtModal
      isOpen={!!request}
      onClose={onClose}
      title={request?.title || ''}
      footer={shell(primaryButton(request?.submitLabel || 'Save', submit, { disabled: !value.trim() }))}
    >
      <Input
        size="sm"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={request?.placeholder}
        maxLength={request?.maxLength || 80}
        onKeyDown={(event) => event.key === 'Enter' && submit()}
        borderRadius="var(--tt-radius-md, 10px)"
      />
    </TtModal>
  );
};

// ── new DM / new group ──

export const NewChatModal = ({
  isOpen,
  onClose,
  api,
  groupOnly,
  onCreated
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  groupOnly?: boolean;
  onCreated: (chatId: string) => void;
}) => {
  const lopu = useLopu();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<
    Array<{ id: string; username: string; displayName: string | null; temporary?: boolean }>
  >([]);
  const [picked, setPicked] = React.useState<
    Array<{ id: string; username: string; displayName: string | null; temporary?: boolean }>
  >([]);
  const [groupName, setGroupName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.searchUsers(q).then((payload: any) => setResults(payload.users || [])).catch(() => {});
    }, 200);
    return () => window.clearTimeout(timer);
  }, [api, query]);

  const reset = () => {
    setQuery('');
    setResults([]);
    setPicked([]);
    setGroupName('');
    setBusy(false);
  };

  const create = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    const isGroup = groupOnly || picked.length > 1;
    try {
      const payload = await api.createChat({
        chatType: isGroup ? 'group' : 'dm',
        memberIds: picked.map((p) => p.id),
        ...(isGroup && groupName.trim() ? { name: groupName.trim() } : {})
      });
      if (payload.existing) lopu({ title: 'You two already have a chat — opening it 💬', status: 'info', duration: 5000 });
      reset();
      onClose();
      onCreated(payload.chat.id);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not start the chat 😞', status: 'error' });
      setBusy(false);
    }
  };

  return (
    <TtModal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      title={groupOnly ? 'New group' : 'New message'}
      footer={shell(primaryButton(groupOnly || picked.length > 1 ? 'Create group 👥' : 'Start chat 💬', create, { loading: busy, disabled: !picked.length }))}
    >
      <Flex direction="column" gap={2}>
        {picked.length ? (
          <Flex wrap="wrap" gap={1}>
            {picked.map((person) => (
              <Button key={person.id} size="xs" variant="outline" borderRadius="var(--tt-radius-pill, 999px)" onClick={() => setPicked((prev) => prev.filter((p) => p.id !== person.id))}>
                {getUserDisplayName(person)} ✕
              </Button>
            ))}
          </Flex>
        ) : null}
        <Input
          size="sm"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people…"
          borderRadius="var(--tt-radius-md, 10px)"
        />
        {results
          .filter((person) => !picked.some((p) => p.id === person.id))
          .map((person) => (
            <Flex key={person.id} align="center" justify="space-between" fontSize="13px">
              <Box>
                {getUserDisplayName(person)}{' '}
                <Box as="span" color="var(--tt-muted, #9a9aa6)" fontSize="11px">
                  {getUserIdentityDetail(person)}
                </Box>
              </Box>
              <Button size="xs" onClick={() => setPicked((prev) => [...prev, person])}>
                Add
              </Button>
            </Flex>
          ))}
        {(groupOnly || picked.length > 1) && (
          <Input
            size="sm"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Group name (optional)"
            maxLength={80}
            borderRadius="var(--tt-radius-md, 10px)"
          />
        )}
      </Flex>
    </TtModal>
  );
};

// ── community create / join ──

export const CommunityCreateModal = ({
  isOpen,
  onClose,
  api,
  onCreated
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  onCreated: (community: Community) => void;
}) => {
  const lopu = useLopu();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const payload = await api.createCommunity({ name: name.trim(), description: description.trim() || undefined });
      lopu({ title: `${payload.community.name} is alive 🏗️✨`, status: 'success', duration: 6000 });
      setName('');
      setDescription('');
      setBusy(false);
      onClose();
      onCreated({ ...payload.community, sections: [] });
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not create the community 😞', status: 'error' });
      setBusy(false);
    }
  };

  return (
    <TtModal isOpen={isOpen} onClose={onClose} title="Create a community" footer={shell(primaryButton('Create 🏗️', create, { loading: busy, disabled: !name.trim() }))}>
      <Flex direction="column" gap={2}>
        <Input size="sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Community name" maxLength={80} borderRadius="var(--tt-radius-md, 10px)" />
        <Textarea size="sm" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is it about? (optional)" maxLength={500} rows={3} borderRadius="var(--tt-radius-md, 10px)" />
      </Flex>
    </TtModal>
  );
};

export const CommunityJoinModal = ({
  isOpen,
  onClose,
  api,
  onJoined
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  onJoined: (community: Community) => void;
}) => {
  const lopu = useLopu();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const join = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const payload = await api.joinCommunity({ code: code.trim() });
      lopu({ title: `Welcome to ${payload.community.name} 🎉`, status: 'success', duration: 6000 });
      setCode('');
      setBusy(false);
      onClose();
      onJoined({ ...payload.community, sections: [] });
    } catch (err: any) {
      lopu({ title: err?.error || 'That code did not work 😞', status: 'error' });
      setBusy(false);
    }
  };

  return (
    <TtModal isOpen={isOpen} onClose={onClose} title="Join a community" footer={shell(primaryButton('Join 🎟️', join, { loading: busy, disabled: !code.trim() }))}>
      <Input size="sm" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste an invite code (tt-…)" onKeyDown={(e) => e.key === 'Enter' && join()} borderRadius="var(--tt-radius-md, 10px)" />
    </TtModal>
  );
};

// ── invite people ──

export const InvitePeopleModal = ({
  isOpen,
  onClose,
  api,
  community
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  community: Community | null;
}) => {
  const lopu = useLopu();
  const [invite, setInvite] = React.useState<{ code: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const isAdmin = community?.myRole === 'owner' || community?.myRole === 'admin';

  const mint = async () => {
    if (!community || busy) return;
    setBusy(true);
    try {
      const payload = await api.createInvite({ communityId: community.id, expiresInDays: 30 });
      setInvite(payload.invite);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not mint an invite 😞', status: 'error' });
    }
    setBusy(false);
  };

  React.useEffect(() => {
    if (isOpen) setInvite(null);
  }, [isOpen]);

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      lopu({ title: 'Invite code copied 📋', status: 'success', duration: 4000 });
    } catch {
      // clipboard can be denied; the code is visible to copy by hand
    }
  };

  return (
    <TtModal isOpen={isOpen} onClose={onClose} title={`Invite people to ${community?.name || 'the community'}`}>
      {!isAdmin ? (
        <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal" paddingBottom={4}>
          Only community admins can mint invites — ask one of yours 💌
        </Box>
      ) : invite ? (
        <Flex direction="column" gap={2} paddingBottom={4}>
          <Box fontSize="13px" whiteSpace="normal">
            Share this code — it lasts 30 days:
          </Box>
          <Flex gap={2}>
            <Input size="sm" isReadOnly value={invite.code} fontFamily="var(--tt-font-mono, monospace)" />
            <Button size="sm" onClick={copy}>
              Copy
            </Button>
          </Flex>
          <Box fontSize="12px" color="var(--tt-muted, #9a9aa6)" whiteSpace="normal">
            They redeem it in Messages → Spaces → ➕ → Join with invite code.
          </Box>
        </Flex>
      ) : (
        <Flex justify="center" paddingBottom={4}>
          {primaryButton('Mint an invite code 💌', mint, { loading: busy })}
        </Flex>
      )}
    </TtModal>
  );
};

// ── new channel + browse channels ──

export const NewChannelModal = ({
  isOpen,
  onClose,
  api,
  community,
  sectionId,
  onCreated
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  community: Community | null;
  sectionId: string | null;
  onCreated: (chatId: string) => void;
}) => {
  const lopu = useLopu();
  const [name, setName] = React.useState('');
  const [topic, setTopic] = React.useState('');
  const [isPrivate, setIsPrivate] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    if (!community || !name.trim() || busy) return;
    setBusy(true);
    try {
      const payload = await api.createChat({
        chatType: 'channel',
        communityId: community.id,
        name: name.trim(),
        topic: topic.trim() || undefined,
        channelVisibility: isPrivate ? 'private' : 'public',
        ...(sectionId ? { sectionId } : {})
      });
      setName('');
      setTopic('');
      setBusy(false);
      onClose();
      onCreated(payload.chat.id);
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not create the channel 😞', status: 'error' });
      setBusy(false);
    }
  };

  return (
    <TtModal isOpen={isOpen} onClose={onClose} title={`New channel in ${community?.name || '…'}`} footer={shell(primaryButton('Create channel #', create, { loading: busy, disabled: !name.trim() }))}>
      <Flex direction="column" gap={2}>
        <Input size="sm" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="channel-name" maxLength={80} borderRadius="var(--tt-radius-md, 10px)" />
        <Input size="sm" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)" maxLength={250} borderRadius="var(--tt-radius-md, 10px)" />
        <Button size="xs" variant="ghost" alignSelf="flex-start" onClick={() => setIsPrivate((v) => !v)}>
          {isPrivate ? '🔒 Private — admins add people' : '🌐 Public — any community member can join'}
        </Button>
      </Flex>
    </TtModal>
  );
};

export const BrowseChannelsModal = ({
  isOpen,
  onClose,
  api,
  community,
  onJoined
}: {
  isOpen: boolean;
  onClose: () => void;
  api: MessengerApi;
  community: Community | null;
  onJoined: (chatId: string) => void;
}) => {
  const lopu = useLopu();
  const [channels, setChannels] = React.useState<CommunityChannel[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen || !community) return;
    setLoading(true);
    api
      .getCommunity(community.id)
      .then((payload: any) => setChannels(payload.channels || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api, community, isOpen]);

  const join = async (channel: CommunityChannel) => {
    try {
      await api.members({ chatId: channel.id, join: true });
      lopu({ title: `Joined #${channel.name} 🎉`, status: 'success', duration: 5000 });
      onJoined(channel.id);
      onClose();
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not join 😞', status: 'error' });
    }
  };

  return (
    <TtModal isOpen={isOpen} onClose={onClose} title={`Channels in ${community?.name || '…'}`}>
      <Flex direction="column" gap={1} paddingBottom={4}>
        {loading ? (
          <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)">
            Looking around…
          </Box>
        ) : null}
        {channels.map((channel) => (
          <Flex key={channel.id} align="center" justify="space-between" paddingY="6px" gap={2}>
            <Box minWidth={0}>
              <Box fontSize="13.5px" fontWeight={600} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                #{channel.name} {channel.channelVisibility === 'private' ? '🔒' : ''}
              </Box>
              <Box fontSize="11px" color="var(--tt-muted, #9a9aa6)">
                {channel.memberCount} member{channel.memberCount === 1 ? '' : 's'}
                {channel.topic ? ` · ${channel.topic}` : ''}
              </Box>
            </Box>
            {channel.joined ? (
              <Button size="xs" variant="ghost" onClick={() => { onJoined(channel.id); onClose(); }}>
                Open
              </Button>
            ) : (
              <Button size="xs" onClick={() => join(channel)}>
                Join
              </Button>
            )}
          </Flex>
        ))}
        {!loading && !channels.length ? (
          <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)">
            No channels yet.
          </Box>
        ) : null}
      </Flex>
    </TtModal>
  );
};
