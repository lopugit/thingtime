import React from 'react';
import { Box, Button, Flex, Image, Input, Select, Switch, Text, Textarea } from '@chakra-ui/react';
import { Link, useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { getElectronBridge } from '~/utils/electronBridge';
import { isNativeBridgeAvailable } from '~/utils/nativeBridge';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { ConnectionProviderIcon } from './ConnectionProviderIcon';
import { connectionIconUrl, CONNECTION_ICON_FEATURE, CONNECTION_ICON_VERSION } from '~/connections/providerIcons';
import { NamedConnectionPanel } from './NamedConnectionPanel';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { NAMED_CONNECTION_FEATURE, NAMED_CONNECTION_VERSION, type NamedConnectionInput } from '~/connections/namedAccess';
import { linkedConnectionBlocks, providerCatalogBlocks } from './providerCatalogBlocks';
import { oauthPendingBlocks } from './oauthPendingBlocks';
import { notifyConnectionOAuthReturn, openConnectionOAuthTab } from './oauthTab.client';
import { cardStyle, connectedProviderLabel, oauthErrorMessage, type ChannelRef, type Connection } from './shared';

// /connections — link third-party apps (Reddit, YouTube, Mastodon, Bluesky,
// RSS, …), manage the linked accounts, and manage AI feed filters. The feeds
// themselves render at /connections/feed with the native Thingtime
// comment/reaction overlay.

type Provider = {
  id: string;
  name: string;
  icon: string;
  auth: 'none' | 'oauth2' | 'credential';
  contentVisibility: 'public' | 'personal';
  about: string;
  configured: boolean;
  fields: { key: string; label: string; placeholder?: string; help?: string; required?: boolean; secret?: boolean }[];
};

type FeedFilter = {
  id: string;
  name: string;
  prompt: string;
  action: 'warn' | 'hide';
  enabled: boolean;
};

export const ConnectionsPage = () => {
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const desktop = getElectronBridge();
  const native = !!desktop || isNativeBridgeAvailable();
  const [desktopScope, setDesktopScope] = React.useState<{ generation: number; origin: string }>();
  React.useEffect(() => {
    if (!desktop?.getInfo || identity.pending) return;
    let current = true;
    void desktop.getInfo().then(info => {
      if (!current || !info.apiOrigin) return;
      const selected = new URL(info.apiOrigin);
      if (['https:', 'http:'].includes(selected.protocol) && !selected.username && !selected.password)
        setDesktopScope({ generation: identity.generation, origin: selected.origin });
    }).catch(() => {});
    return () => { current = false; };
  }, [desktop, identity.generation, identity.pending]);
  const apiOrigin = desktop ? (desktopScope?.generation === identity.generation ? desktopScope.origin : '') : origin;
  const ownerId = !identity.pending && user?.accountKind !== 'service' ? user?.id : undefined;
  const scopeKey = JSON.stringify([apiOrigin, ownerId, dataPlane]);
  return <ConnectionsSession key={JSON.stringify([scopeKey, identity.generation, identity.pending])}
    origin={origin} apiOrigin={apiOrigin} native={native} ownerId={ownerId} dataPlane={dataPlane} scopeKey={scopeKey} generation={identity.generation} />;
};

function ConnectionsSession({ origin, apiOrigin, native, ownerId, dataPlane, scopeKey, generation }: {
  origin: string; apiOrigin: string; native: boolean; ownerId?: string; dataPlane: string | null; scopeKey: string; generation: number;
}) {
  const api = useApi();
  const [providerIconOrigin, setProviderIconOrigin] = React.useState('');
  React.useEffect(() => {
    if (!origin) return;
    let current = true;
    // Icons are public presentation from the document origin, independent of
    // the API server selected for the signed-in account and OAuth actions.
    void requireThingtimeCapability(CONNECTION_ICON_FEATURE, CONNECTION_ICON_VERSION, origin).then(() => {
      if (current) setProviderIconOrigin(origin);
    }).catch(() => { /* Older or unavailable servers retain the local mark. */ });
    return () => { current = false; };
  }, [origin]);
  const providerIconsEnabled = !!origin && providerIconOrigin === origin;
  const lopu = useLopu();
  const notify = React.useRef(lopu);
  notify.current = lopu;
  const { providers: loadProviders, list: loadConnections, filters: loadFilters } = api.v1.connections;
  const providersCache = `tt-connections-providers:${apiOrigin}`;
  const connectionsCache = `tt-connections-list:${scopeKey}`;
  const filtersCache = `tt-connections-filters:${scopeKey}`;
  const request = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(false);
  const isCurrent = React.useCallback(() => {
    const identity = rootIdentity.read();
    return mounted.current && identity.generation === generation && (!ownerId || !identity.pending) && window.location.origin === origin;
  }, [generation, ownerId, origin]);
  const oauthAttempt = React.useRef<{ tab: NonNullable<ReturnType<typeof openConnectionOAuthTab>>; deadline: number } | null>(null);
  const [oauthProvider, setOAuthProvider] = React.useState<string | null>(null);

  const cancelOAuth = React.useCallback(() => {
    const attempt = oauthAttempt.current;
    if (!attempt) return;
    oauthAttempt.current = null;
    window.clearTimeout(attempt.deadline);
    attempt.tab.cancel();
  }, []);

  React.useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      cancelOAuth();
    };
  }, [cancelOAuth]);
  const [searchParams, setSearchParams] = useSearchParams();

  // optimistic first paint from the synchronous cache tier (house rule:
  // never flash a loading state when prior state exists)
  const [providers, setProviders] = React.useState<Provider[]>(() => apiOrigin ? readLocalCache<Provider[]>(providersCache) || [] : []);
  const [connections, setConnections] = React.useState<Connection[]>(() => ownerId && apiOrigin ? readLocalCache<Connection[]>(connectionsCache) || [] : []);
  const [filters, setFilters] = React.useState<FeedFilter[]>(() => ownerId && apiOrigin ? readLocalCache<FeedFilter[]>(filtersCache) || [] : []);
  const [signedOut, setSignedOut] = React.useState(!ownerId);

  const [namedAvailable, setNamedAvailable] = React.useState(false);
  const [namedCredential, setNamedCredential] = React.useState<NamedConnectionInput>();
  const [connecting, setConnecting] = React.useState<Provider | null>(null);
  const [fieldValues, setFieldValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const [filterName, setFilterName] = React.useState('');
  const [filterPrompt, setFilterPrompt] = React.useState('');
  const [filterAction, setFilterAction] = React.useState<'warn' | 'hide'>('warn');

  const refresh = React.useCallback(async () => {
    if (!apiOrigin || !isCurrent()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    const active = () => isCurrent() && !signal.aborted && request.current === controller;
    const denied = (error: { status?: number }) => [401, 403, 409].includes(error?.status ?? 0);
    const report = (error: { error?: string }) => {
      if (active()) notify.current({ title: error?.error || 'Could not load your connections 😞', status: 'error' });
    };
    const privateFailure = (error: { status?: number; error?: string }) => {
      if (!active()) return;
      if (!denied(error)) return report(error);
      setSignedOut(true);
      cancelOAuth();
      setOAuthProvider(null);
      setConnections([]);
      setFilters([]);
      clearLocalCache(connectionsCache);
      clearLocalCache(filtersCache);
      controller.abort();
    };
    const pending: Promise<unknown>[] = [
      loadProviders({ signal, expectedApiOrigin: apiOrigin }).then(response => {
        if (!active()) return;
        const providers = response.providers || [];
        setProviders(providers);
        writeLocalCache(providersCache, providers);
      }).catch(report)
    ];
    if (ownerId) {
      const options = { signal, expectedActor: ownerId, expectedApiOrigin: apiOrigin, expectedDataPlane: dataPlane };
      pending.push(requireThingtimeCapability(NAMED_CONNECTION_FEATURE, NAMED_CONNECTION_VERSION)
        .then(() => true, () => false).then(includeNamed => {
          if (!active()) return null;
          setNamedAvailable(includeNamed);
          return loadConnections(options, includeNamed);
        }).then(response => {
        if (!active() || !response) return;
        const connections = response.connections || [];
        setSignedOut(false);
        setConnections(connections);
        if (apiOrigin) writeLocalCache(connectionsCache, connections);
      }).catch(privateFailure));
      pending.push(loadFilters(options).then(response => {
        if (!active()) return;
        const filters = response.filters || [];
        setFilters(filters);
        if (apiOrigin) writeLocalCache(filtersCache, filters);
      }).catch(privateFailure));
    }
    await Promise.all(pending);
  }, [apiOrigin, cancelOAuth, connectionsCache, dataPlane, filtersCache, isCurrent, loadConnections, loadFilters, loadProviders, ownerId, providersCache]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  // OAuth callback landing: /connections?connected=<provider id> or
  // ?oauthError=<code>. Neither is rendered verbatim — both are untrusted URL
  // input, so the copy comes from ./shared and the param only selects it.
  React.useEffect(() => {
    const connected = searchParams.get('connected');
    const code = searchParams.get('oauthError');
    const failure = oauthErrorMessage(code);
    if (!connected && !failure) return;
    notifyConnectionOAuthReturn(connected, code);
    if (connected) {
      const label = connectedProviderLabel(connected, providers);
      lopu({ title: label ? `Account linked via ${label} 🎉` : 'Account linked 🎉', status: 'success', duration: 6000 });
      refresh();
    } else if (failure) {
      lopu({ title: failure, status: 'error' });
    }
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('connected');
    remaining.delete('oauthError');
    setSearchParams(remaining, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openConnect = async (provider: Provider, named?: NamedConnectionInput) => {
    if (!apiOrigin || !isCurrent()) return;
    if (provider.auth === 'oauth2') {
      if (oauthAttempt.current || !ownerId || !isCurrent()) return;
      // Electron delegates external navigation to the system browser and
      // denies window.open handles. Preserve the original host handoff.
      if (native || getElectronBridge() || isNativeBridgeAvailable()) {
        setBusy(true);
        try {
          const response = await api.v1.connections.oauthBegin({ provider: provider.id, expectedOwnerId: ownerId, expectedApiOrigin: apiOrigin, named });
          if (isCurrent() && response?.authorizeUrl) window.location.href = response.authorizeUrl;
        } catch (error: any) {
          if (isCurrent()) lopu({ title: error?.error || `Could not start the ${provider.name} sign-in`, status: 'error' });
        } finally {
          if (isCurrent()) setBusy(false);
        }
        return;
      }
      let tab: ReturnType<typeof openConnectionOAuthTab> = null;
      try {
        tab = openConnectionOAuthTab(provider.id, (result) => {
          const attempt = oauthAttempt.current;
          if (!attempt || attempt.tab !== tab || !isCurrent()) return false;
          oauthAttempt.current = null;
          window.clearTimeout(attempt.deadline);
          setOAuthProvider(null);
          if (result.status === 'failed') {
            lopu({ title: oauthErrorMessage(result.code) || 'Could not finish sign-in', status: 'error' });
          } else {
            void refresh();
          }
          return true;
        });
        if (!tab) {
          lopu({ title: 'Allow pop-ups for Thingtime, then try signing in again', status: 'info' });
          return;
        }
        const deadline = window.setTimeout(() => {
          if (oauthAttempt.current?.tab !== tab) return;
          cancelOAuth();
          setOAuthProvider(null);
          lopu({ title: 'Sign-in timed out. You can try again.', status: 'info' });
          void refresh();
        }, 15 * 60 * 1000);
        oauthAttempt.current = { tab, deadline };
        setOAuthProvider(provider.name);

        const resp = await api.v1.connections.oauthBegin({ provider: provider.id, expectedOwnerId: ownerId, expectedApiOrigin: apiOrigin, named });
        if (oauthAttempt.current?.tab !== tab || !isCurrent()) return;
        if (!resp?.authorizeUrl || !tab.navigate(resp.authorizeUrl)) {
          cancelOAuth();
          setOAuthProvider(null);
          lopu({ title: 'Sign-in tab closed. You can try again.', status: 'info' });
        }
      } catch (err: any) {
        if (tab && oauthAttempt.current?.tab !== tab) return;
        cancelOAuth();
        setOAuthProvider(null);
        lopu({ title: err?.error || `Could not start the ${provider.name} sign-in`, status: 'error' });
      }
      return;
    }
    setNamedCredential(named);
    setConnecting(provider);
    setFieldValues({});
  };

  const submitConnect = async () => {
    if (!connecting) return;
    setBusy(true);
    try {
      const resp = await api.v1.connections.connect({ provider: connecting.id, fields: fieldValues, named: namedCredential, expectedOwnerId: ownerId, expectedApiOrigin: apiOrigin });
      lopu({
        title: resp.alreadyLinked
          ? `Already connected to ${resp.connection?.account?.displayName} ✨`
          : `Connected to ${resp.connection?.account?.displayName} 🎉`,
        status: 'success',
        duration: 6000
      });
      setConnecting(null);
      setNamedCredential(undefined);
      await refresh();
    } catch (err: any) {
      lopu({ title: err?.error || `Could not connect ${connecting.name} 😞`, status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (connection: Connection) => {
    // optimistic remove, restore on failure
    setConnections((current) => current.filter((entry) => entry.id !== connection.id));
    try {
      await api.v1.connections.unlink({ id: connection.id, named: !!connection.named, expectedOwnerId: ownerId, expectedApiOrigin: apiOrigin });
      if (!isCurrent() || !apiOrigin) return;
      setConnections(current => {
        const next = current.filter(entry => entry.id !== connection.id);
        writeLocalCache(connectionsCache, next);
        return next;
      });
      lopu({ title: `Unlinked ${connection.account.displayName} 👋`, status: 'success', duration: 5000 });
    } catch (err: any) {
      if (!isCurrent()) return;
      setConnections(current => current.some(entry => entry.id === connection.id) ? current : [...current, connection]);
      lopu({ title: err?.error || 'Could not unlink that connection 😞', status: 'error' });
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
        if (apiOrigin && isCurrent()) writeLocalCache(filtersCache, next);
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
      if (apiOrigin && isCurrent()) writeLocalCache(filtersCache, next);
      return next;
    });
    try {
      await api.v1.connections.saveFilter({ id: filter.id, enabled: !filter.enabled });
    } catch (err: any) {
      // revert only THIS filter's toggle — a snapshot restore would discard
      // concurrent changes to other filters
      setFilters((current) => {
        const next = current.map((entry) => (entry.id === filter.id ? { ...entry, enabled: filter.enabled } : entry));
        if (apiOrigin && isCurrent()) writeLocalCache(filtersCache, next);
        return next;
      });
      lopu({ title: err?.error || 'Could not update that filter 😞', status: 'error' });
    }
  };

  const removeFilter = async (filter: FeedFilter) => {
    setFilters((current) => {
      const next = current.filter((entry) => entry.id !== filter.id);
      if (apiOrigin && isCurrent()) writeLocalCache(filtersCache, next);
      return next;
    });
    try {
      await api.v1.connections.removeFilter({ id: filter.id });
    } catch (err: any) {
      // restore only the removed entry
      setFilters((current) => {
        const next = current.some((entry) => entry.id === filter.id) ? current : [...current, filter];
        if (apiOrigin && isCurrent()) writeLocalCache(filtersCache, next);
        return next;
      });
      lopu({ title: err?.error || 'Could not remove that filter 😞', status: 'error' });
    }
  };

  const canConnect = (provider: Provider) => provider.configured && !signedOut && !busy &&
    (provider.auth !== 'oauth2' || (!!ownerId && !oauthProvider));
  const providerRows = providers.map(provider => ({
    id: provider.id, name: provider.name, about: provider.about,
    iconUrl: connectionIconUrl(provider.id, providerIconsEnabled),
    disabled: !canConnect(provider), buttonOpacity: canConnect(provider) ? 1 : 0.55,
    buttonBackground: connecting?.id === provider.id ? 'var(--tt-border, #e2e8f0)' : 'transparent',
    buttonLabel: !provider.configured ? 'Needs setup' : provider.auth === 'oauth2' ? `Default sign-in with ${provider.name}` :
      provider.auth === 'credential' ? 'Connect default account' : 'Connect',
  }));
  const legacyConnections = connections.filter(connection => !connection.named);
  const linkedRows = legacyConnections.map(connection => ({
    id: connection.id, displayName: connection.account.displayName,
    providerLabel: `${connection.providerName}${connection.contentVisibility === 'personal' ? ' · personal feed' : ''}`,
    subtitle: `${connection.account.handle}${connection.lastSyncError ? ' · Feed sync needs attention' : ''}`,
    iconUrl: connectionIconUrl(connection.provider, providerIconsEnabled),
    feedHref: `/connections/feed?connection=${encodeURIComponent(connection.id)}`,
  }));
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
      {!signedOut && legacyConnections.length ? (
        <Box display="flex" flexDirection="column" rowGap={3}>
          <Text fontWeight="600">Your connections</Text>
          <SettingsDocumentHost documentKey="connections-linked-accounts" title="Linked connection cards" editLayoutLabel="Edit linked accounts"
            defaultDocument={linkedConnectionBlocks} scopeKey={scopeKey} allowMediaUploads>
            {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing}
              scope={{ linked: { rows: linkedRows }, ...(editing && { item: linkedRows[0] }) }} actions={{ unlink: ({ inputs }) => {
                const connection = legacyConnections.find(candidate => candidate.id === inputs.connectionId);
                if (connection && isCurrent()) return unlink(connection);
              } }}>
              <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
            </TransientBlockHost>}
          </SettingsDocumentHost>
        </Box>
      ) : null}

      {ownerId && !signedOut && namedAvailable ? (
        <NamedConnectionPanel scopeKey={scopeKey} providers={providers} connections={connections} busy={busy || !!oauthProvider}
          start={(providerId, named) => {
            const provider = providers.find(item => item.id === providerId && item.configured);
            if (provider) void openConnect(provider, named);
          }}
          remove={unlink}
          use={async (id, operation) => {
            const response = await api.v1.connections.useNamed({ id, operation, expectedOwnerId: ownerId, expectedApiOrigin: apiOrigin });
            return isCurrent() ? response?.result : undefined;
          }}
          onError={(error: any) => lopu({ title: error?.error || error?.message || 'Could not use the connection.', status: 'error' })}
        />
      ) : null}

      {/* provider catalog */}
      <Box display="flex" flexDirection="column" rowGap={3}>
        <Text fontWeight="600">Connect a 3rd party app</Text>
        {ownerId && !signedOut && !native ? (
          <SettingsDocumentHost documentKey="connections-oauth-pending" title="Connection sign-in layout" editLayoutLabel="Edit sign-in status" defaultDocument={oauthPendingBlocks} scopeKey={scopeKey}>
            {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} scope={{ oauth: { pending: !!oauthProvider || editing, provider: oauthProvider || 'your provider' } }}
              actions={{ stop: () => {
                cancelOAuth();
                setOAuthProvider(null);
                void refresh();
              } }}>
              <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
            </TransientBlockHost>}
          </SettingsDocumentHost>
        ) : null}
        <SettingsDocumentHost documentKey="connections-provider-catalog" title="Connection provider cards" editLayoutLabel="Edit provider cards" defaultDocument={providerCatalogBlocks}
          scopeKey={scopeKey} showLayoutControls={!!ownerId && !signedOut} allowMediaUploads>
          {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing}
            scope={{ catalog: { providers: providerRows }, ...(editing && { item: providerRows[0] }) }} actions={{ connect: ({ inputs }) => {
              const provider = providers.find(candidate => candidate.id === inputs.provider);
              if (provider && canConnect(provider)) return openConnect(provider);
            } }}>
            <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
          </TransientBlockHost>}
        </SettingsDocumentHost>
      </Box>

      {/* connect form */}
      {connecting ? (
        <Box {...cardStyle} padding={5} display="flex" flexDirection="column" rowGap={3}>
          <Flex alignItems="center" columnGap={2}>
            <ConnectionProviderIcon provider={connecting.id} enabled={providerIconsEnabled} />
            <Text fontWeight="600">Connect {connecting.name}</Text>
          </Flex>
          {connecting.fields.map((field) => (
            <Box key={field.key}>
              <Text fontSize="sm" fontWeight="500" marginBottom={1}>
                {field.label}
                {field.required ? ' *' : ''}
              </Text>
              <Input
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
            <Button size="sm" variant="ghost" borderRadius="999px" onClick={() => setConnecting(null)}>
              Cancel
            </Button>
          </Flex>
        </Box>
      ) : null}

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
