import React from 'react';
import { Box, Button, Flex, Heading, Text } from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router';

import { appDataStorageLabel } from './ConnectedAppsSection';
import type { AppDataRow } from './ConnectedAppsSection';
import { PageHeader, PageShell } from '../Layout/PageShell';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

// /apps — browse everything each connected app stores in your account.
// Left: the app roster (from things, so orphaned data stays visible).
// Right: the selected app's entries (Stored data), or the app's own view of
// its shared slice (App view — the same lens the app reads through, built
// from your live grant). Everything an app stores is YOURS: per-entry delete
// and namespace-wide delete-all live here.

// House chip: mono uppercase micro-label on a tokened tint.
const CHIP_STYLES = {
  fontFamily: 'var(--tt-font-mono, ui-monospace, Menlo, monospace)',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  borderRadius: 'var(--tt-radius-xs, 7px)',
  paddingX: 2,
  paddingY: 0.5
} as const;

type PublicThingWire = {
  id: string;
  thingtime: string[];
  author: { id: string; username: string; displayName?: string | null; temporary?: boolean } | null;
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
    <Box {...CARD_STYLES} p={3} mb={3}>
      <Flex alignItems="center" gap={2} flexWrap="wrap" mb={2}>
        {thing.thingtime.map((id) => (
          <Box key={id} {...CHIP_STYLES} background="var(--tt-accent-tint, #fff5fa)" color="var(--tt-accent, hotpink)">
            {id}
          </Box>
        ))}
        <Box {...CHIP_STYLES} background="var(--tt-surface-alt, #f5f5f7)" color="var(--tt-muted, #9a9aa6)">
          {audience}
        </Box>
        {thing.author && !mine && (
          <Text fontSize="xs" opacity={0.7}>
            by {getUserDisplayName(thing.author)}
            {thing.author.temporary ? ` · ${getUserIdentityDetail(thing.author)}` : ''}
          </Text>
        )}
        <Text fontSize="xs" opacity={0.55} ml="auto">
          {new Date(thing.updatedAt).toLocaleString()}
        </Text>
      </Flex>
			<Box as="pre" fontSize="xs" fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)" whiteSpace="pre-wrap" wordBreak="break-word" maxHeight="14em" overflowY="auto" opacity={0.85}>
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
	const [apps, setApps] = React.useState<AppDataRow[]>(() => (cacheKey ? (readLocalCache<AppDataRow[]>(cacheKey) ?? []) : []));
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
					mode === 'stored' ? await listApi({ appId, cursor: cursor || undefined }) : await sharedApi({ appId, cursor: cursor || undefined });
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

  if (!user) {
    return (
      <PageShell width={680}>
        <PageHeader
          eyebrow="Thingtime · app data"
          title="App data 📦"
          variant="rainbow"
          subtitle="Sign in to browse everything your connected apps store in your Thingtime."
        />
        <Box>
          <Button size="sm" onClick={() => navigate('/login')}>
            Log in 🗝️
          </Button>
        </Box>
      </PageShell>
    );
  }

  const selectedRow = apps.find((app) => app.appId === selected) || null;

  return (
    <PageShell width={680}>
      <PageHeader
        eyebrow="Thingtime · app data"
        title="App data 📦"
        variant="rainbow"
        subtitle="Everything your connected apps store in your account — yours to browse and delete."
      />
      <Flex width="100%" flexDirection={{ base: 'column', md: 'row' }} gap={6} alignItems="flex-start">
        <Box width={{ base: '100%', md: '18em' }} flexShrink={0}>
          {apps.length === 0 && (
            <Text fontSize="sm" opacity={0.7}>
              {appsLoaded ? 'No app has stored anything yet.' : ' '}
            </Text>
          )}
          {apps.map((app) => (
            <Box
              key={app.appId}
              {...CARD_STYLES}
              p={3}
              mb={2}
              cursor="pointer"
              borderColor={selected === app.appId ? 'var(--tt-accent, hotpink)' : 'var(--tt-border, #ececef)'}
              onClick={() => setParams({ app: app.appId })}
            >
              <Flex alignItems="center" gap={2}>
                <Text fontWeight="bold" fontSize="sm">
                  {app.appName || 'Deleted app'}
                </Text>
                {!app.appName && (
                  <Box {...CHIP_STYLES} background="rgba(214, 69, 90, 0.12)" color="var(--tt-danger, #d6455a)">
                    orphaned
                  </Box>
                )}
              </Flex>
              <Text fontSize="xs" opacity={0.65}>
								{appDataStorageLabel(app)}
              </Text>
            </Box>
          ))}
        </Box>

        <Box flex={1} width="100%" minWidth={0}>
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
									Exactly what this app can see right now, through your own grant — your entries plus anything other users of the app shared with its
									circle.
                </Text>
              )}
              {tab === 'appview' && appViewError && (
                <Box {...CARD_STYLES} p={4} mb={3}>
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
                  <Button
                    size="xs"
                    variant="outline"
                    color={confirmWipe ? 'var(--tt-danger, #d6455a)' : undefined}
                    borderColor={confirmWipe ? 'var(--tt-danger, #d6455a)' : undefined}
                    _hover={confirmWipe ? { background: 'rgba(214, 69, 90, 0.12)' } : undefined}
                    onClick={wipeApp}
                  >
                    {confirmWipe ? 'Really delete ALL of this app’s data? 🗑️' : 'Delete all data for this app'}
                  </Button>
                </Flex>
              )}
            </>
          )}
        </Box>
      </Flex>
    </PageShell>
  );
};

export default AppsDataPage;
