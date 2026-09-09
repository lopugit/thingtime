import { randomUUID } from 'node:crypto';
import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest } from '~/api/utils/attachments/attachmentResponses';
import { enforceSubscriptionRateLimit } from '~/api/utils/rateLimit/subscription';
import { notificationTestInput } from '~/api/utils/notifications/testNotificationsCore';
import { emitSystemNotificationOnce } from '~/api/utils/notifications/notifications';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';

const headers = { 'Cache-Control': 'private, no-store', Pragma: 'no-cache' };
export const action = async ({ request }: { request: Request }) => {
	if (request.method !== 'POST') return json({ ok: false }, { status: 405, headers });
	if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, { status: 403, headers });
	const unsupported = requireJsonContentType(request); if (unsupported) return unsupported;
	const user = await getCurrentUser(request);
	if (!user || user.temporary || user.accountKind !== 'user') return json({ ok: false, error: 'Sign in to test your notifications.' }, { status: 401, headers });
	const limit = await enforceSubscriptionRateLimit(request, 'lopu.recordings', user.id);
	if (!limit.allowed) return json({ ok: false, error: 'Please wait and retry.' }, { status: limit.unavailable ? 503 : 429, headers });
	try {
		const input = notificationTestInput(await readJsonBody(request, 2048));
		const id = `lopu-recording-notification-test-${randomUUID()}`;
		const saved = await runWithMongoEndpoint(null, () => emitSystemNotificationOnce({ ...input, skipEmail: true, recipientId: user.id, href: '/notifications' }, id, async () => true));
		return json({ ok: true, saved, id: saved ? id : null, message: saved ? 'Test saved in your notification history. Device push delivery is best-effort; check your Watch.' : 'This notification is muted by your notification preferences.' }, { headers });
	} catch (error) { return json({ ok: false, error: error instanceof TypeError ? error.message : 'The notification could not be saved.' }, { status: error instanceof TypeError ? 400 : 503, headers }); }
};
export const loader = async () => json({ ok: false }, { status: 405, headers });
