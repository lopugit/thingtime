import React from 'react';
import {
  Badge,
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
  Spinner,
  Text
} from '@chakra-ui/react';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';

// Admin ownership-link manager. Two lenses over the same many-to-many links:
//   mode 'user' — everything THIS USER owns (accounts they can assume, apps
//   they co-manage), with pickers to assign more of either.
//   mode 'app' — every user linked to THIS APP as a co-manager.
// All writes go through POST /api/v1/admin/links.

type DecoratedLink = {
  linkKind: 'account' | 'app';
  userId: string;
  targetId: string;
  username: string | null;
  targetUsername: string | null;
};

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <Text fontSize="xs" fontWeight={600} textTransform="uppercase" letterSpacing="0.08em" opacity={0.45} mt={4} mb={2}>
    {children}
  </Text>
);

// Debounced search picker: searches users (admin lookup) or apps and calls
// onPick with the chosen id.
const SearchPicker = ({
  kind,
  placeholder,
  exclude,
  onPick
}: {
  kind: 'user' | 'app';
  placeholder: string;
  exclude: Set<string>;
  onPick: (id: string, label: string) => void;
}) => {
  const api = useApi();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<Array<{ id: string; label: string }>>([]);
  const [searching, setSearching] = React.useState(false);
  const apiRef = React.useRef(api);
  apiRef.current = api;

  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      const call =
        kind === 'user'
          ? apiRef.current.v1.admin.users({ q }).then((resp: any) =>
              (resp?.results ?? []).map((row: any) => ({ id: row.id, label: `@${row.username}` }))
            )
          : apiRef.current.v1.admin.apps({ q }).then((resp: any) =>
              (resp?.apps ?? []).map((row: any) => ({ id: row.clientId, label: `${row.name} (${row.clientId.slice(0, 14)}…)` }))
            );
      call
        .then((rows: Array<{ id: string; label: string }>) => setResults(rows.filter((row) => !exclude.has(row.id)).slice(0, 6)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, kind, exclude]);

  return (
    <Box>
      <Flex align="center" gap={2}>
        <Input size="sm" placeholder={placeholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        {searching && <Spinner size="xs" />}
      </Flex>
      {results.length > 0 && (
        <Box mt={1} borderWidth="1px" borderRadius="md" overflow="hidden">
          {results.map((row) => (
            <Button
              key={row.id}
              size="sm"
              variant="ghost"
              width="100%"
              justifyContent="flex-start"
              borderRadius={0}
              onClick={() => {
                onPick(row.id, row.label);
                setQuery('');
                setResults([]);
              }}
            >
              {row.label}
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );
};

export const LinkManagerModal = ({
  mode,
  subjectId,
  subjectLabel,
  isOpen,
  onClose,
  onChanged
}: {
  mode: 'user' | 'app';
  subjectId: string;
  subjectLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const api = useApi();
  const lopu = useLopu();
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [links, setLinks] = React.useState<DecoratedLink[]>([]);
  const apiRef = React.useRef(api);
  apiRef.current = api;

  const refresh = React.useCallback(() => {
    const args = mode === 'user' ? { userId: subjectId } : { targetId: subjectId, linkKind: 'app' as const };
    return apiRef.current.v1.admin
      .links(args)
      .then((resp: any) => setLinks(resp?.ok ? resp.links : []))
      .catch(() => setLinks([]));
  }, [mode, subjectId]);

  React.useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [isOpen, refresh]);

  const mutate = async (action: 'add' | 'remove', linkKind: 'account' | 'app', userId: string, targetId: string) => {
    setBusy(true);
    try {
      const resp: any = await api.v1.admin.setLink({ action, linkKind, userId, targetId });
      if (resp?.ok) {
        await refresh();
        onChanged();
      } else {
        lopu({ title: resp?.error || 'Update failed', status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Update failed', status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const accountLinks = links.filter((link) => link.linkKind === 'account');
  const appLinks = links.filter((link) => link.linkKind === 'app');
  const excludeAccounts = React.useMemo(
    () => new Set([subjectId, ...accountLinks.map((link) => link.targetId)]),
    [subjectId, accountLinks]
  );
  const excludeApps = React.useMemo(() => new Set(appLinks.map((link) => link.targetId)), [appLinks]);
  const excludeManagers = React.useMemo(() => new Set(links.map((link) => link.userId)), [links]);

  const linkRow = (label: React.ReactNode, onRemove: () => void, key: string) => (
    <Flex key={key} align="center" justify="space-between" gap={2} py={1} borderBottomWidth="1px" _last={{ borderBottomWidth: 0 }}>
      <Text fontSize="sm" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
        {label}
      </Text>
      <Button size="xs" variant="ghost" colorScheme="red" onClick={onRemove} isDisabled={busy} flexShrink={0}>
        Remove
      </Button>
    </Flex>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={3}>
        <ModalHeader pr={10}>
          {mode === 'user' ? 'Ownership' : 'Managers'} — {subjectLabel}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          {loading ? (
            <Flex justify="center" py={8}>
              <Spinner />
            </Flex>
          ) : mode === 'user' ? (
            <>
              <SectionHeading>Owned accounts ({accountLinks.length})</SectionHeading>
              {accountLinks.length === 0 && (
                <Text fontSize="xs" opacity={0.55}>
                  No accounts assigned — this user manages only their own login.
                </Text>
              )}
              {accountLinks.map((link) =>
                linkRow(
                  <>
                    @{link.targetUsername ?? link.targetId}{' '}
                    <Badge fontSize="0.6em" ml={1}>
                      assumable
                    </Badge>
                  </>,
                  () => mutate('remove', 'account', subjectId, link.targetId),
                  `account-${link.targetId}`
                )
              )}
              <Box mt={2}>
                <SearchPicker
                  kind="user"
                  placeholder="Assign an account (search username)…"
                  exclude={excludeAccounts}
                  onPick={(id) => mutate('add', 'account', subjectId, id)}
                />
              </Box>

              <SectionHeading>Co-managed apps ({appLinks.length})</SectionHeading>
              {appLinks.length === 0 && (
                <Text fontSize="xs" opacity={0.55}>
                  No apps assigned beyond the ones they registered.
                </Text>
              )}
              {appLinks.map((link) =>
                linkRow(link.targetId, () => mutate('remove', 'app', subjectId, link.targetId), `app-${link.targetId}`)
              )}
              <Box mt={2}>
                <SearchPicker
                  kind="app"
                  placeholder="Assign an app (search name or clientId)…"
                  exclude={excludeApps}
                  onPick={(id) => mutate('add', 'app', subjectId, id)}
                />
              </Box>
            </>
          ) : (
            <>
              <SectionHeading>Linked managers ({links.length})</SectionHeading>
              {links.length === 0 && (
                <Text fontSize="xs" opacity={0.55}>
                  Only the registering owner manages this app.
                </Text>
              )}
              {links.map((link) =>
                linkRow(`@${link.username ?? link.userId}`, () => mutate('remove', 'app', link.userId, subjectId), `mgr-${link.userId}`)
              )}
              <Box mt={2}>
                <SearchPicker
                  kind="user"
                  placeholder="Add a manager (search username)…"
                  exclude={excludeManagers}
                  onPick={(id) => mutate('add', 'app', id, subjectId)}
                />
              </Box>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="outline" onClick={onClose}>
            Done
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
