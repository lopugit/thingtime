import { defineHandler } from 'nitro/h3';

import {
  THINGTIME_CAPABILITY_MANIFEST_PATH,
  effectiveThingtimeCapabilityManifest
} from '../../app/api/utils/capabilities/thingtimeCapabilities';
import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

export default defineHandler(async (event) => {
  const method = event.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const origin = getRequestOrigin(event.req);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // Alias ownership is mutable. A CDN/browser must not pin an old owner.
    'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Thingtime-Capability-Manifest': THINGTIME_CAPABILITY_MANIFEST_PATH
  };
  try {
    const manifest = await effectiveThingtimeCapabilityManifest(origin);
    return new Response(method === 'HEAD' ? null : JSON.stringify(manifest), { headers });
  } catch {
    return new Response(method === 'HEAD' ? null : JSON.stringify({
      ok: false, code: 'ENVIRONMENT_GATEWAY_UNAVAILABLE',
      error: 'The environment API gateway is unavailable or incompatible.'
    }), { status: 503, headers });
  }
});
