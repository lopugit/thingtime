import { HOSTED_RENDER_FEATURE, HOSTED_RENDER_VERSION, RENDER_EXPORT_TOOL } from '../../../../../MCP/src/renderSchema';
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
export const CHATGPT_OAUTH_RELAY_PATH = '/api/v1/integrations/chatgpt/oauth/relay';
export const CHATGPT_PROTECTED_RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';
export const CHATGPT_AUTHORIZATION_SERVER_METADATA_PATH = '/.well-known/oauth-authorization-server';
export const CHATGPT_CAPABILITY_MANIFEST_PATH = '/.well-known/thingtime-chatgpt-capabilities.json';

export const CHATGPT_PLUGIN_FEATURES = {
  'chatgpt.mcp': '2.1.0',
  'chatgpt.oauth': '1.12.0',
  'chatgpt.confirmations': '1.0.0',
  'chatgpt.agent-reporting': '1.1.0',
  'chatgpt.connections': '2.1.0',
  'chatgpt.things.read': '1.4.0',
  'chatgpt.things.write': '2.0.0',
  'chatgpt.schemas': '1.0.0',
  'chatgpt.relationships': '1.0.0',
  'chatgpt.mutations.preview': '2.0.0',
  'chatgpt.resources': '1.0.0',
  'chatgpt.history': '2.0.0',
  'chatgpt.workflows': '2.0.0',
  'chatgpt.ui': '1.1.0',
  'chatgpt.changes': '1.0.0',
  'chatgpt.capabilities': '2.0.0'
} as const;

export const CHATGPT_MCP_TOOL_FEATURES = {
  login_thingtime: 'chatgpt.connections',
  list_thingtime_accounts: 'chatgpt.connections',
  select_thingtime_account: 'chatgpt.connections',
  remove_thingtime_account: 'chatgpt.connections',
  get_thingtime_confirmation_requirements: 'chatgpt.confirmations',
  get_thingtime_profile: 'chatgpt.connections',
  prepare_thingtime_agent_task: 'chatgpt.agent-reporting',
  get_thingtime_agent_task: 'chatgpt.agent-reporting',
  report_thingtime_agent_task: 'chatgpt.agent-reporting',
  coordinate_thingtime_agent_task: 'chatgpt.agent-reporting',
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
  stage_thingtime_mutation_plan: 'chatgpt.mutations.preview',
  get_thingtime_mutation_preview: 'chatgpt.mutations.preview',
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
  'Thingtime operates only on named accounts connected through this app. For “@Thingtime login”, call login_thingtime: without a valid connection the host opens the native OAuth browser flow and completes its registered callback. For “@Thingtime list accounts”, call list_thingtime_accounts. When an account is ambiguous, list connected accounts and select one explicitly. Never request or expose a Thingtime token. Authorized private task lifecycle reporting uses prepare_thingtime_agent_task, get_thingtime_agent_task, report_thingtime_agent_task and coordinate_thingtime_agent_task with a stable task identity and the independent agents.report grant; things does not include that grant. Reuse the returned distinct Character and private task records. Standing task-reporting authorization permits these bounded private lifecycle updates without repeat confirmation; never fall back to public owner identity or generic writes when reporting access is unavailable. When exact Thing IDs are supplied, use get_thingtime_thing or get_thingtime_things; never rely on recent pages to locate known IDs. When a comment target ID is supplied, use list_thingtime_comments instead of scanning recent Things. Use list_thingtime_related for parent, child, folder, backlink, or thread traversal. Discover and validate schemas before authoring typed data. Read, resources, validation, change feeds, previews, and searches may proceed on request. For direct mutations, use get_thingtime_confirmation_requirements for the selected account. Every composed workflow, undo and multi-Thing mutation still requires a signed preview. Use stage_thingtime_mutation_plan for requests too large for one transport call and follow preview.nextCursor using get_thingtime_mutation_preview to review the complete plan. Review the exact account, targets and effects and follow confirmationRequired. Set confirmed=true only after the user explicitly confirms; omit it when confirmation is disabled. Treat confirmation_required as a request to obtain approval, and never invent it. Connected AI app approvals and Thingtime permissions still apply. Never invent or call arbitrary API paths, URLs, database queries, or executable code.';

export const CHATGPT_PLUGIN_ROUTES = [
  { method: 'POST', path: CHATGPT_MCP_PATH, feature: 'chatgpt.mcp' },
  { method: 'GET', path: CHATGPT_AUTHORIZE_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_AUTHORIZE_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_TOKEN_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH, feature: 'chatgpt.oauth' },
  { method: 'GET', path: CHATGPT_OAUTH_RELAY_PATH, feature: 'chatgpt.oauth' },
  { method: 'POST', path: CHATGPT_OAUTH_RELAY_PATH, feature: 'chatgpt.oauth' },
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
  requestId?: string;
  browserSessionJti?: string;
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

// The resource advertises its minimum scopes for clients that request all of
// them automatically. Independent permissions are advertised by the OAuth
// server and the specific tool that needs them, then requested at step-up.
export const CHATGPT_BASE_OAUTH_SCOPES = ['thingtime', 'offline_access'] as const;
export const CHATGPT_OAUTH_PERMISSION_SCOPES = ['agents.report'] as const;
export const CHATGPT_OAUTH_SCOPES = [...CHATGPT_BASE_OAUTH_SCOPES, ...CHATGPT_OAUTH_PERMISSION_SCOPES] as const;
export type ChatGptOAuthPermissionScope = typeof CHATGPT_OAUTH_PERMISSION_SCOPES[number];

export const requestedOAuthPermissions = (scopes: readonly string[]) =>
  CHATGPT_OAUTH_PERMISSION_SCOPES.filter((scope) => scopes.includes(scope));

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
const CODEX_SHARED_CIMD_CLIENT_ID = 'https://chatgpt.com/oauth/codex/client.json';

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

// Codex uses the shared CIMD with an issuer-bound callback. Match only the
// two loopback hosts published by that client and its exact callback path.
const normalizeCodexSharedCimdRedirectUri = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})\/callback$/.exec(value);
  return match?.[0] === value && Number(match[1]) <= 65535 ? value : null;
};

