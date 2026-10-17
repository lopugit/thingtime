import React from 'react';
import { Badge, Box, Button, Flex, Input, Text } from '@chakra-ui/react';
import { Link } from 'react-router';
import { useLopu } from '../Lopu/useLopu';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { cardStyle } from './shared';

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
    about: 'Save a Claude Code OAuth token for the existing Claude runtime in Lopu. Generate it with claude setup-token in your own terminal.',
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
  const [name, setName] = React.useState('');
  const [token, setToken] = React.useState('');
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
  const save = async (service: (typeof services)[number]) => {
    setBusy(true);
    generation.current++;
    try {
      await requireThingtimeCapability('api.lopu-vault', '1.3.0');
      if (service.id === 'anthropic' && !token.trim().startsWith('sk-ant-oat'))
        throw new Error('Enter a Claude Code OAuth token. This connection does not accept Anthropic API keys.');
      if (!live.current) return;
      const response = await fetch('/api/v1/lopu/vault', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-provider', expectedOwnerId: ownerId, provider: service.id, endpoint: service.endpoint, name, token })
      });
      const result = await response.json();
      if (!live.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || 'The account could not be saved.');
      setToken('');
      setSelected(null);
      await refresh();
      lopu({ title: `${service.name} account saved`, description: 'Choose this connection in Lopu’s model picker.', status: 'success' });
    } catch (error) {
      if (live.current)
        lopu({ title: 'Account could not be saved', description: error instanceof Error ? error.message : 'Try again.', status: 'error' });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const remove = async (entry: Entry) => {
    setBusy(true);
    generation.current++;
    try {
      await requireThingtimeCapability('api.lopu-vault', '1.3.0');
      if (!live.current) return;
      const response = await fetch('/api/v1/lopu/vault', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: entry.id, expectedOwnerId: ownerId })
      });
      const result = await response.json();
      if (!live.current) return;
      if (!response.ok || !result.ok) throw new Error(result.error || 'The account could not be removed.');
      await refresh();
      lopu({ title: 'Saved account removed', status: 'success' });
    } catch (error) {
      if (live.current)
        lopu({ title: 'Account could not be removed', description: error instanceof Error ? error.message : 'Try again.', status: 'error' });
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <>
      {services.map((service) => (
        <Box as="section" key={service.id} aria-labelledby={`ai-${service.id}`}>
          <Text as="h2" id={`ai-${service.id}`} fontSize="xl" fontWeight="700" mb={4}>
            {service.icon} {service.name}
          </Text>
          <Box display="grid" gridTemplateColumns="minmax(0, 1fr)" gap={4}>
            <Box as="article" {...cardStyle} p={5}>
              <Text as="h3" fontWeight="700">
                {service.cardTitle}
              </Text>
              <Text fontSize="sm" mt={2} color="var(--tt-muted)">
                {service.about}
              </Text>
              {entries
                .filter((entry) => entry.provider === service.id)
                .map((entry) => (
                  <Flex key={entry.id} gap={2} align="center" wrap="wrap" borderTop="1px solid var(--tt-border)" mt={3} pt={3}>
                    <Text fontSize="sm" flex="1" overflowWrap="anywhere">
                      {entry.name}
                    </Text>
                    <Badge>Saved privately</Badge>
                    <Button as={Link} to="/settings#secure-vault" size="xs" variant="ghost">
                      Manage
                    </Button>
                    <Button size="xs" variant="ghost" isDisabled={busy} onClick={() => remove(entry)} aria-label={`Remove ${entry.name} account`}>
                      Remove
                    </Button>
                  </Flex>
                ))}
              <Button
                mt={4}
                size="sm"
                variant="outline"
                isDisabled={!ownerId || !configured || busy}
                aria-label={`Add ${service.name} account`}
                onClick={() => {
                  setSelected(service.id);
                  setName('');
                  setToken('');
                }}
              >
                + Add account
              </Button>
              {ownerId && configured === false && (
                <Text mt={2} fontSize="xs" color="var(--tt-muted)">
                  Secure storage must be available before adding an API account.
                </Text>
              )}
              {selected === service.id && (
                <Box
                  as="form"
                  mt={4}
                  onSubmit={(event: React.FormEvent) => {
                    event.preventDefault();
                    void save(service);
                  }}
                >
                  <Text as="label" htmlFor={`ai-name-${service.id}`} fontSize="sm">
                    Account name
                  </Text>
                  <Input
                    id={`ai-name-${service.id}`}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    placeholder="Personal, Work…"
                    required
                    isDisabled={busy}
                  />
                  <Text as="label" htmlFor={`ai-token-${service.id}`} fontSize="sm" display="block" mt={3}>
                    {service.credentialLabel}
                  </Text>
                  <Input
                    id={`ai-token-${service.id}`}
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    maxLength={32768}
                    required
                    isDisabled={busy}
                  />
                  <Text mt={2} fontSize="xs">
                    <a href={service.dashboard} target="_blank" rel="noopener noreferrer">
                      {service.id === 'openai' ? 'Open OpenAI developer keys' : 'Claude token setup guide'} ↗
                    </a>
                  </Text>
                  <Flex mt={3} gap={2}>
                    <Button size="sm" type="submit" isDisabled={busy || !name.trim() || !token.trim()}>
                      Save account
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      onClick={() => {
                        setSelected(null);
                        setToken('');
                      }}
                    >
                      Cancel
                    </Button>
                  </Flex>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      ))}
    </>
  );
}
