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
export const POST_TYPES = ['text', 'image', 'marketplace'] as const;
export const MARKETPLACE_CATEGORIES = ['car', 'tool', 'furniture', 'service', 'other'] as const;

export const MAX_TEXT_CHARS = 5000;
export const MAX_IMAGES = 8;
export const MAX_IMAGE_URL_CHARS = 2048;
export const MAX_COMMENT_CHARS = 1000;

// Extended (the schema-free sidecar every thing carries) — see sanitizeExtended
// below for the full story.
export const EXTENDED_MAX_BYTES = 512 * 1024;
export const MAX_EXTENDED_DEPTH = 64;
// The wildcard text index's language_override field name. Data-crystal keys
// can never collide with it (their grammar bans ':'), but extended accepts any
// key — except this one, which would hijack or break the text index.
export const EXTENDED_RESERVED_KEY = 'tt:textLanguage';

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
  lopuMusingRateLimits: 2,
  // born at 2 (no v1 era): single-use auth tokens + the email outbox
  passwordResets: 2,
  authOtps: 2,
  email_messages: 2
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
    'derived on the wire. Beside the schema’d crystal, every thing carries a schema-free ' +
    '`extended` property: any JSON up to 512KB, stored and returned as-is, never validated or ' +
    'interpreted, and not structured-searchable (/search field conditions can’t target it, ' +
    'though its string content is indexed by the wildcard text index) — the open sidecar ' +
    'external apps park their data in. Crystals are optionally schema-less too: omit thingtime ' +
    'and it defaults to ["data"], the bounded free-form crystal.',
  fields: [
    { name: 'shareId', type: 'id', required: true, description: 'Public id — the only id clients ever see.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Root schema version this doc was written at (docs without one are version 1).' },
    { name: 'thingtime', type: 'string[]', required: true, description: 'Thingtime Schema ids applied to this thing, e.g. ["post"] or ["post","share"]. Omitting it on create defaults to ["data"] — the schema-less crystal.' },
    { name: 'crystal', type: 'object', required: true, description: 'The sub-schema payload, validated against every schema in thingtime.' },
    { name: 'extended', type: 'record', required: false, description: `Schema-free sidecar: any JSON up to ${EXTENDED_MAX_BYTES} bytes, stored untouched, never validated, structured-searchable, or interpreted. Replace-on-write; null clears it.` },
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
    'The default schema when a thing declares none: creating a thing without thingtime (just a ' +
    'crystal) resolves to ["data"], so crystals are optionally schema-less. ' +
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
export const MAX_SCHEMA_FIELDS = 40; // total field nodes, counting nested children/items
export const MAX_SCHEMA_ENUM_VALUES = 30;
export const MAX_SCHEMA_ENUM_VALUE_CHARS = 60;
export const MAX_SCHEMA_UNIT_CHARS = 20;
// Matches the search grammar's MAX_FIELD_DEPTH and data crystals'
// MAX_DATA_CRYSTAL_DEPTH — a schema can never describe a shape deeper than
// what can be stored or searched.
export const MAX_SCHEMA_FIELD_DEPTH = 6;
export const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'string[]', 'object', 'array'] as const;
export type SchemaFieldType = (typeof SCHEMA_FIELD_TYPES)[number];

// An array field types its entries with an unnamed field def.
export type SchemaItemSpec = Omit<SchemaThingField, 'name' | 'required'>;

export type SchemaThingField = {
  name: string;
  type: SchemaFieldType;
  description?: string;
  required?: boolean; // present only when true
  values?: string[]; // enum types: the allowed values (text dropdowns)
  min?: number; // number types
  max?: number; // number types
  unit?: string; // number types, display only (e.g. "cm")
  maxLength?: number; // string / string[] entry types: max characters
  minItems?: number; // array / string[] types
  maxItems?: number; // array / string[] types
  children?: SchemaThingField[]; // object types: nested named fields
  items?: SchemaItemSpec; // array types: the entry shape
};

