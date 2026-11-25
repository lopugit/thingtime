import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { pilotBuild, type PilotBuild } from '../../app/api/utils/deployment/pilotBuild';
import { isDeploymentProfileId } from '../../app/api/utils/ciControl/deploymentProfilesCore';
import { authenticatePilot, enrolledPilotOrigin, isPilotGateway, isPilotLaneGateway, PILOT_GATEWAY, PILOT_LANE_HEADER, PILOT_PR_HEADER, PILOT_OIDC_HEADER, PILOT_PROFILE_HEADER, PILOT_VERSION, TRUSTED_SOURCE_HEADER } from './deploymentPilot';
import { CONNECTION_ICON_PATH } from '../../app/connections/providerIcons';
import { CREDENTIAL_IMPORT_API_PATH, CREDENTIAL_IMPORT_HEADERS } from '../../app/credentials/importContract';
import { apiEndpointDocs } from '../../app/docs/apiDocs';
import { ROBOTS_PATH } from '../../app/api/utils/seo/sitemapCore';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../../app/api/utils/capabilities/capabilityContract';
import { gatewayAuthority, readGatewayManifest, gatewayOrigin, getGatewaySettings, getMongoConnectionMode, withGatewayWork, gatewayProtectionHeaders, VERCEL_PROTECTION_BYPASS_HEADER, type GatewaySettings } from '../../app/api/utils/deployment/environmentGateway';

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

// Crawler policy belongs to this deployment, contains no account data, and must
// remain available when an older or unavailable gateway cannot serve its APIs.
export const isGatewayDataPath = (pathname: string) => pathname !== CONNECTION_ICON_PATH && pathname !== ROBOTS_PATH && (
  pathname === '/api' || pathname.startsWith('/api/') || pathname === '/social-card' || pathname === '/sitemap.xml' ||
  apiEndpointDocs.some(doc => doc.endpoint === pathname && pathname !== THINGTIME_CAPABILITY_MANIFEST_PATH)
);

const digestHeaders = (headers: Headers, pathname: string) => {
  // Keep compatibility with older gateways for all existing route families.
  const names = pathname.startsWith(`${CREDENTIAL_IMPORT_API_PATH}/`)
    ? [...BOUND_HEADERS, CREDENTIAL_IMPORT_HEADERS.request, CREDENTIAL_IMPORT_HEADERS.verifier, CREDENTIAL_IMPORT_HEADERS.target]
    : BOUND_HEADERS;
  return createHash('sha256').update(JSON.stringify(names.map(name => [name, headers.get(name)]))).digest('hex');
};
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
  for (const name of [...headers.keys()]) if (name.startsWith('x-forwarded-') || name.startsWith('x-thingtime-gateway-') || name === 'forwarded' || name === VERCEL_PROTECTION_BYPASS_HEADER || name === 'x-vercel-set-bypass-cookie' || name === 'x-vercel-oidc-token' || name === TRUSTED_SOURCE_HEADER) headers.delete(name);
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
      Math.abs(now - relay.at) > MAX_RELAY_AGE_MS || relay.headers !== digestHeaders(request.headers, url.pathname)) return null;
    const origin = gatewayOrigin(relay.origin);
    return restoreOriginalOrigin(request, origin);
  } catch { return null; }
};

function restoreOriginalOrigin(request: Request, origin: string) {
  const url = new URL(request.url);
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
}

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

function supportsOperation(request: Request, manifest: Awaited<ReturnType<typeof readGatewayManifest>>) {
  const url = new URL(request.url);
  const doc = apiEndpointDocs.find(doc => doc.endpoint === url.pathname || doc.docsEndpoint === url.pathname);
  if (!doc) return false;
  const feature = `api.${doc.id}`;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  return capabilitySatisfies(manifest.features[feature]?.version, doc.featureVersion || doc.contractVersion) &&
    manifest.operations.some(operation => operation.feature === feature && operation.path === url.pathname && operation.methods.includes(method));
}

