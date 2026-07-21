import { json } from '~/api/http';

import {
  isVercelWebhookEnabled,
  recordVercelWebhookEvent,
  verifyVercelWebhookSignature
} from '~/api/utils/vercel/webhookStatus';

const MAX_BODY_BYTES = 256 * 1024;

// GET /api/v1/vercel/webhook — deliveries are POST-only; keep parity with the
// other status endpoints by answering rather than falling through the dispatcher.
export const loader = async () => {
  if (!isVercelWebhookEnabled()) {
    throw new Response('Not found', { status: 404 });
  }
  return json({ ok: false, error: 'Vercel webhook deliveries must be POSTed' }, { status: 405 });
};

// POST /api/v1/vercel/webhook — Vercel deployment lifecycle events
// (created/succeeded/ready/promoted/error/canceled). The raw body is verified
// against VERCEL_WEBHOOK_SECRET (x-vercel-signature, HMAC-SHA1) BEFORE any
// parsing, so unsigned traffic costs one HMAC and no DB work. Disabled (404)
// entirely until the secret is configured. Unknown event types acknowledge
// with 200 so Vercel doesn't retry them forever.
export const action = async ({ request }: { request: Request }) => {
  if (!isVercelWebhookEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Payload too large' }, { status: 413 });
  }

  if (!verifyVercelWebhookSignature(rawBody, request.headers.get('x-vercel-signature'))) {
    return json({ ok: false, error: 'Invalid webhook signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  const result = await recordVercelWebhookEvent(payload);
  return json({ ok: true, ...result });
};
