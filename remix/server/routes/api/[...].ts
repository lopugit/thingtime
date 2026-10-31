import { defineHandler } from 'nitro/h3';

type RouteModule = {
  loader?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
  action?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
};

const routeModules: Record<string, () => Promise<RouteModule>> = {
  'v1/auth/jwks': () => import('../../../app/routes/api/v1/auth/jwks/_jwks'),
  'v1/auth/logout': () => import('../../../app/routes/api/v1/auth/logout/_logout'),
  'v1/auth/me': () => import('../../../app/routes/api/v1/auth/me/_me'),
  'v1/auth/register': () => import('../../../app/routes/api/v1/auth/register/_register'),
  'v1/auth/resend-verification': () => import('../../../app/routes/api/v1/auth/resend-verification/_resend-verification'),
  'v1/auth/service-account': () => import('../../../app/routes/api/v1/auth/service-account/_service-account'),
  'v1/auth/verify-email': () => import('../../../app/routes/api/v1/auth/verify-email/_verify-email'),
  'v1/crypto': () => import('../../../app/routes/api/v1/crypto/_crypto'),
  'v1/email/config': () => import('../../../app/routes/api/v1/email/config/_config'),
  'v1/email/test-otp': () => import('../../../app/routes/api/v1/email/test-otp/_test-otp'),
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
  'v1/notifications': () => import('../../../app/routes/api/v1/notifications/_notifications'),
  'v1/notifications/email/unsubscribe': () =>
    import('../../../app/routes/api/v1/notifications/email/unsubscribe/_unsubscribe'),
  'v1/notifications/email/weekly-summary': () =>
    import('../../../app/routes/api/v1/notifications/email/weekly-summary/_weekly-summary'),
  'v1/notifications/read': () => import('../../../app/routes/api/v1/notifications/read/_read'),
  'v1/notifications/settings': () => import('../../../app/routes/api/v1/notifications/settings/_settings'),
  'v1/oauth/authorize': () => import('../../../app/routes/api/v1/oauth/authorize/_authorize'),
  'v1/oauth/desktop/authorize': () => import('../../../app/routes/api/v1/oauth/desktop/authorize/_authorize'),
  'v1/oauth/grants': () => import('../../../app/routes/api/v1/oauth/grants/_grants'),
  'v1/oauth/grants/revoke': () => import('../../../app/routes/api/v1/oauth/grants/revoke/_revoke'),
  'v1/oauth/sandbox': () => import('../../../app/routes/api/v1/oauth/sandbox/_sandbox'),
  'v1/oauth/scopes': () => import('../../../app/routes/api/v1/oauth/scopes/_scopes'),
  'v1/oauth/shared': () => import('../../../app/routes/api/v1/oauth/shared/_shared'),
  'v1/oauth/token': () => import('../../../app/routes/api/v1/oauth/token/_token'),
  'v1/oauth/userinfo': () => import('../../../app/routes/api/v1/oauth/userinfo/_userinfo'),
  'v1/schemas': () => import('../../../app/routes/api/v1/schemas/_schemas'),
  'v1/schemas/browse': () => import('../../../app/routes/api/v1/schemas/browse/_browse'),
  'v1/settings/pr-conflict-auto-resolver-model-waterfall': () =>
		import('../../../app/routes/api/v1/settings/pr-conflict-auto-resolver-model-waterfall/_pr-conflict-auto-resolver-model-waterfall'),
  'v1/teapot': () => import('../../../app/routes/api/v1/teapot/_teapot'),
  'v1/template': () => import('../../../app/routes/api/v1/template/_template'),
  'v1/vercel/deployments': () => import('../../../app/routes/api/v1/vercel/deployments/_deployments'),
  'v1/vercel/status': () => import('../../../app/routes/api/v1/vercel/status/_status'),
  'v1/vercel/status-data': () => import('../../../app/routes/api/v1/vercel/status-data/_status-data')
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
