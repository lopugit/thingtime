import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../../app/api/utils/capabilities/capabilityContract';
import { agentTestEnvironment } from '../../app/api/utils/agentTesting';

const MONGO_PASSWORD_PLACEHOLDER = '<db_password>';

const normaliseOrigin = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    const explicitLoopback = process.env.THINGTIME_DESKTOP === '1' &&
      process.env.THINGTIME_DESKTOP_API_MODE === 'remote' &&
      url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !explicitLoopback) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const getApiFallbackOrigin = () => {
  if (process.env.THINGTIME_AGENT_TEST_MODE === '1') throw new Error('Isolated tests cannot use an API fallback.');
  return normaliseOrigin(process.env.THINGTIME_API_FALLBACK_ORIGIN);
};

export const getMissingSelfHostedApiEnv = () => {
  const missing: string[] = [];
  const connectionString = process.env.MONGODB_CONNECTION_STRING?.trim();

  if (!connectionString) {
    missing.push('MONGODB_CONNECTION_STRING');
  } else if (connectionString.includes(MONGO_PASSWORD_PLACEHOLDER) && !process.env.MONGO_PASS?.trim()) {
    missing.push('MONGO_PASS');
  }

  if (!process.env.JWT_PRIVATE_KEY?.trim() && !process.env.JWT_SECRET?.trim()) {
    missing.push('JWT_PRIVATE_KEY or JWT_SECRET');
  }

  return missing;
};

// An explicit desktop remote selection must never accidentally activate an
// inherited local database/signing configuration (including startup plugins).
export const hasSelfHostedApiEnv = () =>
  !(process.env.THINGTIME_DESKTOP === '1' && process.env.THINGTIME_DESKTOP_API_MODE === 'remote') &&
  getMissingSelfHostedApiEnv().length === 0;

// Only the installed desktop shell may deliberately bridge to a selected API.
// Incomplete development/preview servers must never become production clients.
export const shouldProxyApiToFallback = (request: Request) => {
  if (agentTestEnvironment()) return false;
  if (hasSelfHostedApiEnv() || process.env.NODE_ENV === 'test') return false;
  if (process.env.THINGTIME_DESKTOP !== '1') return false;
  if (process.env.THINGTIME_DESKTOP_API_MODE && process.env.THINGTIME_DESKTOP_API_MODE !== 'remote') return false;
  const requestUrl = new URL(request.url);
  const fallbackOrigin = getApiFallbackOrigin();
  return requestUrl.hostname === '127.0.0.1' && fallbackOrigin !== null && requestUrl.origin !== fallbackOrigin;
};

/** Negotiate the selected deployment, not the bundled GUI's own manifest,
 * before forwarding any ChatGPT connection action or encrypted handoff. */
export const selectedRuntimeSupportsPlan = async (origin = getApiFallbackOrigin(), signal?: AbortSignal) => {
  if (!origin || origin !== getApiFallbackOrigin() || process.env.THINGTIME_DESKTOP_API_MODE !== 'remote') return false;
  try {
    const response = await fetch(new URL(THINGTIME_CAPABILITY_MANIFEST_PATH, origin), {
      headers: { Accept: 'application/json' }, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000), cache: 'no-store'
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2 * 1024 * 1024) { await reader.cancel(); return false; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return origin === getApiFallbackOrigin() && process.env.THINGTIME_DESKTOP_API_MODE === 'remote' &&
      !signal?.aborted && manifest?.schemaVersion === 1 && manifest.origin === origin &&
      capabilitySatisfies(manifest.features?.['api.ai-chatgpt-plan']?.version ?? '', '1.1.0');
  } catch { return false; }
};

export const unavailableLocalApiResponse = () => Response.json({
  ok: false,
  code: 'LOCAL_API_NOT_CONFIGURED',
  error: 'Configure this server database and authentication before using its API. Automatic remote fallback is disabled.'
}, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' } });

const getSetCookieHeaders = (headers: Headers) => {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') {
    return withGetter.getSetCookie();
  }

  const single = headers.get('set-cookie');
  return single ? [single] : [];
};

const rewriteSetCookieForLocalOrigin = (cookie: string, requestUrl: URL) => {
  const nextParts = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part, index) => {
      if (index === 0) return true;

      const lower = part.toLowerCase();
      if (lower.startsWith('domain=')) return false;
      if (lower === 'secure' && requestUrl.protocol !== 'https:') return false;
      return true;
    });

  return nextParts.join('; ');
};

const cloneProxyRequestHeaders = (request: Request, fallbackUrl: URL) => {
  const headers = new Headers(request.headers);

  for (const header of [
    'accept-encoding',
    'connection',
    'content-length',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
  ]) {
    headers.delete(header);
  }

  headers.set('origin', fallbackUrl.origin);
  headers.set('x-thingtime-api-fallback', fallbackUrl.origin);

  return headers;
};

export const EXPECTED_API_ORIGIN_HEADER = 'X-Thingtime-Expected-Api-Origin';

