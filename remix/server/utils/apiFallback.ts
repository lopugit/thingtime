import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../../app/api/utils/capabilities/capabilityContract';

const MONGO_PASSWORD_PLACEHOLDER = '<db_password>';

const normaliseOrigin = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const getApiFallbackOrigin = () => normaliseOrigin(process.env.THINGTIME_API_FALLBACK_ORIGIN);

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

export const hasSelfHostedApiEnv = () => getMissingSelfHostedApiEnv().length === 0;

// Only the installed desktop shell may deliberately bridge to a selected API.
// Incomplete development/preview servers must never become production clients.
export const shouldProxyApiToFallback = (request: Request) => {
  if (hasSelfHostedApiEnv() || process.env.NODE_ENV === 'test') return false;
  if (process.env.THINGTIME_DESKTOP !== '1') return false;
  const requestUrl = new URL(request.url);
  const fallbackOrigin = getApiFallbackOrigin();
  return requestUrl.hostname === '127.0.0.1' && fallbackOrigin !== null && requestUrl.origin !== fallbackOrigin;
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

export const proxyApiRequestToFallback = async (request: Request, options: { stripForwardedOrigin?: boolean } = {}) => {
  const requestUrl = new URL(request.url);
  // Direct callers cannot bypass the dispatcher's policy.
  if (!shouldProxyApiToFallback(request)) return unavailableLocalApiResponse();
  const fallbackUrl = new URL(requestUrl.pathname + requestUrl.search, getApiFallbackOrigin()!);
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
    redirect: 'manual'
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.arrayBuffer();
    if (body.byteLength) {
      init.body = body;
      init.duplex = 'half';
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(fallbackUrl, init);
  } catch (error) {
    // Never surface the caught exception's message (CodeQL
    // js/stack-trace-exposure) — log it server-side and respond with the
    // error class + network code only.
    console.error('[api fallback] proxy fetch failed', error);
    const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
    const causeCode = cause instanceof Error ? (cause as { code?: unknown }).code : undefined;
    const detail =
      error instanceof Error
        ? typeof causeCode === 'string' || typeof causeCode === 'number'
          ? `${error.name} (${causeCode})`
          : error.name
        : 'Unknown error';
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Selected desktop API is unavailable',
        detail
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

  const body = request.method === 'HEAD' ? null : await upstreamResponse.arrayBuffer();
  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
};
