import { createHash } from 'node:crypto';
import { defineHandler } from 'nitro/h3';

import {
  THINGTIME_CAPABILITY_MANIFEST_PATH,
  thingtimeCapabilityManifest
} from '../../app/api/utils/capabilities/thingtimeCapabilities';
import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

export const capabilityManifestResponse = (request: Request) => {
  const method = request.method.toUpperCase();
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Alias ownership is mutable. Revalidation must reach this deployment;
    // neither a CDN nor a browser may pin an old owner.
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
  const tags = request.headers.get('if-none-match')?.split(',').map(tag => tag.trim().replace(/^W\//, ''));
  const unchanged = tags?.some(tag => tag === '*' || tag === etag);
  return new Response(unchanged || method === 'HEAD' ? null : body, {
    status: unchanged ? 304 : 200,
    headers: { ...headers, ETag: etag }
  });
};

export default defineHandler(event => capabilityManifestResponse(event.req));
