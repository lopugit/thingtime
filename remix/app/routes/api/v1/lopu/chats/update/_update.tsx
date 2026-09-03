import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateLopuChat } from '~/api/utils/messenger/lopuChats';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { requireJsonContentType } from '../_chats';

// POST /api/v1/lopu/chats/update — { chatId, title?, model?, effort?, speed? }.
// Renames the conversation and/or retunes its model settings (validated
// against the catalog; null resets a field to the catalog default). Unlike
// /api/v1/chats/update no system message is inserted.
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
	const body = await readJsonBody(request, 16 * 1024);
	const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
	const result = await updateLopuChat(user.id, input.chatId, input);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};
