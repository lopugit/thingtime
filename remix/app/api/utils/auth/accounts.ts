import { getRostersCollection } from '../mongodb/collections';

import { clearAccountsCookie, parseAccountsCookie, serializeAccountsCookie } from './accountsCookie';
import { authCookie, clearAuthCookie, serializeAuthCookie } from './authCookie';
import { resolveSessionUser, resolveTokenUser } from './getCurrentUser';
import { signJwt } from './jwt';
import { revokeSession } from './sessions';
import type { PublicUser } from './users';

// Account-switcher roster. The tt_accounts cookie names a roster doc in the
// Mongo `rosters` collection; the doc's entries reference sessions by
// {userId, jti} — never raw JWTs (only the server, holding the signing key,
// can mint a token for a session). There is no account limit: the cookie is
// constant-size and the list lives server-side. Mongo sessions stay the
// single source of truth for validity — every entry resolves through
// resolveSessionUser, the same path getCurrentUser uses, so an entry is live
// exactly when its session is. tt_auth holds the ACTIVE account's JWT and its
// session always also appears in the roster.
//
// OWNERSHIP: the roster id in the cookie is only a pointer, so a request may
// use an inbound roster ONLY when its active tt_auth session is already one of
// that roster's entries. A roster id the browser doesn't belong to is ignored
// and a fresh roster is minted for the active session — otherwise an attacker
// who planted their own roster id in a victim's browser (cookie fixation)
// could harvest the victim's session on the next switcher read and mint a
// takeover token. Legitimate roster growth only ever happens from a browser
// that already owns the roster (add-account while signed in) or from the
// browser's very first sign-in.

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
const MAX_ROSTER_WRITE_ATTEMPTS = 4;

export type RosterEntry = { userId: string; jti: string; addedAt: Date };

export type RosterDoc = {
  rosterId: string;
  type: 'tt.roster';
  entries: RosterEntry[];
  createdAt: Date;
  updatedAt: Date;
  // Optimistic-concurrency token, rotated on every write so racing
  // read-modify-write logins can't silently clobber each other's entries.
  version: string;
  // Rolling expiry, refreshed on every write; the TTL index reaps stale docs.
  expiresAt: Date | null;
};

export type RosterAccount = {
  userId: string;
  jti: string;
  addedAt: Date;
  user: PublicUser;
  active: boolean;
};

// Wire shape for GET /api/v1/auth/accounts and roster-mutating responses.
export type PublicAccount = { user: PublicUser; active: boolean };

export type ResolvedRoster = {
  accounts: RosterAccount[];
  // Id of the OWNED roster doc to write back to (null → a fresh doc is minted:
  // the browser had no roster, or the inbound id was stale or not owned).
  rosterId: string | null;
  // version of the owned doc when it was read, for the optimistic write guard.
  readVersion: string | null;
  // True when the live accounts differ from what the doc/cookie held —
  // pruning, self-healing, a legacy JWT-array cookie, an unusable inbound
  // roster id, etc. — i.e. the response should persist + rewrite the cookie.
  changed: boolean;
  active: RosterAccount | null;
};

type RosterWriteResult = { cookies: string[]; conflict: boolean };

const toEntries = (accounts: Array<{ userId: string; jti: string; addedAt: Date }>): RosterEntry[] =>
  accounts.map(({ userId, jti, addedAt }) => ({ userId, jti, addedAt }));

export const toPublicAccounts = (accounts: RosterAccount[]): PublicAccount[] =>
  accounts.map(({ user, active }) => ({ user, active }));

// The active token straight from the tt_auth cookie. Deliberately NOT
// getAuthToken(): a Bearer header authenticates one request and must never
// leak into the browser's roster.
export const getCookieAuthToken = async (request: Request): Promise<string | null> => {
  const value = await authCookie.parse(request.headers.get('Cookie'));
  return typeof value === 'string' && value ? value : null;
};

const findLiveRosterDoc = async (rosterId: string): Promise<RosterDoc | null> => {
  const doc = await (await getRostersCollection()).findOne({ rosterId });
  if (!doc) return null;
  if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return null;
  return doc as unknown as RosterDoc;
};

