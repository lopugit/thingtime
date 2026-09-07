import { json, readJsonBody, requireJsonContentType } from '~/api/http';

import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { adminNotificationEmail } from '~/api/utils/auth/email';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { sendEmail } from '~/api/utils/email/service';
import { LOPU_GUEST_CODE, LOPU_GUEST_ERROR } from '~/api/utils/lopu/accessCore';
import { createLopuTopupRequest, LOPU_TOPUP_MAX_CREDITS, LOPU_TOPUP_MIN_CREDITS, type LopuCreditRowPublic } from '~/api/utils/lopu/accounting';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// POST /api/v1/lopu/account/topup-request — { credits (0.5..1000), note? }
// asks an admin for credits (design note §3): one pending request per
// account (409 while one waits), written as a `lopu-credit` row with
// entry 'request' / requestStatus 'pending' that an admin approves or
// declines through POST /api/v1/admin/lopu/credits. Admins are told through
// the same ops-mail boundary the "new user" notification uses (best effort —
// the request stands even when mail is down). Session only, JSON-only
// (415, the CSRF fence, before the rate limit), guest sessions 403,
// lopu.account.write fail-closed.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 16 * 1024;

const htmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Ops mail: a user asked for Lopu credits. Sent to the admin inbox
// (THINGTIME_ADMIN_NOTIFICATION_EMAIL), never to the user.
export const renderLopuTopupRequestEmail = (input: { username: string; userId: string; credits: number; note: string | null; adminUrl: string }) => {
  const rows: Array<[string, string]> = [
    ['Username', `@${input.username}`],
    ['User id', input.userId],
    ['Credits requested', String(input.credits)],
    ['Note', input.note || '—']
  ];
  return {
    subject: `Lopu credit request: @${input.username} asks for ${input.credits} credit${input.credits === 1 ? '' : 's'}`,
    text: ['A user asked for Lopu credits and is waiting for an admin to approve or decline the request.', '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `Review it under Admin → Lopu accounts: ${input.adminUrl}`].join('\n'),
    html:
      '<p>A user asked for <strong>Lopu credits</strong> and is waiting for an admin to approve or decline the request.</p>' +
      `<table cellpadding="4" style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td><strong>${htmlEscape(label)}</strong></td><td>${htmlEscape(value)}</td></tr>`).join('')}</table>` +
      `<p><a href="${htmlEscape(input.adminUrl)}">Open Admin → Lopu accounts</a> to approve or decline it.</p>`
  };
};

export type LopuTopupRequestHandlerDependencies = {
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  createRequest: typeof createLopuTopupRequest;
  notifyAdmins: (input: { username: string; userId: string; request: LopuCreditRowPublic; origin: string }) => Promise<void>;
  log?: (message: string, error?: unknown) => void;
};

export const createLopuTopupRequestHandlers = (dependencies: LopuTopupRequestHandlerDependencies) => {
  const log = dependencies.log ?? ((message: string, error?: unknown) => console.error(message, error));

  const action = async ({ request }: { request: Request }) => {
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'POST' } });
    const user = await dependencies.getCurrentUser(request);
    if (!user) return json({ ok: false, error: 'Sign in to ask for Lopu credits' }, { status: 401, headers: NO_STORE_HEADERS });
    if (user.temporary) return json({ ok: false, error: LOPU_GUEST_ERROR, code: LOPU_GUEST_CODE }, { status: 403, headers: NO_STORE_HEADERS });
    const unsupported = requireJsonContentType(request);
    if (unsupported) return unsupported;

    const limit = await dependencies.enforceRateLimit(request, 'lopu.account.write', `user:${user.id}`, { failClosed: true });
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json(
        { ok: false, error: limit.unavailable ? 'Lopu cannot check its rate limit right now — try again shortly' : 'You have asked for credits a few times already — an admin will get to it 🦄' },
        { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } }
      );
    }

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const credits = body && typeof body === 'object' && !Array.isArray(body) ? body.credits : undefined;
    const note = body && typeof body === 'object' && !Array.isArray(body) ? body.note : undefined;
    if (credits === undefined) {
      return json({ ok: false, error: `Send { credits } — a number between ${LOPU_TOPUP_MIN_CREDITS} and ${LOPU_TOPUP_MAX_CREDITS}` }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const result = await dependencies.createRequest(user.id, { credits, note });
    if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status, headers: NO_STORE_HEADERS });

    try {
      // the admin link never comes from the request Host: same rule as every
      // other ops/auth mail (api/utils/auth/appOrigin.ts)
      await dependencies.notifyAdmins({ username: user.username, userId: user.id, request: result.request, origin: resolveTrustedOrigin(request) });
    } catch (error) {
      log('[lopu] top-up request admin notification failed (the request is saved)', error);
    }
    return json({ ok: true, request: result.request }, { headers: NO_STORE_HEADERS });
  };

  return { action };
};

const handlers = createLopuTopupRequestHandlers({
  getCurrentUser,
  enforceRateLimit,
  createRequest: createLopuTopupRequest,
  notifyAdmins: async ({ username, userId, request, origin }) => {
    // `origin` is already the trusted origin (APP_URL → the platform → the
    // canonical domain), never the caller's Host header
    const rendered = renderLopuTopupRequestEmail({ username, userId, credits: request.amountCredits, note: request.note, adminUrl: `${origin.replace(/\/+$/, '')}/admin` });
    await sendEmail({
      to: adminNotificationEmail(),
      stream: 'transactional',
      templateKey: 'admin.lopu_topup_request',
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      metadata: { purpose: 'admin_lopu_topup_request', userId, username, requestId: request.id },
      tags: { stream: 'transactional', template: 'admin.lopu_topup_request' }
    });
  }
});

export const action = handlers.action;
export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'POST' } });
