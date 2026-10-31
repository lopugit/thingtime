import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { recordNotificationMessage } from '~/api/utils/notifications/recordMessage';

export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const limit = await enforceRateLimit(request, 'notifications.record', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Notification history is busy — retry shortly' }, rateLimitedResponseInit(limit));
  const result = await recordNotificationMessage(user.id, await readJsonBody(request, 64 * 1024));
  return json(result, { status: result.ok ? 200 : result.status });
};
