import React from 'react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Input,
  Progress,
  SimpleGrid,
  Spinner,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';
import { useNavigate, useSearchParams } from 'react-router';

import { formatBytes } from './ConnectedAppsSection';
import { useLopu } from '~/components/Lopu/useLopu';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CARD_STYLES } from '~/theme/card';

const MB = 1024 * 1024;

type ManagedApp = {
  clientId: string;
  name: string;
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  storageRemainingBytes: number | null;
  userStorageAllowanceBytes: number;
  storageAccountingReady: boolean;
  subscriptionTier: string;
  subscriptionMetered: boolean;
  subscriptionCustom: boolean;
};

type ManagedUser = {
  userId: string;
  username: string | null;
  usedBytes: number;
  storageAllowanceBytes: number;
  storageRemainingBytes: number;
  storageAllowanceOverrideBytes: number | null;
  storageAllowanceSource: 'app-default' | 'custom';
  activeGrant: boolean;
  lastSeenAt: string | null;
};

type ManagedStorage = {
  clientId: string;
  name: string;
  subscription: {
    tier: string;
    metered: boolean;
    overrides: Record<string, number | null> | null;
    effective: { appStorageBytes: number | null };
  };
  storageAllowanceBytes: number | null;
  storageUsedBytes: number;
  storageRemainingBytes: number | null;
  defaultUserStorageAllowanceBytes: number;
  storageAccountingReady: boolean;
  users: ManagedUser[];
  usersTruncated: boolean;
  tiers: Array<{
    id: string;
    title: string;
    description: string;
    emoji: string;
    metered: boolean;
    storageAllowanceBytes: number | null;
  }>;
};

// The optimistic cache keeps the non-sensitive app totals/controls, but never
// persists an app-user roster or usernames into localStorage. Those are
// re-authorized and fetched live on every visit.
const cacheSafeStorage = (storage: ManagedStorage): ManagedStorage => ({
  ...storage,
  users: [],
  usersTruncated: false
});

const readStorageCache = (key: string | null): ManagedStorage | null => {
  if (!key) return null;
  const cached = readLocalCache<ManagedStorage>(key);
  return cached ? cacheSafeStorage(cached) : null;
};

const allowanceLabel = (bytes: number | null) => (bytes === null ? 'Unlimited · metered' : formatBytes(bytes));

const userLabel = (row: ManagedUser) =>
  row.username ? `@${row.username}` : `User ${row.userId.slice(0, 8)}…${row.userId.slice(-4)}`;

