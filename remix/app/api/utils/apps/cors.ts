import { readJsonBody } from '~/api/http';

// CORS for the embed APIs: the SDK calls /api/v1/app-data* from third-party
// origins with a Bearer app token. The preflight is auth-free and echoes any
// Origin — by itself it grants nothing. Real responses carry
// Access-Control-Allow-Origin so the embedding page's JS can read them; data
// responses only ever go to the token's own bound origin (the routes enforce
// request Origin === token origin before returning data).

export const appCorsHeaders = (origin: string | null): Record<string, string> => {
  if (!origin) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin'
  };
};

// Handle an OPTIONS preflight for the embed routes (the API catch-all sends
// every non-GET/HEAD method to `action`, so actions call this first). Pass the
// methods the route actually serves; defaults to the app-data set.
export const appDataPreflight = (request: Request, methods = 'GET, POST, OPTIONS'): Response | null => {
  if (request.method.toUpperCase() !== 'OPTIONS') return null;

  return new Response(null, {
    status: 204,
    headers: {
      ...appCorsHeaders(request.headers.get('Origin') || '*'),
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
};

// Read a JSON body on a cross-origin embed route: readJsonBody THROWS a bare
// 413 Response when the body exceeds the cap, and the API catch-all passes
// thrown Responses through verbatim — without CORS headers the embedding
// page's fetch() rejects opaquely instead of reading the error JSON. Re-wrap
// with the route's CORS headers so the 413 contract survives cross-origin.
export const readJsonBodyWithCors = async (
  request: Request,
  maxBytes: number,
  cors: Record<string, string>
): Promise<any> => {
  try {
    return await readJsonBody(request, maxBytes);
  } catch (thrown) {
    if (thrown instanceof Response) {
      const headers = new Headers(thrown.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      throw new Response(thrown.body, { status: thrown.status, headers });
    }
    throw thrown;
  }
};
