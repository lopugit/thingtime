import { defineMiddleware } from 'nitro/h3';

import { admitGatewayWork, GatewayUnavailable } from '../../app/api/utils/deployment/environmentGateway';
import { withIndexReadinessRequest } from '../../app/api/utils/mongodb/collections';
import { environmentGatewayIngress, gatewayFailure, isGatewayDataPath } from '../utils/environmentGateway';

export default defineMiddleware(async (event, next) => {
  const dataPath = isGatewayDataPath(new URL(event.req.url).pathname);
  // Static and follower traffic must never keep a demoted owner's pools alive.
  let lease: Awaited<ReturnType<typeof admitGatewayWork>> | undefined;
  const end = () => lease?.end();
  try {
    const result = dataPath ? await environmentGatewayIngress(event.req) : null;
    if (result instanceof Response) { end(); return result; }
    if (result instanceof Request) {
      // h3's public request slot is readonly in TS but writable at runtime.
      // Restore it before any auth, OAuth, CSRF, custom-endpoint or cron handler.
      Object.assign(event, { req: result, url: new URL(result.url) });
    }
    if (!dataPath) return next();
    lease = await admitGatewayWork();
    const response = await lease.run(() => withIndexReadinessRequest(() => Promise.resolve(next())));
    if (!(response instanceof Response) || !response.body) { end(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await lease!.run(() => reader.read());
          if (chunk.done) { controller.close(); end(); } else controller.enqueue(chunk.value);
        } catch (error) { controller.error(error); end(); }
      },
      async cancel(reason) { try { await lease!.run(() => reader.cancel(reason)); } finally { end(); } }
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { end(); if (error instanceof GatewayUnavailable) return gatewayFailure(); throw error; }
});
