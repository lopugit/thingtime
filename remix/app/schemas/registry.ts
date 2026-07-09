// Thingtime Schemas — the single source of truth for the shapes Thingtime data
// can take. Everything in the `things` collection is a thing: one root Thing
// schema (schemaVersion per doc), sub-schemas applied via the root `thingtime`
// array of schema ids, and the sub-schema payload living under `crystal`.
//
// This module is intentionally PURE (no mongo/node imports) so it can be
// imported by the client (/schemas page), the docs, and the server API layer
// alike — the same apiDocs.ts pattern.

export type ThingtimeFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'string[]'
  | 'object'
  | 'record'
  | 'id';

export type ThingtimeSchemaField = {
  name: string;
  type: ThingtimeFieldType;
  required: boolean;
  description: string;
  // enum values / string max chars / array max items, when they apply
  values?: string[];
  max?: number;
};

// root: the Thing schema every things-collection doc follows.
// crystal: a sub-schema applied through thing.thingtime[]; its fields live in thing.crystal.
// collection: a non-thing collection's doc schema (users, sessions, ...).
export type ThingtimeSchemaKind = 'root' | 'crystal' | 'collection';

export type ThingtimeSchema = {
  id: string; // stable id — this is what thing.thingtime[] entries point to
  version: number;
  kind: ThingtimeSchemaKind;
  collection: string | null;
  title: string;
  summary: string;
  detail: string;
  // crystal schemas only: thing must point at another thing via targetId
  requiresTarget?: boolean;
  fields: ThingtimeSchemaField[];
  example: Record<string, unknown>;
};

export const THING_VISIBILITIES = ['public', 'friends', 'family', 'private', 'inherit'] as const;
export type ThingVisibility = (typeof THING_VISIBILITIES)[number];

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
export const POST_TYPES = ['text', 'image', 'marketplace'] as const;
export const MARKETPLACE_CATEGORIES = ['car', 'tool', 'furniture', 'service', 'other'] as const;

export const MAX_TEXT_CHARS = 5000;
export const MAX_IMAGES = 8;
export const MAX_IMAGE_URL_CHARS = 2048;
export const MAX_COMMENT_CHARS = 1000;

// The schema version each collection's docs are written at today. Docs with no
// schemaVersion field predate versioning and count as version 1 everywhere.
export const COLLECTION_SCHEMA_VERSIONS: Record<string, number> = {
  things: 2,
  users: 2,
  sessions: 2,
  emailVerifications: 2,
  themes: 2,
  waitlist: 2,
  feedAlgorithms: 2,
  lopuMusingRateLimits: 2
};

export const LEGACY_SCHEMA_VERSION = 1;

const rootThingSchema: ThingtimeSchema = {
  id: 'thing',
  version: COLLECTION_SCHEMA_VERSIONS.things,
  kind: 'root',
  collection: 'things',
  title: 'Thing',
  summary: 'The root schema every doc in the things collection follows. Everything is a thing.',
  detail:
    'Posts, comments, reactions, and shares are all the same root shape. What kind of thing a ' +
    'thing is lives in its `thingtime` array — schema ids pointing at the Thingtime Schemas ' +
    'below — and the sub-schema payload lives under `crystal`. Things that attach to another ' +
    'thing (comments, reactions, shares) point at it via `targetId` and inherit its visibility.',
  fields: [
    { name: 'shareId', type: 'id', required: true, description: 'Public id — the only id clients ever see.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Root schema version this doc was written at (docs without one are version 1).' },
    { name: 'thingtime', type: 'string[]', required: true, description: 'Thingtime Schema ids applied to this thing, e.g. ["post"] or ["post","share"].' },
    { name: 'crystal', type: 'object', required: true, description: 'The sub-schema payload, validated against every schema in thingtime.' },
    { name: 'ownerId', type: 'id', required: true, description: 'The owning user id.' },
    { name: 'visibility', type: 'enum', required: true, values: [...THING_VISIBILITIES], description: 'Who can view the thing. Target-attached things use "inherit" — they are as visible as their target.' },
    { name: 'targetId', type: 'id', required: false, description: 'shareId of the thing this thing is about (comment → post, reaction → post, share → root post).' },
    { name: 'tags', type: 'string[]', required: true, max: 12, description: 'Lowercased tags, max 12 × 40 chars.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Creation time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Last mutation time.' }
  ],
  example: {
    shareId: '4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
    schemaVersion: 2,
    thingtime: ['post'],
    crystal: { type: 'text', text: 'Hello Thingtime 🌈', images: [], listing: null },
    ownerId: '664f1c2a9d3e5b0012345678',
    visibility: 'public',
    targetId: null,
    tags: ['hello'],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z'
  }
};

