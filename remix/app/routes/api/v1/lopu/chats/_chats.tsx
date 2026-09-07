import { json, readJsonBody, requireJsonContentType } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { assertLopuAccess, LOPU_GUEST_CODE, LOPU_GUEST_ERROR, lopuAccessResponse, resolveLopuBilling } from '~/api/utils/lopu/access';
import { hasLopuChatProviderConfigured, lopuChatProviderMode } from '~/api/utils/lopu/chat';
import { createLopuChat, listLopuChats } from '~/api/utils/messenger/lopuChats';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const objectBody = (body: unknown): Record<string, unknown> =>
	body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

// The JSON-only CSRF fence lives in api/http.ts now (every Lopu POST applies
// it); re-exported so the sibling routes keep their import.
export { requireJsonContentType };

// Chat writes fail CLOSED on a limiter outage: an unthrottled client could
// otherwise create MAX_LOPU_CHATS_PER_USER conversations in one go.
export const chatWriteLimitError = (limit: { unavailable?: boolean }): string =>
	limit.unavailable ? 'Lopu cannot check its rate limit right now — try again shortly' : 'Slow down a little 🌸';

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

// POST /api/v1/lopu/chats — { chatId?, title?, providerId?, model?, effort?, speed? } creates a new
// conversation with Lopu (a one-member messenger group discriminated by
// externalSource.access === 'lopu'). Settings are validated against the model
// catalog or the selected owner-only Secure Vault provider template.
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}
	// a temporary (guest) session never starts a conversation — the same wall
	// the reply, voice and vault routes hold (verified-access design note §1)
	if (user.temporary) return json({ ok: false, error: LOPU_GUEST_ERROR, code: LOPU_GUEST_CODE }, { status: 403 });
	const limit = await enforceRateLimit(request, 'lopu.chats.write', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		return json({ ok: false, error: chatWriteLimitError(limit) }, rateLimitedResponseInit(limit));
	}
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const body = objectBody(await readJsonBody(request, 16 * 1024));
	// the access gate: verified access, and credits when the conversation
	// will run on Thingtime's keys (a pinned vault provider bills the viewer)
	const billing = resolveLopuBilling({
		vault: typeof body.providerId === 'string' && body.providerId.trim().length > 0,
		mode: lopuChatProviderMode(),
		configured: hasLopuChatProviderConfigured()
	});
	const access = await assertLopuAccess(user, { billing });
	if (access.ok === false) return lopuAccessResponse(access);
	const result = await createLopuChat(user.id, body);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};
