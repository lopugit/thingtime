import { getSessionsCollection } from '../mongodb/collections';
import { findAppsByClientIds } from './apps';
import { sessionScopes } from './scopes';
import type { AppScopeId } from './scopes';

// End-user grant management for "Login with Thingtime": the user who approved
// an app can see every app connected to their account and disconnect one at
// any time — revoking ALL of their live app sessions for that clientId, so a
// leaked or unwanted token stops working immediately (the app-token resolver
// checks getLiveSession on every request). This is the user-side counterpart
// to the developer-side deleteApp revocation.

export type AppGrant = {
  clientId: string;
  appName: string | null; // null when the app has since been deleted
  scopes: AppScopeId[];
  sessions: number;
  firstGrantedAt: Date;
  lastGrantedAt: Date;
  expiresAt: Date | null;
};

const liveAppSessionsFilter = (userId: string) => ({
  purpose: 'app',
  userId,
  revokedAt: null,
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
});

// Hard read bound for the aggregation below. issueAppToken caps live sessions
// at MAX_APP_SESSIONS_PER_APP_USER per app, so reaching this would take ~100
// distinct connected apps — the bound exists so the read can never be huge
// even if that invariant slips.
const MAX_GRANT_SESSIONS_READ = 1000;

// One entry per connected app, aggregated over the user's live app sessions.
export const listGrants = async (userId: string): Promise<AppGrant[]> => {
  // Newest first + limit keeps the read bounded while preferring the sessions
  // that determine expiresAt/lastGrantedAt; reversed so the grouping below
  // still sees ascending createdAt (firstGrantedAt = group[0]).
  const sessions = (
    await (await getSessionsCollection())
      .find(liveAppSessionsFilter(userId))
      .sort({ createdAt: -1 })
      .limit(MAX_GRANT_SESSIONS_READ)
      .toArray()
  ).reverse();

  const byClient = new Map<string, any[]>();
  for (const session of sessions) {
    const clientId = session.meta?.clientId;
    if (typeof clientId !== 'string' || !clientId) continue;
    const group = byClient.get(clientId) || [];
    group.push(session);
    byClient.set(clientId, group);
  }

  const appDocs = await findAppsByClientIds([...byClient.keys()]);
  const appsByClientId = new Map<string, any>();
  for (const doc of appDocs as any[]) {
    const clientId = doc?.crystal?.clientId;
    if (typeof clientId === 'string' && clientId) appsByClientId.set(clientId, doc);
  }

  const grants: AppGrant[] = [];
  for (const [clientId, group] of byClient) {
    const app = appsByClientId.get(clientId);
    const newest = group[group.length - 1];
    // The union of scopes across live sessions — what the app can do overall.
    const scopes: AppScopeId[] = [];
    for (const session of group) {
      for (const scope of sessionScopes(session.meta)) {
        if (!scopes.includes(scope)) scopes.push(scope);
      }
    }
    grants.push({
      clientId,
      appName: app?.crystal?.name ?? null,
      scopes,
      sessions: group.length,
      firstGrantedAt: group[0].createdAt,
      lastGrantedAt: newest.createdAt,
      expiresAt: newest.expiresAt ?? null
    });
  }
  return grants;
};

// Disconnect one app: revoke every live app session this USER holds for the
// clientId. Other users' grants for the same app are untouched.
export const revokeGrant = async (
  userId: string,
  clientId: unknown
): Promise<{ ok: true; revoked: number } | { ok: false; status: number; error: string }> => {
  if (typeof clientId !== 'string' || !clientId.trim()) {
    return { ok: false, status: 400, error: 'clientId is required' };
  }

  const result = await (await getSessionsCollection()).updateMany(
    { ...liveAppSessionsFilter(userId), 'meta.clientId': clientId.trim() },
    { $set: { revokedAt: new Date() } }
  );

  return { ok: true, revoked: result.modifiedCount };
};
