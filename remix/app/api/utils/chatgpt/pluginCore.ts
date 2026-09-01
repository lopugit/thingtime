import { normalizeDesktopState, normalizePkceChallenge } from '../apps/desktopOAuthRedirect';
import {
  MAX_LIMITLESS_HISTORY,
  MAX_LIMITLESS_WORKFLOW_RUNS,
  type ThingtimeMcpHistoryEntry,
  type ThingtimeMcpWorkflowRun
} from './pluginLimitlessCore';

export const CHATGPT_MCP_PATH = '/api/v1/integrations/chatgpt/mcp';
export const CHATGPT_AUTHORIZE_PATH = '/api/v1/integrations/chatgpt/oauth/authorize';
export const CHATGPT_TOKEN_PATH = '/api/v1/integrations/chatgpt/oauth/token';
export const CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH = '/api/v1/integrations/chatgpt/oauth/register';
export const CHATGPT_PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
export const CHATGPT_CAPABILITY_MANIFEST_PATH = '/.well-known/thingtime-chatgpt-capabilities.json';

export const CHATGPT_PLUGIN_FEATURES = {
  'chatgpt.mcp': '1.3.0',
  'chatgpt.oauth': '1.4.0',
  'chatgpt.connections': '1.2.0',
  'chatgpt.things.read': '1.3.0',
  'chatgpt.things.write': '1.1.0',
  'chatgpt.schemas': '1.0.0',
  'chatgpt.relationships': '1.0.0',
  'chatgpt.mutations.preview': '1.0.0',
  'chatgpt.resources': '1.0.0',
  'chatgpt.history': '1.0.0',
  'chatgpt.workflows': '1.0.0',
  'chatgpt.ui': '1.0.0',
  'chatgpt.changes': '1.0.0',
  'chatgpt.capabilities': '1.0.0'
} as const;

export const CHATGPT_MCP_TOOL_FEATURES = {
  login_thingtime: 'chatgpt.connections',
  list_thingtime_accounts: 'chatgpt.connections',
  select_thingtime_account: 'chatgpt.connections',
  remove_thingtime_account: 'chatgpt.connections',
  get_thingtime_profile: 'chatgpt.connections',
  get_thingtime_thing: 'chatgpt.things.read',
  get_thingtime_things: 'chatgpt.things.read',
  list_thingtime_comments: 'chatgpt.things.read',
  list_thingtime_things: 'chatgpt.things.read',
  search_thingtime_things: 'chatgpt.things.read',
  list_thingtime_schemas: 'chatgpt.schemas',
  get_thingtime_schema: 'chatgpt.schemas',
  validate_thingtime_thing: 'chatgpt.schemas',
  list_thingtime_related: 'chatgpt.relationships',
  list_thingtime_changes: 'chatgpt.changes',
  preview_thingtime_mutation: 'chatgpt.mutations.preview',
  apply_thingtime_mutation: 'chatgpt.mutations.preview',
  list_thingtime_history: 'chatgpt.history',
  get_thingtime_history: 'chatgpt.history',
  undo_thingtime_mutation: 'chatgpt.history',
  list_thingtime_capabilities: 'chatgpt.capabilities',
  get_thingtime_capability_contract: 'chatgpt.capabilities',
  start_thingtime_workflow: 'chatgpt.workflows',
  get_thingtime_workflow: 'chatgpt.workflows',
  cancel_thingtime_workflow: 'chatgpt.workflows',
  create_thingtime_thing: 'chatgpt.things.write',
  update_thingtime_thing: 'chatgpt.things.write',
  delete_thingtime_thing: 'chatgpt.things.write',
  comment_on_thingtime_thing: 'chatgpt.things.write',
  react_to_thingtime_thing: 'chatgpt.things.write',
  save_thingtime_thing: 'chatgpt.things.write',
  share_thingtime_thing: 'chatgpt.things.write'
} as const satisfies Record<string, keyof typeof CHATGPT_PLUGIN_FEATURES>;

