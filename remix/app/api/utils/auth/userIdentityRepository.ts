import { AsyncLocalStorage } from 'node:async_hooks';
import type { Binary } from 'mongodb';
import { currentSessionRepository, withHomeSessionRepository, type SessionRepository } from './sessionRepository';

/** Semantic home identity operations, not a Mongo driver interface. The
 * canonical users module still constructs/projects protected user Things.
 * No native runtime selection, legacy migration or registration is added. */
export interface UserIdentityRepository {
 readonly homePlaneId: string;
 insertUserThing(thing: Readonly<Record<string, unknown>>, transaction?: unknown): Promise<void>;
 findUserThingByUsername(username: string): Promise<Record<string, unknown> | null>;
 findUserThingByEmailKey(key: Binary): Promise<Record<string, unknown> | null>;
 findUserThingById(id: string): Promise<Record<string, unknown> | null>;
 findUserThingsByUsernames(usernames: readonly string[]): Promise<Record<string, unknown>[]>;
 findUserThingsByIds(ids: readonly string[]): Promise<Record<string, unknown>[]>;
}
export class UserIdentityRepositoryError extends Error {
 constructor(public readonly code: 'USER_IDENTITY_SCOPE' | 'USER_IDENTITY_TRANSACTION_UNSUPPORTED', message: string) { super(message); this.name = 'UserIdentityRepositoryError'; }
}
const unavailable = (): never => { throw new UserIdentityRepositoryError('USER_IDENTITY_SCOPE', 'User identity repository does not match the active home request'); };
const scopes = new AsyncLocalStorage<{ repository: UserIdentityRepository; sessions: SessionRepository; active: boolean }>();
export const currentUserIdentityRepository = (): UserIdentityRepository | null => {
 const scope = scopes.getStore();
 if (scope && !scope.active) return unavailable();
 const sessions = currentSessionRepository();
 if (scope) {
  if (!scope.active || sessions !== scope.sessions) return unavailable();
  return scope.repository;
 }
 // A native session alone is insufficient authority to read identities from
 // Mongo. Normal hosted calls retain the existing dual-era Mongo path.
 if (sessions.kind === 'native-home') return unavailable();
 return null;
};
export const assertUserIdentityRepositoryScope = (repository: UserIdentityRepository): void => {
 if (currentUserIdentityRepository() !== repository) unavailable();
};
/** Internal explicit dependency binding. Native construction supplies both
 * repositories from the same provider. Lifetime checks also run inside queued
 * native work, so detached continuations cannot acquire a new transaction. */
export async function withHomeAuthRepositories<T>(identities: UserIdentityRepository, sessions: SessionRepository, work: () => T | Promise<T>): Promise<T> {
 if (scopes.getStore() || !identities.homePlaneId || identities.homePlaneId !== sessions.homePlaneId || sessions.kind !== 'native-home') return unavailable();
 const scope = { repository: identities, sessions, active: true };
 return scopes.run(scope, async () => {
  try { return await withHomeSessionRepository(sessions, identities.homePlaneId, work); }
  finally { scope.active = false; }
 });
}
