import { json, readJsonBody } from '~/api/http';

import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { sendVerificationEmail } from '~/api/utils/auth/email';
import { createEmailVerification } from '~/api/utils/auth/emailVerifications';
import { findUserByEmail } from '~/api/utils/auth/users';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/auth/resend-verification — { email }
// Always responds ok (don't leak which emails exist). Only sends if the email
// belongs to an existing, still-unverified user.
export const action = async ({ request }: { request: Request }) => {
  // Every request emails an arbitrary address + writes a verification token and
  // an outbox row — throttle by IP before any work (the neutral response would
  // otherwise hide a mail bomb), mirroring the password-reset route.
  const limit = await enforceRateLimit(request, 'auth.resendVerification', null);
  if (!limit.allowed) {
    return json(
      { ok: false, error: 'Too many verification requests — try again soon 🌸' },
      rateLimitedResponseInit(limit)
    );
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const email = typeof body?.email === 'string' ? body.email : '';
  const showLink = shouldShowDevVerificationLink();

  if (email) {
    const user = await findUserByEmail(String(email));
    if (user && !user.emailVerified) {
      const verification = await createEmailVerification({ userId: String(user._id), email: user.email });
      const link = `${resolveTrustedOrigin(request)}/api/v1/auth/verify-email?token=${verification.token}`;
      // Fire-and-forget so a send failure can't turn the neutral response into
      // a 500 (which would leak that this email belongs to an unverified user).
      void sendVerificationEmail({ to: user.email, link }).catch(() => {});
      if (showLink) return json({ ok: true, verificationLink: link });
    }
  }

  return json({ ok: true });
};