export const AppStorageManagerPage = () => {
  const api = useApi();
  const lopu = useLopu();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const selectedId = (params.get('app') || '').trim();
  const appsCacheKey = user ? `tt-managed-apps-${user.id}` : null;
  const [apps, setApps] = React.useState<ManagedApp[]>(() =>
    appsCacheKey ? (readLocalCache<ManagedApp[]>(appsCacheKey) ?? []) : []
  );
  const [appsLoaded, setAppsLoaded] = React.useState(false);
  const storageCacheKey = user && selectedId ? `tt-app-storage-manager-${user.id}-${selectedId}` : null;
  const [storage, setStorage] = React.useState<ManagedStorage | null>(() => readStorageCache(storageCacheKey));
  const [storageLoading, setStorageLoading] = React.useState(false);
  const [storageError, setStorageError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [defaultMb, setDefaultMb] = React.useState('50');
  const [userMb, setUserMb] = React.useState('');
  const [selectedUsers, setSelectedUsers] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState('');
  const displayedStorageClientId = storage?.clientId;
  const displayedDefaultAllowance = storage?.defaultUserStorageAllowanceBytes;

  React.useEffect(() => {
    if (typeof displayedDefaultAllowance === 'number') {
      setDefaultMb(String(Math.round((displayedDefaultAllowance / MB) * 100) / 100));
    }
  }, [displayedStorageClientId, displayedDefaultAllowance]);

  const listApps = api.v1.apps.list;
  const loadStorageApi = api.v1.apps.storage;
  const setStorageApi = api.v1.apps.setStorage;

  const refreshApps = React.useCallback(async () => {
    if (!user) return;
    try {
      const response = await listApps();
      if (response?.ok) {
        const next = (response.apps || []) as ManagedApp[];
        setApps(next);
        if (appsCacheKey) writeLocalCache(appsCacheKey, next);
        if (!selectedId && next[0]) setParams({ app: next[0].clientId }, { replace: true });
      }
    } catch {
      // Keep the optimistic last-known roster.
    } finally {
      setAppsLoaded(true);
    }
  }, [appsCacheKey, listApps, selectedId, setParams, user]);

  React.useEffect(() => {
    refreshApps();
  }, [refreshApps]);

  const applyStorage = React.useCallback(
    (next: ManagedStorage) => {
      setStorage(next);
      setStorageError(null);
      setDefaultMb(String(Math.round((next.defaultUserStorageAllowanceBytes / MB) * 100) / 100));
      setSelectedUsers((current) => new Set([...current].filter((id) => next.users.some((row) => row.userId === id))));
      if (storageCacheKey) writeLocalCache(storageCacheKey, cacheSafeStorage(next));
    },
    [storageCacheKey]
  );

  const refreshStorage = React.useCallback(async () => {
    if (!user || !selectedId) return;
    setStorageLoading(true);
    setStorageError(null);
    try {
      const response = await loadStorageApi({ clientId: selectedId });
      if (response?.ok && response.storage) applyStorage(response.storage as ManagedStorage);
    } catch (error: any) {
      const message = error?.error || 'Couldn’t load app storage';
      setStorage(null);
      setStorageError(message);
      if (storageCacheKey) clearLocalCache(storageCacheKey);
      lopu({ title: message, status: 'error' });
    } finally {
      setStorageLoading(false);
    }
  }, [applyStorage, loadStorageApi, lopu, selectedId, storageCacheKey, user]);

  React.useEffect(() => {
    if (!selectedId) {
      setStorage(null);
      return;
    }
    const cached = user ? readStorageCache(`tt-app-storage-manager-${user.id}-${selectedId}`) : null;
    setStorage(cached ?? null);
    setStorageError(null);
    setSelectedUsers(new Set());
    setQuery('');
    refreshStorage();
    // refreshStorage intentionally follows the selected id; cached state is
    // seeded synchronously first so app switches never flash a spinner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, user?.id]);

  const mutate = async (args: Parameters<typeof setStorageApi>[0], success: string) => {
    setSaving(true);
    try {
      const response = await setStorageApi(args);
      if (!response?.ok) throw new Error(response?.error || 'Update failed');
      if (response.storage) applyStorage(response.storage as ManagedStorage);
      lopu({ title: success, status: 'success', duration: 5000 });
      refreshApps();
      return true;
    } catch (error: any) {
      lopu({ title: error?.error || error?.message || 'Update failed', status: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const changeTier = async (tier: string) => {
    if (!storage || tier === storage.subscription.tier) return;
    await mutate({ clientId: storage.clientId, action: 'set-tier', tier }, 'App storage plan updated');
  };

  const parseMb = (value: string): number | null => {
    const mb = Number(value);
    if (!Number.isFinite(mb) || mb < 0) return null;
    const bytes = Math.round(mb * MB);
    return Number.isSafeInteger(bytes) ? bytes : null;
  };

  const saveDefault = async () => {
    if (!storage) return;
    const allowanceBytes = parseMb(defaultMb);
    if (allowanceBytes === null) {
      lopu({ title: 'Enter a valid default allowance in MiB', status: 'error' });
      return;
    }
    await mutate(
      { clientId: storage.clientId, action: 'set-default-user-cap', allowanceBytes },
      'Default app-user storage updated'
    );
  };

  const saveSelectedUsers = async (reset = false) => {
    if (!storage || !selectedUsers.size) return;
    const allowanceBytes = reset ? null : parseMb(userMb);
    if (!reset && allowanceBytes === null) {
      lopu({ title: 'Enter a valid user allowance in MiB', status: 'error' });
      return;
    }
    const ok = await mutate(
      {
        clientId: storage.clientId,
        action: 'set-user-cap',
        userIds: [...selectedUsers],
        allowanceBytes
      },
      reset
        ? `${selectedUsers.size} app user${selectedUsers.size === 1 ? '' : 's'} returned to the default cap`
        : `${selectedUsers.size} app user${selectedUsers.size === 1 ? '' : 's'} updated`
    );
    if (ok) {
      setSelectedUsers(new Set());
      setUserMb('');
    }
  };

  const pageShell = {
    width: '100%',
    minHeight: '100vh'
  } as const;

  if (!user) {
    return (
      <Flex
        {...pageShell}
        justify="center"
        px={4}
        pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 48px)"
        pb={12}
      >
        <Box {...CARD_STYLES} maxW="420px" width="100%" p={6} textAlign="center">
          <Heading size="md" mb={2}>Manage your apps 🧩</Heading>
          <Text fontSize="sm" opacity={0.7} mb={4}>
            Sign in with the Thingtime account that owns or co-manages the app.
          </Text>
          <Button size="sm" onClick={() => navigate('/login')}>Log in 🗝️</Button>
        </Box>
      </Flex>
    );
  }

  const selectedApp = apps.find((app) => app.clientId === selectedId) ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleUsers = (storage?.users || []).filter((row) =>
    !normalizedQuery
      ? true
      : row.userId.toLowerCase().includes(normalizedQuery) || row.username?.toLowerCase().includes(normalizedQuery)
  );
  const allVisibleSelected = visibleUsers.length > 0 && visibleUsers.every((row) => selectedUsers.has(row.userId));
  const usagePercent =
    storage?.storageAllowanceBytes && storage.storageAllowanceBytes > 0
      ? Math.min(100, (storage.storageUsedBytes / storage.storageAllowanceBytes) * 100)
      : 0;

  return (
    <Box
      {...pageShell}
      px={{ base: 3, md: 5 }}
      pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 24px)"
      pb={14}
    >
      <Box maxW="1120px" mx="auto">
        <Flex align="flex-start" justify="space-between" gap={3} mb={5} wrap="wrap">
          <Box>
            <Heading size="lg">App manager 🧩</Heading>
            <Text fontSize="sm" opacity={0.65} mt={1}>
              Storage plans, the default user cap, and individual app-user sub-tiers.
            </Text>
          </Box>
          <Button size="sm" variant="outline" onClick={() => navigate('/docs/embed#register-your-app')}>
            Register an app ↗
          </Button>
        </Flex>

        <Flex align="flex-start" gap={5} direction={{ base: 'column', lg: 'row' }}>
          <Box width={{ base: '100%', lg: '250px' }} flexShrink={0} {...CARD_STYLES} p={3}>
            <Text fontSize="xs" fontWeight={700} textTransform="uppercase" opacity={0.5} px={1} mb={2}>
              Your apps
            </Text>
            {!apps.length && (
              <Text fontSize="sm" opacity={0.65} px={1} py={3}>
                {appsLoaded ? 'No registered or co-managed apps yet.' : ' '}
              </Text>
            )}
            {apps.map((app) => (
              <Button
                key={app.clientId}
                width="100%"
                height="auto"
                minH="58px"
                justifyContent="flex-start"
                textAlign="left"
                variant={selectedId === app.clientId ? 'solid' : 'ghost'}
                colorScheme={selectedId === app.clientId ? 'purple' : undefined}
                px={3}
                py={2}
                mb={1}
                onClick={() => setParams({ app: app.clientId })}
              >
                <Box minW={0}>
                  <Text fontSize="sm" fontWeight={700} noOfLines={1}>{app.name}</Text>
                  <Text fontSize="xs" opacity={0.65} noOfLines={1}>
                    {formatBytes(app.storageUsedBytes)} · {app.subscriptionTier}
                  </Text>
                </Box>
              </Button>
            ))}
          </Box>

          <Box flex={1} minW={0} width="100%">
            {!selectedApp && appsLoaded && (
              <Box {...CARD_STYLES} p={6} textAlign="center">
                <Text opacity={0.7}>Choose an app to manage its storage.</Text>
              </Box>
            )}
            {selectedApp && !storage && storageLoading && (
              <Flex {...CARD_STYLES} justify="center" py={14}><Spinner /></Flex>
            )}
            {selectedApp && !storage && !storageLoading && storageError && (
              <Box {...CARD_STYLES} p={6} textAlign="center">
                <Text fontWeight={700}>Storage manager unavailable</Text>
                <Text fontSize="sm" opacity={0.65} mt={1}>{storageError}</Text>
                <Button size="sm" variant="outline" mt={4} onClick={refreshStorage}>Try again</Button>
              </Box>
            )}
            {storage && (
              <Flex direction="column" gap={5}>
                <Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
                  <Flex align="center" gap={2} wrap="wrap" mb={4}>
                    <Heading size="md">{storage.name}</Heading>
                    <Badge colorScheme="purple">{storage.subscription.tier}</Badge>
                    {storage.subscription.overrides && <Badge>custom</Badge>}
                    {!storage.storageAccountingReady && <Badge colorScheme="orange">migration required</Badge>}
                    {storageLoading && <Spinner size="xs" ml="auto" />}
                  </Flex>
                  <SimpleGrid columns={{ base: 1, sm: 3 }} spacing={4} mb={4}>
                    <Box>
                      <Text fontSize="xs" opacity={0.55}>Whole app used</Text>
                      <Text fontWeight={700}>{formatBytes(storage.storageUsedBytes)}</Text>
                    </Box>
                    <Box>
                      <Text fontSize="xs" opacity={0.55}>Plan allowance</Text>
                      <Text fontWeight={700}>{allowanceLabel(storage.storageAllowanceBytes)}</Text>
                    </Box>
                    <Box>
                      <Text fontSize="xs" opacity={0.55}>Remaining</Text>
                      <Text fontWeight={700}>{allowanceLabel(storage.storageRemainingBytes)}</Text>
                    </Box>
                  </SimpleGrid>
                  {storage.storageAllowanceBytes !== null && (
                    <Progress value={usagePercent} size="sm" colorScheme="purple" borderRadius="full" />
                  )}
                </Box>

                <Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
                  <Heading size="sm" mb={1}>Storage plan</Heading>
                  <Text fontSize="sm" opacity={0.65} mb={4}>
                    Upgrading raises the one aggregate ceiling shared by every user of this app.
                  </Text>
                  <SimpleGrid columns={{ base: 1, sm: 2, xl: 4 }} spacing={3}>
                    {storage.tiers.map((tier) => {
                      const current = tier.id === storage.subscription.tier;
                      return (
                        <Box key={tier.id} borderWidth="1px" borderRadius="md" p={3} borderColor={current ? 'purple.400' : undefined}>
                          <Flex align="center" gap={2} mb={1}>
                            <Text fontWeight={700}>{tier.emoji} {tier.title}</Text>
                            {current && <Badge ml="auto" colorScheme="purple">current</Badge>}
                          </Flex>
                          <Text fontSize="sm" fontWeight={600}>{allowanceLabel(tier.storageAllowanceBytes)}</Text>
                          <Text fontSize="xs" opacity={0.6} minH="3.2em" mt={1}>{tier.description}</Text>
                          <Button
                            size="xs"
                            width="100%"
                            mt={3}
                            variant={current ? 'outline' : 'solid'}
                            colorScheme="purple"
                            isDisabled={current || saving || !!storage.subscription.overrides}
                            onClick={() => changeTier(tier.id)}
                          >
                            {current ? 'Current plan' : 'Choose plan'}
                          </Button>
                        </Box>
                      );
                    })}
                  </SimpleGrid>
                  {storage.subscription.overrides && (
                    <Text fontSize="xs" color="orange.500" mt={3}>
                      This app has a custom administrator plan, so self-service plan changes are locked.
                    </Text>
                  )}
                </Box>

                <Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
                  <Heading size="sm" mb={1}>Default user cap</Heading>
                  <Text fontSize="sm" opacity={0.65} mb={3}>
                    Every app user starts here. You can set any finite value up to the app’s total allowance.
                  </Text>
                  <Flex gap={2} align="center" wrap="wrap">
                    <Input
                      size="sm"
                      type="number"
                      min={0}
                      max={storage.storageAllowanceBytes === null ? undefined : storage.storageAllowanceBytes / MB}
                      value={defaultMb}
                      onChange={(event) => setDefaultMb(event.target.value)}
                      maxW="180px"
                      aria-label="Default user storage allowance in MiB"
                    />
                    <Text fontSize="sm" opacity={0.65}>MiB per app user</Text>
                    <Button size="sm" colorScheme="purple" ml={{ base: 0, sm: 'auto' }} isLoading={saving} onClick={saveDefault}>
                      Save default
                    </Button>
                  </Flex>
                </Box>

                <Box {...CARD_STYLES} p={{ base: 4, md: 5 }}>
                  <Flex justify="space-between" align="flex-end" gap={3} wrap="wrap" mb={3}>
                    <Box>
                      <Heading size="sm">App users</Heading>
                      <Text fontSize="sm" opacity={0.65} mt={1}>
                        Select one user or many and give them a custom sub-tier.
                      </Text>
                    </Box>
                    <Input
                      size="sm"
                      maxW="240px"
                      placeholder="Search user or app user ID…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </Flex>

                  {selectedUsers.size > 0 && (
                    <Flex bg="purple.50" _dark={{ bg: 'whiteAlpha.100' }} borderRadius="md" p={3} mb={3} gap={2} align="center" wrap="wrap">
                      <Text fontSize="sm" fontWeight={700}>{selectedUsers.size} selected</Text>
                      <Input
                        size="xs"
                        type="number"
                        min={0}
                        max={storage.storageAllowanceBytes === null ? undefined : storage.storageAllowanceBytes / MB}
                        placeholder="MiB"
                        value={userMb}
                        onChange={(event) => setUserMb(event.target.value)}
                        width="110px"
                        ml={{ base: 0, sm: 'auto' }}
                        aria-label="Selected users storage allowance in MiB"
                      />
                      <Text fontSize="xs" opacity={0.65}>MiB each</Text>
                      <Button size="xs" colorScheme="purple" isLoading={saving} onClick={() => saveSelectedUsers(false)}>
                        Apply custom cap
                      </Button>
                      <Button size="xs" variant="outline" isDisabled={saving} onClick={() => saveSelectedUsers(true)}>
                        Use app default
                      </Button>
                    </Flex>
                  )}

                  <Box overflowX="auto">
                    <Table size="sm" minW="700px">
                      <Thead>
                        <Tr>
                          <Th width="42px">
                            <Flex
                              width="18px"
                              height="18px"
                              align="center"
                              justify="center"
                              boxShadow="inset 0 0 0 1px currentColor"
                              borderRadius="sm"
                            >
                              <Checkbox
                                colorScheme="purple"
                                isChecked={allVisibleSelected}
                                isIndeterminate={selectedUsers.size > 0 && !allVisibleSelected}
                                onChange={(event) =>
                                  setSelectedUsers((current) => {
                                    const next = new Set(current);
                                    for (const row of visibleUsers) {
                                      if (event.target.checked) next.add(row.userId);
                                      else next.delete(row.userId);
                                    }
                                    return next;
                                  })
                                }
                                aria-label="Select all visible app users"
                              />
                            </Flex>
                          </Th>
                          <Th>User</Th>
                          <Th isNumeric>Used</Th>
                          <Th isNumeric>Cap</Th>
                          <Th>Source</Th>
                          <Th>Grant</Th>
                          <Th>Last seen</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {visibleUsers.map((row) => (
                          <Tr key={row.userId}>
                            <Td>
                              <Flex
                                width="18px"
                                height="18px"
                                align="center"
                                justify="center"
                                boxShadow="inset 0 0 0 1px currentColor"
                                borderRadius="sm"
                              >
                                <Checkbox
                                  colorScheme="purple"
                                  isChecked={selectedUsers.has(row.userId)}
                                  onChange={(event) =>
                                    setSelectedUsers((current) => {
                                      const next = new Set(current);
                                      if (event.target.checked) next.add(row.userId);
                                      else next.delete(row.userId);
                                      return next;
                                    })
                                  }
                                  aria-label={`Select ${userLabel(row)}`}
                                />
                              </Flex>
                            </Td>
                            <Td>
                              <Text fontSize="sm" fontWeight={600}>{userLabel(row)}</Text>
                              <Text fontSize="xs" opacity={0.45} fontFamily="mono">{row.userId}</Text>
                            </Td>
                            <Td isNumeric fontSize="sm">{formatBytes(row.usedBytes)}</Td>
                            <Td isNumeric fontSize="sm">{formatBytes(row.storageAllowanceBytes)}</Td>
                            <Td>
                              <Badge colorScheme={row.storageAllowanceSource === 'custom' ? 'purple' : undefined}>
                                {row.storageAllowanceSource === 'custom' ? 'custom' : 'default'}
                              </Badge>
                            </Td>
                            <Td><Badge colorScheme={row.activeGrant ? 'green' : undefined}>{row.activeGrant ? 'active' : 'past'}</Badge></Td>
                            <Td fontSize="xs" whiteSpace="nowrap">
                              {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleDateString() : '—'}
                            </Td>
                          </Tr>
                        ))}
                        {!visibleUsers.length && (
                          <Tr><Td colSpan={7}><Text fontSize="sm" opacity={0.6} py={3}>No app users match.</Text></Td></Tr>
                        )}
                      </Tbody>
                    </Table>
                  </Box>
                  {storage.usersTruncated && (
                    <Text fontSize="xs" color="orange.500" mt={3}>
                      Showing the 200 most recent app users in this management view.
                    </Text>
                  )}
                </Box>
              </Flex>
            )}
          </Box>
        </Flex>
      </Box>
    </Box>
  );
};

export default AppStorageManagerPage;
