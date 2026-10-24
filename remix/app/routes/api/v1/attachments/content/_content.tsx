import { attachmentRetention } from '~/api/utils/attachments/attachmentRetention';
import { createAttachmentMutationAction } from '~/api/utils/attachments/attachmentResponses';
import { parseAttachmentRange, readExactRange } from '~/api/utils/attachments/attachmentRanges';
import { CHARACTER_HEADER } from '~/api/utils/auth/characterSession';
import { withFoundPostBrowser } from '~/api/utils/things/foundPostRequest';
import { attachmentImageResponse, parseImageWidth } from '~/api/utils/attachments/imageVariants';
import { json, redirect } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getAttachmentDownload, getAttachmentDownloadTarget, getAttachmentFingerprint } from '~/api/utils/attachments/attachments';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { fetchStoredObject } from '~/api/utils/attachments/localAttachmentStorage';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { viewerOf, withFriendIds, withLinkKeys } from '~/api/utils/things/things';

type ContentDependencies = {
	getUser: typeof getCurrentUser;
	enforceLimit: typeof enforceRateLimit;
	download: typeof getAttachmentDownload;
	downloadTarget: typeof getAttachmentDownloadTarget;
	fingerprint: typeof getAttachmentFingerprint;
	enrichViewer: typeof withFriendIds;
	fetchObject: typeof fetchStoredObject;
	rangeFetch: typeof fetchStoredObject;
};

const defaultDependencies: ContentDependencies = {
	getUser: getCurrentUser,
	enforceLimit: enforceRateLimit,
	download: getAttachmentDownload,
	downloadTarget: getAttachmentDownloadTarget,
	fingerprint: getAttachmentFingerprint,
	enrichViewer: withFriendIds,
	fetchObject: fetchStoredObject,
	rangeFetch: fetchStoredObject
};

