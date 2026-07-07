import { defineHandler } from 'nitro/h3';

type RouteModule = {
  loader?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
  action?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
};

const routeModules: Record<string, () => Promise<RouteModule>> = {
  'v1/algorithms': () => import('../../../app/routes/api/v1/algorithms/_algorithms'),
  'v1/algorithms/active': () => import('../../../app/routes/api/v1/algorithms/active/_active'),
  'v1/algorithms/delete': () => import('../../../app/routes/api/v1/algorithms/delete/_delete'),
  'v1/algorithms/track': () => import('../../../app/routes/api/v1/algorithms/track/_track'),
  'v1/algorithms/update': () => import('../../../app/routes/api/v1/algorithms/update/_update'),
  'v1/auth/jwks': () => import('../../../app/routes/api/v1/auth/jwks/_jwks'),
  'v1/auth/logout': () => import('../../../app/routes/api/v1/auth/logout/_logout'),
  'v1/auth/me': () => import('../../../app/routes/api/v1/auth/me/_me'),
  'v1/auth/register': () => import('../../../app/routes/api/v1/auth/register/_register'),
  'v1/auth/resend-verification': () => import('../../../app/routes/api/v1/auth/resend-verification/_resend-verification'),
  'v1/auth/service-account': () => import('../../../app/routes/api/v1/auth/service-account/_service-account'),
  'v1/auth/verify-email': () => import('../../../app/routes/api/v1/auth/verify-email/_verify-email'),
  'v1/crypto': () => import('../../../app/routes/api/v1/crypto/_crypto'),
  'v1/health/frontend': () => import('../../../app/routes/api/v1/health/frontend/_frontend'),
  'v1/health/mongodb': () => import('../../../app/routes/api/v1/health/mongodb/_mongodb'),
  'v1/health/nitro': () => import('../../../app/routes/api/v1/health/nitro/_nitro'),
  'v1/health/vercel': () => import('../../../app/routes/api/v1/health/vercel/_vercel'),
  'v1/login': () => import('../../../app/routes/api/v1/login/_login'),
  'v1/lopu/musing': () => import('../../../app/routes/api/v1/lopu/musing/_musing'),
  'v1/mongodb/get-connection': () => import('../../../app/routes/api/v1/mongodb/get-connection/_get-connection'),
  'v1/mongodb/populate': () => import('../../../app/routes/api/v1/mongodb/populate/_populate'),
  'v1/mongodb/raw-results': () => import('../../../app/routes/api/v1/mongodb/raw-results/_raw-results'),
  'v1/mongodb/status': () => import('../../../app/routes/api/v1/mongodb/status/_status'),
  'v1/mongodb/status-data': () => import('../../../app/routes/api/v1/mongodb/status-data/_status-data'),
  'v1/template': () => import('../../../app/routes/api/v1/template/_template'),
  'v1/themes': () => import('../../../app/routes/api/v1/themes/_themes'),
  'v1/themes/active': () => import('../../../app/routes/api/v1/themes/active/_active'),
  'v1/themes/delete': () => import('../../../app/routes/api/v1/themes/delete/_delete'),
  'v1/themes/shared': () => import('../../../app/routes/api/v1/themes/shared/_shared'),
  'v1/things': () => import('../../../app/routes/api/v1/things/_things'),
  'v1/things/comment': () => import('../../../app/routes/api/v1/things/comment/_comment'),
  'v1/things/delete': () => import('../../../app/routes/api/v1/things/delete/_delete'),
  'v1/things/feed': () => import('../../../app/routes/api/v1/things/feed/_feed'),
  'v1/things/react': () => import('../../../app/routes/api/v1/things/react/_react'),
  'v1/things/share': () => import('../../../app/routes/api/v1/things/share/_share'),
  'v1/things/user': () => import('../../../app/routes/api/v1/things/user/_user'),
  'v1/users/profile': () => import('../../../app/routes/api/v1/users/profile/_profile'),
  'v1/vercel/deployments': () => import('../../../app/routes/api/v1/vercel/deployments/_deployments'),
  'v1/vercel/status': () => import('../../../app/routes/api/v1/vercel/status/_status'),
  'v1/vercel/status-data': () => import('../../../app/routes/api/v1/vercel/status-data/_status-data'),
  'v1/waitlist': () => import('../../../app/routes/api/v1/waitlist/_waitlist')
};

const normalizePath = (value: unknown, url?: string) => {
  if (Array.isArray(value) && value.length) return value.join('/');

  const fromParams = String(value || '').replace(/^\/+|\/+$/g, '');
  if (fromParams) return fromParams;

  const pathname = new URL(url || '/', 'http://localhost').pathname;
  return pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');
};

const normalizeResponse = (value: unknown) => {
  if (value instanceof Response) {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'body' in value &&
    ('status' in value || 'headers' in value)
  ) {
    const legacy = value as {
      status?: number;
      headers?: HeadersInit;
      body?: unknown;
    };

    return new Response(JSON.stringify(legacy.body ?? null), {
      status: legacy.status || 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(legacy.headers as Record<string, string> | undefined)
      }
    });
  }

  return new Response(JSON.stringify(value ?? null), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
};

export default defineHandler(async (event) => {
  const path = normalizePath(event.context.params?.path, event.req.url);
  const loadModule = routeModules[path];

  if (!loadModule) {
    return new Response('Not found', { status: 404 });
  }

  const route = await loadModule();
  const method = event.req.method.toUpperCase();
  const handler = method === 'GET' || method === 'HEAD' ? route.loader : route.action;

  if (!handler) {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        Allow: [
          route.loader ? 'GET' : undefined,
          route.action ? 'POST' : undefined
        ].filter(Boolean).join(', ')
      }
    });
  }

  try {
    return normalizeResponse(await handler({ request: event.req }));
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }

    throw err;
  }
});
