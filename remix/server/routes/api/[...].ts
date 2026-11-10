import { agentTestRefusal } from '../../../app/api/utils/agentTesting';
import { actionDataRoutes } from '../../utils/actionDataRoutes';
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
    if (path === 'v1/mail/google/callback') return jsonResponse({ ok: false, error: 'Google callback requires this configured origin.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    if (path === 'v1/integrations/ios-release') return jsonResponse({ ok: false, error: 'Configure iOS release delivery on this origin.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
    // Vault re-verification stays on its configured origin, including when a
    // browser Action supplies an expected-actor header.
    if (path === 'v1/vault/reveal') {
      return jsonResponse({ ok: false, error: 'Vault verification requires a configured local account environment' }, {
        status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache' }
      });
    }
    // The installed shell uses the selected account API for browser Actions,
    // just like its ordinary account requests. Preserve the actor/data-plane
    // preconditions for the upstream dispatcher to enforce before any handler.
    if (event.req.headers.has('X-Thingtime-Expected-Actor') || path === 'v1/passwords' || path === 'v1/mail' || path === 'v1/mail/sync') {
      // The installed desktop shell deliberately serves its UI on loopback and
      // pins the account API through its endpoint settings. Ordinary websites
      // and incomplete dev deployments must never silently forward vault data.
      const local = new URL(event.req.url);
      const configured = process.env.THINGTIME_API_FALLBACK_ORIGIN || '';
      const desktop = process.env.THINGTIME_DESKTOP === '1' && local.hostname === '127.0.0.1';
      let upstream: URL | null = null;
      try { upstream = new URL(configured); } catch { /* fail closed */ }
      if (!desktop || !upstream || upstream.protocol !== 'https:' || upstream.username || upstream.password)
        return jsonResponse({ ok: false, error: 'Configure private account services on this deployment.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
      if (event.req.headers.get('Sec-Fetch-Site') === 'cross-site' || (method !== 'GET' && event.req.headers.get('Origin') !== local.origin))
        return jsonResponse({ ok: false, error: 'Use the same Thingtime origin.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
      // Nitro's lazy request is not a native Request; preserve its body API.
      return proxyApiRequestToFallback(event.req, { stripForwardedOrigin: true });
    }
    // Root data uses this same fallback. Forward its public database
    // precondition and selection unchanged for the upstream to enforce.
    return proxyApiRequestToFallback(event.req);
  }

	if (path === 'v1/capabilities') {
		const { createApiCapabilitiesManifest } = await import('../../../app/docs/apiDocs');
		const { getDeploymentDataEnvironment } = await import('../../../app/api/utils/deployment/dataEnvironment');
		return jsonResponse(createApiCapabilitiesManifest([...Object.keys(routeModules), 'v1/capabilities'], getDeploymentDataEnvironment()), {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
    });
  }

  if (!hasSelfHostedApiEnv()) return unavailableLocalApiResponse();

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
