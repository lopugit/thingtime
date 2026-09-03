import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { createLopuChat, listLopuChats } from '~/api/utils/messenger/lopuChats';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const objectBody = (body: unknown): Record<string, unknown> => (body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {});

// Cookie-authenticated mutations only accept JSON bodies: a cross-origin form
// cannot send application/json without a preflight, so the header doubles as
// the CSRF fence (the messenger attachment path applies the same rule).
export const requireJsonContentType = (request: Request): Response | null => {
	const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
	return mediaType === 'application/json' ? null : json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
};

// GET /api/v1/lopu/chats?limit= — the caller's Lopu conversations, newest
// activity first, in the same list-entry shape as /api/v1/chats (unread count,
// lastMessage preview, membership) so the messenger sidebar and the Lopu
// page render them from one projection.
export const loader = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}
	const limit = await enforceRateLimit(request, 'lopu.chats', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
	}
	const params = new URL(request.url).searchParams;
	const result = await listLopuChats(user.id, { limit: params.get('limit') });
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};

// POST /api/v1/lopu/chats — { title?, model?, effort?, speed? } creates a new
// conversation with Lopu (a one-member messenger group discriminated by
// externalSource.access === 'lopu'). Settings are validated against the model
// catalog; null/omitted fields mean "catalog default".
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}
	const limit = await enforceRateLimit(request, 'lopu.chats.write', `user:${user.id}`);
	if (!limit.allowed) {
		return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
	}
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const body = objectBody(await readJsonBody(request, 16 * 1024));
	const result = await createLopuChat(user.id, body);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};
