// Thingtime Schemas — the single source of truth for the shapes Thingtime data
// can take. Everything in the `things` collection is a thing: one root Thing
// schema (schemaVersion per doc), sub-schemas applied via the root `thingtime`
// array of schema ids, and the sub-schema payload living under `crystal`.
//
// This module is intentionally PURE (no mongo/node imports) so it can be
// imported by the client (/schemas page), the docs, and the server API layer
// alike — the same apiDocs.ts pattern.

import { MAX_REACTION_EMOJIS, sanitizeReactionToken } from '~/utils/reactionTokens';

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

// ---------------------------------------------------------------------------
// ACL permissions. A thing's audience is an array of tt: entries — grants,
// plus '-'-prefixed exclusions:
//
//   tt:all              everyone, including logged-out viewers
//   tt:user             the thing's owner
//   tt:userFriends      the owner's friends circle
//   tt:userFamily       the owner's family circle
//   tt:user/<username>  one specific user (grant or exclude)
//   tt:inherit          attached things (comments, reactions) — as visible as
//                       their target
//
// Examples: ['tt:all'] is public; ['-tt:all', 'tt:userFriends', 'tt:user'] is
// friends-only; ['tt:all', '-tt:user/somebody'] is public except one user.
//
// Evaluation: the MOST SPECIFIC entry matching the viewer decides (exclusions
// win ties), so a broad '-tt:all' never locks out someone a narrower grant
// admits. Specificity: tt:all < circles/groups < tt:user < tt:user/<name>.
// Owners always view their own things regardless of acl. No relationship
// graph exists yet, so circle entries currently resolve to the owner only —
// matching the pre-acl behaviour of friends/family visibility.

export const ACL_ALL = 'tt:all';
export const ACL_OWNER = 'tt:user';
export const ACL_FRIENDS = 'tt:userFriends';
export const ACL_FAMILY = 'tt:userFamily';
export const ACL_INHERIT = 'tt:inherit';
export const ACL_USER_PREFIX = 'tt:user/';

const ACL_ENTRY_PATTERN = /^-?tt:[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_ACL_ENTRIES = 16;
const MAX_ACL_ENTRY_CHARS = 64;

// legacy visibility names map onto acls (accepted as input everywhere an acl
// is, and derived back for the wire so old clients keep working)
export const LEGACY_VISIBILITY_ACLS: Record<ThingVisibility, string[]> = {
  public: [ACL_ALL],
  friends: ['-tt:all', ACL_FRIENDS, ACL_OWNER],
  family: ['-tt:all', ACL_FAMILY, ACL_OWNER],
  private: [ACL_OWNER],
  inherit: [ACL_INHERIT]
};

export const aclFromVisibility = (visibility: unknown): string[] | null =>
  typeof visibility === 'string' && visibility in LEGACY_VISIBILITY_ACLS
    ? [...LEGACY_VISIBILITY_ACLS[visibility as ThingVisibility]]
    : null;

export const visibilityFromAcl = (acl: string[]): ThingVisibility => {
  if (acl.includes(ACL_INHERIT)) return 'inherit';
  if (acl.includes(ACL_ALL)) return 'public';
  if (acl.includes(ACL_FRIENDS)) return 'friends';
  if (acl.includes(ACL_FAMILY)) return 'family';
  return 'private';
};

export const sanitizeAcl = (value: unknown): string[] | { ok: false; status: number; error: string } => {
  if (!Array.isArray(value)) return { ok: false, status: 400, error: 'acl must be a list of tt: permission entries' };
  const entries: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return { ok: false, status: 400, error: 'acl entries must be strings' };
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.length > MAX_ACL_ENTRY_CHARS || !ACL_ENTRY_PATTERN.test(entry)) {
      return { ok: false, status: 400, error: `acl entries look like tt:all, tt:user, tt:userFriends, or tt:user/<username>, optionally '-' prefixed (got ${entry.slice(0, 80)})` };
    }
    if (!entries.includes(entry)) entries.push(entry);
    if (entries.length > MAX_ACL_ENTRIES) return { ok: false, status: 400, error: `acl can have at most ${MAX_ACL_ENTRIES} entries` };
  }
  if (!entries.length) return { ok: false, status: 400, error: 'acl needs at least one entry' };
  return entries;
};

