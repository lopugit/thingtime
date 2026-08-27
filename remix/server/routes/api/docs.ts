import { defineHandler } from 'nitro/h3';

import { renderApiDocsMarkdown } from '../../../app/docs/apiDocsMarkdown';

// GET /api/docs — the whole API reference as one Markdown file. Sits directly
// under /api on purpose: an AI (or integrator) scanning a route bundle for
// /api* endpoints finds this one and can fetch every doc in a single request.
// Anonymous — documentation data. The catalog is static per build, so the
// render is memoised per origin.

// LRU-bounded because the key is the REQUEST's origin, which follows the Host
// header — so it is caller-controlled, not a fixed set. Unbounded, any client
// sending varying Host values mints a fresh ~300 KB render per distinct value
// and grows the instance's heap without limit. Real deployments only ever need
// a handful (prod domain, preview aliases, localhost); the cap keeps the
// common case a permanent hit while making unbounded growth impossible.
const cache = new Map<string, string>();
const MAX_CACHED_ORIGINS = 8;

export default defineHandler((event) => {
  const method = event.req.method.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  }

  const origin = new URL(event.req.url).origin;
  let markdown = cache.get(origin);
  if (markdown === undefined) {
    markdown = renderApiDocsMarkdown(origin);
    cache.set(origin, markdown);
    // Map iteration order is insertion order — evict the oldest past the cap.
    for (const stale of [...cache.keys()].slice(0, Math.max(0, cache.size - MAX_CACHED_ORIGINS))) cache.delete(stale);
  } else {
    // LRU touch: re-inserting moves this origin to the newest position.
    cache.delete(origin);
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
