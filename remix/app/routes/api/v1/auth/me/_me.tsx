import { json } from '@vercel/remix';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';

// GET /api/v1/auth/me — returns the current user (or null) for the request's
// auth cookie / Bearer token.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  return json({ user });
};