export const CHATGPT_MCP_METHOD_FEATURES = {
  'prompts/list': 'chatgpt.workflows',
  'prompts/get': 'chatgpt.workflows',
  'resources/list': 'chatgpt.resources',
  'resources/templates/list': 'chatgpt.resources',
  'resources/read': 'chatgpt.resources'
} as const satisfies Record<string, keyof typeof CHATGPT_PLUGIN_FEATURES>;

export const CHATGPT_MCP_INSTRUCTIONS =
  'Thingtime operates only on named accounts connected through this app. For “@Thingtime login”, call login_thingtime: without a valid connection the host opens the native OAuth browser flow and completes its registered callback. For “@Thingtime list accounts”, call list_thingtime_accounts. When an account is ambiguous, list connected accounts and select one explicitly. Never request or expose a Thingtime token. When exact Thing IDs are supplied, use get_thingtime_thing or get_thingtime_things; never rely on recent pages to locate known IDs. When a comment target ID is supplied, use list_thingtime_comments instead of scanning recent Things. Use list_thingtime_related for parent, child, folder, backlink, or thread traversal. Discover and validate schemas before authoring typed data. Read, resources, validation, change feeds, previews, and searches may proceed on request. Every composed workflow and multi-Thing mutation must be previewed first; apply or undo only after stating the selected account, targets, effects, and obtaining clear confirmation. Never invent or call arbitrary API paths, URLs, database queries, or executable code.';

export const CHATGPT_PLUGIN_ROUTES = [
  { method: 'POST', path: CHATGPT_MCP_PATH, feature: 'chatgpt.mcp' },
  { method: 'GET', path: CHATGPT_AUTHORIZE_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_AUTHORIZE_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_TOKEN_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH, feature: 'chatgpt.oauth' },
  { method: 'GET', path: CHATGPT_PROTECTED_RESOURCE_METADATA_PATH, feature: 'chatgpt.oauth' },
  { method: 'GET', path: CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH, feature: 'chatgpt.oauth' },
  { method: 'GET', path: CHATGPT_CAPABILITY_MANIFEST_PATH, feature: 'chatgpt.mcp' }
] as const;

export const mcpResourceForOrigin = (origin: string) => `${origin}${CHATGPT_MCP_PATH}`;

// Tool arguments arrive optional, and the argument readers in plugin.ts report
// "absent" as null. Null and undefined must both drop the parameter: sending
// the literal string "null" upstream makes /things filter on a thingtime kind
// named "null" and /things/search search for that word, so an unfiltered list
// or an empty search silently returns nothing. tsconfig sets strictNullChecks
// false, so this guard — not the type — is what keeps an omitted filter
// omitted.
export const applyUpstreamQuery = (url: URL, query: Record<string, string | number | null | undefined> = {}): URL => {
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
};

export const isMcpResourceForOrigin = (resource: unknown, origin: string): resource is string =>
  typeof resource === 'string' && resource === mcpResourceForOrigin(origin);

export type ChatGptOAuthRequest = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
  scope: string[];
};

export type ChatGptDynamicOAuthClient = {
  clientId: string;
  redirectUris: string[];
};

export type ChatGptConnection = {
  id: string;
  label: string;
  endpoint: string;
  token: string;
  user: { id: string; username: string; displayName: string | null };
  scopes: string[];
  connectedAt: string;
};

export type ChatGptCredentialBundle = {
  version: 1;
  defaultConnectionId: string;
  connections: ChatGptConnection[];
  history?: ThingtimeMcpHistoryEntry[];
  runs?: ThingtimeMcpWorkflowRun[];
};

export const CHATGPT_OAUTH_SCOPES = ['thingtime', 'offline_access'] as const;

export const normalizeChatGptOAuthScopes = (values: string[]): string[] | null => {
  const scope = [...new Set(values.filter(Boolean))];
  if (!scope.includes('thingtime') || scope.length > 16 || scope.some((item) => !CHATGPT_OAUTH_SCOPES.includes(item as typeof CHATGPT_OAUTH_SCOPES[number]))) {
    return null;
  }
  return scope;
};

