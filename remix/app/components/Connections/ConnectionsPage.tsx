import React from 'react';
import { useSearchParams } from 'react-router';

import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { PageShell } from '~/components/Layout/PageShell';
import { AIServiceAccounts } from './AIServiceAccounts';
import { ConnectionsDocument } from './ConnectionsDocument';
import { connectionsOverviewBlocks, connectionToolsBlocks } from './connectionToolsBlocks';
import type { TransientBlockActions } from '../Builder/TransientBlockHost';
import { ServiceCatalog, type Provider } from './ServiceCatalog';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { connectedProviderLabel, oauthErrorMessage, type ChannelRef, type Connection } from './shared';

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
  const [busy, setBusy] = React.useState(false);

  const [filterName, setFilterName] = React.useState('');
  const [filterPrompt, setFilterPrompt] = React.useState('');
  const [filterAction, setFilterAction] = React.useState<'warn' | 'hide'>('warn');

  const refresh = React.useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      await requireThingtimeCapability('api.connections-providers', '2.0.0');
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

  const openConnect = async (provider: Provider, signal?: AbortSignal) => {
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
        await requireThingtimeCapability('api.connections-oauth-begin', '2.0.0');
        if (!active.current || signal?.aborted) { tab.close(); return; }
        const resp = await api.v1.connections.oauthBegin({ provider: provider.id, expectedOwnerId: ownerId, signal });
        if (!active.current || signal?.aborted) {
          tab.close();
          return;
        }
        if (!resp?.authorizeUrl || new URL(resp.authorizeUrl).protocol !== 'https:') throw new Error('Invalid sign-in URL');
        tab.location.replace(resp.authorizeUrl);
      } catch (err: any) {
        tab.close();
        if (!active.current || signal?.aborted) return;
        lopu({ title: err?.error || `Could not start the ${provider.name} sign-in 😞`, status: 'error' });
      } finally {
        if (active.current) setBusy(false);
      }
      return;
    }
    setConnecting(provider);
  };

  const submitConnect = async (fieldValues: Record<string, string>, signal?: AbortSignal) => {
    if (!connecting) return;
    setBusy(true);
    try {
      await requireThingtimeCapability('api.connections', '2.0.0');
      if (!active.current || signal?.aborted) return;
      const resp = await api.v1.connections.connect({ provider: connecting.id, fields: fieldValues, expectedOwnerId: ownerId, signal });
      if (!active.current || signal?.aborted) return;
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
      if (!active.current || signal?.aborted) return;
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
      if (!active.current) return;
      setYtResults(resp.channels || []);
      setYtSearchConfigured(resp.searchConfigured !== false);
      if (!(resp.channels || []).length) {
        lopu({ title: 'No channels matched that — try a channel ID or URL 🔍', status: 'info', duration: 5000 });
      }
    } catch (err: any) {
      if (!active.current) return;
      lopu({ title: err?.error || 'Channel search failed 😞', status: 'error' });
    } finally {
      if (active.current) setYtBusy(false);
    }
  };

  const subscribeChannel = async (channel: ChannelRef) => {
    setYtBusy(true);
    try {
      const resp = await api.v1.connections.youtubeChannels({ add: channel });
      if (!active.current) return;
      lopu({ title: `Subscribed to ${channel.title} 📺`, status: 'success', duration: 5000 });
      setYtResults((current) => current.filter((entry) => entry.id !== channel.id));
      setConnections((current) => {
        const others = current.filter((entry) => entry.id !== resp.connection?.id);
        return resp.connection ? [...others, resp.connection] : current;
      });
      await refresh();
    } catch (err: any) {
      if (!active.current) return;
      lopu({ title: err?.error || `Could not subscribe to ${channel.title} 😞`, status: 'error' });
    } finally {
      if (active.current) setYtBusy(false);
    }
  };

  const unsubscribeChannel = async (channel: ChannelRef) => {
    try {
      await api.v1.connections.youtubeChannels({ remove: channel.id });
      if (!active.current) return;
      await refresh();
    } catch (err: any) {
      if (!active.current) return;
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
      if (!active.current) return;
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
      if (!active.current) return;
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
      if (!active.current) return;
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
      if (!active.current) return;
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
      await requireThingtimeCapability('api.connections-request', '2.0.0');
      if (!active.current) return;
      await api.v1.connections.request({ connectionId: connection.id, operation: 'account.profile' });
      if (active.current) lopu({ title: `${connection.account.displayName} is connected`, status: 'success' });
    } catch (error: any) {
      if (active.current) lopu({ title: error?.error || 'Reconnect this account to restore access.', status: 'error' });
    } finally {
      if (active.current) setBusy(false);
    }
  };


  const toolActions: TransientBlockActions = {
    'channels.query': ({ value }) => { if (typeof value === 'string') setYtQuery(value); },
    'channels.search': ({ signal }) => { signal.throwIfAborted(); if (!signedOut && !ytBusy) return searchChannels(); },
    'channels.subscribe': ({ inputs, signal }) => { signal.throwIfAborted(); const channel = ytResults.find(item => item.id === inputs.id); if (!signedOut && !ytBusy && channel) return subscribeChannel(channel); },
    'channels.unsubscribe': ({ inputs, signal }) => { signal.throwIfAborted(); const channel = youtubeConnection?.channels?.find(item => item.id === inputs.id); if (!signedOut && !ytBusy && channel) return unsubscribeChannel(channel); },
    'filters.name': ({ value }) => { if (typeof value === 'string') setFilterName(value); },
    'filters.prompt': ({ value }) => { if (typeof value === 'string') setFilterPrompt(value); },
    'filters.action': ({ value }) => { if (value === 'warn' || value === 'hide') setFilterAction(value); },
    'filters.create': ({ signal }) => { signal.throwIfAborted(); if (!signedOut) return createFilter(); },
    'filters.toggle': ({ inputs, signal }) => { signal.throwIfAborted(); const filter = filters.find(item => item.id === inputs.id); if (!signedOut && filter) return toggleFilter(filter); },
    'filters.remove': ({ inputs, signal }) => { signal.throwIfAborted(); const filter = filters.find(item => item.id === inputs.id); if (!signedOut && filter) return removeFilter(filter); }
  };

  return (
    <PageShell width={1100} columnProps={{ rowGap: 8 }}>
      <ConnectionsDocument documentKey="connections-overview" blocks={connectionsOverviewBlocks} scopeKey={cacheScope} scope={{ page: { signedOut } }} />

      <ServiceCatalog
        documentKey="services-chatgpt"
        providers={providers.filter((provider) => provider.id === 'chatgpt')}
        connections={connections}
        signedOut={signedOut}
        busy={busy}
        openConnect={openConnect}
        unlink={unlink}
        verify={verifyConnection}
        submitConnect={submitConnect}
        cancelConnect={() => setConnecting(null)}
        connectingId={connecting?.id}
      />
      <AIServiceAccounts key={ownerId || 'guest'} ownerId={ownerId} />
      <ServiceCatalog
        documentKey="services-catalog"
        providers={providers.filter((provider) => provider.id !== 'chatgpt')}
        connections={connections}
        signedOut={signedOut}
        busy={busy}
        openConnect={openConnect}
        unlink={unlink}
        verify={verifyConnection}
        submitConnect={submitConnect}
        cancelConnect={() => setConnecting(null)}
        connectingId={connecting?.id}
      />

      <ConnectionsDocument documentKey="connections-tools" blocks={connectionToolsBlocks} scopeKey={cacheScope} actions={toolActions}
        scope={{ page: { signedOut, signedIn: !signedOut },
          channels: { busy: ytBusy, query: ytQuery, needsSetup: ytSearchConfigured === false,
            saved: (youtubeConnection?.channels || []).map(({ id, title, thumbnail }) => ({ id, title, thumbnail })),
            results: ytResults.map(({ id, title, thumbnail }) => ({ id, title, thumbnail })) },
          filters: { name: filterName, prompt: filterPrompt, action: filterAction,
            items: filters.map(({ id, name, prompt, action, enabled }) => ({ id, name, prompt, enabled, actionLabel: action === 'warn' ? 'warn + Show button' : 'hide' })) } }} />
    </PageShell>
  );
};
