import React from 'react';
import {
  Avatar,
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Text
} from '@chakra-ui/react';

import { useApi } from '~/hooks/useApi';
import { useLopu } from '~/components/Lopu/useLopu';

// The custom-audience picker 🎭 — composes a tt:custom acl visually: a
// baseline (who may READ in general), hand-picked users and groups with
// per-entry capabilities (read / comment / write), searchable against the
// whole user base, prefilled from the caller's social context (recents,
// friends, connections), and able to save the current selection as a
// reusable group or grant an existing one.

type MiniUser = { id: string; username: string; displayName?: string | null; avatarUrl?: string | null };
type MiniGroup = { id: string; name: string; memberCount?: number };
type Cap = 'read' | 'comment' | 'write';
type Baseline = 'private' | 'hidden' | 'public';

type Selected<T> = T & { cap: Cap };

const CAP_OPTIONS: Array<{ id: Cap; label: string }> = [
  { id: 'read', label: '👁️ Read' },
  { id: 'comment', label: '💬 Comment' },
  { id: 'write', label: '✏️ Edit' }
];

const BASELINES: Array<{ id: Baseline; label: string; hint: string }> = [
  { id: 'private', label: '🔒 Only these people', hint: 'Nobody outside your picks can even see it' },
  { id: 'hidden', label: '🕵️ + secret link', hint: 'Anyone holding its hidden link can also view' },
  { id: 'public', label: '🌐 + everyone', hint: 'Everyone can view — your picks get extra powers' }
];

const MUTED = 'var(--tt-muted, #9a9aa6)';
const BORDER = '1px solid var(--tt-border, #ececef)';

const capSuffix = (cap: Cap): string => (cap === 'read' ? '' : `/${cap}`);

// parse an existing custom acl back into picker state (unknown groups keep
// their id as the display name until sources load)
export const parseCustomAcl = (
  acl: readonly string[] | undefined
): { baseline: Baseline; users: Array<{ username: string; cap: Cap }>; groups: Array<{ id: string; cap: Cap }> } => {
  const users: Array<{ username: string; cap: Cap }> = [];
  const groups: Array<{ id: string; cap: Cap }> = [];
  let baseline: Baseline = 'private';
  for (const raw of acl || []) {
    if (raw.startsWith('-')) continue;
    if (raw === 'tt:all') baseline = 'public';
    if (raw === 'tt:hidden') baseline = 'hidden';
    // Mirror of registry.ts splitCapability: a '/write' or '/comment' tail is
    // a capability only when a non-empty subject remains under it. Stripping
    // unconditionally would swallow the whole subject of the account named
    // "write" (tt:user/write → ''), silently dropping that person from the
    // picker every time the audience is reopened.
    const split = (entry: string, prefix: string): { subject: string; cap: Cap } => {
      for (const [suffix, cap] of [
        ['/write', 'write'],
        ['/comment', 'comment']
      ] as const) {
        if (!entry.endsWith(suffix)) continue;
        const subject = entry.slice(prefix.length, -suffix.length);
        if (subject) return { subject, cap };
      }
      return { subject: entry.slice(prefix.length), cap: 'read' };
    };
    if (raw.startsWith('tt:user/')) {
      const { subject: username, cap } = split(raw, 'tt:user/');
      if (username) users.push({ username, cap });
    }
    if (raw.startsWith('tt:group/')) {
      const { subject: id, cap } = split(raw, 'tt:group/');
      if (id) groups.push({ id, cap });
    }
  }
  return { baseline, users, groups };
};

export const composeCustomAcl = (
  baseline: Baseline,
  users: ReadonlyArray<{ username: string; cap: Cap }>,
  groups: ReadonlyArray<{ id: string; cap: Cap }>
): string[] => [
  'tt:custom',
  'tt:user',
  ...(baseline === 'public' ? ['tt:all'] : baseline === 'hidden' ? ['tt:hidden'] : []),
  ...users.map((entry) => `tt:user/${entry.username}${capSuffix(entry.cap)}`),
  ...groups.map((entry) => `tt:group/${entry.id}${capSuffix(entry.cap)}`)
];