const DEFAULT_ALLOWED_ENDPOINTS = ['https://thingtime.com'];
const CHATGPT_REDIRECT_URIS = new Set([
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://chat.openai.com/connector_platform_oauth_redirect'
]);
const CODEX_CIMD_CLIENT_PREFIX = 'https://chatgpt.com/oauth/codex/';
const CODEX_CIMD_CLIENT_SUFFIX = '/client.json';

const cleanOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
};

export const allowedThingtimeEndpoints = (): string[] => {
  const configured = process.env.THINGTIME_CHATGPT_ALLOWED_ENDPOINTS;
  const candidates = configured ? configured.split(',') : DEFAULT_ALLOWED_ENDPOINTS;
  return [...new Set(candidates.map(cleanOrigin).filter((value): value is string => Boolean(value)))];
};

export const normalizeThingtimeEndpoint = (value: unknown): string | null => {
  const normalized = cleanOrigin(value);
  return normalized && allowedThingtimeEndpoints().includes(normalized) ? normalized : null;
};

export const allowedChatGptClientIds = (): string[] => {
  const configured = process.env.THINGTIME_CHATGPT_OAUTH_CLIENT_IDS;
  // ChatGPT uses this Client ID Metadata Document (CIMD) for a connector
  // whose authorization server supports issuer identification. Keep the
  // previous fixed client identifier during the rollout so existing developer
  // connections continue to work, but never accept arbitrary client URLs.
  const candidates = configured
    ? configured.split(',')
    : ['https://chatgpt.com/oauth/client.json', 'https://chatgpt.com'];
  return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))];
};

const normalizeChatGptRedirectUri = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  return CHATGPT_REDIRECT_URIS.has(value) ? value : null;
};

// Codex uses a callback-specific ChatGPT Client ID Metadata Document (CIMD)
// and a loopback redirect URI. The callback ID is intentionally tied between
// the two values so a client cannot choose an arbitrary local redirect just by
// presenting a ChatGPT-hosted client ID. RFC 8252 permits the ephemeral port
// while the loopback host and path remain exact.
const codexCallbackIdFromClientId = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith(CODEX_CIMD_CLIENT_PREFIX) || !value.endsWith(CODEX_CIMD_CLIENT_SUFFIX)) return null;
  const callbackId = value.slice(CODEX_CIMD_CLIENT_PREFIX.length, -CODEX_CIMD_CLIENT_SUFFIX.length);
  return /^[A-Za-z0-9_-]{1,256}$/.test(callbackId) ? callbackId : null;
};

const normalizeCodexCimdRedirectUri = (value: unknown, callbackId: string): string | null => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const port = Number(url.port);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      url.username ||
      url.password ||
      url.pathname !== `/callback/${callbackId}` ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

// Dynamic Client Registration is a compatibility path for Codex clients that
// cannot use CIMD yet. A registration may contain only a loopback callback;
// no arbitrary web, custom-scheme, or localhost redirect can become trusted.
export const normalizeDynamicClientRedirectUri = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const port = Number(url.port);
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      url.username ||
      url.password ||
      !/^\/callback(?:\/[A-Za-z0-9_-]{1,256})?$/.test(url.pathname) ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

const normalizeResource = (value: unknown, origin: string): string | null => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  return isMcpResourceForOrigin(value, origin) ? value : null;
};

