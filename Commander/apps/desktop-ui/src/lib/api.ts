import type {
  BootstrapResponse,
  CommanderAccount,
  CommanderExtension,
  CommanderSettings,
  ExecuteResponse,
  IndexScope,
  IndexingStatus,
  LocalRaycastExtensionsResponse,
  RaycastPreferenceSyncSummary,
  RecentSearch,
  RecentSearchCommand,
  SearchHit,
  StoreExtension,
} from '@commander/protocol';

const query = new URLSearchParams(window.location.search);
const sessionToken = query.get('token') ?? '';

export function daemonHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-commander-session': sessionToken,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...daemonHeaders(), ...init?.headers },
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export const api = {
  bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),
  search: (value: string) => request<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(value)}`),
  addRecentSearch: (value: string, command?: RecentSearchCommand) =>
    request<{ recentSearches: RecentSearch[] }>('/api/history', {
      method: 'POST',
      body: JSON.stringify({ query: value, command }),
    }),
  saveSettings: (settings: CommanderSettings) =>
    request<{ settings: CommanderSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  execute: (itemId: string, actionId: string, searchQuery = '') =>
    request<ExecuteResponse>('/api/execute', {
      method: 'POST',
      body: JSON.stringify({ itemId, actionId, query: searchQuery }),
    }),
  indexingStatus: () => request<IndexingStatus>('/api/index/status'),
  indexNow: (scope: IndexScope) =>
    request<{ ok: true; scope: IndexScope; status: IndexingStatus }>('/api/index', {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }),
  listExtensions: () => request<{ extensions: CommanderExtension[] }>('/api/extensions'),
  listRaycastExtensions: () => request<LocalRaycastExtensionsResponse>('/api/extensions/raycast'),
  addRaycastExtension: (name: string, installationId: string) =>
    request<{
      extension: CommanderExtension;
      preparation: {
        source: 'folder';
        readyNoViewCommands: number;
        diagnostics: Array<{ severity: 'info' | 'warning' | 'error'; message: string }>;
        build: { attempted: boolean; exitCode?: number; timedOut?: boolean };
      };
      sync: RaycastPreferenceSyncSummary;
    }>('/api/extensions/raycast/add', {
      method: 'POST',
      body: JSON.stringify({ name, installationId }),
    }),
  syncRaycastExtension: (name: string, installationId: string) =>
    request<{ extension: CommanderExtension; sync: RaycastPreferenceSyncSummary }>(
      '/api/extensions/raycast/sync',
      {
        method: 'POST',
        body: JSON.stringify({ name, installationId }),
      },
    ),
  sideload: (path: string, allowUntrustedBuildScripts = false) =>
    request<{
      extension: CommanderExtension;
      preparation: {
        source: 'folder' | 'archive';
        readyNoViewCommands: number;
        diagnostics: Array<{ severity: 'info' | 'warning' | 'error'; message: string }>;
        build: { attempted: boolean; exitCode?: number; timedOut?: boolean };
      };
    }>('/api/extensions/sideload', {
      method: 'POST',
      body: JSON.stringify({ path, allowUntrustedBuildScripts }),
    }),
  browseStore: (value: string) =>
    request<{ extensions: StoreExtension[] }>(`/api/extensions/store?q=${encodeURIComponent(value)}`),
  installStoreExtension: (extension: StoreExtension) =>
    request<{ extension: CommanderExtension }>('/api/extensions/store/install', {
      method: 'POST',
      body: JSON.stringify(extension),
    }),
  beginLogin: () =>
    request<{ authorizeUrl: string; state: string }>('/api/accounts/login', { method: 'POST' }),
  completeLogin: (session: unknown) =>
    request<{ account: CommanderAccount }>('/api/accounts/callback', {
      method: 'POST',
      body: JSON.stringify(session),
    }),
  switchAccount: (id: string) =>
    request<{ account: CommanderAccount }>('/api/accounts/active', {
      method: 'PUT',
      body: JSON.stringify({ id }),
    }),
  removeAccount: (id: string) =>
    request<{ ok: true }>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  pendingCredential: () =>
    request<{ credential: { accountId: string } | null }>('/api/accounts/credentials/pending', {
      method: 'POST',
    }),
  unlockCredential: (accountId: string, token: string) =>
    request<{ ok: true }>('/api/accounts/credentials', {
      method: 'PUT',
      body: JSON.stringify({ accountId, token }),
    }),
  sync: () => request<{ settings: CommanderSettings; syncedAt: string }>('/api/sync', { method: 'POST' }),
};
