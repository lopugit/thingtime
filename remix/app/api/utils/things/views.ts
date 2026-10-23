import { createHash } from 'node:crypto';

import { getPostViewsCollection, getThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { getRequestIp } from '../rateLimit/enforce';
import { aclAllows, aclFromVisibility, ACL_ALL, ACL_INHERIT } from '~/schemas/registry';
import type { AclViewer } from '~/schemas/registry';

// Post view telemetry: one postViews doc per (postId, viewerKey), so the
// public "views" number is UNIQUE VIEWERS — the manipulation-resistant count
// (replaying events only bumps impressions, which the rate limiter bounds;
// inflating uniques needs distinct accounts or distinct IP+UA pairs).
//
// Anti-bot / anti-manipulation layers, server side (the client is untrusted):
//   1. rate limit `things.views` per user-or-hashed-IP (route-level)
//   2. unique (postId, viewerKey) dedup — the count that matters can't be
//      replayed from one identity
//   3. owner self-views dropped entirely (owners can't inflate their own posts)
//   4. anonymous events without a plausible User-Agent are dropped
//   5. dwell clamped per event, event batch capped, unknown posts and posts
//      the viewer can't see are dropped (no probing private posts either —
//      a view write is only accepted where a read would succeed)
//   6. anonymous identities are salted sha256(ip|ua) — no raw IP at rest
//
// The client adds its own honesty layers (>=50% visible for >=1s, one event
// per post per pageview, navigator.webdriver skip) but nothing here trusts it.

const MAX_EVENTS_PER_BATCH = 50;
const MAX_DWELL_MS_PER_EVENT = 120_000;
const MIN_ANON_UA_CHARS = 8;
// Obfuscation salt for at-rest anon keys (env-overridable). Not a secret in
// the auth sense — it just makes offline IP enumeration non-trivial.
const ANON_SALT = process.env.VIEWS_HASH_SALT || 'tt-views-v1';

export type ViewEventInput = { id?: unknown; dwellMs?: unknown; ratio?: unknown; pos?: unknown };

type CleanEvent = { id: string; dwellMs: number; ratio: number; pos: number | null };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const sanitizeEvents = (raw: unknown): CleanEvent[] => {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CleanEvent>();
  for (const entry of raw.slice(0, MAX_EVENTS_PER_BATCH)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, dwellMs, ratio, pos } = entry as ViewEventInput;
    if (typeof id !== 'string' || !id.trim() || id.length > 128) continue;
    const clean: CleanEvent = {
      id: id.trim(),
      dwellMs: typeof dwellMs === 'number' && Number.isFinite(dwellMs) ? clamp(Math.floor(dwellMs), 0, MAX_DWELL_MS_PER_EVENT) : 0,
      ratio: typeof ratio === 'number' && Number.isFinite(ratio) ? clamp(ratio, 0, 1) : 0,
      pos: typeof pos === 'number' && Number.isFinite(pos) ? clamp(pos, 0, 1) : null
    };
    // same post twice in one batch: merge (sum dwell, max ratio, last pos)
    const prior = byId.get(clean.id);
    if (prior) {
      prior.dwellMs = clamp(prior.dwellMs + clean.dwellMs, 0, MAX_DWELL_MS_PER_EVENT);
      prior.ratio = Math.max(prior.ratio, clean.ratio);
      prior.pos = clean.pos ?? prior.pos;
    } else {
      byId.set(clean.id, clean);
    }
  }
  return [...byId.values()];
};

export const viewerKeyFor = (
  request: Request,
  viewerId: string | null
): { key: string; userId: string | null } | null => {
  if (viewerId) return { key: `user:${viewerId}`, userId: viewerId };
  const ua = request.headers.get('user-agent')?.trim() || '';
  if (ua.length < MIN_ANON_UA_CHARS) return null; // UA-less clients are bots until proven otherwise
  const ip = getRequestIp(request);
  const digest = createHash('sha256').update(`${ANON_SALT}|${ip}|${ua}`).digest('hex');
  return { key: `anon:${digest}`, userId: null };
};

// Minimal standalone visibility check (views.ts must not import things.ts —
// things.ts imports resolveViewStats below). Mirrors doc-level canView for
// top-level posts: owner always sees; tt:inherit posts are skipped (attached
// things aren't view-tracked surfaces); legacy visibility derives an acl.
const viewableByViewer = (doc: any, viewer: AclViewer & { friendIds?: ReadonlySet<string> }): boolean => {
  const ownerId = String(doc.ownerId || '');
  if (viewer?.id && viewer.id === ownerId) return true;
  const acl: string[] = Array.isArray(doc.acl) && doc.acl.length
    ? doc.acl
    : aclFromVisibility(doc.visibility) || [ACL_ALL];
  if (acl.includes(ACL_INHERIT)) return false;
  return aclAllows(acl, viewer, ownerId);
};

