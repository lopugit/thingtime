const THINGTIME_PRODUCTION_ORIGIN = 'https://thingtime.com';
const MONGO_PASSWORD_PLACEHOLDER = '<db_password>';

const isLoopbackHostname = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '::1';
};

const normaliseOrigin = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return THINGTIME_PRODUCTION_ORIGIN;

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (url.username || url.password) return THINGTIME_PRODUCTION_ORIGIN;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
      return THINGTIME_PRODUCTION_ORIGIN;
    }
    return url.origin;
  } catch {
    return THINGTIME_PRODUCTION_ORIGIN;
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

  if (process.env.NODE_ENV === 'production' && !process.env.JWT_PRIVATE_KEY?.trim() && !process.env.JWT_SECRET?.trim()) {
    missing.push('JWT_PRIVATE_KEY or JWT_SECRET');
  }

  return missing;
};

export const hasSelfHostedApiEnv = () => getMissingSelfHostedApiEnv().length === 0;

export const shouldProxyApiToFallback = (request: Request) => {
  if (hasSelfHostedApiEnv()) return false;

  const requestUrl = new URL(request.url);
  const fallbackUrl = new URL(getApiFallbackOrigin());

  return requestUrl.origin !== fallbackUrl.origin;
};

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

export const proxyApiRequestToFallback = async (request: Request) => {
  const requestUrl = new URL(request.url);
  const fallbackUrl = new URL(requestUrl.pathname + requestUrl.search, getApiFallbackOrigin());
  const headers = cloneProxyRequestHeaders(request, fallbackUrl);
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
        error: 'Thingtime production API fallback failed',
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
