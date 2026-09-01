import { defineHandler } from 'nitro/h3';
import { useStorage } from 'nitro/storage';

import { injectSocialMeta, renderSocialMetaHtml, resolveSocialMeta } from '../../app/api/utils/meta/socialMeta';
import { getRequestMongoEndpoint, runWithMongoEndpoint } from '../../app/api/utils/mongodb/endpoint';

// The SPA shell for every non-API, non-static path. Nitro compiles this route
// as MIDDLEWARE ahead of its built-in SPA renderer (rootDir/index.html), and
// h3 treats a 404 Response from a middleware as "unhandled" — it would fall
// through to the raw source template. So this handler always answers 200 with
// the built shell; per-page social meta carries the page identity instead.
export default defineHandler(async (event) => {
  // assets:shell is the explicit server/assets mount (nitro.config.ts);
  // assets:server stays as a fallback for older built layouts where nitro's
  // default mount still resolved there.
  const html =
    (await useStorage('assets:shell').getItem<string>('index.html')) ??
    (await useStorage('assets:server').getItem<string>('index.html'));

  if (!html) {
    return new Response('Client app has not been built yet.', { status: 503 });
  }

  // The shell is static, so link unfurlers (no JS) would otherwise see zero
  // page identity. Swap the head's tt-social-meta block per-request: /post/:id
  // and /profile/:username get page-specific Open Graph / Twitter tags built
  // from public data only (private/missing pages get the generic site block),
  // every other path gets the site defaults with absolute request-derived
  // URLs. Meta is best-effort: a data-plane hiccup must never take down page
  // serving.
  let body = html;
  try {
    // same endpoint context as the API catch-all, so shell meta and the SPA's
    // own follow-up API reads resolve against the same data plane
    const mongoEndpoint = await getRequestMongoEndpoint(event.req);
    const social = await runWithMongoEndpoint(mongoEndpoint, () => resolveSocialMeta(event.req));
    body = injectSocialMeta(html, renderSocialMetaHtml(social.tags));
  } catch (error) {
    // serve the untouched shell — but audibly, never silently
    console.error('[social-meta] falling back to the generic shell:', error);
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // marks shells served by this handler (vs the static /index.html copy) so
      // the Vercel permalink routing stays curl-verifiable in production
      'X-TT-Shell': 'social-meta'
    }
  });
});
