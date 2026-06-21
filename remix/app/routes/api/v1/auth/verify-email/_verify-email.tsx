import { redirect } from '@vercel/remix';

import { consumeEmailVerification } from '~/api/utils/auth/emailVerifications';
import { markEmailVerified } from '~/api/utils/auth/users';

// GET /api/v1/auth/verify-email?token=... — the link emailed to the user.
// Burns the token, flips emailVerified, and redirects to /login with a status.
export const loader = async ({ request }: { request: Request }) => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return redirect('/login?verify=missing');

  const result = await consumeEmailVerification(token);
  if (!result.ok) return redirect(`/login?verify=${result.reason}`);

  await markEmailVerified(result.userId);
  return redirect('/login?verify=success');
};
