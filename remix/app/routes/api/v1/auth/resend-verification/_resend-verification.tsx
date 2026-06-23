import { json } from '@vercel/remix';

import { shouldShowDevVerificationLink } from '~/api/utils/auth/devVerification';
import { sendVerificationEmail } from '~/api/utils/auth/email';
import { createEmailVerification } from '~/api/utils/auth/emailVerifications';
import { findUserByEmail } from '~/api/utils/auth/users';

// POST /api/v1/auth/resend-verification — { email }
// Always responds ok (don't leak which emails exist). Only sends if the email
// belongs to an existing, still-unverified user.
export const action = async ({ request }: { request: Request }) => {
  const { email } = await request.json().catch(() => ({}));
  const showLink = shouldShowDevVerificationLink();

  if (email) {
    const user = await findUserByEmail(String(email));
    if (user && !user.emailVerified) {
      const verification = await createEmailVerification({ userId: String(user._id), email: user.email });
      const link = `${new URL(request.url).origin}/api/v1/auth/verify-email?token=${verification.token}`;
      await sendVerificationEmail({ to: user.email, link });
      if (showLink) return json({ ok: true, verificationLink: link });
    }
  }

  return json({ ok: true });
};
