import { json, readJsonBody } from '../../http';
import { getCurrentUser } from '../auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '../rateLimit/enforce';

export const ATTACHMENT_PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0';
export const ATTACHMENT_JSON_BODY_BYTES = 16 * 1024;

const applyPrivateHeaders = (response: Response): Response => {
	response.headers.set('Cache-Control', ATTACHMENT_PRIVATE_CACHE_CONTROL);
	response.headers.set('Pragma', 'no-cache');
	response.headers.set('Referrer-Policy', 'no-referrer');
	return response;
};

export const withAttachmentPrivateResponse = async (handler: () => Response | Promise<Response>): Promise<Response> => {
	try {
		return applyPrivateHeaders(await handler());
	} catch (error) {
		if (error instanceof Response) throw applyPrivateHeaders(error);
		throw error;
	}
};

export const isSameOriginAttachmentRequest = (request: Request): boolean => {
	const origin = request.headers.get('Origin');
	if (!origin) return true;
	const fetchSite = request.headers.get('Sec-Fetch-Site')?.trim().toLowerCase();
	if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
	try {
		const requestUrl = new URL(request.url);
		const forwardedHost = request.headers.get('X-Forwarded-Host')?.split(',')[0]?.trim();
		const forwardedProto = request.headers.get('X-Forwarded-Proto')?.split(',')[0]?.trim();
		const effectiveOrigin = forwardedHost && forwardedProto ? new URL(`${forwardedProto}://${forwardedHost}`).origin : requestUrl.origin;
		return new URL(origin).origin === effectiveOrigin;
	} catch {
		return false;
	}
};

type MutationService = (
	ownerId: string,
	input: unknown
) => Promise<{ ok: false; status: number; error: string; code?: string; retryable?: boolean } | ({ ok: true } & Record<string, unknown>)>;

type AttachmentMutationDependencies = {
	getUser: typeof getCurrentUser;
	enforceLimit: typeof enforceRateLimit;
	readBody: typeof readJsonBody;
};

const defaultDependencies: AttachmentMutationDependencies = {
	getUser: getCurrentUser,
	enforceLimit: enforceRateLimit,
	readBody: readJsonBody
};

export const createAttachmentMutationAction = (
	options: { rateKey: string; service: MutationService; requirePublicUploads?: boolean },
	overrides: Partial<AttachmentMutationDependencies> = {}
) => {
	const dependencies = { ...defaultDependencies, ...overrides };
	return async ({ request }: { request: Request }) =>
		withAttachmentPrivateResponse(async () => {
			if (request.method.toUpperCase() !== 'POST') {
				return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
			}
			if (!isSameOriginAttachmentRequest(request)) {
				return json({ ok: false, error: 'Cross-origin attachment requests are not allowed' }, { status: 403 });
			}
			const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
			if (mediaType !== 'application/json') {
				return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
			}
			const user = await dependencies.getUser(request);
			if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
			if (user.accountKind !== 'user') {
				return json({ ok: false, error: 'Attachments require a user account' }, { status: 403 });
			}
			// Public file/media uploads are withheld from new accounts until an admin
			// grants them (see auth/users.ts userPublicUploadsEnabled). Gate the
			// START of an upload: nothing is reserved, no MPU is opened, and every
			// downstream part/complete call has no upload id to act on. The already
			// -uploaded lifecycle calls (parts/complete/abort/delete) stay ungated so
			// a permission change mid-upload can't strand a paid-for reservation.
			if (options.requirePublicUploads && !user.publicUploadsEnabled) {
				return json(
					{
						ok: false,
						error: 'Uploads are awaiting admin approval for this account',
						code: 'public_uploads_not_approved'
					},
					{ status: 403 }
				);
			}

			const limit = await dependencies.enforceLimit(request, options.rateKey, `user:${user.id}`, { failClosed: true });
			if (!limit.allowed) {
				if (limit.unavailable) {
					return json({ ok: false, error: 'Attachment service is temporarily unavailable' }, { status: 503 });
				}
				return json({ ok: false, error: 'Too many attachment requests' }, rateLimitedResponseInit(limit));
			}

			const body = await dependencies.readBody(request, ATTACHMENT_JSON_BODY_BYTES);
			const result = await options.service(user.id, body);
			if (result.ok === false) {
				const { status, ...bodyResult } = result;
				return json(bodyResult, { status });
			}
			return json(result);
		});
};

export const attachmentPostOnlyLoader = async () =>
	withAttachmentPrivateResponse(async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } }));
