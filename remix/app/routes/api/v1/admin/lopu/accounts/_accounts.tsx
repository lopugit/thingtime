import { json } from '~/api/http';

import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { adminUserRowOf, findUsersByIds, searchUsersForAdmin, type AdminUserRow } from '~/api/utils/auth/users';
import {
  adminLopuAccountRow,
  LOPU_ADMIN_ACCOUNTS_DEFAULT_LIMIT,
  LOPU_ADMIN_ACCOUNTS_MAX_LIMIT,
  listLopuAccountsForAdmin,
  pendingLopuTopupRequestsFor,
  type LopuAccountRecord,
  type LopuAdminAccountUser
} from '~/api/utils/lopu/accounting';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { getStoredLopuAccessSettings } from '~/api/utils/settings/lopuAccess';

// GET /api/v1/admin/lopu/accounts?q&cursor&limit — the Lopu accounts
// directory for Admin → Lopu accounts (design note §3): without q, every
// account newest first (cursor-paged, limit ≤ 100); with q, the matching
// users (the admin user search) with their account — or no account yet —
// so an admin can verify and grant credits to someone who never opened
// Lopu. Each row: { user: { id, username, displayName, email, lopuVerified,
// isAdmin }, hasAccount, balanceMicros, balanceCredits, lowBalance, month,
// lifetime, starterGranted, pendingRequest, createdAt, updatedAt }; the
// response also carries the current Thingtime.LopuAccess settings. Admin
// only, private, admin.lopu.accounts rate limit.

export type AdminLopuAccountsHandlerDependencies = {
  requireAdmin: typeof requireAdmin;
  enforceRateLimit: typeof enforceRateLimit;
  getSettings: typeof getStoredLopuAccessSettings;
  listAccounts: typeof listLopuAccountsForAdmin;
  pendingRequestsFor: typeof pendingLopuTopupRequestsFor;
  searchUsers: (query: string, limit: number) => Promise<AdminUserRow[]>;
  usersByIds: (ids: readonly string[]) => Promise<AdminUserRow[]>;
};

const accountUser = (row: AdminUserRow): LopuAdminAccountUser => ({
  id: row.id,
  username: row.username,
  displayName: row.displayName,
  email: row.email,
  lopuVerified: row.lopuVerified,
  isAdmin: row.isAdmin
});

const pageLimit = (value: string | null): number => {
  const number = value ? Number(value) : NaN;
  if (!Number.isFinite(number)) return LOPU_ADMIN_ACCOUNTS_DEFAULT_LIMIT;
  return Math.min(LOPU_ADMIN_ACCOUNTS_MAX_LIMIT, Math.max(1, Math.floor(number)));
};

export const createAdminLopuAccountsHandlers = (dependencies: AdminLopuAccountsHandlerDependencies) => {
  const loader = ({ request }: { request: Request }) =>
    withAdminPrivateResponse(async () => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
      const gate = await dependencies.requireAdmin(request);
      if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });

      const limit = await dependencies.enforceRateLimit(request, 'admin.lopu.accounts', `user:${gate.user.id}`);
      if (!limit.allowed) return json({ ok: false, error: 'The Lopu accounts directory is being read too quickly — try again in a moment' }, rateLimitedResponseInit(limit));

      const params = new URL(request.url).searchParams;
      const q = (params.get('q') || '').trim();
      const size = pageLimit(params.get('limit'));
      const settings = await dependencies.getSettings();

      let users: AdminUserRow[];
      let records: Map<string, LopuAccountRecord>;
      let nextCursor: string | null = null;
      if (q) {
        users = await dependencies.searchUsers(q, size);
        const listed = await dependencies.listAccounts({ userIds: users.map((row) => row.id) });
        if (listed.ok === false) return json({ ok: false, error: listed.error }, { status: listed.status });
        records = new Map(listed.accounts.map((record) => [record.userId, record]));
      } else {
        const listed = await dependencies.listAccounts({ cursor: params.get('cursor'), limit: size });
        if (listed.ok === false) return json({ ok: false, error: listed.error }, { status: listed.status });
        records = new Map(listed.accounts.map((record) => [record.userId, record]));
        nextCursor = listed.nextCursor;
        const known = await dependencies.usersByIds(listed.accounts.map((record) => record.userId));
        const byId = new Map(known.map((row) => [row.id, row]));
        // keep the account order; an account whose user vanished is skipped
        users = listed.accounts.map((record) => byId.get(record.userId)).filter((row): row is AdminUserRow => !!row);
      }
      const pending = await dependencies.pendingRequestsFor(users.map((row) => row.id));
      const accounts = users.map((row) => adminLopuAccountRow({ user: accountUser(row), record: records.get(row.id) ?? null, settings, pendingRequest: pending.get(row.id) ?? null }));
      return json({ ok: true, accounts, nextCursor, settings });
    });

  return { loader };
};

const handlers = createAdminLopuAccountsHandlers({
  requireAdmin,
  enforceRateLimit,
  getSettings: getStoredLopuAccessSettings,
  listAccounts: listLopuAccountsForAdmin,
  pendingRequestsFor: pendingLopuTopupRequestsFor,
  searchUsers: (query, limit) => searchUsersForAdmin(query, limit),
  usersByIds: async (ids) => (await findUsersByIds(ids)).map(adminUserRowOf)
});

export const loader = handlers.loader;
export const action = async () => json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
