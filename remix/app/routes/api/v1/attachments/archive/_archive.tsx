import { withFoundPostBrowser } from '~/api/utils/things/foundPostRequest';
import { json } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { attachmentArchiveManifest, planAttachmentArchive, streamAttachmentArchive } from '~/api/utils/attachments/attachmentArchive';
import { ARCHIVE_ID_PATTERN, ARCHIVE_WALL_CLOCK_MS } from '~/api/utils/attachments/attachmentArchiveCore';
import { attachmentContentDisposition } from '~/api/utils/attachments/attachmentPresentation';
import { withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { viewerOf, withFriendIds, withLinkKeys } from '~/api/utils/things/things';

// GET /api/v1/attachments/archive?id=<thing>[&manifest=1][&key=][&sharedRoot=]
//
// One ZIP of every stored file the caller may already read on a post, comment,
// page, folder or single media Thing. The URL is a plain share link: opening
// it in a browser, wget or curl downloads the archive directly, and the same
// audience rules as the Thing itself decide who gets bytes. manifest=1 answers
// with JSON (file list, count, bytes) so clients can show what a download holds.
//
// Probes (manifest=1, HEAD) enumerate and authorize but never presign or
// stream, and draw on their own rate window; one wall clock anchored here
// bounds planning and streaming together.

type ArchiveDependencies = {
	getUser: typeof getCurrentUser;
	enforceLimit: typeof enforceRateLimit;
	plan: typeof planAttachmentArchive;
	manifest: typeof attachmentArchiveManifest;
	stream: typeof streamAttachmentArchive;
	enrichViewer: typeof withFriendIds;
	now: () => number;
};

const defaultDependencies: ArchiveDependencies = {
	getUser: getCurrentUser,
	enforceLimit: enforceRateLimit,
	plan: planAttachmentArchive,
	manifest: attachmentArchiveManifest,
	stream: streamAttachmentArchive,
	enrichViewer: withFriendIds,
	now: Date.now
};

export const createAttachmentArchiveLoader = (overrides: Partial<ArchiveDependencies> = {}) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			const startedAt = dependencies.now();
			const url = new URL(request.url);
			const id = (url.searchParams.get('id') || '').trim();
			if (!ARCHIVE_ID_PATTERN.test(id)) return json({ ok: false, error: 'Invalid archive id' }, { status: 400 });
			const sharedRoot = url.searchParams.get('sharedRoot');
			if (sharedRoot !== null && !ARCHIVE_ID_PATTERN.test(sharedRoot)) return json({ ok: false, error: 'Invalid shared root' }, { status: 400 });
			const manifestOnly = url.searchParams.get('manifest') === '1';
			const probe = manifestOnly || request.method === 'HEAD';
			const resolvedUser = await dependencies.getUser(request);
			// Service credentials are not first-party attachment principals (same
			// rule as the content endpoint): they read exactly like anonymous callers.
			const user = resolvedUser?.accountKind === 'user' ? resolvedUser : null;
			const limit = await dependencies.enforceLimit(request, probe ? 'attachments.archiveManifest' : 'attachments.archive', user ? `user:${user.id}` : null, { failClosed: true });
			if (!limit.allowed) {
				if (limit.unavailable) return json({ ok: false, error: 'Attachment service is temporarily unavailable' }, { status: 503 });
				return json({ ok: false, error: 'Too many archive requests' }, rateLimitedResponseInit(limit));
			}
			const viewer = await dependencies.enrichViewer(
				withLinkKeys(withFoundPostBrowser(viewerOf(user), request, !resolvedUser), [url.searchParams.get('key') || ''])
			);
			const deadlineAt = startedAt + ARCHIVE_WALL_CLOCK_MS;
			const plan = await dependencies.plan(viewer, id, { sharedRoot, presign: !probe, deadlineAt, ...(user?.isAdmin ? { isAdmin: true } : {}) });
			if (plan.ok === false) return json({ ok: false, error: plan.error }, { status: plan.status });
			if (manifestOnly) return json(dependencies.manifest(plan, { revealSkipped: !!user && (user.id === plan.ownerId || user.isAdmin === true) }));
			const headers = {
				'Content-Type': 'application/zip',
				'Content-Disposition': attachmentContentDisposition(plan.fileName, false),
				'Cache-Control': 'private, no-store, max-age=0',
				'X-Content-Type-Options': 'nosniff',
				'X-Thingtime-Archive-Files': String(plan.entries.length),
				'X-Thingtime-Archive-Bytes': String(plan.totalBytes)
			};
			// HEAD callers (download managers probing the link) get the headers
			// without presigning or streaming a single byte.
			if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
			return new Response(dependencies.stream(plan, request.signal, { deadlineAt }), { status: 200, headers });
		});
};

export const loader = createAttachmentArchiveLoader();

export const action = async () =>
	withAttachmentPrivateResponse(async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, HEAD' } }));