const postSchema: ThingtimeSchema = {
  id: 'post',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Post',
  summary: 'A feed post — text, image, or marketplace listing.',
  detail:
    'The thing shows up in feeds and profile listings. Marketplace posts carry a listing; the ' +
    'listing category is folded into the root tags so feed filters can find it.',
  fields: [
    { name: 'type', type: 'enum', required: true, values: [...POST_TYPES], description: 'What kind of post this is.' },
    { name: 'text', type: 'string', required: false, max: MAX_TEXT_CHARS, description: `Post body (required for text posts), max ${MAX_TEXT_CHARS} chars.` },
    { name: 'images', type: 'string[]', required: false, max: MAX_IMAGES, description: `http(s) image URLs, max ${MAX_IMAGES} × ${MAX_IMAGE_URL_CHARS} chars (image posts need at least one).` },
    { name: 'listing', type: 'object', required: false, description: 'Marketplace listing { title, price, currency, category, condition, location, sold } — required for marketplace posts.' }
  ],
  example: { type: 'text', text: 'Everything is a thing ✨', images: [], listing: null }
};

const commentSchema: ThingtimeSchema = {
  id: 'comment',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Comment',
  summary: 'A comment on another thing.',
  detail:
    'A standalone thing pointing at its target via targetId, visible exactly when the target ' +
    'is. Comments used to live embedded inside post docs — the things v1→v2 migration explodes ' +
    'them into these.',
  requiresTarget: true,
  fields: [
    { name: 'text', type: 'string', required: true, max: MAX_COMMENT_CHARS, description: `Comment body, max ${MAX_COMMENT_CHARS} chars.` }
  ],
  example: { text: 'So say we all 🚀' }
};

const reactionSchema: ThingtimeSchema = {
  id: 'reaction',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Reaction',
  summary: 'An emoji reaction to another thing — one per user per target.',
  detail:
    'Toggling the same emoji removes the reaction; a different emoji replaces it. Reactions ' +
    'used to live embedded on post docs as an emoji → userIds map — the things v1→v2 migration ' +
    'explodes them into these.',
  requiresTarget: true,
  fields: [
    { name: 'emoji', type: 'enum', required: true, values: [...REACTION_EMOJIS], description: 'The reaction emoji.' }
  ],
  example: { emoji: '❤️' }
};

const shareSchema: ThingtimeSchema = {
  id: 'share',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Share',
  summary: 'A re-share of another thing into the sharer’s feed.',
  detail:
    'Shares are also posts — a share thing carries thingtime ["post","share"], so it renders ' +
    'in feeds with its own caption (the post crystal text) while targetId points at the ROOT ' +
    'shared thing (re-shares never nest). Share counts are computed live from these things.',
  requiresTarget: true,
  fields: [],
  example: {}
};

const userSchema: ThingtimeSchema = {
  id: 'user',
  version: COLLECTION_SCHEMA_VERSIONS.users,
  kind: 'collection',
  collection: 'users',
  title: 'User',
  summary: 'A user account (or service account) — hashed password, profile, verification state.',
  detail: 'Created only via POST /api/v1/auth/register or /api/v1/auth/service-account.',
  fields: [
    { name: 'ttid', type: 'string', required: true, description: 'Thingtime id (currently the username).' },
    { name: 'username', type: 'string', required: true, description: 'Unique, lowercased.' },
    { name: 'email', type: 'string', required: true, description: 'Unique, lowercased.' },
    { name: 'passwordHash', type: 'string', required: true, description: 'bcrypt hash — never leaves the server.' },
    { name: 'displayName', type: 'string', required: false, description: 'Optional display name.' },
    { name: 'bio', type: 'string', required: false, description: 'Profile bio.' },
    { name: 'avatarUrl', type: 'string', required: false, description: 'Avatar image URL.' },
    { name: 'bannerUrl', type: 'string', required: false, description: 'Profile banner URL.' },
    { name: 'emailVerified', type: 'boolean', required: true, description: 'Whether the email is verified.' },
    { name: 'accountKind', type: 'enum', required: false, values: ['user', 'service'], description: 'Human or service account.' },
    { name: 'emailVerificationRequiredBy', type: 'date', required: false, description: 'Service accounts stop authenticating unverified past this.' },
    { name: 'storageAllowanceBytes', type: 'number', required: false, description: 'Storage allowance.' },
    { name: 'storageUsedBytes', type: 'number', required: false, description: 'Storage used.' },
    { name: 'meta', type: 'record', required: true, description: 'Grab-bag: activeThemeId, activeFeedAlgorithmId, service metadata.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Signup time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Last update time.' }
  ],
  example: { ttid: 'rick.deckard', username: 'rick.deckard', email: 'rick@example.com', emailVerified: true, accountKind: 'user', meta: {}, schemaVersion: 2 }
};

