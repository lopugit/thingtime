// Durable, home-plane recovery. The queue/fence transaction creates this job;
// waitUntil only reduces latency. The existing five-minute scheduler resumes
// jobs after a request/process disappears, without holding customer writes open.
import { createHash, randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, STORAGE_RECOVERY_THINGTIME } from '../../../schemas/registry';
import { getHomeThingsCollection } from '../mongodb/collections';
import { runWithHomeMongoEndpoint } from '../mongodb/endpoint';
import { withGatewayWork } from '../deployment/environmentGateway';
import { subscriptionThingMatch, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from './storageCore';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_ACCOUNTS = 10;
const SCHEDULER_BUDGET_MS = 45_000;
const JOB_FIELDS = ['quotaKind', 'status', 'attempts', 'generation', 'revision', 'nextAttemptAt', 'leaseId', 'leaseUntil', 'afterShareId', 'lastReason', 'baselineReconciledAt'];
const ROOT_FIELDS = ['_id', 'shareId', 'ownerId', 'thingtime', 'schemaVersion', 'acl', 'storageClass', 'tags', 'targetId', 'crystal', 'createdAt', 'updatedAt'];
const STATES = ['queued', 'running', 'retry', 'blocked', 'ready'];
const REASONS = ['schema-migration-required', 'invalid-source', 'ledger-unavailable', 'recovery-failed', 'retry-exhausted'];
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const whole = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export const userStorageRecoveryId = (ownerId: string) => `storage-recovery-${createHash('sha256').update(ownerId).digest('hex')}`;
const identity = (ownerId: string) => ({ shareId: userStorageRecoveryId(ownerId), ownerId, thingtime: [STORAGE_RECOVERY_THINGTIME] });
export const userStorageRecoveryJobIsTrusted = (doc: any): boolean => {
  const c = doc?.crystal;
  return !!doc && typeof doc.ownerId === 'string' && !!doc.ownerId && !doc.ownerId.startsWith('sandbox:') &&
    doc.shareId === userStorageRecoveryId(doc.ownerId) && Object.keys(doc).every(key => ROOT_FIELDS.includes(key)) &&
    doc.schemaVersion === COLLECTION_SCHEMA_VERSIONS.things && Array.isArray(doc.thingtime) && doc.thingtime.length === 1 && doc.thingtime[0] === STORAGE_RECOVERY_THINGTIME &&
    Array.isArray(doc.acl) && doc.acl.length === 1 && doc.acl[0] === ACL_OWNER && doc.storageClass === 'control' &&
    Array.isArray(doc.tags) && doc.tags.length === 0 && doc.targetId === null && validDate(doc.createdAt) && validDate(doc.updatedAt) &&
    !!c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).every(key => JOB_FIELDS.includes(key)) &&
    c.quotaKind === STORAGE_RECOVERY_THINGTIME && STATES.includes(c.status) && whole(c.attempts) && c.attempts <= MAX_ATTEMPTS &&
    whole(c.generation) && whole(c.revision) && validDate(c.nextAttemptAt) &&
    (c.afterShareId === undefined || (typeof c.afterShareId === 'string' && !!c.afterShareId)) &&
    (c.lastReason === undefined || REASONS.includes(c.lastReason)) &&
    (c.baselineReconciledAt === undefined || validDate(c.baselineReconciledAt)) &&
    (c.status === 'running' ? typeof c.leaseId === 'string' && !!c.leaseId && validDate(c.leaseUntil) : c.leaseId === undefined && c.leaseUntil === undefined);
};

type RecoveryResult = { state: 'ready' | 'pending' | 'blocked'; stamped: number; afterShareId?: string; reason?: string };
type RecoveryDependencies = {
  collection: () => Promise<any>;
  now: () => Date;
  leaseId: () => string;
  recover: (ownerId: string, options: { assertLease: (session: any) => Promise<void>; maxDocuments: number; deadlineAt: number; afterShareId?: string }) => Promise<RecoveryResult>;
};
class RecoveryLeaseLost extends Error {}