const schemaThingSchema: ThingtimeSchema = {
  id: 'schema',
  version: 2,
  kind: 'crystal',
  collection: null,
  title: 'Schema',
  summary: 'A user-authored data shape — browse them on /schemas, search with them on /search.',
  detail:
    'Anyone can publish a schema thing describing a shape (e.g. "Table": legs, material ' +
    'wood/plastic/concrete, width/height/depth). Fields nest arbitrarily (object children, typed ' +
    'array items) with per-field constraints: required, number min/max, string maxLength, enum ' +
    'value lists, array min/maxItems. Things that follow a schema simply carry its fields in ' +
    'their crystal — schemas are discovery + search sugar, never a validation gate (Thingtime ' +
    'searches real datatypes, not schema registrations). /schemas browses every published ' +
    'schema; /search prefills its query builder from the field definitions.',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Table".' },
    { name: 'description', type: 'string', required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: 'What this shape describes.' },
    {
      name: 'fields',
      type: 'object',
      required: true,
      max: MAX_SCHEMA_FIELDS,
      description:
        `Field definition tree, max ${MAX_SCHEMA_FIELDS} nodes, ${MAX_SCHEMA_FIELD_DEPTH} levels: ` +
        `{ name, type (${SCHEMA_FIELD_TYPES.join('/')}), description?, required?, values? (enum), ` +
        'min?/max?/unit? (number), maxLength? (string), minItems?/maxItems? (arrays), ' +
        'children? (object), items? (array) }.'
    },
    { name: 'forkOf', type: 'string', required: false, description: 'shareId of the schema this one was forked from (provenance only).' }
  ],
  example: {
    name: 'Table',
    description: 'Tables of all kinds — dining, coffee, standing desks.',
    fields: [
      { name: 'legs', type: 'number', min: 0, max: 12, required: true },
      { name: 'material', type: 'enum', values: ['wood', 'plastic', 'concrete', 'metal', 'glass'] },
      { name: 'width', type: 'number', min: 0, unit: 'cm' },
      { name: 'height', type: 'number', min: 0, unit: 'cm' },
      { name: 'depth', type: 'number', min: 0, unit: 'cm' },
      { name: 'features', type: 'string[]', maxItems: 12, description: 'e.g. sit/stand, extendable, foldable' },
      {
        name: 'maker',
        type: 'object',
        children: [
          { name: 'name', type: 'string', required: true, maxLength: 80 },
          { name: 'country', type: 'string' }
        ]
      },
      {
        name: 'finishes',
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          children: [
            { name: 'color', type: 'string', required: true },
            { name: 'sheen', type: 'enum', values: ['matte', 'satin', 'gloss'] }
          ]
        }
      }
    ]
  }
};

