import { json } from '~/api/http';
import { ingestGitHubWebhook, verifyGitHubWebhookSignature } from '~/api/utils/ciControl/webhooks';
import { syncAdminPrPreviewsForPullRequest } from '~/api/utils/ciControl/adminPreviewDeployments';

const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export const action = async ({ request }: { request: Request }) => {
  const secret = process.env.THINGTIME_GITHUB_WEBHOOK_SECRET ?? '';
  if (!secret) return json({ ok: false, error: 'GitHub webhook integration is not configured' }, { status: 503 });
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) return json({ ok: false, error: 'Webhook payload is too large' }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
    return json({ ok: false, error: 'Webhook payload is too large' }, { status: 413 });
  }
  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'), secret)) {
    return json({ ok: false, error: 'Invalid webhook signature' }, { status: 403 });
  }
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid webhook payload' }, { status: 400 });
  }
  const eventType = request.headers.get('x-github-event') ?? '';
  const deliveryId = request.headers.get('x-github-delivery') ?? '';
  if (!eventType || !deliveryId) return json({ ok: false, error: 'Missing GitHub delivery headers' }, { status: 400 });
  const result = await ingestGitHubWebhook({ eventType, deliveryId, payload });
  if (result.accepted && eventType === 'pull_request' && Number.isSafeInteger(Number(payload?.number))) {
    await syncAdminPrPreviewsForPullRequest(Number(payload.number), String(payload?.action ?? '')).catch(() => undefined);
  }
  return json({ ok: true, ...result }, { status: result.accepted ? 202 : 200 });
};
