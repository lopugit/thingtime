import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { LOPU_GUEST_CODE, LOPU_GUEST_ERROR, lopuUserVerified } from '~/api/utils/lopu/accessCore';
import { ensureLopuAccount, getPendingLopuTopupRequest, lopuTopupUrl, publicLopuAccount } from '~/api/utils/lopu/accounting';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getStoredLopuAccessSettings } from '~/api/utils/settings/lopuAccess';

// GET /api/v1/lopu/account — the caller's Lopu account (design note "Lopu
// verified access, usage accounting and credits" §3): verified status and
// the access rules, the credit balance, this month's and lifetime usage, the
// starter-credit setting, the optional "Buy credits" URL and a pending top-up
// request. Session only; a temporary (guest) session is a 403 with the guest
// code. The account is created lazily (starter credits once) so the very
// first read already shows the starter balance.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export type LopuAccountHandlerDependencies = {
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  getSettings: typeof getStoredLopuAccessSettings;
  ensureAccount: typeof ensureLopuAccount;
  getPendingRequest: typeof getPendingLopuTopupRequest;
  topupUrl: () => string | null;
};

export const createLopuAccountHandlers = (dependencies: LopuAccountHandlerDependencies) => {
  const loader = async ({ request }: { request: Request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET' } });
    }
    const user = await dependencies.getCurrentUser(request);
    if (!user) return json({ ok: false, error: 'Sign in to see your Lopu account' }, { status: 401, headers: NO_STORE_HEADERS });
    if (user.temporary) return json({ ok: false, error: LOPU_GUEST_ERROR, code: LOPU_GUEST_CODE }, { status: 403, headers: NO_STORE_HEADERS });

    const limit = await dependencies.enforceRateLimit(request, 'lopu.account', `user:${user.id}`);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json({ ok: false, error: 'Your Lopu account is being read too quickly — try again in a moment 🦄' }, { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } });
    }

    const [settings, record, pendingRequest] = await Promise.all([dependencies.getSettings(), dependencies.ensureAccount(user.id), dependencies.getPendingRequest(user.id)]);
    const account = publicLopuAccount({ record, userId: user.id, verified: lopuUserVerified(user), settings, pendingRequest, topupUrl: dependencies.topupUrl() });
    return json({ ok: true, account }, { headers: NO_STORE_HEADERS });
  };

  return { loader };
};

const handlers = createLopuAccountHandlers({
  getCurrentUser,
  enforceRateLimit,
  getSettings: getStoredLopuAccessSettings,
  ensureAccount: ensureLopuAccount,
  getPendingRequest: getPendingLopuTopupRequest,
  topupUrl: () => lopuTopupUrl()
});

export const loader = handlers.loader;
export const action = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET' } });
