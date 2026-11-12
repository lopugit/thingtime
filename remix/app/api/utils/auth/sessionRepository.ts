import { AsyncLocalStorage } from 'node:async_hooks';
import type { Binary } from 'mongodb';
import type { SessionDoc } from './sessions';
import { revokedSessionPipeline } from './sessionCore';
import { hasNativeHomeSelection } from '../documentStore/nativeHomeSelection';
import { currentUserIdentityRepository } from './userIdentityRepository';
import { assertSameHomeRepositoryProvider } from './homeRepositoryScope';

/** Auth persistence operations, not a Mongo collection/driver facade. The
 * default implementation retains home-pinned Mongo behavior. A future native
 * request bootstrap must explicitly bind a repository for its exact home plane;
 * no request body, endpoint failure or fallback chooses one here. */
export type SessionVaultEnvelopeBinding = { jti:string; ownerId:string; expiresAt:Date|null; at:Date; envelope:Binary };
export interface PatSessionPersistence {
 countUnrevoked(userId: string): Promise<number>;
 insert(document: SessionDoc, limit: number | null): Promise<boolean>;
 list(userId: string, limit: number): Promise<SessionDoc[]>;
 revokeOwned(userId: string, jti: string, at: Date): Promise<SessionDoc | null>;
 consume(userId: string, jti: string, limited: boolean, at: Date): Promise<boolean>;
}
export class PatSessionLimitError extends Error {
 constructor() { super('Personal token allowance reached'); this.name = 'PatSessionLimitError'; }
}
export interface SessionRepository {
 readonly kind: 'mongo-home' | 'native-home';
 readonly homePlaneId: string;
 readonly pat?: PatSessionPersistence;
 insert(document: SessionDoc, transaction?: unknown): Promise<void>;
 findByJti(jti: string): Promise<SessionDoc | null>;
 revoke(jti: string, at: Date): Promise<void>;
 bindVaultEnvelope(binding: SessionVaultEnvelopeBinding): Promise<boolean>;
}
export class SessionRepositoryError extends Error {
 constructor(public readonly code: 'SESSION_REPOSITORY_SCOPE' | 'SESSION_TRANSACTION_UNSUPPORTED', message: string) { super(message); this.name = 'SessionRepositoryError'; }
}
const unavailable = (): never => { throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'Session repository home plane or lifetime does not match the current request'); };
const scopes = new AsyncLocalStorage<{ repository: SessionRepository; active: boolean }>();
const mongo: SessionRepository = Object.freeze({
 kind: 'mongo-home', homePlaneId: 'mongodb:home',
 pat: {
  async countUnrevoked(userId) { const { getSessionsCollection } = await import('../mongodb/collections'); return (await getSessionsCollection()).countDocuments({ userId, purpose: 'pat', revokedAt: null }); },
  async insert(document, _limit) { const { getSessionsCollection } = await import('../mongodb/collections'); await (await getSessionsCollection()).insertOne(document); return true; },
  async list(userId, limit) { const { getSessionsCollection } = await import('../mongodb/collections'); return (await getSessionsCollection()).find({ userId, purpose: 'pat' }).sort({ createdAt: -1 }).limit(limit).toArray(); },
  async revokeOwned(userId, jti, at) {
   const { getSessionsCollection } = await import('../mongodb/collections'); const collection = await getSessionsCollection();
   const row = await collection.findOne({ jti, userId, purpose: 'pat' }); if (!row) return null;
   if (!row.revokedAt) {
    const { REVOKED_SESSION_REAP_MS } = await import('./sessionCore');
    const patch = { revokedAt: at, ...(!row.expiresAt ? { expiresAt: new Date(at.getTime() + REVOKED_SESSION_REAP_MS) } : {}) };
    await collection.updateOne({ jti: row.jti }, { $set: patch }); Object.assign(row, patch);
   }
   return row;
  },
  async consume(_userId, jti, limited, at) {
   const { getSessionsCollection } = await import('../mongodb/collections'); const collection = await getSessionsCollection();
   if (!limited) { await collection.updateOne({ jti }, { $set: { 'meta.lastUsedAt': at } }); return true; }
   const result = await collection.updateOne({ jti, purpose: 'pat', revokedAt: null, 'meta.usesRemaining': { $gt: 0 } }, { $inc: { 'meta.usesRemaining': -1 }, $set: { 'meta.lastUsedAt': at } });
   return result.modifiedCount === 1;
  }
 } satisfies PatSessionPersistence,
 async insert(document: SessionDoc, transaction?: unknown) {
  const { getSessionsCollection } = await import('../mongodb/collections');
  await (await getSessionsCollection()).insertOne(document, transaction ? { session: transaction } : undefined);
 },
 async findByJti(jti: string) {
  const { getSessionsCollection } = await import('../mongodb/collections');
  return (await getSessionsCollection()).findOne({ jti });
 },
 async bindVaultEnvelope(binding: SessionVaultEnvelopeBinding) {
  const { getSessionsCollection } = await import('../mongodb/collections');
  const result = await (await getSessionsCollection()).updateOne(
   { jti: binding.jti, userId: binding.ownerId, revokedAt: null, expiresAt: binding.expiresAt },
   { $set: { secureVaultKey: binding.envelope } }
  );
  return result.matchedCount === 1;
 },
 async revoke(jti: string, at: Date) {
  const { getSessionsCollection } = await import('../mongodb/collections');
  await (await getSessionsCollection()).updateOne({ jti }, revokedSessionPipeline(at));
 }
});
export const currentSessionRepository = (): SessionRepository => {
 const scope = scopes.getStore();
 if (scope && !scope.active) return unavailable();
 return scope?.repository ?? mongo;
};
export const currentPatSessionPersistence = (): PatSessionPersistence => {
 const repository = currentSessionRepository();
 const identities = currentUserIdentityRepository();
 if (repository.kind === 'mongo-home' && (identities || hasNativeHomeSelection())) return unavailable();
 if (repository.kind === 'native-home') {
  if (!identities || identities.homePlaneId !== repository.homePlaneId) return unavailable();
  assertSameHomeRepositoryProvider(identities, repository);
 }
 if (!repository.pat) return unavailable();
 return repository.pat;
};
/** Native implementations call this again inside the queued storage callback:
 * initiating work does not authorize a detached continuation after scope exit. */
export const assertSessionRepositoryScope = (repository: SessionRepository): void => {
 const scope = scopes.getStore();
 if (!scope?.active || scope.repository !== repository) unavailable();
};
/** Internal DI boundary only. No runtime or user selects native persistence
 * yet. Nested plane changes and expired async descendants are refused. */
export async function withHomeSessionRepository<T>(repository: SessionRepository, homePlaneId: string, work: () => T | Promise<T>): Promise<T> {
 if (scopes.getStore() || typeof homePlaneId !== 'string' || !homePlaneId || repository.homePlaneId !== homePlaneId || typeof work !== 'function') return unavailable();
 const scope = { repository, active: true };
 return scopes.run(scope, async () => { try { return await work(); } finally { scope.active = false; } });
}
