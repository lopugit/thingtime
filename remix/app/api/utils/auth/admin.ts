import { json } from '../../http';
import { getCurrentUser } from './getCurrentUser';
import type { PublicUser } from './users';

type AdminResult =
  | { ok: true; user: PublicUser }
  | { ok: false; status: 401 | 403; error: string };

const parseEnvList = (value?: string) =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const adminUserIds = () => parseEnvList(process.env.THINGTIME_ADMIN_USER_IDS);
const adminUsernames = () => parseEnvList(process.env.THINGTIME_ADMIN_USERNAMES);
const adminEmails = () => parseEnvList(process.env.THINGTIME_ADMIN_EMAILS);

const adminAllowlistConfigured = () =>
  adminUserIds().length > 0 || adminUsernames().length > 0 || adminEmails().length > 0;

// isAdminUser must key admin authority on attributes the requester cannot
// simply claim by registering. username and email are *chosen at signup*, and
// registration logs a brand-new (unverified) account straight in, so matching
// admin on a raw username/email lets anyone pre-register an allowlisted handle
// (before the real admin does) and self-escalate. Guard rails:
//   - Only real user accounts qualify — never a provisioned service account.
//   - THINGTIME_ADMIN_USER_IDS matches the server-assigned Mongo _id, which the
//     requester cannot pick, so it is the one fully non-claimable anchor and is
//     honoured without further checks. Prefer it in production.
//   - THINGTIME_ADMIN_EMAILS / _USERNAMES are only honoured for an account that
//     has verified its email. That fully closes the email path (you cannot
//     verify an address you do not control); a username allowlist still trusts
//     whoever registers that handle first, so it is a bootstrap convenience —
//     allowlist a username only for an account you know already exists.
export const isAdminUser = (user: PublicUser | null): user is PublicUser => {
  if (!user) return false;
  if (user.accountKind !== 'user') return false;

  if (adminUserIds().includes(user.id.toLowerCase())) return true;

  if (!user.emailVerified) return false;

  return (
    adminUsernames().includes(user.username.toLowerCase()) ||
    adminEmails().includes(user.email.toLowerCase())
  );
};

export const requireAdminUser = async (request: Request): Promise<AdminResult> => {
  const user = await getCurrentUser(request);
  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  if (!isAdminUser(user)) {
    if (!adminAllowlistConfigured()) {
      // A fresh deploy with no allowlist rejects everyone; surface the cause so
      // the 403 is diagnosable instead of looking like a bug.
      console.warn(
        '[admin] No admin allowlist configured — set THINGTIME_ADMIN_USER_IDS ' +
          '(preferred, non-claimable), THINGTIME_ADMIN_EMAILS, or ' +
          'THINGTIME_ADMIN_USERNAMES to allow admin-only routes.'
      );
    }
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return { ok: true, user };
};

// Wrap an admin-only route action so the guard, the 401/403 response shape, and
// error-to-JSON handling live in ONE place. This keeps enforcement from drifting
// away from the auth mode declared in apiDocs, and guarantees a machine-readable
// JSON body even when a downstream call (e.g. Mongo being unreachable) throws —
// the Nitro dispatcher only passes thrown Response objects through, so an
// unguarded Error would otherwise surface as a generic non-JSON 500.
export const withAdmin = (
  handler: (args: { request: Request; admin: PublicUser }) => Promise<Response> | Response
) => {
  return async ({ request }: { request: Request }): Promise<Response> => {
    try {
      const result = await requireAdminUser(request);
      if (result.ok === false) {
        return json({ ok: false, error: result.error }, { status: result.status });
      }
      return await handler({ request, admin: result.user });
    } catch (err) {
      // readJsonBody (and friends) throw a ready-made Response (e.g. 413); pass
      // those straight through. Anything else becomes a JSON 500.
      if (err instanceof Response) return err;
      console.error('[admin route] unhandled error', err);
      return json({ ok: false, error: 'Internal server error' }, { status: 500 });
    }
  };
};