export type RecordViewsResult = { ok: true; counted: number };

// Record a batch of view events for one viewer identity. `friendIds` lets
// friends-only posts count views from actual friends; pass what the caller
// already loaded (or an empty set — those events just get dropped).
export const recordPostViews = async (
  request: Request,
  viewer: { id: string; username?: string | null } | null,
  eventsInput: unknown,
  friendIds?: ReadonlySet<string>
): Promise<RecordViewsResult> => {
	// Custom Mongo is an untrusted data plane and its shareIds are not globally
	// namespaced. Never authorize there and then mutate home telemetry: a caller
	// could clone a home post id and inflate its real stats.
	if (isCustomMongoEndpointActive()) return { ok: true, counted: 0 };
  const events = sanitizeEvents(eventsInput);
  if (!events.length) return { ok: true, counted: 0 };
  const identity = viewerKeyFor(request, viewer?.id || null);
  if (!identity) return { ok: true, counted: 0 };

  // resolve the referenced things (data plane, same place posts are read from)
  const things = await getThingsCollection();
  const docs = await things
    .find({ shareId: { $in: events.map((event) => event.id) } } as any)
    .project({ shareId: 1, ownerId: 1, acl: 1, visibility: 1, thingtime: 1, kind: 1 })
    .toArray();
  const aclViewer: AclViewer = viewer?.id
    ? { id: viewer.id, username: viewer.username || null, friendIds: friendIds || new Set() }
    : null;
  const viewable = new Map<string, any>();
  for (const doc of docs as any[]) {
    const isPost = (Array.isArray(doc.thingtime) && doc.thingtime.includes('post')) || doc.kind === 'post';
    if (!isPost) continue;
    if (identity.userId && String(doc.ownerId) === identity.userId) continue; // self-views never count
    if (!viewableByViewer(doc, aclViewer)) continue;
    viewable.set(String(doc.shareId), doc);
  }
  const accepted = events.filter((event) => viewable.has(event.id));
  if (!accepted.length) return { ok: true, counted: 0 };

  const now = new Date();
  const postViews = await getPostViewsCollection();
  const writes = accepted.map((event) => ({
    updateOne: {
      filter: { postId: event.id, viewerKey: identity.key },
      update: {
        $setOnInsert: { createdAt: now, userId: identity.userId },
        $set: { lastAt: now, ...(event.pos !== null ? { lastPos: event.pos } : {}) },
        $inc: { impressions: 1, dwellMs: event.dwellMs },
        $max: { maxRatio: event.ratio }
      },
      upsert: true
    }
  }));
  try {
    await postViews.bulkWrite(writes as any, { ordered: false });
  } catch (err: any) {
    // upsert races on the unique index surface as duplicate-key write errors;
    // one retry re-runs the same idempotent-ish updates as plain updates
    if (err?.code !== 11000 && !err?.writeErrors?.every?.((e: any) => e?.code === 11000)) throw err;
    await postViews.bulkWrite(writes as any, { ordered: false }).catch(() => {});
  }
  return { ok: true, counted: accepted.length };
};

export type PostViewStats = {
  viewCount: number; // unique viewer identities
  impressions: number;
  totalDwellMs: number;
};

// Batch per-post view stats for a page of posts — one aggregate, mirroring
// resolveRelated's shape (Map keyed by post shareId).
export const resolveViewStats = async (postIds: string[]): Promise<Map<string, PostViewStats>> => {
  const map = new Map<string, PostViewStats>();
	// Symmetric with recordPostViews: custom-plane cards must not inherit stats
	// from an unrelated home post that happens to share their public id.
	if (isCustomMongoEndpointActive()) return map;
  if (!postIds.length) return map;
  const postViews = await getPostViewsCollection();
  const rows = await postViews
    .aggregate([
      { $match: { postId: { $in: postIds } } },
      {
        $group: {
          _id: '$postId',
          viewCount: { $sum: 1 },
          impressions: { $sum: { $ifNull: ['$impressions', 0] } },
          totalDwellMs: { $sum: { $ifNull: ['$dwellMs', 0] } }
        }
      }
    ])
    .toArray();
  for (const row of rows as any[]) {
    map.set(String(row._id), {
      viewCount: row.viewCount || 0,
      impressions: row.impressions || 0,
      totalDwellMs: row.totalDwellMs || 0
    });
  }
  return map;
};
