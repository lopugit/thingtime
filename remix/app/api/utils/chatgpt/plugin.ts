import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { json, redirect } from '~/api/http';
import { signJwt, signPurposeToken, verifyJwt, verifyPurposeToken } from '~/api/utils/auth/jwt';
import { createSession, getLiveSession, revokedSessionPatch, revokeSession } from '~/api/utils/auth/sessions';
import type { SessionDoc } from '~/api/utils/auth/sessions';
import { getSessionsCollection } from '~/api/utils/mongodb/collections';
import { normalizePkceVerifier, pkceVerifierMatches } from '~/api/utils/apps/desktopOAuthCore';
import { validateThingtimeCrystal, validateValueAgainstFields } from '~/schemas/registry';

import {
  CHATGPT_AUTHORIZE_PATH,
  CHATGPT_DYNAMIC_CLIENT_REGISTRATION_PATH,
  CHATGPT_PROTECTED_RESOURCE_METADATA_PATH,
  CHATGPT_MCP_PATH,
  CHATGPT_MCP_INSTRUCTIONS,
  CHATGPT_MCP_METHOD_FEATURES,
  CHATGPT_PLUGIN_FEATURES,
  allowedThingtimeEndpoints,
  applyUpstreamQuery,
  escapeHtml,
  isMcpResourceForOrigin,
  normalizeChatGptOAuthScopes,
  normalizeRegisteredClientRedirectUri,
  normalizeThingtimeEndpoint,
  parseChatGptAuthorizationRequest,
  parseCredentialBundle,
  pluginDiscovery,
  renderConnectionPage
} from './pluginCore';
import type {
  CHATGPT_MCP_TOOL_FEATURES,
  ChatGptConnection,
  ChatGptCredentialBundle,
  ChatGptDynamicOAuthClient,
  ChatGptOAuthRequest
} from './pluginCore';
import {
  MAX_LIMITLESS_HISTORY,
  MAX_LIMITLESS_WORKFLOW_RUNS,
  THINGTIME_CAPABILITY_CONTRACT,
  THINGTIME_CAPABILITY_CONTRACT_URI,
  THINGTIME_MCP_UI_RESOURCE_URI,
  THINGTIME_MUTATION_RECEIPT_PURPOSE,
  buildLimitlessMutationPreview,
  compileThingtimeCapability,
  normalizeLimitlessMutationOperations,
  renderThingtimeMcpUi,
  thingtimePromptDefinitions,
  type LimitlessMutationOperation,
  type LimitlessMutationPreview,
  type ThingtimeMcpHistoryEntry,
  type ThingtimeMcpWorkflowRun
} from './pluginLimitlessCore';

const OAUTH_REQUEST_PURPOSE = 'chatgpt-oauth-request';
const OAUTH_CODE_PURPOSE = 'chatgpt-oauth-code';
const OAUTH_DYNAMIC_CLIENT_PURPOSE = 'chatgpt-oauth-dynamic-client';
const MCP_SESSION_PURPOSE = 'chatgpt-mcp';
const MCP_REFRESH_SESSION_PURPOSE = 'chatgpt-mcp-refresh';
const MCP_CONNECTION_PURPOSE = 'chatgpt-mcp-connection';
const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 512 * 1024;
const MAX_ENCRYPTED_BUNDLE_PLAINTEXT_BYTES = 768 * 1024;
const MAX_ENCRYPTED_STATE_BYTES = 384 * 1024;

type Failure = { ok: false; status: number; error: string };
type Success<T> = { ok: true; value: T };
type Result<T> = Failure | Success<T>;

const noStoreHeaders = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

// The bridge is revocable through its server-side session record, but it does
// not expire by default. OAuth authorization codes stay short-lived and
// PKCE-bound; only the connection credentials are persistent.
const infiniteExpiryFilter = (now: Date) => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
});

// Single-use grant consumption (refresh rotation) revokes the record it burns.
// Rotation is the highest-frequency revoke on this bridge — every refresh burns
// one never-expiring refresh session and mints another — so a plain
// `$set: { revokedAt }` would leave each consumed row at expiresAt: null, which
// the sessions TTL index skips, orphaning one document per rotation forever.
// revokedSessionPatch fills a missing expiry and preserves a real one, so this
// is also correct for grants that already carry a short TTL.
export const consumedSessionPatch = (now: Date) => [
  { $set: revokedSessionPatch(now) },
  { $set: { 'meta.consumedAt': now } }
];

const requestOrigin = (request: Request) => new URL(request.url).origin;

const configuredCipherKey = (): Buffer | null => {
  const encoded = process.env.THINGTIME_CHATGPT_CREDENTIAL_KEY?.trim();
  if (!encoded) return null;
  try {
    const key = Buffer.from(encoded, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
};

const encryptBundle = (bundle: ChatGptCredentialBundle): Result<string> => {
  const key = configuredCipherKey();
  if (!key) return { ok: false, status: 503, error: 'ChatGPT credential storage is not configured on this Thingtime endpoint' };

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf8');
  if (plaintext.byteLength > MAX_ENCRYPTED_BUNDLE_PLAINTEXT_BYTES) {
    return { ok: false, status: 413, error: 'ChatGPT connection state is too large; remove older history or split the workflow' };
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ok: true, value: `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}` };
};

const decryptBundle = (ciphertext: unknown): Result<ChatGptCredentialBundle> => {
  const key = configuredCipherKey();
  if (!key) return { ok: false, status: 503, error: 'ChatGPT credential storage is not configured on this Thingtime endpoint' };
  if (typeof ciphertext !== 'string') return { ok: false, status: 401, error: 'ChatGPT connection is invalid' };

  const parts = ciphertext.split('.');
  if (parts.length !== 3) return { ok: false, status: 401, error: 'ChatGPT connection is invalid' };
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const encrypted = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error('invalid cipher envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const bundle = parseCredentialBundle(JSON.parse(plain.toString('utf8')));
    if (!bundle) throw new Error('invalid bundle');
    return { ok: true, value: bundle };
  } catch {
    return { ok: false, status: 401, error: 'ChatGPT connection is invalid' };
  }
};

const limitRequestBody = async (request: Request, maxBytes = MAX_REQUEST_BYTES): Promise<Result<string>> => {
  const length = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maxBytes) return { ok: false, status: 413, error: 'Request body too large' };
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, value: '' };
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, error: 'Request body too large' };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(merged) };
};

const formBody = async (request: Request): Promise<Result<URLSearchParams>> => {
  const body = await limitRequestBody(request);
  if (body.ok === false) return { ok: false, status: body.status, error: body.error };
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return { ok: false, status: 415, error: 'Content-Type must be application/x-www-form-urlencoded' };
  }
  return { ok: true, value: new URLSearchParams(body.value) };
};

const jsonBody = async (request: Request): Promise<Result<unknown>> => {
  const body = await limitRequestBody(request);
  if (body.ok === false) return body;
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return { ok: false, status: 415, error: 'Content-Type must be application/json' };
  }
  try {
    return { ok: true, value: JSON.parse(body.value) };
  } catch {
    return { ok: false, status: 400, error: 'Request body must be valid JSON' };
  }
};

