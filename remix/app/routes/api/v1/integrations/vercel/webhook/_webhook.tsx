import { createHash } from 'node:crypto';

import { json } from '~/api/http';
import { refreshAdminPrPreviewPublicationForDeployment } from '~/api/utils/ciControl/adminPreviewDeployments';
import { adminPreviewSnapshotUrl } from '~/api/utils/ciControl/adminPreviewPublicationCore';
import { isCiPreviewEnvironment } from '~/api/utils/ciControl/previewPolicyCore';
import { ingestVercelWebhook, verifyVercelWebhookSignature } from '~/api/utils/ciControl/webhooks';

const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

export const action = async ({ request }: { request: Request }) => {
  const secret = process.env.THINGTIME_VERCEL_WEBHOOK_SECRET ?? '';
  if (!secret) return json({ ok: false, error: 'Vercel webhook integration is not configured' }, { status: 503 });
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) return json({ ok: false, error: 'Webhook payload is too large' }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
    return json({ ok: false, error: 'Webhook payload is too large' }, { status: 413 });
  }
  if (!verifyVercelWebhookSignature(rawBody, request.headers.get('x-vercel-signature'), secret)) {
    return json({ ok: false, error: 'Invalid webhook signature' }, { status: 403 });
  }
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid webhook payload' }, { status: 400 });
  }
  const eventType = typeof payload?.type === 'string' ? payload.type : 'deployment.unknown';
  // Vercel does not document a webhook-delivery id equivalent to GitHub's.
  // Hash the signed raw payload so an exact retry is idempotent while a later
  // status update for the same deployment still becomes a distinct event.
  const deliveryId = `vercel:${createHash('sha256').update(rawBody, 'utf8').digest('hex')}`;
  const result = await ingestVercelWebhook({ eventType, deliveryId, payload });
  const data = payload?.payload ?? payload?.data ?? payload;
  const deployment = data?.deployment ?? data;
  const meta = deployment?.meta ?? data?.meta ?? {};
  const prNumber = Number(meta.githubPrId);
  const environment = String(meta.thingtimePreviewEnvironment ?? '');
  const sha = String(meta.githubCommitSha ?? '');
  const status = String(deployment?.readyState ?? deployment?.state ?? eventType.split('.').pop() ?? '').toLowerCase();
  const deploymentId = String(deployment?.id ?? data?.id ?? '');
  if (
    result.accepted &&
    meta.thingtimeAdminPrPreview === '1' &&
    Number.isSafeInteger(prNumber) &&
    prNumber > 0 &&
    isCiPreviewEnvironment(environment) &&
    /^dpl_[A-Za-z0-9]+$/.test(deploymentId) &&
    /^[0-9a-f]{40}$/.test(sha) &&
    ['ready', 'error', 'failed', 'canceled', 'cancelled'].includes(status)
  ) {
    await refreshAdminPrPreviewPublicationForDeployment({
      prNumber,
      environment,
      deploymentId,
      sha,
      status,
      snapshotUrl: adminPreviewSnapshotUrl(deployment?.url ?? data?.url)
    });
  }
  return json({ ok: true, ...result }, { status: result.accepted ? 202 : 200 });
};
