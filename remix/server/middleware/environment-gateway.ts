import { defineMiddleware } from 'nitro/h3';

import { beginGatewayWork, runAdmittedGatewayWork } from '../../app/api/utils/deployment/environmentGateway';
import { withIndexReadinessRequest } from '../../app/api/utils/mongodb/collections';
import { environmentGatewayIngress, isGatewayDataPath } from '../utils/environmentGateway';

export default defineMiddleware(async (event, next) => {
  const dataPath = isGatewayDataPath(new URL(event.req.url).pathname);
  const end = beginGatewayWork();
  try {
    const result = dataPath ? await environmentGatewayIngress(event.req) : null;
    if (result instanceof Response) { end(); return result; }
    if (result instanceof Request) {
      // h3's public request slot is readonly in TS but writable at runtime.
      // Restore it before any auth, OAuth, CSRF, custom-endpoint or cron handler.
      Object.assign(event, { req: result, url: new URL(result.url) });
    }
    const response = await (dataPath ? runAdmittedGatewayWork(() => withIndexReadinessRequest(() => Promise.resolve(next()))) : Promise.resolve(next()));
    if (!(response instanceof Response) || !response.body) { end(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) { controller.close(); end(); } else controller.enqueue(chunk.value);
        } catch (error) { controller.error(error); end(); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { end(); } }
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { end(); throw error; }
});
