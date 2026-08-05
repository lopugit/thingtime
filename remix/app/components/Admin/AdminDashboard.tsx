import React from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';

import { AdminPanel } from '~/components/Admin/AdminPanel';
import { LinkManagerModal } from '~/components/Admin/LinkManagerModal';
import { SubscriptionEditorModal } from '~/components/Admin/SubscriptionEditorModal';
import { TierManager } from '~/components/Admin/TierManager';
import { formatBytes } from '~/components/Apps/ConnectedAppsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';

// /admin — the management dashboard: Users (tiers, quotas, storage, links),
// Apps (owners, users, storage, suspension), System (the existing rate-limit
// + admin-access panel). Client gate mirrors MongoDB/Raw.tsx; every endpoint
// re-checks admin server-side — this UI is just the surface.

type UserRow = {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  isAdmin: boolean;
  envAdmin: boolean;
  accountKind: 'user' | 'service';
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  appNamespaceBytes: number;
  subscription: {
    tier: string;
    tierName?: string;
    tierVersion?: number;
    metered: boolean;
    isDefault: boolean;
    overrides: Record<string, number | null> | null;
    effective: Record<string, number | null>;
  };
  counts: { apps: number; linkedApps: number; ownedAccounts: number; pats: number; connectedApps: number };
};

type AppRow = {
  clientId: string;
  name: string;
  origins: string[];
  createdAt: string | null;
  revokedAt: string | null;
  owner: { id: string; username: string | null };
  managers: Array<{ id: string; username: string | null }>;
  userCount: number;
  usedBytes: number;
  subscription: UserRow['subscription'];
};

const bytesOrInfinity = (value: number | null | undefined): string => (value === null || value === undefined ? '∞' : formatBytes(value));

const TierBadge = ({ subscription }: { subscription: UserRow['subscription'] }) => (
  <Flex gap={1} align="center" wrap="wrap">
    <Badge colorScheme={subscription.tier === 'payg' ? 'orange' : subscription.isDefault ? 'gray' : 'purple'} fontSize="0.65em">
      {subscription.tierName || subscription.tier}
      {subscription.tierVersion ? ` · v${subscription.tierVersion}` : ''}
    </Badge>
    {subscription.overrides && (
      <Badge colorScheme="pink" fontSize="0.6em" title="Admin quota overrides are active">
        custom
      </Badge>
    )}
  </Flex>
);