export const createUserStorageRecoveryWorker = (dependencies: RecoveryDependencies) => {
  const { collection, now, leaseId, recover } = dependencies;
  const ensure = async (ownerId: string, session: any) => {
    if (!session || (typeof session.inTransaction === 'function' && !session.inTransaction())) throw new Error('Storage recovery scheduling requires a transaction');
    if (!ownerId || ownerId.startsWith('sandbox:')) return;
    const things = await collection();
    const stamp = now();
    const existing = await things.findOne(identity(ownerId), { session });
    const ledger = await things.findOne(subscriptionThingMatch('user', ownerId), { session });
    const baseline = ledger && userSubscriptionLedgerEnvelopeIsTrusted(ledger, ownerId) &&
      ledger.crystal?.storageAccountingVersion === USER_STORAGE_ACCOUNTING_VERSION &&
      [USER_STORAGE_STATUS.ready, USER_STORAGE_STATUS.needsReconcile].includes(ledger.crystal?.storageLedgerStatus) &&
      validDate(ledger.crystal?.storageReconciledAt) ? ledger.crystal.storageReconciledAt as Date : null;
    if (existing) {
      // Never repair a squatted/malformed operational record into authority.
      if (!userStorageRecoveryJobIsTrusted(existing) || existing.crystal.generation >= Number.MAX_SAFE_INTEGER) throw new Error('Storage recovery job is invalid');
      // A canonical migration/exact reconciliation can repair a blocked source.
      // New writes alone never rearm failures: only a newer protected exact
      // baseline permits a fresh bounded retry budget.
      const repairedBaseline = baseline && baseline > (existing.crystal.baselineReconciledAt ?? existing.createdAt);
      const reset = existing.crystal.status === 'ready' || (existing.crystal.status === 'blocked' && repairedBaseline);
      const updated = await things.updateOne({ ...identity(ownerId), crystal: existing.crystal }, {
        $inc: { 'crystal.generation': 1 },
        $set: { updatedAt: stamp, ...(reset ? { 'crystal.status': 'queued', 'crystal.attempts': 0, 'crystal.nextAttemptAt': stamp, ...(baseline ? { 'crystal.baselineReconciledAt': baseline } : {}) } : {}) },
        ...(reset ? { $unset: { 'crystal.afterShareId': '', 'crystal.lastReason': '' } } : {})
      }, { session });
      if (updated.matchedCount !== 1) throw new Error('Storage recovery scheduling conflicted');
      return;
    }
    await things.insertOne({ ...identity(ownerId), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER],
      storageClass: 'control', tags: [], targetId: null, createdAt: stamp, updatedAt: stamp,
      crystal: { quotaKind: STORAGE_RECOVERY_THINGTIME, status: 'queued', attempts: 0, generation: 1, revision: 0, nextAttemptAt: stamp, ...(baseline ? { baselineReconciledAt: baseline } : {}) }
    }, { session });
  };
  const run = async (ownerId: string, deadlineAt?: number): Promise<'ready' | 'pending' | 'blocked' | 'skipped'> => {
    const things = await collection();
    const prior = await things.findOne(identity(ownerId));
    const stamp = now();
    if ((deadlineAt !== undefined && stamp.getTime() >= deadlineAt) || !userStorageRecoveryJobIsTrusted(prior) || ['ready', 'blocked'].includes(prior.crystal.status) ||
      prior.crystal.nextAttemptAt > stamp || (prior.crystal.status === 'running' && prior.crystal.leaseUntil > stamp)) return 'skipped';
    if (prior.crystal.attempts >= MAX_ATTEMPTS) {
      await things.updateOne({ ...identity(ownerId), crystal: prior.crystal }, { $set: {
        'crystal.status': 'blocked', 'crystal.lastReason': 'retry-exhausted', updatedAt: stamp
      }, $unset: { 'crystal.leaseId': '', 'crystal.leaseUntil': '' } });
      return 'blocked';
    }
    const token = leaseId();
    const job = await things.findOneAndUpdate({ ...identity(ownerId), crystal: prior.crystal }, {
      $set: { 'crystal.status': 'running', 'crystal.leaseId': token, 'crystal.leaseUntil': new Date(stamp.getTime() + LEASE_MS), updatedAt: stamp },
      $inc: { 'crystal.attempts': 1 }
    }, { returnDocument: 'after' });
    if (!job) return 'skipped';
    const leased = () => ({ ...identity(ownerId), 'crystal.status': 'running', 'crystal.leaseId': token, 'crystal.leaseUntil': { $gt: now() } });
    const assertLease = async (session: any) => {
      if (!session) throw new RecoveryLeaseLost();
      // A read alone cannot fence a stale snapshot. Writing this same row in
      // every source/census transaction conflicts with successor lease claims.
      const touched = await things.updateOne(leased(), { $inc: { 'crystal.revision': 1 }, $set: { updatedAt: now() } }, { session });
      if (touched.matchedCount !== 1) throw new RecoveryLeaseLost();
    };
    try {
      const result = await recover(ownerId, { assertLease, maxDocuments: 100, deadlineAt: Math.min(stamp.getTime() + LEASE_MS - 10_000, deadlineAt ?? Infinity), ...(job.crystal.afterShareId ? { afterShareId: job.crystal.afterShareId } : {}) });
      // New queued content after the final census must not be lost when this
      // worker marks its job done. Compare the enqueue generation atomically.
      const current = await things.findOne(leased());
      if (!current) return 'skipped';
      const changed = current.crystal.generation !== job.crystal.generation;
      const status = result.state === 'ready' && changed ? 'queued' : result.state === 'pending' ? 'queued' : result.state;
      const finished = await things.updateOne({ ...leased(), 'crystal.generation': current.crystal.generation }, {
        $set: { 'crystal.status': status, 'crystal.attempts': 0, 'crystal.nextAttemptAt': new Date(now().getTime() + (status === 'queued' ? 1_000 : 0)), updatedAt: now(),
          ...(result.state === 'pending' && result.afterShareId ? { 'crystal.afterShareId': result.afterShareId } : {}),
          ...(result.state === 'blocked' ? { 'crystal.lastReason': REASONS.includes(result.reason || '') ? result.reason : 'recovery-failed' } : {}) },
        $unset: { 'crystal.leaseId': '', 'crystal.leaseUntil': '',
          ...(!(result.state === 'pending' && result.afterShareId) ? { 'crystal.afterShareId': '' } : {}),
          ...(result.state !== 'blocked' ? { 'crystal.lastReason': '' } : {}) }
      });
      return finished.matchedCount === 1 ? status === 'queued' ? 'pending' : status : 'skipped';
    } catch (error) {
      if (error instanceof RecoveryLeaseLost) return 'skipped';
      const exhausted = job.crystal.attempts >= MAX_ATTEMPTS;
      await things.updateOne(leased(), { $set: {
        'crystal.status': exhausted ? 'blocked' : 'retry', 'crystal.lastReason': exhausted ? 'retry-exhausted' : 'recovery-failed',
        'crystal.nextAttemptAt': new Date(now().getTime() + Math.min(60 * 60_000, 30_000 * 2 ** (job.crystal.attempts - 1))), updatedAt: now()
      }, $unset: { 'crystal.leaseId': '', 'crystal.leaseUntil': '' } });
      // Persist only a fixed reason. Driver/provider errors can contain secrets.
      return exhausted ? 'blocked' : 'pending';
    }
  };
  return { ensure, run };
};

