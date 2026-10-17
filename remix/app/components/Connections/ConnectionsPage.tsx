import React from 'react';
import { Box, Button, Flex, Image, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';
import { Link, useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { PageShell } from '~/components/Layout/PageShell';
import { AIServiceAccounts } from './AIServiceAccounts';
import { ServiceCatalog, type Provider } from './ServiceCatalog';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { cardStyle, connectedProviderLabel, oauthErrorMessage, type ChannelRef, type Connection } from './shared';

// /connections — link third-party apps (Reddit, YouTube, Mastodon, Bluesky,
// RSS, …), manage the linked accounts, and manage AI feed filters. The feeds
// themselves render at /connections/feed with the native Thingtime
// comment/reaction overlay.

type FeedFilter = {
  id: string;
  name: string;
  prompt: string;
  action: 'warn' | 'hide';
  enabled: boolean;
};

export const ConnectionsPage = () => {
  const user = useCurrentUser();
  // Account-keyed remount clears forms and fences every pending async result.
  return (
    <ConnectionsContent
      key={`${typeof window === 'undefined' ? '' : window.location.origin}:${user?.id || 'guest'}`}
      ownerId={user?.accountKind === 'service' ? null : user?.id || null}
    />
  );
};

const ConnectionsContent = ({ ownerId }: { ownerId: string | null }) => {
  const cacheScope = `${typeof window === 'undefined' ? '' : window.location.origin}:${ownerId || 'guest'}`;
  const PROVIDERS_CACHE = `tt-connections-providers:v2:${cacheScope}`;
  const CONNECTIONS_CACHE = `tt-connections-list:v2:${cacheScope}`;
  const FILTERS_CACHE = `tt-connections-filters:v2:${cacheScope}`;
  const active = React.useRef(true);
  const refreshGeneration = React.useRef(0);
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const api = useApi();
  const lopu = useLopu();
  const [searchParams, setSearchParams] = useSearchParams();

  // optimistic first paint from the synchronous cache tier (house rule:
  // never flash a loading state when prior state exists)
  const [providers, setProviders] = React.useState<Provider[]>(() => readLocalCache<Provider[]>(PROVIDERS_CACHE) || []);
  const [connections, setConnections] = React.useState<Connection[]>(() => readLocalCache<Connection[]>(CONNECTIONS_CACHE) || []);
  const [filters, setFilters] = React.useState<FeedFilter[]>(() => readLocalCache<FeedFilter[]>(FILTERS_CACHE) || []);
  const [signedOut, setSignedOut] = React.useState(!ownerId);

  const [connecting, setConnecting] = React.useState<Provider | null>(null);
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const [filterName, setFilterName] = React.useState('');
  const [filterPrompt, setFilterPrompt] = React.useState('');
  const [filterAction, setFilterAction] = React.useState<'warn' | 'hide'>('warn');

  const refresh = React.useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const [providersResp, connectionsResp, filtersResp] = await Promise.all([
        api.v1.connections.providers(),
        (ownerId ? api.v1.connections.list() : Promise.resolve({ connections: null })).catch((err: any) => {
          if (err?.status === 401) return { connections: null };
          throw err;
        }),
        (ownerId ? api.v1.connections.filters() : Promise.resolve({ filters: null })).catch(() => ({ filters: null }))
      ]);
      if (!active.current || generation !== refreshGeneration.current) return;
      setProviders(providersResp.providers || []);
      writeLocalCache(PROVIDERS_CACHE, providersResp.providers || []);
      if (connectionsResp.connections === null || connectionsResp.ownerId !== ownerId) {
        setSignedOut(true);
        setConnections([]);
        setFilters([]);
      } else {
        setSignedOut(false);
        setConnections(connectionsResp.connections || []);
        writeLocalCache(CONNECTIONS_CACHE, connectionsResp.connections || []);
      }
      if (connectionsResp.ownerId === ownerId && filtersResp.ownerId === ownerId && filtersResp.filters !== null) {
        setFilters(filtersResp.filters || []);
        writeLocalCache(FILTERS_CACHE, filtersResp.filters || []);
      }
    } catch (err: any) {
      if (!active.current || generation !== refreshGeneration.current) return;
      lopu({ title: err?.error || 'Could not load your connections 😞', status: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    refresh();
    const focus = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);

  // OAuth callback landing: /connections?connected=<provider id> or
  // ?oauthError=<code>. Neither is rendered verbatim — both are untrusted URL
  // input, so the copy comes from ./shared and the param only selects it.
  React.useEffect(() => {
    const connected = searchParams.get('connected');
    const failure = oauthErrorMessage(searchParams.get('oauthError'));
    if (!connected && !failure) return;
    if (connected) {
      const label = connectedProviderLabel(connected, providers);
      lopu({ title: label ? `Account linked via ${label} 🎉` : 'Account linked 🎉', status: 'success', duration: 6000 });
      refresh();
    } else if (failure) {
      lopu({ title: failure, status: 'error' });
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openConnect = async (provider: Provider) => {
    // SSO providers hand the browser to their own sign-in — no form here
    if (provider.auth === 'oauth2') {
      const tab = window.open('about:blank', '_blank');
      if (!tab) {
        lopu({ title: 'Allow pop-ups to open the sign-in tab.', status: 'info' });
        return;
      }
      tab.opener = null;
      setBusy(true);
      try {
        await requireThingtimeCapability('api.connections-oauth-begin', '1.1.0');
        if (!active.current) { tab.close(); return; }
        const resp = await api.v1.connections.oauthBegin({ provider: provider.id, expectedOwnerId: ownerId });
        if (!active.current) {
          tab.close();
          return;
        }
        if (!resp?.authorizeUrl || new URL(resp.authorizeUrl).protocol !== 'https:') throw new Error('Invalid sign-in URL');
        tab.location.replace(resp.authorizeUrl);
      } catch (err: any) {
        tab.close();
        if (!active.current) return;
        lopu({ title: err?.error || `Could not start the ${provider.name} sign-in 😞`, status: 'error' });
      } finally {
        setBusy(false);
      }
      return;
    }
    setConnecting(provider);
    setFieldValues({});
  };

  const submitConnect = async () => {
    if (!connecting) return;
    setBusy(true);
    try {
      await requireThingtimeCapability('api.connections', '1.1.0');
      if (!active.current) return;
      const resp = await api.v1.connections.connect({ provider: connecting.id, fields: fieldValues, expectedOwnerId: ownerId });
      if (!active.current) return;
      lopu({
        title: resp.alreadyLinked
          ? `Already connected to ${resp.connection?.account?.displayName} ✨`
          : `Connected to ${resp.connection?.account?.displayName} 🎉`,
        status: 'success',
        duration: 6000
      });
      setConnecting(null);
      setFieldValues({});
      await refresh();
    } catch (err: any) {
      if (!active.current) return;
      lopu({ title: err?.error || `Could not connect ${connecting.name} 😞`, status: 'error' });
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const unlink = async (connection: Connection) => {
    // Fence any older read before the optimistic removal.
    refreshGeneration.current++;
    setBusy(true);
    const previous = connections;
    setConnections((current) => current.filter((entry) => entry.id !== connection.id));
    try {
      await api.v1.connections.unlink({ id: connection.id });
      if (!active.current) return;
      writeLocalCache(
        CONNECTIONS_CACHE,
        previous.filter((entry) => entry.id !== connection.id)
      );
      lopu({ title: `Unlinked ${connection.account.displayName} 👋`, status: 'success', duration: 5000 });
    } catch (err: any) {
      if (!active.current) return;
      setConnections(previous);
      lopu({ title: err?.error || 'Could not unlink that connection 😞', status: 'error' });
    } finally {
      if (active.current) setBusy(false);
    }
  };

  // --- virtual YouTube subscription list (ytsubber-style) ---
  const [ytQuery, setYtQuery] = React.useState('');
  const [ytResults, setYtResults] = React.useState<ChannelRef[]>([]);
  const [ytBusy, setYtBusy] = React.useState(false);
  const [ytSearchConfigured, setYtSearchConfigured] = React.useState<boolean | null>(null);
  const youtubeConnection = connections.find((connection) => connection.provider === 'youtube');

  const searchChannels = async () => {
    if (!ytQuery.trim()) return;
    setYtBusy(true);
    try {
      const resp = await api.v1.connections.youtubeSearch({ q: ytQuery });
      setYtResults(resp.channels || []);
      setYtSearchConfigured(resp.searchConfigured !== false);
      if (!(resp.channels || []).length) {
        lopu({ title: 'No channels matched that — try a channel ID or URL 🔍', status: 'info', duration: 5000 });
      }
    } catch (err: any) {
      lopu({ title: err?.error || 'Channel search failed 😞', status: 'error' });
    } finally {
      setYtBusy(false);
    }
  };

  const subscribeChannel = async (channel: ChannelRef) => {
    setYtBusy(true);
    try {
      const resp = await api.v1.connections.youtubeChannels({ add: channel });
      lopu({ title: `Subscribed to ${channel.title} 📺`, status: 'success', duration: 5000 });
      setYtResults((current) => current.filter((entry) => entry.id !== channel.id));
      setConnections((current) => {
        const others = current.filter((entry) => entry.id !== resp.connection?.id);
        return resp.connection ? [...others, resp.connection] : current;
      });
      await refresh();
    } catch (err: any) {
      lopu({ title: err?.error || `Could not subscribe to ${channel.title} 😞`, status: 'error' });
    } finally {
      setYtBusy(false);
    }
  };

  const unsubscribeChannel = async (channel: ChannelRef) => {
    try {
      await api.v1.connections.youtubeChannels({ remove: channel.id });
      await refresh();
    } catch (err: any) {
      lopu({ title: err?.error || `Could not remove ${channel.title} 😞`, status: 'error' });
    }
  };

  const createFilter = async () => {
    if (!filterName.trim() || !filterPrompt.trim()) {
      lopu({ title: 'Give the filter a name and a rule first ✍️', status: 'info', duration: 5000 });
      return;
    }
    try {
      const resp = await api.v1.connections.saveFilter({ name: filterName, prompt: filterPrompt, action: filterAction });
      // functional update + cache written from the SAME next array — the
      // render-time closure may be stale under interleaved mutations
      setFilters((current) => {
        const next = [...current, resp.filter];
        writeLocalCache(FILTERS_CACHE, next);
        return next;
      });
      setFilterName('');
      setFilterPrompt('');
      lopu({ title: `Filter “${resp.filter?.name}” is on 🛡️`, status: 'success', duration: 5000 });
    } catch (err: any) {
      lopu({ title: err?.error || 'Could not save that filter 😞', status: 'error' });
    }
  };

  const toggleFilter = async (filter: FeedFilter) => {
    setFilters((current) => {
      const next = current.map((entry) => (entry.id === filter.id ? { ...entry, enabled: !filter.enabled } : entry));
      writeLocalCache(FILTERS_CACHE, next);
      return next;
    });
    try {
      await api.v1.connections.saveFilter({ id: filter.id, enabled: !filter.enabled });
    } catch (err: any) {
      // revert only THIS filter's toggle — a snapshot restore would discard
      // concurrent changes to other filters
      setFilters((current) => {
        const next = current.map((entry) => (entry.id === filter.id ? { ...entry, enabled: filter.enabled } : entry));
        writeLocalCache(FILTERS_CACHE, next);
        return next;
      });
      lopu({ title: err?.error || 'Could not update that filter 😞', status: 'error' });
    }
  };

  const removeFilter = async (filter: FeedFilter) => {
    setFilters((current) => {
      const next = current.filter((entry) => entry.id !== filter.id);
      writeLocalCache(FILTERS_CACHE, next);
      return next;
    });
    try {
      await api.v1.connections.removeFilter({ id: filter.id });
    } catch (err: any) {
      // restore only the removed entry
      setFilters((current) => {
        const next = current.some((entry) => entry.id === filter.id) ? current : [...current, filter];
        writeLocalCache(FILTERS_CACHE, next);
        return next;
      });
      lopu({ title: err?.error || 'Could not remove that filter 😞', status: 'error' });
    }
  };

  const verifyConnection = async (connection: Connection) => {
    setBusy(true);
    try {
      await requireThingtimeCapability('api.connections-request', '1.0.0');
      await api.v1.connections.request({ connectionId: connection.id, operation: 'account.profile' });
      if (active.current) lopu({ title: `${connection.account.displayName} is connected`, status: 'success' });
    } catch (error: any) {
      if (active.current) lopu({ title: error?.error || 'Reconnect this account to restore access.', status: 'error' });
    } finally {
      if (active.current) setBusy(false);
    }
  };

  const connectForm = connecting ? (
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
            aria-label={field.label}
            value={fieldValues[field.key] || ''}
            placeholder={field.placeholder}
            type={field.secret ? 'password' : 'text'}
            autoComplete={field.secret ? 'off' : undefined}
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
        <Button
          size="sm"
          variant="ghost"
          borderRadius="999px"
          onClick={() => {
            setConnecting(null);
            setFieldValues({});
          }}
        >
          Cancel
        </Button>
      </Flex>
    </Box>
  ) : null;

  return (
    <PageShell width={1100} columnProps={{ rowGap: 8 }}>
      <Flex alignItems="baseline" justifyContent="space-between" flexWrap="wrap" rowGap={2}>
        <Box>
          <Text as="h1" fontSize="2xl" fontWeight="700">
            Third-party services
          </Text>
          <Text color="var(--tt-muted, #6b7280)" marginTop={1}>
            Your account library for connected services. Add multiple accounts, choose permissions, and reuse saved authorizations in Thingtime
            actions.
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

      <ServiceCatalog
        providers={providers.filter((provider) => provider.id === 'chatgpt')}
        connections={connections}
        signedOut={signedOut}
        busy={busy}
        openConnect={openConnect}
        unlink={unlink}
        verify={verifyConnection}
        form={connectForm}
        connectingId={connecting?.id}
      />
      <AIServiceAccounts key={ownerId || 'guest'} ownerId={ownerId} />
      <ServiceCatalog
        providers={providers.filter((provider) => provider.id !== 'chatgpt')}
        connections={connections}
        signedOut={signedOut}
        busy={busy}
        openConnect={openConnect}
        unlink={unlink}
        verify={verifyConnection}
        form={connectForm}
        connectingId={connecting?.id}
      />

      {/* virtual YouTube subscription list */}
      {!signedOut ? (
        <Box display="flex" flexDirection="column" rowGap={3}>
          <Box>
            <Text fontWeight="600">YouTube channels 📺</Text>
            <Text fontSize="sm" color="var(--tt-muted, #6b7280)">
              Your Thingtime-managed subscription list — every channel you add merges into one uploads feed.
              {ytSearchConfigured === false ? ' Name search needs a YouTube API key; channel IDs, URLs, and @handles work now.' : ''}
            </Text>
          </Box>
          {(youtubeConnection?.channels || []).map((channel) => (
            <Flex key={channel.id} {...cardStyle} padding={3} alignItems="center" columnGap={3}>
              {channel.thumbnail ? <Image src={channel.thumbnail} alt="" boxSize="28px" borderRadius="full" /> : <Text fontSize="lg">📺</Text>}
              <Text flex="1" fontWeight="500">
                {channel.title}
              </Text>
              <Button size="xs" variant="ghost" borderRadius="999px" onClick={() => unsubscribeChannel(channel)}>
                Unsubscribe
              </Button>
            </Flex>
          ))}
          <Flex {...cardStyle} padding={3} columnGap={2} alignItems="center" flexWrap="wrap" rowGap={2}>
            <Input
              flex="1"
              minWidth="200px"
              placeholder="Search channels, or paste a channel ID / URL / @handle"
              value={ytQuery}
              onChange={(event) => setYtQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') searchChannels();
              }}
            />
            <Button size="sm" borderRadius="999px" onClick={searchChannels} isLoading={ytBusy}>
              Search
            </Button>
          </Flex>
          {ytResults.map((channel) => (
            <Flex key={channel.id} {...cardStyle} padding={3} alignItems="center" columnGap={3}>
              {channel.thumbnail ? <Image src={channel.thumbnail} alt="" boxSize="28px" borderRadius="full" /> : <Text fontSize="lg">📺</Text>}
              <Text flex="1">{channel.title}</Text>
              <Button size="xs" borderRadius="999px" onClick={() => subscribeChannel(channel)} isLoading={ytBusy}>
                Subscribe ➕
              </Button>
            </Flex>
          ))}
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
              <Input
                flex="1"
                minWidth="160px"
                placeholder="Filter name (e.g. Sad news)"
                value={filterName}
                onChange={(event) => setFilterName(event.target.value)}
              />
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
    </PageShell>
  );
};