// Dynamic Client Registration is a compatibility path for Codex clients that
// cannot use CIMD yet, and for ChatGPT developer apps. A registration may use
// only a native loopback callback or ChatGPT's exact connector callback; no
// arbitrary web, custom-scheme, or localhost redirect can become trusted.
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

// Remote Codex sessions cannot receive a phone browser's loopback callback.
// A relay callback remains first-party, HTTPS-only, short lived, and is bound
// to a 256-bit handoff identifier minted by the relay-start endpoint.
export const normalizeChatGptOAuthRelayRedirectUri = (value: unknown, origin: string): string | null => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== origin ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== CHATGPT_OAUTH_RELAY_PATH ||
      url.hash ||
      url.searchParams.size !== 1
    ) return null;
    const handoff = url.searchParams.get('handoff');
    if (!handoff || !/^[A-Za-z0-9_-]{43}$/.test(handoff)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

// ChatGPT's current developer-app flow uses an opaque dynamically registered
// public client and returns to its exact connector callback. Treat that callback
// with the same registration binding as a native loopback client: it must be
// included in the signed registration and in the later authorization request.
// Nothing broad is accepted here; both supported ChatGPT callbacks are exact
// constants above.
export const normalizeRegisteredClientRedirectUri = (value: unknown, origin?: string): string | null =>
  normalizeDynamicClientRedirectUri(value) || normalizeChatGptRedirectUri(value) || (origin ? normalizeChatGptOAuthRelayRedirectUri(value, origin) : null);

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
  const isCodexSharedClient = clientId === CODEX_SHARED_CIMD_CLIENT_ID;
  const codexCallbackId = codexCallbackIdFromClientId(clientId);
  const registeredDynamicClient = dynamicClient?.clientId === clientId ? dynamicClient : null;
  if (!isCodexSharedClient && !codexCallbackId && !registeredDynamicClient && !allowedChatGptClientIds().includes(clientId)) {
    return { ok: false, error: 'Unknown OAuth client' };
  }

  const redirectUri = registeredDynamicClient
    ? normalizeRegisteredClientRedirectUri(params.get('redirect_uri'), origin)
    : codexCallbackId
      ? normalizeCodexCimdRedirectUri(params.get('redirect_uri'), codexCallbackId)
      : isCodexSharedClient
        ? normalizeCodexSharedCimdRedirectUri(params.get('redirect_uri'))
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

const renderOAuthSsoScript = `const continueWithSso=()=>{const popup=window.open('/authorize?self=1&origin='+encodeURIComponent(location.origin),'thingtime-sso','width=480,height=640,popup=1');if(!popup){setStatus('Allow popups for Thingtime, then try again.','error');return}setStatus('Finish signing in with Thingtime in the popup…');const closed=setInterval(()=>{if(popup.closed){clearInterval(closed);window.removeEventListener('message',onMessage);continueButton.hidden=false;setStatus('Sign-in was closed. Continue with Thingtime to try again.','error')}},500);const onMessage=async event=>{if(event.origin!==location.origin||event.source!==popup||event.data?.type!=='thingtime:sso'){return}window.removeEventListener('message',onMessage);clearInterval(closed);if(!event.data.ok||typeof event.data.code!=='string'){setStatus('Sign-in was cancelled.');continueButton.hidden=false;return}try{const response=await fetch('/api/v1/auth/sso-session',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({code:event.data.code})});if(!response.ok)throw new Error();prepare()}catch{setStatus('Thingtime sign-in could not finish. Please try again.','error');continueButton.hidden=false}};window.addEventListener('message',onMessage)};`;

const connectionStyles = `<style>body{margin:0;background:#f5f5f5;color:#161616;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{box-sizing:border-box;max-width:680px;margin:32px auto;padding:30px;background:#fff;border:1px solid #ddd;border-radius:16px}h1{margin:0 0 8px;font-size:27px}p{color:#545454}.eyebrow{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#686868}.status{margin:20px 0;padding:14px 16px;border-left:3px solid #111;background:#fafafa}.status[data-kind="error"]{border-color:#b42318;color:#7a271a}.access{display:flex;gap:12px;align-items:flex-start;margin:20px 0;padding:16px;border:1px solid #d8d8d8;border-radius:12px}.access b{display:block}.access p{margin:3px 0 0}.dot{width:11px;height:11px;border-radius:99px;background:#111;margin-top:6px;flex:0 0 auto}details{border:1px solid #d8d8d8;border-radius:12px;padding:0 16px;margin:18px 0}summary{padding:15px 0;cursor:pointer;font-weight:650}fieldset{border:1px solid #d8d8d8;border-radius:12px;padding:16px;margin:12px 0}legend{padding:0 6px;font-weight:600}label{display:block;font-weight:600;margin-top:12px}input,select,button{font:inherit;box-sizing:border-box;width:100%;padding:10px;margin-top:5px;border:1px solid #aaa;border-radius:8px}button{cursor:pointer;background:#111;color:#fff;border-color:#111;font-weight:650;margin-top:14px}button:disabled{cursor:not-allowed;opacity:.55}.secondary{background:#fff;color:#111}.hint{font-size:14px}.scope{display:flex;gap:9px;align-items:flex-start;font-weight:400;padding:9px 0;border-bottom:1px solid #eee}.scope:last-child{border-bottom:0}.scope input{width:auto;margin:4px 0 0}.scope small{display:block;color:#666;margin-top:2px}.token-note{font-size:13px;color:#666;margin:8px 0 0}.warn{border-left:3px solid #111;padding-left:12px}@media(max-width:720px){.card{margin:0;border:0;border-radius:0;min-height:100vh;padding:22px}}</style>`;

type ConnectionScope = { id: string; title: string; description: string; emoji: string };

const renderScopeChoices = (scopeCatalog: ConnectionScope[], defaultScopes: readonly string[]) => scopeCatalog
  .map((scope) => `<label class="scope"><input name="scope" type="checkbox" data-scope value="${escapeHtml(scope.id)}"${defaultScopes.includes(scope.id) ? ' checked' : ''}><span><strong>${escapeHtml(scope.title)}</strong><small>${escapeHtml(scope.description)}</small></span></label>`)
  .join('');

export const renderScopedConnectionPage = (requestToken: string, scopeCatalog: ConnectionScope[], requestedPermissions: readonly ChatGptOAuthPermissionScope[]) => {
  const required = scopeCatalog.filter((scope) => requestedPermissions.some((permission) => permission === scope.id));
  const optional = scopeCatalog.filter((scope) => !required.includes(scope));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Approve Thingtime access</title>${connectionStyles}
<style>.identity{margin:18px 0 4px;overflow-wrap:anywhere}.consent-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.consent-actions button{width:auto;min-height:44px;margin:0}.consent-actions button[hidden]{display:none}.scope{cursor:pointer}button:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid #365cc7;outline-offset:3px}.status:not(:empty){min-height:1.5em}.status:empty{margin:0;padding:0;border:0;background:transparent;min-height:0}.card{margin-inline:auto}@media(max-width:720px){.card{margin:16px;padding:20px}}</style></head>
<body><main class="card"><div class="eyebrow">Thingtime</div><h1>Approve Thingtime access</h1><p>Review the permissions for this new connection. Access from a previous connection does not carry over automatically.</p>
<form id="connect-form" method="post"><input type="hidden" name="request" value="${escapeHtml(requestToken)}"><fieldset><legend>Requested permissions</legend>
${required.map((scope) => `<div class="access"><span class="dot" aria-hidden="true"></span><div><b>${escapeHtml(scope.title)}</b><p>${escapeHtml(scope.description)}</p></div></div>`).join('')}</fieldset>
<details id="advanced"><summary>Optional access rules</summary><p class="hint">Choose any additional access this connection should have.</p><div class="scopes">${renderScopeChoices(optional, [])}</div></details>
<p class="identity" id="account" hidden></p><p class="status" id="status" role="status">Checking your Thingtime sign-in…</p>
<div class="consent-actions"><button id="continue" class="secondary" type="button" hidden>Continue with Thingtime</button><button id="connect" type="submit" value="complete" disabled>Connect Thingtime</button><button class="secondary" type="submit" value="cancel">Cancel</button></div></form></main>
<script>(()=>{
  const form=document.getElementById('connect-form'),status=document.getElementById('status'),account=document.getElementById('account'),continueButton=document.getElementById('continue'),connect=document.getElementById('connect');
  let busy=false;
  const setStatus=(message,kind='')=>{status.textContent=message;status.dataset.kind=kind};
  const post=async intent=>{const data=new URLSearchParams(new FormData(form));data.set('intent',intent);const response=await fetch(location.pathname,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:data.toString()});return {response,body:await response.json().catch(()=>null)}};
  const prepare=async()=>{if(busy)return;busy=true;connect.disabled=true;continueButton.hidden=true;account.hidden=true;setStatus('Checking your Thingtime sign-in…');try{const {response,body}=await post('prepare');if(response.status===401){continueButton.hidden=false;setStatus('Sign in with your Thingtime account to review access.');return}if(!response.ok||!body?.ok)throw new Error(body?.error||'Could not check your account.');form.elements.request.value=body.request;account.textContent='Signed in as @'+body.username+' on '+location.host;account.hidden=false;connect.disabled=false;setStatus('')}catch(error){setStatus(error.message,'error');continueButton.hidden=false}finally{busy=false}};
  ${renderOAuthSsoScript}
  continueButton.addEventListener('click',continueWithSso);
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;connect.disabled=true;const intent=event.submitter?.value==='cancel'?'cancel':'complete';setStatus(intent==='cancel'?'Cancelling…':'Authorizing this connection…');try{const {response,body}=await post(intent);if(!response.ok||!body?.ok)throw new Error(body?.error||'Could not finish.');window.location.assign(body.redirectUri)}catch(error){setStatus(error.message,'error');connect.disabled=account.hidden}finally{busy=false}});
  prepare();
})();</script></body></html>`;
};

export const renderConnectionPage = (
  requestToken: string,
  allowedEndpoints: string[],
  defaultEndpoint: string,
  scopeCatalog: ConnectionScope[]
) => {
  const options = allowedEndpoints
    .map((endpoint) => `<option value="${escapeHtml(endpoint)}"${endpoint === defaultEndpoint ? ' selected' : ''}>${escapeHtml(endpoint)}</option>`)
    .join('');
  const scopes = scopeCatalog
    .map((scope) => `<label class="scope"><input type="checkbox" data-scope value="${escapeHtml(scope.id)}"${scope.id === 'things' ? ' checked' : ''}><span>${escapeHtml(scope.emoji)} <strong>${escapeHtml(scope.title)}</strong><small>${escapeHtml(scope.description)}</small></span></label>`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Thingtime</title>
${connectionStyles}</head>
<body><main class="card"><div class="eyebrow">Thingtime</div><h1>Connect your account</h1><p>Sign in with Thingtime to give this connection secure, revocable access. Full read/write access to your Things is selected by default.</p><p class="warn">Thingtime generates and stores the connection token securely. It is never shown in ChatGPT, Codex, or a chat.</p><form id="connect-form" method="post" autocomplete="off" novalidate><input type="hidden" name="request" value="${escapeHtml(requestToken)}"><div class="access"><span class="dot"></span><div><b>Read/write all Things</b><p>Includes reading, creating, updating, deleting, comments, reactions, saves, shares, and votes.</p></div></div><div class="status" id="status" aria-live="polite">Preparing your secure Thingtime connection…</div><button id="continue" class="secondary" type="button" hidden>Continue with Thingtime</button><button id="connect" type="submit" disabled>Connect Thingtime</button><details id="advanced"><summary>Advanced connection settings</summary><p class="hint">Change the generated token’s scopes, regenerate it, or connect another endpoint with your own token.</p><div id="accounts"><fieldset class="account"><legend>Primary Thingtime account</legend><label>Account label<input name="label" maxlength="80" placeholder="Personal" required></label><label>Thingtime API endpoint<select name="endpoint" required>${options}</select></label><label>Generated personal access token<input class="token" type="password" name="token" minlength="24" maxlength="8192" spellcheck="false" required></label><p class="token-note">Generated in your signed-in Thingtime session. It is non-expiring, revocable, and hidden until you open Advanced settings.</p><fieldset><legend>Access rules</legend><p class="hint">The default <strong>Full things access</strong> is read/write all. Remove it and choose individual capabilities to narrow access.</p><div class="scopes">${scopes}</div><button class="secondary regenerate" type="button">Generate a new token with these rules</button></fieldset></fieldset></div><button class="secondary" type="button" id="add">Add another account manually</button></details></form></main><script>(()=>{const form=document.getElementById('connect-form'),status=document.getElementById('status'),continueButton=document.getElementById('continue'),connect=document.getElementById('connect'),accounts=document.getElementById('accounts'),request=form.elements.request.value,primary=accounts.firstElementChild;let busy=false;const setStatus=(message,kind='')=>{status.textContent=message;status.dataset.kind=kind};const selectedScopes=()=>[...primary.querySelectorAll('[data-scope]:checked')].map(input=>input.value);const asForm=extra=>{const data=new URLSearchParams({request,intent:'prepare',endpoint:primary.querySelector('[name=endpoint]').value});selectedScopes().forEach(scope=>data.append('scope',scope));Object.entries(extra||{}).forEach(([key,value])=>data.set(key,value));return data};const prepare=async(extra)=>{if(busy)return;busy=true;continueButton.hidden=true;connect.disabled=true;setStatus('Preparing your secure Thingtime connection…');try{const response=await fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},credentials:'same-origin',body:asForm(extra).toString()});const body=await response.json().catch(()=>null);if(response.status===401){setStatus('Sign in with your Thingtime account to continue.');continueButton.hidden=false;return}if(!response.ok||!body?.ok)throw new Error(body?.error||'Could not prepare your connection.');primary.querySelector('[name=label]').value=body.account.label;primary.querySelector('[name=endpoint]').value=body.account.endpoint;primary.querySelector('[name=token]').value=body.token;primary.dataset.generatedTokenId=body.tokenId;setStatus('Ready as @'+body.account.username+'. You can connect now.');connect.disabled=false}catch(error){setStatus(error instanceof Error?error.message:'Could not prepare your connection.','error')}finally{busy=false}};const complete=async()=>{if(busy)return;busy=true;connect.disabled=true;setStatus('Completing your secure Thingtime connection…');try{const data=new URLSearchParams(new FormData(form));data.set('intent','complete');const response=await fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},credentials:'same-origin',body:data.toString()});const body=await response.json().catch(()=>null);if(!response.ok||!body?.ok||typeof body.redirectUri!=='string')throw new Error(body?.error||'Could not complete your connection.');window.location.assign(body.redirectUri)}catch(error){setStatus(error instanceof Error?error.message:'Could not complete your connection.','error');connect.disabled=false}finally{busy=false}};${renderOAuthSsoScript}form.addEventListener('submit',event=>{event.preventDefault();void complete()});continueButton.addEventListener('click',continueWithSso);primary.querySelector('[name=endpoint]').addEventListener('change',()=>{primary.querySelector('[name=token]').value='';primary.dataset.generatedTokenId='';connect.disabled=true;setStatus('Choose access rules and generate a token for this endpoint.');document.getElementById('advanced').open=true});primary.querySelector('.regenerate').addEventListener('click',async()=>{if(!selectedScopes().length){setStatus('Choose at least one access rule before generating a token.','error');return}await prepare(primary.dataset.generatedTokenId?{replaceTokenId:primary.dataset.generatedTokenId}:undefined)});document.getElementById('add').addEventListener('click',()=>{const clone=primary.cloneNode(true);clone.dataset.generatedTokenId='';clone.querySelector('legend').textContent='Additional Thingtime account';clone.querySelectorAll('input').forEach(input=>{if(input.matches('[data-scope]'))return;input.value=''});clone.querySelector('.token-note').textContent='For another account or endpoint, paste a scoped personal access token here.';clone.querySelector('.regenerate').remove();clone.querySelector('.scopes').closest('fieldset').remove();accounts.appendChild(clone);document.getElementById('advanced').open=true});prepare()})();</script></body></html>`;
};

export const pluginDiscovery = (origin: string, hostedRenderAvailable = false) => ({
  protectedResource: {
    resource: mcpResourceForOrigin(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: CHATGPT_BASE_OAUTH_SCOPES
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
    features: { ...CHATGPT_PLUGIN_FEATURES, ...(hostedRenderAvailable ? { [HOSTED_RENDER_FEATURE]: HOSTED_RENDER_VERSION } : {}) },
    routes: CHATGPT_PLUGIN_ROUTES,
    operations: [
      ...Object.entries(CHATGPT_MCP_TOOL_FEATURES).map(([name, feature]) => ({
        transport: 'mcp-tool',
        name,
        feature
      })),
      ...(hostedRenderAvailable ? [{ transport: 'mcp-tool', name: RENDER_EXPORT_TOOL, feature: HOSTED_RENDER_FEATURE }] : []),
      ...Object.entries(CHATGPT_MCP_METHOD_FEATURES).map(([name, feature]) => ({
        transport: 'mcp-method',
        name,
        feature
      }))
    ]
  }
});
