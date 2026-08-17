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
				user ? { id: user.id, username: user.username } : null,
				url.searchParams.get('id'),
				url.searchParams.get('download') === '1'
			);
			if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status });
			return redirect(result.url, {
				status: 302,
				headers: {
					'X-Content-Type-Options': 'nosniff'
				}
			});
		});
};

export const loader = createAttachmentContentLoader();

export const action = async () =>
	withAttachmentPrivateResponse(async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } }));
