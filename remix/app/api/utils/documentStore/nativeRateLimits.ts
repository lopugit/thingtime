import { BSON } from 'mongodb';
import { assertSameHomeRepositoryProvider, registerHomeRepositoryProvider } from '../auth/homeRepositoryScope';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { mergeRateLimitConfig, normalizeRateLimitConfig, type RateLimitConfig } from '../rateLimit/config';
import { assertRateLimitRepositoryScope, currentRateLimitRepository, RateLimitRepositoryError, type RateLimitRepository, type WindowConsumption } from '../rateLimit/repository';
import type { ByteBudgetPersistence, ByteWindowConsumption } from '../rateLimit/byteBudget';
import type { CollectionProvider, CollectionTransaction, NativeCollection } from './collectionContract';
import { encodeCollectionDocument } from './collectionProvider';

const unavailable = (): never => { throw new RateLimitRepositoryError('RATE_LIMIT_UNAVAILABLE', 'Native rate-limit state or input is invalid'); };
const date = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const settings = physicalCollectionName('settings'), counters = physicalCollectionName('rateLimits');
const eq = (key: string) => ({ op: 'eq' as const, path: ['key'], value: key });
const one = (collection: NativeCollection, key: string): Record<string, any> | null => {
 const rows = collection.find({ filter: eq(key), limit: 2 }).documents;
 if (rows.length > 1) return unavailable();
 return rows.length ? BSON.deserialize(rows[0]) : null;
};
const configFrom = (row: Record<string, any> | null): RateLimitConfig => {
 if (!row) return normalizeRateLimitConfig(null);
 if (row.key !== 'rateLimits' || !row.endpoints || typeof row.endpoints !== 'object' || Array.isArray(row.endpoints)) return unavailable();
 for (const rule of Object.values(row.endpoints) as any[]) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || (rule.limit !== undefined && !Number.isFinite(rule.limit)) || (rule.windowMs !== undefined && !Number.isFinite(rule.windowMs)) || (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')) return unavailable();
 }
 if (row.uploadStartPolicyVersion !== undefined && (!Number.isSafeInteger(row.uploadStartPolicyVersion) || row.uploadStartPolicyVersion < 0)) return unavailable();
 return normalizeRateLimitConfig(row.endpoints, row.uploadStartPolicyVersion);
};
const save = (collection: NativeCollection, row: Record<string, any>, exists: boolean): void => {
 if (exists) {
  const result = collection.updateOne(eq(row.key), Object.entries(row).filter(([key]) => key !== '_id').map(([key, value]) => ({ op: 'set' as const, path: [key], value })));
  if (!result.matched) unavailable();
 } else collection.insert(encodeCollectionDocument(row));
};

/** A transaction-owned semantic adapter for sandbox writes. The caller owns the
 * provider transaction and must propagate failed admission to roll back content.
 * Collection handles additionally enforce their provider/transaction lifetime. */
export function nativeByteBudgetPersistenceInTransaction(collections: CollectionTransaction): ByteBudgetPersistence {
 const repository = currentRateLimitRepository();
 if (!repository) return unavailable();
 const assertActive = () => {
  assertRateLimitRepositoryScope(repository);
  assertSameHomeRepositoryProvider(repository, collections);
 };
 assertActive();
 const checkKey = (key: string) => { if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return unavailable(); };
 const priorWindow = (key: string) => {
  const prior = one(collections.collection(counters), key);
  if (prior && (prior.key !== key || !date(prior.createdAt) || !date(prior.updatedAt) || !date(prior.expiresAt) || !date(prior.bytesWindowStartedAt) || !Number.isSafeInteger(prior.bytes) || prior.bytes < 0)) return unavailable();
  return prior;
 };
 return {
  async readConfig() { assertActive(); return configFrom(one(collections.collection(settings), 'rateLimits')); },
  async consumeByteWindow(raw: ByteWindowConsumption) {
   assertActive();
   const { key, limitBytes, windowMs, charge, now } = BSON.deserialize(encodeCollectionDocument(raw, 'key'));
   checkKey(key);
   if (!Number.isSafeInteger(limitBytes) || limitBytes < 0 || !Number.isSafeInteger(charge) || charge < 0 || !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 86_400_000 || !date(now) || !date(new Date(now.getTime() + windowMs))) return unavailable();
   const prior = priorWindow(key), reset = !prior || prior.bytesWindowStartedAt.getTime() <= now.getTime() - windowMs;
   const started = reset ? now : prior!.bytesWindowStartedAt, bytes = reset ? 0 : prior!.bytes;
   const allowed = bytes <= limitBytes - charge, usedBytes = allowed ? bytes + charge : bytes;
   save(collections.collection(counters), { _id: prior?._id ?? key, key, createdAt: prior?.createdAt ?? now, bytesWindowStartedAt: started, bytes: usedBytes, updatedAt: now, expiresAt: new Date(now.getTime() + windowMs) }, !!prior);
   return { allowed, limitBytes, usedBytes, resetAt: new Date(started.getTime() + windowMs).toISOString() };
  },
  async refundByteWindow(raw: { key: string; charge: number }) {
   assertActive();
   const { key, charge } = BSON.deserialize(encodeCollectionDocument(raw, 'key')); checkKey(key);
   if (!Number.isSafeInteger(charge) || charge < 0) return unavailable();
   const prior = priorWindow(key);
   if (prior) save(collections.collection(counters), { ...prior, bytes: Math.max(0, prior.bytes - charge) }, true);
  }
 };
}

