import { json } from '~/api/http';

import { setUserNotificationPrefs } from '~/api/utils/auth/users';
import { verifyEmailUnsubscribeToken } from '~/api/utils/notifications/emails';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/notifications/email/unsubscribe?uid=…&token=… — the one-click
// link in every notification email footer. No session needed (email clients
// don't carry cookies): the token is an HMAC over the recipient's user id, so
// the link only ever flips ITS OWN user's email master off. Idempotent — a
// second click lands on the same confirmation. Responds with a tiny HTML page
// (a human clicked a link in their inbox, not an API client).

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${title}</title></head>` +
      `<body style="margin:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#fafafa;color:#16161a;` +
      `display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box">` +
      `<div style="max-width:420px;text-align:center;background:#fff;border:1px solid #ececef;border-radius:16px;padding:32px 28px">${body}</div>` +
      `</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

export const loader = async ({ request }: { request: Request }) => {
  const limit = await enforceRateLimit(request, 'notifications.emailUnsubscribe', null);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Too many requests — try again shortly' }, rateLimitedResponseInit(limit));
  }

  const url = new URL(request.url);
  const uid = url.searchParams.get('uid') || '';
  const token = url.searchParams.get('token') || '';
  if (!uid || !token || !verifyEmailUnsubscribeToken(uid, token)) {
    return page(
      'Link not recognised',
      `<h1 style="font-size:20px;margin:0 0 8px">That link didn’t work 😔</h1>` +
        `<p style="font-size:14px;color:#5a5a66;margin:0">This unsubscribe link is invalid or incomplete. ` +
        `You can manage notification emails any time from <a href="/settings" style="color:#16161a">Settings → Notifications</a>.</p>`,
      400
    );
  }

  await setUserNotificationPrefs(uid, { masters: { email: false } });
  return page(
    'Unsubscribed',
    `<h1 style="font-size:20px;margin:0 0 8px">You’re unsubscribed 💌</h1>` +
      `<p style="font-size:14px;color:#5a5a66;margin:0 0 16px">Thingtime won’t send you notification emails anymore. ` +
      `Changed your mind? Flip the email master switch back on in ` +
      `<a href="/settings" style="color:#16161a">Settings → Notifications</a>.</p>`
  );
};