// Library saves: "add to my library" is a relational child thing (FUNDAMENTALS
// §3) — one save doc per (user, target), private to the saver, toggled via
// POST /api/v1/things/save. Zero crystal fields, like `share`.
const saveThingSchema: ThingtimeSchema = {
  id: 'save',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Save',
  summary: 'A private library save of another thing (targetId) — powers "add to my library".',
  detail:
    'Created/removed by POST /api/v1/things/save { id }. Saves are always private to their ' +
    'owner (acl ["tt:user"]) — they never inherit the target\'s audience, so a library is ' +
    'personal by construction. List yours via GET /api/v1/things?thingtime=save or filter ' +
    '/api/v1/schemas/browse with library=1.',
  requiresTarget: true,
  fields: [],
  example: {}
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

const passwordResetSchema: ThingtimeSchema = {
  id: 'password-reset',
  version: COLLECTION_SCHEMA_VERSIONS.passwordResets,
  kind: 'collection',
  collection: 'passwordResets',
  title: 'Password reset',
  summary: 'A pending single-use password-reset token.',
  detail:
    'Created by POST /api/v1/auth/password-reset and burned atomically by /confirm; expires after ' +
    'one hour (TTL index reaps the doc). Consuming one rotates the bcrypt hash and revokes every ' +
    'live session.',
  fields: [
    { name: 'token', type: 'string', required: true, description: 'Unique single-use token (two UUIDs, ~256 bits).' },
    { name: 'userId', type: 'id', required: true, description: 'User being reset.' },
    { name: 'email', type: 'string', required: true, description: 'Address the link was sent to.' },
    { name: 'expiresAt', type: 'date', required: true, description: 'Expiry (1h) — TTL index reaps the doc.' },
    { name: 'consumedAt', type: 'date', required: false, description: 'Set once used; racing submits burn exactly one.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Request time.' }
  ],
  example: { token: 'ab12…64hex', userId: '664f…', email: 'rick@example.com', schemaVersion: 2 }
};

const authOtpSchema: ThingtimeSchema = {
  id: 'auth-otp',
  version: COLLECTION_SCHEMA_VERSIONS.authOtps,
  kind: 'collection',
  collection: 'authOtps',
  title: 'Auth OTP challenge',
  summary: 'A pending email-2FA login challenge — only a hash of the code is stored.',
  detail:
    'Minted when an email-2FA account passes the password step of POST /api/v1/login. Stores ' +
    'sha256(challenge:code) — never the code — with a 10-minute TTL and an attempt counter ' +
    'incremented atomically BEFORE each constant-time comparison (capped at 5).',
  fields: [
    { name: 'challenge', type: 'string', required: true, description: 'Unique challenge id returned to the client.' },
    { name: 'userId', type: 'id', required: true, description: 'User completing login.' },
    { name: 'purpose', type: 'enum', required: true, values: ['login'], description: 'What the code proves.' },
    { name: 'codeHash', type: 'string', required: true, description: 'sha256(challenge:code) — plaintext codes are never stored.' },
    { name: 'attempts', type: 'number', required: true, description: 'Verification attempts so far (max 5, incremented pre-compare).' },
    { name: 'expiresAt', type: 'date', required: true, description: 'Expiry (10 min) — TTL index reaps the doc.' },
    { name: 'consumedAt', type: 'date', required: false, description: 'Set once the login completes.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Challenge mint time.' }
  ],
  example: { challenge: 'cd34…64hex', userId: '664f…', purpose: 'login', attempts: 0, schemaVersion: 2 }
};

const emailMessageSchema: ThingtimeSchema = {
  id: 'email-message',
  version: COLLECTION_SCHEMA_VERSIONS.email_messages,
  kind: 'collection',
  collection: 'email_messages',
  title: 'Email message (outbox)',
  summary: 'One row per email send — queued, then sent/logged/skipped/failed.',
  detail:
    'The owned email layer writes every send here before delivery (SES or console), then stamps ' +
    'the outcome. Satellite collections back deliverability: email_events (provider events), ' +
    'email_suppression_list + email_unsubscribes (list hygiene, checked before every send), and ' +
    'email_templates/email_subscriptions/email_identities (reserved for the owned-email roadmap).',
  fields: [
    { name: 'provider', type: 'enum', required: true, values: ['console', 'ses'], description: 'Delivery provider resolved from env.' },
    { name: 'stream', type: 'enum', required: true, values: ['transactional', 'newsletter'], description: 'Send stream — picks the from-address and unsubscribe rules.' },
    { name: 'templateKey', type: 'string', required: false, description: 'Dotted template id, e.g. auth.password_reset.' },
    { name: 'status', type: 'enum', required: true, values: ['queued', 'sent', 'logged', 'skipped', 'failed'], description: 'Delivery lifecycle state.' },
    { name: 'from', type: 'string', required: true, description: 'From address used.' },
    { name: 'replyTo', type: 'string', required: false, description: 'Reply-to address (null when unset).' },
    { name: 'to', type: 'string[]', required: true, description: 'Normalized recipient list.' },
    { name: 'subject', type: 'string', required: true, description: 'Subject line.' },
    { name: 'html', type: 'string', required: true, description: 'Rendered HTML body — replaced by a redacted placeholder when sensitive is true.' },
    { name: 'text', type: 'string', required: true, description: 'Rendered text body — replaced by a redacted placeholder when sensitive is true.' },
    { name: 'sensitive', type: 'boolean', required: true, description: 'True for secret-bearing mail (OTP codes, reset links); its body is stored redacted so the outbox can’t replay the secret.' },
    { name: 'metadata', type: 'record', required: false, description: 'Purpose tags for analytics (never secrets).' },
    { name: 'tags', type: 'record', required: false, description: 'Provider tags ({ stream, template }).' },
    { name: 'providerMessageId', type: 'string', required: false, description: 'SES message id when delivered.' },
    { name: 'suppressedRecipients', type: 'string[]', required: false, description: 'Recipients dropped for suppression/unsubscribe (set only when some were skipped).' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Queue time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Last status change (sentAt/loggedAt/failedAt/skippedAt + error/skippedReason ride alongside per outcome).' }
  ],
  example: { provider: 'console', stream: 'transactional', templateKey: 'auth.email_otp', status: 'logged', schemaVersion: 2 }
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

// ---------------------------------------------------------------------------
// System kinds — the satellite collections collapsing into things (see
// claude-todo/12-everything-is-a-thing-collections.md). These kinds are
// PROTECTED: the generic /api/v1/things CRUD unconditionally refuses them.
// Only their dedicated utils (register, profile update, themes/algorithms/
// waitlist) write them, each a direct insert that owns the right secure/
// uniqueKeys shape — they do NOT go through createThing. Private state lives
// under the root `secure` field (never crystal, never projected, a single
// BinData blob so the $** text index can't tokenize any field inside it) and
// uniqueness rides the root `uniqueKeys` array (multikey unique sparse index;
// BinData elements, PII keys hashed).

export const PROTECTED_THINGTIME = ['user', 'theme', 'feed-algorithm', 'waitlist'] as const;
export const isProtectedThingtime = (ids: string[]): boolean =>
  ids.some((id) => (PROTECTED_THINGTIME as readonly string[]).includes(id));

const userThingSchema: ThingtimeSchema = {
  id: 'user',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'User (thing)',
  summary: 'A user account as a thing — public profile in crystal, credentials in the secure root field.',
  detail:
    'Users are things too: the crystal holds ONLY the public profile (what /api/v1/users/profile ' +
    'already exposes), so user things are safely listable/searchable like any public thing. ' +
    'Credentials and private account state (email, passwordHash, verification, storage, meta) ' +
    'live under the root `secure` field — omitted from every projection, unreachable by the ' +
    'search grammar, sensitive strings stored as binary so the text index cannot index them. ' +
    'Username/email uniqueness rides uniqueKeys (email hashed). Created only via ' +
    'POST /api/v1/auth/register or /api/v1/auth/service-account — the generic things CRUD ' +
    'refuses this kind. Migrated users keep their legacy id as shareId, so ownerId references, ' +
    'sessions, and rosters keep working unchanged.',
  fields: [
    { name: 'username', type: 'string', required: true, description: 'Unique, lowercased.' },
    { name: 'ttid', type: 'string', required: true, description: 'Thingtime id (currently the username).' },
    { name: 'displayName', type: 'string', required: false, description: 'Optional display name.' },
    { name: 'bio', type: 'string', required: false, description: 'Profile bio.' },
    { name: 'avatarUrl', type: 'string', required: false, description: 'Avatar image URL.' },
    { name: 'bannerUrl', type: 'string', required: false, description: 'Profile banner URL.' }
  ],
  example: { username: 'rick.deckard', ttid: 'rick.deckard', displayName: 'Rick Deckard', bio: 'Blade runner.' }
};

const themeThingSchema: ThingtimeSchema = {
  id: 'theme',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Theme (thing)',
  summary: 'A saved user theme as a thing — share visibility maps onto the acl.',
  detail:
    'The resolved token doc lives in crystal.theme; the legacy visibility enum maps onto the ' +
    'thing acl (public → ["tt:all"], private → ["tt:user"]). shareIds are preserved by the ' +
    'migration so existing share links keep resolving. Written only through /api/v1/themes ' +
    '(the 100-per-user cap and token validation live there); the generic things CRUD refuses ' +
    'this kind.',
  fields: [
    { name: 'name', type: 'string', required: true, max: 60, description: 'Theme name.' },
    { name: 'theme', type: 'object', required: true, description: 'Resolved theme tokens.' }
  ],
  example: { name: 'Midnight', theme: { '--tt-accent': 'hotpink' } }
};

const feedAlgorithmThingSchema: ThingtimeSchema = {
  id: 'feed-algorithm',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Feed algorithm (thing)',
  summary: 'A user-trained feed ranking algorithm as a thing (always private to its owner).',
  detail:
    'Weights over post types, tags, and authors, trained from engagement events. Always acl ' +
    '["tt:user"] — weights encode reading habits. Written only through /api/v1/algorithms*; ' +
    'the generic things CRUD refuses this kind. shareIds are preserved by the migration so ' +
    'users.meta.activeFeedAlgorithmId pointers keep working.',
  fields: [
    { name: 'name', type: 'string', required: true, max: 60, description: 'Algorithm name.' },
    { name: 'emoji', type: 'string', required: true, description: 'Display emoji.' },
    { name: 'parentId', type: 'id', required: false, description: 'Branch lineage parent.' },
    { name: 'weights', type: 'object', required: true, description: '{ types, tags, authors } weight maps.' },
    { name: 'eventCount', type: 'number', required: true, description: 'Engagement events trained on.' },
    { name: 'lastTrainedAt', type: 'date', required: false, description: 'Last training time.' }
  ],
  example: { name: 'Chronological+', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0 }
};

const waitlistThingSchema: ThingtimeSchema = {
  id: 'waitlist',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Waitlist entry (thing)',
  summary: 'A launch-waitlist signup as a thing — the email never leaves the secure field.',
  detail:
    'The crystal is empty by design: the email lives under the root secure field as binary ' +
    '(invisible to projections, the search grammar, and the text index) and uniqueness rides a ' +
    'hashed uniqueKey. System-owned and private (ownerId "system", acl ["tt:user"]) so no ' +
    'viewer ever matches it. Written only through /api/v1/waitlist; duplicate joins are ' +
    'treated as success.',
  fields: [],
  example: {}
};

export const thingtimeSchemas: ThingtimeSchema[] = [
  rootThingSchema,
  postSchema,
  commentSchema,
  reactionSchema,
  shareSchema,
  dataSchema,
  schemaThingSchema,
  saveThingSchema,
  // system kinds (collections collapsing into things — dual-era)
  userThingSchema,
  themeThingSchema,
  feedAlgorithmThingSchema,
  waitlistThingSchema,
  // collections that remain collections
  sessionSchema,
  emailVerificationSchema,
  passwordResetSchema,
  authOtpSchema,
  emailMessageSchema,
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
const isFail = <T extends { ok: boolean }>(value: T | Fail): value is Fail => value.ok === false;

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

// ---------------------------------------------------------------------------
// Extended — the schema-free sidecar every thing carries. Any JSON structure,
// stored inside the platform envelope (shareId, acl, timestamps) but never
// validated against a schema, structured-searchable, or interpreted. Where the
// data crystal is the bounded, searchable open shape, `extended` is the big
// opaque one: external apps park whatever they want here. Replace-on-write
// (null clears, undefined leaves it untouched) — deep-merging arbitrary JSON
// is ambiguous, so we never do. The caps (EXTENDED_MAX_BYTES /
// MAX_EXTENDED_DEPTH / EXTENDED_RESERVED_KEY) live with the other caps up top.

// Keys-only walk: values pass through verbatim, but a key that would corrupt
// storage (BSON null byte, the text-index override) or a stack-hostile depth
// fails loudly. Never mutates or drops — extended is stored exactly as given.
const checkExtendedKeys = (value: unknown, depth: number, path: string): true | Fail => {
  if (depth > MAX_EXTENDED_DEPTH) return fail(400, `extended nests at most ${MAX_EXTENDED_DEPTH} levels (${path || 'root'})`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const entry = checkExtendedKeys(value[index], depth + 1, `${path}[${index}]`);
      if (entry !== true) return entry;
    }
    return true;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes('\u0000')) return fail(400, 'extended keys can’t contain null bytes');
      if (key === EXTENDED_RESERVED_KEY) {
        return fail(400, `extended can’t use the reserved key ${EXTENDED_RESERVED_KEY}`);
      }
      const checked = checkExtendedKeys(entry, depth + 1, path ? `${path}.${key}` : key);
      if (checked !== true) return checked;
    }
    return true;
  }
  return true;
};

// Three-valued: undefined = not provided (callers keep the existing value),
// null = clear it, anything else = the whole new value if it's JSON-serializable
// and fits the byte cap.
export const sanitizeExtended = (value: unknown): { ok: true; value: unknown } | Fail => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return fail(400, 'extended must be JSON-serializable');
  }
  if (typeof serialized !== 'string') return fail(400, 'extended must be JSON-serializable');
  // Byte cap via UTF-16 code-unit bounds, skipping the full TextEncoder pass in
  // the common case: every code unit is ≥1 and ≤3 UTF-8 bytes (registry stays
  // client-pure, so no node Buffer). length > cap ⇒ definitely over; length*3 ≤
  // cap ⇒ definitely under; only the ambiguous middle band needs a precise
  // byte count.
  if (serialized.length > EXTENDED_MAX_BYTES) {
    return fail(400, `extended exceeds the ${EXTENDED_MAX_BYTES} byte limit`);
  }
  if (serialized.length * 3 > EXTENDED_MAX_BYTES) {
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > EXTENDED_MAX_BYTES) {
      return fail(400, `extended exceeds the ${EXTENDED_MAX_BYTES} byte limit`);
    }
  }
  const keys = checkExtendedKeys(value, 0, '');
  if (keys !== true) return keys;
  return { ok: true, value };
};