export type AclViewer = { id: string | null; username?: string | null } | null;

const aclSpecificity = (id: string): number => {
  if (id === ACL_ALL) return 0;
  if (id === ACL_OWNER) return 2;
  if (id.startsWith(ACL_USER_PREFIX)) return 3;
  return 1; // circles + future groups
};

const aclEntryMatches = (id: string, viewer: AclViewer, ownerId: string): boolean => {
  if (id === ACL_ALL) return true;
  if (!viewer?.id) return false;
  if (id === ACL_OWNER) return viewer.id === ownerId;
  if (id.startsWith(ACL_USER_PREFIX)) {
    const username = id.slice(ACL_USER_PREFIX.length).toLowerCase();
    return !!viewer.username && viewer.username.toLowerCase() === username;
  }
  // circles/groups: no relationship graph yet — owner only
  if (id === ACL_FRIENDS || id === ACL_FAMILY) return viewer.id === ownerId;
  return false;
};

// Most-specific matching entry wins; exclusions win ties. Callers short-circuit
// the owner before asking (owners always see their own things).
export const aclAllows = (acl: string[], viewer: AclViewer, ownerId: string): boolean => {
  let best = -1;
  let allow = false;
  for (const raw of acl) {
    const negated = raw.startsWith('-');
    const id = negated ? raw.slice(1) : raw;
    if (id === ACL_INHERIT) continue;
    if (!aclEntryMatches(id, viewer, ownerId)) continue;
    const specificity = aclSpecificity(id);
    if (specificity > best) {
      best = specificity;
      allow = !negated;
    } else if (specificity === best && negated) {
      allow = false;
    }
  }
  return allow;
};

// quick-pick defaults; any emoji token validated by ~/utils/reactionTokens is
// accepted as a reaction
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
export const POST_TYPES = ['text', 'image', 'marketplace', 'thingtime'] as const;
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
    'below — and the sub-schema payload lives under `crystal`. Who can see it lives in `acl`: ' +
    'tt: grants plus "-"-prefixed exclusions, most-specific entry wins (["tt:all"] is public, ' +
    '["-tt:all","tt:userFriends","tt:user"] is friends-only, ["tt:all","-tt:user/somebody"] is ' +
    'public except one user; owners always see their own things). Things that attach to another ' +
    'thing (comments, reactions) carry ["tt:inherit"] and are as visible as their target. The ' +
    'legacy visibility names (public/friends/family/private) are still accepted as input and ' +
    'derived on the wire.',
  fields: [
    { name: 'shareId', type: 'id', required: true, description: 'Public id — the only id clients ever see.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Root schema version this doc was written at (docs without one are version 1).' },
    { name: 'thingtime', type: 'string[]', required: true, description: 'Thingtime Schema ids applied to this thing, e.g. ["post"] or ["post","share"].' },
    { name: 'crystal', type: 'object', required: true, description: 'The sub-schema payload, validated against every schema in thingtime.' },
    { name: 'ownerId', type: 'id', required: true, description: 'The owning user id.' },
    { name: 'acl', type: 'string[]', required: true, max: 16, description: 'Permission entries: tt:all, tt:user (owner), tt:userFriends, tt:userFamily, tt:user/<username>, each optionally "-" prefixed to exclude; tt:inherit on target-attached things. Most specific matching entry decides; owners always view.' },
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
    acl: ['tt:all', '-tt:user/replicant-hunter', 'tt:user'],
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
  summary: 'A feed post — text, image, marketplace listing, or a thingtime thing.',
  detail:
    'The thing shows up in feeds and profile listings. Marketplace posts carry a listing; the ' +
    'listing category is folded into the root tags so feed filters can find it. Thingtime posts ' +
    'carry a free-form structured thing under the reserved `thing` key — the same bounded JSON ' +
    'grammar as data crystals, but namespaced so the open shape can never ride past the post ' +
    'whitelist (searchable as crystal.thing.<field> on /search).',
  fields: [
    { name: 'type', type: 'enum', required: true, values: [...POST_TYPES], description: 'What kind of post this is.' },
    { name: 'text', type: 'string', required: false, max: MAX_TEXT_CHARS, description: `Post body (required for text posts), max ${MAX_TEXT_CHARS} chars.` },
    { name: 'images', type: 'string[]', required: false, max: MAX_IMAGES, description: `http(s) image URLs, max ${MAX_IMAGES} × ${MAX_IMAGE_URL_CHARS} chars (image posts need at least one).` },
    { name: 'listing', type: 'object', required: false, description: 'Marketplace listing { title, price, currency, category, condition, location, sold } — required for marketplace posts, optional on thingtime posts.' },
    { name: 'thing', type: 'record', required: false, description: 'Free-form structured thing payload — required for thingtime posts, bounded like data crystals (searchable as crystal.thing.<field>). Thingtime posts can also carry images and a listing.' }
  ],
  example: { type: 'text', text: 'Everything is a thing ✨', images: [], listing: null, thing: null }
};