const worker = createUserStorageRecoveryWorker({ collection: getHomeThingsCollection, now: () => new Date(), leaseId: randomUUID,
  recover: async (ownerId, options) => (await import('./userStorage')).recoverUserStorageAccounting(ownerId, options)
});
export const ensureUserStorageRecoveryJob = worker.ensure;

export const scheduleUserStorageRecovery = (ownerId: string): void => {
  if (!ownerId || ownerId.startsWith('sandbox:')) return;
  const work = withGatewayWork(() => runWithHomeMongoEndpoint(() => worker.run(ownerId))).catch(() => undefined);
  waitUntil(work);
};

// No new timer/process: the existing authenticated five-minute automation route
// resumes durable jobs. A bounded census also discovers pre-deployment fences.
export const runUserStorageRecovery = () => withGatewayWork(() => runWithHomeMongoEndpoint(async () => {
  const deadlineAt = Date.now() + SCHEDULER_BUDGET_MS;
  const things = await getHomeThingsCollection();
  const ledgers = await things.aggregate([
    { $match: { thingtime: 'subscription', 'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
      'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile } },
    { $lookup: { from: things.collectionName, let: { owner: '$ownerId' }, pipeline: [
      { $match: { thingtime: STORAGE_RECOVERY_THINGTIME, $expr: { $eq: ['$ownerId', '$$owner'] } } },
      { $project: { _id: 1 } }, { $limit: 1 }
    ], as: '_recoveryJobs' } },
    { $match: { '_recoveryJobs.0': { $exists: false } } },
    { $limit: MAX_ACCOUNTS }, { $project: { _recoveryJobs: 0 } }
  ], { maxTimeMS: 5_000 }).toArray();
  let discoveryFailures = 0;
  for (const ledger of ledgers) {
    const ownerId = ledger.ownerId;
    if (typeof ownerId !== 'string' || !userSubscriptionLedgerEnvelopeIsTrusted(ledger, ownerId)) continue;
    // The normal fence transaction owns job creation. For historical fences,
    // acquire the exact current ledger in a home transaction before discovery.
    const { withHomeMongoTransaction } = await import('../mongodb/collections');
    try { await withHomeMongoTransaction(async session => {
      const current = await things.findOne(subscriptionThingMatch('user', ownerId), { session });
      if (current?.crystal?.storageLedgerStatus === USER_STORAGE_STATUS.needsReconcile && userSubscriptionLedgerEnvelopeIsTrusted(current, ownerId)) {
        await worker.ensure(ownerId, session);
      }
    }); } catch { discoveryFailures++; }
  }
  const dueAt = new Date();
  const due = await things.find({ thingtime: STORAGE_RECOVERY_THINGTIME,
    $or: [{ 'crystal.status': { $in: ['queued', 'retry'] } }, { 'crystal.status': 'running', 'crystal.leaseUntil': { $lte: dueAt } }],
    'crystal.nextAttemptAt': { $lte: dueAt } }, { maxTimeMS: 5_000 }).sort({ 'crystal.nextAttemptAt': 1, shareId: 1 }).limit(MAX_ACCOUNTS).toArray();
  const summary = { ready: 0, pending: 0, blocked: 0, skipped: discoveryFailures };
  for (const job of due) {
    if (Date.now() >= deadlineAt) break;
    try { summary[await worker.run(job.ownerId, deadlineAt)]++; } catch { summary.skipped++; }
  }
  return summary;
}));