export const createAttachmentContentLoader = (overrides: Partial<ContentDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			const url = new URL(request.url);
			let range: ReturnType<typeof parseAttachmentRange>;
			try {
				range = parseAttachmentRange(url);
			} catch {
				return json({ ok: false, error: 'Invalid attachment byte range' }, { status: 400 });
			}
			const target = url.searchParams.has('target');
			if (target && (!range || url.searchParams.get('target') !== '1' || [...url.searchParams.keys()].some(key => !['id', 'target', 'range', 'version', 'offset', 'length'].includes(key) || url.searchParams.getAll(key).length !== 1)))
				return json({ ok: false, error: 'Signed targets require one owned exact range without other modes' }, { status: 400 });
			const retained = url.searchParams.has('retained');
			if (retained && (!range || url.searchParams.getAll('retained').length !== 1 || url.searchParams.get('retained') !== '1' || url.searchParams.has('sharedRoot') || url.searchParams.has('key')))
				return json({ ok: false, error: 'Retention reads require an owned exact byte range' }, { status: 400 });
			const sharedRoot = url.searchParams.get('sharedRoot');
			if (sharedRoot !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sharedRoot))
				return json({ ok: false, error: 'Invalid shared root' }, { status: 400 });
			const width = parseImageWidth(url.searchParams.get('width'));
			if (width === null) return json({ ok: false, error: 'Unsupported image width' }, { status: 400 });
			// Media elements cannot attach an identity header. This optional selector
            // is authorized by the same full-session ownership check as a composer.
            const character = url.searchParams.get('character');
            if (character !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(character)) return json({ ok: false, error: 'Invalid Character' }, { status: 400 });
            const actorRequest = character === null ? request : new Request(request, { headers: new Headers(request.headers) });
            if (character !== null) actorRequest.headers.set(CHARACTER_HEADER, character);
            const resolvedUser = await dependencies.getUser(actorRequest);
            if (character !== null && !resolvedUser) return json({ ok: false, error: 'Character unavailable' }, { status: 401 });
			// Service credentials are not first-party attachment principals. Treat
			// them exactly like an anonymous caller for public-post authorization.
			const user = resolvedUser?.accountKind === 'user' ? resolvedUser : null;
			const retainBytes = url.searchParams.get('cache') === 'retain-bytes';
			const retainOwnedFile = retainBytes || url.searchParams.get('cache') === 'retain';
			if (retainOwnedFile && (!user || !isSameOriginAttachmentRequest(request))) return json({ ok: false, error: 'A same-origin full user session is required' }, { status: user ? 403 : 401 });
			if (retainOwnedFile && (sharedRoot || url.searchParams.has('key') || url.searchParams.has('width') || url.searchParams.get('download') !== '1'))
				return json({ ok: false, error: 'File retention requires an unscoped original download' }, { status: 400 });
			const limit = await dependencies.enforceLimit(request, 'attachments.read', user ? `user:${user.id}` : null, {
				failClosed: true
			});
			if (!limit.allowed) {
				if (limit.unavailable) {
					return json({ ok: false, error: 'Attachment service is temporarily unavailable' }, { status: 503 });
				}
				return json({ ok: false, error: 'Too many attachment requests' }, rateLimitedResponseInit(limit));
			}

			if (target) {
				if (!user?.id) return json({ ok: false, error: 'Attachment not found' }, { status: 404 });
				const result = await dependencies.downloadTarget({ id: user.id }, url.searchParams.get('id'), range!);
				if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
				if ((await dependencies.getUser(actorRequest))?.id !== user.id) return json({ ok: false, error: 'Attachment not found' }, { status: 404 });
				return json(result);
			}
			const audience = await dependencies.enrichViewer(
				withLinkKeys(withFoundPostBrowser(viewerOf(user), request, !resolvedUser), [url.searchParams.get('key') || ''])
			);
			if (url.searchParams.get('fingerprint') === '1') {
				if (width || url.searchParams.has('cache'))
					return json({ ok: false, error: 'Fingerprint requests cannot select image or byte-cache variants' }, { status: 400 });
				const result = await dependencies.fingerprint(
					audience || sharedRoot ? { id: '', ...audience, ...(user?.isAdmin ? { isAdmin: true } : {}), ...(sharedRoot ? { sharedRoot } : {}) } : null,
					url.searchParams.get('id')
				);
				if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
				return json(result);
			}
			const result = await dependencies.download(
				// isAdmin rides along so admins can fetch quarantined (blocked)
				// evidence for moderation review; everyone else 404s on blocked docs.
				user ? { id: user.id, username: user.username, isAdmin: user.isAdmin } : null,
				url.searchParams.get('id'),
				url.searchParams.get('download') === '1',
				retained ? range!.version : undefined,
				retainOwnedFile
			);
			if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
			if (retainOwnedFile) {
				if (!result.retention || result.retention.ownerId !== user!.id) return json({ ok: false, error: 'Saved owned file not found' }, { status: 404 });
				if (!retainBytes) return json({ ok: true, cacheKey: `${result.cacheKey}:original`, size: result.size, file: result.retention });
			}
			if (range) {
				if (result.version !== range.version) return json({ ok: false, error: 'Attachment version changed' }, { status: 409 });
				if (range.offset + range.length > result.size) return json({ ok: false, error: 'Attachment range is outside the file' }, { status: 416 });
				const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
				let bytes: Uint8Array<ArrayBuffer>;
				try {
					const upstream = await dependencies.rangeFetch(result.url, {
						redirect: 'error',
						signal,
						headers: { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` }
					});
					bytes = await readExactRange(upstream, range, result.size, () => signal.throwIfAborted());
				} catch {
					return json({ ok: false, error: 'Attachment range unavailable; retry the same version' }, { status: 502 });
				}
				signal.throwIfAborted();
				if (retained && (await dependencies.getUser(actorRequest))?.id !== user?.id)
					return json({ ok: false, error: 'Attachment not found' }, { status: 404 });
				const refreshedAudience = await dependencies.enrichViewer(
					withLinkKeys(withFoundPostBrowser(viewerOf(user), request, !resolvedUser), [url.searchParams.get('key') || ''])
				);
				const current = await dependencies.download(
					refreshedAudience || sharedRoot
						? { id: '', ...refreshedAudience, ...(user?.isAdmin ? { isAdmin: true } : {}), ...(sharedRoot ? { sharedRoot } : {}) }
						: null,
					url.searchParams.get('id'),
					false,
					retained ? range!.version : undefined
				);
				if (current.ok === false) return json({ ok: false, error: current.error }, { status: current.status });
				if (current.version !== range.version || current.size !== result.size)
					return json({ ok: false, error: 'Attachment changed during the range read' }, { status: 409 });
				signal.throwIfAborted();
				return new Response(bytes, {
					status: 206,
					headers: {
						'Content-Type': 'application/octet-stream',
						'Content-Disposition': result.disposition,
						'Content-Length': String(bytes.length),
						'Content-Range': `bytes ${range.offset}-${range.offset + range.length - 1}/${result.size}`,
						'Accept-Ranges': 'bytes',
						ETag: `"${range.version}"`,
						'Cache-Control': 'private, no-store',
						'X-Content-Type-Options': 'nosniff'
					}
				});
			}
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
			if (retainBytes || url.searchParams.get('cache') === 'bytes') {
				if (!retainBytes && result.size > 16 * 1024 * 1024) return json({ ok: false, error: 'Use native streaming for large files' }, { status: 413 });
				const upstream = await dependencies.fetchObject(result.url, { redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]) });
				if (!upstream.ok || !upstream.body) { void upstream.body?.cancel().catch(() => {}); return new Response(null, { status: 502 }); }
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
				(new URL(request.url).searchParams.get('cache') !== 'retain-bytes') && (response.status === 304 ||
				(response.status === 200 &&
					response.headers.get('Content-Type') !== 'application/json; charset=utf-8' &&
					!response.headers.get('Content-Type')?.includes('application/json')))
			) {
				response.headers.set('Cache-Control', 'private, no-cache');
				response.headers.delete('Pragma');
			}
			return response;
		});
};

export const loader = createAttachmentContentLoader();

export const action = createAttachmentMutationAction({ rateKey: 'attachments.read', service: attachmentRetention.retain }, { getUser: getCurrentUser });
