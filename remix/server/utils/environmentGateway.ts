import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { apiEndpointDocs } from '../../app/docs/apiDocs';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../../app/api/utils/capabilities/capabilityContract';
import { gatewayAuthority, gatewayOrigin, getGatewaySettings, type GatewaySettings } from '../../app/api/utils/deployment/environmentGateway';

export const GATEWAY_RELAY_HEADER = 'x-thingtime-gateway-relay';
const SIGNATURE_HEADER = 'x-thingtime-gateway-signature';
const MAX_RELAY_AGE_MS = 15_000;
const BOUND_HEADERS = ['authorization', 'cookie', 'origin', 'referer', 'sec-fetch-site', 'content-type', 'x-tt-mongo-url',
  'x-thingtime-expected-actor', 'x-thingtime-expected-data-plane', 'x-thingtime-expected-api-origin', 'x-thingtime-background-id'];
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'accept-encoding'];
const crossSiteMutation = (request: Request) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  return (request.headers.has('cookie') || site !== null) &&
    (site === 'cross-site' || (origin !== null && origin !== new URL(request.url).origin));
};

export const gatewayFailure = (status = 503, code = 'ENVIRONMENT_GATEWAY_UNAVAILABLE') => Response.json({
  ok: false, code, error: 'The selected environment API gateway is unavailable or incompatible.'
}, { status, headers: { 'Cache-Control': 'private, no-store' } });

export const isGatewayDataPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/') ||
  pathname === '/social-card' || pathname === '/sitemap.xml' || apiEndpointDocs.some(doc => doc.endpoint === pathname &&
    pathname !== THINGTIME_CAPABILITY_MANIFEST_PATH);

const digestHeaders = (headers: Headers) => createHash('sha256').update(JSON.stringify(BOUND_HEADERS.map(name => [name, headers.get(name)]))).digest('hex');
const sign = (payload: string, settings: GatewaySettings) => createHmac('sha256', settings.secret).update(payload).digest('base64url');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const permittedSourceOrigins = (settings: GatewaySettings) => {
  const origins = [settings.origin, ...((process.env.THINGTIME_GATEWAY_SOURCE_ORIGINS || '').split(',').filter(Boolean))];
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) if (host) origins.push(`https://${host}`);
  return new Set(origins.map(value => gatewayOrigin(value)));
};

const cleanHeaders = (source: Headers) => {
  const headers = new Headers(source);
  // RFC 9110 Connection can nominate additional hop-by-hop fields.
  for (const name of (headers.get('connection') || '').split(',').map(value => value.trim()).filter(Boolean)) headers.delete(name);
  for (const name of [...headers.keys()]) if (name.startsWith('x-forwarded-') || name.startsWith('x-thingtime-gateway-') || name === 'forwarded') headers.delete(name);
  for (const name of HOP_HEADERS) headers.delete(name);
  return headers;
};

/** Only authenticated relays may restore the original URL. Origin is preserved,
 * never normalized to the gateway (that would turn cross-site writes into trusted ones). */
export const restoreGatewayRequest = (request: Request, settings: GatewaySettings, now = Date.now()): Request | null => {
  const payload = request.headers.get(GATEWAY_RELAY_HEADER);
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!payload || !signature || payload.length > 4096 || !equal(sign(payload, settings), signature)) return null;
  try {
    const relay = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const url = new URL(request.url);
    if (relay.version !== 1 || relay.hop !== 1 || relay.environment !== settings.environment || relay.target !== settings.origin ||
      relay.method !== request.method || relay.path !== url.pathname + url.search || !Number.isFinite(relay.at) ||
      Math.abs(now - relay.at) > MAX_RELAY_AGE_MS || relay.headers !== digestHeaders(request.headers)) return null;
    const origin = gatewayOrigin(relay.origin);
    const original = new URL(origin); original.pathname = url.pathname; original.search = url.search;
    const headers = cleanHeaders(request.headers);
    headers.set('x-forwarded-host', original.host);
    headers.set('x-forwarded-proto', original.protocol.slice(0, -1));
    const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, signal: request.signal };
    if (!['GET', 'HEAD'].includes(request.method) && request.body) { init.body = request.body; init.duplex = 'half'; }
    const restored = new Request(original, init);
    // srvx attaches platform runtime and waitUntil to its lazy ServerRequest.
    // Auth gets a native URL/body while Nitro retains the original transport.
    const transport = request as Request & { runtime?: unknown; context?: unknown; waitUntil?: (work: Promise<unknown>) => void };
    Object.assign(restored, { runtime: transport.runtime, context: transport.context,
      ...(transport.waitUntil ? { waitUntil: transport.waitUntil.bind(request) } : {}) });
    return restored;
  } catch { return null; }
};

