import { defineHandler } from 'nitro/h3';

import { getRequestMongoEndpoint, runWithMongoEndpoint } from '../../../app/api/utils/mongodb/endpoint';
import { proxyApiRequestToFallback, shouldProxyApiToFallback } from '../../utils/apiFallback';

type RouteModule = {
  loader?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
  action?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
};

const routeModules: Record<string, () => Promise<RouteModule>> = {
  'v1/admin/migrations': () => import('../../../app/routes/api/v1/admin/migrations/_migrations'),
  'v1/admin/migrations/run': () => import('../../../app/routes/api/v1/admin/migrations/run/_run'),
  'v1/admin/rate-limits': () => import('../../../app/routes/api/v1/admin/rate-limits/_rate-limits'),
  'v1/admin/set-admin': () => import('../../../app/routes/api/v1/admin/set-admin/_set-admin'),
  'v1/admin/users': () => import('../../../app/routes/api/v1/admin/users/_users'),
  'v1/algorithms': () => import('../../../app/routes/api/v1/algorithms/_algorithms'),
  'v1/algorithms/active': () => import('../../../app/routes/api/v1/algorithms/active/_active'),
  'v1/algorithms/delete': () => import('../../../app/routes/api/v1/algorithms/delete/_delete'),
  'v1/algorithms/track': () => import('../../../app/routes/api/v1/algorithms/track/_track'),
  'v1/algorithms/update': () => import('../../../app/routes/api/v1/algorithms/update/_update'),
  'v1/app-data': () => import('../../../app/routes/api/v1/app-data/_app-data'),
  'v1/app-data/delete': () => import('../../../app/routes/api/v1/app-data/delete/_delete'),
  'v1/app-data/shared': () => import('../../../app/routes/api/v1/app-data/shared/_shared'),
  'v1/apps': () => import('../../../app/routes/api/v1/apps/_apps'),
  'v1/apps/delete': () => import('../../../app/routes/api/v1/apps/delete/_delete'),
  'v1/apps/public': () => import('../../../app/routes/api/v1/apps/public/_public'),
  'v1/apps/update': () => import('../../../app/routes/api/v1/apps/update/_update'),
  'v1/auth/accounts': () => import('../../../app/routes/api/v1/auth/accounts/_accounts'),
  'v1/auth/accounts/remove': () => import('../../../app/routes/api/v1/auth/accounts/remove/_remove'),
  'v1/auth/accounts/switch': () => import('../../../app/routes/api/v1/auth/accounts/switch/_switch'),
  'v1/auth/jwks': () => import('../../../app/routes/api/v1/auth/jwks/_jwks'),
  'v1/auth/logout': () => import('../../../app/routes/api/v1/auth/logout/_logout'),
  'v1/auth/me': () => import('../../../app/routes/api/v1/auth/me/_me'),
  'v1/auth/password-reset': () => import('../../../app/routes/api/v1/auth/password-reset/_password-reset'),
  'v1/auth/password-reset/confirm': () => import('../../../app/routes/api/v1/auth/password-reset/confirm/_confirm'),
  'v1/auth/register': () => import('../../../app/routes/api/v1/auth/register/_register'),
  'v1/auth/resend-verification': () => import('../../../app/routes/api/v1/auth/resend-verification/_resend-verification'),
  'v1/auth/service-account': () => import('../../../app/routes/api/v1/auth/service-account/_service-account'),
  'v1/auth/two-factor': () => import('../../../app/routes/api/v1/auth/two-factor/_two-factor'),
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
  'v1/mongodb/endpoint': () => import('../../../app/routes/api/v1/mongodb/endpoint/_endpoint'),
  'v1/mongodb/endpoints': () => import('../../../app/routes/api/v1/mongodb/endpoints/_endpoints'),
  'v1/mongodb/get-connection': () => import('../../../app/routes/api/v1/mongodb/get-connection/_get-connection'),
  'v1/mongodb/populate': () => import('../../../app/routes/api/v1/mongodb/populate/_populate'),
  'v1/mongodb/raw-results': () => import('../../../app/routes/api/v1/mongodb/raw-results/_raw-results'),
  'v1/mongodb/status': () => import('../../../app/routes/api/v1/mongodb/status/_status'),
  'v1/mongodb/status-data': () => import('../../../app/routes/api/v1/mongodb/status-data/_status-data'),
  'v1/oauth/authorize': () => import('../../../app/routes/api/v1/oauth/authorize/_authorize'),
  'v1/oauth/grants': () => import('../../../app/routes/api/v1/oauth/grants/_grants'),
  'v1/oauth/grants/revoke': () => import('../../../app/routes/api/v1/oauth/grants/revoke/_revoke'),
  'v1/oauth/sandbox': () => import('../../../app/routes/api/v1/oauth/sandbox/_sandbox'),
  'v1/oauth/scopes': () => import('../../../app/routes/api/v1/oauth/scopes/_scopes'),
  'v1/oauth/shared': () => import('../../../app/routes/api/v1/oauth/shared/_shared'),
  'v1/oauth/userinfo': () => import('../../../app/routes/api/v1/oauth/userinfo/_userinfo'),
  'v1/schemas': () => import('../../../app/routes/api/v1/schemas/_schemas'),
  'v1/schemas/browse': () => import('../../../app/routes/api/v1/schemas/browse/_browse'),
  'v1/settings/pr-conflict-auto-resolver-model-waterfall': () =>
    import(
      '../../../app/routes/api/v1/settings/pr-conflict-auto-resolver-model-waterfall/_pr-conflict-auto-resolver-model-waterfall'
    ),
  'v1/teapot': () => import('../../../app/routes/api/v1/teapot/_teapot'),
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
  'v1/things/reactions-recent': () => import('../../../app/routes/api/v1/things/reactions-recent/_reactions-recent'),
  'v1/things/quota': () => import('../../../app/routes/api/v1/things/quota/_quota'),
  'v1/things/save': () => import('../../../app/routes/api/v1/things/save/_save'),
  'v1/things/search': () => import('../../../app/routes/api/v1/things/search/_search'),
  'v1/things/share': () => import('../../../app/routes/api/v1/things/share/_share'),
  'v1/things/update': () => import('../../../app/routes/api/v1/things/update/_update'),
  'v1/things/user': () => import('../../../app/routes/api/v1/things/user/_user'),
  'v1/users/profile': () => import('../../../app/routes/api/v1/users/profile/_profile'),
  'v1/users/search': () => import('../../../app/routes/api/v1/users/search/_search'),
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

const jsonResponse = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(value), {
    ...init,
    headers
  });
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

  return jsonResponse(value ?? null);
};

