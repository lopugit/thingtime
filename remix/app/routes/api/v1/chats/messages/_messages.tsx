import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listMessages, sendMessage } from '~/api/utils/messenger/messenger';

// GET /api/v1/chats/messages?chatId=&cursor=&limit=&threadRootId= — one page
// of messages (newest first) with reactions, thread counts, quoted replies,
// referenced custom emojis, the member list and the caller's membership — one
// round trip renders a chat. threadRootId scopes the page to a Slack-style
// thread and includes the root as threadRoot.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const result = await listMessages(user.id, {
    chatId: params.get('chatId'),
    cursor: params.get('cursor'),
    limit: params.get('limit'),
    threadRootId: params.get('threadRootId')
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/chats/messages —
// { chatId, text?, threadRootId?, replyToId?, requestId?, attachmentIds? }.
// Replying to a pending message request accepts it. Sending marks the chat
// read up to your own message.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'chats.message', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Easy there, speed-typer 🌸' }, rateLimitedResponseInit(limit));
  }
  const body = await readJsonBody(request, 64 * 1024);
	if (Array.isArray(body?.attachmentIds) && body.attachmentIds.length) {
		if (user.accountKind !== 'user') {
			return json({ ok: false, error: 'Attachments require a user account' }, { status: 403 });
		}
		if (!isSameOriginAttachmentRequest(request)) {
			return json({ ok: false, error: 'Cross-origin attachment requests are not allowed' }, { status: 403 });
		}
		const mediaType = request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
		if (mediaType !== 'application/json') {
			return json({ ok: false, error: 'Content-Type must be application/json' }, { status: 415 });
		}
	}
  const result = await sendMessage(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
