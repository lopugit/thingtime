import React from 'react';
import { Avatar, Badge, Box, Button, Flex, Heading, Link as ChakraLink, Stack, Text } from '@chakra-ui/react';
import { Link, useNavigate, useParams, useRouteLoaderData } from 'react-router';
import type { OwnedChatArchive } from '~/api/utils/things/chatArchiveReadTransfer';
import type { CurrentUser } from '~/hooks/useCurrentUser';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useApi } from '~/hooks/useApi';
import { rootIdentity } from '~/utils/rootIdentity';
import { customReactionEmojiId } from '~/utils/reactionTokens';
import { ThingTransferControls } from './ThingTransferControls';
import { PostAttachments } from '../Attachments/PostAttachments';

const mediaUrl = (id: string) => `/api/v1/attachments/content?id=${encodeURIComponent(id)}`;
const NAV_CLEARANCE = 'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))';
const when = (value: unknown) => new Date(String(value)).toLocaleString();
type ArchiveUser = Pick<NonNullable<CurrentUser>, 'id' | 'username' | 'displayName' | 'avatarUrl'>;

const HistoricalEmoji = ({ emoji }: { emoji: NonNullable<OwnedChatArchive['emojis']>[number] | undefined }) => {
  const [failed, setFailed] = React.useState(false);
  if (!emoji || failed) return <span>Custom emoji unavailable</span>;
  return <img src={mediaUrl(emoji.attachmentId)} alt={`:${emoji.name}:`} width={18} height={18} draggable={false}
    style={{ display: 'inline-block', verticalAlign: 'text-bottom', objectFit: 'contain', width: 18, height: 18 }}
    onError={() => setFailed(true)} />;
};

/** No live Messenger components/callbacks: historical text and identities must
 * never resolve usernames, mention people, send, react or mark messages read. */
export const ChatArchiveHistory = ({ archive, user }: { archive: OwnedChatArchive; user: ArchiveUser }) => {
  const { group } = archive;
  const people = new Map(group.participants.map(person => [person.id, person]));
  const media = new Map((archive.attachments || []).map(file => [file.id, file]));
  const emojis = new Map((archive.emojis || []).map(emoji => [emoji.id, emoji]));
  const avatar = (personId: string) => {
    const file = media.get(String(people.get(personId)?.crystal.avatarFileId));
    // Historical avatars have no reveal control: only show the canonical,
    // unflagged, correctly-bound projection. Never bypass gallery moderation
    // by requesting an avatar directly from an ID in the historical crystal.
    return file && file.targetId === personId && file.mediaKind === 'image' && !file.nsfw && !file.pending && !file.url
      ? mediaUrl(file.id) : undefined;
  };
  const byId = new Map(group.messages.map(message => [message.id, message]));
  const messages = [...group.messages].sort((a, b) => String(a.crystal.createdAt).localeCompare(String(b.crystal.createdAt)) || a.id.localeCompare(b.id));
  const label = (id: string) => id === group.self.id ? user.displayName || user.username :
    String(people.get(id)?.crystal.nickname || people.get(id)?.crystal.displayName || people.get(id)?.crystal.username || 'Archived participant');
  return <Stack spacing={5} data-testid="chat-archive-history">
    <Box as="details" borderWidth="1px" borderRadius="lg" padding={3}>
      <Box as="summary" cursor="pointer">{group.participants.length} participants · private historical snapshots</Box>
      <Stack paddingTop={3} spacing={2}>{group.participants.map(person => <Flex key={person.id} gap={2} align="center" minWidth={0}>
        <Avatar size="sm" name={label(person.id)} src={person.id === group.self.id ? user.avatarUrl || undefined : avatar(person.id)} />
        <Text overflowWrap="anywhere">{label(person.id)} · @{person.id === group.self.id ? user.username : String(person.crystal.username)}</Text>
        <Badge flexShrink={0}>{person.id === group.self.id ? 'You' : 'Archived'}</Badge>
      </Flex>)}</Stack>
    </Box>
    {!messages.length && <Text color="var(--tt-muted)">No messages in this archive.</Text>}
    {messages.map(message => {
      const author = String(message.crystal.participantId);
      const mine = author === group.self.id;
      const reply = byId.get(String(message.crystal.replyToId));
      const reactions = group.reactions.filter(row => row.targetId === message.id);
      const attachments = archive.attachmentTargets.filter(file => file.targetId === message.id);
      const gallery = message.crystal.deleted ? [] : attachments.flatMap(binding => {
        const file = media.get(binding.id);
        return file?.targetId === message.id ? [file] : [];
      });
      return <Flex key={message.id} id={`archive-message-${message.id}`} direction={mine ? 'row-reverse' : 'row'} gap={2} align="start">
        <Avatar size="sm" name={label(author)} src={mine ? user.avatarUrl || undefined : avatar(author)} />
        <Box minWidth={0} width={gallery.length ? { base: 'calc(100% - 44px)', md: '82%' } : undefined} maxWidth={{ base: 'calc(100% - 44px)', md: '82%' }}>
          <Flex wrap="wrap" gap={2} align="center" marginBottom={1} justify={mine ? 'end' : 'start'}>
            <Text fontSize="sm" fontWeight={600} overflowWrap="anywhere">{mine ? 'You' : label(author)}</Text>
            {!mine && <Badge fontSize="xs">Archived</Badge>}
            <Text as="time" dateTime={String(message.crystal.createdAt)} fontSize="xs" color="var(--tt-muted)">{when(message.crystal.createdAt)}</Text>
          </Flex>
          <Box borderRadius="18px" padding={3} background={mine ? 'var(--tt-accent, #a855f7)' : 'var(--tt-surface-alt, #f2f2f5)'} color={mine ? 'white' : 'inherit'} overflowWrap="anywhere">
            {reply && <Box borderLeftWidth="2px" paddingLeft={2} marginBottom={2} opacity={0.8}>
              <ChakraLink href={`#archive-message-${reply.id}`} fontSize="sm">Reply to {label(String(reply.crystal.participantId))}</ChakraLink>
              <Text fontSize="sm" noOfLines={2}>{reply.crystal.deleted ? 'Deleted message' : String(reply.crystal.text)}</Text>
            </Box>}
            <Text whiteSpace="pre-wrap" fontStyle={message.crystal.deleted ? 'italic' : undefined}>{message.crystal.deleted ? 'Deleted message' : String(message.crystal.text)}</Text>
            {message.crystal.systemText && <Text fontSize="sm" whiteSpace="pre-wrap">{String(message.crystal.systemText)}</Text>}
            {message.crystal.editedAt && <Text fontSize="xs" marginTop={1}>Edited {when(message.crystal.editedAt)}</Text>}
            {gallery.length > 0 && <Box marginTop={2} data-testid={`archive-gallery-${message.id}`}><PostAttachments attachments={gallery} compact ariaLabel="Historical attachments" /></Box>}
            {attachments.length > gallery.length && <Text fontSize="sm" marginTop={2}>Some historical attachments are unavailable.</Text>}
          </Box>
          {reactions.length > 0 && <Flex gap={1} wrap="wrap" paddingTop={1} aria-label="Historical reactions">
            {reactions.map(reaction => <Box key={reaction.id} as="span" borderWidth="1px" borderRadius="full" paddingX={2} fontSize="sm" title={`${label(String(reaction.crystal.participantId))} · historical reaction`}>
              {customReactionEmojiId(String(reaction.crystal.emoji))
                ? <HistoricalEmoji key={emojis.get(customReactionEmojiId(String(reaction.crystal.emoji))!)?.attachmentId || 'unavailable'} emoji={emojis.get(customReactionEmojiId(String(reaction.crystal.emoji))!)} />
                : String(reaction.crystal.emoji)}
            </Box>)}
          </Flex>}
        </Box>
      </Flex>;
    })}
    <Text textAlign="center" fontSize="sm" color="var(--tt-muted)">End of archive · no messages will be sent</Text>
  </Stack>;
};