const commentSchema: ThingtimeSchema = {
  id: 'comment',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Comment',
  summary: 'A comment on another thing.',
  detail:
    'A standalone thing pointing at its target via targetId, carrying acl ["tt:inherit"] so it ' +
    'is visible exactly when the target is. Comments used to live embedded inside post docs — ' +
    'the things v1→v2 migration explodes them into these.',
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
  summary: 'An emoji reaction to another thing — one thing per (user, target, token).',
  detail:
    'The emoji is an open-vocabulary token: a single emoji or a multi-emoji group typed as one ' +
    `unit (up to ${MAX_REACTION_EMOJIS} emoji), validated emoji-only by the shared token helper. ` +
    'Users can hold several reaction things on one target; toggling a token they already have ' +
    'removes it. Reactions used to live embedded on post docs as an emoji → userIds map — the ' +
    'things v1→v2 migration explodes them into these.',
  requiresTarget: true,
  fields: [
    {
      name: 'emoji',
      type: 'string',
      required: true,
      max: MAX_REACTION_EMOJIS,
      description: `The reaction token — one emoji or a multi-emoji group (max ${MAX_REACTION_EMOJIS} emoji, emoji-only).`
    }
  ],
  example: { emoji: '🤣🤣🙌💀💦' }
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

// Free-form structured data (thingtime ["data"]): the crystal is ANY bounded
// JSON shape — this is the "everything is a thing" promise made writable, and
// what /search's real-datatype queries search over. Keys follow the same
// segment grammar the search API accepts (no $, no dots inside a key), values
// are depth/size/count-bounded, and when combined with a typed schema (e.g.
// thingtime ["post","data"]) the typed sanitizer's fields always win.
export const MAX_DATA_CRYSTAL_DEPTH = 6;
export const MAX_DATA_CRYSTAL_NODES = 400;
export const MAX_DATA_ARRAY_ITEMS = 100;
export const MAX_DATA_KEY_CHARS = 60;

const dataSchema: ThingtimeSchema = {
  id: 'data',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Data',
  summary: 'Free-form structured data — any JSON shape, searchable by real datatypes on /search.',
  detail:
    'The open half of Thingtime: a data thing’s crystal holds whatever structure you give it ' +
    '(numbers stay numbers, booleans stay booleans), bounded but never schema-gated. Search it ' +
    'with real datatype conditions on /search (legs ≥ 3, material in wood/concrete, height ' +
    'between 60–130). Data crystals stand alone — thingtime ["data"] never combines with typed ' +
    'schemas, so the open shape can’t ride past a typed whitelist. Convention: carry a `schema` ' +
    'field naming a published schema thing (e.g. ' +
    '"Table") so schema-driven searches can find you, and tag the thing for feed filters. Keys ' +
    `are letters/numbers/_/- (max ${MAX_DATA_KEY_CHARS} chars), nesting caps at ` +
    `${MAX_DATA_CRYSTAL_DEPTH} levels, ${MAX_DATA_CRYSTAL_NODES} values per crystal, arrays at ` +
    `${MAX_DATA_ARRAY_ITEMS} items, strings at ${MAX_TEXT_CHARS} chars.`,
  fields: [
    {
      name: '*',
      type: 'record',
      required: false,
      description: 'Any JSON structure within the bounds above — this schema deliberately has no fixed fields.'
    },
    {
      name: 'schema',
      type: 'string',
      required: false,
      description: 'Optional convention: the name of the published schema thing this data follows.'
    }
  ],
  example: {
    schema: 'Table',
    name: 'Walnut standing desk',
    legs: 4,
    material: 'wood',
    width: 160,
    height: 130,
    depth: 80,
    features: ['sit/stand', 'cable tray'],
    price: 899.5
  }
};

// User-authored schemas are things too (thingtime ["schema"]). They describe a
// data shape other things can follow in their crystal (e.g. a "Table" with
// legs/material/width), and the /search page browses them to prefill its query
// builder. Field defs are bounded and whitelisted — never arbitrary JSON.
export const MAX_SCHEMA_NAME_CHARS = 60;
export const MAX_SCHEMA_DESCRIPTION_CHARS = 500;
export const MAX_SCHEMA_FIELDS = 40;
export const MAX_SCHEMA_ENUM_VALUES = 30;
export const MAX_SCHEMA_ENUM_VALUE_CHARS = 60;
export const MAX_SCHEMA_UNIT_CHARS = 20;
export const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'string[]'] as const;
export type SchemaFieldType = (typeof SCHEMA_FIELD_TYPES)[number];