// Schema-thing field names double as crystal paths in the search builder
// (crystal.<name>). A name is ONE path segment — nesting is expressed via
// `children`/`items`, never dots — so a schema tree bounded by
// MAX_SCHEMA_FIELD_DEPTH can never flatten to a dotted path deeper than the
// search grammar's MAX_FIELD_DEPTH or a crystal deeper than
// MAX_DATA_CRYSTAL_DEPTH. Exported so the builtin-schema seed migration maps
// registry fields onto the exact same grammar sanitizeSchemaCrystal enforces
// on user-authored schema things.
export const SCHEMA_FIELD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const MAX_SCHEMA_FIELD_NAME_CHARS = 60;
export const MAX_SCHEMA_FIELD_DESCRIPTION_CHARS = 200;

// whole-number constraint (maxLength/minItems/maxItems); fail-loudly on junk
const sanitizeCountConstraint = (
  raw: unknown,
  label: string,
  ceiling: number
): { ok: true; value: number | null } | Fail => {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 0) return fail(400, `${label} must be a whole number ≥ 0`);
  if (num > ceiling) return fail(400, `${label} caps at ${ceiling}`);
  return { ok: true, value: num };
};

// One recursive walk sanitizes named fields AND unnamed array item specs.
// Objects nest via `children`, arrays type their entries via `items`; the
// shared node counter + depth cap bound the whole tree the same way data
// crystals are bounded.
const sanitizeSchemaField = (
  raw: unknown,
  depth: number,
  counter: { nodes: number },
  named: boolean,
  path: string
): { ok: true; field: SchemaThingField } | Fail => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail(400, `Each schema field must be an object (${path || 'fields'})`);
  }
  counter.nodes += 1;
  if (counter.nodes > MAX_SCHEMA_FIELDS) {
    return fail(400, `A schema can define at most ${MAX_SCHEMA_FIELDS} fields (nested ones count)`);
  }
  if (depth > MAX_SCHEMA_FIELD_DEPTH) {
    return fail(400, `Schema fields nest at most ${MAX_SCHEMA_FIELD_DEPTH} levels (${path})`);
  }
  const def = raw as Record<string, unknown>;

  let fieldName = '';
  if (named) {
    fieldName = typeof def.name === 'string' ? def.name.trim() : '';
    if (!fieldName || fieldName.length > MAX_SCHEMA_FIELD_NAME_CHARS || !SCHEMA_FIELD_NAME_PATTERN.test(fieldName)) {
      return fail(400, `Schema field names are letters/numbers/_/- — nest with children, not dots (got ${String(def.name).slice(0, 80)})`);
    }
    // top-level crystal keys `schema`/`schemaId` tag data things with their
    // schema; a field by either name could never round-trip
    if (depth === 1 && (fieldName.toLowerCase() === 'schema' || fieldName.toLowerCase() === 'schemaid')) {
      return fail(400, `Field name ${fieldName} is reserved (it tags data things with their schema)`);
    }
  }
  const label = path || fieldName || 'items';

  const type = SCHEMA_FIELD_TYPES.includes(def.type as any) ? (def.type as SchemaFieldType) : null;
  if (!type) return fail(400, `Schema field types are ${SCHEMA_FIELD_TYPES.join(', ')} (${label})`);

  const field = (named ? { name: fieldName, type } : { type }) as SchemaThingField;

  const fieldDescription = typeof def.description === 'string' ? def.description.trim() : '';
  if (fieldDescription) field.description = fieldDescription.slice(0, MAX_SCHEMA_FIELD_DESCRIPTION_CHARS);

  if (named && (def.required === true || def.required === 'true')) field.required = true;

  if (type === 'enum') {
    if (!Array.isArray(def.values) || !def.values.length) return fail(400, `Enum field ${label} needs a values list`);
    if (def.values.length > MAX_SCHEMA_ENUM_VALUES) {
      return fail(400, `Enum field ${label} can have at most ${MAX_SCHEMA_ENUM_VALUES} values`);
    }
    const values: string[] = [];
    for (const value of def.values) {
      if (typeof value !== 'string') return fail(400, `Enum field ${label} values must be strings`);
      // collapse inner whitespace: values are dropdown labels, and the builder
      // round-trips them one-per-line, so embedded newlines can never survive
      const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, MAX_SCHEMA_ENUM_VALUE_CHARS);
      if (trimmed && !values.includes(trimmed)) values.push(trimmed);
    }
    if (!values.length) return fail(400, `Enum field ${label} needs a values list`);
    field.values = values;
  }

  if (type === 'number') {
    const min = Number(def.min);
    const max = Number(def.max);
    if (def.min !== undefined && def.min !== null) {
      if (!Number.isFinite(min)) return fail(400, `Field ${label} min must be a number`);
      field.min = min;
    }
    if (def.max !== undefined && def.max !== null) {
      if (!Number.isFinite(max)) return fail(400, `Field ${label} max must be a number`);
      field.max = max;
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return fail(400, `Field ${label} min can’t exceed its max`);
    }
    if (typeof def.unit === 'string' && def.unit.trim()) {
      field.unit = def.unit.trim().slice(0, MAX_SCHEMA_UNIT_CHARS);
    }
  }

  if (type === 'string' || type === 'string[]') {
    const maxLength = sanitizeCountConstraint(def.maxLength, `Field ${label} maxLength`, MAX_TEXT_CHARS);
    if (isFail(maxLength)) return maxLength;
    if (maxLength.value !== null && maxLength.value > 0) field.maxLength = maxLength.value;
  }

  if (type === 'string[]' || type === 'array') {
    const minItems = sanitizeCountConstraint(def.minItems, `Field ${label} minItems`, MAX_DATA_ARRAY_ITEMS);
    if (isFail(minItems)) return minItems;
    const maxItems = sanitizeCountConstraint(def.maxItems, `Field ${label} maxItems`, MAX_DATA_ARRAY_ITEMS);
    if (isFail(maxItems)) return maxItems;
    if (minItems.value !== null) field.minItems = minItems.value;
    if (maxItems.value !== null) field.maxItems = maxItems.value;
    if (field.minItems !== undefined && field.maxItems !== undefined && field.minItems > field.maxItems) {
      return fail(400, `Field ${label} minItems can’t exceed its maxItems`);
    }
  }

  if (type === 'object') {
    const children = sanitizeSchemaFieldList(def.children, depth + 1, counter, `${label}.children`);
    if (isFail(children)) return children;
    field.children = children.fields;
  }

  if (type === 'array') {
    if (!def.items || typeof def.items !== 'object' || Array.isArray(def.items)) {
      return fail(400, `Array field ${label} needs an items spec ({ type, ... })`);
    }
    const items = sanitizeSchemaField(def.items, depth + 1, counter, false, `${label}.items`);
    if (isFail(items)) return items;
    field.items = items.field as SchemaItemSpec;
  }

  return { ok: true, field };
};

