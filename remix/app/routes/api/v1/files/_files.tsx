import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { cloudFiles } from '~/api/utils/files/files';

export const createFilesHandlers = (deps = { getUser: getCurrentUser, limit: enforceRateLimit, service: cloudFiles }) => {
	const handle = (mutation: boolean) => async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
		if (request.method !== (mutation ? 'POST' : 'GET')) return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
		if (mutation && !isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin file changes are not allowed' }, { status: 403 });
		if (mutation && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ ok: false, error: 'Use application/json' }, { status: 415 });
		const user = await deps.getUser(request);
		if (!user || user.accountKind !== 'user') return json({ ok: false, error: 'A full user session is required' }, { status: 401 });
		const limit = await deps.limit(request, mutation ? 'things.write' : 'attachments.read', `user:${user.id}`, { failClosed: true });
		if (!limit.allowed) return json({ ok: false, error: 'File service is unavailable or rate limited' }, limit.unavailable ? { status: 503 } : rateLimitedResponseInit(limit));
		const url = new URL(request.url);
		const result = mutation ? await deps.service.commit(user.id, await readJsonBody(request, 8192)) : await deps.service.read(user.id, url.searchParams.get('id'), url.searchParams.get('operationId') ?? undefined);
		return result.ok === false ? json({ ok: false, error: result.error }, { status: result.status }) : json(result);
	});
	return { loader: handle(false), action: handle(true) };
};
export const { loader, action } = createFilesHandlers();