export type SchemaThingField = {
  name: string;
  type: SchemaFieldType;
  description?: string;
  values?: string[]; // enum types
  min?: number; // number types
  max?: number; // number types
  unit?: string; // number types, display only (e.g. "cm")
};

const schemaThingSchema: ThingtimeSchema = {
  id: 'schema',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Schema',
  summary: 'A user-authored data shape — browse them on /search to prefill structured searches.',
  detail:
    'Anyone can publish a schema thing describing a shape (e.g. "Table": legs, material ' +
    'wood/plastic/concrete, width/height/depth). Things that follow a schema simply carry its ' +
    'fields in their crystal — schemas are discovery + search sugar, never a validation gate ' +
    '(Thingtime searches real datatypes, not schema registrations). The /search page lists ' +
    'public schema things next to the built-in crystal schemas and prefills its query builder ' +
    'from the field definitions.',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Table".' },
    { name: 'description', type: 'string', required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: 'What this shape describes.' },
    {
      name: 'fields',
      type: 'object',
      required: true,
      max: MAX_SCHEMA_FIELDS,
      description:
        `Field definitions, max ${MAX_SCHEMA_FIELDS}: { name, type (${SCHEMA_FIELD_TYPES.join('/')}), ` +
        'description?, values? (enum), min?/max?/unit? (number) }.'
    }
  ],
  example: {
    name: 'Table',
    description: 'Tables of all kinds — dining, coffee, standing desks.',
    fields: [
      { name: 'legs', type: 'number', min: 0, max: 12 },
      { name: 'material', type: 'enum', values: ['wood', 'plastic', 'concrete', 'metal', 'glass'] },
      { name: 'width', type: 'number', min: 0, unit: 'cm' },
      { name: 'height', type: 'number', min: 0, unit: 'cm' },
      { name: 'depth', type: 'number', min: 0, unit: 'cm' },
      { name: 'features', type: 'string[]', description: 'e.g. sit/stand, extendable, foldable' }
    ]
  }
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
  dataSchema,
  schemaThingSchema,
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
  if (!type) return fail(400, 'Post type must be text, image, marketplace, or thingtime');
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

  // marketplace posts REQUIRE a listing; thingtime posts may opt into one
  // (the composer's Marketplace toggle) — validated identically when present.
  // Shares are exempt from the requirement: sharePost re-posts the original's
  // type with listing null (the shared original renders the listing), which
  // used to 400 every marketplace share.
  let listing: Record<string, unknown> | null = null;
  const listingProvided = input.listing !== undefined && input.listing !== null;
  if (
    (type === 'marketplace' && !isShare) ||
    ((type === 'marketplace' || type === 'thingtime') && listingProvided)
  ) {
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

  // Thingtime posts carry a free-form structured thing under ONE reserved key.
  // The payload goes through the same bounded data-crystal walker, but living
  // at crystal.thing (not the crystal root) keeps the post whitelist closed —
  // the reason ["post","data"] combinations are rejected outright below.
  let thing: Record<string, unknown> | null = null;
  if (type === 'thingtime') {
    const raw = input.thing;
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        return fail(400, 'Thingtime posts need a thing — an object with at least one field 🌀');
      }
      const sanitized = sanitizeDataValue(raw, 1, { nodes: 0 }, 'thing');
      if (!sanitized.ok) return sanitized;
      thing = sanitized.value as Record<string, unknown>;
    }
    if (!isShare && (!thing || !Object.keys(thing).length)) {
      return fail(400, 'Thingtime posts need a thing with at least one field 🌀');
    }
  }

  if (!isShare && type === 'text' && !text) return fail(400, 'Say something first ✍️');
  if (!isShare && type === 'image' && !images.length) return fail(400, 'Image posts need at least one image');

  return { ok: true, crystal: { type, text, images, listing, thing } };
};

const sanitizeCommentCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return fail(400, 'Comment text is required');
  if (text.length > MAX_COMMENT_CHARS) return fail(400, `Comment is too long (max ${MAX_COMMENT_CHARS})`);
  return { ok: true, crystal: { text } };
};

const sanitizeReactionCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const token = sanitizeReactionToken(input.emoji);
  if (!token) return fail(400, 'Unsupported reaction');
  return { ok: true, crystal: { emoji: token } };
};

// The one key-segment grammar shared by data-crystal keys, schema-thing field
// names, and the search API's condition field paths — exported so the three
// can never drift (a storable key MUST be a searchable key).
export const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

// Free-form data crystals: any JSON, bounded and key-validated. The walk fails
// loudly (never silently drops) so writers know exactly what didn't fit.
const DATA_KEY_PATTERN = KEY_SEGMENT_PATTERN;

const sanitizeDataValue = (
  value: unknown,
  depth: number,
  counter: { nodes: number },
  path: string
): { ok: true; value: unknown } | Fail => {
  counter.nodes += 1;
  if (counter.nodes > MAX_DATA_CRYSTAL_NODES) {
    return fail(400, `Data crystals can hold at most ${MAX_DATA_CRYSTAL_NODES} values`);
  }
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail(400, `Data numbers must be finite (${path})`);
    return { ok: true, value };
  }
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT_CHARS) return fail(400, `Data strings cap at ${MAX_TEXT_CHARS} chars (${path})`);
    return { ok: true, value };
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DATA_CRYSTAL_DEPTH) return fail(400, `Data nests at most ${MAX_DATA_CRYSTAL_DEPTH} levels (${path})`);
    if (value.length > MAX_DATA_ARRAY_ITEMS) return fail(400, `Data arrays cap at ${MAX_DATA_ARRAY_ITEMS} items (${path})`);
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const entry = sanitizeDataValue(value[index], depth + 1, counter, `${path}[${index}]`);
      if (!entry.ok) return entry;
      out.push(entry.value);
    }
    return { ok: true, value: out };
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DATA_CRYSTAL_DEPTH) return fail(400, `Data nests at most ${MAX_DATA_CRYSTAL_DEPTH} levels (${path})`);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.length > MAX_DATA_KEY_CHARS || !DATA_KEY_PATTERN.test(key)) {
        return fail(400, `Data keys are letters/numbers/_/- up to ${MAX_DATA_KEY_CHARS} chars (got ${key.slice(0, 80)})`);
      }
      const sanitized = sanitizeDataValue(entry, depth + 1, counter, path ? `${path}.${key}` : key);
      if (!sanitized.ok) return sanitized;
      out[key] = sanitized.value;
    }
    return { ok: true, value: out };
  }
  return fail(400, `Data values must be JSON (${path})`);
};

const sanitizeDataCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const sanitized = sanitizeDataValue(input, 0, { nodes: 0 }, '');
  if (!sanitized.ok) return sanitized;
  return { ok: true, crystal: sanitized.value as Record<string, unknown> };
};

// Schema-thing field names double as crystal paths in the search builder
// (crystal.<name>): KEY_SEGMENT_PATTERN segments joined by dots.
const SCHEMA_FIELD_NAME_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const MAX_SCHEMA_FIELD_NAME_CHARS = 60;
const MAX_SCHEMA_FIELD_DESCRIPTION_CHARS = 200;

const sanitizeSchemaCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return fail(400, 'Schemas need a name');
  if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Schema name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);

  const description = typeof input.description === 'string' ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : '';

  if (!Array.isArray(input.fields)) return fail(400, 'Schema fields must be a list');
  if (input.fields.length > MAX_SCHEMA_FIELDS) return fail(400, `A schema can have at most ${MAX_SCHEMA_FIELDS} fields`);

  const fields: SchemaThingField[] = [];
  const seen = new Set<string>();
  for (const raw of input.fields) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Each schema field must be an object');
    const def = raw as Record<string, unknown>;

    const fieldName = typeof def.name === 'string' ? def.name.trim() : '';
    if (!fieldName || fieldName.length > MAX_SCHEMA_FIELD_NAME_CHARS || !SCHEMA_FIELD_NAME_PATTERN.test(fieldName)) {
      return fail(400, `Schema field names are letters/numbers/_/- with optional dots (got ${String(def.name).slice(0, 80)})`);
    }
    const key = fieldName.toLowerCase();
    // fail loudly (module convention) — silently dropping a duplicate would
    // lose a user's field definition with a 200
    if (seen.has(key)) return fail(400, `Duplicate schema field name: ${fieldName}`);
    seen.add(key);

    const type = SCHEMA_FIELD_TYPES.includes(def.type as any) ? (def.type as SchemaFieldType) : null;
    if (!type) return fail(400, `Schema field types are ${SCHEMA_FIELD_TYPES.join(', ')}`);

    const field: SchemaThingField = { name: fieldName, type };

    const fieldDescription = typeof def.description === 'string' ? def.description.trim() : '';
    if (fieldDescription) field.description = fieldDescription.slice(0, MAX_SCHEMA_FIELD_DESCRIPTION_CHARS);

    if (type === 'enum') {
      if (!Array.isArray(def.values) || !def.values.length) return fail(400, `Enum field ${fieldName} needs a values list`);
      if (def.values.length > MAX_SCHEMA_ENUM_VALUES) {
        return fail(400, `Enum field ${fieldName} can have at most ${MAX_SCHEMA_ENUM_VALUES} values`);
      }
      const values: string[] = [];
      for (const value of def.values) {
        if (typeof value !== 'string') return fail(400, `Enum field ${fieldName} values must be strings`);
        const trimmed = value.trim().slice(0, MAX_SCHEMA_ENUM_VALUE_CHARS);
        if (trimmed && !values.includes(trimmed)) values.push(trimmed);
      }
      if (!values.length) return fail(400, `Enum field ${fieldName} needs a values list`);
      field.values = values;
    }

    if (type === 'number') {
      const min = Number(def.min);
      const max = Number(def.max);
      if (def.min !== undefined && def.min !== null) {
        if (!Number.isFinite(min)) return fail(400, `Field ${fieldName} min must be a number`);
        field.min = min;
      }
      if (def.max !== undefined && def.max !== null) {
        if (!Number.isFinite(max)) return fail(400, `Field ${fieldName} max must be a number`);
        field.max = max;
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        return fail(400, `Field ${fieldName} min can’t exceed its max`);
      }
      if (typeof def.unit === 'string' && def.unit.trim()) {
        field.unit = def.unit.trim().slice(0, MAX_SCHEMA_UNIT_CHARS);
      }
    }

    fields.push(field);
  }
  if (!fields.length) return fail(400, 'Schemas need at least one field');

  return { ok: true, crystal: { name, description, fields } };
};

const crystalSanitizers: Record<
  string,
  (input: Record<string, unknown>, appliedIds: string[]) => { ok: true; crystal: Record<string, unknown> } | Fail
> = {
  post: sanitizePostCrystal,
  comment: sanitizeCommentCrystal,
  reaction: sanitizeReactionCrystal,
  share: () => ({ ok: true, crystal: {} }),
  schema: sanitizeSchemaCrystal,
  data: sanitizeDataCrystal
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

  // Free-form 'data' crystals stand alone. Combining data with a typed schema
  // would let arbitrary keys ride past that schema's whitelist (verified:
  // ["post","data"] smuggled non-post fields into the stored crystal), so the
  // open shape and the closed shapes never share one thing.
  if (ids.includes('data') && ids.length > 1) {
    return fail(400, 'data crystals stand alone — publish a separate data thing and link it via targetId or tags');
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
