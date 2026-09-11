import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { exportTransferPlan } from '~/api/utils/things/exportTransfer';
import { viewerOf, withFriendIds, withLinkKeys } from '~/api/utils/things/things';

export const action = async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
  const contentTypeError = requireJsonContentType(request);
  if (contentTypeError) return contentTypeError;
  if (!isSameOriginAttachmentRequest(request)) return json({ ok: false, error: 'Cross-origin export is not allowed' }, { status: 403 });
  const user = await getCurrentUser(request);
  const limit = await enforceRateLimit(request, 'webpages.install', user?.id ? `user:${user.id}` : null, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Exports are temporarily rate-limited' }, rateLimitedResponseInit(limit));
  const body = await readJsonBody(request, 160 * 1024);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['ids', 'key', 'includeChildren', 'includeDependencies', 'includeFiles'].includes(key)) || (body.key !== undefined && (typeof body.key !== 'string' || body.key.length > 256))) return json({ ok: false, error: 'Invalid export request' }, { status: 400 });
  const viewer = await withFriendIds(withLinkKeys(viewerOf(user), [body.key || '']));
  const result = await exportTransferPlan(viewer, body, request.signal);
  return json(result, { status: result.ok === false ? result.status : 200 });
});
