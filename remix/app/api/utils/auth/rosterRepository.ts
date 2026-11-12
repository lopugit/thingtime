import { AsyncLocalStorage } from 'node:async_hooks';
import type { RosterDoc } from './accounts';
import { currentUserIdentityRepository } from './userIdentityRepository';
import { assertSameHomeRepositoryProvider } from './homeRepositoryScope';

type RosterUpdate = Pick<RosterDoc, 'entries' | 'updatedAt' | 'expiresAt' | 'version'>;

/** Persistence only: cookie possession, active-session ownership, pruning and
 * account switching remain in accounts.ts. A roster ID never grants authority. */
export interface RosterRepository {
 readonly kind: 'mongo-home' | 'native-home';
 readonly homePlaneId: string;
 findById(rosterId: string): Promise<RosterDoc | null>;
 insert(document: RosterDoc): Promise<void>;
 replace(rosterId: string, update: RosterUpdate, expectedVersion?: string | null): Promise<boolean>;
 remove(rosterId: string, expectedVersion?: string | null): Promise<{ deleted: boolean; exists: boolean }>;
}

export class RosterRepositoryError extends Error {
 constructor(public readonly code: 'ROSTER_REPOSITORY_SCOPE' | 'INVALID_ROSTER', message: string) {
  super(message); this.name = 'RosterRepositoryError';
 }
}

const scopes = new AsyncLocalStorage<{ repository: RosterRepository; active: boolean }>();
const unavailable = (): never => { throw new RosterRepositoryError('ROSTER_REPOSITORY_SCOPE', 'Roster repository home plane or lifetime does not match the current request'); };
const mongo: RosterRepository = Object.freeze({
 kind: 'mongo-home', homePlaneId: 'mongodb:home',
 async findById(rosterId: string) {
  const { getRostersCollection } = await import('../mongodb/collections');
  return await (await getRostersCollection()).findOne({ rosterId }) as unknown as RosterDoc | null;
 },
 async insert(document: RosterDoc) {
  const { getRostersCollection } = await import('../mongodb/collections');
  await (await getRostersCollection()).insertOne(document);
 },
 async replace(rosterId: string, update: RosterUpdate, expectedVersion?: string | null) {
  const { getRostersCollection } = await import('../mongodb/collections');
  const filter = expectedVersion ? { rosterId, version: expectedVersion } : { rosterId };
  return (await (await getRostersCollection()).updateOne(filter, { $set: update })).matchedCount > 0;
 },
 async remove(rosterId: string, expectedVersion?: string | null) {
  const { getRostersCollection } = await import('../mongodb/collections');
  const rosters = await getRostersCollection();
  const filter = expectedVersion ? { rosterId, version: expectedVersion } : { rosterId };
  const deleted = (await rosters.deleteOne(filter)).deletedCount > 0;
  return { deleted, exists: !deleted && !!expectedVersion && !!(await rosters.findOne({ rosterId })) };
 }
});

export function currentRosterRepository(): RosterRepository {
 const scope = scopes.getStore();
 if (scope && !scope.active) return unavailable();
 const identities = currentUserIdentityRepository();
 if (identities && (!scope || scope.repository.kind !== 'native-home' || scope.repository.homePlaneId !== identities.homePlaneId)) return unavailable();
 if (identities) assertSameHomeRepositoryProvider(identities, scope!.repository);
 return scope?.repository ?? mongo;
}

export function assertRosterRepositoryScope(repository: RosterRepository): void {
 const scope = scopes.getStore();
 if (!scope?.active || currentRosterRepository() !== repository) unavailable();
}

/** Explicit internal home binding; neither an HTTP fallback nor native profile
 * activation. Expired async descendants cannot silently borrow Mongo authority. */
export async function withHomeRosterRepository<T>(repository: RosterRepository, homePlaneId: string, work: () => T | Promise<T>): Promise<T> {
 if (scopes.getStore() || !homePlaneId || repository.homePlaneId !== homePlaneId || typeof work !== 'function') return unavailable();
 const scope = { repository, active: true };
 return scopes.run(scope, async () => { try { return await work(); } finally { scope.active = false; } });
}