export const proxyEnvironmentRequest = async (request: Request, authority: NonNullable<Awaited<ReturnType<typeof gatewayAuthority.current>>>) => {
  if (request.headers.has(GATEWAY_RELAY_HEADER) || request.headers.has(SIGNATURE_HEADER)) return gatewayFailure(508, 'ENVIRONMENT_GATEWAY_LOOP');
  const { settings, manifest } = authority;
  const url = new URL(request.url);
  if (!permittedSourceOrigins(settings).has(url.origin)) return gatewayFailure(421, 'ENVIRONMENT_GATEWAY_ORIGIN');
  if (crossSiteMutation(request)) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_CROSS_SITE');
  if (!supportsOperation(request, manifest)) return gatewayFailure(409, 'ENVIRONMENT_GATEWAY_CAPABILITY');
  const headers = cleanHeaders(request.headers);
  const payload = Buffer.from(JSON.stringify({ version: 1, hop: 1, environment: settings.environment, target: settings.origin,
    origin: url.origin, path: url.pathname + url.search, method: request.method, at: Date.now(), headers: digestHeaders(headers, url.pathname) })).toString('base64url');
  for (const [name, value] of Object.entries(gatewayProtectionHeaders(settings))) headers.set(name, value);
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

// Keep only public discovery metadata, isolated by gateway origin.
// Tokens and application responses never enter this cache.
const pilotManifests = new Map<string, { value: Awaited<ReturnType<typeof readGatewayManifest>>; expires: number }>();
async function readPilotManifest(token: string, lane?: PilotBuild['lane']) {
  const gateway = lane === 'production' ? 'https://thingtime.com' : PILOT_GATEWAY;
  const cached = pilotManifests.get(gateway);
  if (cached && Date.now() < cached.expires) return cached.value;
  const discovery = await fetch(gateway + THINGTIME_CAPABILITY_MANIFEST_PATH, {
    headers: lane === 'production' ? {} : { [TRUSTED_SOURCE_HEADER]: token }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000)
  });
  const manifest = await readGatewayManifest(discovery);
  if (manifest.schemaVersion !== 1 || manifest.origin !== gateway ||
      manifest.gateway?.environment !== (lane === 'production' ? 'production' : 'preview') ||
      manifest.gateway?.origin !== gateway || !manifest.gateway.deploymentId || !Array.isArray(manifest.operations) ||
      !capabilitySatisfies(manifest.features?.['api.environment-gateway']?.version, lane ? '1.4.0' : PILOT_VERSION)) throw new Error('Incompatible pilot gateway');
  pilotManifests.set(gateway, { value: manifest, expires: Date.now() + 5000 });
  return manifest;
}

// This frontend has no database authority. The selected upstream authenticates
// its workload independently of the user's normal session.
export async function proxyPilotRequest(request: Request, pilot: PilotBuild): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== pilot.origin) return gatewayFailure(421, 'ENVIRONMENT_GATEWAY_ORIGIN');
  if (crossSiteMutation(request)) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_CROSS_SITE');
  const token = request.headers.get('x-vercel-oidc-token');
  if (!token || token.length > 16384) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_WORKLOAD');
  const manifest = await readPilotManifest(token, pilot.lane);
  if (url.pathname === THINGTIME_CAPABILITY_MANIFEST_PATH) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } });
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'If-None-Match' };
    // A pilot never advertises itself as a database owner.
    return new Response(request.method === 'GET' ? JSON.stringify({ ...manifest, origin: pilot.origin, gateway: null }) : null,
      { status: request.method === 'OPTIONS' ? 204 : 200, headers });
  }
  if (!supportsOperation(request, manifest)) return gatewayFailure(409, 'ENVIRONMENT_GATEWAY_CAPABILITY');
  const headers = cleanHeaders(request.headers);
  if (pilot.lane !== 'production') headers.set(TRUSTED_SOURCE_HEADER, token);
  headers.set(PILOT_OIDC_HEADER, token);
  headers.set(PILOT_PROFILE_HEADER, pilot.profileId);
  if (pilot.lane) headers.set(PILOT_LANE_HEADER, pilot.lane);
  if (pilot.prNumber) headers.set(PILOT_PR_HEADER, String(pilot.prNumber));
  const target = new URL(pilot.lane === 'production' ? 'https://thingtime.com' : PILOT_GATEWAY);
  target.pathname = url.pathname;
  target.search = url.search;
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, redirect: 'manual', cache: 'no-store', signal: request.signal };
  if (!['GET', 'HEAD'].includes(request.method) && request.body) { init.body = request.body; init.duplex = 'half'; }
  return forwardResponse(request, await fetch(target, init));
}

