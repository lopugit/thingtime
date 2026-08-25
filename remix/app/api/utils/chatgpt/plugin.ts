import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { json, redirect } from '~/api/http';
import { signJwt, signPurposeToken, verifyJwt, verifyPurposeToken } from '~/api/utils/auth/jwt';
import { createSession, getLiveSession, revokeSession } from '~/api/utils/auth/sessions';
import type { SessionDoc } from '~/api/utils/auth/sessions';
import { getSessionsCollection } from '~/api/utils/mongodb/collections';
import { normalizePkceVerifier, pkceVerifierMatches } from '~/api/utils/apps/desktopOAuthCore';

import {
  CHATGPT_AUTHORIZE_PATH,
  CHATGPT_PROTECTED_RESOURCE_METADATA_PATH,
  CHATGPT_MCP_PATH,
  CHATGPT_MCP_INSTRUCTIONS,
  CHATGPT_PLUGIN_FEATURES,
  allowedThingtimeEndpoints,
  isMcpResourceForOrigin,
  normalizeChatGptOAuthScopes,
  normalizeThingtimeEndpoint,
  parseChatGptAuthorizationRequest,
  parseCredentialBundle,
  pluginDiscovery,
  renderConnectionPage
} from './pluginCore';
import type { ChatGptConnection, ChatGptCredentialBundle, ChatGptOAuthRequest } from './pluginCore';

const OAUTH_REQUEST_PURPOSE = 'chatgpt-oauth-request';
const OAUTH_CODE_PURPOSE = 'chatgpt-oauth-code';
const MCP_SESSION_PURPOSE = 'chatgpt-mcp';
const MCP_REFRESH_SESSION_PURPOSE = 'chatgpt-mcp-refresh';
const MCP_CONNECTION_PURPOSE = 'chatgpt-mcp-connection';
const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const MCP_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MCP_REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 180;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_UPSTREAM_RESPONSE_BYTES = 512 * 1024;

type Failure = { ok: false; status: number; error: string };
type Success<T> = { ok: true; value: T };
type Result<T> = Failure | Success<T>;

