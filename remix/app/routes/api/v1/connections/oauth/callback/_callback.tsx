import { redirect as httpRedirect } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { completeOAuth, requestOrigin, oauthSessionBinding } from '~/api/utils/connections/oauth';
import { enforceRateLimit } from '~/api/utils/rateLimit/enforce';

const redirect = (url: string) => httpRedirect(url, { headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });

// GET /api/v1/connections/oauth/callback — the provider returns here after
// its sign-in. The code is exchanged server-side, the token response is
// sealed into the external account's secure blob, and the browser lands back
// on /connections with a success or error flag (never any token material).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user || user.accountKind === 'service') {
    return redirect('/login');
  }

  // Every other endpoint in this family carries a bucket; this one leaves our
  // infrastructure hardest. One hit runs a token exchange AND a profile read
  // against the provider, on the deployment's shared client credentials — and
  // one-use state stops replay and this rate limit also bounds fresh attempts
  // that could otherwise generate outbound requests to a third party's token endpoint,
  // attributable to this deployment's client id. `connections.provider` is the
  // bucket the config already defines for exactly this ("calls that leave our
  // infrastructure for a provider API"); a real link needs ONE callback, so
  // 20/min is invisible to the actual flow. Redirect (not JSON) on refusal:
  // this route is a browser landing, and /connections turns oauthError into a
  // Lopu toast — same shape as the failure path below.
  const limit = await enforceRateLimit(request, 'connections.provider', `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    return redirect('/connections?oauthError=rateLimited');
  }

  const url = new URL(request.url);
  const result = await completeOAuth(
    { ...user, sessionBinding: (await oauthSessionBinding(request)) || undefined },
    {
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state'),
      error: url.searchParams.get('error'),
      errorDescription: url.searchParams.get('error_description')
    },
    requestOrigin(request)
  );
  // A CODE, never the message. Everything this redirect carries is text the
  // page renders inside Thingtime's own toast, and this route is a GET a
  // stranger can send a signed-in victim to — so prose here is prose they
  // chose. `result.provider` is safe for the opposite reason: it is a provider
  // id off our static catalogue, not anything off the request.
  if (result.ok === false) {
    return redirect(`/connections?oauthError=${result.oauthCode || 'failed'}`);
  }
  return redirect(`/connections?connected=${encodeURIComponent(result.provider)}`);
};
