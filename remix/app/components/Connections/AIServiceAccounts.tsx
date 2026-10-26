import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { aiServiceBlocks } from './aiServiceBlocks';
import { useLopu } from '../Lopu/useLopu';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';

// These rows use the existing Secure Vault: a saved account is immediately
// selectable in Lopu, without a duplicate credential store or copied secret.
const services = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '✳️',
    endpoint: 'https://api.openai.com/v1',
    about: 'Save separate OpenAI API connections for personal and work projects. API usage has separate provider billing.',
    credentialLabel: 'OpenAI API key',
    cardTitle: 'OpenAI API',
    dashboard: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic',
    name: 'Claude',
    icon: '✴️',
    endpoint: 'https://api.anthropic.com',
    about: 'Save a Claude Code OAuth token for the Claude Code runtime in Lopu. Generate it with claude setup-token in your own terminal.',
    credentialLabel: 'Claude Code OAuth token',
    cardTitle: 'Claude Code',
    dashboard: 'https://code.claude.com/docs/en/cli-reference'
  }
];
type Entry = { id: string; name: string; kind: string; provider?: string; endpoint?: string };
export function AIServiceAccounts({ ownerId }: { ownerId: string | null }) {
  const cacheKey = `tt-service-ai:v1:${typeof window === 'undefined' ? '' : window.location.origin}:${ownerId || 'guest'}`;
  const [entries, setEntries] = React.useState<Entry[]>(() => (ownerId ? readLocalCache<Entry[]>(cacheKey) || [] : []));
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const live = React.useRef(true);
  const generation = React.useRef(0);
  const lopu = useLopu();
  const refresh = React.useCallback(async () => {
    if (!ownerId) return;
    const current = ++generation.current;
    const response = await fetch('/api/v1/lopu/vault', { credentials: 'include', cache: 'no-store' });
    const result = await response.json();
    if (!live.current || current !== generation.current) return;
    if (!response.ok || !result.ok) throw new Error('Your AI accounts could not be loaded.');
    if (result.ownerId !== ownerId) {
      setEntries([]);
      setConfigured(false);
      return;
    }
    const accounts = (result.entries || []).filter(
      (entry: Entry) => entry.kind === 'provider' && services.some((service) => service.id === entry.provider)
    );
    setEntries(accounts);
    setConfigured(result.vaultConfigured === true);
    writeLocalCache(cacheKey, accounts);
  }, [ownerId, cacheKey]);
  React.useEffect(() => {
    live.current = true;
    const load = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => {});
    };
    void refresh().catch(() => {});
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      live.current = false;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [refresh]);
  const save = async (service: (typeof services)[number], name: string, token: string, signal: AbortSignal) => {
    setBusy(true);
    generation.current++;
    try {
      await requireThingtimeCapability('api.lopu-vault', '1.4.0');
      if (service.id === 'anthropic' && !token.trim().startsWith('sk-ant-oat'))
        throw new Error('Enter a Claude Code OAuth token. This connection does not accept Anthropic API keys.');
      if (!live.current || signal.aborted) return;
      const response = await fetch('/api/v1/lopu/vault', {
        method: 'POST',
        signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-provider', expectedOwnerId: ownerId, provider: service.id, endpoint: service.endpoint, name, token })
      });
      const result = await response.json();
      if (!live.current || signal.aborted) return;
      if (!response.ok || !result.ok) throw new Error(result.error || 'The account could not be saved.');
      setSelected(null);
      await refresh();
      if (!live.current) return;
      lopu({ title: `${service.name} account saved`, description: 'Choose this connection in Lopu’s model picker.', status: 'success' });
    } catch (error) {
      if (live.current && !signal.aborted)
        lopu({ title: 'Account could not be saved', description: error instanceof Error ? error.message : 'Try again.', status: 'error' });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const remove = async (entry: Entry, signal: AbortSignal) => {
    setBusy(true);
    generation.current++;
    try {
      await requireThingtimeCapability('api.lopu-vault', '1.3.0');
      if (!live.current || signal.aborted) return;
      const response = await fetch('/api/v1/lopu/vault', {
        method: 'POST',
        signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: entry.id, expectedOwnerId: ownerId })
      });
      const result = await response.json();
      if (!live.current || signal.aborted) return;
      if (!response.ok || !result.ok) throw new Error(result.error || 'The account could not be removed.');
      await refresh();
      if (!live.current) return;
      lopu({ title: 'Saved account removed', status: 'success' });
    } catch (error) {
      if (live.current && !signal.aborted)
        lopu({ title: 'Account could not be removed', description: error instanceof Error ? error.message : 'Try again.', status: 'error' });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const actions: TransientBlockActions = {
    'ai.add': ({ inputs, signal }) => {
      signal.throwIfAborted();
      if (!busy && ownerId && configured && services.some(service => service.id === inputs.id)) setSelected(String(inputs.id));
    },
    'ai.cancel': ({ signal }) => { signal.throwIfAborted(); if (!busy) setSelected(null); },
    'ai.remove': ({ inputs, signal }) => {
      signal.throwIfAborted();
      const entry = entries.find(item => item.id === inputs.id);
      if (!busy && ownerId && entry) return remove(entry, signal);
    },
    'ai.save': ({ inputs, readField, signal }) => {
      signal.throwIfAborted();
      const service = services.find(item => item.id === inputs.id);
      if (busy || !ownerId || !configured || !service || selected !== service.id) return;
      const name = readField('accountName'), token = readField('accountToken');
      if (typeof name !== 'string' || !name.trim() || typeof token !== 'string' || !token.trim()) return;
      return save(service, name, token, signal);
    }
  };
  const scope = { ai: { busy, services: services.map(service => ({
    id: service.id, name: service.name, icon: service.icon, cardTitle: service.cardTitle, about: service.about,
    credentialLabel: service.credentialLabel, dashboard: service.dashboard,
    guide: service.id === 'openai' ? 'Open OpenAI developer keys' : 'Claude token setup guide',
    cannotAdd: !ownerId || !configured || busy, needsSetup: !!ownerId && configured === false,
    selected: selected === service.id,
    entries: entries.filter(entry => entry.provider === service.id).map(entry => ({ id: entry.id, name: entry.name }))
  })) } };
  return <SettingsDocumentHost documentKey="services-ai" defaultDocument={aiServiceBlocks} scopeKey={cacheKey} title="AI account layout">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${cacheKey}:${selected || ''}`} scope={scope} actions={actions} enabled={!editing}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
