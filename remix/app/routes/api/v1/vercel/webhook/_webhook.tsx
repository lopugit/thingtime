import { json } from '~/api/http';

import { isVercelWebhookConfigured, recordVercelWebhookEvent, verifyVercelSignature } from '~/api/utils/vercel/webhookStore';

const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/vercel/webhook — receiver for Vercel deployment lifecycle
// events (deployment.created / succeeded / ready / error / canceled).
//
// Auth model: HMAC — Vercel signs the raw body with the webhook secret in
// x-vercel-signature (sha1 hex). 404 when VERCEL_WEBHOOK_SECRET is unset (the
// feature is off, don't advertise the route), 401 on a bad/missing signature.
// The signature covers the RAW body, so the body is read as text before any
// JSON parsing. Untracked event types are 200-acked so Vercel doesn't retry.
export const action = async ({ request }: { request: Request }) => {
  if (!isVercelWebhookConfigured()) {
    throw new Response('Not found', { status: 404 });
  }

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Request body too large' }, { status: 413 });
  }

  const rawBody = await request.text().catch(() => '');
  // byte length, not String#length — a body of multi-byte UTF-8 would slip past
  // a code-unit cap (matches the integrations receiver's check)
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Request body too large' }, { status: 413 });
  }

  if (!verifyVercelSignature(rawBody, request.headers.get('x-vercel-signature'))) {
    return json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let envelope: any;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const recorded = await recordVercelWebhookEvent(envelope);
  return json({ ok: true, tracked: Boolean(recorded), state: recorded?.state, branch: recorded?.branch });
};