export const ChatArchivePage = () => {
  const { id = '' } = useParams();
  const user = useCurrentUser();
  const root = useRouteLoaderData('root') as { clientIdentityGeneration?: number } | undefined;
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  if (!user || user.accountKind !== 'user') return <Box width="100%" minWidth={0} paddingTop={NAV_CLEARANCE}><Box padding={6}><Text>Sign in to view your private archive.</Text><Button as={Link} to="/login">Sign in</Button></Box></Box>;
  if (identity.pending || identity.generation !== (root?.clientIdentityGeneration ?? 0)) return null;
  return <Box width="100%" minWidth={0} paddingTop={NAV_CLEARANCE}><OwnedArchivePage key={`${user.id}:${id}:${identity.generation}`} id={id} user={user} /></Box>;
};

const OwnedArchivePage = ({ id, user }: { id: string; user: ArchiveUser }) => {
  const api = useApi(); const navigate = useNavigate();
  const apiRef = React.useRef(api); apiRef.current = api;
  const [archive, setArchive] = React.useState<OwnedChatArchive | null>(null);
  const [error, setError] = React.useState(''); const [retry, setRetry] = React.useState(0);
  const [deleting, setDeleting] = React.useState(false);
  const active = React.useRef(true);
  React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  React.useEffect(() => {
    const controller = new AbortController(); setError('');
    void apiRef.current.v1.things.archive({ id }, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (!result?.ok || result.archive?.group?.root?.id !== id) throw new Error(result?.error || 'Archive unavailable');
      setArchive(result.archive);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Archive unavailable'); });
    return () => controller.abort();
  }, [id, retry]);
  const remove = async () => {
    if (!archive || deleting || !window.confirm('Delete this private archive and its attachments? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const result = await apiRef.current.v1.things.remove({ id, expectedUpdatedAt: archive.updatedAt });
      if (!active.current) return;
      if (!result?.ok) throw new Error(result?.error || 'Could not delete archive');
      navigate('/things');
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Could not delete archive'); }
    finally { if (active.current) setDeleting(false); }
  };
  return <Box maxWidth="800px" width="100%" marginX="auto" padding={{ base: 3, md: 6 }} paddingBottom={12}>
    <ChakraLink as={Link} to="/things">← Back to Things</ChakraLink>
    <Flex gap={3} wrap="wrap" align="center" justify="space-between" marginY={4}>
      <Box minWidth={0}><Heading size="md" overflowWrap="anywhere">{String(archive?.group.root.crystal.name || 'Chat archive')}</Heading><Badge marginTop={2}>Private archive · read only</Badge></Box>
      {archive && <Flex gap={2}><ThingTransferControls id={id} canCut /><Button size="xs" variant="outline" onClick={() => { void remove(); }} isDisabled={deleting}>Delete archive</Button></Flex>}
    </Flex>
    {archive?.group.root.crystal.topic && <Text marginBottom={4} whiteSpace="pre-wrap" overflowWrap="anywhere">{String(archive.group.root.crystal.topic)}</Text>}
    {error && <Box role="alert" borderWidth="1px" borderRadius="lg" padding={3} marginBottom={4}><Text overflowWrap="anywhere">{error}</Text><Button size="sm" onClick={() => setRetry(value => value + 1)}>Retry</Button></Box>}
    {archive ? <ChatArchiveHistory archive={archive} user={user} /> : !error && <Text role="status">Opening private history…</Text>}
  </Box>;
};
