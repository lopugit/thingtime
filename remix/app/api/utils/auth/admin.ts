// Admin identity. A user is an admin when their user doc has `meta.admin === true`
// OR their username is in the ADMIN_USERNAMES env allowlist. The env allowlist
// bootstraps the first admin and is a PERMANENT override — an env-listed user is
// always an admin and can't be demoted from the UI — so there's always a way
// back in. Pure predicates only (no imports) to stay clear of the
// users ↔ getCurrentUser import cycle; routes gate on the `isAdmin` flag that
// toPublicUser stamps onto every PublicUser.

const envAdminUsernames = (): string[] =>
  (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

export const isEnvAdmin = (username: string | null | undefined): boolean =>
  !!username && envAdminUsernames().includes(username.trim().toLowerCase());

// Works on a raw user doc (has `meta` + `username`).
export const isAdminDoc = (user: { username?: string; meta?: Record<string, any> } | null | undefined): boolean =>
  !!user && (user.meta?.admin === true || isEnvAdmin(user.username));