export const parseChatGptAuthorizationRequest = (
  params: URLSearchParams,
  origin: string,
  dynamicClient: ChatGptDynamicOAuthClient | null = null
): { ok: true; request: ChatGptOAuthRequest } | { ok: false; error: string } => {
  if (params.get('response_type') !== 'code') return { ok: false, error: 'response_type must be code' };

  const clientId = params.get('client_id')?.trim() || '';
  const codexCallbackId = codexCallbackIdFromClientId(clientId);
  const registeredDynamicClient = dynamicClient?.clientId === clientId ? dynamicClient : null;
  if (!allowedChatGptClientIds().includes(clientId) && !codexCallbackId && !registeredDynamicClient) return { ok: false, error: 'Unknown OAuth client' };

  const redirectUri = registeredDynamicClient
    ? normalizeDynamicClientRedirectUri(params.get('redirect_uri'))
    : codexCallbackId
      ? normalizeCodexCimdRedirectUri(params.get('redirect_uri'), codexCallbackId)
      : normalizeChatGptRedirectUri(params.get('redirect_uri'));
  if (registeredDynamicClient && (!redirectUri || !registeredDynamicClient.redirectUris.includes(redirectUri))) {
    return { ok: false, error: 'redirect_uri is not registered for this OAuth client' };
  }
  if (!redirectUri) return { ok: false, error: 'redirect_uri is not a supported ChatGPT or Codex callback' };

  const state = normalizeDesktopState(params.get('state'));
  if (!state) return { ok: false, error: 'state must be a random string of 16-512 characters' };

  const codeChallenge = normalizePkceChallenge(params.get('code_challenge'), params.get('code_challenge_method'));
  if (!codeChallenge) return { ok: false, error: 'code_challenge_method must be S256 with a valid code_challenge' };

  const resource = normalizeResource(params.get('resource'), origin);
  if (!resource) return { ok: false, error: 'resource must be this Thingtime MCP endpoint' };

  const scope = normalizeChatGptOAuthScopes((params.get('scope') || 'thingtime')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean));
  if (!scope) return { ok: false, error: 'scope must include thingtime and contain only supported scopes' };

  return { ok: true, request: { clientId, redirectUri, state, codeChallenge, resource, scope } };
};

export const parseCredentialBundle = (value: unknown): ChatGptCredentialBundle | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ChatGptCredentialBundle>;
  if (candidate.version !== 1 || !Array.isArray(candidate.connections) || candidate.connections.length === 0 || candidate.connections.length > 20) {
    return null;
  }

  const connections = candidate.connections.filter((connection): connection is ChatGptConnection => {
    if (!connection || typeof connection !== 'object') return false;
    const item = connection as Partial<ChatGptConnection>;
    return (
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      Boolean(normalizeThingtimeEndpoint(item.endpoint)) &&
      typeof item.token === 'string' &&
      item.token.length > 20 &&
      item.user !== null &&
      typeof item.user === 'object' &&
      typeof item.user?.id === 'string' &&
      typeof item.user?.username === 'string' &&
      Array.isArray(item.scopes) &&
      typeof item.connectedAt === 'string'
    );
  });
  if (connections.length !== candidate.connections.length) return null;

  const defaultConnectionId =
    typeof candidate.defaultConnectionId === 'string' && connections.some((connection) => connection.id === candidate.defaultConnectionId)
      ? candidate.defaultConnectionId
      : connections[0].id;
  const history = Array.isArray(candidate.history)
    ? candidate.history
        .filter((entry): entry is ThingtimeMcpHistoryEntry =>
          !!entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.accountId === 'string' &&
          typeof entry.createdAt === 'string' &&
          Array.isArray(entry.summaries) &&
          Array.isArray(entry.results)
        )
        .slice(-MAX_LIMITLESS_HISTORY)
    : undefined;
  const runs = Array.isArray(candidate.runs)
    ? candidate.runs
        .filter((entry): entry is ThingtimeMcpWorkflowRun =>
          !!entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.accountId === 'string' &&
          typeof entry.capabilityThingId === 'string' &&
          typeof entry.createdAt === 'string' &&
          typeof entry.updatedAt === 'string' &&
          Array.isArray(entry.summaries)
        )
        .slice(-MAX_LIMITLESS_WORKFLOW_RUNS)
    : undefined;
  return { version: 1, defaultConnectionId, connections, ...(history?.length ? { history } : {}), ...(runs?.length ? { runs } : {}) };
};

