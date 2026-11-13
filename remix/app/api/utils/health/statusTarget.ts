import { PublicError, safeErrorText } from '../errors/safeError';

export type BasicServiceHealthStatus = {
  ok: boolean;
  service: 'frontend' | 'nitro';
  state: 'ready' | 'degraded' | 'unavailable' | 'unknown';
  label: string;
  checkedAt: string;
  origin: string;
  targetOrigin?: string;
  responseMs?: number;
  statusCode?: number;
  error?: string;
  bytes?: number;
  shellDetected?: boolean;
  runtime?: string;
  nodeEnv?: string;
  storageAccounting?: {
    state: 'ready' | 'recovering' | 'migration-required' | 'unavailable';
    expectedVersion: number;
    migrationId: string;
  };
};

const REQUEST_TIMEOUT_MS = 3500;
export class ProtectedStatusTargetError extends PublicError {
  constructor() { super('Branch deployment status requires authentication'); }
}
// Canonical local dev ports plus any worktree-derived overrides (set by
// remix/scripts/worktree-ports.cjs via dev.mjs / PM2 env).
const LOCAL_STATUS_PORTS = new Set(
  ['9999', '10000', process.env.TT_WEB_PORT, process.env.TT_API_PORT].filter(
    (port): port is string => Boolean(port)
  )
);

export const normaliseOrigin = (value?: string | null) => {
  const raw = value?.trim();

  if (!raw) {
    return undefined;
  }

  try {
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw);
    const withProtocol = /^https?:\/\//i.test(raw)
      ? raw
      : localHost
        ? `http://${raw}`
        : `https://${raw}`;
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return undefined;
  }
};

export const getRequestOrigin = (request: Request) => {
  const requestUrl = new URL(request.url, 'http://localhost');
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || requestUrl.host;
  const protocol = forwardedProto || requestUrl.protocol.replace(/:$/, '') || 'http';

  return normaliseOrigin(`${protocol}://${host}`) || requestUrl.origin;
};

const configuredOrigins = () => {
  return [
    process.env.THINGTIME_PRODUCTION_STATUS_ORIGIN,
    process.env.THINGTIME_PROD_STATUS_ORIGIN,
    process.env.THINGTIME_DEVELOPMENT_STATUS_ORIGIN,
    process.env.THINGTIME_DEV_STATUS_ORIGIN,
    process.env.THINGTIME_STAGING_STATUS_ORIGIN,
    process.env.THINGTIME_STAGE_STATUS_ORIGIN,
    process.env.THINGTIME_LOCAL_STATUS_ORIGIN,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
    'https://thingtime.com',
    'https://dev.thingtime.com',
    'https://staging.thingtime.com',
    'http://localhost:9999',
    'http://localhost:10000',
    'http://127.0.0.1:9999',
    'http://127.0.0.1:10000'
  ].map(normaliseOrigin).filter(Boolean) as string[];
};

const isAllowedStatusOrigin = (origin: string, requestOrigin: string) => {
  if (origin === requestOrigin || configuredOrigins().includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    if (host === 'thingtime.com' || host.endsWith('.thingtime.com')) {
      return url.protocol === 'https:';
    }

    if (host.endsWith('.vercel.app')) {
      return url.protocol === 'https:';
    }

    if ((host === 'localhost' || host === '127.0.0.1') && LOCAL_STATUS_PORTS.has(url.port)) {
      return url.protocol === 'http:';
    }
  } catch {
    return false;
  }

  return false;
};

export const resolveStatusTarget = (request: Request) => {
  const requestOrigin = getRequestOrigin(request);
  const requestUrl = new URL(request.url, requestOrigin);
  const requestedOrigin = normaliseOrigin(requestUrl.searchParams.get('targetOrigin'));
  const targetOrigin = requestedOrigin || requestOrigin;

  if (!isAllowedStatusOrigin(targetOrigin, requestOrigin)) {
    throw new Response('Status target is not allowed', { status: 400 });
  }

  return {
    isRemote: targetOrigin !== requestOrigin,
    requestOrigin,
    targetOrigin
  };
};

// Only platform supplied URLs can be identified as this project's protected
// generated deployments. A caller supplied *.vercel.app target is not trusted.
export const isPlatformGeneratedStatusOrigin = (origin: string) => {
  const url = new URL(origin);
  return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app') &&
    [process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL]
      .map(normaliseOrigin).some(configured => configured === origin);
};

export const fetchWithTimeout = async <T = undefined>(url: string, init: RequestInit = {}, deadlineAt = Date.now() + REQUEST_TIMEOUT_MS,
  consume?: (response: Response) => Promise<T>) => {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new DOMException('Remote status deadline exceeded', 'TimeoutError');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Remote status deadline exceeded', 'TimeoutError')), remaining);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal
    });

    if ((response.status === 401 || response.status === 403) && isPlatformGeneratedStatusOrigin(new URL(url).origin)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProtectedStatusTargetError();
    }

    // Keep the one deadline active through response consumption. Headers may
    // arrive promptly while a body stalls indefinitely.
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    let body: T | undefined;
    try {
      body = consume ? await Promise.race([consume(response), interrupted]) : undefined;
    } finally {
      if (abort) controller.signal.removeEventListener('abort', abort);
    }
    return {
      response,
      responseMs: Date.now() - startedAt,
      body
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchRemoteJson = async <T,>(
  targetOrigin: string,
  path: string,
  fallbackPath?: string
) => {
  const deadlineAt = Date.now() + REQUEST_TIMEOUT_MS;
  const fetchJson = async (pathname: string) => {
    const { responseMs, body } = await fetchWithTimeout<T>(`${targetOrigin}${pathname}`, {
      headers: {
        Accept: 'application/json'
      }
    }, deadlineAt, async response => {
      if (!response.ok) throw new PublicError(`Remote status returned ${response.status}`);
      return response.json() as Promise<T>;
    });

    return {
      data: body as T,
      responseMs
    };
  };

  try {
    return await fetchJson(path);
  } catch (err) {
    if (!fallbackPath || err instanceof ProtectedStatusTargetError) {
      throw err;
    }

    return fetchJson(fallbackPath);
  }
};

export const unavailableServiceStatus = (
  service: BasicServiceHealthStatus['service'],
  origin: string,
  error: unknown
): BasicServiceHealthStatus => {
  const serviceLabel = service === 'nitro' ? 'Nitro API' : 'Frontend';

  return {
    ok: false,
    service,
    state: 'unavailable',
    label: `${serviceLabel}: ${error instanceof ProtectedStatusTargetError ? 'authentication required' : 'unavailable'}`,
    checkedAt: new Date().toISOString(),
    origin,
    targetOrigin: origin,
    error: safeErrorText(error, `service health: ${service}`, 'Service unavailable')
  };
};