export const CustomAudienceModal = (props: {
  isOpen: boolean;
  onClose: () => void;
  initialAcl?: readonly string[];
  onApply: (acl: string[]) => void;
}) => {
  const api = useApi();
  const lopu = useLopu();

  const [baseline, setBaseline] = React.useState<Baseline>('private');
  const [users, setUsers] = React.useState<Selected<MiniUser>[]>([]);
  const [groups, setGroups] = React.useState<Selected<MiniGroup>[]>([]);
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<MiniUser[]>([]);
  const [sources, setSources] = React.useState<{ recents: MiniUser[]; friends: MiniUser[]; connections: MiniUser[]; groups: MiniGroup[] }>({
    recents: [],
    friends: [],
    connections: [],
    groups: []
  });
  const [groupName, setGroupName] = React.useState('');
  const [savingGroup, setSavingGroup] = React.useState(false);

  // (re)seed from the incoming acl each open
  React.useEffect(() => {
    if (!props.isOpen) return;
    const parsed = parseCustomAcl(props.initialAcl);
    setBaseline(parsed.baseline);
    setUsers(parsed.users.map((entry) => ({ id: entry.username, username: entry.username, cap: entry.cap })));
    setGroups(parsed.groups.map((entry) => ({ id: entry.id, name: entry.id, cap: entry.cap })));
    setQuery('');
    setResults([]);
    api.v1.groups
      .audienceSources()
      .then((resp: any) => {
        if (!resp?.ok) return;
        setSources({ recents: resp.recents || [], friends: resp.friends || [], connections: resp.connections || [], groups: resp.groups || [] });
        // resolve group display names for prefilled group grants
        setGroups((prev) =>
          prev.map((entry) => ({ ...entry, name: (resp.groups || []).find((g: MiniGroup) => g.id === entry.id)?.name || entry.name }))
        );
        // …and the same for people: an acl only carries usernames, so seeded
        // entries start with id === username, which is NOT a real user id.
        // Matching them against the social context recovers the true id (plus
        // avatar and display name for the chips) — without it "save selection
        // as group" silently drops every reopened pick, since group membership
        // is stored by user id.
        const known: MiniUser[] = [...(resp.recents || []), ...(resp.friends || []), ...(resp.connections || [])];
        setUsers((prev) =>
          prev.map((entry) => {
            if (entry.id !== entry.username) return entry;
            const match = known.find((user) => (user.username || '').toLowerCase() === entry.username.toLowerCase());
            return match ? { ...match, cap: entry.cap } : entry;
          })
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isOpen]);

  // people search — debounced, merged with the prefilled sections
  React.useEffect(() => {
    if (!props.isOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      api.v1.profile
        .search({ q, limit: 8 })
        .then((resp: any) => setResults(resp?.users || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, props.isOpen]);

  const selectedUsernames = new Set(users.map((entry) => entry.username.toLowerCase()));
  const selectedGroupIds = new Set(groups.map((entry) => entry.id));

  const addUser = (user: MiniUser) => {
    if (!user?.username || selectedUsernames.has(user.username.toLowerCase())) return;
    setUsers((prev) => [...prev, { ...user, cap: 'read' }]);
  };
  const addGroup = (group: MiniGroup) => {
    if (!group?.id || selectedGroupIds.has(group.id)) return;
    setGroups((prev) => [...prev, { ...group, cap: 'read' }]);
  };

  const filterByQuery = (list: MiniUser[]): MiniUser[] => {
    const q = query.trim().toLowerCase();
    const unpicked = list.filter((user) => !selectedUsernames.has((user.username || '').toLowerCase()));
    if (!q) return unpicked.slice(0, 8);
    return unpicked
      .filter((user) => (user.username || '').toLowerCase().includes(q) || (user.displayName || '').toLowerCase().includes(q))
      .slice(0, 8);
  };

  const userChip = (user: MiniUser) => (
    <Button key={user.id || user.username} size="xs" variant="outline" onClick={() => addUser(user)} title={`Add @${user.username}`}>
      <Avatar size="2xs" name={user.displayName || user.username} src={user.avatarUrl || undefined} marginRight={1} />
      {user.displayName || user.username}
    </Button>
  );

  const section = (label: string, list: MiniUser[]) => {
    const filtered = filterByQuery(list);
    if (!filtered.length) return null;
    return (
      <Box key={label}>
        <Text fontSize="xs" fontWeight={600} color={MUTED} marginBottom={1}>
          {label}
        </Text>
        <Flex columnGap={1} rowGap={1} flexWrap="wrap">
          {filtered.map(userChip)}
        </Flex>
      </Box>
    );
  };

  const handleCreateGroup = async () => {
    const name = groupName.trim();
    if (!name) {
      lopu({ title: 'Name the group first 🏷️', status: 'error' });
      return;
    }
    // Group membership is stored by user id, but an acl only carries
    // usernames, so entries seeded from an existing audience arrive with
    // id === username until the audience-sources backfill above resolves
    // them. Anyone still unresolved has no id to store — saving anyway would
    // mint a group quietly missing them (and, if every pick came from the
    // acl, an EMPTY group) while the toast below reported success. Say so
    // instead: the picker still shows them, so the mismatch would be
    // invisible otherwise.
    const resolved = users.filter((entry) => entry.id && entry.id !== entry.username);
    const unresolved = users.filter((entry) => !entry.id || entry.id === entry.username);
    if (unresolved.length) {
      lopu({
        title: 'Re-pick these people first 🔎',
        description: `${unresolved.map((entry) => `@${entry.username}`).join(', ')} came from the saved audience — search for them above and add them again so the group can store who they are.`,
        status: 'error'
      });
      return;
    }
    const memberIds = resolved.map((entry) => entry.id);
    setSavingGroup(true);
    try {
      const resp = await api.v1.groups.create({ name, memberIds });
      if (resp?.group) {
        setSources((prev) => ({ ...prev, groups: [resp.group, ...prev.groups] }));
        addGroup(resp.group);
        setGroupName('');
        lopu({ title: `Group “${resp.group.name}” saved 👥`, description: 'Reuse it on any thing — edits to the group follow everywhere.', status: 'success' });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not create that group 😔', status: 'error' });
    } finally {
      setSavingGroup(false);
    }
  };

  const apply = () => {
    props.onApply(
      composeCustomAcl(
        baseline,
        users.map((entry) => ({ username: entry.username, cap: entry.cap })),
        groups.map((entry) => ({ id: entry.id, cap: entry.cap }))
      )
    );
    props.onClose();
  };

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent borderRadius="var(--tt-radius-md, 12px)">
        <ModalHeader fontSize="md">Custom audience 🎭</ModalHeader>
        <ModalBody>
          <Flex flexDirection="column" rowGap={4}>
            {/* baseline: who can READ in general */}
            <Box>
              <Text fontSize="xs" fontWeight={600} color={MUTED} marginBottom={1}>
                Everyone else…
              </Text>
              <Flex columnGap={1} rowGap={1} flexWrap="wrap">
                {BASELINES.map((option) => (
                  <Button
                    key={option.id}
                    size="xs"
                    variant={baseline === option.id ? 'solid' : 'outline'}
                    title={option.hint}
                    onClick={() => setBaseline(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </Flex>
              <Text fontSize="xs" color={MUTED} marginTop={1}>
                {BASELINES.find((option) => option.id === baseline)?.hint}
              </Text>
            </Box>

            {/* search + prefilled sections */}
            <Box>
              <Input
                size="sm"
                value={query}
                placeholder="Search people, or filter the lists below 🔍"
                onChange={(event) => setQuery(event.target.value)}
              />
              <Flex flexDirection="column" rowGap={2} marginTop={2}>
                {query.trim().length >= 2 && results.length > 0 && section('Search results', results)}
                {section('Recently interacted', sources.recents)}
                {section('Friends', sources.friends)}
                {section('Connections', sources.connections)}
              </Flex>
            </Box>

            {/* groups */}
            <Box>
              <Text fontSize="xs" fontWeight={600} color={MUTED} marginBottom={1}>
                Groups 👥
              </Text>
              <Flex columnGap={1} rowGap={1} flexWrap="wrap">
                {sources.groups
                  .filter((group) => !selectedGroupIds.has(group.id))
                  .map((group) => (
                    <Button key={group.id} size="xs" variant="outline" onClick={() => addGroup(group)}>
                      👥 {group.name}
                      {typeof group.memberCount === 'number' ? ` · ${group.memberCount}` : ''}
                    </Button>
                  ))}
                <Input
                  size="xs"
                  width="150px"
                  value={groupName}
                  placeholder="New group name…"
                  onChange={(event) => setGroupName(event.target.value)}
                />
                <Button size="xs" variant="ghost" isLoading={savingGroup} onClick={handleCreateGroup} isDisabled={!users.length}>
                  Save selection as group ➕
                </Button>
              </Flex>
            </Box>

            {/* the selection, with per-entry capabilities */}
            <Box borderTop={BORDER} paddingTop={2}>
              <Text fontSize="xs" fontWeight={600} color={MUTED} marginBottom={1}>
                Who gets what ⚖️
              </Text>
              {users.length === 0 && groups.length === 0 ? (
                <Text fontSize="xs" color={MUTED}>
                  Nobody picked yet — with “Only these people”, that means only you.
                </Text>
              ) : (
                <Flex flexDirection="column" rowGap={1}>
                  {groups.map((entry) => (
                    <Flex key={`g-${entry.id}`} alignItems="center" columnGap={2}>
                      <Text fontSize="sm" noOfLines={1}>
                        👥 {entry.name}
                      </Text>
                      <Select
                        size="xs"
                        width="120px"
                        marginLeft="auto"
                        value={entry.cap}
                        onChange={(event) =>
                          setGroups((prev) => prev.map((g) => (g.id === entry.id ? { ...g, cap: event.target.value as Cap } : g)))
                        }
                      >
                        {CAP_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                      <Button size="xs" variant="ghost" onClick={() => setGroups((prev) => prev.filter((g) => g.id !== entry.id))}>
                        ✕
                      </Button>
                    </Flex>
                  ))}
                  {users.map((entry) => (
                    <Flex key={`u-${entry.username}`} alignItems="center" columnGap={2}>
                      <Avatar size="2xs" name={entry.displayName || entry.username} src={entry.avatarUrl || undefined} />
                      <Text fontSize="sm" noOfLines={1}>
                        {entry.displayName || entry.username}{' '}
                        <Box as="span" color={MUTED}>
                          @{entry.username}
                        </Box>
                      </Text>
                      <Select
                        size="xs"
                        width="120px"
                        marginLeft="auto"
                        value={entry.cap}
                        onChange={(event) =>
                          setUsers((prev) => prev.map((u) => (u.username === entry.username ? { ...u, cap: event.target.value as Cap } : u)))
                        }
                      >
                        {CAP_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                      <Button size="xs" variant="ghost" onClick={() => setUsers((prev) => prev.filter((u) => u.username !== entry.username))}>
                        ✕
                      </Button>
                    </Flex>
                  ))}
                </Flex>
              )}
              <Text fontSize="11px" color={MUTED} marginTop={2} whiteSpace="normal">
                Read = can view · Comment = can also react &amp; comment · Edit = can also change the content (never the audience).
              </Text>
            </Box>
          </Flex>
        </ModalBody>
        <ModalFooter columnGap={2}>
          <Button size="sm" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="solid" onClick={apply}>
            Use this audience 🎭
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