// Single definition for both plugin HTML surfaces (the connection page here
// and the OAuth error page in plugin.ts). Keeping one copy is the point: the
// pattern must match every character the replacement map handles, and a second
// copy is free to drift back to `/&/g`, which silently escapes only ampersands
// and passes `<`, `>`, `"` and `'` into attribute and text positions.
export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

export const renderConnectionPage = (requestToken: string, allowedEndpoints: string[]) => {
  const options = allowedEndpoints.map((endpoint) => `<option value="${escapeHtml(endpoint)}">${escapeHtml(endpoint)}</option>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Thingtime to ChatGPT</title>
<style>body{margin:0;background:#f5f5f5;color:#161616;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{box-sizing:border-box;max-width:680px;margin:32px auto;padding:30px;background:#fff;border:1px solid #ddd;border-radius:16px}h1{margin:0 0 8px;font-size:27px}p{color:#545454}fieldset{border:1px solid #d8d8d8;border-radius:12px;padding:16px;margin:16px 0}legend{padding:0 6px;font-weight:600}label{display:block;font-weight:600;margin-top:12px}input,select,button{font:inherit;box-sizing:border-box;width:100%;padding:10px;margin-top:5px;border:1px solid #aaa;border-radius:8px}button{cursor:pointer;background:#111;color:#fff;border-color:#111;font-weight:650;margin-top:18px}.secondary{background:#fff;color:#111}.hint{font-size:14px}.warn{border-left:3px solid #111;padding-left:12px}@media(max-width:720px){.card{margin:0;border:0;border-radius:0;min-height:100vh;padding:22px}}</style></head>
<body><main class="card"><h1>Connect Thingtime</h1><p>Choose one or more Thingtime accounts. Each connection uses a scoped, revocable personal access token.</p><p class="warn">Tokens are encrypted by Thingtime and are never returned to ChatGPT or placed in a chat.</p><form method="post" autocomplete="off"><input type="hidden" name="request" value="${escapeHtml(requestToken)}"><div id="accounts"><fieldset><legend>Thingtime account</legend><label>Account label<input name="label" maxlength="80" placeholder="Personal" required></label><label>Thingtime API endpoint<select name="endpoint" required>${options}</select></label><label>Personal access token<input type="password" name="token" minlength="24" maxlength="8192" spellcheck="false" required></label><p class="hint">Create a least-privilege token in Thingtime Settings → Token minter. It must include at least <code>things.read</code>.</p></fieldset></div><button class="secondary" type="button" id="add">Add another account</button><button type="submit">Connect accounts</button></form></main><script>const a=document.getElementById('add'),c=document.getElementById('accounts');a.addEventListener('click',()=>{const f=c.firstElementChild.cloneNode(true);f.querySelectorAll('input').forEach(i=>i.value='');c.appendChild(f);});</script></body></html>`;
};

export const pluginDiscovery = (origin: string) => ({
  protectedResource: {
    resource: mcpResourceForOrigin(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: CHATGPT_OAUTH_SCOPES
  },
  authorizationServer: {
    issuer: origin,
    authorization_endpoint: `${origin}${CHATGPT_AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${CHATGPT_TOKEN_PATH}`,
    registration_endpoint: `${origin}${CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    scopes_supported: CHATGPT_OAUTH_SCOPES,
    authorization_response_iss_parameter_supported: true
  },
  capabilityManifest: {
    schemaVersion: '1.2.0',
    origin,
    features: CHATGPT_PLUGIN_FEATURES,
    routes: CHATGPT_PLUGIN_ROUTES,
    operations: [
      ...Object.entries(CHATGPT_MCP_TOOL_FEATURES).map(([name, feature]) => ({
        transport: 'mcp-tool',
        name,
        feature
      })),
      ...Object.entries(CHATGPT_MCP_METHOD_FEATURES).map(([name, feature]) => ({
        transport: 'mcp-method',
        name,
        feature
      }))
    ]
  }
});
