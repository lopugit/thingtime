import { defineHandler } from 'nitro/h3';

import {
  THINGTIME_CAPABILITY_MANIFEST_PATH,
  thingtimeCapabilityManifest
} from '../../app/api/utils/capabilities/thingtimeCapabilities';
import { getRequestOrigin } from '../../app/api/utils/health/statusTarget';

export default defineHandler((event) => {
  const method = event.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const origin = getRequestOrigin(event.req);
  const body = method === 'HEAD' ? null : JSON.stringify(thingtimeCapabilityManifest(origin));
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'X-Thingtime-Capability-Manifest': THINGTIME_CAPABILITY_MANIFEST_PATH
    }
  });
});
