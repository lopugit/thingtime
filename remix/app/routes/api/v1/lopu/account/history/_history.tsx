import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { LOPU_GUEST_CODE, LOPU_GUEST_ERROR } from '~/api/utils/lopu/accessCore';
import { listLopuAccountHistory } from '~/api/utils/lopu/accounting';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/lopu/account/history?cursor&limit — the caller's credit ledger
// newest first (starter / grant / topup / debit / adjust / refund rows and
// top-up requests with their status) plus the usage rows the page's debits
// point at, cursor-paged (limit ≤ 100). Shares the lopu.account bucket.
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export type LopuAccountHistoryHandlerDependencies = {
  getCurrentUser: typeof getCurrentUser;
  enforceRateLimit: typeof enforceRateLimit;
  listHistory: typeof listLopuAccountHistory;
};

export const createLopuAccountHistoryHandlers = (dependencies: LopuAccountHistoryHandlerDependencies) => {
  const loader = async ({ request }: { request: Request }) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET' } });
    }
    const user = await dependencies.getCurrentUser(request);
    if (!user) return json({ ok: false, error: 'Sign in to see your Lopu history' }, { status: 401, headers: NO_STORE_HEADERS });
    if (user.temporary) return json({ ok: false, error: LOPU_GUEST_ERROR, code: LOPU_GUEST_CODE }, { status: 403, headers: NO_STORE_HEADERS });

    const limit = await dependencies.enforceRateLimit(request, 'lopu.account', `user:${user.id}`);
    if (!limit.allowed) {
      const init = rateLimitedResponseInit(limit);
      return json({ ok: false, error: 'Your Lopu history is being read too quickly — try again in a moment 🦄' }, { ...init, headers: { ...init.headers, ...NO_STORE_HEADERS } });
    }

    const params = new URL(request.url).searchParams;
    const result = await dependencies.listHistory(user.id, { cursor: params.get('cursor'), limit: params.get('limit') });
    if (result.ok === false) return json({ ok: false, error: result.error }, { status: result.status, headers: NO_STORE_HEADERS });
    return json(result, { headers: NO_STORE_HEADERS });
  };

  return { loader };
};

const handlers = createLopuAccountHistoryHandlers({ getCurrentUser, enforceRateLimit, listHistory: listLopuAccountHistory });

export const loader = handlers.loader;
export const action = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...NO_STORE_HEADERS, Allow: 'GET' } });