const sessionSchema: ThingtimeSchema = {
  id: 'session',
  version: COLLECTION_SCHEMA_VERSIONS.sessions,
  kind: 'collection',
  collection: 'sessions',
  title: 'Session',
  summary: 'A revocable login session backing a JWT (jti).',
  detail: 'Mongo is the source of truth for whether a token is still live — revoking flips revokedAt.',
  fields: [
    { name: 'jti', type: 'id', required: true, description: 'Unique token id carried in the JWT.' },
    { name: 'userId', type: 'id', required: true, description: 'The session owner.' },
    { name: 'type', type: 'string', required: true, values: ['tt.session'], description: 'Doc type tag.' },
    { name: 'purpose', type: 'enum', required: false, values: ['browser', 'service'], description: 'Browser cookie session or service Bearer token.' },
    { name: 'expiresAt', type: 'date', required: false, description: 'Expiry (null = non-expiring service token).' },
    { name: 'revokedAt', type: 'date', required: false, description: 'Set when revoked — token stops working immediately.' },
    { name: 'meta', type: 'record', required: false, description: 'Session metadata.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Login time.' }
  ],
  example: { jti: 'f0e1d2c3-...', userId: '664f1c2a9d3e5b0012345678', type: 'tt.session', purpose: 'browser', schemaVersion: 2 }
};

const emailVerificationSchema: ThingtimeSchema = {
  id: 'email-verification',
  version: COLLECTION_SCHEMA_VERSIONS.emailVerifications,
  kind: 'collection',
  collection: 'emailVerifications',
  title: 'Email verification',
  summary: 'A pending email-verification token.',
  detail: 'Consumed by GET /api/v1/auth/verify-email; expires after 24h (7d for service accounts).',
  fields: [
    { name: 'token', type: 'string', required: true, description: 'Unique 64-hex token.' },
    { name: 'userId', type: 'id', required: true, description: 'User being verified.' },
    { name: 'email', type: 'string', required: true, description: 'Email the token was sent to.' },
    { name: 'expiresAt', type: 'date', required: true, description: 'Expiry.' },
    { name: 'consumedAt', type: 'date', required: false, description: 'Set once used.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Issue time.' }
  ],
  example: { token: 'ab12…64hex', userId: '664f…', email: 'rick@example.com', schemaVersion: 2 }
};

const themeSchema: ThingtimeSchema = {
  id: 'theme',
  version: COLLECTION_SCHEMA_VERSIONS.themes,
  kind: 'collection',
  collection: 'themes',
  title: 'Theme',
  summary: 'A saved user theme, shareable by shareId.',
  detail: 'Fully resolved token doc; max 100 per user.',
  fields: [
    { name: 'shareId', type: 'id', required: true, description: 'Public id.' },
    { name: 'ownerId', type: 'id', required: true, description: 'Theme owner.' },
    { name: 'name', type: 'string', required: true, max: 60, description: 'Theme name.' },
    { name: 'theme', type: 'object', required: true, description: 'Resolved theme tokens.' },
    { name: 'visibility', type: 'enum', required: true, values: ['private', 'public'], description: 'Share visibility.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Creation time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Last update time.' }
  ],
  example: { shareId: '9a8b…', ownerId: '664f…', name: 'Midnight', visibility: 'private', schemaVersion: 2 }
};

