import { createHash } from 'node:crypto';

import { ensureIndexes, getLopuMusingRateLimitsCollection, getWaitlistCollection } from '../mongodb/collections';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const JOINS_PER_IP_PER_HOUR = 20;
const WINDOW_MS = 1000 * 60 * 60;

const firstHeaderIp = (value: string | null) => value?.split(',')[0]?.trim() || '';

const getRequestIp = (request: Request) => {
  const h = request.headers;
  return (
    firstHeaderIp(h.get('x-vercel-forwarded-for')) ||
    firstHeaderIp(h.get('x-forwarded-for')) ||
    h.get('x-real-ip')?.trim() ||
    'unknown'
  );
};

// Simple fixed-window counter per hashed IP, stored in the existing TTL'd
// rate-limit collection (expiresAt index purges old windows).
const consumeJoinQuota = async (request: Request) => {
  const ipHash = createHash('sha256').update(getRequestIp(request)).digest('hex');
  const key = `waitlist:${ipHash}`;
  const now = new Date();
  try {
    const collection = await getLopuMusingRateLimitsCollection();
    const doc = await collection.findOneAndUpdate(
      { key, expiresAt: { $gt: now } },
      { $inc: { count: 1 }, $setOnInsert: { key, expiresAt: new Date(now.getTime() + WINDOW_MS) } },
      { upsert: true, returnDocument: 'after' }
    );
    const count = doc?.count ?? doc?.value?.count ?? 1;
    return count <= JOINS_PER_IP_PER_HOUR;
  } catch (error) {
    // Duplicate-key race on the unique index (expired doc) or transient DB
    // hiccup — fail open; the unique waitlist email index still dedupes.
    return true;
  }
};

type JoinResult = { ok: false; status: number; error: string } | { ok: true };

// Join the launch waitlist. Idempotent per email (unique index); the response
// deliberately doesn't reveal whether an email was already on the list.
export const joinWaitlist = async (request: Request, input: { email?: unknown }): Promise<JoinResult> => {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 254) : '';
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: 'A valid email address is required' };
  }

  if (!(await consumeJoinQuota(request))) {
    return { ok: false, status: 429, error: 'Too many signups from this connection — try again soon 🌈' };
  }

  await ensureIndexes();
  const waitlist = await getWaitlistCollection();
  try {
    await waitlist.insertOne({ email, createdAt: new Date() });
    return { ok: true };
  } catch (error: any) {
    if (error?.code === 11000) {
      return { ok: true };
    }
    throw error;
  }
};
