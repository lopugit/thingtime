import React from 'react';
import { Box, Button, Flex, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';
import { Link } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

// /connections — link third-party apps (Reddit, YouTube, Mastodon, Bluesky,
// RSS, …), manage the linked accounts, and manage AI feed filters. The feeds
// themselves render at /connections/feed with the native Thingtime
// comment/reaction overlay.

type Provider = {
  id: string;
  name: string;
  icon: string;
  auth: 'none' | 'oauth2';
  contentVisibility: 'public' | 'personal';
  about: string;
  configured: boolean;
  fields: { key: string; label: string; placeholder?: string; help?: string; required?: boolean }[];
};

type Connection = {
  id: string;
  provider: string;
  providerName: string;
  providerIcon: string;
  contentVisibility: 'public' | 'personal';
  account: { id: string; handle: string; displayName: string; avatarUrl: string | null; profileUrl: string | null };
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

type FeedFilter = {
  id: string;
  name: string;
  prompt: string;
  action: 'warn' | 'hide';
  enabled: boolean;
};

const PROVIDERS_CACHE = 'tt-connections-providers';
const CONNECTIONS_CACHE = 'tt-connections-list';
const FILTERS_CACHE = 'tt-connections-filters';

const cardStyle = {
  background: 'var(--tt-card, #ffffff)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-lg, 16px)'
} as const;

export const ConnectionsPage = () => {
  const api = useApi();
  const lopu = useLopu();

  // optimistic first paint from the synchronous cache tier (house rule:
  // never flash a loading state when prior state exists)
  const [providers, setProviders] = React.useState<Provider[]>(() => readLocalCache<Provider[]>(PROVIDERS_CACHE) || []);
  const [connections, setConnections] = React.useState<Connection[]>(() => readLocalCache<Connection[]>(CONNECTIONS_CACHE) || []);
  const [filters, setFilters] = React.useState<FeedFilter[]>(() => readLocalCache<FeedFilter[]>(FILTERS_CACHE) || []);
  const [signedOut, setSignedOut] = React.useState(false);

  const [connecting, setConnecting] = React.useState<Provider | null>(null);
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const [filterName, setFilterName] = React.useState('');
  const [filterPrompt, setFilterPrompt] = React.useState('');
  const [filterAction, setFilterAction] = React.useState<'warn' | 'hide'>('warn');

  const refresh = React.useCallback(async () => {
    try {
      const [providersResp, connectionsResp, filtersResp] = await Promise.all([
        api.v1.connections.providers(),
        api.v1.connections.list().catch((err: any) => {
          if (err?.status === 401) return { connections: null };
          throw err;
        }),
        api.v1.connections.filters().catch(() => ({ filters: null }))
      ]);
      setProviders(providersResp.providers || []);
      writeLocalCache(PROVIDERS_CACHE, providersResp.providers || []);
      if (connectionsResp.connections === null) {
        setSignedOut(true);
      } else {
        setSignedOut(false);
        setConnections(connectionsResp.connections || []);
        writeLocalCache(CONNECTIONS_CACHE, connectionsResp.connections || []);
      }
      if (filtersResp.filters !== null) {
        setFilters(filtersResp.filters || []);
        writeLocalCache(FILTERS_CACHE, filtersResp.filters || []);
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not load your connections 😞', status: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const openConnect = (provider: Provider) => {
    setConnecting(provider);
    setFieldValues({});
  };

  const submitConnect = async () => {
    if (!connecting) return;
    setBusy(true);
    try {
      const resp = await api.v1.connections.connect({ provider: connecting.id, fields: fieldValues });
      lopu({
        title: resp.alreadyLinked
          ? `Already connected to ${resp.connection?.account?.displayName} ✨`
          : `Connected to ${resp.connection?.account?.displayName} 🎉`,
        status: 'success',
        duration: 6000
      });
      setConnecting(null);
      await refresh();
    } catch (err: any) {
      lopu({ title: err?.error || `Could not connect ${connecting.name} 😞`, status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (connection: Connection) => {
    // optimistic remove, restore on failure
    const previous = connections;
    setConnections((current) => current.filter((entry) => entry.id !== connection.id));
    try {
      await api.v1.connections.unlink({ id: connection.id });
      writeLocalCache(CONNECTIONS_CACHE, previous.filter((entry) => entry.id !== connection.id));
      lopu({ title: `Unlinked ${connection.account.displayName} 👋`, status: 'success', duration: 5000 });
    } catch (err: any) {
      setConnections(previous);
      lopu({ title: err?.error || 'Could not unlink that connection 😞', status: 'error' });
    }
  };

  const createFilter = async () => {
    if (!filterName.trim() || !filterPrompt.trim()) {
      lopu({ title: 'Give the filter a name and a rule first ✍️', status: 'info', duration: 5000 });
      return;
    }
    try {
      const resp = await api.v1.connections.saveFilter({ name: filterName, prompt: filterPrompt, action: filterAction });
      setFilters((current) => [...current, resp.filter]);
      writeLocalCache(FILTERS_CACHE, [...filters, resp.filter]);
      setFilterName('');
      setFilterPrompt('');
      lopu({ title: `Filter “${resp.filter?.name}” is on 🛡️`, status: 'success', duration: 5000 });
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not save that filter 😞', status: 'error' });
    }
  };

  const toggleFilter = async (filter: FeedFilter) => {
    const next = filters.map((entry) => (entry.id === filter.id ? { ...entry, enabled: !filter.enabled } : entry));
    setFilters(next);
    try {
      await api.v1.connections.saveFilter({ id: filter.id, enabled: !filter.enabled });
      writeLocalCache(FILTERS_CACHE, next);
    } catch (err: any) {
      setFilters(filters);
      lopu({ title: err?.error || 'Could not update that filter 😞', status: 'error' });
    }
  };

  const removeFilter = async (filter: FeedFilter) => {
    const previous = filters;
    setFilters((current) => current.filter((entry) => entry.id !== filter.id));
    try {
      await api.v1.connections.removeFilter({ id: filter.id });
      writeLocalCache(FILTERS_CACHE, previous.filter((entry) => entry.id !== filter.id));
    } catch (err: any) {
      setFilters(previous);
      lopu({ title: err?.error || 'Could not remove that filter 😞', status: 'error' });
    }
  };

  return (
    <Box
      maxWidth="860px"
      marginX="auto"
      paddingX={[4, 6]}
      paddingBottom={[6, 8]}
      paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))"
      display="flex"
      flexDirection="column"
      rowGap={8}
    >
      <Flex alignItems="baseline" justifyContent="space-between" flexWrap="wrap" rowGap={2}>
        <Box>
          <Text as="h1" fontSize="2xl" fontWeight="700">
            Connections 🔗
          </Text>
          <Text color="var(--tt-muted, #6b7280)" marginTop={1}>
            Link your third-party apps and browse their feeds inside Thingtime — with Thingtime comments, reactions, and AI
            filters layered on top.
          </Text>
        </Box>
        <Button as={Link} to="/connections/feed" size="sm" variant="outline" borderRadius="999px">
          Open connected feed 📡
        </Button>
      </Flex>

      {signedOut ? (
        <Box {...cardStyle} padding={6} textAlign="center">
          <Text fontWeight="600">Sign in to link your apps</Text>
          <Text color="var(--tt-muted, #6b7280)" marginTop={1}>
            Connections belong to your account — log in or register to start linking.
          </Text>
          <Flex justifyContent="center" columnGap={3} marginTop={4}>
            <Button as={Link} to="/login" size="sm" borderRadius="999px">
              Log in 🗝️
            </Button>
            <Button as={Link} to="/register" size="sm" variant="outline" borderRadius="999px">
              Register ➕
            </Button>
          </Flex>
        </Box>
      ) : null}

      {/* linked accounts */}
      {connections.length ? (
        <Box display="flex" flexDirection="column" rowGap={3}>
          <Text fontWeight="600">Your connections</Text>
          {connections.map((connection) => (
            <Flex key={connection.id} {...cardStyle} padding={4} alignItems="center" columnGap={3} flexWrap="wrap" rowGap={2}>
              <Text fontSize="xl">{connection.providerIcon}</Text>
              <Box flex="1" minWidth="200px">
                <Text fontWeight="600">
                  {connection.account.displayName}
                  <Text as="span" color="var(--tt-muted, #6b7280)" fontWeight="400" marginLeft={2} fontSize="sm">
                    {connection.providerName}
                    {connection.contentVisibility === 'personal' ? ' · personal feed' : ''}
                  </Text>
                </Text>
                <Text fontSize="sm" color="var(--tt-muted, #6b7280)">
                  {connection.account.handle}
                  {connection.lastSyncError ? ` · ⚠️ ${connection.lastSyncError}` : ''}
                </Text>
              </Box>
              <Button
                as={Link}
                to={`/connections/feed?connection=${encodeURIComponent(connection.id)}`}
                size="sm"
                variant="outline"
                borderRadius="999px"
              >
                Feed
              </Button>
              <Button size="sm" variant="ghost" borderRadius="999px" onClick={() => unlink(connection)}>
                Unlink
              </Button>
            </Flex>
          ))}
        </Box>
      ) : null}

      {/* provider catalog */}
      <Box display="flex" flexDirection="column" rowGap={3}>
        <Text fontWeight="600">Connect a 3rd party app</Text>
        <Box display="grid" gridTemplateColumns={['1fr', 'repeat(2, 1fr)', 'repeat(3, 1fr)']} gap={3}>
          {providers.map((provider) => (
            <Box key={provider.id} {...cardStyle} padding={4} display="flex" flexDirection="column" rowGap={2}>
              <Flex alignItems="center" columnGap={2}>
                <Text fontSize="xl">{provider.icon}</Text>
                <Text fontWeight="600">{provider.name}</Text>
              </Flex>
              <Text fontSize="sm" color="var(--tt-muted, #6b7280)" flex="1">
                {provider.about}
              </Text>
              <Button
                size="sm"
                borderRadius="999px"
                isDisabled={!provider.configured || signedOut}
                onClick={() => openConnect(provider)}
                variant={connecting?.id === provider.id ? 'solid' : 'outline'}
              >
                {provider.configured ? 'Connect' : 'Needs setup'}
              </Button>
            </Box>
          ))}
        </Box>
      </Box>

      {/* connect form */}
      {connecting ? (
        <Box {...cardStyle} padding={5} display="flex" flexDirection="column" rowGap={3}>
          <Text fontWeight="600">
            {connecting.icon} Connect {connecting.name}
          </Text>
          {connecting.fields.map((field) => (
            <Box key={field.key}>
              <Text fontSize="sm" fontWeight="500" marginBottom={1}>
                {field.label}
                {field.required ? ' *' : ''}
              </Text>
              <Input
                value={fieldValues[field.key] || ''}
                placeholder={field.placeholder}
                onChange={(event) => setFieldValues((current) => ({ ...current, [field.key]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitConnect();
                }}
              />
              {field.help ? (
                <Text fontSize="xs" color="var(--tt-muted, #6b7280)" marginTop={1}>
                  {field.help}
                </Text>
              ) : null}
            </Box>
          ))}
          <Flex columnGap={2}>
            <Button size="sm" borderRadius="999px" onClick={submitConnect} isLoading={busy}>
              Link account
            </Button>
            <Button size="sm" variant="ghost" borderRadius="999px" onClick={() => setConnecting(null)}>
              Cancel
            </Button>
          </Flex>
        </Box>
      ) : null}

      {/* AI feed filters */}
      <Box display="flex" flexDirection="column" rowGap={3}>
        <Box>
          <Text fontWeight="600">AI feed filters 🛡️</Text>
          <Text fontSize="sm" color="var(--tt-muted, #6b7280)">
            Describe what to catch in plain language — “warn” veils matched posts behind a Show button, “hide” drops them.
          </Text>
        </Box>
        {filters.map((filter) => (
          <Flex key={filter.id} {...cardStyle} padding={4} alignItems="center" columnGap={3} flexWrap="wrap" rowGap={2}>
            <Switch isChecked={filter.enabled} onChange={() => toggleFilter(filter)} />
            <Box flex="1" minWidth="200px">
              <Text fontWeight="600">
                {filter.name}
                <Text as="span" color="var(--tt-muted, #6b7280)" fontWeight="400" marginLeft={2} fontSize="sm">
                  {filter.action === 'warn' ? 'warn + Show button' : 'hide'}
                </Text>
              </Text>
              <Text fontSize="sm" color="var(--tt-muted, #6b7280)">
                {filter.prompt}
              </Text>
            </Box>
            <Button size="sm" variant="ghost" borderRadius="999px" onClick={() => removeFilter(filter)}>
              Remove
            </Button>
          </Flex>
        ))}
        {!signedOut ? (
          <Box {...cardStyle} padding={4} display="flex" flexDirection="column" rowGap={2}>
            <Flex columnGap={2} flexWrap="wrap" rowGap={2}>
              <Input flex="1" minWidth="160px" placeholder="Filter name (e.g. Sad news)" value={filterName} onChange={(event) => setFilterName(event.target.value)} />
              <Select width="auto" value={filterAction} onChange={(event) => setFilterAction(event.target.value === 'hide' ? 'hide' : 'warn')}>
                <option value="warn">Warn (Show button)</option>
                <option value="hide">Hide</option>
              </Select>
            </Flex>
            <Textarea
              placeholder="What should this filter catch? e.g. warn for sad news"
              value={filterPrompt}
              onChange={(event) => setFilterPrompt(event.target.value)}
              rows={2}
            />
            <Button size="sm" borderRadius="999px" alignSelf="flex-start" onClick={createFilter}>
              Add filter
            </Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};
