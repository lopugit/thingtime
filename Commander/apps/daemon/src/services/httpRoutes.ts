// Canonical active HTTP route table. Dispatch resolves this registry before any
// handler runs; the capability manifest is generated from the same operations.
export const COMMANDER_HTTP_ROUTES = [
  { id: 'health', method: 'GET', path: '/healthz', match: 'exact', version: '1.0.0' },
  { id: 'bootstrap', method: 'GET', path: '/api/bootstrap', match: 'exact', version: '1.0.0' },
  { id: 'activity-network', method: 'GET', path: '/api/activity/network', match: 'exact', version: '1.0.0' },
  {
    id: 'activity-network-speed',
    method: 'POST',
    path: '/api/activity/network/speed',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'search', method: 'GET', path: '/api/search', match: 'exact', version: '1.0.0' },
  { id: 'search-stream', method: 'GET', path: '/api/search/stream', match: 'exact', version: '1.0.0' },
  {
    id: 'search-cache-status',
    method: 'GET',
    path: '/api/search/cache/status',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'search-cache', method: 'DELETE', path: '/api/search/cache', match: 'exact', version: '1.0.0' },
  { id: 'index-status', method: 'GET', path: '/api/index/status', match: 'exact', version: '1.1.0' },
  { id: 'index', method: 'POST', path: '/api/index', match: 'exact', version: '1.0.0' },
  { id: 'history', method: 'POST', path: '/api/history', match: 'exact', version: '1.0.0' },
  { id: 'settings', method: 'PUT', path: '/api/settings', match: 'exact', version: '1.0.0' },
  { id: 'extensions', method: 'GET', path: '/api/extensions', match: 'exact', version: '1.0.0' },
  {
    id: 'extensions-raycast',
    method: 'GET',
    path: '/api/extensions/raycast',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'extensions-raycast-add',
    method: 'POST',
    path: '/api/extensions/raycast/add',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'extensions-raycast-sync',
    method: 'POST',
    path: '/api/extensions/raycast/sync',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'extensions-sideload',
    method: 'POST',
    path: '/api/extensions/sideload',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'extensions-store', method: 'GET', path: '/api/extensions/store', match: 'exact', version: '1.0.0' },
  {
    id: 'extensions-store-install',
    method: 'POST',
    path: '/api/extensions/store/install',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'execute', method: 'POST', path: '/api/execute', match: 'exact', version: '1.0.0' },
  { id: 'accounts-login', method: 'POST', path: '/api/accounts/login', match: 'exact', version: '1.1.0' },
  { id: 'accounts-active', method: 'PUT', path: '/api/accounts/active', match: 'exact', version: '1.0.0' },
  {
    id: 'accounts-environments',
    method: 'PUT',
    path: '/api/accounts/environments',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'accounts-credentials',
    method: 'PUT',
    path: '/api/accounts/credentials',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'accounts-credentials-pending',
    method: 'POST',
    path: '/api/accounts/credentials/pending',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'sync', method: 'POST', path: '/api/sync', match: 'exact', version: '1.0.0' },
  {
    id: 'native-oauth-callback',
    method: 'POST',
    path: '/api/native/oauth/callback',
    match: 'exact',
    version: '1.0.1',
  },
  {
    id: 'native-credentials-claim',
    method: 'POST',
    path: '/api/native/credentials/claim',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'native-credentials-ack',
    method: 'POST',
    path: '/api/native/credentials/ack',
    match: 'exact',
    version: '1.0.0',
  },
  {
    id: 'native-credentials',
    method: 'PUT',
    path: '/api/native/credentials',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'accounts-remove', method: 'DELETE', path: '/api/accounts/*', match: 'prefix', version: '1.0.0' },
  { id: 'oauth-callback', method: '*', path: '/oauth/callback', match: 'exact', version: '1.0.1' },
  {
    id: 'capabilities',
    method: 'GET',
    path: '/.well-known/commander-capabilities.json',
    match: 'exact',
    version: '1.0.0',
  },
  { id: 'static-assets', method: '*', path: '/*', match: 'static', version: '1.0.0' },
] as const;

export type CommanderRouteId = (typeof COMMANDER_HTTP_ROUTES)[number]['id'];

export function resolveCommanderRoute(method: string, pathname: string) {
  return COMMANDER_HTTP_ROUTES.find((route) => {
    if (route.method !== '*' && route.method !== method) return false;
    if (route.match === 'prefix') return pathname.startsWith(route.path.slice(0, -1));
    if (route.match === 'static') return !pathname.startsWith('/api/') && pathname !== '/oauth/callback';
    return pathname === route.path;
  });
}

export function commanderCapabilityManifest(origin: string) {
  return {
    schemaVersion: 1,
    origin,
    features: Object.fromEntries(
      COMMANDER_HTTP_ROUTES.map((route) => [
        `commander.${route.id}`,
        {
          version: route.version,
          operations: [
            {
              method: route.method,
              path: route.path,
              authentication: route.path.startsWith('/api/native/')
                ? 'native-session'
                : route.path.startsWith('/api/')
                  ? 'ui-session'
                  : 'none',
            },
          ],
        },
      ]),
    ),
  };
}