// Resolve the full roster for a request: the OWNED roster doc's entries plus
// the tt_auth session (self-heals sessions minted before multi-account
// existed) plus any legacy JWT-array cookie (folded into session references),
// dead entries dropped, one entry per user (the active session wins a tie).
export const resolveRoster = async (request: Request): Promise<ResolvedRoster> => {
  const cookie = await parseAccountsCookie(request);

  const activeToken = await getCookieAuthToken(request);
  const activeLive = activeToken ? await resolveTokenUser(activeToken) : null;

  // Ownership gate: only trust the inbound roster doc when the active session
  // is already one of its entries. A planted / stale id is ignored (ownedDoc
  // stays null → a fresh roster is minted below), so a foreign session is
  // never folded into it.
  const inboundDoc = cookie.rosterId ? await findLiveRosterDoc(cookie.rosterId) : null;
  const owned = Boolean(
    inboundDoc && activeLive && inboundDoc.entries.some((entry) => entry.jti === activeLive.claims.jti)
  );
  const ownedDoc = owned ? inboundDoc : null;

  const candidates: RosterEntry[] = ownedDoc ? [...ownedDoc.entries] : [];

  // Legacy fold-in: pre-Mongo rosters stored the JWTs themselves in the
  // cookie. Possession of a live token is proof of ownership, so fold each
  // into a fresh roster doc. (parseAccountsCookie never returns a rosterId and
  // legacyTokens together, so this only runs for genuinely old cookies.)
  if (cookie.legacyTokens.length) {
    const folded = await Promise.all(cookie.legacyTokens.map((token) => resolveTokenUser(token)));
    for (const live of folded) {
      if (!live) continue;
      if (candidates.some((entry) => entry.jti === live.claims.jti)) continue;
      candidates.push({ userId: live.claims.sub, jti: live.claims.jti, addedAt: new Date() });
    }
  }

  // Self-heal: the active tt_auth session always belongs in the roster (a no-op
  // when the doc is owned, since ownership means it is already an entry; it
  // seeds the fresh roster otherwise).
  if (activeLive && !candidates.some((entry) => entry.jti === activeLive.claims.jti)) {
    candidates.push({ userId: activeLive.claims.sub, jti: activeLive.claims.jti, addedAt: new Date() });
  }

  const resolved = await Promise.all(
    candidates.map(async (entry) => ({
      entry,
      user:
        activeLive && entry.jti === activeLive.claims.jti
          ? activeLive.user
          : await resolveSessionUser(entry.jti, entry.userId)
    }))
  );

  const accounts: RosterAccount[] = [];
  for (const { entry, user } of resolved) {
    if (!user) continue;
    const account: RosterAccount = {
      userId: entry.userId,
      jti: entry.jti,
      addedAt: entry.addedAt ? new Date(entry.addedAt) : new Date(),
      user,
      active: activeLive ? entry.jti === activeLive.claims.jti : false
    };
    const duplicateIndex = accounts.findIndex((existing) => existing.userId === account.userId);
    if (duplicateIndex === -1) {
      accounts.push(account);
    } else if (account.active && !accounts[duplicateIndex].active) {
      accounts[duplicateIndex] = account;
    }
  }

  const storedEntries = ownedDoc ? ownedDoc.entries : [];
  const changed =
    cookie.legacyTokens.length > 0 ||
    // an inbound id we couldn't use (stale or not owned) — rewrite the cookie
    Boolean(cookie.rosterId && !ownedDoc) ||
    accounts.length !== storedEntries.length ||
    accounts.some((account, i) => storedEntries[i]?.jti !== account.jti);

  return {
    accounts,
    rosterId: ownedDoc ? ownedDoc.rosterId : null,
    readVersion: ownedDoc ? ownedDoc.version : null,
    changed,
    active: accounts.find((account) => account.active) ?? null
  };
};

// Persist a roster's entries. Creates the doc on first use (rosterId null),
// deletes it when the last account leaves, and otherwise updates in place
// under an optimistic-concurrency guard: when expectedVersion is given and the
// stored version has moved on (a concurrent write landed), the update is
// skipped and { conflict: true } is returned so the caller can re-resolve and
// retry — this is what stops a racing login from clobbering another's entry
// (which would orphan a live, unrevocable session).
export const persistRoster = async (
  rosterId: string | null,
  entries: Array<{ userId: string; jti: string; addedAt: Date }>,
  expectedVersion?: string | null
): Promise<RosterWriteResult> => {
  const rosters = await getRostersCollection();
  const now = new Date();

  if (!entries.length) {
    if (rosterId) {
      const filter = expectedVersion ? { rosterId, version: expectedVersion } : { rosterId };
      const res = await rosters.deleteOne(filter);
      if (expectedVersion && res.deletedCount === 0 && (await rosters.findOne({ rosterId }))) {
        return { cookies: [], conflict: true };
      }
    }
    return { cookies: [await clearAccountsCookie()], conflict: false };
  }

  const stored = toEntries(entries);
  const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);
  const version = crypto.randomUUID();

  if (rosterId) {
    const filter = expectedVersion ? { rosterId, version: expectedVersion } : { rosterId };
    const res = await rosters.updateOne(filter, {
      $set: { entries: stored, updatedAt: now, expiresAt, version }
    });
    if (res.matchedCount > 0) {
      return { cookies: [await serializeAccountsCookie(rosterId)], conflict: false };
    }
    // Guarded miss = a concurrent write moved the version → conflict. An
    // unguarded miss = the doc vanished (TTL/logout-all) → fall through to
    // mint a fresh one.
    if (expectedVersion) return { cookies: [], conflict: true };
  }

  // Rosters' unique + TTL indexes are guaranteed by the boot-time warmup
  // (server/plugins/mongo-warmup) — no per-request ensure needed here.
  const created: RosterDoc = {
    rosterId: crypto.randomUUID(),
    type: 'tt.roster',
    entries: stored,
    createdAt: now,
    updatedAt: now,
    version,
    expiresAt
  };
  await rosters.insertOne(created);
  return { cookies: [await serializeAccountsCookie(created.rosterId)], conflict: false };
};