/** Real SQLite atomic sliding windows, including the canonical inclusive cutoff
 * and rejected-hit metadata (no rejected-hit charge). Current collection reads
 * scan O(n); key uniqueness is integrity, not query acceleration. Inactive rows
 * remain stored: no native TTL reaper is claimed. A stale request never counts.
 * No Mongo imports/drivers or runtime activation are provided by this adapter. */
export async function createNativeRateLimitRepository(provider: CollectionProvider, homePlaneId: string): Promise<RateLimitRepository> {
 if (typeof homePlaneId !== 'string' || !homePlaneId) return unavailable();
 await provider.transaction(transaction => {
  for (const namespace of [settings, counters]) transaction.defineCollection(namespace, { unique: [{ name: 'key', path: ['key'], sparse: false, multikey: false }] });
 });
 let repository: RateLimitRepository;
 const transaction = async <T>(work: (collections: CollectionTransaction) => T | Promise<T>): Promise<T> => {
  assertRateLimitRepositoryScope(repository);
  return provider.transaction(async collections => {
   assertRateLimitRepositoryScope(repository); const result = await work(collections);
   await Promise.resolve(); assertRateLimitRepositoryScope(repository); return result;
  });
 };
 repository = Object.freeze({
  homePlaneId,
  consumeByteWindow: async (input: ByteWindowConsumption) => {
   assertRateLimitRepositoryScope(repository);
   const accepted = BSON.deserialize(encodeCollectionDocument(input, 'key')) as ByteWindowConsumption;
   return transaction(collections => nativeByteBudgetPersistenceInTransaction(collections).consumeByteWindow(accepted));
  },
  refundByteWindow: async (input: { key: string; charge: number }) => {
   assertRateLimitRepositoryScope(repository);
   const accepted = BSON.deserialize(encodeCollectionDocument(input, 'key')) as { key: string; charge: number };
   return transaction(collections => nativeByteBudgetPersistenceInTransaction(collections).refundByteWindow(accepted));
  },
  readConfig: () => transaction(collections => configFrom(one(collections.collection(settings), 'rateLimits'))),
  async patchConfig(patch: RateLimitConfig, updatedBy: string) {
   assertRateLimitRepositoryScope(repository);
   // Admission snapshots validate all BSON input before any user hook or queued
   // transaction; mutations of caller-owned objects cannot alter accepted work.
   const input = BSON.deserialize(encodeCollectionDocument({ _id: 'patch', patch, updatedBy }));
   if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch) || typeof input.updatedBy !== 'string' || !input.updatedBy) return unavailable();
   return transaction(collections => {
    const collection = collections.collection(settings), prior = one(collection, 'rateLimits');
    const endpoints = mergeRateLimitConfig(configFrom(prior), input.patch);
    save(collection, { _id: prior?._id ?? 'rateLimits', key: 'rateLimits', endpoints, uploadStartPolicyVersion: 1, updatedAt: new Date(), updatedBy: input.updatedBy }, !!prior);
    return endpoints;
   });
  },
  async consumeWindow(raw: WindowConsumption) {
   assertRateLimitRepositoryScope(repository);
   const input = BSON.deserialize(encodeCollectionDocument(raw, 'key'));
   const { key, limit, windowMs, cost, now } = input;
   if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(limit) || limit < 1 || limit > 500_000 || !Number.isSafeInteger(cost) || cost < 1 || cost > limit || !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 86_400_000 || !date(now)) return unavailable();
   return transaction(collections => {
    const collection = collections.collection(counters), prior = one(collection, key);
    if (prior && (prior.key !== key || !date(prior.createdAt) || !date(prior.updatedAt) || !date(prior.expiresAt) || !Array.isArray(prior.requests) || !prior.requests.every(date))) return unavailable();
    const requests: Date[] = prior?.requests ?? [], cutoff = now.getTime() - windowMs;
    const active = requests.filter(at => at.getTime() >= cutoff), allowed = active.length + cost <= limit;
    const charged = allowed ? [...active, ...Array.from({ length: cost }, () => now)] : requests;
    save(collection, { _id: prior?._id ?? key, key, createdAt: prior?.createdAt ?? now, requests: charged, updatedAt: now, expiresAt: new Date(now.getTime() + windowMs) }, !!prior);
    const counted = allowed ? charged : active;
    const first = counted.reduce((value, at) => Math.min(value, at.getTime()), Infinity);
    return { allowed, limit, remaining: allowed ? Math.max(0, limit - charged.length) : 0, resetAt: new Date((Number.isFinite(first) ? first : now.getTime()) + windowMs).toISOString() };
   });
  }
 });
 registerHomeRepositoryProvider(repository, provider); return repository;
}