const noStoreHeaders = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const requestOrigin = (request: Request) => new URL(request.url).origin;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);

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
  init: { method?: string; query?: Record<string, string | number | undefined>; body?: unknown } = {}
): Promise<Result<unknown>> => {
  const normalizedEndpoint = normalizeThingtimeEndpoint(endpoint);
  if (!normalizedEndpoint) return { ok: false, status: 403, error: 'This Thingtime endpoint is no longer allowed by the gateway' };

  const url = new URL(path, normalizedEndpoint);
  for (const [key, value] of Object.entries(init.query || {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
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
    expiresAt: new Date(Date.now() + MCP_REFRESH_TTL_MS),
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
    expiresAt: new Date(Date.now() + MCP_SESSION_TTL_MS),
    meta: { resource, connectionId: connection.connectionId, connectionSessionJti: connection.sessionJti }
  });
  return {
    accessToken: await signJwt({ sub: userId, jti: session.jti, expiresIn: '30d' }),
    expiresIn: Math.floor(MCP_SESSION_TTL_MS / 1000)
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
    expiresAt: new Date(Date.now() + MCP_REFRESH_TTL_MS),
    meta: { clientId, resource, connectionId: connection.connectionId, connectionSessionJti: connection.sessionJti }
  });
  return signJwt({ sub: userId, jti: session.jti, expiresIn: '180d' });
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
  const parsed = parseChatGptAuthorizationRequest(new URL(request.url).searchParams, requestOrigin(request));
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
      expires_in: access.expiresIn,
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
    expiresAt: { $gt: now },
    'meta.clientId': clientId
  };
  if (resource) refreshFilter['meta.resource'] = resource;
  const consumed = await (await getSessionsCollection()).findOneAndUpdate(
    refreshFilter,
    { $set: { revokedAt: now, 'meta.consumedAt': now } },
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
      expiresAt: { $gt: now },
      'meta.connectionId': connection.connectionId
    },
    { $set: { expiresAt: new Date(Date.now() + MCP_REFRESH_TTL_MS), 'meta.updatedAt': now } }
  );
  if (!extended.matchedCount) return invalidGrant();

  const storedResource = typeof consumed.meta?.resource === 'string' ? consumed.meta.resource : '';
  const access = await createMcpAccessGrant({ userId: claims.sub, resource: storedResource, connection });
  const nextRefreshToken = await createMcpRefreshGrant({ userId: claims.sub, clientId, resource: storedResource, connection });
  return json(
    {
      access_token: access.accessToken,
      token_type: 'Bearer',
      expires_in: access.expiresIn,
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

type McpSession = { session: SessionDoc; bundle: ChatGptCredentialBundle; connection: SessionDoc | null };

const persistMcpBundle = async (context: McpSession): Promise<Result<void>> => {
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
        expiresAt: { $gt: now },
        'meta.connectionId': reference.connectionId
      },
      { $set: { 'meta.ciphertext': encrypted.value, 'meta.updatedAt': now } }
    );
    if (!updated.matchedCount) return { ok: false, status: 401, error: 'ChatGPT connection is no longer active' };
    return { ok: true, value: undefined };
  }

  const updated = await sessions.updateOne(
    { jti: context.session.jti, purpose: MCP_SESSION_PURPOSE, revokedAt: null, expiresAt: { $gt: now } },
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
  await Promise.all([
    sessions.updateOne(
      {
        jti: context.connection.jti,
        userId: context.session.userId,
        purpose: MCP_CONNECTION_PURPOSE,
        revokedAt: null,
        'meta.connectionId': reference.connectionId
      },
      { $set: { revokedAt: now, 'meta.revokedAt': now } }
    ),
    sessions.updateMany(
      {
        userId: context.session.userId,
        purpose: { $in: [MCP_SESSION_PURPOSE, MCP_REFRESH_SESSION_PURPOSE] },
        revokedAt: null,
        'meta.connectionSessionJti': context.connection.jti
      },
      { $set: { revokedAt: now, 'meta.revokedAt': now } }
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

const oauthSecurityScheme = [{ type: 'oauth2', scopes: ['thingtime'] }] as const;
const protectedToolContract = {
  title: 'Thingtime action',
  securitySchemes: oauthSecurityScheme,
  // Some existing MCP clients read the legacy metadata mirror. Keeping it in
  // sync with the standard field makes the OAuth requirement unambiguous.
  _meta: { securitySchemes: oauthSecurityScheme },
  outputSchema: { type: 'object', additionalProperties: true }
} as const;

const protectedTool = <T extends Record<string, unknown>>(tool: T) => ({ ...protectedToolContract, ...tool });

const toolDefinitions = [
  protectedTool({
    name: 'list_thingtime_accounts',
    title: 'List connected Thingtime accounts',
    description: 'List the Thingtime accounts connected to this ChatGPT connection. No token values are returned.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedTool({
    name: 'select_thingtime_account',
    title: 'Select default Thingtime account',
    description: 'Make one connected Thingtime account the default for later tool calls.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['accountId'], properties: { accountId: { type: 'string', description: 'An id returned by list_thingtime_accounts.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }),
  protectedTool({
    name: 'remove_thingtime_account',
    title: 'Disconnect Thingtime account',
    description: 'Disconnect one Thingtime account from ChatGPT. The original Thingtime personal access token remains revocable in Thingtime Settings.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['accountId'], properties: { accountId: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }),
  protectedTool({
    name: 'get_thingtime_profile',
    title: 'Get Thingtime profile',
    description: 'Read the selected connection’s Thingtime token identity and granted scopes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedTool({
    name: 'list_thingtime_things',
    title: 'List Thingtime Things',
    description: 'List Things visible to the selected Thingtime account.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, thingtime: { type: 'string' }, folder: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedTool({
    name: 'search_thingtime_things',
    title: 'Search Thingtime Things',
    description: 'Search Things visible to the selected account by text and optional Thingtime kind.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { accountId: { type: 'string' }, query: { type: 'string' }, thingtime: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }),
  protectedTool({
    name: 'create_thingtime_thing',
    title: 'Create Thingtime Thing',
    description: 'Create a Thing using the selected account. Use only after the user confirms the intended content.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['thing'], properties: { accountId: { type: 'string' }, thing: { type: 'object', description: 'Thingtime /api/v1/things create payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }),
  protectedTool({
    name: 'update_thingtime_thing',
    title: 'Update Thingtime Thing',
    description: 'Update one owned Thing. Use only after the user confirms the change.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['thing'], properties: { accountId: { type: 'string' }, thing: { type: 'object', description: 'Thingtime /api/v1/things/update payload including id.' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }),
  protectedTool({
    name: 'delete_thingtime_thing',
    title: 'Delete Thingtime Thing',
    description: 'Delete one owned Thing. Use only after the user confirms deletion.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { accountId: { type: 'string' }, id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }),
  protectedTool({
    name: 'comment_on_thingtime_thing',
    title: 'Comment on Thingtime Thing',
    description: 'Add a comment to a Thing after the user confirms its text.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['comment'], properties: { accountId: { type: 'string' }, comment: { type: 'object', description: 'Thingtime /api/v1/things/comment payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
  }),
  protectedTool({
    name: 'react_to_thingtime_thing',
    title: 'React to Thingtime Thing',
    description: 'Toggle a reaction on a Thing after the user confirms it.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['reaction'], properties: { accountId: { type: 'string' }, reaction: { type: 'object', description: 'Thingtime /api/v1/things/react payload.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }),
  protectedTool({
    name: 'save_thingtime_thing',
    title: 'Save Thingtime Thing',
    description: 'Toggle a Thing in the selected account’s saved library.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { accountId: { type: 'string' }, id: { type: 'string' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }),
  protectedTool({
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

const callThingtimeTool = async (name: string, args: Record<string, unknown>, context: McpSession): Promise<unknown> => {
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
    case 'list_thingtime_things':
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things', {
        query: { thingtime: stringValue(args.thingtime), folder: stringValue(args.folder), limit: boundedLimit(args.limit) }
      });
      break;
    case 'search_thingtime_things':
      upstream = await endpointRequest(account.endpoint, account.token, '/api/v1/things/search', {
        query: { q: stringValue(args.query), thingtime: stringValue(args.thingtime), limit: boundedLimit(args.limit) }
      });
      break;
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
      capabilities: { tools: {} },
      serverInfo: { name: 'thingtime-chatgpt', version: CHATGPT_PLUGIN_FEATURES['chatgpt.mcp'] },
      instructions: CHATGPT_MCP_INSTRUCTIONS
    }));
  }
  if (message.method === 'ping') return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, {}));
  if (message.method !== 'tools/list' && message.method !== 'tools/call') {
    return json(jsonRpcResponse(id, undefined, { code: -32601, message: 'Method not found' }), { status: 404 });
  }

  if (message.method === 'tools/list') {
    return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, { tools: toolDefinitions }));
  }
  const context = await resolveMcpSession(request);
  if (context.ok === false) {
    const challenge = authChallenge(requestOrigin(request));
    const denied = {
      ...mcpToolResult({ error: context.error }, true),
      _meta: { 'mcp/www_authenticate': [challenge] }
    };
    return json(
      jsonRpcResponse(id, denied),
      { status: context.status, headers: { 'WWW-Authenticate': challenge, ...noStoreHeaders } }
    );
  }
  const name = typeof message.params?.name === 'string' ? message.params.name : '';
  const args = asRecord(message.params?.arguments) || {};
  if (!toolDefinitions.some((tool) => tool.name === name)) {
    return json(jsonRpcResponse(id, mcpToolResult({ error: 'Unknown Thingtime tool' }, true)));
  }
  const result = await callThingtimeTool(name, args, context.value);
  const isError = Boolean(result && typeof result === 'object' && 'error' in result);
  return notification ? new Response(null, { status: 202 }) : json(jsonRpcResponse(id, mcpToolResult(result, isError)));
};

export const chatGptPluginDiscoveryResponse = ({ request }: { request: Request }) => pluginDiscovery(requestOrigin(request));
