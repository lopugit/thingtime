import { redirect } from '~/api/http';

import { consumeEmailVerification } from '~/api/utils/auth/emailVerifications';
import { findUserById, markEmailVerified } from '~/api/utils/auth/users';

// GET /api/v1/auth/verify-email?token=... — the link emailed to the user.
// Burns the token, flips emailVerified, and lands on the /verify-email result
// page: state=success | already | used | expired | invalid | missing.
// Expired links carry the email so the page can offer a one-click resend.
export const loader = async ({ request }: { request: Request }) => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return redirect('/verify-email?state=missing');

  const result = await consumeEmailVerification(token);
  if (result.ok === false) {
    const email =
      result.reason === 'expired' && result.email ? `&email=${encodeURIComponent(result.email)}` : '';
    return redirect(`/verify-email?state=${result.reason}${email}`);
  }

  // A fresh token clicked by an already-verified account reads better as
  // "already verified" than a second thank-you.
  const user = await findUserById(result.userId);
  if (user?.emailVerified) return redirect('/verify-email?state=already');

  await markEmailVerified(result.userId);
  return redirect('/verify-email?state=success');
};