export const environmentGatewayIngress = async (request: Request): Promise<Response | Request | null> => {
  try {
    const pilot = pilotBuild();
    if (pilot) return proxyPilotRequest(request, pilot).catch(() => gatewayFailure());
    const pilotId = request.headers.get(PILOT_PROFILE_HEADER);
    const token = request.headers.get(PILOT_OIDC_HEADER);
    const laneHeader = request.headers.get(PILOT_LANE_HEADER);
    const prHeader = request.headers.get(PILOT_PR_HEADER);
    const settings = getGatewaySettings();
    const relayed = request.headers.has(GATEWAY_RELAY_HEADER) || request.headers.has(SIGNATURE_HEADER);
    if (pilotId !== null || token !== null || laneHeader !== null || prHeader !== null) {
      const lane = laneHeader === null ? null : ['production', 'development', 'preview'].includes(laneHeader) ? laneHeader as 'production' | 'development' | 'preview' : undefined;
      const prNumber = prHeader === null ? undefined : /^[1-9][0-9]*$/.test(prHeader) ? Number(prHeader) : NaN;
      const incomingOrigin = lane === 'production' ? 'https://thingtime.com' : PILOT_GATEWAY;
      if (!settings || !isDeploymentProfileId(pilotId) || !token || relayed ||
          !(lane === null ? isPilotGateway(settings) : lane && isPilotLaneGateway(settings, lane)) ||
          getMongoConnectionMode() !== 'proxy' || new URL(request.url).origin !== incomingOrigin ||
          !(await gatewayAuthority.current())?.owner || request.headers.has('x-tt-mongo-url') ||
          /(?:^|;)\s*tt_mongo=/.test(request.headers.get('cookie') || '')) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_WORKLOAD');
      const { getDeploymentProfile } = await import('../../app/api/utils/ciControl/deploymentProfiles');
      const profile = await withGatewayWork(() => getDeploymentProfile(pilotId));
      if (!profile || lane === undefined || !await authenticatePilot(token, profile, undefined, lane ?? undefined) ||
          (lane === null && prHeader !== null) || (lane !== 'preview' && prHeader !== null) ||
          (lane === 'preview' && (prNumber === undefined || !Number.isSafeInteger(prNumber) || prNumber <= 0))) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_WORKLOAD');
      const sourceOrigin = lane === null ? profile.testOrigin : enrolledPilotOrigin(profile, lane, prNumber);
      if (!sourceOrigin) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_WORKLOAD');
      const restored = restoreOriginalOrigin(request, sourceOrigin);
      if (crossSiteMutation(restored)) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_CROSS_SITE');
      return restored;
    }
    if (!settings) return relayed ? gatewayFailure(403, 'ENVIRONMENT_GATEWAY_RELAY') : null;
    const authority = await gatewayAuthority.current();
    if (!authority) return gatewayFailure();
    if (relayed) {
      if (getMongoConnectionMode() === 'dedicated') return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_RELAY');
      if (!authority.owner) return gatewayFailure(508, 'ENVIRONMENT_GATEWAY_LOOP');
      const restored = restoreGatewayRequest(request, settings);
      if (restored && crossSiteMutation(restored)) return gatewayFailure(403, 'ENVIRONMENT_GATEWAY_CROSS_SITE');
      return restored || gatewayFailure(403, 'ENVIRONMENT_GATEWAY_RELAY');
    }
    if (authority.owner || getMongoConnectionMode() === 'dedicated') return null;
    return proxyEnvironmentRequest(request, authority);
  } catch { return gatewayFailure(); }
};

/** SPA shells remain local. Only their owner-side public metadata lookup holds
 * a database lease; proxy followers render generic metadata without a DB dial. */
export const withGatewayShellWork = async <T>(work: () => Promise<T>, fallback: () => T): Promise<T> => {
  if (pilotBuild()) return fallback();
  const authority = await gatewayAuthority.current();
  if (authority && !authority.owner && getMongoConnectionMode() === 'proxy') return fallback();
  return withGatewayWork(work);
};
