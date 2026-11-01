import { json, readJsonBody, requireJsonContentType } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { adminUserRowOf, findUserById, type AdminUserRow } from '~/api/utils/auth/users';
import { creditsToMicros } from '~/api/utils/ai/pricing';
import {
  adminLopuAccountRow,
  getLopuAccount,
  getPendingLopuTopupRequest,
  grantLopuCredits,
  LOPU_ADMIN_CREDIT_ENTRIES,
  LOPU_ADMIN_CREDITS_MAX,
  LOPU_NOTE_MAX_CHARS,
  LOPU_REASON_MAX_CHARS,
  resolveLopuTopupRequest,
  type LopuAdminAccountRow,
  type LopuAdminCreditEntry
} from '~/api/utils/lopu/accounting';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getStoredLopuAccessSettings } from '~/api/utils/settings/lopuAccess';

// POST /api/v1/admin/lopu/credits — the admin side of credits (design note §3):
//
//   { userId, credits (−10000..10000, ≠ 0), entry?: 'grant'|'topup'|'adjust'|'refund', reason?, note? }
//     → grants (grant / topup take a positive amount; adjust / refund may be
//       signed) and answers { ok, account, ledger, request: null }
//   { requestId, credits?, reason? }
//     → approves a pending top-up request (the requested amount unless
//       `credits` overrides it, entry 'topup'), answers { ok, account, ledger, request }
//   { requestId, decline: true, reason? }
//     → declines it (no balance change), answers { ok, account, ledger: null, request }
//
// Admin only, private, JSON-only, admin.lopu.credits fail-closed.
const MAX_BODY_BYTES = 16 * 1024;

export type AdminLopuCreditsHandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  enforceRateLimit: typeof enforceRateLimit;
  getSettings: typeof getStoredLopuAccessSettings;
  grantCredits: typeof grantLopuCredits;
  resolveRequest: typeof resolveLopuTopupRequest;
  getAccount: typeof getLopuAccount;
  getPendingRequest: typeof getPendingLopuTopupRequest;
  findUser: (userId: string) => Promise<AdminUserRow | null>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const creditsOf = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > LOPU_ADMIN_CREDITS_MAX) return null;
  return number;
};

const textOf = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

export const createAdminLopuCreditsHandlers = (dependencies: AdminLopuCreditsHandlerDependencies) => {
  const accountRow = async (userId: string): Promise<LopuAdminAccountRow | null> => {
    const user = await dependencies.findUser(userId);
    if (!user) return null;
    const [settings, record, pendingRequest] = await Promise.all([dependencies.getSettings(), dependencies.getAccount(userId), dependencies.getPendingRequest(userId)]);
    return adminLopuAccountRow({
      user: { id: user.id, username: user.username, displayName: user.displayName, email: user.email, lopuVerified: user.lopuVerified, isAdmin: user.isAdmin },
      record,
      settings,
      pendingRequest
    });
  };

  const action = ({ request }: { request: Request }) =>
    withAdminPrivateResponse(async () => {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
      const gate = await dependencies.requireAdmin(request);
      if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
      const unsupported = requireJsonContentType(request);
      if (unsupported) return unsupported;

      const limit = await dependencies.enforceRateLimit(request, 'admin.lopu.credits', `user:${gate.user.id}`, { failClosed: true });
      if (!limit.allowed) return json({ ok: false, error: 'Credit changes are rate limited — pause for a moment' }, rateLimitedResponseInit(limit));

      const body = await readJsonBody(request, MAX_BODY_BYTES);
      if (!isRecord(body)) return json({ ok: false, error: 'Send { userId, credits } or { requestId }' }, { status: 400 });
      const reason = textOf(body.reason, LOPU_REASON_MAX_CHARS);

      // --- a pending request: approve or decline --------------------------
      if (typeof body.requestId === 'string' && body.requestId.trim()) {
        const decline = body.decline === true;
        let credits: number | null | undefined;
        if (!decline && body.credits !== undefined && body.credits !== null) {
          credits = creditsOf(body.credits);
          if (credits === null || credits <= 0) return json({ ok: false, error: `credits must be a positive number of credits up to ${LOPU_ADMIN_CREDITS_MAX}` }, { status: 400 });
        }
        const resolved = await dependencies.resolveRequest({ requestId: body.requestId.trim(), actorId: gate.user.id, approve: !decline, credits: credits ?? null, reason });
        if (resolved.ok === false) return json({ ok: false, error: resolved.error }, { status: resolved.status });
        const account = await accountRow(resolved.userId);
        return json({ ok: true, account, ledger: resolved.ledger, request: resolved.request });
      }

      // --- a direct grant / adjustment ------------------------------------
      const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
      if (!userId) return json({ ok: false, error: 'userId (or requestId) is required' }, { status: 400 });
      const entry: LopuAdminCreditEntry = body.entry === undefined ? 'grant' : (body.entry as LopuAdminCreditEntry);
      if (!(LOPU_ADMIN_CREDIT_ENTRIES as readonly unknown[]).includes(entry)) {
        return json({ ok: false, error: `entry must be one of ${LOPU_ADMIN_CREDIT_ENTRIES.join(', ')}` }, { status: 400 });
      }
      const credits = creditsOf(body.credits);
      // an amount that rounds to nothing (1e-7 credits) is a bad request, not
      // a 500 from the writer's non-zero guard
      if (credits === null || credits === 0 || creditsToMicros(credits) === 0) {
        return json({ ok: false, error: `credits must be a non-zero number of credits between -${LOPU_ADMIN_CREDITS_MAX} and ${LOPU_ADMIN_CREDITS_MAX}` }, { status: 400 });
      }
      if ((entry === 'grant' || entry === 'topup') && credits < 0) return json({ ok: false, error: `a ${entry} must be a positive amount — use adjust or refund for a signed movement` }, { status: 400 });
      const user = await dependencies.findUser(userId);
      if (!user) return json({ ok: false, error: 'User not found' }, { status: 404 });

      const granted = await dependencies.grantCredits(userId, {
        entry,
        amountMicros: creditsToMicros(credits),
        reason: reason || `${entry} by admin`,
        actorId: gate.user.id,
        note: textOf(body.note, LOPU_NOTE_MAX_CHARS)
      });
      const account = await accountRow(userId);
      return json({
        ok: true,
        account,
        ledger: { id: granted.ledgerId, entry, amountMicros: creditsToMicros(credits), balanceAfterMicros: granted.balanceMicros },
        request: null
      });
    });

  return { action };
};

const handlers = createAdminLopuCreditsHandlers({
  requireAdmin,
  enforceRateLimit,
  getSettings: getStoredLopuAccessSettings,
  grantCredits: grantLopuCredits,
  resolveRequest: resolveLopuTopupRequest,
  getAccount: getLopuAccount,
  getPendingRequest: getPendingLopuTopupRequest,
  findUser: async (userId) => {
    const doc = await findUserById(userId);
    return doc ? adminUserRowOf(doc) : null;
  }
});

export const action = handlers.action;
export const loader = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST' } });