// Debounce a search box into a fetcher; shared by both tabs.
const useSearchedRows = <T,>(fetcher: (q: string) => Promise<T[] | null>, deps: React.DependencyList) => {
  const [query, setQuery] = React.useState('');
  const [rows, setRows] = React.useState<T[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const [tick, setTick] = React.useState(0);
  const refresh = React.useCallback(() => setTick((value) => value + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    // Optimistic-rendering house rule: keep the last rows on screen while the
    // refetch runs; only the cold start shows the spinner.
    setLoading(rows === null);
    const timer = setTimeout(
      () => {
        fetcherRef
          .current(query.trim())
          .then((next) => {
            if (!cancelled && next) setRows(next);
          })
          .catch(() => {})
          .finally(() => !cancelled && setLoading(false));
      },
      query ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tick, ...deps]);

  return { query, setQuery, rows, loading, refresh };
};

const UsersTab = () => {
  const api = useApi();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const { query, setQuery, rows, loading, refresh } = useSearchedRows<UserRow>(
    (q) => apiRef.current.v1.admin.usersOverview(q ? { q } : undefined).then((resp: any) => (resp?.ok ? resp.users : null)),
    []
  );
  const [subscriptionFor, setSubscriptionFor] = React.useState<UserRow | null>(null);
  const [linksFor, setLinksFor] = React.useState<UserRow | null>(null);

  return (
    <Box>
      <Input
        size="sm"
        maxW="360px"
        placeholder="Search users by username or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        mb={3}
      />
      {loading && !rows ? (
        <Flex justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : (
        <Box overflowX="auto">
          <Table size="sm" minW="880px">
            <Thead>
              <Tr>
                <Th>User</Th>
                <Th>Tier</Th>
                <Th isNumeric>Storage</Th>
                <Th isNumeric>App data</Th>
                <Th isNumeric>Apps</Th>
                <Th isNumeric>Tokens</Th>
                <Th isNumeric>Connected</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(rows ?? []).map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Text fontWeight={600} fontSize="sm">
                      @{row.username}
                      {row.isAdmin && (
                        <Badge ml={1} colorScheme="green" fontSize="0.6em">
                          admin
                        </Badge>
                      )}
                      {row.accountKind === 'service' && (
                        <Badge ml={1} colorScheme="blue" fontSize="0.6em">
                          service
                        </Badge>
                      )}
                    </Text>
                    <Text fontSize="xs" opacity={0.6} overflow="hidden" textOverflow="ellipsis" maxW="220px">
                      {row.displayName || row.email}
                    </Text>
                  </Td>
                  <Td>
                    <TierBadge subscription={row.subscription} />
                  </Td>
                  <Td isNumeric fontSize="xs" whiteSpace="nowrap">
                    {formatBytes(row.storageUsedBytes)} / {bytesOrInfinity(row.subscription.effective.userStorageBytes)}
                  </Td>
                  <Td isNumeric fontSize="xs" whiteSpace="nowrap">
                    {formatBytes(row.appNamespaceBytes)}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.counts.apps}
                    {row.counts.linkedApps > 0 && (
                      <Text as="span" opacity={0.55}>
                        {' '}
                        +{row.counts.linkedApps}
                      </Text>
                    )}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.counts.pats}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.counts.connectedApps}
                  </Td>
                  <Td whiteSpace="nowrap">
                    <Button size="xs" variant="outline" mr={1} onClick={() => setSubscriptionFor(row)}>
                      Tier
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setLinksFor(row)}>
                      Links{row.counts.ownedAccounts + row.counts.linkedApps > 0 ? ` (${row.counts.ownedAccounts + row.counts.linkedApps})` : ''}
                    </Button>
                  </Td>
                </Tr>
              ))}
              {rows && rows.length === 0 && (
                <Tr>
                  <Td colSpan={8}>
                    <Text fontSize="sm" opacity={0.6} py={2}>
                      No users match.
                    </Text>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </Box>
      )}
      {subscriptionFor && (
        <SubscriptionEditorModal
          subjectType="user"
          subjectId={subscriptionFor.id}
          subjectLabel={`@${subscriptionFor.username}`}
          isOpen
          onClose={() => setSubscriptionFor(null)}
          onSaved={refresh}
        />
      )}
      {linksFor && (
        <LinkManagerModal
          mode="user"
          subjectId={linksFor.id}
          subjectLabel={`@${linksFor.username}`}
          isOpen
          onClose={() => setLinksFor(null)}
          onChanged={refresh}
        />
      )}
    </Box>
  );
};