// A sibling list: bounded, recursive, duplicate names rejected case-insensitively
const sanitizeSchemaFieldList = (
  raw: unknown,
  depth: number,
  counter: { nodes: number },
  path: string
): { ok: true; fields: SchemaThingField[] } | Fail => {
  if (!Array.isArray(raw)) return fail(400, `Schema fields must be a list (${path})`);
  const fields: SchemaThingField[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const sanitized = sanitizeSchemaField(entry, depth, counter, true, path);
    if (isFail(sanitized)) return sanitized;
    const key = sanitized.field.name.toLowerCase();
    // fail loudly (module convention) — silently dropping a duplicate would
    // lose a user's field definition with a 200
    if (seen.has(key)) return fail(400, `Duplicate schema field name: ${sanitized.field.name} (${path})`);
    seen.add(key);
    fields.push(sanitized.field);
  }
  if (!fields.length) return fail(400, `Schemas need at least one field (${path})`);
  return { ok: true, fields };
};

const sanitizeSchemaCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return fail(400, 'Schemas need a name');
  if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Schema name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);

  const description = typeof input.description === 'string' ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : '';

  const sanitized = sanitizeSchemaFieldList(input.fields, 1, { nodes: 0 }, 'fields');
  if (isFail(sanitized)) return sanitized;

  const crystal: Record<string, unknown> = { name, description, fields: sanitized.fields };

  // fork provenance: a bare thing id, never resolved or trusted on write
  if (input.forkOf !== undefined && input.forkOf !== null && input.forkOf !== '') {
    const forkOf = typeof input.forkOf === 'string' ? input.forkOf.trim() : '';
    if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, 'forkOf must be a thing id');
    crystal.forkOf = forkOf;
  }

  return { ok: true, crystal };
};

