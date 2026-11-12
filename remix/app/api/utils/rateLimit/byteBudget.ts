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

export const consumeByteBudget = async (name: string, bytes: number): Promise<ByteBudgetOutcome> => {
  const config = await getRateLimitConfig();
  const rule = config[name];
  const nowIso = new Date().toISOString();
  if (!rule || !rule.enabled) {
    // Disabled = unlimited, mirroring enforce.ts (the kill switch must be its
    // own deliberate act, never a side effect of a limiter hiccup).
    return { allowed: true, limitBytes: 0, usedBytes: 0, resetAt: nowIso };
  }
  const limitBytes = rule.limit * 1024 * 1024;
  const charge = Math.max(0, Math.floor(bytes));

  try {
    await ensureIndexes();
    const coll = await getRateLimitsCollection();
    const key = hash(`bytes:${name}`);
    const now = new Date();
    const windowStart = new Date(now.getTime() - rule.windowMs);
    const expiresAt = new Date(now.getTime() + rule.windowMs);

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
        resetAt: new Date(new Date(admitted.bytesWindowStartedAt ?? now).getTime() + rule.windowMs).toISOString()
      };
    }
    const current = await coll.findOne({ key });
    return {
      allowed: false,
      limitBytes,
      usedBytes: current?.bytes ?? limitBytes,
      resetAt: new Date(new Date(current?.bytesWindowStartedAt ?? now).getTime() + rule.windowMs).toISOString()
    };
  } catch {
    return { allowed: false, limitBytes, usedBytes: 0, resetAt: nowIso, unavailable: true };
  }
};

// Refund bytes into the window (a charged write that ultimately failed) —
// floored at zero, best-effort.
export const refundByteBudget = async (name: string, bytes: number): Promise<void> => {
  const charge = Math.max(0, Math.floor(bytes));
  if (!charge) return;
  try {
    const coll = await getRateLimitsCollection();
    await coll.updateOne({ key: hash(`bytes:${name}`) }, [
      { $set: { bytes: { $max: [0, { $subtract: [{ $ifNull: ['$bytes', 0] }, charge] }] } } }
    ]);
  } catch {
    // best-effort: an unrefunded failure only makes the brake tighter
  }
};
