import { redirect } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { completeOAuth, requestOrigin } from '~/api/utils/connections/oauth';

// GET /api/v1/connections/oauth/callback — the provider returns here after
// its sign-in. The code is exchanged server-side, the token response is
// sealed into the external account's secure blob, and the browser lands back
// on /connections with a success or error flag (never any token material).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return redirect('/login');
  }
  const url = new URL(request.url);
  const result = await completeOAuth(
    user,
    {
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
      error: url.searchParams.get('error'),
      errorDescription: url.searchParams.get('error_description')
    },
    requestOrigin(request)
  );
  if (result.ok === false) {
    return redirect(`/connections?oauthError=${encodeURIComponent(result.error.slice(0, 200))}`);
  }
  return redirect(`/connections?connected=${encodeURIComponent(result.provider)}`);
};
