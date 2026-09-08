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

// Exported: the canonical request-IP reader (views.ts keys anonymous view
// dedup off it too — do not add more per-module copies).
export const getRequestIp = (request: Request): string => {
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
  } catch (err: any) {
    // Fail-open is deliberate, but NEVER silent: a limiter collection outage
    // must name the affected rule. Index creation is handled independently by
    // boot/bootstrap paths and is no longer awaited here.
    console.error(
      `[rate-limit] enforcement unavailable for ${name} — failing ${options.failClosed ? 'closed' : 'open'}:`,
      err?.message || err
    );
    if (options.failClosed) {
      return { allowed: false, limit: rule.limit, remaining: 0, resetAt: now, unavailable: true };
    }
    // Ordinary user actions fail open so a limiter outage cannot seize up the
    // app; especially expensive/admin-sensitive routes can opt into failClosed.
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt: now };
  }
};

// Non-configurable ceiling for credential-confirmation surfaces. Unlike the
// admin-editable endpoint limits, a browser session that can reach admin tools
// cannot disable this bucket before attempting password guesses. These callers
// are security-sensitive enough to fail closed on any limiter outage.
export const enforceFixedRateLimit = async (
	request: Request,
	name: string,
	identity: string | null,
	rule: { limit: number; windowMs: number }
): Promise<RateLimitOutcome> => {
	const limit = Math.max(1, Math.min(100, Math.floor(rule.limit)));
	const windowMs = Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Math.floor(rule.windowMs)));
	const who = identity || `ip:${getRequestIp(request)}`;
	try {
		return await consume(hash(`fixed:${name}:${who}`), limit, windowMs);
	} catch (error: any) {
		console.error(`[rate-limit] fixed enforcement unavailable for ${name} — failing closed:`, error?.message || error);
		return { allowed: false, limit, remaining: 0, resetAt: new Date().toISOString(), unavailable: true };
	}
};

// Server-resolved subscription entitlement, not an admin-editable endpoint
// default or a client-supplied tier. The key intentionally excludes tier/token
// so changing plans, sessions, devices, or IPs cannot reset account usage.
export const enforceQuotaRateLimit = async (
  name: string,
  userId: string,
  limit: number
): Promise<RateLimitOutcome> => {
  const windowMs = 60 * 60_000;
  const resetAt = new Date(Date.now() + windowMs).toISOString();
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 11_000)
    return { allowed: false, limit: 0, remaining: 0, resetAt };
  try {
    return await consume(hash(`quota:${name}:user:${userId}`), limit, windowMs);
  } catch {
    return { allowed: false, limit, remaining: 0, resetAt, unavailable: true };
  }
};

// Convenience: a 429 JSON body + headers for a blocked outcome.
export const rateLimitedResponseInit = (outcome: RateLimitOutcome) => ({
  status: 429,
  headers: {
    'Retry-After': String(Math.max(1, Math.ceil((new Date(outcome.resetAt).getTime() - Date.now()) / 1000)))
  }
});
