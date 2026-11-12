import { AsyncLocalStorage } from 'node:async_hooks';
import type { Collection, Document } from 'mongodb';
import type { ConsumeTokenResult } from './singleUseTokens';
import { currentUserIdentityRepository } from './userIdentityRepository';
import { assertSameHomeRepositoryProvider } from './homeRepositoryScope';

/** Canonical issuance and claim semantics. Persistence adapters own token
 * encoding: hosted Mongo retains its deployed raw-token contract; SQLite uses
 * a one-way digest. Never choose a backend from a request or failed lookup. */
export type StoredSingleUseToken = {
 token: string; userId: string; email: string; schemaVersion: number;
 createdAt: Date; expiresAt: Date; consumedAt: Date | null;
};
export interface SingleUseTokenRepository {
 readonly kind: 'mongo-home' | 'native-home';
 readonly homePlaneId: string;
 insert(document: StoredSingleUseToken): Promise<void>;
 claim(token: string, now: Date): Promise<StoredSingleUseToken | null>;
 find(token: string): Promise<StoredSingleUseToken | null>;
 /** Native resumable completion only. mark must be the canonical owner/email
  * mutation, called outside the token transaction (no nested SQLite work). */
 completeVerification?(token: string, mark: (userId: string, email: string) => Promise<boolean>): Promise<ConsumeTokenResult>;
}
export type SingleUseTokenCollectionGetter = () => Promise<Collection>;
const record = (row: Document | null): StoredSingleUseToken | null => row as StoredSingleUseToken | null;
export const mongoSingleUseTokenRepository = (getCollection: SingleUseTokenCollectionGetter): SingleUseTokenRepository => Object.freeze({
 kind: 'mongo-home', homePlaneId: 'mongodb:home',
 async insert(document: StoredSingleUseToken) {
  assertMongoTokenScope();
  await (await getCollection()).insertOne(document);
 },
 async claim(token: string, now: Date) {
  assertMongoTokenScope();
  return record(await (await getCollection()).findOneAndUpdate(
   { token, consumedAt: null, expiresAt: { $gt: now } },
   { $set: { consumedAt: now } }, { returnDocument: 'after' }
  ));
 },
 async find(token: string) {
  assertMongoTokenScope();
  return record(await (await getCollection()).findOne({ token }));
 }
});
export class SingleUseTokenRepositoryError extends Error {
 constructor(public readonly code: 'SINGLE_USE_TOKEN_SCOPE' | 'SINGLE_USE_TOKEN_RECORD', message: string) { super(message); this.name = 'SingleUseTokenRepositoryError'; }
}
const unavailable = (): never => { throw new SingleUseTokenRepositoryError('SINGLE_USE_TOKEN_SCOPE', 'Email verification repository home plane or lifetime does not match'); };
const scopes = new AsyncLocalStorage<{ repository: SingleUseTokenRepository; active: boolean }>();
const assertMongoTokenScope = (): void => {
 const scope = scopes.getStore();
 if ((scope && (!scope.active || scope.repository.kind === 'native-home')) || currentUserIdentityRepository()) unavailable();
};
/** Internal explicit email-verification binding only; no runtime/API activation. */
export async function withHomeEmailVerificationRepository<T>(repository: SingleUseTokenRepository, homePlaneId: string, work: () => T | Promise<T>): Promise<T> {
 if (scopes.getStore() || typeof homePlaneId !== 'string' || !homePlaneId || repository.homePlaneId !== homePlaneId || typeof work !== 'function') return unavailable();
 const identity = currentUserIdentityRepository();
 if (identity) {
  if (identity.homePlaneId !== homePlaneId) return unavailable();
  assertSameHomeRepositoryProvider(identity, repository);
 }
 const scope = { repository, active: true };
 return scopes.run(scope, async () => { try { return await work(); } finally { scope.active = false; } });
}
export function assertEmailVerificationRepositoryScope(repository: SingleUseTokenRepository): void {
 const scope = scopes.getStore();
 if (!scope?.active || scope.repository !== repository) unavailable();
 const identity = currentUserIdentityRepository();
 if (identity) {
  if (identity.homePlaneId !== repository.homePlaneId) unavailable();
  assertSameHomeRepositoryProvider(identity, repository);
 }
}
export function currentEmailVerificationRepository(): SingleUseTokenRepository {
 const scope = scopes.getStore();
 if (scope) { if (!scope.active) return unavailable(); return scope.repository; }
 // A partially bound native request must never leak token writes into Mongo.
 if (currentUserIdentityRepository()) return unavailable();
 return mongoSingleUseTokenRepository(async () => {
  const { getEmailVerificationsCollection } = await import('../mongodb/collections');
  return getEmailVerificationsCollection();
 });
}
