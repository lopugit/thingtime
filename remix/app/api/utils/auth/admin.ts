// Admin allowlist. Admins are usernames listed in
// THINGTIME_PRIVATE_ADMIN_USERNAMES (comma-separated, case-insensitive) — a
// server-only env var. The name MUST contain 'PRIVATE': root-data ships every
// THINGTIME_* env var WITHOUT 'PRIVATE' in its name to the browser
// (root-data.server.ts), and an admin allowlist must never ride along.
//
// Env is the single source of truth — no role field on user docs, nothing to
// bootstrap or migrate, revoked by redeploying without the name. The request
// gate lives in getCurrentUser.ts (requireAdmin); this module stays pure so
// users.ts can use it without an import cycle.

export const adminUsernames = (): string[] =>
  (process.env.THINGTIME_PRIVATE_ADMIN_USERNAMES || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

export const isAdminUsername = (username: unknown): boolean =>
  typeof username === 'string' && adminUsernames().includes(username.trim().toLowerCase());
