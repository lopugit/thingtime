import { redirect } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { completeOAuth, requestOrigin } from '~/api/utils/connections/oauth';
import { enforceRateLimit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/connections/oauth/callback — the provider returns here after
// its sign-in. The code is exchanged server-side, the token response is
// sealed into the external account's secure blob, and the browser lands back
// on /connections with a success or error flag (never any token material).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return redirect('/login');
  }

  // Every other endpoint in this family carries a bucket; this one leaves our
  // infrastructure hardest. One hit runs a token exchange AND a profile read
  // against the provider, on the deployment's shared client credentials — and
  // the state is a 15-minute signed JWT with no server-side burn, so its owner
  // can replay their own callback as fast as they can issue requests. That is
  // unbounded outbound POST volume aimed at a third party's token endpoint,
  // attributable to this deployment's client id. `connections.provider` is the
  // bucket the config already defines for exactly this ("calls that leave our
  // infrastructure for a provider API"); a real link needs ONE callback, so
  // 20/min is invisible to the actual flow. Redirect (not JSON) on refusal:
  // this route is a browser landing, and /connections renders oauthError as a
  // Lopu toast — same shape as the failure path below.
  const limit = await enforceRateLimit(request, 'connections.provider', `user:${user.id}`);
  if (!limit.allowed) {
    return redirect(
      `/connections?oauthError=${encodeURIComponent('Finishing sign-ins very enthusiastically — take a breather and try connecting again 🌸')}`
    );
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