const waitlistSchema: ThingtimeSchema = {
  id: 'waitlist',
  version: COLLECTION_SCHEMA_VERSIONS.waitlist,
  kind: 'collection',
  collection: 'waitlist',
  title: 'Waitlist entry',
  summary: 'A launch-waitlist email.',
  detail: 'Unique per email; duplicate joins are treated as success.',
  fields: [
    { name: 'email', type: 'string', required: true, max: 254, description: 'Lowercased email.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Join time.' }
  ],
  example: { email: 'rick@example.com', schemaVersion: 2 }
};

const feedAlgorithmSchema: ThingtimeSchema = {
  id: 'feed-algorithm',
  version: COLLECTION_SCHEMA_VERSIONS.feedAlgorithms,
  kind: 'collection',
  collection: 'feedAlgorithms',
  title: 'Feed algorithm',
  summary: 'A user-trained feed ranking algorithm.',
  detail: 'Weights over post types, tags, and authors, trained from engagement events.',
  fields: [
    { name: 'shareId', type: 'id', required: true, description: 'Public id.' },
    { name: 'ownerId', type: 'id', required: true, description: 'Algorithm owner.' },
    { name: 'name', type: 'string', required: true, max: 60, description: 'Algorithm name.' },
    { name: 'emoji', type: 'string', required: true, description: 'Display emoji.' },
    { name: 'parentId', type: 'id', required: false, description: 'Branch lineage parent.' },
    { name: 'weights', type: 'object', required: true, description: '{ types, tags, authors } weight maps.' },
    { name: 'eventCount', type: 'number', required: true, description: 'Engagement events trained on.' },
    { name: 'lastTrainedAt', type: 'date', required: false, description: 'Last training time.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Creation time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Last update time.' }
  ],
  example: { shareId: '3c4d…', ownerId: '664f…', name: 'Chronological+', emoji: '🧠', eventCount: 0, schemaVersion: 2 }
};

const rateLimitSchema: ThingtimeSchema = {
  id: 'rate-limit',
  version: COLLECTION_SCHEMA_VERSIONS.lopuMusingRateLimits,
  kind: 'collection',
  collection: 'lopuMusingRateLimits',
  title: 'Rate-limit window',
  summary: 'Sliding/fixed rate-limit windows keyed by hashed IP.',
  detail:
    'Two shapes share this collection: Lopu musing quotas (requests: Date[] sliding window) and ' +
    'waitlist join counters (count: number fixed window). Both expire via the TTL index on expiresAt.',
  fields: [
    { name: 'key', type: 'string', required: true, description: 'Unique window key (sha256 of IP, optionally prefixed).' },
    { name: 'expiresAt', type: 'date', required: true, description: 'TTL expiry.' },
    { name: 'requests', type: 'object', required: false, description: 'Sliding-window request timestamps (musing shape).' },
    { name: 'count', type: 'number', required: false, description: 'Fixed-window counter (waitlist shape).' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: { key: 'waitlist:9f2c…', count: 3, schemaVersion: 2 }
};

export const thingtimeSchemas: ThingtimeSchema[] = [
  rootThingSchema,
  postSchema,
  commentSchema,
  reactionSchema,
  shareSchema,
  userSchema,
  sessionSchema,
  emailVerificationSchema,
  themeSchema,
  waitlistSchema,
  feedAlgorithmSchema,
  rateLimitSchema
];

export const getThingtimeSchema = (id: string): ThingtimeSchema | null =>
  thingtimeSchemas.find((schema) => schema.id === id) || null;

export const crystalSchemas = (): ThingtimeSchema[] => thingtimeSchemas.filter((schema) => schema.kind === 'crystal');

// ---------------------------------------------------------------------------
// Crystal validation. Pure and hand-rolled (no schema library — repo style),
// shared by the API layer and anything else that wants to check a crystal.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const sanitizePostCrystal = (
  input: Record<string, unknown>,
  appliedIds: string[]
): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const type = POST_TYPES.includes(input.type as any) ? (input.type as string) : null;
  if (!type) return fail(400, 'Post type must be text, image, or marketplace');
  // share things render the shared original, so their post payload may be
  // an empty caption regardless of type
  const isShare = appliedIds.includes('share');

  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (text.length > MAX_TEXT_CHARS) return fail(400, `Post text is too long (max ${MAX_TEXT_CHARS})`);

  const rawImages = input.images;
  const images: string[] = [];
  if (rawImages !== undefined && rawImages !== null) {
    if (!Array.isArray(rawImages)) return fail(400, 'images must be a list of URLs');
    if (rawImages.length > MAX_IMAGES) return fail(400, `A post can have at most ${MAX_IMAGES} images`);
    for (const entry of rawImages) {
      if (typeof entry !== 'string') return fail(400, 'images must be a list of URLs');
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_IMAGE_URL_CHARS || !isHttpUrl(trimmed)) {
        return fail(400, 'Images must be http(s) URLs');
      }
      images.push(trimmed);
    }
  }

  let listing: Record<string, unknown> | null = null;
  if (type === 'marketplace') {
    const value = input.listing;
    if (!value || typeof value !== 'object') return fail(400, 'Marketplace posts need listing details');
    const raw = value as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
    if (!title) return fail(400, 'Listing title is required');
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
      return fail(400, 'Listing price must be a non-negative number');
    }
    const currency =
      typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency.trim())
        ? raw.currency.trim().toUpperCase()
        : 'AUD';
    const category = MARKETPLACE_CATEGORIES.includes(raw.category as any) ? (raw.category as string) : 'other';
    const condition = raw.condition === 'new' || raw.condition === 'used' ? raw.condition : null;
    const location = typeof raw.location === 'string' ? raw.location.trim().slice(0, 120) || null : null;
    listing = { title, price: Math.round(price * 100) / 100, currency, category, condition, location, sold: !!raw.sold };
  }

  if (!isShare && type === 'text' && !text) return fail(400, 'Say something first ✍️');
  if (!isShare && type === 'image' && !images.length) return fail(400, 'Image posts need at least one image');

  return { ok: true, crystal: { type, text, images, listing } };
};

const sanitizeCommentCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return fail(400, 'Comment text is required');
  if (text.length > MAX_COMMENT_CHARS) return fail(400, `Comment is too long (max ${MAX_COMMENT_CHARS})`);
  return { ok: true, crystal: { text } };
};

const sanitizeReactionCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  if (typeof input.emoji !== 'string' || !REACTION_EMOJIS.includes(input.emoji)) {
    return fail(400, 'Unsupported reaction');
  }
  return { ok: true, crystal: { emoji: input.emoji } };
};

const crystalSanitizers: Record<
  string,
  (input: Record<string, unknown>, appliedIds: string[]) => { ok: true; crystal: Record<string, unknown> } | Fail
> = {
  post: sanitizePostCrystal,
  comment: sanitizeCommentCrystal,
  reaction: sanitizeReactionCrystal,
  share: () => ({ ok: true, crystal: {} })
};

export type ValidatedCrystal = { ok: true; thingtime: string[]; crystal: Record<string, unknown>; requiresTarget: boolean };

// Validates a thingtime schema-id list + raw crystal payload. The sanitized
// crystal is the union of each schema's sanitized fields — later schemas never
// clobber earlier ones' keys with undefined.
export const validateThingtimeCrystal = (thingtime: unknown, crystal: unknown): ValidatedCrystal | Fail => {
  if (!Array.isArray(thingtime) || !thingtime.length) {
    return fail(400, 'thingtime must be a non-empty list of schema ids');
  }
  const ids: string[] = [];
  for (const entry of thingtime) {
    if (typeof entry !== 'string' || !entry.trim()) return fail(400, 'thingtime must be a list of schema ids');
    const id = entry.trim();
    const schema = getThingtimeSchema(id);
    if (!schema || schema.kind !== 'crystal') return fail(400, `Unknown thingtime schema: ${id}`);
    if (!ids.includes(id)) ids.push(id);
  }

  const input = crystal && typeof crystal === 'object' && !Array.isArray(crystal) ? (crystal as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = {};
  let requiresTarget = false;
  for (const id of ids) {
    const schema = getThingtimeSchema(id)!;
    if (schema.requiresTarget) requiresTarget = true;
    const sanitizer = crystalSanitizers[id];
    if (!sanitizer) return fail(400, `Unknown thingtime schema: ${id}`);
    const sanitized = sanitizer(input, ids);
    if (sanitized.ok === false) return sanitized;
    Object.assign(merged, sanitized.crystal);
  }
  return { ok: true, thingtime: ids, crystal: merged, requiresTarget };
};
