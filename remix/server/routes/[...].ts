import { defineHandler } from 'nitro/h3';
import { useStorage } from 'nitro/storage';

import { renderSocialCardPng } from '../../app/api/utils/meta/socialCard';
import { injectSocialMeta, renderSocialMetaHtml, resolveSocialMeta } from '../../app/api/utils/meta/socialMeta';
import { normaliseSocialPreviewPath, resolveSocialPreview, staticSocialPreview } from '../../app/api/utils/meta/socialPreview';
import { getRequestMongoEndpoint, runWithMongoEndpoint } from '../../app/api/utils/mongodb/endpoint';

// The SPA shell for every non-API, non-static path. Nitro compiles this route
// as MIDDLEWARE ahead of its built-in SPA renderer (rootDir/index.html), and
// h3 treats a 404 Response from a middleware as "unhandled" — it would fall
// through to the raw source template. So this handler always answers 200 with
// the built shell; per-page social meta carries the page identity instead.
export default defineHandler(async (event) => {
	const requestUrl = new URL(event.req.url);
	// The one public image endpoint intentionally shares the same controller as
	// page meta. It only accepts a normalized local path, re-runs the anonymous
	// projection, and then draws a PNG — there is no arbitrary remote-image
	// proxy hidden behind a social-card URL.
	if (requestUrl.pathname === '/social-card') {
		if (!['GET', 'HEAD'].includes(event.req.method.toUpperCase())) {
			return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
		}
		const path = normaliseSocialPreviewPath(requestUrl.searchParams.get('path'));
		try {
			const mongoEndpoint = await getRequestMongoEndpoint(event.req);
			const preview = await runWithMongoEndpoint(mongoEndpoint, () => resolveSocialPreview(requestUrl.origin, path));
			const headers = {
				'Content-Type': 'image/png',
				'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
				'X-Content-Type-Options': 'nosniff'
			};
			if (event.req.method.toUpperCase() === 'HEAD') return new Response(null, { headers });
			const png = await renderSocialCardPng(preview);
			return new Response(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, { headers });
		} catch (error) {
			console.error('[social-card] rendering a safe fallback card:', error);
			const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' };
			if (event.req.method.toUpperCase() === 'HEAD') return new Response(null, { headers });
			const png = await renderSocialCardPng(staticSocialPreview(path));
			return new Response(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, { headers });
		}
	}

	// assets:shell is the explicit server/assets mount (nitro.config.ts);
	// assets:server and assets:client stay as fallbacks for older built layouts
	// where nitro's default mount still resolved to one of those instead.
	const html =
		(await useStorage('assets:shell').getItem<string>('index.html')) ??
		(await useStorage('assets:server').getItem<string>('index.html')) ??
		(await useStorage('assets:client').getItem<string>('index.html'));

	if (!html) {
		return new Response('Client app has not been built yet.', { status: 503 });
	}

	// The shell is static, so link unfurlers (no JS) would otherwise see zero
	// page identity. Swap the head's tt-social-meta block per request: every
	// shareable route gets a variant-specific Open Graph / Twitter card built
	// from public data only (private/missing data gets the generic card). Meta
	// is best-effort: a data-plane hiccup must never take down page serving.
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
