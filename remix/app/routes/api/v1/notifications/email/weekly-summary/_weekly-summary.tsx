import { json, readJsonBody } from '~/api/http';

import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { sendWeeklySummaryEmails } from '~/api/utils/notifications/weeklySummary';

// /api/v1/notifications/email/weekly-summary — kick off the weekly digest run.
// Two callers: the Vercel cron (GET, Authorization: Bearer <CRON_SECRET> —
// Vercel attaches it automatically when the env var exists) and a signed-in
// admin (GET or POST; POST accepts { dryRun: true } to preview counts without
// sending). The run itself is idempotent (six-day per-recipient lookback), so
// a retried cron or an admin run after the cron never double-sends.

const hasCronSecret = (request: Request) => {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${secret}`;
};

const authorize = async (request: Request) => {
  if (hasCronSecret(request)) return { ok: true as const };
  const gate = await requireAdmin(request);
  if ('error' in gate) return { ok: false as const, status: gate.error.status, error: gate.error.message };
  return { ok: true as const };
};

export const loader = async ({ request }: { request: Request }) => {
  const auth = await authorize(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') === '1' || url.searchParams.get('dryRun') === 'true';
  return json(await sendWeeklySummaryEmails({ dryRun }));
};

export const action = async ({ request }: { request: Request }) => {
  const auth = await authorize(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await readJsonBody(request, 16 * 1024);
  return json(await sendWeeklySummaryEmails({ dryRun: body?.dryRun === true }));
};