export default defineHandler(async (event) => {
  const path = normalizePath(event.context.params?.path, event.req.url);
  const method = event.req.method.toUpperCase();

  if (path.endsWith('-docs')) {
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, POST' }
      });
    }

    // 🔮 the teapot's -docs twin is real but unlisted (claude-todo/10):
    // it never appears in /docs/api, yet the self-describing convention holds
    if (path === 'v1/teapot-docs') {
      return jsonResponse({
        ok: true,
        endpoint: '/api/v1/teapot',
        methods: ['GET', 'POST'],
        summary: 'Politely declines to brew coffee.',
        detail:
          'RFC 2324 lives here. Every documented endpoint serves JSON docs at -docs — including the ones you were never told about. Congratulations on your curiosity. 🫖',
        responses: [{ status: 418, description: 'Short and stout, with a brew-time haiku.' }]
      });
    }

    // lazy: apiDocs is ~150KB of doc-string literals — parsing it belongs to
    // the rare -docs request, not to every instance's cold start
    const { createApiDocPayload, getApiDocByPath } = await import('../../../app/docs/apiDocs');
    const doc = getApiDocByPath(path);
    if (!doc) {
      return jsonResponse({ ok: false, error: 'API docs not found' }, { status: 404 });
    }

    return jsonResponse(createApiDocPayload(doc, new URL(event.req.url).origin));
  }

  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

  const loadModule = routeModules[path];

  if (!loadModule) {
    // 🔮 even the 404 speaks Lopu (claude-todo/10) — same {ok, error} envelope
    // as every other API response instead of a bare text body
    return jsonResponse({ ok: false, error: 'Lopu looked everywhere and found no such endpoint 🤷‍♂️' }, { status: 404 });
  }

  const route = await loadModule();
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

  // Establish the request's MongoDB endpoint context (the `tt_mongo` session
  // cookie / `x-tt-mongo-url` header — see api/utils/mongodb/endpoint.ts) so
  // the data plane below the handler resolves the session's active endpoint.
  // Admin routes are exempt: migrations and other admin writes must always
  // operate on the home deployment, never on an override DB.
  const mongoEndpoint = path.startsWith('v1/admin/') ? null : await getRequestMongoEndpoint(event.req);

  try {
    return await runWithMongoEndpoint(mongoEndpoint, async () =>
      normalizeResponse(await handler({ request: event.req }))
    );
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }

    throw err;
  }
});
