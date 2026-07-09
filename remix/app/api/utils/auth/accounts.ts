import { clearAccountsCookie, MAX_ACCOUNTS, parseAccountTokens, serializeAccountsCookie } from './accountsCookie';
import { authCookie, clearAuthCookie, serializeAuthCookie } from './authCookie';
import { resolveTokenUser } from './getCurrentUser';
import { verifyJwt } from './jwt';
import { revokeSession } from './sessions';
import type { PublicUser } from './users';

// Account-switcher roster logic. The roster is the tt_accounts cookie (one JWT
// per signed-in account, insertion order); tt_auth holds the ACTIVE account's
// JWT and always also appears in the roster. Every token here resolves through
// resolveTokenUser — the same path getCurrentUser uses — so the switcher can
// never consider a token live that request auth would reject.

export type RosterAccount = {
  token: string;
  user: PublicUser;
  jti: string;
  active: boolean;
};

// Wire shape for GET /api/v1/auth/accounts and roster-mutating responses.
export type PublicAccount = { user: PublicUser; active: boolean };

export type ResolvedRoster = {
  accounts: RosterAccount[];
  // Live tokens in roster order — what tt_accounts should now contain.
  tokens: string[];
  // True when pruning/self-healing changed the roster vs the request cookie,
  // i.e. the response should rewrite tt_accounts.
  changed: boolean;
  active: RosterAccount | null;
};

export const toPublicAccounts = (accounts: RosterAccount[]): PublicAccount[] =>
  accounts.map(({ user, active }) => ({ user, active }));

// Set-Cookie value that persists pruning/self-healing done by resolveRoster,
// or null when the request cookie already matches (avoids no-op cookie churn).
export const serializeRosterCookieIfChanged = async (roster: ResolvedRoster): Promise<string | null> => {
  if (!roster.changed) return null;
  return roster.tokens.length ? serializeAccountsCookie(roster.tokens) : clearAccountsCookie();
};

// The active token straight from the tt_auth cookie. Deliberately NOT
// getAuthToken(): a Bearer header authenticates one request and must never
// leak into the browser's roster cookie.
export const getCookieAuthToken = async (request: Request): Promise<string | null> => {
  const value = await authCookie.parse(request.headers.get('Cookie'));
  return typeof value === 'string' && value ? value : null;
};

// Resolve the full roster for a request: tt_accounts plus the tt_auth token
// (self-heals sessions minted before multi-account existed), dead entries
// dropped, one entry per user (the active token wins a duplicate-user tie).
export const resolveRoster = async (request: Request): Promise<ResolvedRoster> => {
  const cookieTokens = await parseAccountTokens(request);
  const activeToken = await getCookieAuthToken(request);

  const candidates = [...cookieTokens];
  if (activeToken && !candidates.includes(activeToken)) candidates.push(activeToken);

  const resolved = await Promise.all(
    candidates.map(async (token) => ({ token, live: await resolveTokenUser(token) }))
  );

  const accounts: RosterAccount[] = [];
  for (const { token, live } of resolved) {
    if (!live) continue;
    const duplicateIndex = accounts.findIndex((account) => account.user.id === live.user.id);
    const account: RosterAccount = {
      token,
      user: live.user,
      jti: live.claims.jti,
      active: token === activeToken
    };
    if (duplicateIndex === -1) {
      accounts.push(account);
    } else if (account.active && !accounts[duplicateIndex].active) {
      accounts[duplicateIndex] = account;
    }
  }

  const tokens = accounts.map((account) => account.token);
  const changed = tokens.length !== cookieTokens.length || tokens.some((token, i) => token !== cookieTokens[i]);

  return {
    accounts,
    tokens,
    changed,
    active: accounts.find((account) => account.active) ?? null
  };
};

// Merge a freshly-minted login/register JWT into the request's roster: replaces
// any entry for the same user (revoking the replaced session — a re-login means
// a fresh credential, not two), appends as the newest entry, and enforces
// MAX_ACCOUNTS by dropping (and revoking — no dangling credentials) the oldest
// other accounts. Returns the tokens tt_accounts should be set to; the caller
// sets tt_auth to `newToken` alongside.
export const mergeAccountToken = async (
  request: Request,
  newToken: string,
  userId: string
): Promise<string[]> => {
  const roster = await resolveRoster(request);

  const replaced = roster.accounts.filter((account) => account.user.id === userId);
  await Promise.all(replaced.map((account) => revokeSession(account.jti)));

  const kept = roster.accounts.filter((account) => account.user.id !== userId).map((account) => account.token);
  kept.push(newToken);

  while (kept.length > MAX_ACCOUNTS) {
    const dropped = kept.shift()!;
    const claims = await verifyJwt(dropped);
    if (claims) await revokeSession(claims.jti);
  }

  return kept;
};

export type RosterMutation = {
  // Active user after the mutation (null = fully signed out).
  user: PublicUser | null;
  accounts: PublicAccount[];
  // Set-Cookie values (tt_auth + tt_accounts) the response must carry.
  setCookies: string[];
};

// Shared sign-out path for logout and switcher "remove": revoke the target
// account's session(s) and drop it from the roster. When the ACTIVE account is
// removed the next roster account becomes active; when nothing remains both
// cookies are cleared. `all: true` revokes every roster session.
export const removeAccounts = async (
  request: Request,
  target: { userId?: string; all?: boolean }
): Promise<RosterMutation> => {
  const roster = await resolveRoster(request);

  const removing = (account: RosterAccount) =>
    target.all === true || (target.userId !== undefined && account.user.id === target.userId);

  const removed = roster.accounts.filter(removing);
  const remaining = roster.accounts.filter((account) => !removing(account));

  await Promise.all(removed.map((account) => revokeSession(account.jti)));

  const removedActive = removed.some((account) => account.active) || !roster.active;
  const nextActive = removedActive ? remaining[0] ?? null : roster.active;

  const setCookies = [
    nextActive ? await serializeAuthCookie(nextActive.token) : await clearAuthCookie(),
    remaining.length ? await serializeAccountsCookie(remaining.map((account) => account.token)) : await clearAccountsCookie()
  ];

  const accounts = remaining.map((account) => ({
    user: account.user,
    active: nextActive ? account.user.id === nextActive.user.id : false
  }));

  return { user: nextActive ? nextActive.user : null, accounts, setCookies };
};
