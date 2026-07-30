import { defineHandler } from 'nitro/h3';

import { renderApiDocsMarkdown } from '../../../app/docs/apiDocsMarkdown';

// GET /api/docs — the whole API reference as one Markdown file. Sits directly
// under /api on purpose: an AI (or integrator) scanning a route bundle for
// /api* endpoints finds this one and can fetch every doc in a single request.
// Anonymous — documentation data. The catalog is static per build, so the
// render is memoised per origin.

const cache = new Map<string, string>();

export default defineHandler((event) => {
  const method = event.req.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const origin = new URL(event.req.url).origin;
  let markdown = cache.get(origin);
  if (!markdown) {
    markdown = renderApiDocsMarkdown(origin);
    cache.set(origin, markdown);
  }

  return new Response(method === 'HEAD' ? null : markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'inline; filename="thingtime-api.md"',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*'
    }
  });
});