// ---------------------------------------------------------------------------
// Value validation against a schema-thing field tree. Pure and shared: the
// schema builder previews with it, the create-a-thing form validates with it.
// It is a HELPER, never a write gate — schemas stay discovery/search sugar
// (things are validated by their thingtime crystal sanitizers, not by
// user-published schemas).

export type SchemaValueIssue = { path: string; message: string };

const valueAtPath = (value: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const checkSchemaValue = (
  field: SchemaThingField | (SchemaItemSpec & { name?: string }),
  value: unknown,
  path: string,
  issues: SchemaValueIssue[]
): void => {
  const missing = value === undefined || value === null || value === '';
  if (missing) {
    if ((field as SchemaThingField).required) issues.push({ path, message: 'required' });
    return;
  }
  switch (field.type) {
    case 'string':
      if (typeof value !== 'string') issues.push({ path, message: 'must be text' });
      else if (field.maxLength && value.length > field.maxLength) {
        issues.push({ path, message: `caps at ${field.maxLength} characters` });
      }
      return;
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      if (typeof value !== 'number' || !Number.isFinite(num)) issues.push({ path, message: 'must be a number' });
      else {
        if (field.min !== undefined && num < field.min) issues.push({ path, message: `min ${field.min}` });
        if (field.max !== undefined && num > field.max) issues.push({ path, message: `max ${field.max}` });
      }
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') issues.push({ path, message: 'must be true or false' });
      return;
    case 'date': {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) issues.push({ path, message: 'must be a date' });
      return;
    }
    case 'enum':
      if (typeof value !== 'string' || !(field.values || []).includes(value)) {
        issues.push({ path, message: `one of: ${(field.values || []).join(', ')}` });
      }
      return;
    case 'string[]': {
      if (!Array.isArray(value)) {
        issues.push({ path, message: 'must be a list of text values' });
        return;
      }
      if (field.minItems !== undefined && value.length < field.minItems) {
        issues.push({ path, message: `needs at least ${field.minItems} entries` });
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        issues.push({ path, message: `caps at ${field.maxItems} entries` });
      }
      value.forEach((entry, index) => {
        if (typeof entry !== 'string') issues.push({ path: `${path}[${index}]`, message: 'must be text' });
        else if (field.maxLength && entry.length > field.maxLength) {
          issues.push({ path: `${path}[${index}]`, message: `caps at ${field.maxLength} characters` });
        }
      });
      return;
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        issues.push({ path, message: 'must be an object' });
        return;
      }
      for (const child of field.children || []) {
        const childValue = valueAtPath(value as Record<string, unknown>, child.name.split('.'));
        checkSchemaValue(child, childValue, `${path}.${child.name}`, issues);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        issues.push({ path, message: 'must be a list' });
        return;
      }
      if (field.minItems !== undefined && value.length < field.minItems) {
        issues.push({ path, message: `needs at least ${field.minItems} entries` });
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        issues.push({ path, message: `caps at ${field.maxItems} entries` });
      }
      if (field.items) {
        value.forEach((entry, index) => checkSchemaValue(field.items!, entry, `${path}[${index}]`, issues));
      }
      return;
    }
  }
};

