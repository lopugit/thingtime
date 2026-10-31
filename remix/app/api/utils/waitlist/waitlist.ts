import { createHash, randomUUID } from 'node:crypto';

// waitlist is a PROTECTED system kind: waitlist things stay on the home
// deployment DB even while a data-plane endpoint override is active.
import {
  getHomeThingsCollection as getThingsCollection,
  getLopuMusingRateLimitsCollection,
  getWaitlistCollection
} from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { toBin } from '../auth/users';

// Waitlist entries are THINGS now (thingtime ['waitlist'], see
// TODO/claude-todo/22-everything-is-a-thing-collections.md):
// the crystal stays empty by design, the email lives ONLY under the root
// `secure` field as BinData (the $** text index tokenizes every string field —
// binary is invisible to it), and uniqueness rides a hashed uniqueKey. The key
// is scoped with a 'waitlist-' prefix so joining the waitlist never collides
// with the same address registered as an account (user things use
// 'email:<hash>'). Entries are system-owned and owner-only (ownerId 'system',
// acl ['tt:user']) so no viewer ever matches them through any read path.
// Reads stay dual-era: pre-things signups live in the legacy `waitlist`
// collection, which is frozen (nothing writes to it anymore) but still
// consulted so a legacy email never mints a second entry.

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
      {
        $inc: { count: 1 },
        $setOnInsert: {
          key,
          expiresAt: new Date(now.getTime() + WINDOW_MS),
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.lopuMusingRateLimits
        }
      },
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

// hashed like auth/users' userEmailKey AND BinData (auth/users' canonical
// toBin) like every uniqueKey — plain-string keys would tokenize into the text
// index and make the entries enumerable via their prefix token. Exported so
// the waitlist-to-things admin migration mints byte-identical keys.
export const waitlistEmailKey = (email: string) =>
  toBin(`waitlist-email:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`);

// Join the launch waitlist. Idempotent per email (unique uniqueKeys index +
// frozen legacy collection check); the response deliberately doesn't reveal
// whether an email was already on the list.
export const joinWaitlist = async (request: Request, input: { email?: unknown }): Promise<JoinResult> => {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 254) : '';
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: 'A valid email address is required' };
  }

  if (!(await consumeJoinQuota(request))) {
    return { ok: false, status: 429, error: 'Too many signups from this connection — try again soon 🌈' };
  }

  // dual-era dedupe: emails that joined before the things era live in the
  // legacy waitlist collection (indexed { email: 1 } lookup) — never mint a
  // second, things-era entry for them. Check-then-insert is race-safe here
  // because legacy is frozen: a concurrent join can only race on the things
  // uniqueKeys index, which the 11000 catch below already treats as success.
  const legacy = await getWaitlistCollection();
  if (await legacy.findOne({ email })) {
    return { ok: true };
  }

  const things = await getThingsCollection();
  const now = new Date();
  try {
    await things.insertOne({
      shareId: randomUUID(),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      thingtime: ['waitlist'],
      crystal: {},
      // system-owned + owner-only: 'system' is never minted as a real user id,
      // so no viewer matches these through list/search/share paths
      ownerId: 'system',
      acl: [ACL_OWNER],
      targetId: null,
      tags: [],
      uniqueKeys: [waitlistEmailKey(email)],
      secure: { email: toBin(email) },
      createdAt: now,
      updatedAt: now
    } as any);
    return { ok: true };
  } catch (error: any) {
    if (error?.code === 11000) {
      return { ok: true };
    }
    throw error;
  }
};
