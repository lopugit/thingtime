import { createHash } from 'node:crypto';
import { defineHandler } from 'nitro/h3';

import {
  THINGTIME_CAPABILITY_MANIFEST_PATH,
  thingtimeCapabilityManifest
} from '../../app/api/utils/capabilities/thingtimeCapabilities';
import { pilotBuild } from '../../app/api/utils/deployment/pilotBuild';
import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

/**
 * Vercel's own CDN keys every cached response by the unique deployment URL as
 * well as method, scheme, host and path, so a stored manifest is only ever
 * served by the deployment that produced it. A manifest never changes during a
 * deployment's life (feature versions are built in, gateway settings are fixed
 * deployment configuration), so after an alias moves, requests to the alias
 * reach the new owner's cache and get the new owner's identity. That lets the
 * environment gateway's five-second ownership check, and every client's
 * capability check, end at the edge instead of invoking a function.
 *
 * `Vercel-CDN-Cache-Control` is consumed by Vercel and never forwarded, so
 * browsers and any proxy in front of Vercel still receive `private, no-store`
 * and cannot pin an old owner.
 */
export const CAPABILITY_MANIFEST_EDGE_CACHE = 'max-age=3600';

/** Only a GET whose computed origin is exactly the routed HTTPS host may be
 * stored, so a forged forwarded host or scheme can never put a manifest for
 * another origin under this host's cache key. Parallel pilot builds relay
 * discovery through the gateway and are never stored. */
const edgeCacheable = (request: Request, method: string, origin: string) => {
  if (method !== 'GET' || pilotBuild()) return false;
  const routedHost = request.headers.get('host') || new URL(request.url).host;
  try {
    return origin === new URL(`https://${routedHost}`).origin;
  } catch {
    return false;
  }
};

export const capabilityManifestResponse = (request: Request) => {
  const method = request.method.toUpperCase();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Alias ownership is mutable. Neither a browser nor a proxy in front of
    // Vercel may pin an old owner; only Vercel's per-deployment edge cache
    // may keep a copy (see CAPABILITY_MANIFEST_EDGE_CACHE).
    'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'X-Thingtime-Capability-Manifest': THINGTIME_CAPABILITY_MANIFEST_PATH
  };
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Max-Age': '600' } });
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD, OPTIONS' } });
  }
  const origin = getRequestOrigin(request);
  const body = JSON.stringify(thingtimeCapabilityManifest(origin));
  // Hash the entire exact-origin representation, including deployment owner,
  // feature versions and operations. A promotion can never reuse an old tag.
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
  const cacheAtEdge = edgeCacheable(request, method, origin);
  const tags = request.headers.get('if-none-match')?.split(',').map(tag => tag.trim().replace(/^W\//, ''));
  // A storable request always gets the full body, even when conditional: the
  // gateway's own ownership check is conditional, and a 304 could never fill
  // the edge cache. The edge then answers repeat and conditional requests.
  const unchanged = !cacheAtEdge && tags?.some(tag => tag === '*' || tag === etag);
  return new Response(unchanged || method === 'HEAD' ? null : body, {
    status: unchanged ? 304 : 200,
    headers: { ...headers, ETag: etag, ...(cacheAtEdge ? { 'Vercel-CDN-Cache-Control': CAPABILITY_MANIFEST_EDGE_CACHE } : {}) }
  });
};

export default defineHandler(event => capabilityManifestResponse(event.req));
