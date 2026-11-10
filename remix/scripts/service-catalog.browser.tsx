// Synthetic identities only; the runner enforces a kernel network boundary.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, Box } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingtimeContext } from '../app/Providers/ThingtimeProvider';
import { ServiceCatalog, type Provider } from '../app/components/Connections/ServiceCatalog';
import { AIServiceAccounts } from '../app/components/Connections/AIServiceAccounts';
import { ConnectionsDocument } from '../app/components/Connections/ConnectionsDocument';
import { connectionsOverviewBlocks, connectionToolsBlocks } from '../app/components/Connections/connectionToolsBlocks';
import type { TransientBlockActions } from '../app/components/Builder/TransientBlockHost';
import { useApi } from '../app/hooks/useApi';
import type { Connection } from '../app/components/Connections/shared';
Object.defineProperty(window, 'SharedWorker', { value: undefined });
Object.defineProperty(navigator, 'onLine', { get: () => true });
const owner = 'synthetic-service-owner';
const providers: Provider[] = [
  { id: 'google-drive', name: 'Google Drive', icon: '📁', auth: 'oauth2', contentVisibility: 'personal', about: 'Private files from the selected account', configured: true, fields: [], service: { id: 'google', name: 'Google', icon: 'G', about: 'Separate saved accounts' } },
  { id: 'google-mail', name: 'Google Mail', icon: '✉', auth: 'oauth2', contentVisibility: 'personal', about: 'Mail permissions', configured: true, fields: [], service: { id: 'google', name: 'Google', icon: 'G', about: 'Separate saved accounts' } },
  { id: 'app-password', name: 'App password', icon: '🔑', auth: 'credential', contentVisibility: 'personal', about: 'Synthetic credential form', configured: true, fields: [{ key: 'login', label: 'Login', required: true }, { key: 'password', label: 'App password', secret: true, required: true }] }
];
const initial: Connection[] = ['one', 'two'].map(id => ({ id, provider: 'google-drive', providerName: 'Google Drive', providerIcon: '📁', contentVisibility: 'personal', auth: 'oauth2', account: { id, displayName: `Account ${id}`, handle: `${id}@example.test`, avatarUrl: null, profileUrl: null }, credentialStatus: 'connected', scopes: ['drive.readonly'], lastSyncedAt: null, lastSyncError: null }));
function App() {
  (window as any).__connectionsApi = useApi().v1.connections;
  const [connections, setConnections] = React.useState(initial);
  const [connecting, setConnecting] = React.useState<string>();
  const [events, setEvents] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const [channelResults, setChannelResults] = React.useState<{ id: string; title: string }[]>([]);
  const [channels, setChannels] = React.useState<{ id: string; title: string }[]>([]);
  const [filterName, setFilterName] = React.useState('');
  const [filterPrompt, setFilterPrompt] = React.useState('');
  const [filterAction, setFilterAction] = React.useState('warn');
  const [filters, setFilters] = React.useState<{ id: string; name: string; prompt: string; actionLabel: string; enabled: boolean }[]>([]);
  const [thingtime, setThingtime] = React.useState({ settings: {} });
  const record = (event: string) => setEvents(previous => [...previous, event]);
  const toolActions: TransientBlockActions = {
    'channels.query': ({ value }) => { if (typeof value === 'string') setQuery(value); },
    'channels.search': () => { record('channels.search'); if (query.trim()) setChannelResults([{ id: 'channel-fixture', title: 'Synthetic channel' }]); },
    'channels.subscribe': ({ inputs }) => { const channel = channelResults.find(item => item.id === inputs.id); if (channel) { setChannels([channel]); record('channels.subscribe'); } },
    'channels.unsubscribe': ({ inputs }) => { setChannels(previous => previous.filter(item => item.id !== inputs.id)); record('channels.unsubscribe'); },
    'filters.name': ({ value }) => { if (typeof value === 'string') setFilterName(value); },
    'filters.prompt': ({ value }) => { if (typeof value === 'string') setFilterPrompt(value); },
    'filters.action': ({ value }) => { if (value === 'warn' || value === 'hide') setFilterAction(value); },
    'filters.create': () => { record('filters.create'); if (filterName.trim() && filterPrompt.trim()) setFilters([{ id: 'filter-fixture', name: filterName, prompt: filterPrompt, actionLabel: filterAction, enabled: true }]); },
    'filters.toggle': ({ inputs }) => { setFilters(previous => previous.map(item => item.id === inputs.id ? { ...item, enabled: !item.enabled } : item)); record('filters.toggle'); },
    'filters.remove': ({ inputs }) => { setFilters(previous => previous.filter(item => item.id !== inputs.id)); record('filters.remove'); }
  };
  return <ThingtimeContext.Provider value={{ Everything: { thingtime, setThingtime, loading: false } } as any}>
    <Box maxW="1100px" m="auto" p={4}>
      <ConnectionsDocument documentKey="connections-overview" blocks={connectionsOverviewBlocks} scopeKey={owner} scope={{ page: { signedOut: false } }} />
      <ServiceCatalog documentKey="services-catalog" providers={providers} connections={connections} signedOut={false} busy={false} connectingId={connecting}
        openConnect={provider => { record(`connect:${provider.id}`); if (provider.auth !== 'oauth2') setConnecting(provider.id); }}
        verify={account => record(`verify:${account.id}`)} unlink={account => { record(`unlink:${account.id}`); setConnections(previous => previous.filter(item => item.id !== account.id)); }}
        cancelConnect={() => setConnecting(undefined)} submitConnect={fields => { if (fields.login !== 'fixture' || fields.password !== 'synthetic-only') throw new Error('Fixture form mismatch'); record('credential-submitted'); setConnecting(undefined); }} />
      <AIServiceAccounts ownerId={owner} />
      <ConnectionsDocument documentKey="connections-tools" blocks={connectionToolsBlocks} scopeKey={owner} actions={toolActions}
        scope={{ page: { signedIn: true, signedOut: false }, channels: { busy: false, query, needsSetup: true, saved: channels, results: channelResults },
          filters: { name: filterName, prompt: filterPrompt, action: filterAction, items: filters } }} />
      <output data-testid="events">{JSON.stringify(events)}</output>
    </Box>
  </ThingtimeContext.Provider>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', loader: () => ({ user: { id: owner, username: 'synthetic', temporary: false, privateUploadsEnabled: true }, dataPlane: 'home' }), Component: App }]);
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