const endpointChangedResponse = () => Response.json({
  ok: false, code: 'API_ENDPOINT_CHANGED', error: 'The selected API changed. Retry on the current endpoint.'
}, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });

export const proxyApiRequestToFallback = async (request: Request, options: { stripForwardedOrigin?: boolean; expectedOrigin?: string | null } = {}) => {
  if (process.env.THINGTIME_AGENT_TEST_MODE === '1') return Response.json({ ok: false, error: 'Isolated tests cannot use an API fallback.' }, { status: 503 });
  const expectedOrigin = options.expectedOrigin === undefined ? getApiFallbackOrigin() : options.expectedOrigin;
  const requestUrl = new URL(request.url);
  const syncOrigin = request.headers.get(EXPECTED_API_ORIGIN_HEADER);
  if (syncOrigin !== null && syncOrigin !== expectedOrigin) return Response.json({
    ok: false, code: 'API_ORIGIN_CHANGED', error: 'The selected sync server changed.'
  }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
  // Pin authority before any async work. A completed negotiation for a previous
  // endpoint never authorizes sending credentials or a body to its replacement.
  if (expectedOrigin !== getApiFallbackOrigin()) return endpointChangedResponse();
  // Direct callers cannot bypass the dispatcher's policy.
  if (!shouldProxyApiToFallback(request)) return unavailableLocalApiResponse();
  const fallbackUrl = new URL(requestUrl.pathname + requestUrl.search, expectedOrigin!);
  if (options.stripForwardedOrigin) {
    // A bundled client and its selected server can be released independently.
    // Negotiate the actual authority before forwarding credentials or bodies.
    const requirements: Record<string, [string, string]> = {
      '/api/v1/passwords': ['api.passwords', requestUrl.searchParams.has('q') ? '1.2.0' : '1.1.0'],
      '/api/v1/mail': ['api.mail', '1.2.0'],
      '/api/v1/mail/sync': ['api.mail-sync', '1.0.0']
    };
    const required = requirements[requestUrl.pathname];
    if (required) {
      try {
        const response = await fetch(new URL(THINGTIME_CAPABILITY_MANIFEST_PATH, fallbackUrl.origin), {
          headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000)
        });
        const text = response.ok ? await response.text() : '';
        if (text.length > 512 * 1024) throw new Error('Manifest too large');
        const manifest = JSON.parse(text);
        if (manifest.schemaVersion !== 1 || manifest.origin !== fallbackUrl.origin ||
            !capabilitySatisfies(manifest.features?.[required[0]]?.version, required[1])) throw new Error('Incompatible manifest');
      } catch {
        return Response.json({ ok: false, code: 'API_CAPABILITY_INCOMPATIBLE', error: `The selected desktop server must provide ${required[0]} ${required[1]} or a compatible version. Update or reconnect that server.` }, {
          status: 503, headers: { 'Cache-Control': 'private, no-store' }
        });
      }
    }
  }
  const headers = cloneProxyRequestHeaders(request, fallbackUrl);
  if (options.stripForwardedOrigin) {
    headers.delete('x-forwarded-host');
    headers.delete('x-forwarded-proto');
  }
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (request.body) {
      init.body = request.body;
      init.duplex = 'half';
    }
  }

  let upstreamResponse: Response;
  try {
    request.signal.throwIfAborted();
    if (expectedOrigin !== getApiFallbackOrigin() || !shouldProxyApiToFallback(request)) return endpointChangedResponse();
    upstreamResponse = await fetch(fallbackUrl, init);
  } catch {
    if (request.signal.aborted) throw new DOMException('Desktop API request cancelled.', 'AbortError');
    // Fetch errors can contain credential-bearing URLs or provider messages.
    // Keep this boundary static and never log or reflect the caught object.
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Selected desktop API is unavailable'
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'x-thingtime-api-fallback': fallbackUrl.origin
        }
      }
    );
  }

  if (expectedOrigin !== getApiFallbackOrigin() || !shouldProxyApiToFallback(request)) {
    await upstreamResponse.body?.cancel().catch(() => undefined);
    return endpointChangedResponse();
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  const setCookies = getSetCookieHeaders(upstreamResponse.headers);

  for (const header of ['content-encoding', 'content-length', 'set-cookie', 'transfer-encoding']) {
    responseHeaders.delete(header);
  }

  responseHeaders.set('x-thingtime-api-fallback', fallbackUrl.origin);
  responseHeaders.set('x-thingtime-api-fallback-missing-env', getMissingSelfHostedApiEnv().join(', '));

  for (const cookie of setCookies) {
    responseHeaders.append('Set-Cookie', rewriteSetCookieForLocalOrigin(cookie, requestUrl));
  }

  // Return the live stream. Buffering here hid Lopu tool progress until the
  // entire run completed; forwarding the body also propagates reader cancel.
  const body = request.method === 'HEAD' ? null : upstreamResponse.body;
  if (request.method === 'HEAD') await upstreamResponse.body?.cancel().catch(() => undefined);
  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
};