// Set-Cookie values that persist pruning/self-healing done by resolveRoster,
// or [] when nothing needs writing. Best-effort: a concurrent-write conflict on
// a read path is ignored (the other writer's state wins; the next read
// reconciles). A fresh mint (unusable inbound id) still rewrites the cookie.
export const persistRosterIfChanged = async (roster: ResolvedRoster): Promise<string[]> => {
  if (!roster.changed) return [];
  const res = await persistRoster(roster.rosterId, roster.accounts, roster.readVersion);
  return res.cookies;
};

// Mint the tt_auth JWT for a roster account's live session. Switching (and
// logout promotion) never needs credentials — belonging to the roster (proven
// by resolveRoster's ownership gate) is the authorization; the session was
// verified live by resolveRoster just now.
export const mintAccountToken = (account: RosterAccount) =>
  signJwt({ sub: account.userId, jti: account.jti });

// Retry a roster read-modify-write until it lands on the version it read (or
// the attempt budget is spent, after which it writes unguarded). mutate turns
// the freshly-resolved roster into the entries to store; the final blind write
// is acceptable because a same-millisecond triple-collision is vanishingly
// rare and still leaves a consistent doc.
const mutateRoster = async (
  request: Request,
  mutate: (roster: ResolvedRoster) => Promise<Array<{ userId: string; jti: string; addedAt: Date }>>
): Promise<{ roster: ResolvedRoster; entries: RosterEntry[]; cookies: string[] }> => {
  for (let attempt = 0; attempt < MAX_ROSTER_WRITE_ATTEMPTS; attempt++) {
    const roster = await resolveRoster(request);
    const entries = toEntries(await mutate(roster));
    const guard = attempt < MAX_ROSTER_WRITE_ATTEMPTS - 1 ? roster.readVersion : undefined;
    const res = await persistRoster(roster.rosterId, entries, guard);
    if (!res.conflict) return { roster, entries, cookies: res.cookies };
  }
  // Unreachable: the last iteration passes no guard and cannot conflict.
  const roster = await resolveRoster(request);
  const entries = toEntries(await mutate(roster));
  const res = await persistRoster(roster.rosterId, entries);
  return { roster, entries, cookies: res.cookies };
};

// Merge a freshly-created login/register session into the browser's roster:
// replaces any entry for the same user (revoking the replaced session — a
// re-login means a fresh credential, not two) and appends as the newest entry.
// Returns the tt_accounts Set-Cookie values; the caller sets tt_auth to the new
// JWT alongside. If the inbound roster isn't owned by this browser, the merge
// lands in a fresh doc (never the foreign one).
export const mergeAccountSession = async (
  request: Request,
  next: { userId: string; jti: string }
): Promise<string[]> => {
  const { cookies } = await mutateRoster(request, async (roster) => {
    const replaced = roster.accounts.filter((account) => account.userId === next.userId);
    await Promise.all(replaced.map((account) => revokeSession(account.jti)));
    return [
      ...roster.accounts.filter((account) => account.userId !== next.userId),
      { userId: next.userId, jti: next.jti, addedAt: new Date() }
    ];
  });
  return cookies;
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
// removed the next roster account becomes active (a fresh JWT is minted for
// its session); when nothing remains both cookies are cleared. `all: true`
// revokes every roster session.
export const removeAccounts = async (
  request: Request,
  target: { userId?: string; all?: boolean }
): Promise<RosterMutation> => {
  const removing = (account: RosterAccount) =>
    target.all === true || (target.userId !== undefined && account.userId === target.userId);

  // `roster` is the state the winning write was based on, so remaining /
  // nextActive computed from it match exactly what was persisted.
  const { roster, cookies } = await mutateRoster(request, async (current) => {
    const removed = current.accounts.filter(removing);
    await Promise.all(removed.map((account) => revokeSession(account.jti)));
    return current.accounts.filter((account) => !removing(account));
  });

  const remaining = roster.accounts.filter((account) => !removing(account));
  const removedActive = roster.accounts.some((account) => removing(account) && account.active) || !roster.active;
  const nextActive = removedActive ? remaining[0] ?? null : roster.active;

  const setCookies = [
    nextActive ? await serializeAuthCookie(await mintAccountToken(nextActive)) : await clearAuthCookie(),
    ...cookies
  ];

  const accounts = remaining.map((account) => ({
    user: account.user,
    active: nextActive ? account.userId === nextActive.userId : false
  }));

  return { user: nextActive ? nextActive.user : null, accounts, setCookies };
};
