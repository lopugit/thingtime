import { createHash } from 'node:crypto';

import { getRateLimitsCollection } from '../mongodb/collections';
import { getRateLimitConfig } from './config';

// General per-endpoint rate limiter, config-driven (config.ts). Atomic
// sliding-window over the shared `rateLimits` collection — the same technique as
// the Lopu-musing limiter, generalised and keyed by endpoint + identity
// (authenticated user id, else hashed IP). Ordinary actions fail open if the
// limiter DB hiccups; expensive or sensitive endpoints can opt into failClosed.

export type RateLimitOutcome = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  unavailable?: boolean;
};

const firstHeaderIp = (value: string | null) => value?.split(',')[0]?.trim() || '';

const getRequestIp = (request: Request): string => {
  const h = request.headers;
  return (
    firstHeaderIp(h.get('x-vercel-forwarded-for')) ||
    firstHeaderIp(h.get('x-forwarded-for')) ||
    h.get('x-real-ip')?.trim() ||
    h.get('cf-connecting-ip')?.trim() ||
    'unknown'
  );
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const activeRequestsExpr = (windowStart: Date) => ({
  $filter: {
    input: { $ifNull: ['$requests', []] },
    as: 'requestAt',
    cond: { $gte: ['$$requestAt', windowStart] }
  }
});

const resetFrom = (requests: Date[], now: Date, windowMs: number): Date => {
  const windowStartMs = now.getTime() - windowMs;
  const active = requests
    .map((value) => new Date(value))
    .filter((value) => value.getTime() >= windowStartMs)
    .sort((a, b) => a.getTime() - b.getTime());
  return new Date((active[0]?.getTime() ?? now.getTime()) + windowMs);
};

// Atomically record one hit for `key` if under `limit` within `windowMs`.
const consume = async (key: string, limit: number, windowMs: number): Promise<RateLimitOutcome> => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const expiresAt = new Date(now.getTime() + windowMs);
  const coll = await getRateLimitsCollection();

  await coll.updateOne(
    { key },
    { $setOnInsert: { key, createdAt: now, requests: [] }, $set: { updatedAt: now, expiresAt } },
    { upsert: true }
  );

  const updated = await coll.findOneAndUpdate(
    { key, $expr: { $lt: [{ $size: activeRequestsExpr(windowStart) }, limit] } },
    [{ $set: { requests: { $concatArrays: [activeRequestsExpr(windowStart), [now]] }, updatedAt: now, expiresAt } }],
    { returnDocument: 'after' }
  );

  if (updated) {
    const count = Array.isArray(updated.requests) ? updated.requests.length : 0;
    return { allowed: true, limit, remaining: Math.max(0, limit - count), resetAt: resetFrom(updated.requests || [], now, windowMs).toISOString() };
  }

  const current = await coll.findOne({ key });
  const requests = Array.isArray(current?.requests) ? current!.requests : [];
  return { allowed: false, limit, remaining: 0, resetAt: resetFrom(requests, now, windowMs).toISOString() };
};

// Enforce the configured limit for `name` against `identity` (a stable id like
// `user:<id>`; falls back to the request IP). Returns allowed=true when the
// endpoint's rule is disabled or the limiter is unavailable, unless the caller
// explicitly asks to fail closed.
export const enforceRateLimit = async (
  request: Request,
  name: string,
  identity: string | null,
  options: { failClosed?: boolean } = {}
): Promise<RateLimitOutcome> => {
  const config = await getRateLimitConfig();
  const rule = config[name];
  const now = new Date().toISOString();
  if (!rule || !rule.enabled) {
    return { allowed: true, limit: rule?.limit ?? 0, remaining: rule?.limit ?? 0, resetAt: now };
  }
  const who = identity || `ip:${getRequestIp(request)}`;
  try {
    return await consume(hash(`${name}:${who}`), rule.limit, rule.windowMs);
  } catch {
    if (options.failClosed) {
      return { allowed: false, limit: rule.limit, remaining: 0, resetAt: now, unavailable: true };
    }
    // Ordinary user actions fail open so a limiter outage cannot seize up the
    // app; especially expensive/admin-sensitive routes can opt into failClosed.
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt: now };
  }
};

// Convenience: a 429 JSON body + headers for a blocked outcome.
export const rateLimitedResponseInit = (outcome: RateLimitOutcome) => ({
  status: 429,
  headers: {
    'Retry-After': String(Math.max(1, Math.ceil((new Date(outcome.resetAt).getTime() - Date.now()) / 1000)))
  }
});
