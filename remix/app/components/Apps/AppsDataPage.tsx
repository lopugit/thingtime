import React from 'react';
import { Badge, Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router';

import { formatBytes } from './ConnectedAppsSection';
import type { AppDataRow } from './ConnectedAppsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';

// /apps — browse everything each connected app stores in your account.
// Left: the app roster (from things, so orphaned data stays visible).
// Right: the selected app's entries (Stored data), or the app's own view of
// its shared slice (App view — the same lens the app reads through, built
// from your live grant). Everything an app stores is YOURS: per-entry delete
// and namespace-wide delete-all live here.

type PublicThingWire = {
  id: string;
  thingtime: string[];
  author: { id: string; username: string } | null;
  visibility: string;
  acl: string[];
  targetId: string | null;
  crystal: Record<string, unknown>;
  extended: unknown;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

const EntryCard = ({
  thing,
  mine,
  onDelete,
  deleting
}: {
  thing: PublicThingWire;
  mine: boolean;
  onDelete?: (id: string) => void;
  deleting?: boolean;
}) => {
  const preview = React.useMemo(() => {
    try {
      return JSON.stringify(thing.crystal, null, 2);
    } catch {
      return String(thing.crystal);
    }
  }, [thing.crystal]);
  // the session-side projection derives first-party visibility ('private')
  // for app-audience acls — the acl itself is the truth here
  const audience =
    thing.visibility === 'app' || (Array.isArray(thing.acl) && thing.acl.some((entry) => entry.startsWith('tt:app/')))
      ? 'shared with app users'
      : thing.visibility;
  return (
    <Box borderWidth="1px" borderRadius="md" p={3} mb={3}>
      <Flex alignItems="center" gap={2} flexWrap="wrap" mb={2}>
        {thing.thingtime.map((id) => (
          <Badge key={id} fontSize="0.65em">
            {id}
          </Badge>
        ))}
        <Badge fontSize="0.65em" variant="outline">
          {audience}
        </Badge>
        {thing.author && !mine && (
          <Text fontSize="xs" opacity={0.7}>
            by @{thing.author.username}
          </Text>
        )}
        <Text fontSize="xs" opacity={0.55} ml="auto">
          {new Date(thing.updatedAt).toLocaleString()}
        </Text>
      </Flex>
      <Box
        as="pre"
        fontSize="xs"
        fontFamily="mono"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        maxHeight="14em"
        overflowY="auto"
        opacity={0.85}
      >
        {preview}
      </Box>
      {mine && onDelete && (
        <Flex justifyContent="flex-end" mt={2}>
          <Button size="xs" variant="outline" isDisabled={deleting} onClick={() => onDelete(thing.id)}>
            Delete 🗑️
          </Button>
        </Flex>
      )}
    </Box>
  );
};

export const AppsDataPage = () => {
  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const selected = (params.get('app') || '').trim() || null;

  const cacheKey = user ? `tt-app-data-${user.id}` : null;
  const [apps, setApps] = React.useState<AppDataRow[]>(() =>
    cacheKey ? (readLocalCache<AppDataRow[]>(cacheKey) ?? []) : []
  );
  const [appsLoaded, setAppsLoaded] = React.useState(false);

  const [tab, setTab] = React.useState<'stored' | 'appview'>('stored');
  const [entries, setEntries] = React.useState<PublicThingWire[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [entriesLoading, setEntriesLoading] = React.useState(false);
  const [appViewError, setAppViewError] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = React.useState(false);

  // depend on the LEAF callbacks (stable useCallbacks) — the api wrapper
  // object itself is rebuilt every render and would loop the effects
  const summaryApi = api.v1.apps.dataSummary;
  const listApi = api.v1.things.list;
  const sharedApi = api.v1.apps.dataShared;
  const refreshApps = React.useCallback(async () => {
    if (!user) return;
    try {
      const result = await summaryApi();
      if (result?.ok) {
        setApps(result.apps || []);
        if (cacheKey) writeLocalCache(cacheKey, result.apps || []);
      }
    } catch {
      // keep last-known
    } finally {
      setAppsLoaded(true);
    }
  }, [summaryApi, user, cacheKey]);

  React.useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  const loadEntries = React.useCallback(
    async (appId: string, mode: 'stored' | 'appview', cursor: string | null) => {
      setEntriesLoading(true);
      setAppViewError(null);
      try {
        const result =
          mode === 'stored'
            ? await listApi({ appId, cursor: cursor || undefined })
            : await sharedApi({ appId, cursor: cursor || undefined });
        if (result?.ok) {
          setEntries((current) => (cursor ? [...current, ...(result.things || [])] : result.things || []));
          setNextCursor(result.nextCursor || null);
        } else if (mode === 'appview') {
          setEntries([]);
          setNextCursor(null);
          setAppViewError(result?.error || 'The app view is unavailable');
        }
      } catch {
        if (!cursor) setEntries([]);
      } finally {
        setEntriesLoading(false);
      }
    },
    [listApi, sharedApi]
  );

  React.useEffect(() => {
    if (!selected || !user) return;
    setEntries([]);
    setNextCursor(null);
    setConfirmWipe(false);
    loadEntries(selected, tab, null);
  }, [selected, tab, user, loadEntries]);

  const deleteEntry = async (id: string) => {
    if (!selected) return;
    setDeletingId(id);
    const previous = entries;
    setEntries((current) => current.filter((entry) => entry.id !== id)); // optimistic
    try {
      const result = await api.v1.things.remove({ id });
      if (result?.ok === false) throw new Error(result?.error || 'Delete failed');
      lopu({ title: 'Entry deleted', status: 'success', duration: 4000 });
      refreshApps();
    } catch (err: any) {
      setEntries(previous);
      lopu({ title: 'Couldn’t delete', description: String(err?.message || err), status: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const wipeApp = async () => {
    if (!selected) return;
    if (!confirmWipe) {
      setConfirmWipe(true);
      return;
    }
    setConfirmWipe(false);
    try {
      const result = await api.v1.apps.dataDeleteAll({ appId: selected });
      if (result?.ok === false) throw new Error(result?.error || 'Delete failed');
      lopu({
        title: 'All app data deleted',
        description: `${result?.deleted ?? 0} things removed. The app can start fresh if you sign in again.`,
        status: 'success'
      });
      setEntries([]);
      refreshApps();
    } catch (err: any) {
      lopu({ title: 'Couldn’t delete', description: String(err?.message || err), status: 'error' });
    }
  };

  // same shell as /settings: full-width, centered column, cleared below the
  // fixed nav
  const pageShell = {
    justifyContent: 'center',
    width: '100%',
    minHeight: '100vh',
    paddingTop: 'calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))'
  } as const;

  if (!user) {
    return (
      <Flex {...pageShell}>
        <Box textAlign="center" maxWidth="30em" px={4} py={10}>
          <Heading size="md" mb={2}>
            App data 📦
          </Heading>
          <Text opacity={0.7} mb={4}>
            Sign in to browse everything your connected apps store in your Thingtime.
          </Text>
          <Button size="sm" onClick={() => navigate('/login')}>
            Log in 🗝️
          </Button>
        </Box>
      </Flex>
    );
  }

  const selectedRow = apps.find((app) => app.appId === selected) || null;

  return (
    <Flex {...pageShell}>
      <Flex
        width="100%"
        maxWidth="60em"
        flexDirection={{ base: 'column', md: 'row' }}
        gap={6}
        alignItems="flex-start"
        px={4}
        py={6}
        pb={12}
      >
        <Box width={{ base: '100%', md: '18em' }} flexShrink={0}>
          <Heading size="md" mb={1}>
            App data 📦
          </Heading>
          <Text fontSize="sm" opacity={0.7} mb={4}>
            Everything your connected apps store in your account — yours to browse and delete.
          </Text>
          {apps.length === 0 && (
            <Text fontSize="sm" opacity={0.7}>
              {appsLoaded ? 'No app has stored anything yet.' : ' '}
            </Text>
          )}
          {apps.map((app) => (
            <Box
              key={app.appId}
              borderWidth="1px"
              borderRadius="md"
              p={3}
              mb={2}
              cursor="pointer"
              borderColor={selected === app.appId ? 'purple.400' : undefined}
              onClick={() => setParams({ app: app.appId })}
            >
              <Flex alignItems="center" gap={2}>
                <Text fontWeight="bold" fontSize="sm">
                  {app.appName || 'Deleted app'}
                </Text>
                {!app.appName && <Badge fontSize="0.6em">orphaned</Badge>}
              </Flex>
              <Text fontSize="xs" opacity={0.65}>
                {app.entryCount} {app.entryCount === 1 ? 'entry' : 'entries'} · {formatBytes(app.usedBytes)} of{' '}
                {app.budgetBytes === null ? 'unlimited' : formatBytes(app.budgetBytes)}
              </Text>
            </Box>
          ))}
        </Box>

        <Box flex={1} width="100%">
          {!selected && (
            <Text fontSize="sm" opacity={0.7} py={6}>
              Pick an app to see what it has stored for you.
            </Text>
          )}
          {selected && (
            <>
              <Flex alignItems="center" gap={2} mb={4} flexWrap="wrap">
                <Heading size="sm">{selectedRow?.appName || selected}</Heading>
                <Flex gap={1} ml="auto">
                  <Button size="xs" variant={tab === 'stored' ? 'solid' : 'outline'} onClick={() => setTab('stored')}>
                    Stored data
                  </Button>
                  <Button size="xs" variant={tab === 'appview' ? 'solid' : 'outline'} onClick={() => setTab('appview')}>
                    App view 👓
                  </Button>
                </Flex>
              </Flex>

              {tab === 'appview' && (
                <Text fontSize="xs" opacity={0.65} mb={3}>
                  Exactly what this app can see right now, through your own grant — your entries plus anything other
                  users of the app shared with its circle.
                </Text>
              )}
              {tab === 'appview' && appViewError && (
                <Box borderWidth="1px" borderRadius="md" p={4} mb={3}>
                  <Text fontSize="sm" opacity={0.8}>
                    {appViewError}
                  </Text>
                </Box>
              )}

              {entries.map((thing) => (
                <EntryCard
                  key={thing.id}
                  thing={thing}
                  mine={!thing.author || thing.author.id === user.id}
                  onDelete={tab === 'stored' ? deleteEntry : undefined}
                  deleting={deletingId === thing.id}
                />
              ))}
              {!entriesLoading && entries.length === 0 && !appViewError && (
                <Text fontSize="sm" opacity={0.7} py={4}>
                  {tab === 'stored' ? 'Nothing stored here.' : 'Nothing visible in the app view right now.'}
                </Text>
              )}
              {nextCursor && (
                <Button size="xs" variant="outline" isDisabled={entriesLoading} onClick={() => loadEntries(selected, tab, nextCursor)}>
                  Load more
                </Button>
              )}

              {tab === 'stored' && entries.length > 0 && (
                <Flex mt={6} justifyContent="flex-end">
                  <Button size="xs" colorScheme={confirmWipe ? 'red' : undefined} variant="outline" onClick={wipeApp}>
                    {confirmWipe ? 'Really delete ALL of this app’s data? 🗑️' : 'Delete all data for this app'}
                  </Button>
                </Flex>
              )}
            </>
          )}
        </Box>
      </Flex>
    </Flex>
  );
};

export default AppsDataPage;