const forwardResponse = (request: Request, upstream: Response) => {
  const headers = cleanHeaders(upstream.headers);
  headers.delete('content-encoding');
  headers.delete('set-cookie');
  // Cookies retain their original security attributes. Host-only cookies now
  // belong to the frontend origin. Explicit domains are preserved, not widened.
  for (const cookie of upstream.headers.getSetCookie()) headers.append('set-cookie', cookie);
  headers.set('cache-control', 'private, no-store');
  const body = request.method === 'HEAD' ? null : upstream.body;
  if (request.method === 'HEAD') void upstream.body?.cancel().catch(() => {});
  return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
};

export const proxyEnvironmentRequest = async (request: Request, authority: NonNullable<Awaited<ReturnType<typeof gatewayAuthority.current>>>) => {
  if (request.headers.has(GATEWAY_RELAY_HEADER) || request.headers.has(SIGNATURE_HEADER)) return gatewayFailure(508, 'ENVIRONMENT_GATEWAY_LOOP');
  const { settings, manifest } = authority;
  const url = new URL(request.url);
  if (!permittedSourceOrigins(settings).has(url.origin)) return gatewayFailure(421, 'ENVIRONMENT_GATEWAY_ORIGIN');
  if (crossSiteMutation(request)) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_CROSS_SITE');
  const doc = apiEndpointDocs.find(doc => doc.endpoint === url.pathname || doc.docsEndpoint === url.pathname);
  if (doc) {
    const required = doc.featureVersion || doc.contractVersion;
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    if (!capabilitySatisfies(manifest.features[`api.${doc.id}`]?.version, required) ||
      !manifest.operations.some(operation => operation.feature === `api.${doc.id}` && operation.path === url.pathname && operation.methods.includes(method)))
      return gatewayFailure(409, 'ENVIRONMENT_GATEWAY_CAPABILITY');
  } else {
    // Unknown branch routes must not be silently executed on an older backend.
    return gatewayFailure(409, 'ENVIRONMENT_GATEWAY_CAPABILITY');
  }
  const headers = cleanHeaders(request.headers);
  const payload = Buffer.from(JSON.stringify({ version: 1, hop: 1, environment: settings.environment, target: settings.origin,
    origin: url.origin, path: url.pathname + url.search, method: request.method, at: Date.now(), headers: digestHeaders(headers) })).toString('base64url');
  headers.set(GATEWAY_RELAY_HEADER, payload);
  headers.set(SIGNATURE_HEADER, sign(payload, settings));
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, redirect: 'manual', signal: request.signal, cache: 'no-store' };
  if (!['GET', 'HEAD'].includes(request.method) && request.body) { init.body = request.body; init.duplex = 'half'; }
  try {
    // A target is configured authority, never a request URL or redirect target.
    // TLS protects streamed bodies; no buffering/retry can duplicate a write.
    const target = new URL(settings.origin); target.pathname = url.pathname; target.search = url.search;
    const response = await fetch(target, init);
    return forwardResponse(request, response);
  } catch {
    if (request.signal.aborted) throw new DOMException('Gateway request cancelled.', 'AbortError');
    return gatewayFailure(502);
  }
};

export const environmentGatewayIngress = async (request: Request): Promise<Response | Request | null> => {
  try {
    const settings = getGatewaySettings();
    const relayed = request.headers.has(GATEWAY_RELAY_HEADER) || request.headers.has(SIGNATURE_HEADER);
    if (!settings) return relayed ? gatewayFailure(403, 'ENVIRONMENT_GATEWAY_RELAY') : null;
    const authority = await gatewayAuthority.current();
    if (!authority) return gatewayFailure();
    if (relayed) {
      if (!authority.owner) return gatewayFailure(508, 'ENVIRONMENT_GATEWAY_LOOP');
      const restored = restoreGatewayRequest(request, settings);
      if (restored && crossSiteMutation(restored)) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_CROSS_SITE');
      return restored || gatewayFailure(403, 'ENVIRONMENT_GATEWAY_RELAY');
    }
    if (authority.owner) return null;
    return proxyEnvironmentRequest(request, authority);
  } catch { return gatewayFailure(); }
};
