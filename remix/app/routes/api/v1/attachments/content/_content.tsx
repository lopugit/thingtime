import { attachmentImageResponse, parseImageWidth } from '~/api/utils/attachments/imageVariants';
import { json, redirect } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getAttachmentDownload } from '~/api/utils/attachments/attachments';
import { withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

type ContentDependencies = {
	getUser: typeof getCurrentUser;
	enforceLimit: typeof enforceRateLimit;
	download: typeof getAttachmentDownload;
};

const defaultDependencies: ContentDependencies = {
	getUser: getCurrentUser,
	enforceLimit: enforceRateLimit,
	download: getAttachmentDownload
};

export const createAttachmentContentLoader = (overrides: Partial<ContentDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			const url = new URL(request.url);
			const width = parseImageWidth(url.searchParams.get('width'));
			if (width === null) return json({ ok: false, error: 'Unsupported image width' }, { status: 400 });
			const resolvedUser = await dependencies.getUser(request);
			// Service credentials are not first-party attachment principals. Treat
			// them exactly like an anonymous caller for public-post authorization.
			const user = resolvedUser?.accountKind === 'user' ? resolvedUser : null;
			const limit = await dependencies.enforceLimit(request, 'attachments.read', user ? `user:${user.id}` : null, {
				failClosed: true
			});
			if (!limit.allowed) {
				if (limit.unavailable) {
					return json({ ok: false, error: 'Attachment service is temporarily unavailable' }, { status: 503 });
				}
				return json({ ok: false, error: 'Too many attachment requests' }, rateLimitedResponseInit(limit));
			}

			const result = await dependencies.download(
				// isAdmin rides along so admins can fetch quarantined (blocked)
				// evidence for moderation review; everyone else 404s on blocked docs.
				user ? { id: user.id, username: user.username, isAdmin: user.isAdmin } : null,
				url.searchParams.get('id'),
				url.searchParams.get('download') === '1'
			);
			if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
			if (width && (!result.image || result.size > 20 * 1024 * 1024)) {
				return json({ ok: false, error: 'Image preview unavailable; use the original' }, { status: 415 });
			}
			// A small, uncached authorization receipt gates EVERY persistent cache read.
			// The signed URL stays transient and never enters persistent browser storage.
			if (url.searchParams.get('cache') === 'validate') {
				return json({ ok: true, cacheKey: `${result.cacheKey}:${width || 'original'}`, size: result.size });
			}
			const etag = `"${result.cacheKey}:${width || 'original'}:v1"`;
			if ((width || url.searchParams.get('cache') === 'bytes') && request.headers.get('If-None-Match') === etag) {
				return new Response(null, { status: 304, headers: { ETag: etag } });
			}
			if (width) {
				const response = await attachmentImageResponse(result, width);
				if (response.ok) response.headers.set('ETag', etag);
				return response;
			}
			if (url.searchParams.get('cache') === 'bytes') {
				if (result.size > 16 * 1024 * 1024) return json({ ok: false, error: 'Use native streaming for large files' }, { status: 413 });
				const upstream = await fetch(result.url, { redirect: 'error', signal: AbortSignal.timeout(25_000) });
				if (!upstream.ok || !upstream.body) return new Response(null, { status: 502 });
				return new Response(upstream.body, {
					headers: {
						ETag: etag,
						'Content-Type': result.contentType,
						'Content-Disposition': result.disposition,
						'Content-Length': String(result.size),
						'Cache-Control': 'private, no-cache',
						'X-Content-Type-Options': 'nosniff'
					}
				});
			}
			return redirect(result.url, {
				status: 302,
				headers: {
					'X-Content-Type-Options': 'nosniff'
				}
			});
		}).then((response) => {
			// Bytes may be retained, but the browser must reauthorize before reuse.
			if (
				response.status === 304 ||
				(response.status === 200 &&
					response.headers.get('Content-Type') !== 'application/json; charset=utf-8' &&
					!response.headers.get('Content-Type')?.includes('application/json'))
			) {
				response.headers.set('Cache-Control', 'private, no-cache');
				response.headers.delete('Pragma');
			}
			return response;
		});
};

export const loader = createAttachmentContentLoader();

export const action = async () =>
	withAttachmentPrivateResponse(async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } }));
