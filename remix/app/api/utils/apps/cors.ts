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

// Handle an OPTIONS preflight for the app-data routes (the API catch-all sends
// every non-GET/HEAD method to `action`, so actions call this first).
export const appDataPreflight = (request: Request): Response | null => {
  if (request.method.toUpperCase() !== 'OPTIONS') return null;

  return new Response(null, {
    status: 204,
    headers: {
      ...appCorsHeaders(request.headers.get('Origin') || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
};