const AppsTab = () => {
  const api = useApi();
  const lopu = useLopu();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const { query, setQuery, rows, loading, refresh } = useSearchedRows<AppRow>(
    (q) => apiRef.current.v1.admin.apps(q ? { q } : undefined).then((resp: any) => (resp?.ok ? resp.apps : null)),
    []
  );
  const [subscriptionFor, setSubscriptionFor] = React.useState<AppRow | null>(null);
  const [managersFor, setManagersFor] = React.useState<AppRow | null>(null);
  const [confirmRevoke, setConfirmRevoke] = React.useState<string | null>(null);
  const [busyClientId, setBusyClientId] = React.useState<string | null>(null);

  const toggleRevoked = async (row: AppRow) => {
    setBusyClientId(row.clientId);
    try {
      const resp: any = await api.v1.admin.revokeApp({ clientId: row.clientId, revoked: !row.revokedAt });
      if (resp?.ok) {
        lopu({
          title: row.revokedAt ? `${row.name} restored` : `${row.name} suspended — all tokens revoked`,
          status: 'success',
          duration: 6000
        });
        refresh();
      } else {
        lopu({ title: resp?.error || 'Update failed', status: 'error' });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Update failed', status: 'error' });
    } finally {
      setBusyClientId(null);
      setConfirmRevoke(null);
    }
  };

  return (
    <Box>
      <Input size="sm" maxW="360px" placeholder="Search apps by name or clientId…" value={query} onChange={(e) => setQuery(e.target.value)} mb={3} />
      {loading && !rows ? (
        <Flex justify="center" py={10}>
          <Spinner />
        </Flex>
      ) : (
        <Box overflowX="auto">
          <Table size="sm" minW="880px">
            <Thead>
              <Tr>
                <Th>App</Th>
                <Th>Owner</Th>
                <Th isNumeric>Users</Th>
                <Th isNumeric>Storage</Th>
                <Th>Tier</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(rows ?? []).map((row) => (
                <Tr key={row.clientId} opacity={row.revokedAt ? 0.6 : 1}>
                  <Td>
                    <Text fontWeight={600} fontSize="sm">
                      {row.name}
                    </Text>
                    <Text fontSize="xs" opacity={0.6} fontFamily="mono" overflow="hidden" textOverflow="ellipsis" maxW="200px">
                      {row.clientId}
                    </Text>
                  </Td>
                  <Td fontSize="xs">
                    @{row.owner.username ?? row.owner.id}
                    {row.managers.length > 0 && (
                      <Text as="span" opacity={0.55}>
                        {' '}
                        +{row.managers.length}
                      </Text>
                    )}
                  </Td>
                  <Td isNumeric fontSize="xs">
                    {row.userCount}
                  </Td>
                  <Td isNumeric fontSize="xs" whiteSpace="nowrap">
                    {formatBytes(row.usedBytes)}
                    {` / ${bytesOrInfinity(row.subscription.effective.appStorageBytes)}`}
                  </Td>
                  <Td>
                    <TierBadge subscription={row.subscription} />
                  </Td>
                  <Td>
                    {row.revokedAt ? (
                      <Badge colorScheme="red" fontSize="0.65em">
                        suspended
                      </Badge>
                    ) : (
                      <Badge colorScheme="green" fontSize="0.65em">
                        active
                      </Badge>
                    )}
                  </Td>
                  <Td whiteSpace="nowrap">
                    <Button size="xs" variant="outline" mr={1} onClick={() => setSubscriptionFor(row)}>
                      Tier
                    </Button>
                    <Button size="xs" variant="outline" mr={1} onClick={() => setManagersFor(row)}>
                      Owners{row.managers.length > 0 ? ` (${row.managers.length + 1})` : ''}
                    </Button>
                    {confirmRevoke === row.clientId ? (
                      <>
                        <Button size="xs" colorScheme="red" mr={1} isLoading={busyClientId === row.clientId} onClick={() => toggleRevoked(row)}>
                          Confirm
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setConfirmRevoke(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme={row.revokedAt ? 'green' : 'red'}
                        isLoading={busyClientId === row.clientId}
                        onClick={() => (row.revokedAt ? toggleRevoked(row) : setConfirmRevoke(row.clientId))}
                      >
                        {row.revokedAt ? 'Restore' : 'Suspend'}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
              {rows && rows.length === 0 && (
                <Tr>
                  <Td colSpan={7}>
                    <Text fontSize="sm" opacity={0.6} py={2}>
                      No apps match.
                    </Text>
                  </Td>
                </Tr>
              )}
            </Tbody>
          </Table>
        </Box>
      )}
      {subscriptionFor && (
        <SubscriptionEditorModal
          subjectType="app"
          subjectId={subscriptionFor.clientId}
          subjectLabel={subscriptionFor.name}
          isOpen
          onClose={() => setSubscriptionFor(null)}
          onSaved={refresh}
        />
      )}
      {managersFor && (
        <LinkManagerModal
          mode="app"
          subjectId={managersFor.clientId}
          subjectLabel={managersFor.name}
          isOpen
          onClose={() => setManagersFor(null)}
          onChanged={refresh}
        />
      )}
    </Box>
  );
};

export const AdminDashboard = () => {
  const user = useCurrentUser();

  // Same whole-page gate idiom as the MongoDB workbench (Raw.tsx): a card,
  // never a redirect, so the URL is shareable between admins.
  if (!user?.isAdmin) {
    return (
      <Flex justify="center" px={4} py={16} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 32px)">
        <Box {...CARD_STYLES} maxW="420px" width="100%" p={6} textAlign="center">
          <Heading size="md" mb={2}>
            🔐 Admin access required
          </Heading>
          <Text fontSize="sm" opacity={0.7}>
            {user ? 'This dashboard is for administrators only.' : 'Sign in with an admin account to manage users and apps.'}
          </Text>
        </Box>
      </Flex>
    );
  }

  return (
    <Box
      maxW="1280px"
      mx="auto"
      px={{ base: 3, md: 6 }}
      py={6}
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 16px)"
      width="100%"
    >
      <Heading size="lg" mb={1}>
        Admin
      </Heading>
      <Text fontSize="sm" opacity={0.65} mb={4}>
        Manage users, apps, subscription tiers, quotas, and ownership.
      </Text>
      <Tabs variant="enclosed" size="sm" isLazy>
        <TabList flexWrap="wrap">
          <Tab>Users</Tab>
          <Tab>Apps</Tab>
          <Tab>Tiers</Tab>
          <Tab>System</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <UsersTab />
          </TabPanel>
          <TabPanel px={0}>
            <AppsTab />
          </TabPanel>
          <TabPanel px={0}>
            <TierManager />
          </TabPanel>
          <TabPanel px={0}>
            <AdminPanel />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  );
};