const oauthErrorPage = (status: number, message: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Thingtime connection</title><main><h1>Thingtime connection could not continue</h1><p>${escapeHtml(message)}</p></main>`, {
    status,
    headers: { ...noStoreHeaders, 'Content-Type': 'text/html; charset=utf-8' }
  });

const clientRequestFromClaims = (claims: Record<string, unknown>): ChatGptOAuthRequest | null => {
  const clientId = typeof claims.clientId === 'string' ? claims.clientId : '';
  const redirectUri = typeof claims.redirectUri === 'string' ? claims.redirectUri : '';
  const state = typeof claims.state === 'string' ? claims.state : '';
  const codeChallenge = typeof claims.codeChallenge === 'string' ? claims.codeChallenge : '';
  const resource = typeof claims.resource === 'string' ? claims.resource : '';
  const rawScope = Array.isArray(claims.scope) ? claims.scope.filter((value): value is string => typeof value === 'string') : [];
  const scope = normalizeChatGptOAuthScopes(rawScope);
  if (!clientId || !redirectUri || !state || !codeChallenge || !resource || !scope) return null;
  return { clientId, redirectUri, state, codeChallenge, resource, scope };
};

const dynamicClientFromId = async (clientId: string): Promise<ChatGptDynamicOAuthClient | null> => {
  const claims = await verifyPurposeToken(clientId, OAUTH_DYNAMIC_CLIENT_PURPOSE);
  if (!claims || !Array.isArray(claims.redirectUris)) return null;
  const redirectUris = [...new Set(claims.redirectUris.map(normalizeRegisteredClientRedirectUri).filter((value): value is string => Boolean(value)))];
  if (!redirectUris.length || redirectUris.length > 8) return null;
  return { clientId, redirectUris };
};

type PatIntrospection = {
  ok: boolean;
  token?: { scopes?: unknown; status?: unknown };
  user?: { id?: unknown; username?: unknown; displayName?: unknown };
  error?: unknown;
};

const boundedResponseText = async (response: Response): Promise<Result<string>> => {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_RESPONSE_BYTES) {
    return { ok: false, status: 502, error: 'Thingtime endpoint response is too large' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { ok: true, value: '' };
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_UPSTREAM_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 502, error: 'Thingtime endpoint response is too large' };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(merged) };
};

const endpointRequest = async (
  endpoint: string,
  token: string,
  path: string,
  init: { method?: string; query?: Record<string, string | number | null | undefined>; body?: unknown } = {}
): Promise<Result<unknown>> => {
  const normalizedEndpoint = normalizeThingtimeEndpoint(endpoint);
  if (!normalizedEndpoint) return { ok: false, status: 403, error: 'This Thingtime endpoint is no longer allowed by the gateway' };

  const url = applyUpstreamQuery(new URL(path, normalizedEndpoint), init.query);
  try {
    const response = await fetch(url, {
      method: init.method || 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const text = await boundedResponseText(response);
    if (!text.ok) return text;
    let payload: unknown;
    try {
      payload = text.value ? JSON.parse(text.value) : null;
    } catch {
      return { ok: false, status: 502, error: 'Thingtime endpoint returned invalid JSON' };
    }
    if (!response.ok || (payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false)) {
      const error = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error.slice(0, 1024)
        : `Thingtime endpoint returned HTTP ${response.status}`;
      return { ok: false, status: response.status || 502, error };
    }
    return { ok: true, value: payload };
  } catch {
    return { ok: false, status: 502, error: 'Thingtime endpoint could not be reached' };
  }
};

const validateCredential = async (endpoint: string, token: string): Promise<Result<Omit<ChatGptConnection, 'id' | 'label' | 'endpoint' | 'token' | 'connectedAt'>>> => {
  const response = await endpointRequest(endpoint, token, '/api/v1/tokens/self');
  if (response.ok === false) return { ok: false, status: response.status, error: response.error };
  const payload = response.value as PatIntrospection;
  const user = payload?.user;
  if (!payload?.ok || payload.token?.status !== 'active' || !user || typeof user.id !== 'string' || typeof user.username !== 'string') {
    return { ok: false, status: 401, error: 'That credential is not a live Thingtime personal access token' };
  }
  const scopes = Array.isArray(payload.token?.scopes) ? payload.token.scopes.filter((value): value is string => typeof value === 'string') : [];
  if (!scopes.some((scope) => scope === 'things' || scope === 'things.read')) {
    return { ok: false, status: 403, error: 'That personal access token needs at least the things.read scope' };
  }
  return {
    ok: true,
    value: {
      user: { id: user.id, username: user.username, displayName: typeof user.displayName === 'string' ? user.displayName : null },
      scopes
    }
  };
};

const requestClaimsToken = async (request: ChatGptOAuthRequest) =>
  signPurposeToken(OAUTH_REQUEST_PURPOSE, request, '10m');

type McpConnectionReference = { connectionId: string; sessionJti: string };
type ResolvedMcpBundle = { bundle: ChatGptCredentialBundle; connection: SessionDoc | null };

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const connectionReferenceFromMeta = (meta: unknown): McpConnectionReference | null => {
  if (!meta || typeof meta !== 'object') return null;
  const value = meta as Record<string, unknown>;
  return isUuid(value.connectionId) && isUuid(value.connectionSessionJti)
    ? { connectionId: value.connectionId, sessionJti: value.connectionSessionJti }
    : null;
};

const scopeText = (hasOfflineAccess: boolean) => (hasOfflineAccess ? 'thingtime offline_access' : 'thingtime');
const hasOfflineAccess = (scope: readonly string[]) => scope.includes('offline_access');

const createMcpConnection = async ({
  userId,
  clientId,
  resource,
  ciphertext,
  connectionId
}: {
  userId: string;
  clientId: string;
  resource: string;
  ciphertext: string;
  connectionId: string;
}): Promise<McpConnectionReference> => {
  const session = await createSession(userId, {
    purpose: MCP_CONNECTION_PURPOSE,
    expiresAt: null,
    meta: { clientId, resource, ciphertext, connectionId }
  });
  return { connectionId, sessionJti: session.jti };
};

const createMcpAccessGrant = async ({
  userId,
  resource,
  connection
}: {
  userId: string;
  resource: string;
  connection: McpConnectionReference;
}) => {
  const session = await createSession(userId, {
    purpose: MCP_SESSION_PURPOSE,
    expiresAt: null,
    meta: { resource, connectionId: connection.connectionId, connectionSessionJti: connection.sessionJti }
  });
  return {
    accessToken: await signJwt({ sub: userId, jti: session.jti, expiresIn: null })
  };
};

const createMcpRefreshGrant = async ({
  userId,
  clientId,
  resource,
  connection
}: {
  userId: string;
  clientId: string;
  resource: string;
  connection: McpConnectionReference;
}) => {
  const session = await createSession(userId, {
    purpose: MCP_REFRESH_SESSION_PURPOSE,
    expiresAt: null,
    meta: { clientId, resource, connectionId: connection.connectionId, connectionSessionJti: connection.sessionJti }
  });
  return signJwt({ sub: userId, jti: session.jti, expiresIn: null });
};

const resolveMcpBundle = async (session: SessionDoc, origin: string): Promise<Result<ResolvedMcpBundle>> => {
  const resource = session.meta?.resource;
  if (!isMcpResourceForOrigin(resource, origin)) return { ok: false, status: 401, error: 'Authentication required' };

  const reference = connectionReferenceFromMeta(session.meta);
  if (!reference) {
    const legacyBundle = decryptBundle(session.meta?.ciphertext);
    if (legacyBundle.ok === false) return legacyBundle;
    return { ok: true, value: { bundle: legacyBundle.value, connection: null } };
  }

  const connection = await getLiveSession(reference.sessionJti);
  if (
    !connection ||
    connection.purpose !== MCP_CONNECTION_PURPOSE ||
    String(connection.userId) !== String(session.userId) ||
    connection.meta?.connectionId !== reference.connectionId ||
    connection.meta?.resource !== resource
  ) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  const bundle = decryptBundle(connection.meta?.ciphertext);
  if (bundle.ok === false) return bundle;
  return { ok: true, value: { bundle: bundle.value, connection } };
};

export const beginChatGptAuthorization = async ({ request }: { request: Request }) => {
  const params = new URL(request.url).searchParams;
  const dynamicClient = await dynamicClientFromId(params.get('client_id')?.trim() || '');
  const parsed = parseChatGptAuthorizationRequest(params, requestOrigin(request), dynamicClient);
  if (parsed.ok === false) return oauthErrorPage(400, parsed.error);
  const allowed = allowedThingtimeEndpoints();
  if (!allowed.length) return oauthErrorPage(503, 'No Thingtime API endpoints have been configured for ChatGPT connections.');
  if (!configuredCipherKey()) return oauthErrorPage(503, 'This Thingtime endpoint has not configured encrypted ChatGPT credential storage.');

  const requestToken = await requestClaimsToken(parsed.request);
  return new Response(renderConnectionPage(requestToken, allowed), {
    headers: {
      ...noStoreHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors https://chatgpt.com",
      'Referrer-Policy': 'no-referrer'
    }
  });
};

export const registerChatGptOAuthClient = async ({ request }: { request: Request }) => {
  const body = await jsonBody(request);
  if (body.ok === false) {
    return json({ error: 'invalid_client_metadata', error_description: body.error }, { status: body.status, headers: noStoreHeaders });
  }
  const candidate = body.value && typeof body.value === 'object' ? body.value as Record<string, unknown> : null;
  const rawRedirectUris = candidate?.redirect_uris;
  if (!Array.isArray(rawRedirectUris) || rawRedirectUris.length < 1 || rawRedirectUris.length > 8) {
    return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must contain between one and eight supported ChatGPT or loopback callbacks' }, { status: 400, headers: noStoreHeaders });
  }
  const redirectUris = [...new Set(rawRedirectUris.map(normalizeRegisteredClientRedirectUri).filter((value): value is string => Boolean(value)))];
  if (redirectUris.length !== rawRedirectUris.length) {
    return json({ error: 'invalid_redirect_uri', error_description: 'Every redirect URI must be an exact ChatGPT connector or http://127.0.0.1:<port>/callback URL' }, { status: 400, headers: noStoreHeaders });
  }
  const clientId = await signPurposeToken(OAUTH_DYNAMIC_CLIENT_PURPOSE, { redirectUris }, '1y');
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
      scope: 'thingtime offline_access'
    },
    { status: 201, headers: noStoreHeaders }
  );
};

export const submitChatGptAuthorization = async ({ request }: { request: Request }) => {
  const form = await formBody(request);
  if (form.ok === false) return oauthErrorPage(form.status, form.error);

  const signedRequest = form.value.get('request');
  const claims = typeof signedRequest === 'string' ? await verifyPurposeToken(signedRequest, OAUTH_REQUEST_PURPOSE) : null;
  const oauthRequest = claims ? clientRequestFromClaims(claims) : null;
  if (!oauthRequest) return oauthErrorPage(400, 'This connection request has expired or is invalid. Return to ChatGPT and try again.');

  const labels = form.value.getAll('label');
  const endpoints = form.value.getAll('endpoint');
  const tokens = form.value.getAll('token');
  if (!labels.length || labels.length !== endpoints.length || labels.length !== tokens.length || labels.length > 20) {
    return oauthErrorPage(400, 'Add between one and twenty complete Thingtime accounts.');
  }

  const connections: ChatGptConnection[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    const endpoint = normalizeThingtimeEndpoint(endpoints[index]);
    const label = typeof labels[index] === 'string' ? labels[index].trim().slice(0, 80) : '';
    const token = typeof tokens[index] === 'string' ? tokens[index].trim() : '';
    if (!endpoint || !label || token.length < 24 || token.length > 8192) {
      return oauthErrorPage(400, 'Every account needs a label, an allowed endpoint, and a valid personal access token.');
    }
    const inspected = await validateCredential(endpoint, token);
    if (inspected.ok === false) return oauthErrorPage(inspected.status, `Could not connect “${label}”: ${inspected.error}`);
    connections.push({
      id: crypto.randomUUID(),
      label,
      endpoint,
      token,
      user: inspected.value.user,
      scopes: inspected.value.scopes,
      connectedAt: new Date().toISOString()
    });
  }

  const encrypted = encryptBundle({ version: 1, defaultConnectionId: connections[0].id, connections });
  if (encrypted.ok === false) return oauthErrorPage(encrypted.status, encrypted.error);
  const expiresAt = new Date(Date.now() + OAUTH_CODE_TTL_MS);
  const connectionId = crypto.randomUUID();
  const codeSession = await createSession(connections[0].user.id, {
    purpose: OAUTH_CODE_PURPOSE,
    expiresAt,
    meta: {
      clientId: oauthRequest.clientId,
      redirectUri: oauthRequest.redirectUri,
      state: oauthRequest.state,
      codeChallenge: oauthRequest.codeChallenge,
      codeChallengeMethod: 'S256',
      resource: oauthRequest.resource,
      scope: oauthRequest.scope,
      connectionId,
      ciphertext: encrypted.value
    }
  });
  const code = await signJwt({ sub: connections[0].user.id, jti: codeSession.jti, expiresIn: '5m' });
  const callback = new URL(oauthRequest.redirectUri);
  callback.searchParams.set('code', code);
  callback.searchParams.set('state', oauthRequest.state);
  callback.searchParams.set('iss', requestOrigin(request));
  return redirect(callback.toString(), { status: 302, headers: noStoreHeaders });
};

const invalidGrant = () => json({ error: 'invalid_grant', error_description: 'Authorization grant is invalid, expired, already used, or does not match this request' }, { status: 400, headers: noStoreHeaders });

const exchangeAuthorizationCodeGrant = async (params: URLSearchParams, origin: string) => {
  const code = params.get('code')?.trim() || '';
  const verifier = normalizePkceVerifier(params.get('code_verifier'));
  const clientId = params.get('client_id')?.trim() || '';
  const redirectUri = params.get('redirect_uri')?.trim() || '';
  const resource = params.get('resource')?.trim() || '';
  if (!code || !verifier || !clientId || !redirectUri || !resource || !isMcpResourceForOrigin(resource, origin)) return invalidGrant();

  const claims = await verifyJwt(code);
  if (!claims) return invalidGrant();
  const sessions = await getSessionsCollection();
  const now = new Date();
  const consumed = await sessions.findOneAndUpdate(
    {
      jti: claims.jti,
      userId: claims.sub,
      purpose: OAUTH_CODE_PURPOSE,
      revokedAt: null,
      expiresAt: { $gt: now },
      'meta.clientId': clientId,
      'meta.redirectUri': redirectUri,
      'meta.resource': resource,
      'meta.codeChallengeMethod': 'S256'
    },
    { $set: { revokedAt: now, 'meta.consumedAt': now } },
    { returnDocument: 'before' }
  );
  if (!consumed || !pkceVerifierMatches(verifier, consumed.meta?.codeChallenge)) return invalidGrant();

  const bundle = decryptBundle(consumed.meta?.ciphertext);
  if (bundle.ok === false) return json({ error: 'server_error', error_description: bundle.error }, { status: bundle.status, headers: noStoreHeaders });
  const encrypted = encryptBundle(bundle.value);
  if (encrypted.ok === false) return json({ error: 'server_error', error_description: encrypted.error }, { status: encrypted.status, headers: noStoreHeaders });
  const connection = await createMcpConnection({
    userId: claims.sub,
    clientId,
    resource,
    ciphertext: encrypted.value,
    connectionId: isUuid(consumed.meta?.connectionId) ? consumed.meta.connectionId : crypto.randomUUID()
  });
  const access = await createMcpAccessGrant({ userId: claims.sub, resource, connection });
  const scope = normalizeChatGptOAuthScopes(
    Array.isArray(consumed.meta?.scope) ? consumed.meta.scope.filter((value): value is string => typeof value === 'string') : ['thingtime']
  ) || ['thingtime'];
  const offlineAccess = hasOfflineAccess(scope);
  const refreshToken = offlineAccess
    ? await createMcpRefreshGrant({ userId: claims.sub, clientId, resource, connection })
    : null;
  return json(
    {
      access_token: access.accessToken,
      token_type: 'Bearer',
      scope: scopeText(offlineAccess),
      ...(refreshToken ? { refresh_token: refreshToken } : {})
    },
    { headers: noStoreHeaders }
  );
};

const exchangeRefreshTokenGrant = async (params: URLSearchParams, origin: string) => {
  const refreshToken = params.get('refresh_token')?.trim() || '';
  const clientId = params.get('client_id')?.trim() || '';
  const requestedResource = params.get('resource');
  const resource = requestedResource?.trim() || '';
  if (!refreshToken || !clientId || (requestedResource !== null && (!resource || !isMcpResourceForOrigin(resource, origin)))) return invalidGrant();

  const claims = await verifyJwt(refreshToken);
  if (!claims) return invalidGrant();
  const now = new Date();
  const refreshFilter: Record<string, unknown> = {
    jti: claims.jti,
    userId: claims.sub,
    purpose: MCP_REFRESH_SESSION_PURPOSE,
    revokedAt: null,
    'meta.clientId': clientId
  };
  Object.assign(refreshFilter, infiniteExpiryFilter(now));
  if (resource) refreshFilter['meta.resource'] = resource;
  const consumed = await (await getSessionsCollection()).findOneAndUpdate(
    refreshFilter,
    consumedSessionPatch(now),
    { returnDocument: 'before' }
  );
  if (!consumed) return invalidGrant();

  const resolved = await resolveMcpBundle(consumed, origin);
  const connection = connectionReferenceFromMeta(consumed.meta);
  if (resolved.ok === false || !resolved.value.connection || !connection) return invalidGrant();

  const extended = await (await getSessionsCollection()).updateOne(
    {
      jti: connection.sessionJti,
      userId: claims.sub,
      purpose: MCP_CONNECTION_PURPOSE,
      revokedAt: null,
      'meta.connectionId': connection.connectionId,
      ...infiniteExpiryFilter(now)
    },
    { $set: { 'meta.updatedAt': now } }
  );
  if (!extended.matchedCount) return invalidGrant();

  const storedResource = typeof consumed.meta?.resource === 'string' ? consumed.meta.resource : '';
  const access = await createMcpAccessGrant({ userId: claims.sub, resource: storedResource, connection });
  const nextRefreshToken = await createMcpRefreshGrant({ userId: claims.sub, clientId, resource: storedResource, connection });
  return json(
    {
      access_token: access.accessToken,
      token_type: 'Bearer',
      refresh_token: nextRefreshToken,
      scope: scopeText(true)
    },
    { headers: noStoreHeaders }
  );
};

export const exchangeChatGptAuthorizationCode = async ({ request }: { request: Request }) => {
  const form = await formBody(request);
  if (form.ok === false) return json({ error: 'invalid_request', error_description: form.error }, { status: form.status, headers: noStoreHeaders });
  const params = form.value;
  const origin = requestOrigin(request);
  if (params.get('grant_type') === 'authorization_code') return exchangeAuthorizationCodeGrant(params, origin);
  if (params.get('grant_type') === 'refresh_token') return exchangeRefreshTokenGrant(params, origin);
  return json({ error: 'unsupported_grant_type', error_description: 'grant_type must be authorization_code or refresh_token' }, { status: 400, headers: noStoreHeaders });
};

type McpSession = {
  session: SessionDoc;
  bundle: ChatGptCredentialBundle;
  connection: SessionDoc | null;
  persistBundle?: (bundle: ChatGptCredentialBundle) => Promise<Result<void>>;
};

const persistMcpBundle = async (context: McpSession): Promise<Result<void>> => {
  if (context.persistBundle) return context.persistBundle(context.bundle);
  const encrypted = encryptBundle(context.bundle);
  if (encrypted.ok === false) return { ok: false, status: encrypted.status, error: encrypted.error };
  const sessions = await getSessionsCollection();
  const now = new Date();
  if (context.connection) {
    const reference = connectionReferenceFromMeta(context.session.meta);
    if (!reference) return { ok: false, status: 401, error: 'ChatGPT connection is invalid' };
    const updated = await sessions.updateOne(
      {
        jti: context.connection.jti,
        userId: context.session.userId,
        purpose: MCP_CONNECTION_PURPOSE,
        revokedAt: null,
        'meta.connectionId': reference.connectionId,
        ...infiniteExpiryFilter(now)
      },
      { $set: { 'meta.ciphertext': encrypted.value, 'meta.updatedAt': now } }
    );
    if (!updated.matchedCount) return { ok: false, status: 401, error: 'ChatGPT connection is no longer active' };
    return { ok: true, value: undefined };
  }

  const updated = await sessions.updateOne(
    { jti: context.session.jti, purpose: MCP_SESSION_PURPOSE, revokedAt: null, ...infiniteExpiryFilter(now) },
    { $set: { 'meta.ciphertext': encrypted.value, 'meta.updatedAt': now } }
  );
  if (!updated.matchedCount) return { ok: false, status: 401, error: 'ChatGPT connection is no longer active' };
  return { ok: true, value: undefined };
};

const revokeMcpConnection = async (context: McpSession) => {
  if (!context.connection) return revokeSession(context.session.jti);
  const reference = connectionReferenceFromMeta(context.session.meta);
  if (!reference) return revokeSession(context.session.jti);
  const sessions = await getSessionsCollection();
  const now = new Date();
  // Bridge sessions no longer expire on their own, so a disconnect has to leave
  // behind a reap date: the sessions TTL index skips expiresAt: null, and these
  // revoked records would accumulate forever without one. revokedSessionPatch
  // fills a missing expiry and preserves a real one (legacy bridge sessions
  // minted before the infinite-expiry switch still carry theirs).
  const revoked = [{ $set: revokedSessionPatch(now) }, { $set: { 'meta.revokedAt': now } }];
  await Promise.all([
    sessions.updateOne(
      {
        jti: context.connection.jti,
        userId: context.session.userId,
        purpose: MCP_CONNECTION_PURPOSE,
        revokedAt: null,
        'meta.connectionId': reference.connectionId
      },
      revoked
    ),
    sessions.updateMany(
      {
        userId: context.session.userId,
        purpose: { $in: [MCP_SESSION_PURPOSE, MCP_REFRESH_SESSION_PURPOSE] },
        revokedAt: null,
        'meta.connectionSessionJti': context.connection.jti
      },
      revoked
    )
  ]);
};

const resolveMcpSession = async (request: Request): Promise<Result<McpSession>> => {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Authentication required' };
  const claims = await verifyJwt(token);
  if (!claims) return { ok: false, status: 401, error: 'Authentication required' };
  const session = await getLiveSession(claims.jti);
  if (
    !session ||
    session.purpose !== MCP_SESSION_PURPOSE ||
    String(session.userId) !== claims.sub
  ) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }
  const resolved = await resolveMcpBundle(session, requestOrigin(request));
  if (resolved.ok === false) return { ok: false, status: resolved.status, error: resolved.error };
  return { ok: true, value: { session, bundle: resolved.value.bundle, connection: resolved.value.connection } };
};

const publicConnection = (connection: ChatGptConnection) => ({
  id: connection.id,
  label: connection.label,
  endpoint: connection.endpoint,
  username: connection.user.username,
  displayName: connection.user.displayName,
  scopes: connection.scopes,
  connectedAt: connection.connectedAt
});

const accountFor = (bundle: ChatGptCredentialBundle, accountId: unknown): ChatGptConnection | null => {
  const selected = typeof accountId === 'string' && accountId ? accountId : bundle.defaultConnectionId;
  return bundle.connections.find((connection) => connection.id === selected) || null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
const stringValue = (value: unknown, max = 2048) => (typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null);
const boundedLimit = (value: unknown) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, 100) : undefined;
};

const boundedStringList = (value: unknown, max = 100): string[] | null => {
  if (!Array.isArray(value) || !value.length || value.length > max) return null;
  const strings = value.map((entry) => stringValue(entry, 128));
  if (strings.some((entry) => !entry)) return null;
  return [...new Set(strings as string[])];
};

const accountScopeCovers = (account: ChatGptConnection, required: string): boolean =>
  account.scopes.some((scope) => scope === required || required.startsWith(`${scope}.`));

const requiredScopeForOperation = (operation: LimitlessMutationOperation): string =>
  operation.action === 'create' ? 'things.create' : operation.action === 'update' ? 'things.update' : 'things.delete';

const readExactThing = async (account: ChatGptConnection, id: string): Promise<Result<Record<string, unknown>>> => {
  const upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things', { query: { id } });
  if (upstream.ok === false) return upstream;
  const payload = asRecord(upstream.value);
  const thing = payload ? asRecord(payload.thing) : null;
  return thing ? { ok: true, value: thing } : { ok: false, status: 502, error: 'Thingtime endpoint returned no Thing' };
};

const safeStateSize = (bundle: ChatGptCredentialBundle): number =>
  Buffer.byteLength(JSON.stringify({ history: bundle.history || [], runs: bundle.runs || [] }), 'utf8');

const pruneMcpState = (bundle: ChatGptCredentialBundle) => {
  bundle.history = (bundle.history || []).slice(-MAX_LIMITLESS_HISTORY);
  bundle.runs = (bundle.runs || []).slice(-MAX_LIMITLESS_WORKFLOW_RUNS);
  while (safeStateSize(bundle) > MAX_ENCRYPTED_STATE_BYTES && ((bundle.history?.length || 0) || (bundle.runs?.length || 0))) {
    const historyTime = bundle.history?.[0]?.createdAt || '9999';
    const runTime = bundle.runs?.[0]?.createdAt || '9999';
    if (historyTime <= runTime && bundle.history?.length) bundle.history.shift();
    else if (bundle.runs?.length) bundle.runs.shift();
    else break;
  }
};

const appendHistory = (bundle: ChatGptCredentialBundle, entry: ThingtimeMcpHistoryEntry) => {
  bundle.history = [...(bundle.history || []), entry];
  pruneMcpState(bundle);
};

const upsertWorkflowRun = (bundle: ChatGptCredentialBundle, run: ThingtimeMcpWorkflowRun) => {
  bundle.runs = [...(bundle.runs || []).filter((entry) => entry.id !== run.id), run];
  pruneMcpState(bundle);
};

const previewMutations = async (
  account: ChatGptConnection,
  rawOperations: unknown,
  source?: LimitlessMutationPreview['source']
): Promise<Result<{ preview: LimitlessMutationPreview; receipt: string }>> => {
  const normalized = normalizeLimitlessMutationOperations(rawOperations);
  if (normalized.ok === false) return { ok: false, status: 400, error: normalized.error };
  for (const operation of normalized.value) {
    const required = requiredScopeForOperation(operation);
    if (!accountScopeCovers(account, required)) {
      return { ok: false, status: 403, error: `The selected Thingtime token needs ${required} for Thing ${operation.id}` };
    }
  }

  const beforeById = new Map<string, Record<string, unknown>>();
  for (const operation of normalized.value) {
    const current = await readExactThing(account, operation.id);
    if (operation.action === 'create') {
      if (current.ok === true) beforeById.set(operation.id, current.value);
      else if (current.status !== 404) return { ok: false, status: current.status, error: current.error };
      continue;
    }
    if (current.ok === false) {
      return current.status === 404 ? { ok: false, status: 404, error: `thing_not_found:${operation.id}` } : current;
    }
    beforeById.set(operation.id, current.value);
  }

  const built = buildLimitlessMutationPreview({ accountId: account.id, operations: normalized.value, beforeById });
  if (built.ok === false) return { ok: false, status: built.error.startsWith('thing_not_found') ? 404 : 409, error: built.error };
  if (source) built.value.source = source;
  const receipt = await signPurposeToken(THINGTIME_MUTATION_RECEIPT_PURPOSE, { preview: built.value }, '30m');
  return { ok: true, value: { preview: built.value, receipt } };
};

const previewFromReceipt = async (receipt: unknown): Promise<Result<LimitlessMutationPreview>> => {
  if (typeof receipt !== 'string' || receipt.length > MAX_REQUEST_BYTES) {
    return { ok: false, status: 400, error: 'A signed preview receipt is required' };
  }
  const claims = await verifyPurposeToken(receipt, THINGTIME_MUTATION_RECEIPT_PURPOSE);
  const preview = claims ? asRecord(claims.preview) : null;
  if (!preview || preview.version !== 1 || typeof preview.previewId !== 'string' || typeof preview.accountId !== 'string' || !Array.isArray(preview.operations) || !Array.isArray(preview.inverseOperations)) {
    return { ok: false, status: 400, error: 'The mutation preview receipt is invalid or expired' };
  }
  return { ok: true, value: preview as unknown as LimitlessMutationPreview };
};

const preflightPreview = async (account: ChatGptConnection, preview: LimitlessMutationPreview): Promise<Result<void>> => {
  for (const operation of preview.operations) {
    const current = await readExactThing(account, operation.id);
    if (operation.action === 'create') {
      if (current.ok === true) return { ok: false, status: 409, error: `Thing ${operation.id} was created after the preview; build a new preview` };
      if (current.status !== 404) return { ok: false, status: current.status, error: current.error };
      continue;
    }
    if (current.ok === false) return { ok: false, status: 409, error: `Thing ${operation.id} changed or disappeared after the preview` };
    if (operation.expectedUpdatedAt && current.value.updatedAt !== operation.expectedUpdatedAt) {
      return { ok: false, status: 409, error: `Thing ${operation.id} changed after the preview; build a new preview` };
    }
  }
  return { ok: true, value: undefined };
};

const applyMutationOperation = async (account: ChatGptConnection, operation: LimitlessMutationOperation): Promise<Result<unknown>> => {
  if (operation.action === 'create') {
    return endpointRequest(account.endpoint, account.token, '/api/v1/things', { method: 'POST', body: operation.thing });
  }
  if (operation.action === 'update') {
    return endpointRequest(account.endpoint, account.token, '/api/v1/things/update', {
      method: 'POST',
      body: {
        id: operation.id,
        ...(operation.patch || {}),
        ...(operation.replaceCrystal ? { replaceCrystal: true } : {}),
        ...(operation.expectedUpdatedAt ? { expectedUpdatedAt: operation.expectedUpdatedAt } : {})
      }
    });
  }
  return endpointRequest(account.endpoint, account.token, '/api/v1/things/delete', {
    method: 'POST',
    body: { id: operation.id, ...(operation.expectedUpdatedAt ? { expectedUpdatedAt: operation.expectedUpdatedAt } : {}) }
  });
};

const inverseForItem = (preview: LimitlessMutationPreview, item: LimitlessMutationPreview['operations'][number]): LimitlessMutationOperation | null => {
  if (item.action === 'create') return { action: 'delete', id: item.id };
  if (item.action === 'delete') {
    const thing = item.before && asRecord(item.before) ? {
      shareId: item.before.id,
      thingtime: item.before.thingtime,
      crystal: item.before.crystal,
      extended: item.before.extended,
      acl: item.before.acl,
      tags: item.before.tags,
      folderId: item.before.folderId,
      targetId: item.before.targetId
    } : null;
    return thing ? { action: 'create', id: item.id, thing } : null;
  }
  return preview.inverseOperations.find((entry) => entry.action === 'update' && entry.id === item.id) || null;
};

const applyMutationPreview = async (
  account: ChatGptConnection,
  preview: LimitlessMutationPreview
): Promise<{ history: ThingtimeMcpHistoryEntry; applied: number }> => {
  const results: ThingtimeMcpHistoryEntry['results'] = [];
  const inverseOperations: LimitlessMutationOperation[] = [];
  let stopped = false;
  for (const item of preview.operations) {
    if (stopped) {
      results.push({ action: item.action, id: item.id, ok: false, error: 'Not attempted after an earlier operation failed' });
      continue;
    }
    const result = await applyMutationOperation(account, item);
    if (result.ok === true) {
      results.push({ action: item.action, id: item.id, ok: true });
      const inverse = inverseForItem(preview, item);
      if (inverse) inverseOperations.unshift(inverse);
    } else {
      results.push({ action: item.action, id: item.id, ok: false, error: result.error });
      stopped = true;
    }
  }
  const succeeded = results.filter((entry) => entry.ok).length;
  const history: ThingtimeMcpHistoryEntry = {
    id: randomBytes(16).toString('hex'),
    accountId: account.id,
    createdAt: new Date().toISOString(),
    action: preview.source?.kind === 'undo' ? 'undo' : 'apply',
    status: succeeded === results.length ? 'succeeded' : succeeded ? 'partial' : 'failed',
    summaries: preview.operations.map((entry) => entry.summary),
    results,
    ...(inverseOperations.length ? { inverseOperations } : {})
  };
  return { history, applied: succeeded };
};

const oauthSecurityScheme = [{ type: 'oauth2', scopes: ['thingtime'] }] as const;
const protectedToolContract = {
  title: 'Thingtime action',
  securitySchemes: oauthSecurityScheme,
  // Some existing MCP clients read the legacy metadata mirror. Keeping it in
  // sync with the standard field makes the OAuth requirement unambiguous.
  _meta: {
    securitySchemes: oauthSecurityScheme,
    ui: { resourceUri: THINGTIME_MCP_UI_RESOURCE_URI },
    'openai/outputTemplate': THINGTIME_MCP_UI_RESOURCE_URI
  },
  outputSchema: { type: 'object', additionalProperties: true }
} as const;

const protectedTool = <T extends Record<string, unknown>>(tool: T) => ({ ...protectedToolContract, ...tool });

type ChatGptMcpToolName = keyof typeof CHATGPT_MCP_TOOL_FEATURES;
const protectedThingtimeTool = <T extends Record<string, unknown> & { name: ChatGptMcpToolName }>(tool: T) => protectedTool(tool);

export const thingtimeToolDefinitions = [
  protectedThingtimeTool({
    name: 'login_thingtime',
    title: 'Log in to Thingtime',
    description: 'Use for “@Thingtime login”. Without a current Thingtime connection, this OAuth-protected action makes ChatGPT or Codex open the native browser authorization flow and complete its registered callback. The connection page can add multiple named accounts.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_accounts',
    title: 'List connected Thingtime accounts',
    description: 'Use for “@Thingtime list accounts”. List the authenticated named Thingtime accounts connected to this ChatGPT connection. No token values are returned.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'select_thingtime_account',
    title: 'Select default Thingtime account',
    description: 'Make one connected Thingtime account the default for later tool calls.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['accountId'], properties: { accountId: { type: 'string', description: 'An id returned by list_thingtime_accounts.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'remove_thingtime_account',
    title: 'Disconnect Thingtime account',
    description: 'Disconnect one Thingtime account from ChatGPT. The original Thingtime personal access token remains revocable in Thingtime Settings.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['accountId'], properties: { accountId: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_profile',
    title: 'Get Thingtime profile',
    description: 'Read the selected connection’s Thingtime token identity and granted scopes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_thing',
    title: 'Get Thingtime Thing by ID',
    description: 'Retrieve exactly one Thing by its unique ID. If the user or task provides a Thing ID, always prefer this tool over listing or searching Things. Do not use list_thingtime_things to locate a known ID.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { accountId: { type: 'string' }, id: { type: 'string', description: 'The exact unique Thing ID.' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_things',
    title: 'Get multiple Thingtime Things by ID',
    description: 'Retrieve an ordered, bounded set of exact Thing IDs in one call. Each result reports found or thing_not_found independently; never substitutes a recent page.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['ids'], properties: { accountId: { type: 'string' }, ids: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string' } } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_comments',
    title: 'List comments for a Thingtime Thing',
    description: 'List comments directly attached to one known Thing or comment ID. Use this targeted tool when the parent or target ID is known; do not fetch a global Things page and discard unrelated comments.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['targetId'], properties: { accountId: { type: 'string' }, targetId: { type: 'string', description: 'The exact Thing or comment ID whose direct comments should be listed.' }, cursor: { type: 'string', description: 'Optional cursor returned by the previous page.' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_things',
    title: 'List Thingtime Things',
    description: 'Browse or discover Things visible to the selected account when the exact Thing ID is unknown. DO NOT use this tool to retrieve a Thing when its exact ID is already known; use get_thingtime_thing instead.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, thingtime: { type: 'string' }, folder: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'search_thingtime_things',
    title: 'Search Thingtime Things',
    description: 'Use text search to discover Things when no exact Thing ID is known. If an exact ID is supplied, prefer get_thingtime_thing.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, query: { type: 'string' }, thingtime: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_schemas',
    title: 'List Thingtime schemas',
    description: 'List built-in registry schemas, published user-authored schema Things, or both. Use before creating typed data when the schema is not already known.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, source: { type: 'string', enum: ['all', 'builtin', 'published'], default: 'all' }, query: { type: 'string' }, sort: { type: 'string', enum: ['newest', 'oldest', 'popular', 'relevance'] }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_schema',
    title: 'Get one Thingtime schema',
    description: 'Retrieve one exact built-in schema id or one published schema Thing id, including its field contract.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { accountId: { type: 'string' }, id: { type: 'string' }, source: { type: 'string', enum: ['auto', 'builtin', 'published'], default: 'auto' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'validate_thingtime_thing',
    title: 'Validate a Thingtime Thing',
    description: 'Validate a proposed Thing payload against built-in Thingtime schemas and, for data Things carrying crystal.schemaId, the published schema field tree. This never writes.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['thing'], properties: { accountId: { type: 'string' }, thing: { type: 'object' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_related',
    title: 'Traverse Thingtime relationships',
    description: 'Traverse a known Thing through direct attached children, parent, folder children, backlinks, or a bounded thread. Relations remain target/folder based and never expose a raw database query.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'relation'], properties: { accountId: { type: 'string' }, id: { type: 'string' }, relation: { type: 'string', enum: ['children', 'parent', 'folder-children', 'backlinks', 'thread'] }, kind: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, depth: { type: 'integer', minimum: 1, maximum: 3 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_changes',
    title: 'List changed Thingtime Things',
    description: 'Poll a cursor-paginated, ACL-aware set of Things updated at or after an ISO timestamp. Clients should overlap timestamps slightly when resuming. Deletion receipts from MCP mutations live in MCP history.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['since'], properties: { accountId: { type: 'string' }, since: { type: 'string', format: 'date-time' }, cursor: { type: 'string' }, thingtime: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'preview_thingtime_mutation',
    title: 'Preview a safe Thingtime mutation',
    description: 'Build a signed before/after preview for up to 25 create, update, or delete operations. It checks scopes and exact current Things but writes nothing. Apply only after explicit confirmation.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['operations'], properties: { accountId: { type: 'string' }, operations: { type: 'array', minItems: 1, maxItems: 25, items: { type: 'object' } } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'apply_thingtime_mutation',
    title: 'Apply a confirmed Thingtime mutation',
    description: 'Apply an unexpired signed preview receipt only with confirmed=true after explicit user confirmation. Every target is preflighted for optimistic concurrency first. Operations run serially, stop on first failure, and return durable history plus a bounded undo plan rather than silently claiming atomicity.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['receipt', 'confirmed'], properties: { accountId: { type: 'string' }, receipt: { type: 'string' }, confirmed: { type: 'boolean', const: true, description: 'Must be true only after the user explicitly confirms the reviewed plan.' }, runId: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_history',
    title: 'List Thingtime MCP mutation history',
    description: 'List bounded encrypted receipts for changes applied through this MCP connection. It does not claim to be a history of writes made elsewhere.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_history',
    title: 'Get one Thingtime MCP history receipt',
    description: 'Read one exact bounded MCP mutation history entry, including per-operation outcomes and whether an undo plan is available.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['historyId'], properties: { accountId: { type: 'string' }, historyId: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'undo_thingtime_mutation',
    title: 'Preview undo for a Thingtime MCP mutation',
    description: 'Turn a stored inverse plan into a fresh signed preview. This tool does not apply the undo; inspect it and confirm before calling apply_thingtime_mutation.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['historyId'], properties: { accountId: { type: 'string' }, historyId: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'list_thingtime_capabilities',
    title: 'List reusable Thingtime Capabilities',
    description: 'Discover visible data Things marked as Thingtime Capability v1. Capability Things compose only previewable registered mutation primitives.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, query: { type: 'string' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_capability_contract',
    title: 'Get the Thingtime Capability contract',
    description: 'Return the versioned, bounded Capability Thing contract and placeholder grammar. It permits no URLs, arbitrary routes, queries, or executable code.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'start_thingtime_workflow',
    title: 'Start a Thingtime Capability workflow',
    description: 'Load a Capability Thing, bind its explicit inputs, compile registered mutation operations, and persist an awaiting-confirmation run with a signed preview. It does not apply changes.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['capabilityThingId'], properties: { accountId: { type: 'string' }, capabilityThingId: { type: 'string' }, inputs: { type: 'object' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'get_thingtime_workflow',
    title: 'Get a Thingtime workflow run',
    description: 'Read one durable workflow run state from the encrypted MCP connection.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['runId'], properties: { accountId: { type: 'string' }, runId: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'cancel_thingtime_workflow',
    title: 'Cancel a Thingtime workflow run',
    description: 'Cancel an awaiting-confirmation workflow run. Applied runs are immutable history and cannot be cancelled.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['runId'], properties: { accountId: { type: 'string' }, runId: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'create_thingtime_thing',
    title: 'Create Thingtime Thing',
    description: 'Create a Thing using the selected account. Use only after the user confirms the intended content.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['thing'], properties: { accountId: { type: 'string' }, thing: { type: 'object', description: 'Thingtime /api/v1/things create payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }),
  protectedThingtimeTool({
    name: 'update_thingtime_thing',
    title: 'Update Thingtime Thing',
    description: 'Update one owned Thing. Use only after the user confirms the change.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['thing'], properties: { accountId: { type: 'string' }, thing: { type: 'object', description: 'Thingtime /api/v1/things/update payload including id.' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }),
  protectedThingtimeTool({
    name: 'delete_thingtime_thing',
    title: 'Delete Thingtime Thing',
    description: 'Delete one owned Thing. Use only after the user confirms deletion.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { accountId: { type: 'string' }, id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }),
  protectedThingtimeTool({
    name: 'comment_on_thingtime_thing',
    title: 'Comment on Thingtime Thing',
    description: 'Add a comment to a Thing after the user confirms its text.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['comment'], properties: { accountId: { type: 'string' }, comment: { type: 'object', description: 'Thingtime /api/v1/things/comment payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }),
  protectedThingtimeTool({
    name: 'react_to_thingtime_thing',
    title: 'React to Thingtime Thing',
    description: 'Toggle a reaction on a Thing after the user confirms it.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['reaction'], properties: { accountId: { type: 'string' }, reaction: { type: 'object', description: 'Thingtime /api/v1/things/react payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }),
  protectedThingtimeTool({
    name: 'save_thingtime_thing',
    title: 'Save Thingtime Thing',
    description: 'Toggle a Thing in the selected account’s saved library.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { accountId: { type: 'string' }, id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }),
  protectedThingtimeTool({
    name: 'share_thingtime_thing',
    title: 'Share Thingtime Thing',
    description: 'Share a post through the selected Thingtime account after user confirmation.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['share'], properties: { accountId: { type: 'string' }, share: { type: 'object', description: 'Thingtime /api/v1/things/share payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  })
];

const mcpToolResult = (value: unknown, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
  ...(isError ? { isError: true } : {})
});

export const callThingtimeTool = async (name: string, args: Record<string, unknown>, context: McpSession): Promise<unknown> => {
  if (name === 'login_thingtime') {
    return {
      authenticated: true,
      defaultAccountId: context.bundle.defaultConnectionId,
      accounts: context.bundle.connections.map(publicConnection),
      message: 'Thingtime is already authenticated. To add or replace accounts, use the host connection controls to reconnect; the OAuth page accepts multiple named accounts.'
    };
  }
  if (name === 'list_thingtime_accounts') {
    return { defaultAccountId: context.bundle.defaultConnectionId, accounts: context.bundle.connections.map(publicConnection) };
  }
  if (name === 'select_thingtime_account') {
    const accountId = stringValue(args.accountId);
    if (!accountId || !context.bundle.connections.some((connection) => connection.id === accountId)) return { error: 'Unknown Thingtime account id' };
    context.bundle.defaultConnectionId = accountId;
    const persisted = await persistMcpBundle(context);
    if (persisted.ok === false) return { error: persisted.error, status: persisted.status };
    return { ok: true, defaultAccountId: accountId };
  }
  if (name === 'remove_thingtime_account') {
    const accountId = stringValue(args.accountId);
    const connections = context.bundle.connections.filter((connection) => connection.id !== accountId);
    if (connections.length === context.bundle.connections.length) return { error: 'Unknown Thingtime account id' };
    if (!connections.length) {
      await revokeMcpConnection(context);
      return { ok: true, disconnected: true, message: 'All accounts removed; this ChatGPT connection is now revoked.' };
    }
    context.bundle.connections = connections;
    if (!connections.some((connection) => connection.id === context.bundle.defaultConnectionId)) context.bundle.defaultConnectionId = connections[0].id;
    const persisted = await persistMcpBundle(context);
    if (persisted.ok === false) return { error: persisted.error, status: persisted.status };
    return { ok: true, defaultAccountId: context.bundle.defaultConnectionId, accounts: connections.map(publicConnection) };
  }

  const account = accountFor(context.bundle, args.accountId);
  if (!account) return { error: 'Unknown Thingtime account id' };
  let upstream: Result<unknown>;
  switch (name) {
    case 'get_thingtime_profile':
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/tokens/self');
      break;
    case 'get_thingtime_thing': {
      const id = stringValue(args.id);
      upstream = id
        ? await endpointRequest(account.endpoint, account.token, '/api/v1/things', { query: { id } })
        : { ok: false, status: 400, error: 'id is required' };
      if (upstream.ok === false && upstream.status === 404) upstream = { ok: false, status: 404, error: 'thing_not_found' };
      break;
    }
    case 'get_thingtime_things': {
      const ids = boundedStringList(args.ids, 100);
      if (!ids) return { error: 'ids must be a non-empty list of at most 100 unique Thing IDs', status: 400 };
      const results: Array<{ id: string; found: boolean; thing?: Record<string, unknown>; error?: string }> = [];
      for (const id of ids) {
        const current = await readExactThing(account, id);
        if (current.ok === true) results.push({ id, found: true, thing: current.value });
        else if (current.status === 404) results.push({ id, found: false, error: 'thing_not_found' });
        else return { error: current.error, status: current.status };
      }
      return { account: publicConnection(account), results };
    }
    case 'list_thingtime_comments': {
      const targetId = stringValue(args.targetId);
      upstream = targetId
        ? await endpointRequest(account.endpoint, account.token, '/api/v1/things', {
            query: { target: targetId, thingtime: 'comment', cursor: stringValue(args.cursor), limit: boundedLimit(args.limit) }
          })
        : { ok: false, status: 400, error: 'targetId is required' };
      if (upstream.ok === false && upstream.status === 404) upstream = { ok: false, status: 404, error: 'thing_not_found' };
      break;
    }
    case 'list_thingtime_things':
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things', {
        query: { thingtime: stringValue(args.thingtime), folder: stringValue(args.folder), cursor: stringValue(args.cursor), limit: boundedLimit(args.limit) }
      });
      break;
    case 'search_thingtime_things':
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things/search', {
        query: { q: stringValue(args.query), thingtime: stringValue(args.thingtime), limit: boundedLimit(args.limit) }
      });
      break;
    case 'list_thingtime_schemas': {
      const source = args.source === 'builtin' || args.source === 'published' ? args.source : 'all';
      const result: Record<string, unknown> = { source };
      if (source === 'all' || source === 'builtin') {
        const builtin = await endpointRequest(account.endpoint, account.token, '/api/v1/schemas');
        if (builtin.ok === false) return { error: builtin.error, status: builtin.status };
        const payload = asRecord(builtin.value) || {};
        result.builtin = payload.schemas || [];
        result.collectionVersions = payload.collectionVersions || {};
      }
      if (source === 'all' || source === 'published') {
        const published = await endpointRequest(account.endpoint, account.token, '/api/v1/schemas/browse', {
          query: {
            q: stringValue(args.query),
            sort: stringValue(args.sort),
            cursor: stringValue(args.cursor),
            limit: boundedLimit(args.limit)
          }
        });
        if (published.ok === false) return { error: published.error, status: published.status };
        result.published = published.value;
      }
      return { account: publicConnection(account), result };
    }
    case 'get_thingtime_schema': {
      const schemaId = stringValue(args.id, 128);
      if (!schemaId) return { error: 'id is required', status: 400 };
      const source = args.source === 'builtin' || args.source === 'published' ? args.source : 'auto';
      if (source !== 'published') {
        const builtin = await endpointRequest(account.endpoint, account.token, '/api/v1/schemas', { query: { id: schemaId } });
        if (builtin.ok === true) return { account: publicConnection(account), source: 'builtin', result: builtin.value };
        if (source === 'builtin' || builtin.status !== 404) return { error: builtin.error, status: builtin.status };
      }
      const published = await readExactThing(account, schemaId);
      if (published.ok === false) return { error: published.status === 404 ? 'schema_not_found' : published.error, status: published.status };
      const thingtime = Array.isArray(published.value.thingtime) ? published.value.thingtime : [];
      if (!thingtime.includes('schema')) return { error: 'schema_not_found', status: 404 };
      return { account: publicConnection(account), source: 'published', schema: published.value };
    }
    case 'validate_thingtime_thing': {
      const thing = asRecord(args.thing);
      if (!thing) return { error: 'thing must be an object', status: 400 };
      const builtin = validateThingtimeCrystal(thing.thingtime, thing.crystal);
      if (builtin.ok === false) return { valid: false, issues: [{ path: 'crystal', message: builtin.error }], status: builtin.status };
      const issues: Array<{ path: string; message: string }> = [];
      const crystal = asRecord(thing.crystal) || {};
      if (builtin.thingtime.includes('data') && typeof crystal.schemaId === 'string' && crystal.schemaId.trim()) {
        const schema = await readExactThing(account, crystal.schemaId.trim());
        if (schema.ok === false) return { valid: false, issues: [{ path: 'crystal.schemaId', message: schema.status === 404 ? 'schema_not_found' : schema.error }], status: schema.status };
        const schemaKinds = Array.isArray(schema.value.thingtime) ? schema.value.thingtime : [];
        const schemaCrystal = asRecord(schema.value.crystal) || {};
        if (!schemaKinds.includes('schema') || !Array.isArray(schemaCrystal.fields)) {
          return { valid: false, issues: [{ path: 'crystal.schemaId', message: 'does not reference a published schema Thing' }], status: 400 };
        }
        issues.push(...validateValueAgainstFields(schemaCrystal.fields as any, crystal).issues);
      }
      return {
        account: publicConnection(account),
        valid: !issues.length,
        issues,
        sanitized: { thingtime: builtin.thingtime, crystal: builtin.crystal, requiresTarget: builtin.requiresTarget }
      };
    }
    case 'list_thingtime_related': {
      const targetId = stringValue(args.id, 128);
      const relation = stringValue(args.relation, 32);
      if (!targetId || !relation) return { error: 'id and relation are required', status: 400 };
      const kind = stringValue(args.kind, 64);
      const limit = boundedLimit(args.limit) || 20;
      if (relation === 'children' || relation === 'backlinks') {
        upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things', {
          query: { target: targetId, thingtime: kind, cursor: stringValue(args.cursor), limit }
        });
        break;
      }
      if (relation === 'folder-children') {
        upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things', {
          query: { folder: targetId, thingtime: kind, cursor: stringValue(args.cursor), limit }
        });
        break;
      }
      const focus = await readExactThing(account, targetId);
      if (focus.ok === false) return { error: focus.status === 404 ? 'thing_not_found' : focus.error, status: focus.status };
      const parentId = stringValue(focus.value.targetId, 128) || stringValue(focus.value.folderId, 128);
      if (relation === 'parent') {
        if (!parentId) return { account: publicConnection(account), relation, thing: null };
        const parent = await readExactThing(account, parentId);
        if (parent.ok === false) return { error: parent.status === 404 ? 'thing_not_found' : parent.error, status: parent.status };
        return { account: publicConnection(account), relation, thing: parent.value };
      }
      if (relation !== 'thread') return { error: 'Unknown relationship', status: 400 };
      const depth = Math.min(Math.max(1, Number(args.depth) || 2), 3);
      const ancestors: Record<string, unknown>[] = [];
      let cursorThing = focus.value;
      for (let level = 0; level < depth; level += 1) {
        const nextId = stringValue(cursorThing.targetId, 128);
        if (!nextId) break;
        const parent = await readExactThing(account, nextId);
        if (!parent.ok) break;
        ancestors.unshift(parent.value);
        cursorThing = parent.value;
      }
      const levels: Array<{ parentId: string; things: unknown[] }> = [];
      let frontier = [targetId];
      let remaining = limit;
      for (let level = 0; level < depth && frontier.length && remaining > 0; level += 1) {
        const next: string[] = [];
        for (const parent of frontier) {
          const children = await endpointRequest(account.endpoint, account.token, '/api/v1/things', {
            query: { target: parent, thingtime: kind, limit: Math.min(remaining, 100) }
          });
          if (children.ok === false) return { error: children.error, status: children.status };
          const payload = asRecord(children.value) || {};
          const things = Array.isArray(payload.things) ? payload.things : [];
          levels.push({ parentId: parent, things });
          for (const child of things) {
            const childId = asRecord(child) ? stringValue(child.id, 128) : null;
            if (childId) next.push(childId);
          }
          remaining -= things.length;
          if (remaining <= 0) break;
        }
        frontier = next;
      }
      return { account: publicConnection(account), relation, focus: focus.value, ancestors, levels, truncated: remaining <= 0 };
    }
    case 'list_thingtime_changes': {
      const since = stringValue(args.since, 64);
      if (!since || Number.isNaN(new Date(since).getTime())) return { error: 'since must be a valid ISO timestamp', status: 400 };
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things/search', {
        method: 'POST',
        body: {
          conditions: [{ field: 'updatedAt', op: 'gte', value: since }],
          thingtime: stringValue(args.thingtime),
          sort: 'newest',
          cursor: stringValue(args.cursor),
          limit: boundedLimit(args.limit)
        }
      });
      break;
    }
    case 'preview_thingtime_mutation': {
      const previewed = await previewMutations(account, args.operations);
      if (previewed.ok === false) return { error: previewed.error, status: previewed.status };
      return { account: publicConnection(account), ...previewed.value, confirmationRequired: true };
    }
    case 'apply_thingtime_mutation': {
      if (args.confirmed !== true) return { error: 'confirmed must be true after the user explicitly confirms the reviewed plan', status: 400 };
      const decoded = await previewFromReceipt(args.receipt);
      if (decoded.ok === false) return { error: decoded.error, status: decoded.status };
      if (decoded.value.accountId !== account.id) return { error: 'The preview receipt belongs to a different Thingtime account', status: 409 };
      const runId = stringValue(args.runId, 128);
      const run = runId
        ? (context.bundle.runs || []).find((entry) => entry.id === runId && entry.accountId === account.id)
        : null;
      if (runId && !run) return { error: 'Unknown Thingtime workflow run', status: 404 };
      if (run && run.status !== 'awaiting_confirmation') return { error: `Workflow run is ${run.status}`, status: 409 };
      if (run?.previewId && run.previewId !== decoded.value.previewId) {
        return { error: 'The signed preview does not belong to this workflow run', status: 409 };
      }
      const preflight = await preflightPreview(account, decoded.value);
      if (preflight.ok === false) return { error: preflight.error, status: preflight.status };
      const applied = await applyMutationPreview(account, decoded.value);
      appendHistory(context.bundle, applied.history);
      if (run) {
        upsertWorkflowRun(context.bundle, {
          ...run,
          status: applied.history.status === 'failed' ? 'failed' : 'applied',
          updatedAt: new Date().toISOString(),
          historyId: applied.history.id,
          ...(applied.history.status === 'failed' ? { error: applied.history.results.find((entry) => entry.error)?.error || 'Mutation failed' } : {})
        });
      }
      const persisted = await persistMcpBundle(context);
      if (persisted.ok === false) {
        return {
          error: `The Thingtime mutations ran, but their encrypted MCP history could not be persisted: ${persisted.error}`,
          status: persisted.status,
          mutationApplied: applied.applied > 0,
          history: applied.history
        };
      }
      return {
        account: publicConnection(account),
        history: applied.history,
        applied: applied.applied,
        total: decoded.value.operations.length,
        undoAvailable: Boolean(applied.history.inverseOperations?.length)
      };
    }
    case 'list_thingtime_history': {
      const limit = Math.min(boundedLimit(args.limit) || 20, 50);
      const history = (context.bundle.history || []).filter((entry) => entry.accountId === account.id).slice(-limit).reverse();
      return { account: publicConnection(account), history };
    }
    case 'get_thingtime_history': {
      const historyId = stringValue(args.historyId, 128);
      const history = (context.bundle.history || []).find((entry) => entry.id === historyId && entry.accountId === account.id);
      return history ? { account: publicConnection(account), history } : { error: 'history_not_found', status: 404 };
    }
    case 'undo_thingtime_mutation': {
      const historyId = stringValue(args.historyId, 128);
      const history = (context.bundle.history || []).find((entry) => entry.id === historyId && entry.accountId === account.id);
      if (!history) return { error: 'history_not_found', status: 404 };
      if (!history.inverseOperations?.length) return { error: 'This history entry has no bounded undo plan', status: 409 };
      const previewed = await previewMutations(account, history.inverseOperations, { kind: 'undo', historyId: history.id });
      if (previewed.ok === false) return { error: previewed.error, status: previewed.status };
      return { account: publicConnection(account), undoOf: history.id, ...previewed.value, confirmationRequired: true };
    }
    case 'list_thingtime_capabilities':
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things/search', {
        method: 'POST',
        body: {
          q: stringValue(args.query),
          thingtime: 'data',
          conditions: [
            { field: 'crystal.schema', op: 'eq', value: 'Thingtime Capability' },
            { field: 'crystal.capabilityVersion', op: 'eq', value: 1 }
          ],
          cursor: stringValue(args.cursor),
          limit: boundedLimit(args.limit)
        }
      });
      break;
    case 'get_thingtime_capability_contract':
      return { contract: THINGTIME_CAPABILITY_CONTRACT, resourceUri: THINGTIME_CAPABILITY_CONTRACT_URI };
    case 'start_thingtime_workflow': {
      const capabilityThingId = stringValue(args.capabilityThingId, 128);
      if (!capabilityThingId) return { error: 'capabilityThingId is required', status: 400 };
      const capability = await readExactThing(account, capabilityThingId);
      if (capability.ok === false) return { error: capability.status === 404 ? 'capability_not_found' : capability.error, status: capability.status };
      const compiled = compileThingtimeCapability({ thing: capability.value, inputs: asRecord(args.inputs) || {} });
      if (compiled.ok === false) return { error: compiled.error, status: 400 };
      const previewed = await previewMutations(account, compiled.value.operations);
      if (previewed.ok === false) return { error: previewed.error, status: previewed.status };
      const now = new Date().toISOString();
      const run: ThingtimeMcpWorkflowRun = {
        id: randomBytes(16).toString('hex'),
        accountId: account.id,
        capabilityThingId,
        capabilityName: compiled.value.name,
        createdAt: now,
        updatedAt: now,
        status: 'awaiting_confirmation',
        previewId: previewed.value.preview.previewId,
        summaries: previewed.value.preview.operations.map((entry) => entry.summary)
      };
      upsertWorkflowRun(context.bundle, run);
      const persisted = await persistMcpBundle(context);
      if (persisted.ok === false) return { error: persisted.error, status: persisted.status };
      return { account: publicConnection(account), run, ...previewed.value, confirmationRequired: true };
    }
    case 'get_thingtime_workflow': {
      const runId = stringValue(args.runId, 128);
      const run = (context.bundle.runs || []).find((entry) => entry.id === runId && entry.accountId === account.id);
      return run ? { account: publicConnection(account), run } : { error: 'workflow_not_found', status: 404 };
    }
    case 'cancel_thingtime_workflow': {
      const runId = stringValue(args.runId, 128);
      const run = (context.bundle.runs || []).find((entry) => entry.id === runId && entry.accountId === account.id);
      if (!run) return { error: 'workflow_not_found', status: 404 };
      if (run.status === 'applied') return { error: 'Applied workflow runs are immutable history', status: 409 };
      if (run.status !== 'cancelled') upsertWorkflowRun(context.bundle, { ...run, status: 'cancelled', updatedAt: new Date().toISOString() });
      const persisted = await persistMcpBundle(context);
      if (persisted.ok === false) return { error: persisted.error, status: persisted.status };
      return { account: publicConnection(account), run: (context.bundle.runs || []).find((entry) => entry.id === runId) };
    }
    case 'create_thingtime_thing': {
      const thing = asRecord(args.thing);
      upstream = thing ? await endpointRequest(account.endpoint, account.token, '/api/v1/things', { method: 'POST', body: thing }) : { ok: false, status: 400, error: 'thing must be an object' };
      break;
    }
    case 'update_thingtime_thing': {
      const thing = asRecord(args.thing);
      upstream = thing ? await endpointRequest(account.endpoint, account.token, '/api/v1/things/update', { method: 'POST', body: thing }) : { ok: false, status: 400, error: 'thing must be an object' };
      break;
    }
    case 'delete_thingtime_thing': {
      const id = stringValue(args.id);
      upstream = id ? await endpointRequest(account.endpoint, account.token, '/api/v1/things/delete', { method: 'POST', body: { id } }) : { ok: false, status: 400, error: 'id is required' };
      break;
    }
    case 'comment_on_thingtime_thing': {
      const comment = asRecord(args.comment);
      upstream = comment ? await endpointRequest(account.endpoint, account.token, '/api/v1/things/comment', { method: 'POST', body: comment }) : { ok: false, status: 400, error: 'comment must be an object' };
      break;
    }
    case 'react_to_thingtime_thing': {
      const reaction = asRecord(args.reaction);
      upstream = reaction ? await endpointRequest(account.endpoint, account.token, '/api/v1/things/react', { method: 'POST', body: reaction }) : { ok: false, status: 400, error: 'reaction must be an object' };
      break;
    }
    case 'save_thingtime_thing': {
      const id = stringValue(args.id);
      upstream = id ? await endpointRequest(account.endpoint, account.token, '/api/v1/things/save', { method: 'POST', body: { id } }) : { ok: false, status: 400, error: 'id is required' };
      break;
    }
    case 'share_thingtime_thing': {
      const share = asRecord(args.share);
      upstream = share ? await endpointRequest(account.endpoint, account.token, '/api/v1/things/share', { method: 'POST', body: share }) : { ok: false, status: 400, error: 'share must be an object' };
      break;
    }
    default:
      return { error: 'Unknown Thingtime tool' };
  }
  if (upstream.ok === false) return { error: upstream.error, status: upstream.status };
  return { account: publicConnection(account), result: upstream.value };
};

const jsonRpcResponse = (id: unknown, result?: unknown, error?: { code: number; message: string; data?: unknown }) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  ...(error ? { error } : { result })
});

const authChallenge = (origin: string) =>
  `Bearer resource_metadata="${origin}${CHATGPT_PROTECTED_RESOURCE_METADATA_PATH}", error="invalid_token", error_description="A Thingtime connection is required"`;

const thingtimeResourceTemplates = [
  {
    uriTemplate: 'thingtime://accounts/{accountId}/things/{id}',
    name: 'thingtime-thing',
    title: 'Thingtime Thing',
    description: 'One exact Thing from one connected account.',
    mimeType: 'application/json'
  },
  {
    uriTemplate: 'thingtime://accounts/{accountId}/schemas/{id}',
    name: 'thingtime-schema',
    title: 'Thingtime schema',
    description: 'One built-in or published schema.',
    mimeType: 'application/json'
  },
  {
    uriTemplate: 'thingtime://accounts/{accountId}/history/{id}',
    name: 'thingtime-history',
    title: 'Thingtime MCP history',
    description: 'One mutation receipt stored in the encrypted MCP connection.',
    mimeType: 'application/json'
  },
  {
    uriTemplate: 'thingtime://accounts/{accountId}/workflows/{id}',
    name: 'thingtime-workflow',
    title: 'Thingtime workflow run',
    description: 'One durable Capability workflow run.',
    mimeType: 'application/json'
  }
];

const staticResourceRead = (uri: string): { contents: unknown[] } | null => {
  if (uri === THINGTIME_MCP_UI_RESOURCE_URI) {
    return {
      contents: [{
        uri,
        name: 'Thingtime limitless UI',
        title: 'Thingtime',
        mimeType: 'text/html;profile=mcp-app',
        text: renderThingtimeMcpUi(),
        _meta: {
          ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
          'openai/widgetDescription': 'Review Thingtime results, before/after diffs, and explicitly confirmed signed mutation plans.',
          'openai/widgetPrefersBorder': true,
          'openai/widgetCSP': { connect_domains: [], resource_domains: [] }
        }
      }]
    };
  }
  if (uri === THINGTIME_CAPABILITY_CONTRACT_URI) {
    return {
      contents: [{ uri, name: 'Thingtime Capability contract', mimeType: 'application/json', text: JSON.stringify(THINGTIME_CAPABILITY_CONTRACT, null, 2) }]
    };
  }
  return null;
};

const accountResourceRequest = (uri: string): { accountId: string; family: string; id: string } | null => {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'thingtime:' || parsed.hostname !== 'accounts' || parsed.search || parsed.hash) return null;
    const parts = parsed.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    if (parts.length !== 3 || !['things', 'schemas', 'history', 'workflows'].includes(parts[1])) return null;
    const [accountId, family, id] = parts;
    if (!stringValue(accountId, 128) || !stringValue(id, 128)) return null;
    return { accountId, family, id };
  } catch {
    return null;
  }
};

const readAccountResource = async (uri: string, context: McpSession): Promise<Result<{ contents: unknown[] }>> => {
  const request = accountResourceRequest(uri);
  if (!request) return { ok: false, status: 400, error: 'Invalid Thingtime resource URI' };
  const tool = request.family === 'things'
    ? 'get_thingtime_thing'
    : request.family === 'schemas'
      ? 'get_thingtime_schema'
      : request.family === 'history'
        ? 'get_thingtime_history'
        : 'get_thingtime_workflow';
  const args = {
    accountId: request.accountId,
    ...(request.family === 'things' || request.family === 'schemas' ? { id: request.id } : {}),
    ...(request.family === 'history' ? { historyId: request.id } : {}),
    ...(request.family === 'workflows' ? { runId: request.id } : {})
  };
  const result = await callThingtimeTool(tool, args, context);
  if (result && typeof result === 'object' && 'error' in result) {
    const error = result as { error: string; status?: number };
    return { ok: false, status: error.status || 400, error: error.error };
  }
  return {
    ok: true,
    value: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(result, null, 2) }] }
  };
};

const promptResult = (name: unknown, args: unknown): Result<unknown> => {
  const definition = thingtimePromptDefinitions.find((entry) => entry.name === name);
  if (!definition) return { ok: false, status: 404, error: 'Unknown Thingtime prompt' };
  const values = asRecord(args) || {};
  const supplied = Object.entries(values).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  const instructions = definition.name === 'thingtime_inbox_triage'
    ? 'Review the selected Thingtime account read-only. Group urgent, important, waiting, and someday items. Propose changes but do not mutate anything.'
    : definition.name === 'thingtime_design_schema'
      ? 'Discover existing schemas first. Design the smallest reusable schema Thing, validate an example, then preview creation only if no equivalent exists.'
      : definition.name === 'thingtime_safe_change'
        ? 'Translate the goal into bounded operations, call preview_thingtime_mutation, explain the complete diff, and stop for confirmation before apply.'
        : definition.name === 'thingtime_restore_history'
          ? 'Inspect bounded MCP history, select the exact entry, call undo_thingtime_mutation to produce a fresh preview, and stop for confirmation before apply.'
          : 'Model the workflow as a Thingtime Capability v1 data Thing. Use only create/update/delete operations and exact {$input:"path"} placeholders; validate and preview it.';
  return {
    ok: true,
    value: {
      description: definition.description,
      messages: [{ role: 'user', content: { type: 'text', text: `${instructions}${supplied ? `\n\nInputs:\n${supplied}` : ''}` } }]
    }
  };
};

const mcpAuthorizationDenied = (id: unknown, request: Request, context: Failure) => {
  const challenge = authChallenge(requestOrigin(request));
  const denied = {
    ...mcpToolResult({ error: context.error }, true),
    _meta: { 'mcp/www_authenticate': [challenge] }
  };
  return json(jsonRpcResponse(id, denied), { status: context.status, headers: { 'WWW-Authenticate': challenge, ...noStoreHeaders } });
};

export const handleChatGptMcp = async ({ request }: { request: Request }) => {
  if (request.method.toUpperCase() !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  const body = await limitRequestBody(request, MAX_REQUEST_BYTES);
  if (body.ok === false) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: body.error } }, { status: body.status });
  let message: any;
  try {
    message = JSON.parse(body.value);
  } catch {
    return json(jsonRpcResponse(null, undefined, { code: -32700, message: 'Parse error' }), { status: 400 });
  }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return json(jsonRpcResponse(message?.id, undefined, { code: -32600, message: 'Invalid Request' }), { status: 400 });
  }
  const id = message.id;
  const notification = id === undefined || id === null;
  if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (message.method === 'initialize') {
    return json(jsonRpcResponse(id, {
      protocolVersion: message.params?.protocolVersion || '2025-06-18',
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
        resources: { subscribe: false, listChanged: false }
      },
      serverInfo: { name: 'thingtime', version: CHATGPT_PLUGIN_FEATURES['chatgpt.mcp'] },
      instructions: CHATGPT_MCP_INSTRUCTIONS
    }));
  }
  if (message.method === 'ping') return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, {}));
  const supportedMethods = new Set(['tools/list', 'tools/call', ...Object.keys(CHATGPT_MCP_METHOD_FEATURES)]);
  if (!supportedMethods.has(message.method)) {
    return json(jsonRpcResponse(id, undefined, { code: -32601, message: 'Method not found' }), { status: 404 });
  }

  if (message.method === 'tools/list') {
    return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, { tools: thingtimeToolDefinitions }));
  }
  if (message.method === 'prompts/list') {
    return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, { prompts: thingtimePromptDefinitions }));
  }
  if (message.method === 'prompts/get') {
    const prompt = promptResult(message.params?.name, message.params?.arguments);
    if (prompt.ok === false) {
      return json(jsonRpcResponse(id, undefined, { code: -32602, message: prompt.error }), { status: prompt.status });
    }
    return json(jsonRpcResponse(id, prompt.value));
  }
  if (message.method === 'resources/list') {
    return json(jsonRpcResponse(id, {
      resources: [
        { uri: THINGTIME_MCP_UI_RESOURCE_URI, name: 'thingtime-ui', title: 'Thingtime', description: 'Interactive Thingtime result cards.', mimeType: 'text/html;profile=mcp-app' },
        { uri: THINGTIME_CAPABILITY_CONTRACT_URI, name: 'thingtime-capability-contract', title: 'Thingtime Capability contract', description: 'The versioned bounded workflow grammar.', mimeType: 'application/json' }
      ]
    }));
  }
  if (message.method === 'resources/templates/list') {
    return json(jsonRpcResponse(id, { resourceTemplates: thingtimeResourceTemplates }));
  }
  if (message.method === 'resources/read') {
    const uri = stringValue(message.params?.uri, 2048);
    if (!uri) return json(jsonRpcResponse(id, undefined, { code: -32602, message: 'uri is required' }), { status: 400 });
    const staticResource = staticResourceRead(uri);
    if (staticResource) return json(jsonRpcResponse(id, staticResource));
    const context = await resolveMcpSession(request);
    if (context.ok === false) return mcpAuthorizationDenied(id, request, context);
    const resource = await readAccountResource(uri, context.value);
    if (resource.ok === false) {
      return json(jsonRpcResponse(id, undefined, { code: -32602, message: resource.error }), { status: resource.status });
    }
    return json(jsonRpcResponse(id, resource.value));
  }
  const context = await resolveMcpSession(request);
  if (context.ok === false) return mcpAuthorizationDenied(id, request, context);
  const name = typeof message.params?.name === 'string' ? message.params.name : '';
  const args = asRecord(message.params?.arguments) || {};
  if (!thingtimeToolDefinitions.some((tool) => tool.name === name)) {
    return json(jsonRpcResponse(id, mcpToolResult({ error: 'Unknown Thingtime tool' }, true)));
  }
  const result = await callThingtimeTool(name, args, context.value);
  const isError = Boolean(result && typeof result === 'object' && 'error' in result);
  return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, mcpToolResult(result, isError)));
};

export const chatGptPluginDiscoveryResponse = ({ request }: { request: Request }) => pluginDiscovery(requestOrigin(request));
