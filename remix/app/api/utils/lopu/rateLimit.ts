import { createHash } from 'node:crypto';

import { ensureIndexes, getLopuMusingRateLimitsCollection } from '../mongodb/collections';

const LOPU_MUSING_LIMIT = 10;
const LOPU_MUSING_WINDOW_MS = 1000 * 60 * 60;

type RateLimitResult = {
  allowed: boolean;
  count: number;
  remaining: number;
  resetAt: string;
  reason?: 'limit' | 'rate-limit-unavailable';
};

const firstHeaderIp = (value: string | null) => value?.split(',')[0]?.trim() || '';

const getRequestIp = (request: Request) => {
  const h = request.headers;
  return (
    firstHeaderIp(h.get('x-vercel-forwarded-for')) ||
    firstHeaderIp(h.get('x-forwarded-for')) ||
    h.get('x-real-ip')?.trim() ||
    h.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
};

const hashIp = (ip: string) => createHash('sha256').update(ip).digest('hex');

const activeRequestsExpr = (windowStart: Date) => ({
  $filter: {
    input: { $ifNull: ['$requests', []] },
    as: 'requestAt',
    cond: { $gte: ['$$requestAt', windowStart] }
  }
});

const resetFromRequests = (requests: Date[], now: Date) => {
  const windowStartMs = now.getTime() - LOPU_MUSING_WINDOW_MS;
  const active = requests
    .map((value) => new Date(value))
    .filter((value) => value.getTime() >= windowStartMs)
    .sort((a, b) => a.getTime() - b.getTime());

  return new Date((active[0]?.getTime() ?? now.getTime()) + LOPU_MUSING_WINDOW_MS);
};

// Atomically consumes one AI-backed Lopu musing slot for the detected IP. When
// the quota cannot be checked, fail closed so the route serves the preset array
// instead of spending provider quota.
export const consumeLopuMusingQuota = async (request: Request): Promise<RateLimitResult> => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOPU_MUSING_WINDOW_MS);
  const expiresAt = new Date(now.getTime() + LOPU_MUSING_WINDOW_MS);
  const key = hashIp(getRequestIp(request));

  try {
    await ensureIndexes();
    const coll = await getLopuMusingRateLimitsCollection();

    await coll.updateOne(
      { key },
      {
        $setOnInsert: {
          key,
          type: 'tt.lopuMusingRateLimit',
          createdAt: now,
          requests: []
        },
        $set: {
          updatedAt: now,
          expiresAt
        }
      },
      { upsert: true }
    );

    const updated = await coll.findOneAndUpdate(
      {
        key,
        $expr: {
          $lt: [{ $size: activeRequestsExpr(windowStart) }, LOPU_MUSING_LIMIT]
        }
      },
      [
        {
          $set: {
            requests: { $concatArrays: [activeRequestsExpr(windowStart), [now]] },
            updatedAt: now,
            expiresAt
          }
        }
      ],
      { returnDocument: 'after' }
    );

    if (updated) {
      const count = Array.isArray(updated.requests) ? updated.requests.length : 0;
      return {
        allowed: true,
        count,
        remaining: Math.max(0, LOPU_MUSING_LIMIT - count),
        resetAt: resetFromRequests(updated.requests || [], now).toISOString()
      };
    }

    const current = await coll.findOne({ key });
    const requests = Array.isArray(current?.requests) ? current.requests : [];
    const count = requests.filter((value) => new Date(value).getTime() >= windowStart.getTime()).length;

    return {
      allowed: false,
      count,
      remaining: 0,
      resetAt: resetFromRequests(requests, now).toISOString(),
      reason: 'limit'
    };
  } catch (err) {
    console.warn('[lopu] rate limit unavailable; serving fallback musing', err);
    return {
      allowed: false,
      count: 0,
      remaining: 0,
      resetAt: expiresAt.toISOString(),
      reason: 'rate-limit-unavailable'
    };
  }
};
