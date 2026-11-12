import { currentRateLimitRepository } from './repository';
import type { RateLimitConfig } from './config';
import { createHash } from 'node:crypto';

import { ensureIndexes, getRateLimitsCollection } from '../mongodb/collections';
import { getRateLimitConfig } from './config';

// Windowed BYTE budgets over the shared rateLimits collection — the sibling of
// enforce.ts for rules whose unit is storage, not request count. A rule's
// `limit` is interpreted as MEGABYTES per window (so the admin panel's numbers
// stay small), the window is FIXED (rolls when stale — an emergency brake
// doesn't need sliding precision), admission is a guarded atomic $inc (racing
// writes can never overshoot), and the outcome FAILS CLOSED: byte budgets
// guard standing storage, so an unavailable ledger refuses the write.

export type ByteBudgetOutcome = {
  allowed: boolean;
  limitBytes: number;
  usedBytes: number;
  resetAt: string;
  unavailable?: boolean;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Semantic persistence boundary: no Mongo query translation in native callers. */
export type ByteWindowConsumption = { key: string; limitBytes: number; windowMs: number; charge: number; now: Date };
export interface ByteBudgetPersistence {
  readConfig(): Promise<RateLimitConfig>;
  consumeByteWindow(input: ByteWindowConsumption): Promise<ByteBudgetOutcome>;
  refundByteWindow(input: { key: string; charge: number }): Promise<void>;
}

export const consumeByteBudgetUsing = async (persistence: ByteBudgetPersistence, name: string, bytes: number): Promise<ByteBudgetOutcome> => {
  const nowIso = new Date().toISOString();
  let limitBytes = 0;
  try {
    const rule = (await persistence.readConfig())[name];
    if (!rule || !rule.enabled) return { allowed: true, limitBytes: 0, usedBytes: 0, resetAt: nowIso };
    limitBytes = rule.limit * 1024 * 1024;
    const charge = Math.max(0, Math.floor(bytes));
    if (!Number.isSafeInteger(charge) || !Number.isSafeInteger(limitBytes) || limitBytes < 0) throw Error('Invalid byte budget');
    return await persistence.consumeByteWindow({ key: hash(`bytes:${name}`), limitBytes, windowMs: rule.windowMs, charge, now: new Date() });
  } catch {
    return { allowed: false, limitBytes, usedBytes: 0, resetAt: nowIso, unavailable: true };
  }
};

const hostedByteBudgetPersistence: ByteBudgetPersistence = {
  readConfig: getRateLimitConfig,
  async consumeByteWindow({ key, limitBytes, windowMs, charge, now }) {
    await ensureIndexes();
    const coll = await getRateLimitsCollection();
    const windowStart = new Date(now.getTime() - windowMs);
    const expiresAt = new Date(now.getTime() + windowMs);

    await coll.updateOne(
      { key },
      { $setOnInsert: { key, createdAt: now, bytesWindowStartedAt: now, bytes: 0 }, $set: { updatedAt: now, expiresAt } },
      { upsert: true }
    );
    // roll a stale window before admitting into it
    await coll.updateOne(
      { key, bytesWindowStartedAt: { $lte: windowStart } },
      { $set: { bytesWindowStartedAt: now, bytes: 0 } }
    );

    const admitted = await coll.findOneAndUpdate(
      { key, bytes: { $lte: limitBytes - charge } },
      { $inc: { bytes: charge }, $set: { updatedAt: now, expiresAt } },
      { returnDocument: 'after' }
    );
    if (admitted) {
      return {
        allowed: true,
        limitBytes,
        usedBytes: admitted.bytes ?? charge,
        resetAt: new Date(new Date(admitted.bytesWindowStartedAt ?? now).getTime() + windowMs).toISOString()
      };
    }
    const current = await coll.findOne({ key });
    return {
      allowed: false,
      limitBytes,
      usedBytes: current?.bytes ?? limitBytes,
      resetAt: new Date(new Date(current?.bytesWindowStartedAt ?? now).getTime() + windowMs).toISOString()
    };
  },
  async refundByteWindow({ key, charge }) {
    const coll = await getRateLimitsCollection();
    await coll.updateOne({ key }, [
      { $set: { bytes: { $max: [0, { $subtract: [{ $ifNull: ['$bytes', 0] }, charge] }] } } }
    ]);
  }
};

export const consumeByteBudget = async (name: string, bytes: number): Promise<ByteBudgetOutcome> => {
  try { return await consumeByteBudgetUsing(currentRateLimitRepository() ?? hostedByteBudgetPersistence, name, bytes); }
  catch { return { allowed: false, limitBytes: 0, usedBytes: 0, resetAt: new Date().toISOString(), unavailable: true }; }
};

// Refund bytes into the window (a charged write that ultimately failed) —
// floored at zero, best-effort.
export const refundByteBudget = async (name: string, bytes: number): Promise<void> => {
  const charge = Math.max(0, Math.floor(bytes));
  if (!Number.isSafeInteger(charge) || !charge) return;
  try {
    await (currentRateLimitRepository() ?? hostedByteBudgetPersistence).refundByteWindow({ key: hash(`bytes:${name}`), charge });
  } catch {
    // best-effort: an unrefunded failure only makes the brake tighter
  }
};
