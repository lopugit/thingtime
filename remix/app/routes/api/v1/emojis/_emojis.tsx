import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { listEmojis, uploadEmoji } from '~/api/utils/messenger/emojis';

// GET /api/v1/emojis?chatId= | ?communityId= | ?ids=a,b,c — the custom emojis
// usable in that context: the community's set plus the caller's personal set
// (members only). With neither param, just the personal set. `ids` resolves
// specific emojis (reaction chips) by their unguessable ids.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const idsParam = params.get('ids');
  const result = await listEmojis(user.id, {
    communityId: params.get('communityId'),
    chatId: params.get('chatId'),
    ids: idsParam ? idsParam.split(',') : undefined
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};

// POST /api/v1/emojis — { name, attachmentId, communityId? } — bind one ready
// custom-emoji S3 attachment. Community scope needs membership; no
// communityId makes it personal. React with it as `custom:<emoji id>`.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const limit = await enforceRateLimit(request, 'emojis.write', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'The emoji forge needs a moment 🌸' }, rateLimitedResponseInit(limit));
  }
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
	const body = await readJsonBody(request, 16 * 1024);
  const result = await uploadEmoji(user.id, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json(result);
};
