import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteLopuChat } from '~/api/utils/messenger/lopuChats';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { chatWriteLimitError, requireJsonContentType } from '../_chats';

// POST /api/v1/lopu/chats/delete — { chatId }. Owner only: removes the chat,
// its membership, every message and their reactions in one accounted
// transaction (bound attachments release their objects first).
export const action = async ({ request }: { request: Request }) => {
	const user = await getCurrentUser(request);
	if (!user) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}
	const limit = await enforceRateLimit(request, 'lopu.chats.write', `user:${user.id}`, { failClosed: true });
	if (!limit.allowed) {
		return json({ ok: false, error: chatWriteLimitError(limit) }, rateLimitedResponseInit(limit));
	}
	const unsupported = requireJsonContentType(request);
	if (unsupported) return unsupported;
	const body = await readJsonBody(request, 16 * 1024);
	const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
	const result = await deleteLopuChat(user.id, input.chatId);
	if (result.ok === false) {
		return json({ ok: false, error: result.error }, { status: result.status });
	}
	return json(result);
};
