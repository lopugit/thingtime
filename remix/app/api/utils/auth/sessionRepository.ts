import { AsyncLocalStorage } from 'node:async_hooks';
import type { SessionDoc } from './sessions';
import { revokedSessionPipeline } from './sessionCore';

/** Auth persistence operations, not a Mongo collection/driver facade. The
 * default implementation retains home-pinned Mongo behavior. A future native
 * request bootstrap must explicitly bind a repository for its exact home plane;
 * no request body, endpoint failure or fallback chooses one here. */
export interface SessionRepository {
 readonly kind: 'mongo-home' | 'native-home';
 readonly homePlaneId: string;
 insert(document: SessionDoc, transaction?: unknown): Promise<void>;
 findByJti(jti: string): Promise<SessionDoc | null>;
 revoke(jti: string, at: Date): Promise<void>;
}
export class SessionRepositoryError extends Error {
 constructor(public readonly code: 'SESSION_REPOSITORY_SCOPE' | 'SESSION_TRANSACTION_UNSUPPORTED', message: string) { super(message); this.name = 'SessionRepositoryError'; }
}
const unavailable = (): never => { throw new SessionRepositoryError('SESSION_REPOSITORY_SCOPE', 'Session repository home plane or lifetime does not match the current request'); };
const scopes = new AsyncLocalStorage<{ repository: SessionRepository; active: boolean }>();
const mongo: SessionRepository = Object.freeze({
 kind: 'mongo-home', homePlaneId: 'mongodb:home',
 async insert(document: SessionDoc, transaction?: unknown) {
  const { getSessionsCollection } = await import('../mongodb/collections');
  await (await getSessionsCollection()).insertOne(document, transaction ? { session: transaction } : undefined);
 },
 async findByJti(jti: string) {
  const { getSessionsCollection } = await import('../mongodb/collections');
  return (await getSessionsCollection()).findOne({ jti });
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
