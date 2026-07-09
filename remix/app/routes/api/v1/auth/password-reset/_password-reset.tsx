import { json, readJsonBody } from '~/api/http';

import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { sendPasswordResetEmail } from '~/api/utils/auth/email';
import { createPasswordReset } from '~/api/utils/auth/passwordResets';
import { findUserByEmail } from '~/api/utils/auth/users';

const MAX_BODY_BYTES = 16 * 1024;
const RESET_TTL_MINUTES = 60;

// POST /api/v1/auth/password-reset — { email } — request a reset link.
// Always returns ok so account existence can't be probed (mirrors
// resend-verification). The emailed link carries a single-use 1h token.
export const action = async ({ request }: { request: Request }) => {
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
      await sendPasswordResetEmail({ to: email, link, expiresMinutes: RESET_TTL_MINUTES });
      // Surface the link only in local + Vercel preview, mirroring the
      // register route's dev verification link.
      if (shouldShowDevVerificationLink()) resetLink = link;
    }
  }

  return json({ ok: true, resetLink });
};
