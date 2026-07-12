import { json, readJsonBody } from '~/api/http';

import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { sendPasswordResetEmail } from '~/api/utils/auth/email';
import { createPasswordReset } from '~/api/utils/auth/passwordResets';
import { findUserByEmail } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;
const RESET_TTL_MINUTES = 60;

// POST /api/v1/auth/password-reset — { email } — request a reset link.
// Always returns ok so account existence can't be probed (mirrors
// resend-verification). The emailed link carries a single-use 1h token.
export const action = async ({ request }: { request: Request }) => {
  // every request can email an arbitrary address — throttle by IP before any
  // work happens (the neutral response would otherwise hide a mail bomb)
  const limit = await enforceRateLimit(request, 'auth.passwordReset', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many reset requests — try again soon 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const origin = new URL(request.url).origin;

  let resetLink: string | undefined;
  if (email) {
    const user = await findUserByEmail(email);
    if (user) {
      const reset = await createPasswordReset({
        userId: String(user._id),
        email,
        expiresInMs: RESET_TTL_MINUTES * 60 * 1000
      });
      const link = `${origin}/reset-password?token=${reset.token}`;
      // Fire-and-forget: awaiting the send would make the "account exists"
      // path measurably slower than the "no account" path (a synchronous SES
      // round-trip), turning the deliberately-neutral response into a timing
      // oracle for account enumeration. Delivery failures are recorded in the
      // email outbox, not surfaced here.
      void sendPasswordResetEmail({ to: email, link, expiresMinutes: RESET_TTL_MINUTES }).catch(() => {});
      // Surface the link only in local + Vercel preview, mirroring the
      // register route's dev verification link.
      if (shouldShowDevVerificationLink()) resetLink = link;
    }
  }

  return json({ ok: true, resetLink });
};