export const validateValueAgainstFields = (
  fields: SchemaThingField[],
  value: Record<string, unknown>
): { ok: boolean; issues: SchemaValueIssue[] } => {
  const issues: SchemaValueIssue[] = [];
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const field of fields || []) {
    checkSchemaValue(field, valueAtPath(input, field.name.split('.')), field.name, issues);
  }
  return { ok: !issues.length, issues };
};

// System-kind sanitizers: deep validation lives in each kind's dedicated
// utils (register/profile/themes/algorithms/waitlist) — these enforce the
// structural bounds so no write path can bypass them.
export const MAX_USERNAME_CHARS = 60;
export const MAX_DISPLAY_NAME_CHARS = 80;
export const MAX_BIO_CHARS = 500;
export const MAX_PROFILE_URL_CHARS = 64 * 1024;

const boundedString = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const sanitizeUserCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const username = boundedString(input.username, MAX_USERNAME_CHARS)?.toLowerCase();
  if (!username) return fail(400, 'User things need a username');
  return {
    ok: true,
    crystal: {
      username,
      ttid: boundedString(input.ttid, MAX_USERNAME_CHARS) || username,
      displayName: boundedString(input.displayName, MAX_DISPLAY_NAME_CHARS),
      bio: boundedString(input.bio, MAX_BIO_CHARS),
      avatarUrl: boundedString(input.avatarUrl, MAX_PROFILE_URL_CHARS),
      bannerUrl: boundedString(input.bannerUrl, MAX_PROFILE_URL_CHARS)
    }
  };
};

const sanitizeThemeCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const name = boundedString(input.name, 60);
  if (!name) return fail(400, 'Themes need a name');
  if (!input.theme || typeof input.theme !== 'object' || Array.isArray(input.theme)) {
    return fail(400, 'Themes need a theme token object');
  }
  return { ok: true, crystal: { name, theme: input.theme } };
};

const sanitizeFeedAlgorithmCrystal = (
  input: Record<string, unknown>
): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const name = boundedString(input.name, 60);
  if (!name) return fail(400, 'Algorithms need a name');
  const emoji = boundedString(input.emoji, 16) || '🧠';
  if (!input.weights || typeof input.weights !== 'object' || Array.isArray(input.weights)) {
    return fail(400, 'Algorithms need a weights object');
  }
  const eventCount = Number(input.eventCount);
  return {
    ok: true,
    crystal: {
      name,
      emoji,
      parentId: boundedString(input.parentId, 128),
      weights: input.weights,
      eventCount: Number.isFinite(eventCount) && eventCount >= 0 ? Math.floor(eventCount) : 0,
      lastTrainedAt: boundedString(input.lastTrainedAt, 40)
    }
  };
};

const crystalSanitizers: Record<
  string,
  (input: Record<string, unknown>, appliedIds: string[]) => { ok: true; crystal: Record<string, unknown> } | Fail
> = {
  post: sanitizePostCrystal,
  comment: sanitizeCommentCrystal,
  reaction: sanitizeReactionCrystal,
  share: () => ({ ok: true, crystal: {} }),
  save: () => ({ ok: true, crystal: {} }),
  schema: sanitizeSchemaCrystal,
  data: sanitizeDataCrystal,
  user: sanitizeUserCrystal,
  theme: sanitizeThemeCrystal,
  'feed-algorithm': sanitizeFeedAlgorithmCrystal,
  waitlist: () => ({ ok: true, crystal: {} })
};

export type ValidatedCrystal = { ok: true; thingtime: string[]; crystal: Record<string, unknown>; requiresTarget: boolean };

// Validates a thingtime schema-id list + raw crystal payload. The sanitized
// crystal is the union of each schema's sanitized fields — later schemas never
// clobber earlier ones' keys with undefined.
//
// Crystals are optionally schema-less: omitting thingtime (or passing an empty
// list) defaults to ['data'], so a bare { crystal: {...} } behaves like an
// extended-style free-form field bag — bounded arbitrary JSON, searchable on
// /search — without declaring any schema. Storage always carries the resolved
// non-empty thingtime; schema-lessness is an input convenience, never a stored
// state.
export const validateThingtimeCrystal = (thingtime: unknown, crystal: unknown): ValidatedCrystal | Fail => {
  if (thingtime === undefined || thingtime === null || (Array.isArray(thingtime) && !thingtime.length)) {
    thingtime = ['data'];
  }
  if (!Array.isArray(thingtime)) {
    return fail(400, 'thingtime must be a list of schema ids (or omitted for a schema-less data thing)');
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
