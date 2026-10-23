import { redirect } from '~/api/http';

import { resolveTrustedOrigin } from '~/api/utils/auth/appOrigin';
import { sendNewUserAdminNotification } from '~/api/utils/auth/email';
import { consumeEmailVerification } from '~/api/utils/auth/emailVerifications';
import { findUserById, markEmailVerified } from '~/api/utils/auth/users';

// GET /api/v1/auth/verify-email?token=... — the link emailed to the user.
// Burns the token, flips emailVerified, and redirects to /login with a status.
//
// Verification NO LONGER grants public file/media uploads: the account keeps
// meta.publicUploads:false from registration until an admin enables it. So this
// is also where the internal "new user" notification goes out — one per burned
// verification token (a resend mints a new token, so a user cannot loop this to
// spam the admin inbox beyond the resend rate limit).
export const loader = async ({ request }: { request: Request }) => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return redirect('/login?verify=missing');

  const result = await consumeEmailVerification(token);
  if (result.ok === false) return redirect(`/login?verify=${result.reason}`);

  await markEmailVerified(result.userId);

  // Fire-and-forget: the account IS verified and committed — an email outage
  // (fail-closed SES, misconfigured provider) must never turn a successful
  // verification into an error page for the user. The permission stays
  // withheld regardless, so a lost notification delays approval, never
  // grants it.
  void (async () => {
    const user = await findUserById(result.userId);
    if (!user || user.accountKind === 'service' || user.meta?.temporary === true) return;
    await sendNewUserAdminNotification({
      username: user.username,
      email: user.email,
      displayName: user.displayName ?? null,
      userId: String(user._id),
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      origin: resolveTrustedOrigin(request)
    });
  })().catch(() => {});

  return redirect('/login?verify=success');
};
