import { validateMediaPipeline } from '../webPlatform/mediaPipeline';
import { validateLiveSource } from './liveSources';
import { fileSyncSchema, parseFileSyncConfiguration, FILE_SYNC_KIND } from '../fileSync/configuration';
import { HTML_ALLOWED_TAGS } from '../components/Kinds/htmlRenderPolicy';
import { PASSWORD_TYPES, FIELD_TYPES } from '../passwords/model';
import { TIMELINE_SNAPSHOT_PART_KIND } from '../timeline/snapshotParts.ts';
import { DEVICE_PLATFORMS } from '../devices/platform.ts';
import { TIMELINE_BRANCH_KIND, TIMELINE_BRANCH_HEAD_KIND } from '../timeline/branches.ts';
import { TIMELINE_NOTE_KIND } from '../timeline/notes.ts';
import { TIMELINE_VERSION_NAME_KIND } from '../timeline/versionNames.ts';
import { copyActionJson } from './actionJsonInput.ts';
import { TIMELINE_EVENT_KIND, TIMELINE_LINK_KIND } from '../timeline/contract.ts';
import { parseBrowserExpressionLimits } from './browserActions';
import { BROWSER_ACTION_EXPANDED_LIMITS } from './browserActions';
import { parseActionRequestPagination } from './actionRequestPagination';
import { BROWSER_ACTION_OPS, actionHttpEndpoint, isActionHttpEndpoint } from './browserActions';
import { MAX_POST_THINGS, postThingReferences } from '../components/Feed/postThingReferences.ts';
import { isActionLookupProvider } from './actionLookups';
// Thingtime Schemas — the single source of truth for the shapes Thingtime data
// can take. Everything in the `things` collection is a thing: one root Thing
// schema (schemaVersion per doc), sub-schemas applied via the root `thingtime`
// array of schema ids, and the sub-schema payload living under `crystal`.
//
// This module is intentionally PURE (no mongo/node imports) so it can be
// imported by the client (/schemas page), the docs, and the server API layer
// alike — the same apiDocs.ts pattern.

// Relative with an explicit extension (not `~/`) so bare `node --test` can
// load this module without a path-alias loader — reactionTokens is itself
// import-free, keeping the pure chain intact for the colocated
// builtin-projection test.
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { MAX_REACTION_EMOJIS, sanitizeReactionToken } from '../utils/reactionTokens.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { blocksToText, isEditorJsDoc, isEditorJsDocSafeToEdit } from '../components/Editor/editorJsValue.ts';
import { MAX_EXPRESSION_ARGS, catalogueSignature, isLambdaArg } from './actionExpressions.ts';
// Pure attachment metadata/envelope vocabulary shared with the server storage
// layer. This module has no Node imports, so registry remains browser-safe.
import {
	ATTACHMENT_ENVELOPE_VERSION,
	ATTACHMENT_MEDIA_KINDS,
	ATTACHMENT_PROFILE_SLOTS,
	ATTACHMENT_PURPOSES,
	ATTACHMENT_STATES,
	ATTACHMENT_THINGTIME,
	MAX_ATTACHMENT_CONTENT_TYPE_CHARS,
	MAX_ATTACHMENT_NAME_CHARS,
	sanitizeAttachmentPublicMetadata
} from '../api/utils/attachments/attachmentCore.ts';

export type ThingtimeFieldType = 'array' | 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'string[]' | 'object' | 'record' | 'id';

export type ThingtimeSchemaField = {
  name: string;
  type: ThingtimeFieldType;
  required: boolean;
  description: string;
  // enum values / string max chars / array max items, when they apply
  values?: string[];
  max?: number;
  // unit of `max` when it is NOT the default (chars for strings, items for
  // lists) — e.g. reaction.emoji caps EMOJI, not UTF-16 chars. A non-default
  // unit keeps `max` out of the seeded schema-thing grammar, whose
  // maxLength/maxItems are defined in the default units.
  maxUnit?: string;
  // number floor, when it applies (e.g. listing price >= 0)
  min?: number;
  // 'object' fields with a KNOWN closed shape declare it here so the builtin
  // seed can mirror it into the schema-thing grammar; genuinely open bags are
  // typed 'record' instead and stay opaque by design
  children?: ThingtimeSchemaField[];
  // set by Thingtime on write — never supplied by the creator
  system?: boolean;
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
  // the thingtime ids a thing of this kind actually carries (default [id]) —
  // e.g. share things ride ["post","share"]
  appliedThingtime?: string[];
  // dedicated write path, for kinds the generic things CRUD refuses
  createdVia?: string;
  fields: ThingtimeSchemaField[];
  // Ordinary editable preview copied with the public schema definition.
  render?: Record<string, unknown>;
  example: Record<string, unknown>;
};

export const THING_VISIBILITIES = ['public', 'friends', 'family', 'private', 'hidden', 'custom', 'inherit'] as const;
export type ThingVisibility = (typeof THING_VISIBILITIES)[number];

// Protected operational Things created when an admin migration throws. The
// prefix is reserved so generic callers cannot squat a future diagnostic URL.
export const ERROR_LOG_THINGTIME = 'error-log';
export const ERROR_LOG_ID_PREFIX = 'error-log-';
// One root expiry policy for disposable control Things; excludes content and
// invitations whose expiry must perform cleanup/refunds before deletion.
export const EPHEMERAL_CONTROL_THINGTIMES = ['migration-diagnostic', ERROR_LOG_THINGTIME] as const;
export const MIGRATION_DIAGNOSTIC_THINGTIME = 'migration-diagnostic';
export const MIGRATION_DIAGNOSTIC_ID_PREFIX = 'migration-diagnostic-';

// Embed SDK things (api/utils/things/embeddedThings.ts), served only by
// /api/v1/embed/things. Named here, with the other protected kinds, so the
// pure registry stays the single source for what generic /things CRUD and the
// ordinary post/search surfaces must exclude.
export const EMBEDDED_THINGTIME = 'embed';

// GitHub/Vercel control-plane projections and their append-only audit events.
// This registry is the single source for their protection and schema docs.
export const CI_CONTROL_THINGTIME = [
  'ci-repository',
  'ci-automation',
  'ci-feature',
  'ci-feature-stack',
  'ci-feature-stack-entry',
  'ci-branch',
  'ci-pull-request',
  'ci-workflow-run',
  'ci-deployment',
  'ci-preview',
  'ci-preview-policy',
  'ci-dispatch',
  'ci-stack-chat-message',
  'ci-event'
] as const;

// ---------------------------------------------------------------------------
// ACL permissions. A thing's audience is an array of tt: entries — grants,
// plus '-'-prefixed exclusions:
//
//   tt:all              everyone, including logged-out viewers
//   tt:user             the thing's owner
//   tt:userFriends      the owner's friends circle
//   tt:userFamily       the owner's family circle
//   tt:user/<username>  one specific user (grant or exclude)
//   tt:app/<clientId>   users of ONE embedded app, via that app's tokens —
//                       the audience app-data sharing uses. Never matches a
//                       Thingtime-site viewer (aclEntryMatches returns false);
//                       only app-token read paths resolve it (apps/namespace).
//                       NOTE: this entry is the AUDIENCE among an app's users,
//                       never the app-namespace membership marker — that is
//                       the server-stamped root `appId` field (unforgeable
//                       through the generic routes; acl entries are not).
//   tt:inherit          attached things (comments, reactions) — as visible as
//                       their target
//   tt:hidden           unlisted: matches NO viewer here (owner short-circuit
//                       aside) — visibility comes from the doc's random
//                       linkKey instead: anyone presenting it via a ?key= URL
//                       may view (things.ts canView). Never in feeds/search.
//   tt:custom           the custom-audience marker: matches nobody itself,
//                       but flips the thing into capability mode — general
//                       viewers (via a tt:all / tt:hidden baseline) get READ
//                       ONLY, and engagement/edit rights come from the
//                       per-user and per-group grants below.
//   tt:group/<groupId>  members of one of the owner's groups (group things +
//                       group-member docs, api/utils/groups). The read path
//                       preloads the viewer's memberships into
//                       AclViewer.groupIds, like friendIds.
//
// Capability suffixes (custom audiences): a tt:user/<username> or
// tt:group/<id> grant may carry '/comment' or '/write' — write ⊃ comment ⊃
// read. The suffix never changes WHO can view (the base entry grants view);
// it feeds aclCapabilityFor, which the engagement gate (comment/react) and
// the shared-edit path (PATCH crystal) consult on tt:custom things.
//
// Examples: ['tt:all'] is public; ['-tt:all', 'tt:userFriends', 'tt:user'] is
// friends-only; ['tt:all', '-tt:user/somebody'] is public except one user.
//
// Evaluation: the MOST SPECIFIC entry matching the viewer decides (exclusions
// win ties), so a broad '-tt:all' never locks out someone a narrower grant
// admits. Specificity: tt:all < circles/groups < tt:user < tt:user/<name>.
// Owners always view their own things regardless of acl. tt:userFriends
// resolves against the real friend graph (accepted `friend` things — the read
// path preloads the viewer's friend set into AclViewer.friendIds). No family
// graph exists yet, so tt:userFamily still resolves to the owner only.

export const ACL_ALL = 'tt:all';
export const ACL_OWNER = 'tt:user';
export const ACL_FRIENDS = 'tt:userFriends';
export const ACL_FAMILY = 'tt:userFamily';
export const ACL_INHERIT = 'tt:inherit';
export const ACL_HIDDEN = 'tt:hidden';
export const ACL_CUSTOM = 'tt:custom';
export const ACL_USER_PREFIX = 'tt:user/';
export const ACL_APP_PREFIX = 'tt:app/';
export const ACL_GROUP_PREFIX = 'tt:group/';
// audience = "holders of a connections link to an external account that
// SOURCES this post" — one CONSTANT entry, resolved live against relational
// external-post-source membership docs (see aclEntryMatches). Constant by
// design: the per-source ancestor below grew the acl array by one entry per
// sourcing account, which for personal-timeline providers (one account per
// user) meant one entry per user — unbounded on a viral post, and disclosed
// to every reader through PublicPost.acl.
export const ACL_EXT_SOURCED = 'tt:extsourced';
// LEGACY per-source audience: `tt:extacct/<accountId>`. Still evaluated so
// pre-migration rows keep resolving; the relational-external-post-sources
// migration rewrites them to ACL_EXT_SOURCED. No writer mints these any more.
export const ACL_EXTACCT_PREFIX = 'tt:extacct/';

const ACL_ENTRY_PATTERN = /^-?tt:[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// raised from 16 for custom audiences (a hand-picked user list + groups);
// still a hard bound so acl stays a bounded field, never an unbounded list
const MAX_ACL_ENTRIES = 64;
const MAX_ACL_ENTRY_CHARS = 64;

// legacy visibility names map onto acls (accepted as input everywhere an acl
// is, and derived back for the wire so old clients keep working)
export const LEGACY_VISIBILITY_ACLS: Record<ThingVisibility, string[]> = {
  public: [ACL_ALL],
  friends: ['-tt:all', ACL_FRIENDS, ACL_OWNER],
  family: ['-tt:all', ACL_FAMILY, ACL_OWNER],
  private: [ACL_OWNER],
  hidden: [ACL_HIDDEN, ACL_OWNER],
  // the minimal custom acl — real custom audiences arrive as explicit acls
  // composed by the picker (marker + baseline + grants)
  custom: [ACL_CUSTOM, ACL_OWNER],
  inherit: [ACL_INHERIT]
};

export const aclFromVisibility = (visibility: unknown): string[] | null =>
  typeof visibility === 'string' && visibility in LEGACY_VISIBILITY_ACLS ? [...LEGACY_VISIBILITY_ACLS[visibility as ThingVisibility]] : null;

export const visibilityFromAcl = (acl: string[]): ThingVisibility => {
  if (acl.includes(ACL_INHERIT)) return 'inherit';
  // custom outranks its own baseline entries (tt:all / tt:hidden may ride
  // along as the general-audience toggle) so the wire round-trips 'custom'
  if (acl.includes(ACL_CUSTOM)) return 'custom';
  if (acl.includes(ACL_ALL)) return 'public';
  if (acl.includes(ACL_FRIENDS)) return 'friends';
  if (acl.includes(ACL_FAMILY)) return 'family';
  if (acl.includes(ACL_HIDDEN)) return 'hidden';
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
      return {
        ok: false,
        status: 400,
        error: `acl entries look like tt:all, tt:user, tt:userFriends, or tt:user/<username>, optionally '-' prefixed (got ${entry.slice(0, 80)})`
      };
    }
    // A tt:user/ or tt:group/ grant is exactly ONE subject segment plus an
    // optional /comment|/write capability suffix (splitCapability below).
    // Anything deeper is ambiguous — "tt:user/a/b" could mean "user a with
    // capability b" or "user a/b, read" — so refuse it instead of guessing.
    const positive = entry.startsWith('-') ? entry.slice(1) : entry;
    let normalized = entry;
    for (const prefix of [ACL_USER_PREFIX, ACL_GROUP_PREFIX]) {
      if (!positive.startsWith(prefix)) continue;
      const subject = positive.slice(prefix.length).replace(/\/(comment|write)$/, '');
      if (!subject || subject.includes('/')) {
        return {
          ok: false,
          status: 400,
          error: `${prefix}… entries take one name plus an optional /comment or /write (got ${entry.slice(0, 80)})`
        };
      }
      // Canonicalize the USERNAME to lower case. aclEntryMatches compares it
      // case-insensitively, but the feed/search grant clause (things.ts
      // visibilityQueryFor) matches acl strings EXACTLY, against a lower-cased
      // `tt:user/<username>` built from the viewer. Storing 'tt:user/Bob/write'
      // verbatim therefore honours the grant on direct access (canView) while
      // the grantee's own feed never surfaces it — a grant that half-works.
      // Usernames are already stored lower case (auth/registerUser), so this
      // only canonicalizes hand-authored acls and changes no view decision.
      // Group ids are NOT folded: they are opaque and compared exactly
      // (viewer.groupIds.has), so lower-casing one could break a real match.
      if (prefix === ACL_USER_PREFIX) {
        normalized = `${entry.startsWith('-') ? '-' : ''}${prefix}${subject.toLowerCase()}${positive.slice(prefix.length + subject.length)}`;
      }
    }
    if (!entries.includes(normalized)) entries.push(normalized);
    if (entries.length > MAX_ACL_ENTRIES) return { ok: false, status: 400, error: `acl can have at most ${MAX_ACL_ENTRIES} entries` };
  }
  if (!entries.length) return { ok: false, status: 400, error: 'acl needs at least one entry' };
  return entries;
};

// friendIds: shareIds of users the viewer has an ACCEPTED friendship with,
// preloaded by the read path (one batched query per request) so acl checks
// stay sync + pure. Absent set = no friend info loaded = circle denies.
export type AclViewer = { id: string | null; username?: string | null; friendIds?: ReadonlySet<string> } | null;

// Custom-audience capabilities: write ⊃ comment ⊃ read. A grant entry may
// carry a '/comment' or '/write' suffix (tt:user/<name>/write,
// tt:group/<id>/comment) — the base entry decides WHO, the suffix decides
// HOW MUCH.
export type AclCapability = 'none' | 'read' | 'comment' | 'write';
const CAP_RANK: Record<AclCapability, number> = { none: 0, read: 1, comment: 2, write: 3 };

// Only a SUBJECT grant carries a capability, and only over a non-empty
// subject: 'tt:user/<name>' and 'tt:group/<id>'. Anchoring the strip is what
// keeps `write` and `comment` usable as ordinary usernames — bare
// `id.endsWith('/write')` reads the picker's own output for the account named
// "write" (tt:user/write) as base 'tt:user', i.e. the OWNER entry, so that
// account silently receives nothing and the acl gains a phantom owner grant.
// Same ambiguity the '/'-in-username guard (auth/registerUser.ts) closes from
// the other side; usernames are already '/'-free, so the base can never be a
// deeper path here.
const splitCapability = (id: string): { base: string; cap: 'read' | 'comment' | 'write' } => {
  for (const [suffix, cap] of [
    ['/write', 'write'],
    ['/comment', 'comment']
  ] as const) {
    if (!id.endsWith(suffix)) continue;
    const base = id.slice(0, -suffix.length);
    const grantPrefix = [ACL_USER_PREFIX, ACL_GROUP_PREFIX].find((prefix) => base.startsWith(prefix));
    if (grantPrefix && base.length > grantPrefix.length) return { base, cap };
  }
  return { base: id, cap: 'read' };
};

const aclSpecificity = (id: string): number => {
  const { base } = splitCapability(id);
  if (base === ACL_ALL) return 0;
  if (base === ACL_OWNER) return 2;
  if (base.startsWith(ACL_USER_PREFIX)) return 3;
  return 1; // circles + groups
};

const aclEntryMatches = (id: string, viewer: AclViewer, ownerId: string, docId?: string | null): boolean => {
  const { base } = splitCapability(id);
  if (base === ACL_ALL) return true;
  if (!viewer?.id) return false;
  if (base === ACL_OWNER) return viewer.id === ownerId;
  if (base.startsWith(ACL_USER_PREFIX)) {
    const username = base.slice(ACL_USER_PREFIX.length).toLowerCase();
    return !!viewer.username && viewer.username.toLowerCase() === username;
  }
  // friends circle: real graph — the viewer sees it when they're an accepted
  // friend of the owner (friendship is mutual, so the viewer's own friend set
  // answers for any owner). Owner always counts as their own friend.
  if (id === ACL_FRIENDS) return viewer.id === ownerId || viewer.friendIds?.has(ownerId) === true;
  // family circle: no family graph yet — owner only
  if (id === ACL_FAMILY) return viewer.id === ownerId;
  return false;
};

// The viewer's capability on a custom-audience thing. Owner → write. Grants
// are positive entries only (exclusions shape VIEW, not capabilities); the
// strongest matching suffix wins, and any plain view match floors at 'read'.
// Callers only consult this when acl carries tt:custom.
//
// No view, no capability. An exclusion outranks a grant for VIEW under
// most-specific-wins, so an acl carrying BOTH a grant and a same-specificity
// exclusion for one subject — ['tt:custom','tt:all','tt:user',
// 'tt:user/bob/write','-tt:user/bob'] — denies bob the thing entirely. Without
// this floor the loop below still saw the positive 'tt:user/bob/write' and
// handed back 'write', i.e. edit rights on a thing the same acl says he may
// not even read. Every caller happens to prove view first today (updateThing
// via canViewInherited, the engage gates via findViewableThingAs), so this was
// unreachable rather than live — but that made the invariant a precondition
// every future caller had to rediscover. Anchoring it here makes the function
// answer correctly on its own.
export const aclCapabilityFor = (acl: string[], viewer: AclViewer, ownerId: string): AclCapability => {
  if (viewer?.id && viewer.id === ownerId) return 'write';
  if (!aclAllows(acl, viewer, ownerId)) return 'none';
  let best: AclCapability = 'read';
  for (const raw of acl) {
    if (raw.startsWith('-')) continue;
    const { base, cap } = splitCapability(raw);
    if (cap === 'read') continue;
    if (base === ACL_INHERIT || base === ACL_CUSTOM) continue;
    if (!aclEntryMatches(raw, viewer, ownerId)) continue;
    if (CAP_RANK[cap] > CAP_RANK[best]) best = cap;
  }
  return best;
};

// Most-specific matching entry wins; exclusions win ties. Callers short-circuit
// the owner before asking (owners always see their own things).
// docId (the doc's own shareId) is needed only by the constant tt:extsourced
// audience, whose membership is per-(post, viewer) rather than per-entry;
// callers without it simply never match that entry, which fails closed.
export const aclAllows = (acl: string[], viewer: AclViewer, ownerId: string, docId?: string | null): boolean => {
  let best = -1;
  let allow = false;
  for (const raw of acl) {
    const negated = raw.startsWith('-');
    const id = negated ? raw.slice(1) : raw;
    if (id === ACL_INHERIT) continue;
    if (!aclEntryMatches(id, viewer, ownerId, docId)) continue;
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

// Embeddable "Login with Thingtime" apps (see api/utils/apps): registered by a
// developer user, identified by clientId. SSO origins are default-open; the
// origins list is optional reference metadata.
export const MAX_APP_NAME_CHARS = 80;
export const MAX_APP_ORIGINS = 20;
export const MAX_APPS_PER_USER = 20;
export const MAX_APP_DATA_KEY_CHARS = 128;
export const MAX_APP_DATA_VALUE_BYTES = 32 * 1024;
// App storage is byte-budgeted, not doc-counted. Every registered app has a
// standing aggregate allowance across all of its users, and each (user, app)
// namespace has its own allowance inside that ceiling. The aggregate is on
// the app Thing; per-user usage/overrides are protected relational ledgers.
// sizeBytes deltas charge both race-safe counters and deletes refund them.
// Sandbox namespaces get a tighter ephemeral allowance plus their existing
// app-wide windowed brake.
export const DEFAULT_APP_STORAGE_ALLOWANCE_BYTES = 5 * 1024 * 1024 * 1024;
export const DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES = 50 * 1024 * 1024;
export const APP_STORAGE_ACCOUNTING_VERSION = 1;
// Root marker for the server-only app-user ledger envelope. Unlike the old
// `data` shape, generic Thing sanitizers never copy this field, so a hot path
// can distinguish canonical accounting authority from a historical/user-
// editable occupant at the same deterministic id.
export const APP_STORAGE_LEDGER_ENVELOPE_VERSION = 1;
// Per-(app,user) accounting Things use deterministic ids under this namespace.
// Generic Thing creation must reserve it so an end user cannot pre-claim a
// future counter id (including another user's globally-unique shareId).
export const APP_STORAGE_RESERVED_ID_PREFIX = 'app-storage-';
// v2 expands the billable source universe to every user-owned Messenger row
// (including imported AI history and follow edges). Bumping the version keeps
// already-published v1 ledgers fail-closed until the idempotent storage
// backfill has stamped/recounted posts, Messenger content, and attachments.
export const USER_STORAGE_ACCOUNTING_VERSION = 2;
// Root proof for the server-only user subscription/account-storage ledger.
// Generic Thing input never copies this marker; exact identity checks also
// reject extra root/crystal payload before any counter is rendered or mutated.
export const USER_STORAGE_LEDGER_ENVELOPE_VERSION = 1;
export const SANDBOX_STORAGE_BYTES = 5 * 1024 * 1024;
// Live app sessions one user can hold for one app: re-approvals mint fresh
// sessions, so without a cap a re-running embed accumulates grants without
// bound. Newest N survive — multi-device keeps working up to the cap.
export const MAX_APP_SESSIONS_PER_APP_USER = 10;

// Messenger (see api/utils/messenger): chats, messages, communities, custom
// emojis, follows. All bounds here so no write path can disagree about them.
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_CHAT_NAME_CHARS = 80;
export const MAX_CHAT_TOPIC_CHARS = 250;
export const MAX_NICKNAME_CHARS = 40;
// Direct adds per call and total members per group/channel. Communities are
// the scale surface; a single chat stays a bounded fan-out for reads.
export const MAX_CHAT_MEMBERS = 500;
export const MAX_CHAT_MEMBERS_PER_ADD = 50;
export const MAX_COMMUNITY_NAME_CHARS = 80;
export const MAX_COMMUNITY_DESCRIPTION_CHARS = 500;
export const MAX_SECTION_NAME_CHARS = 60;
export const MAX_CHATS_PER_COMMUNITY = 500;
export const MAX_COMMUNITIES_PER_USER = 50;
// Custom emoji: the image is an inline data URI stored on its own thing doc
// (the avatar pattern, FUNDAMENTALS §3 relational rule) — ~512KB binary ≈
// 700K base64 chars. Names are the `:name:` vocabulary, Mongo-key-safe.
export const MAX_EMOJI_NAME_CHARS = 32;
export const MAX_EMOJI_DATA_URI_CHARS = 700 * 1024;
export const MAX_EMOJIS_PER_SCOPE = 200;
export const EMOJI_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
export const EMOJI_DATA_URI_PATTERN = /^data:image\/(gif|webp|png|apng|jpeg);base64,[A-Za-z0-9+/=]+$/;

// Extended (the schema-free sidecar every thing carries) — see sanitizeExtended
// below for the full story. Nesting has no validator rail — the only depth
// bound is the database's own (MAX_STORABLE_NESTING below).
export const EXTENDED_MAX_BYTES = 512 * 1024;
// The wildcard text index's language_override field name. Data-crystal keys
// can never collide with it (their grammar bans ':'), but extended accepts any
// key — except this one, which would hijack or break the text index.
export const EXTENDED_RESERVED_KEY = 'tt:textLanguage';

// The schema version each collection's docs are written at today. Docs with no
// schemaVersion field predate versioning and count as version 1 everywhere.
//
// This map is also the canonical registry of EVERY Thingtime collection: the
// value doubles as the version suffix of the physical MongoDB collection the
// code reads and writes — logical `things` at version 2 lives in the physical
// collection `things_v2` (see api/utils/mongodb/collectionNames.ts). Bumping a
// value here points the code at the NEXT physical generation; a registered
// migration copies data forward, and stale generations are dropped via the
// drop-stale-collection-generations migration once verified.
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
  email_messages: 2,
  // still at 1: docs carry no schemaVersion stamp yet (v1 is the pre-stamp
  // era), so their physical collections are <name>_v1 until a real shape
  // migration bumps them
  rosters: 1,
  settings: 1,
  rateLimits: 1,
  // post view telemetry: one doc per (postId, viewerKey) — see api/utils/things/views.ts
  postViews: 1,
  email_events: 1,
  email_templates: 1,
  email_subscriptions: 1,
  email_suppression_list: 1,
  email_unsubscribes: 1,
  email_identities: 1
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
    { name: 'shareId', type: 'id', required: true, system: true, description: 'Public id — the only id clients ever see.' },
    {
      name: 'schemaVersion',
      type: 'number',
      required: true,
      system: true,
      description: 'Root schema version this doc was written at (docs without one are version 1).'
    },
    {
      name: 'thingtime',
      type: 'string[]',
      required: true,
      description:
        'Thingtime Schema ids applied to this thing, e.g. ["post"] or ["post","share"]. Omitting it on create defaults to ["data"] — the schema-less crystal.'
    },
    { name: 'crystal', type: 'object', required: true, description: 'The sub-schema payload, validated against every schema in thingtime.' },
    { name: 'geo', type: 'object', required: false, description: 'Optional explicitly supplied geographic location, visible to everyone allowed to read this Thing. null clears it. Stored as a GeoJSON Point with derived coordinates for radius queries.', children: [
      { name: 'lat', type: 'number', required: true, min: -90, max: 90, description: 'Latitude in degrees.' },
      { name: 'lng', type: 'number', required: true, min: -180, max: 180, description: 'Longitude in degrees.' }
    ] },
    {
      name: 'extended',
      type: 'record',
      required: false,
      description: `Schema-free sidecar: any JSON up to ${EXTENDED_MAX_BYTES} bytes, stored untouched, never validated, structured-searchable, or interpreted. Replace-on-write; null clears it.`
    },
    { name: 'ownerId', type: 'id', required: true, system: true, description: 'The owning user id.' },
		{
			name: 'sourceDeviceId',
			type: 'id',
			required: false,
			system: true,
			description: 'Paired device that created this Thing. Server-stamped and never accepted from generic Thing input.'
		},
    {
      name: 'acl',
      type: 'string[]',
      required: true,
      max: 16,
      description:
        'Permission entries: tt:all, tt:user (owner), tt:userFriends, tt:userFamily, tt:user/<username>, each optionally "-" prefixed to exclude; tt:inherit on target-attached things. Most specific matching entry decides; owners always view.'
    },
    {
      name: 'targetId',
      type: 'id',
      required: false,
      description: 'shareId of the thing this thing is about (comment → post, reaction → post, share → root post).'
    },
    { name: 'tags', type: 'string[]', required: true, max: 12, description: 'Lowercased tags, max 12 × 40 chars.' },
		{
			name: 'sizeBytes',
			type: 'number',
			required: false,
			system: true,
			description:
				'Exact logical bytes billed to the owner: UTF-8 JSON crystal/extended/tags bytes plus verified objectSizeBytes for protected attachment Things; absent on platform control-plane Things.'
		},
		{
			name: 'storageClass',
			type: 'string',
			required: false,
			system: true,
			description:
				'Server-owned allocation class: content contributes sizeBytes to its owner account ledger; control identifies protected platform bookkeeping and never trusts user-authored crystal metadata.'
		},
		{
			name: 'storageAccountingVersion',
			type: 'number',
			required: false,
			system: true,
			description: 'Version of the logical byte projection used for sizeBytes.'
		},
		{
			name: 'attachmentEnvelopeVersion',
			type: 'number',
			required: false,
			system: true,
			description: `Server-only proof for attachment object accounting (currently ${ATTACHMENT_ENVELOPE_VERSION}); never accepted from generic Thing input.`
		},
		{
			name: 'attachmentState',
			type: 'enum',
			required: false,
			values: [...ATTACHMENT_STATES],
			system: true,
			description:
				'Private upload lifecycle state. Pending, finalizing, ready, and deleting objects remain billable until cleanup. Cancelled receipts retain only their small JSON allocation and permanently fence delayed upload starts.'
		},
		{
			name: 'objectSizeBytes',
			type: 'number',
			required: false,
			min: 0,
			system: true,
			description: 'Verified S3 object bytes added to a protected attachment Thing’s ordinary JSON allocation.'
		},
		{
			name: 'objectKey',
			type: 'string',
			required: false,
			system: true,
			description: 'Private server-generated S3 object key; never copied from generic Thing input or projected publicly.'
		},
		{
			name: 'objectVersionId',
			type: 'string',
			required: false,
			system: true,
			description: 'Private immutable S3 version id used for exact reads and permanent deletion before quota is refunded.'
		},
		{
			name: 'attachmentCancellationRequested',
			type: 'boolean', required: false, system: true,
			description: 'Server-only durable cancellation intent on deleting uploads and their zero-object cancelled receipts. Never accepted from generic input.'
		},
		{
			name: 'attachmentRequestFingerprint',
			type: 'string',
			required: false,
			system: true,
			description: 'Private server-derived fingerprint that makes upload-start retries idempotent without exposing request metadata.'
		},
		{
			name: 'attachmentFileSyncOrigin',
			type: 'object',
			required: false,
			system: true,
			description: 'Private immutable client-reported sync source/destination identity stored before bytes; owner-session detail only, never a native grant or current location.'
		},
		{
			name: 'attachmentPurpose',
			type: 'enum',
			required: false,
			values: [...ATTACHMENT_PURPOSES],
			system: true,
			description: 'Server-owned immutable binding domain: post, comment, message, profile, or custom-emoji media, or a standalone owner-private recording that never binds to a target.'
		},
		{
			name: 'passwordFileEnvelope',
			type: 'object',
			required: false,
			system: true,
			description: 'Private account-vault envelope containing encrypted password file metadata and its content key; only the full-session password service may open it.'
		},
		{
			name: 'passwordFileParent',
			type: 'string',
			required: false,
			system: true,
			description: 'Immutable owner-local password entry id used to fence attachment retries and parent deletion before final binding.'
		},
		{
			name: 'attachmentProfileSlot',
			type: 'enum',
			required: false,
			values: [...ATTACHMENT_PROFILE_SLOTS],
			system: true,
			description: 'Server-owned avatar/banner slot, present exactly when attachmentPurpose is profile.'
		},
		{
			name: 'moderation',
			type: 'object',
			required: false,
			system: true,
			description:
				'Protected server-owned moderation state. Generic Thing create/update input never writes it; only moderation analysis and admin review may stamp it.'
		},
		{
			name: 'subspaceMod',
			type: 'object',
			required: false,
			system: true,
			description:
				'Protected subspace moderation state on posts: { status: approved|removed, removedById, removedAt, reason, reasonId?, ruleIndex?, pinned, locked, nsfw, spoiler }. Written only by subspace moderators through POST /api/v1/subspaces/moderate (a remove on an already-removed post changes nothing); removed posts are redacted for everyone but the author and mods and hidden from feeds. The projection shows the author the reason, never removedById.'
		},
		{
			name: 'subspacePrivate',
			type: 'boolean',
			required: false,
			system: true,
			description: 'Server-stamped when a post is published into a private subspace: visible to that subspace’s members (and the author) only, on every read surface.'
		},
		{
			name: 'attachmentFinalizationLeaseId',
			type: 'string',
			required: false,
			system: true,
			description: 'Private server-generated fencing token for the one request allowed to finalize a multipart upload.'
		},
		{
			name: 'attachmentPartsIssuedAt',
			type: 'date',
			required: false,
			system: true,
			description: 'Private proof that a presigned UploadPart URL left the server; only these MPUs require lifecycle-backed settlement before refund.'
		},
		{
			name: 'attachmentObjectlessDelete',
			type: 'boolean',
			required: false,
			system: true,
			description: 'Private deletion proof for a reserved upload that never received a multipart upload id or object version.'
		},
		{
			name: 'attachmentMpuEmptyVerifiedAt',
			type: 'date',
			required: false,
			system: true,
			description: 'Private timestamp of the first empty multipart verification; a later cron pass must independently confirm it before refund.'
		},
		{
			name: 'uploadId',
			type: 'string',
			required: false,
			system: true,
			description: 'Private multipart-upload id while an attachment is pending or finalizing.'
		},
		{
			name: 'attachmentExpiresAt',
			type: 'date',
			required: false,
			system: true,
			description: 'Private cleanup deadline for an unfinished upload; cleanup must refund transactionally rather than using Mongo TTL.'
		},
		{
			name: 'expiresAt',
			type: 'date',
			required: false,
			system: true,
			description: 'Optional server-owned retention deadline for protected operational Things.'
		},
		{
			name: 'avatarAttachmentId',
			type: 'id',
			required: false,
			system: true,
			description: 'Protected current managed-avatar attachment reference on a canonical user Thing.'
		},
		{
			name: 'bannerAttachmentId',
			type: 'id',
			required: false,
			system: true,
			description: 'Protected current managed-banner attachment reference on a canonical user or subspace Thing.'
		},
		{
			name: 'iconAttachmentId',
			type: 'id',
			required: false,
			system: true,
			description: 'Protected current managed-icon attachment reference on a subspace Thing.'
		},
		{
			name: 'subspaceMediaDeleting',
			type: 'boolean',
			required: false,
			system: true,
			description: 'Server-owned subspace deletion fence preventing new media bindings during cleanup.'
		},
		{
			name: 'emojiAttachmentId',
			type: 'id',
			required: false,
			system: true,
			description: 'Protected exact S3 attachment reference on a custom-emoji Thing.'
		},
    { name: 'createdAt', type: 'date', required: true, system: true, description: 'Creation time.' },
    { name: 'updatedAt', type: 'date', required: true, system: true, description: 'Last mutation time.' }
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
  render: {
    tag: 'article',
    props: { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    children: [
      { tag: 'h3', children: '{title}' },
      { tag: 'img', props: { src: '{images.0}', alt: '{title}', style: { maxWidth: '100%', maxHeight: '360px', objectFit: 'contain' } } },
      { tag: 'p', props: { style: { whiteSpace: 'pre-wrap' } }, children: '{text}' }
    ]
  },
  detail:
    'The thing shows up in feeds and profile listings. Marketplace posts carry a listing; the ' +
    'listing category is folded into the root tags so feed filters can find it. Thingtime posts ' +
    'carry a free-form structured thing under the reserved `thing` key — the same bounded JSON ' +
    'grammar as data crystals, but namespaced so the open shape can never ride past the post ' +
    'whitelist (searchable as crystal.thing.<field> on /search).',
  fields: [
    { name: 'type', type: 'enum', required: true, values: [...POST_TYPES], description: 'What kind of post this is.' },
    {
      name: 'text',
      type: 'string',
      required: false,
      max: MAX_TEXT_CHARS,
      description: `Canonical plain-text post body (required for text posts), max ${MAX_TEXT_CHARS} chars.`
    },
    {
      name: 'richText',
      type: 'record',
      required: false,
      description: 'Bounded native Editor.js document preserving inline marks, block styles, whitespace, and line breaks.'
    },
    {
      name: 'images',
      type: 'string[]',
      required: false,
      max: MAX_IMAGES,
      description: `http(s) image URLs, max ${MAX_IMAGES} × ${MAX_IMAGE_URL_CHARS} chars (image posts need at least one).`
    },
    {
      name: 'listing',
      type: 'object',
      required: false,
      description: 'Marketplace listing — required for marketplace posts, optional on thingtime posts.',
      // mirrors the exact shape sanitizePostCrystal accepts, so the seeded
      // builtin mirror carries the real grammar instead of an opaque object
      children: [
        { name: 'title', type: 'string', required: true, max: 120, description: 'Listing title, max 120 chars.' },
        { name: 'price', type: 'number', required: true, min: 0, max: 1_000_000_000, description: 'Non-negative price, rounded to cents.' },
        { name: 'currency', type: 'string', required: false, max: 3, description: '3-letter currency code, defaults to AUD.' },
        {
          name: 'category',
          type: 'enum',
          required: false,
          values: [...MARKETPLACE_CATEGORIES],
          description: 'Marketplace category, defaults to other.'
        },
        { name: 'condition', type: 'enum', required: false, values: ['new', 'used'], description: 'Item condition.' },
        { name: 'location', type: 'string', required: false, max: 120, description: 'Free-text location, max 120 chars.' },
        { name: 'sold', type: 'boolean', required: false, description: 'Whether the listing has sold.' }
      ]
    },
    {
      name: 'thing',
      type: 'record',
      required: false,
      description:
        'Free-form structured thing payload — required for thingtime posts, bounded like data crystals (searchable as crystal.thing.<field>). Thingtime posts can also carry images and a listing.'
    },
    {
      name: 'title',
      type: 'string',
      required: false,
      max: MAX_POST_TITLE_CHARS,
      description: `Optional headline (Reddit-style post title), max ${MAX_POST_TITLE_CHARS} chars. Subspace posts usually carry one; ordinary feed posts may too.`
    },
    {
      name: 'subspaceId',
      type: 'id',
      required: false,
      description:
        'shareId of the subspace this post is published into. Validated on every write: the author must be allowed to post there (not banned; approved in restricted subspaces; a member in private ones).'
    },
    {
      name: 'flairId',
      type: 'string',
      required: false,
      max: MAX_SUBSPACE_FLAIR_ID_CHARS,
      description: 'Id of one of the subspace’s post flairs (validated against the subspace; mod-only flairs need a moderator).'
    }
  ],
  example: {
    type: 'text',
    text: 'Everything is a thing ✨',
    richText: { kind: 'rich-text', blocks: [{ type: 'paragraph', data: { text: '<mark>Everything</mark> is a thing ✨' } }] },
    images: [],
    listing: null,
    thing: null
  }
};

const fileSchema: ThingtimeSchema = {
  id: 'file', version: 1, kind: 'crystal', collection: null, title: 'File',
  summary: 'A stable file identity with retained attachment versions and Timeline history.',
  detail: 'The dedicated file writer changes the current content atomically using an expected revision and immutable operation identity. Bytes remain separately accounted attachment Things linked by parentId/targetId. Trash retains content until an explicit retention workflow removes it.',
  createdVia: 'POST /api/v1/files',
  example: { name: 'notes.txt', trashed: false, content: { attachmentId: 'att-example', version: 'a'.repeat(64), size: 1, fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: 'b'.repeat(64) } } },
  fields: [
    { name: 'name', type: 'string', required: true, max: 255, description: 'Editable filename.' },
    { name: 'trashed', type: 'boolean', required: true, description: 'Recoverable trash state; retained bytes remain accounted.' },
    { name: 'content', type: 'object', required: true, description: 'Verified attachment identity, opaque content version, byte size and multipart fingerprint.' }
  ]
};

const attachmentSchema: ThingtimeSchema = {
	id: ATTACHMENT_THINGTIME,
	version: 2,
	kind: 'crystal',
	collection: null,
	title: 'Attachment',
	summary: 'A private-S3 file attached relationally to a post.',
	detail:
		'Attachment Things are created only through the dedicated upload endpoints. Their crystal contains ' +
		'stable, safe public metadata; object keys, multipart ids, lifecycle state, and verified object bytes ' +
		'are server-owned root fields. A ready post attachment points at its post through targetId and inherits that ' +
		'post’s audience; managed profile media points at the exact public user and avatar/banner slot that references it. ' +
		'Pending/finalizing/deleting rows remain billable source records until cleanup confirms ' +
		'the object is inaccessible, preventing quota oversubscription and refund races.',
	createdVia: 'POST /api/v1/attachments/uploads',
	fields: [
		{
			name: 'name',
			type: 'string',
			required: true,
			max: MAX_ATTACHMENT_NAME_CHARS,
			description: 'Immutable original filename; never used as an S3 key.'
		},
		{
			name: 'filenamePreview',
			type: 'string',
			required: false,
			max: MAX_ATTACHMENT_NAME_CHARS,
			description: 'Owner-selected filename shown in the UI; the original download filename is preserved.'
		},
		{ name: 'title', type: 'string', required: false, max: 200, description: 'Owner-authored media title.' },
		{ name: 'description', type: 'string', required: false, max: 2000, description: 'Owner-authored media description.' },
		{
			name: 'size',
			type: 'number',
			required: true,
			min: 0,
			description: 'Verified object size in bytes; must equal the server-owned root objectSizeBytes.'
		},
		{
			name: 'contentType',
			type: 'string',
			required: true,
			max: MAX_ATTACHMENT_CONTENT_TYPE_CHARS,
			description: 'Normalized MIME type, defaulting to application/octet-stream.'
		},
		{
			name: 'mediaKind',
			type: 'enum',
			required: true,
			values: [...ATTACHMENT_MEDIA_KINDS],
			description: 'Server-derived safe rendering class. SVG, HTML, and unknown types are files, never inline media.'
		},
		{
			name: 'detectedContentType',
			type: 'string',
			required: false,
			max: MAX_ATTACHMENT_CONTENT_TYPE_CHARS,
			description:
				'Magic-byte-sniffed MIME type, preserved only when the served contentType stays application/octet-stream so downloads can still name the real container (for example video/x-msvideo for an AVI). Server-written at upload finalization; never client input.'
		}
	],
	example: { name: 'sunset.webp', size: 482013, contentType: 'image/webp', mediaKind: 'image' }
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
    'is visible exactly when the target is. Comments share the post schema: a rich comment is a ' +
    '["post","comment"] thing carrying the full post vocabulary (photos, listing, thingtime ' +
    'thing), the post crystal rules apply, and comments are reactable and commentable like any ' +
    'post — each has its own /post/:id page. Comments used to live embedded inside post docs — ' +
    'the things v1→v2 migration explodes them into these.',
  requiresTarget: true,
  fields: [{ name: 'text', type: 'string', required: true, max: MAX_COMMENT_CHARS, description: `Comment body, max ${MAX_COMMENT_CHARS} chars.` }],
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
      // emoji count, NOT UTF-16 chars (every emoji is 2+ code units) — keeps
      // the projection from publishing a maxLength that rejects legal tokens
      maxUnit: 'emoji',
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
  appliedThingtime: ['post', 'share'],
  fields: [],
  example: {}
};

// Free-form structured data (thingtime ["data"]): the crystal is ANY bounded
// JSON shape — this is the "everything is a thing" promise made writable, and
// what /search's real-datatype queries search over. Keys follow the same
// segment grammar the search API accepts (no $, no dots inside a key), values
// are size/count-bounded, and when combined with a typed schema (e.g.
// thingtime ["post","data"]) the typed sanitizer's fields always win.
// Depth is unbounded by the validator: the walk is iterative (explicit work
// stack, so nesting never touches the JS call stack) and circular or repeated
// object references are rejected by identity (WeakSet) — "any nesting as long
// as it's not circular" holds for real. The one depth-shaped bound left is
// the database's, not ours: MongoDB physically caps BSON nesting at 100
// levels per document, so contents deeper than MAX_STORABLE_NESTING can never
// be stored — the validator reports that as a precise 400 instead of letting
// the driver blow up mid-write. The true DoS guards are the request body byte
// cap and the node count.
// Probed live against mongod 8.0.1 through the real create API: a crystal
// whose contents nest 179 levels (crystal root = level 1) inserts; 180 is
// refused by the server with "BSONObj exceeds maximum nested object depth"
// (mongod's 180-level user-write depth limit, minus the one thing-envelope
// level the crystal/extended field sits at). This is the database's physical
// ceiling, not a validator choice — if mongod ever raises its limit, re-probe
// and lift this number to match.
export const MAX_STORABLE_NESTING = 179;
export const MAX_DATA_CRYSTAL_NODES = 10000;
export const MAX_DATA_ARRAY_ITEMS = 1000;
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
    `are letters/numbers/_/- (max ${MAX_DATA_KEY_CHARS} chars), nesting is unbounded up to ` +
    `MongoDB's own ${MAX_STORABLE_NESTING}-level storage limit (circular references rejected), ` +
    `${MAX_DATA_CRYSTAL_NODES} values per crystal, arrays at ` +
    `${MAX_DATA_ARRAY_ITEMS} items. Strings are preserved without a character cap; storage capacity still applies.`,
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
// Accommodates the complete root Thing shape plus user extensions while
// keeping schema trees bounded (nested children/items count toward this cap).
export const MAX_SCHEMA_FIELDS = 80;
export const MAX_SCHEMA_ENUM_VALUES = 30;
export const MAX_SCHEMA_ENUM_VALUE_CHARS = 60;
export const MAX_SCHEMA_UNIT_CHARS = 20;
// Matches the search grammar's MAX_FIELD_DEPTH and sits far inside data
// crystals' storable nesting (MAX_STORABLE_NESTING) — a schema can never
// describe a shape deeper than what can be stored or searched.
export const MAX_SCHEMA_FIELD_DEPTH = 6;
// `render`: the optional serialised component tree a schema can carry (chakra
// or element shaped) — caps match the client renderers' node/depth gates.
// A stored render TEMPLATE counts every value (each style key is a node), so
// an app screen with a few dozen styled elements runs to ~1500 nodes while
// still drawing well under the renderers' 600-element DOM budget (branches
// and repeats resolve to one path at draw time). 2000 / 48KB is the stored
// bound; the resolver's MAX_RESOLVED_VALUES and the renderers' MAX_NODES
// stay the draw-time bounds.
export const MAX_SCHEMA_RENDER_BYTES = 48 * 1024;
// stored depth counts wrapper objects (a ttIf → then → ttEach → node chain is
// four levels for one drawn element), so it sits well above the renderers'
// 24-level DOM cap, which the RESOLVED tree still has to clear
export const MAX_SCHEMA_RENDER_DEPTH = 48;
export const MAX_SCHEMA_RENDER_NODES = 2000;
export const SCHEMA_FIELD_TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'string[]', 'object', 'array', 'json'] as const;
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
  version: 3,
  kind: 'crystal',
  collection: null,
  title: 'Schema',
  summary: 'A user-authored data shape — browse them on /schemas, search with them on /search.',
  detail:
    'Anyone can publish a schema thing describing a shape (e.g. "Table": legs, material ' +
    'wood/plastic/concrete, width/height/depth). Fields nest arbitrarily (object children, typed ' +
    'array items) with per-field constraints: required, number min/max, string maxLength, enum ' +
    'value lists, array min/maxItems. Things that follow a schema simply carry its fields in ' +
    "their crystal — a schema never gates OTHER things' writes (Thingtime searches real " +
    'datatypes, not schema registrations), but schema things themselves are validated on write ' +
    'like any crystal, builtin seeds included. /schemas browses every published ' +
    'schema; /search prefills its query builder from the field definitions.',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Table".' },
    { name: 'description', type: 'string', required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: 'What this shape describes.' },
    {
      // 'record', not 'object': the field-definition tree is recursive (children
      // of children), which the closed schema-thing grammar can't express — an
      // open-but-bounded structure is the honest classification
      name: 'fields',
      type: 'record',
      required: true,
      max: MAX_SCHEMA_FIELDS,
      description:
        `Field definition tree, max ${MAX_SCHEMA_FIELDS} nodes, ${MAX_SCHEMA_FIELD_DEPTH} levels: ` +
        `{ name, type (${SCHEMA_FIELD_TYPES.join('/')}), description?, required?, values? (enum), ` +
        'min?/max?/unit? (number), maxLength? (string), minItems?/maxItems? (arrays), ' +
        'children? (object), items? (array) }.'
    },
    { name: 'forkOf', type: 'string', required: false, description: 'shareId of the schema this one was forked from (provenance only).' },
    {
      name: 'render',
      type: 'record',
      required: false,
      description: `Optional serialised component preview — a chakra tree ({ chakra: "Box", props, children }) or element tree ({ tag: "div", props, children }), max ${MAX_SCHEMA_RENDER_BYTES} bytes / ${MAX_SCHEMA_RENDER_NODES} nodes, always drawn through the sanitising allowlist renderers.`
    }
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

// UI components are things too (thingtime ["component"]). A component carries
// a serialised render TEMPLATE (the element/chakra tree the sanitising
// renderers draw) plus a bounded arg-descriptor list; the /components page
// resolves template tokens ({label}, ttArg/ttMap/ttIf/ttMerge/ttRepeat
// wrappers) against tester args before rendering. Saved versions snapshot the
// chosen args in savedArgs. System-seeded library components (shareId
// component-<slug>) mirror the components-db folder database.
export const COMPONENT_LIBRARIES = [
	'antd',
	'bootstrap',
	'mui',
	'shadcn',
	'untitled',
	'daisyui',
	'reactflow',
	'thingtime',
	'custom'
] as const;
export const MAX_COMPONENT_ARGS = 16;
export const MAX_COMPONENT_ARG_NAME_CHARS = 40;
export const MAX_COMPONENT_ARG_LABEL_CHARS = 40;
export const MAX_COMPONENT_ARG_DESCRIPTION_CHARS = 200;
export const MAX_COMPONENT_ARG_DEFAULT_CHARS = 400;
export const MAX_COMPONENT_SAVED_ARGS = 24;
export const MAX_COMPONENT_SAVED_ARG_CHARS = 2000;
export const MAX_COMPONENT_CATEGORY_CHARS = 40;
export const MAX_COMPONENT_KEY_CHARS = 80;
export const MAX_COMPONENT_PREVIEW_BG_CHARS = 200;
export const COMPONENT_ARG_TYPES = ['string', 'text', 'number', 'boolean', 'enum', 'color'] as const;
export const COMPONENT_ARG_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const COMPONENT_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const componentSchema: ThingtimeSchema = {
	id: 'component',
	version: 1,
	kind: 'crystal',
	collection: null,
	title: 'Component',
	summary: 'A UI component — browse and tweak them live on /components, save versions to your Things.',
	detail:
		'A component thing is a renderable UI building block: a serialised element/chakra render ' +
		'template (drawn only through the sanitising allowlist renderers) plus a bounded list of ' +
		'arg descriptors the /components tester turns into live inputs. Template strings may ' +
		'interpolate {argName} tokens, and ttArg/ttMap/ttIf/ttMerge/ttRepeat wrapper objects ' +
		'resolve against the current args before rendering. The platform library (1000+ components ' +
		'styled after Ant Design, Bootstrap, MUI, shadcn/ui, Untitled UI, daisyUI, React Flow, and ' +
		'the Thingtime house style) is seeded system-owned with shareId component-<slug>; ' +
		'"Save version" stores a user-owned component thing whose savedArgs snapshot the tester ' +
		'state, linked back via componentKey/forkOf.',
	fields: [
		{ name: 'name', type: 'string', required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Solid Button".' },
		{ name: 'description', type: 'string', required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: 'What this component is and when to use it.' },
		{
			name: 'library',
			type: 'enum',
			required: false,
			values: [...COMPONENT_LIBRARIES],
			description: 'The design language this component follows; user-authored components default to custom.'
		},
		{ name: 'category', type: 'string', required: false, max: MAX_COMPONENT_CATEGORY_CHARS, description: 'Catalog category, e.g. buttons, forms, feedback, navigation, flow.' },
		{ name: 'componentKey', type: 'string', required: false, max: MAX_COMPONENT_KEY_CHARS, description: 'Stable slug identity linking saved versions to their source component.' },
		{ name: 'familyKey', type: 'string', required: false, max: MAX_COMPONENT_KEY_CHARS, description: 'Groups the library renditions (designs) of one functional component — /components shows one card per family.' },
		{ name: 'version', type: 'number', required: false, min: 1, description: 'Version counter for saved instances of a componentKey.' },
		{ name: 'forkOf', type: 'string', required: false, description: 'shareId of the component this one was saved/forked from (provenance only).' },
		{ name: 'previewBg', type: 'string', required: false, max: MAX_COMPONENT_PREVIEW_BG_CHARS, description: 'Optional CSS background for the preview surface (e.g. a dotted canvas).' },
		{
			// recursive/open-but-bounded structures — same honest 'record'
			// classification the schema thing uses for its field tree
			name: 'args',
			type: 'record',
			required: false,
			max: MAX_COMPONENT_ARGS,
			description:
				`Arg descriptor list, max ${MAX_COMPONENT_ARGS}: { name, type (${COMPONENT_ARG_TYPES.join('/')}), ` +
				'label?, description?, default, values? (enum), min?/max? (number), maxLength? (string) }. ' +
				'The /components tester renders one input per descriptor.'
		},
		{
			name: 'savedArgs',
			type: 'record',
			required: false,
			max: MAX_COMPONENT_SAVED_ARGS,
			description: 'Scalar arg-value snapshot a saved version renders with (keys mirror arg names).'
		},
		{
			name: 'render',
			type: 'record',
			required: true,
			description:
				`Serialised render template — element ({ tag: "div", props, children }) or chakra shaped, max ` +
				`${MAX_SCHEMA_RENDER_BYTES} bytes / ${MAX_SCHEMA_RENDER_NODES} nodes, drawn only through the sanitising ` +
				'allowlist renderers after arg-template resolution.'
		}
	],
	example: {
		name: 'Solid Button',
		description: 'Filled primary action button in the Thingtime house style.',
		library: 'thingtime',
		category: 'buttons',
		componentKey: 'thingtime-button-solid',
		version: 1,
		args: [
			{ name: 'label', type: 'string', label: 'Label', default: 'Get started', maxLength: 40 },
			{ name: 'tone', type: 'enum', label: 'Tone', values: ['primary', 'success', 'danger'], default: 'primary' },
			{ name: 'disabled', type: 'boolean', label: 'Disabled', default: false }
		],
		render: {
			tag: 'button',
			props: { type: 'button', style: { padding: '0 16px', height: '36px', borderRadius: '9px', background: '#16161a', color: '#ffffff' } },
			children: ['{label}']
		}
	}
};

// Actions are things too (thingtime ["action"]). An action is a small
// DECLARATIVE program over a closed, registered operation vocabulary — there
// is no persisted JavaScript and no `while` primitive because the vocabulary
// deliberately does not define one. Every action declares typed inputs,
// explicit capabilities (which the executor treats as a narrowing filter on
// top of normal ACL — an action can never do something its invoker couldn't),
// and a limits envelope. Executions share one budget across child
// `actions.invoke` calls, and every run lands as a protected `action-run`
// child thing (targetId = the action) so the program's behaviour stays
// inspectable after the fact.
export const ACTION_STEP_OPS = ['things.create', 'things.get', 'things.search', 'things.update', 'actions.invoke', 'return'] as const;
export const ACTION_CAPABILITIES = ['things.read', 'things.create', 'things.update', 'actions.invoke'] as const;
export const ACTION_INPUT_TYPES = ['string', 'text', 'number', 'boolean', 'enum'] as const;
export const MAX_ACTION_STEPS = 20;
export const MAX_ACTION_INPUTS = 16;
export const MAX_ACTION_CAPABILITY_ENTRIES = 8;
export const MAX_ACTION_CAPABILITY_SCOPES = 12;
export const MAX_ACTION_KEY_CHARS = 80;
export const MAX_ACTION_SCHEMA_REF_CHARS = 128;
export const MAX_ACTION_STEP_VALUE_KEYS = 24;
export const MAX_ACTION_STEP_STRING_CHARS = 2000;
export const MAX_ACTION_STEP_VALUE_DEPTH = 5;
export const MAX_ACTION_CONCAT_PARTS = 12;
export const MAX_ACTION_SEARCH_LIMIT = 50;
export const MAX_ACTION_TRACE_ENTRIES = 60;
export const MAX_ACTION_RUN_ERROR_CHARS = 2000;
export const ACTION_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Server-enforced ceilings for the per-invocation envelope. Authors may lower
// every knob; these are the hard caps the executor clamps against.
export const ACTION_LIMIT_CEILINGS = {
	timeoutMs: 10_000,
	maxOperations: 50,
	maxDepth: 8,
	maxChildActions: 20,
	maxResultBytes: 256 * 1024,
	maxInputBytes: 64 * 1024
} as const;
export const ACTION_LIMIT_DEFAULTS = {
	timeoutMs: 5_000,
	maxOperations: 25,
	maxDepth: 4,
	maxChildActions: 10,
	maxResultBytes: 64 * 1024,
	maxInputBytes: 16 * 1024
} as const;

const actionSchema: ThingtimeSchema = {
	id: 'action',
	version: 1,
	kind: 'crystal',
	collection: null,
	title: 'Action',
	summary: 'A declarative, capability-bounded program — inspect and run it on /actions.',
	detail:
		'An action thing is a small declarative program over a closed operation vocabulary ' +
		`(${ACTION_STEP_OPS.join(', ')}) — no persisted code, no loops unless the vocabulary ` +
		'ever defines one. It declares typed inputs, explicit capabilities (a NARROWING filter: ' +
		'every operation still runs through the normal things API as the invoking user, so ACL, ' +
		'quotas and schema validation always apply and an action can never do something its ' +
		'invoker could not), and a limits envelope (timeout, operation budget, depth, result ' +
		'bytes). Step values reference data with whole-value refs ("$input.name", "$step.1.id", ' +
		'"$now") or { ttConcat: [...] } string composition — reference substitution, never ' +
		'evaluation. Child actions started via actions.invoke consume the PARENT invocation\'s ' +
		'budget, so recursive chains terminate by construction. Every run is recorded as a ' +
		'protected action-run child thing for inspection. In v1 the vocabulary has no network, ' +
		'no secrets, and no delete — external integrations arrive later as Connection-owned ' +
		'capabilities.',
	fields: [
		{ name: 'name', type: 'string', required: true, max: MAX_SCHEMA_NAME_CHARS, description: 'Display name, e.g. "Create customer".' },
		{ name: 'description', type: 'string', required: false, max: MAX_SCHEMA_DESCRIPTION_CHARS, description: 'What this action does and when to run it.' },
		{ name: 'actionKey', type: 'string', required: false, max: MAX_ACTION_KEY_CHARS, description: 'Stable slug identity (lowercase-dashed) other actions can invoke by key.' },
		{ name: 'category', type: 'string', required: false, max: MAX_COMPONENT_CATEGORY_CHARS, description: 'Catalog category, e.g. customers, invoices, utilities.' },
		{ name: 'version', type: 'number', required: false, min: 1, description: 'Version counter for saved revisions of an actionKey.' },
		{ name: 'forkOf', type: 'string', required: false, description: 'shareId of the action this one was forked from (provenance only).' },
		{
			name: 'inputs',
			type: 'record',
			required: false,
			max: MAX_ACTION_INPUTS,
			description:
				`Typed input descriptor list, max ${MAX_ACTION_INPUTS}: { name, type (${ACTION_INPUT_TYPES.join('/')}), ` +
				'label?, description?, required?, default?, values? (enum), min?/max? (number), maxLength? (string) }. ' +
				'The /actions run panel renders one input per descriptor.'
		},
		{
			name: 'steps',
			type: 'record',
			required: true,
			max: MAX_ACTION_STEPS,
			description:
				`Ordered step list, 1–${MAX_ACTION_STEPS}, each { op: ${ACTION_STEP_OPS.join(' | ')}, … }. ` +
				'things.create { schema, values }; things.get { id }; things.search { schema?, limit? }; ' +
				'things.update { id, values }; actions.invoke { action, inputs? }; return { value }. ' +
				'Values are literal JSON, whole-value refs, or ttConcat compositions.'
		},
		{
			name: 'capabilities',
			type: 'record',
			required: false,
			max: MAX_ACTION_CAPABILITY_ENTRIES,
			description:
				`Declared capability list, max ${MAX_ACTION_CAPABILITY_ENTRIES}: { capability (${ACTION_CAPABILITIES.join('/')}), ` +
				'schemas? (scope list), actions? (invoke allowlist) }. Save-time validation requires every step ' +
				'to be covered by a declared capability, so the declaration is always true.'
		},
		{
			name: 'limits',
			type: 'record',
			required: false,
			description:
				'Per-invocation envelope overrides: { timeoutMs, maxOperations, maxDepth, maxChildActions, ' +
				`maxResultBytes, maxInputBytes } — clamped to server ceilings (${ACTION_LIMIT_CEILINGS.timeoutMs}ms / ` +
				`${ACTION_LIMIT_CEILINGS.maxOperations} ops / depth ${ACTION_LIMIT_CEILINGS.maxDepth} / ` +
				`${ACTION_LIMIT_CEILINGS.maxChildActions} child actions / ${ACTION_LIMIT_CEILINGS.maxResultBytes} result bytes).`
		}
	],
	example: {
		name: 'Create customer',
		description: 'Creates a customer data thing from typed inputs.',
		actionKey: 'create-customer',
		category: 'customers',
		version: 1,
		inputs: [
			{ name: 'name', type: 'string', label: 'Name', required: true, maxLength: 120 },
			{ name: 'email', type: 'string', label: 'Email', required: true, maxLength: 200 }
		],
		steps: [
			{ op: 'things.create', schema: 'customer', values: { name: '$input.name', email: '$input.email' } },
			{ op: 'return', value: '$step.1' }
		],
		capabilities: [{ capability: 'things.create', schemas: ['customer'] }],
		limits: { timeoutMs: 5000, maxOperations: 10 }
	}
};

// Every action invocation lands one protected run record — server-minted by
// the executor only (a forged run record would falsify the audit trail), so
// the kind rides PROTECTED_THINGTIME and has no crystal sanitizer on the
// generic write path.
const actionRunSchema: ThingtimeSchema = {
	id: 'action-run',
	version: 1,
	kind: 'crystal',
	collection: null,
	title: 'Action run',
	summary: 'One recorded execution of an action (targetId) — status, budget usage, per-step trace.',
	requiresTarget: true,
	createdVia: 'POST /api/v1/actions/run',
	detail:
		'Written only by the action executor: the invoker owns the record (acl ["tt:user"]), ' +
		'targetId points at the action that ran. Captures status, timing, the budget actually ' +
		'consumed (operations, depth, child actions), a size-capped echo of the inputs and ' +
		'result, and a per-step trace — the inspectable "what actually happened" half of the ' +
		'action contract. Direct create/update/delete through the generic things routes is ' +
		'refused.',
	fields: [
		{ name: 'status', type: 'enum', required: true, values: ['ok', 'error'], description: 'Whether the run completed or failed.' },
		{ name: 'startedAt', type: 'date', required: true, description: 'When the invocation began.' },
		{ name: 'durationMs', type: 'number', required: true, min: 0, description: 'Wall-clock execution time.' },
		{ name: 'opsUsed', type: 'number', required: true, min: 0, description: 'Operations consumed from the shared budget.' },
		{ name: 'depthUsed', type: 'number', required: false, min: 0, description: 'Deepest actions.invoke nesting reached.' },
		{ name: 'childActionsUsed', type: 'number', required: false, min: 0, description: 'Child actions invoked across the whole run.' },
		{ name: 'error', type: 'string', required: false, max: MAX_ACTION_RUN_ERROR_CHARS, description: 'Failure message when status is error.' },
		{ name: 'inputs', type: 'record', required: false, description: 'Size-capped echo of the invocation inputs.' },
		{ name: 'result', type: 'record', required: false, description: 'Size-capped return value of the run.' },
		{ name: 'trace', type: 'record', required: false, max: MAX_ACTION_TRACE_ENTRIES, description: 'Per-step trace: { step, op, ms, target?, note? }.' }
	],
	example: {
		status: 'ok',
		startedAt: '2026-08-24T10:00:00.000Z',
		durationMs: 482,
		opsUsed: 3,
		depthUsed: 1,
		childActionsUsed: 0,
		result: { id: 'abc123' },
		trace: [{ step: 1, op: 'things.create', ms: 41, target: 'abc123' }]
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
  createdVia: 'POST /api/v1/things/save',
  fields: [],
  example: {}
};

// Folders: the Drive-style organization kind behind /things. A folder is an
// ordinary thing (thingtime ["folder"]) whose crystal names it; containment is
// a `folderId` pointer ON THE CHILD (FUNDAMENTALS §3 — never an embedded list
// of childIds on the folder), so a folder holds any number of things without
// its own doc growing. Folders nest by carrying a folderId themselves; the
// move path cycle-checks the ancestor chain. Organization is personal:
// folderId only ever points at a folder the SAME owner holds, and folders
// default private (organization structure is not content).
export const MAX_FOLDER_NAME_CHARS = 120;
export const MAX_FOLDER_ICON_CHARS = 32;
export const MAX_FOLDER_DESCRIPTION_CHARS = 500;

const folderSchema: ThingtimeSchema = {
  id: 'folder',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Folder',
  summary: 'A Drive-style folder for organising your things on /things.',
  detail:
    'Folders organise the /things page: any of your things (posts, data, schemas, other ' +
    'folders) can carry a folderId pointing at one of YOUR folder things — moving is just ' +
    'rewriting that pointer (PATCH /api/v1/things { id, folderId } or POST /api/v1/things/bulk). ' +
    'Folders nest; moves cycle-check the chain. Deleting a folder never deletes its contents — ' +
    'they re-parent to the deleted folder’s parent. Folders default private (acl ["tt:user"]): ' +
    'how you organise your things is yours even when the things themselves are public.',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_FOLDER_NAME_CHARS, description: 'Folder display name.' },
    { name: 'icon', type: 'string', required: false, max: MAX_FOLDER_ICON_CHARS, description: 'Optional emoji shown instead of the default 📁.' },
    { name: 'description', type: 'string', required: false, max: MAX_FOLDER_DESCRIPTION_CHARS, description: 'Optional note about what lives here.' }
  ],
  example: { follow: true }
};

// One friendship per unordered pair: ownerId sent the request, targetId
// received it. status flips pending → accepted; decline/cancel/unfriend
// deletes the doc. crystal.friendKey = '<minId>~<maxId>' makes the pair
// unique regardless of direction (unique partial index).
const friendThingSchema: ThingtimeSchema = {
  id: 'friend',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Friendship',
  summary: 'A friendship (or pending friend request) between two users — one doc per pair.',
  detail:
    'Driven by POST /api/v1/users/friend { userId, intent }. ownerId is the requester, targetId ' +
    'the recipient; crystal.status is pending until the recipient accepts. Accepted friendships ' +
    'power the tt:userFriends acl circle (friends-only posts). Private to the pair (served via ' +
    'the users endpoints); the generic things CRUD refuses this kind.',
  requiresTarget: true,
  createdVia: 'POST /api/v1/users/friend',
  fields: [
    { name: 'status', type: 'enum', required: true, values: ['pending', 'accepted'], description: 'Request state.' },
    { name: 'friendKey', type: 'string', required: true, description: 'Canonical unordered pair key <minId>~<maxId> — unique per pair.' }
  ],
  example: { status: 'accepted', friendKey: '664f1c2a9d3e5b0012345678~664f1c2a9d3e5b0012345679' }
};

// Per-type notification switches users can flip in Settings → Notifications.
// 'groups' is reserved for the future groups feature (the pref persists, no
// emitter exists yet). Reads ALWAYS filter by the recipient's prefs, so a
// fanned-out notification written before a pref flip stays hidden.
export const NOTIFICATION_TYPES = [
  'friend-request',
  'friend-accepted',
  'new-follower',
  'post-from-followed',
  'post-from-friend',
  'comment',
  'reply',
  'reaction',
  'share',
  'groups'
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// Email-channel notification switches. Every bell type can also send an email,
// plus email-only types (weekly-summary) that never mint a bell notification.
export const EMAIL_ONLY_NOTIFICATION_TYPES = ['weekly-summary'] as const;
export const EMAIL_NOTIFICATION_TYPES = [...NOTIFICATION_TYPES, ...EMAIL_ONLY_NOTIFICATION_TYPES] as const;
export type EmailNotificationType = (typeof EMAIL_NOTIFICATION_TYPES)[number];

// High-volume types whose EMAIL channel defaults OFF (the bell stays ON): a
// busy follow graph would otherwise turn every post into an email.
export const EMAIL_DEFAULT_OFF_TYPES: readonly string[] = ['post-from-followed', 'post-from-friend'];

export type NotificationChannelMasters = { push: boolean; email: boolean };
export type NormalizedNotificationPrefs = {
  push: Record<string, boolean>;
  email: Record<string, boolean>;
  masters: NotificationChannelMasters;
};

// Stored shape (meta.notificationPrefs): the flat { [type]: boolean } keys are
// the push/in-app channel — unchanged from the original shape, so prefs saved
// before channels existed keep working with zero migration — plus nested
// email: { [type]: boolean } and masters: { push, email }. Absent = ON,
// except EMAIL_DEFAULT_OFF_TYPES whose email channel is opt-in. Shared by the
// server (write/read gating) and the settings UI (defaults) so both sides
// agree on what absent keys mean. Also accepts an already-normalized matrix
// (nested push object) so the wire shape round-trips: normalize(normalize(x))
// === normalize(x), which lets the client cache the GET response as-is.
export const normalizeNotificationPrefs = (
  stored: Record<string, any> | null | undefined
): NormalizedNotificationPrefs => {
  const source = stored && typeof stored === 'object' ? stored : {};
  const emailStored = source.email && typeof source.email === 'object' ? source.email : {};
  const mastersStored = source.masters && typeof source.masters === 'object' ? source.masters : {};
  const pushStored = source.push && typeof source.push === 'object' ? source.push : source;
  const push: Record<string, boolean> = {};
  for (const type of NOTIFICATION_TYPES) push[type] = pushStored[type] !== false;
  const email: Record<string, boolean> = {};
  for (const type of EMAIL_NOTIFICATION_TYPES) {
    email[type] = EMAIL_DEFAULT_OFF_TYPES.includes(type)
      ? emailStored[type] === true
      : emailStored[type] !== false;
  }
  return {
    push,
    email,
    masters: { push: mastersStored.push !== false, email: mastersStored.email !== false }
  };
};

const notificationThingSchema: ThingtimeSchema = {
  id: 'notification',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Notification',
  summary: 'A server-minted in-app notification for one recipient (ownerId).',
  detail:
    'Minted by the server when someone else follows you, sends/accepts a friend request, ' +
    'comments, replies, reacts, shares, or (fan-out, capped) posts while you follow them. ' +
    'ownerId is the recipient, targetId the subject thing (post/comment/user), root readAt ' +
    'flips when read. Listed via GET /api/v1/notifications (filtered by the recipient\'s ' +
    'meta.notificationPrefs), marked via POST /api/v1/notifications/read. Always acl ' +
    '["tt:user"]; the generic things CRUD refuses this kind.',
  createdVia: 'server-side emission (social/engagement events)',
  fields: [
    { name: 'type', type: 'enum', required: true, values: [...NOTIFICATION_TYPES], description: 'Notification type (drives prefs + copy).' },
    { name: 'actorId', type: 'id', required: true, description: 'The user whose action triggered this.' },
    { name: 'actorName', type: 'string', required: false, description: 'Actor display name snapshot.' },
    { name: 'postId', type: 'id', required: false, description: 'Related post for click-through.' },
    { name: 'preview', type: 'string', required: false, max: 140, description: 'Short content preview.' }
  ],
  example: { type: 'new-follower', actorId: '664f1c2a9d3e5b0012345678', actorName: 'Rick Deckard' }
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
    {
      name: 'purpose',
      type: 'enum',
      required: false,
      values: ['browser', 'service', 'app', 'app-sandbox', 'pat', 'oauth-code'],
      description:
        'Browser cookie session, service Bearer token, app-scoped grant, sandbox grant, personal access token, or one-time desktop OAuth code.'
    },
    {
      name: 'expiresAt',
      type: 'date',
      required: false,
      description:
        'Expiry (null = non-expiring service token). Revoking a non-expiring session stamps a reap date here so the TTL index can clear the dead row; an existing expiry is never overwritten.'
    },
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
    {
      name: 'stream',
      type: 'enum',
      required: true,
      values: ['transactional', 'newsletter'],
      description: 'Send stream — picks the from-address and unsubscribe rules.'
    },
    { name: 'templateKey', type: 'string', required: false, description: 'Dotted template id, e.g. auth.password_reset.' },
    {
      name: 'status',
      type: 'enum',
      required: true,
      values: ['queued', 'sent', 'logged', 'skipped', 'failed'],
      description: 'Delivery lifecycle state.'
    },
    { name: 'from', type: 'string', required: true, description: 'From address used.' },
    { name: 'replyTo', type: 'string', required: false, description: 'Reply-to address (null when unset).' },
    { name: 'to', type: 'string[]', required: true, description: 'Normalized recipient list.' },
    { name: 'subject', type: 'string', required: true, description: 'Subject line.' },
    { name: 'html', type: 'string', required: true, description: 'Rendered HTML body — replaced by a redacted placeholder when sensitive is true.' },
    { name: 'text', type: 'string', required: true, description: 'Rendered text body — replaced by a redacted placeholder when sensitive is true.' },
    {
      name: 'sensitive',
      type: 'boolean',
      required: true,
      description: 'True for secret-bearing mail (OTP codes, reset links); its body is stored redacted so the outbox can’t replay the secret.'
    },
    { name: 'metadata', type: 'record', required: false, description: 'Purpose tags for analytics (never secrets).' },
    { name: 'tags', type: 'record', required: false, description: 'Provider tags ({ stream, template }).' },
    { name: 'providerMessageId', type: 'string', required: false, description: 'SES message id when delivered.' },
    {
      name: 'suppressedRecipients',
      type: 'string[]',
      required: false,
      description: 'Recipients dropped for suppression/unsubscribe (set only when some were skipped).'
    },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Queue time.' },
    {
      name: 'updatedAt',
      type: 'date',
      required: true,
      description: 'Last status change (sentAt/loggedAt/failedAt/skippedAt + error/skippedReason ride alongside per outcome).'
    }
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

const deploymentPeerSchema: ThingtimeSchema = {
  id: 'deployment-peer',
  version: COLLECTION_SCHEMA_VERSIONS.deploymentPeers,
  kind: 'collection',
  collection: 'deploymentPeers',
  title: 'Deployment peer lease',
  summary: 'One bounded, expiring control-plane lease for each trusted Thingtime deployment origin.',
  detail:
    'Peer rows are relational control-plane records, not user Things. They are accepted only from deployments that hold the shared discovery secret, contain no account data, and expire quickly unless the peer announces again.',
  fields: [
    { name: 'origin', type: 'string', required: true, description: 'Canonical HTTPS deployment origin; unique.' },
    { name: 'signingPublicKey', type: 'string', required: true, description: 'Pinned Ed25519 public key for signed peer traffic.' },
    { name: 'firstSeenAt', type: 'date', required: true, description: 'First accepted announcement.' },
    { name: 'lastSeenAt', type: 'date', required: true, description: 'Most recent accepted announcement.' },
    { name: 'expiresAt', type: 'date', required: true, description: 'TTL lease expiry.' },
    { name: 'syncCursor', type: 'string', required: false, description: 'Private bounded traversal cursor for the next remote peer page; never projected to peers.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: { origin: 'https://pr-68.previews.dev.thingtime.com', signingPublicKey: '<base64url-ed25519-spki>', lastSeenAt: '2026-08-24T00:00:00.000Z', schemaVersion: 1 }
};

const adminIntegrationSecretSchema: ThingtimeSchema = {
  id: 'admin-integration-secret',
  version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationSecrets,
  kind: 'collection',
  collection: 'adminIntegrationSecrets',
  title: 'Admin integration secret vault entry',
  summary: 'Admin-only AES-256-GCM encrypted external credential; its value is never projected by an API.',
  detail:
    'Endpoint policies reference the credential through an opaque id. Ciphertext, IV, and authentication tag remain server-only; deleting is blocked while an endpoint references the secret.',
  fields: [
    { name: 'id', type: 'string', required: true, description: 'Opaque vault id.' },
    { name: 'label', type: 'string', required: true, description: 'Non-sensitive operator label.' },
    { name: 'cipherText', type: 'string', required: true, description: 'AES-GCM ciphertext. Never projected.' },
    { name: 'iv', type: 'string', required: true, description: 'AES-GCM nonce. Never projected.' },
    { name: 'tag', type: 'string', required: true, description: 'AES-GCM auth tag. Never projected.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Creation time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Rotation time.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: { id: 'secret_example', label: 'Vercel write-only token', cipherText: '<encrypted>', schemaVersion: 1 }
};

const lopuCredentialSchema: ThingtimeSchema = {
  id: 'lopu-credential',
  version: COLLECTION_SCHEMA_VERSIONS.lopuCredentials,
  kind: 'collection',
  collection: 'lopuCredentials',
  title: 'Lopu ordered credential vault entry',
  summary: 'Named Claude credential encrypted with AES-256-GCM and ordered for Lopu usage failover.',
  detail:
    'The browser receives metadata only. Credential values are decrypted solely for a fresh, replay-protected HMAC request from the protected GitHub Actions control plane.',
  fields: [
    { name: 'id', type: 'string', required: true, description: 'Opaque credential id.' },
    { name: 'name', type: 'string', required: true, description: 'Non-sensitive admin label.' },
    { name: 'credentialType', type: 'string', required: true, description: 'Closed credential type.' },
    { name: 'cipherText', type: 'string', required: true, description: 'AES-GCM ciphertext. Never projected to a browser.' },
    { name: 'iv', type: 'string', required: true, description: 'AES-GCM nonce. Never projected.' },
    { name: 'tag', type: 'string', required: true, description: 'AES-GCM authentication tag. Never projected.' },
    { name: 'priority', type: 'number', required: true, description: 'Zero-based waterfall position.' },
    { name: 'enabled', type: 'boolean', required: true, description: 'Whether Lopu may use the credential.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Creation time.' },
    { name: 'updatedAt', type: 'date', required: true, description: 'Last metadata or value change.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: { id: 'lopu_credential_example', name: 'Thingtime Claude', credentialType: 'claude-code-oauth-token', priority: 0, enabled: true, cipherText: '<encrypted>', schemaVersion: 1 }
};

const adminIntegrationEndpointSchema: ThingtimeSchema = {
  id: 'admin-integration-endpoint',
  version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationEndpoints,
  kind: 'collection',
  collection: 'adminIntegrationEndpoints',
  title: 'Admin integration endpoint policy',
  summary: 'Admin-managed upstream origin, closed paths, credential reference, and read/write permission policy.',
  detail:
    'The proxy receives an endpoint id rather than an arbitrary URL. It enforces the selected read, create-only, or full-write mode before decrypting the referenced credential.',
  fields: [
    { name: 'id', type: 'string', required: true, description: 'Opaque endpoint id.' },
    { name: 'origin', type: 'string', required: true, description: 'Allowlisted HTTPS upstream origin.' },
    { name: 'secretId', type: 'string', required: true, description: 'Referenced vault id.' },
    { name: 'allowedPathPrefixes', type: 'string[]', required: true, description: 'Closed upstream path prefixes.' },
    { name: 'allowRead', type: 'boolean', required: true, description: 'Whether GET through the proxy is permitted.' },
    { name: 'writeMode', type: 'enum', required: true, values: ['none', 'create-only', 'write'], description: 'Allowed write policy.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: {
    id: 'endpoint_example',
    origin: 'https://api.vercel.com',
    secretId: 'secret_example',
    allowedPathPrefixes: ['/v9/projects'],
    allowRead: true,
    writeMode: 'create-only',
    schemaVersion: 1
  }
};

const adminIntegrationClaimSchema: ThingtimeSchema = {
  id: 'admin-integration-claim',
  version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationClaims,
  kind: 'collection',
  collection: 'adminIntegrationClaims',
  title: 'Admin integration create-only claim',
  summary: 'Short-lived relational lock preventing concurrent create-only requests for the same provider resource.',
  detail:
    'Claims contain a derived provider resource identity but never a credential or request body. They expire automatically and are removed after each completed proxy call.',
  fields: [
    { name: 'endpointId', type: 'string', required: true, description: 'Saved endpoint policy id.' },
    { name: 'resourceKey', type: 'string', required: true, description: 'Bounded provider-specific create identity.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Claim creation time.' },
    { name: 'expiresAt', type: 'date', required: true, description: 'TTL expiry time.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: { endpointId: 'endpoint_example', resourceKey: 'project:ENV_KEY:production', expiresAt: '2026-08-24T00:02:00.000Z', schemaVersion: 1 }
};

const adminIntegrationAuditSchema: ThingtimeSchema = {
  id: 'admin-integration-audit',
  version: COLLECTION_SCHEMA_VERSIONS.adminIntegrationAudit,
  kind: 'collection',
  collection: 'adminIntegrationAudit',
  title: 'Admin integration proxy audit event',
  summary: 'Redacted, expiring control-plane evidence for a policy-proxied external call.',
  detail:
    'Audit rows record endpoint, operation, path, status, and coarse outcome only. Credentials, request bodies, response bodies, and provider secret values are never stored here.',
  fields: [
    { name: 'id', type: 'string', required: true, description: 'Opaque audit event id.' },
    { name: 'endpointId', type: 'string', required: true, description: 'Saved endpoint policy id.' },
    { name: 'operation', type: 'enum', required: true, values: ['read', 'create', 'write'], description: 'Policy operation.' },
    { name: 'path', type: 'string', required: true, description: 'Allowed upstream path without query values.' },
    { name: 'status', type: 'number', required: true, description: 'Upstream status or policy-block code.' },
    { name: 'outcome', type: 'enum', required: true, values: ['allowed', 'blocked', 'failed'], description: 'Coarse result.' },
    { name: 'createdAt', type: 'date', required: true, description: 'Event time.' },
    { name: 'expiresAt', type: 'date', required: true, description: 'TTL expiry time.' },
    { name: 'schemaVersion', type: 'number', required: true, description: 'Collection schema version.' }
  ],
  example: {
    id: 'audit_example',
    endpointId: 'endpoint_example',
    operation: 'create',
    path: '/v10/projects/example/env',
    status: 200,
    outcome: 'allowed',
    schemaVersion: 1
  }
};

const appSchema: ThingtimeSchema = {
  id: 'app',
  version: 3,
  kind: 'crystal',
  collection: null,
  title: 'App',
  summary: 'A registered third-party app that can embed "Login with Thingtime".',
  detail:
    'Created only through /api/v1/apps (no generic-route sanitizer on purpose — the server mints ' +
    'the clientId, so it cannot be forged through /api/v1/things). The clientId identifies the app ' +
    'to the embed SDK. SSO origins are default-open: any valid web origin can open the authorize ' +
    'popup and receive tokens (so preview deploys work without registration); origins is an ' +
    'optional reference list, and each token is bound to the exact origin that requested it. ' +
    'Deleting the app revokes every app-scoped session minted for it.',
  fields: [
    { name: 'clientId', type: 'id', required: true, description: 'Server-minted public app id (ttapp_<uuid>) used by the embed SDK.' },
    { name: 'name', type: 'string', required: true, max: MAX_APP_NAME_CHARS, description: `App name shown on the consent screen, max ${MAX_APP_NAME_CHARS} chars.` },
    { name: 'origins', type: 'string[]', required: false, max: MAX_APP_ORIGINS, description: `Optional reference list of the app's web origins (https, or http for localhost dev), max ${MAX_APP_ORIGINS}. Not enforced — SSO is open to any origin by default.` }
  ],
  example: {
    clientId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f',
    name: 'Rainbow Notes',
    origins: ['https://rainbownotes.example'],
    nativeRedirectUris: ['com.rainbownotes.app://oauth/callback'],
    subscriptionTier: 'free',
    subscriptionTierVersionId: 'subscription-tier-free-v1',
    subscriptionTierVersion: 1,
    storageAllowanceBytes: DEFAULT_APP_STORAGE_ALLOWANCE_BYTES,
    storageUsedBytes: 0,
    userStorageAllowanceBytes: DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES,
    storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION
  }
};

const appDataSchema: ThingtimeSchema = {
  id: 'app-data',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'App data',
  summary: "A key/value entry a third-party app stores in a user's Thingtime account.",
  detail:
    'Written only through /api/v1/app-data with an app-scoped Bearer token (no generic-route ' +
    'sanitizer on purpose), one thing per (user, app, key) — relational, atomic, and bounded per ' +
    `FUNDAMENTALS.md §3: values cap at ${MAX_APP_DATA_VALUE_BYTES / 1024} KiB of JSON and the (user, app) ` +
    `namespace starts with a ${DEFAULT_APP_USER_STORAGE_ALLOWANCE_BYTES / (1024 * 1024)} MiB app-managed storage allowance inside the app's ` +
    `${DEFAULT_APP_STORAGE_ALLOWANCE_BYTES / (1024 * 1024 * 1024)} GiB free-tier aggregate allowance (unlimited entry ` +
    'count). Owned by the END USER (acl ["tt:user"]), not the app ' +
    'developer, so users can see and delete what an app has stored for them.',
  fields: [
    { name: 'appId', type: 'id', required: true, description: 'The clientId of the app this entry belongs to.' },
    {
      name: 'key',
      type: 'string',
      required: true,
      max: MAX_APP_DATA_KEY_CHARS,
      description: `Entry key ([A-Za-z0-9._:-], first char alphanumeric, max ${MAX_APP_DATA_KEY_CHARS} chars).`
    },
    { name: 'value', type: 'record', required: true, description: `Arbitrary JSON value, max ${MAX_APP_DATA_VALUE_BYTES / 1024} KiB serialized.` }
  ],
  example: { appId: 'ttapp_4f6b2c1e-8f2a-4c3d-9e5b-2a1f0c9d8e7f', key: 'preferences', value: { theme: 'rainbow' } }
};

// ---------------------------------------------------------------------------
// Messenger kinds — chats, messages, communities, custom emojis, follows.
// All of them are written ONLY through /api/v1/chats*, /api/v1/communities*,
// /api/v1/emojis and /api/v1/users/follow (no generic-route sanitizers on
// purpose: membership, roles and request states are server-derived and must
// not be forgeable through /api/v1/things). Everything is private plumbing
// (acl ["tt:user"]) — visibility is decided by chat/community MEMBERSHIP,
// enforced in the messenger utils, never by the generic acl walk.

const communitySchema: ThingtimeSchema = {
  id: 'community',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Community',
  summary: 'A Slack-style workspace that groups channels, members and custom emojis.',
  detail:
    'Created through POST /api/v1/communities. Channels (chat things with chatType "channel") ' +
    'and sidebar sections link back via targetId; membership is relational community-member ' +
    'things (never an embedded member array). Invites mint community-invite things with ' +
    'single-use-or-capped codes.',
  createdVia: 'POST /api/v1/communities',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_COMMUNITY_NAME_CHARS, description: 'Community name.' },
    { name: 'description', type: 'string', required: false, max: MAX_COMMUNITY_DESCRIPTION_CHARS, description: 'Optional description.' }
  ],
  example: { name: 'Rainbow Makers', description: 'Everything rainbow.' }
};

const communityMemberSchema: ThingtimeSchema = {
  id: 'community-member',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Community member',
  summary: 'One user\'s membership of one community (relational child doc).',
  detail:
    'targetId = the community shareId, ownerId = the member. Uniqueness rides the single ' +
    'crystal.memberKey field (`<communityId>:<userId>`, partial unique index) — the reaction-index ' +
    'pattern. Roles: owner > admin > member.',
  createdVia: 'POST /api/v1/communities (creator) / POST /api/v1/communities/join (invite code)',
  fields: [
    { name: 'memberKey', type: 'string', required: true, description: 'Unique `<communityId>:<userId>` pair key.' },
    { name: 'role', type: 'enum', required: true, values: ['owner', 'admin', 'member'], description: 'Community role.' }
  ],
  example: { memberKey: 'c0ffee…:5eed…', role: 'member' }
};

const communityInviteSchema: ThingtimeSchema = {
  id: 'community-invite',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Community invite',
  summary: 'An invite code that lets a user join a community.',
  detail:
    'targetId = the community shareId. The code is server-minted, unique via a partial index on ' +
    'crystal.inviteCode, optionally expiring and use-capped; redemption is atomic (uses is ' +
    'incremented with a guard, never read-modify-write).',
  createdVia: 'POST /api/v1/communities/invites',
  fields: [
    { name: 'inviteCode', type: 'string', required: true, description: 'Server-minted redemption code.' },
    { name: 'uses', type: 'number', required: true, description: 'Times redeemed so far.' },
    { name: 'maxUses', type: 'number', required: false, description: 'Redemption cap (null = unlimited).' },
    { name: 'expiresAt', type: 'string', required: false, description: 'ISO expiry (null = never).' },
    { name: 'revoked', type: 'boolean', required: false, description: 'True once revoked by an admin.' }
  ],
  example: { inviteCode: 'tt-inv-8f2a4c3d9e5b', uses: 0, maxUses: 25 }
};

const chatSectionSchema: ThingtimeSchema = {
  id: 'chat-section',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Chat section',
  summary: 'A named sidebar group that community channels can be filed under.',
  detail: 'targetId = the community shareId. Pure organisation — deleting a section un-files its channels.',
  createdVia: 'POST /api/v1/communities/sections',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_SECTION_NAME_CHARS, description: 'Section name.' },
    { name: 'order', type: 'number', required: true, description: 'Sort position within the sidebar.' }
  ],
  example: { name: 'Announcements', order: 0 }
};

const chatSchema: ThingtimeSchema = {
  id: 'chat',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Chat',
  summary: 'A conversation: a community channel, a standalone group, or a direct message.',
  detail:
    'Created through POST /api/v1/chats. Membership, roles, nicknames and read receipts are ' +
    'relational chat-member things; messages are relational chat-message things. DMs are deduped ' +
    'by crystal.dmKey (sorted participant ids, partial unique index). Channels link their ' +
    'community via targetId + crystal.communityId and can be public (any community member may ' +
    'join) or private (admins add).',
  createdVia: 'POST /api/v1/chats',
  fields: [
    { name: 'name', type: 'string', required: false, max: MAX_CHAT_NAME_CHARS, description: 'Chat name (null for DMs — the UI shows the other member).' },
    { name: 'topic', type: 'string', required: false, max: MAX_CHAT_TOPIC_CHARS, description: 'Channel topic line.' },
    { name: 'chatType', type: 'enum', required: true, values: ['channel', 'group', 'dm'], description: 'Conversation shape.' },
    { name: 'communityId', type: 'id', required: false, description: 'Owning community shareId (channels only).' },
    { name: 'sectionId', type: 'id', required: false, description: 'Sidebar section shareId (channels only).' },
    { name: 'channelVisibility', type: 'enum', required: false, values: ['public', 'private'], description: 'Channel joinability within its community (channels only, default public).' },
    { name: 'dmKey', type: 'string', required: false, description: 'Sorted participant-id pair key deduping DMs.' }
  ],
  example: { name: 'general', topic: 'Anything goes', chatType: 'channel', channelVisibility: 'public' }
};

const chatMemberSchema: ThingtimeSchema = {
  id: 'chat-member',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Chat member',
  summary: 'One user\'s membership of one chat — role, nickname, request state and read receipt.',
  detail:
    'targetId = the chat shareId, ownerId = the member. Unique per (chat, user) via ' +
    'crystal.memberKey. state tracks the Messenger request flow: active, pending (message ' +
    'request awaiting accept), left, declined. requestOrigin buckets pending DMs into ' +
    '"follower" (the sender follows you) vs "unknown". lastReadMessageId/lastReadAt are the ' +
    'read receipt — one atomic doc per member, never an array on the chat.',
  createdVia: 'POST /api/v1/chats / POST /api/v1/chats/members',
  fields: [
    { name: 'memberKey', type: 'string', required: true, description: 'Unique `<chatId>:<userId>` pair key.' },
    { name: 'role', type: 'enum', required: true, values: ['owner', 'admin', 'member'], description: 'Chat role.' },
    { name: 'nickname', type: 'string', required: false, max: MAX_NICKNAME_CHARS, description: 'Per-chat nickname (Messenger style).' },
    { name: 'state', type: 'enum', required: true, values: ['active', 'pending', 'left', 'declined'], description: 'Membership lifecycle / message-request state.' },
    { name: 'requestOrigin', type: 'enum', required: false, values: ['follower', 'unknown'], description: 'Message-request bucket while pending.' },
    { name: 'lastReadMessageId', type: 'id', required: false, description: 'Newest message this member has read.' },
    { name: 'lastReadAt', type: 'string', required: false, description: 'ISO timestamp of that read (drives unread counts + seen-by).' },
    { name: 'muted', type: 'boolean', required: false, description: 'Suppress notifications for this chat.' }
  ],
  example: { memberKey: 'cha7…:5eed…', role: 'member', state: 'active' }
};

const chatMessageSchema: ThingtimeSchema = {
  id: 'chat-message',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Chat message',
  summary: 'One message in a chat — the post shape adapted for conversations.',
  detail:
    'targetId = the chat shareId. Deliberately NOT a post kind, so messages can never surface ' +
    'in feeds or profiles; visibility is chat membership, enforced by the messenger endpoints. ' +
    'threadRootId threads Slack-style replies under a root message; replyToId quotes a message ' +
    'Messenger-style. Deleting is soft (deletedAt + text cleared) so threads keep their shape. ' +
    'System events (member added, renamed…) are messages with systemType. Reactions are the ' +
    'standard reaction things targeting the message, including custom `custom:<emoji id>` tokens.',
  createdVia: 'POST /api/v1/chats/messages',
  fields: [
    { name: 'text', type: 'string', required: true, max: MAX_MESSAGE_CHARS, description: `Message text, max ${MAX_MESSAGE_CHARS} chars. :name: tokens render as custom emojis.` },
    { name: 'threadRootId', type: 'id', required: false, description: 'Root message shareId when this is a thread reply.' },
    { name: 'replyToId', type: 'id', required: false, description: 'Quoted message shareId (inline reply).' },
    { name: 'editedAt', type: 'string', required: false, description: 'ISO timestamp of the last edit.' },
    { name: 'deletedAt', type: 'string', required: false, description: 'ISO soft-delete timestamp (text is cleared).' },
    { name: 'systemType', type: 'enum', required: false, values: ['member-added', 'member-left', 'member-removed', 'chat-renamed', 'chat-created', 'topic-changed'], description: 'Set on system event messages.' },
    { name: 'systemMeta', type: 'record', required: false, description: 'Event payload for system messages ({ subjectId, value… }).' }
  ],
  example: { text: 'hello from the messenger 👋' }
};

const customEmojiSchema: ThingtimeSchema = {
  id: 'custom-emoji',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Custom emoji',
  summary: 'An uploaded emoji/gif usable in chat reactions and messages.',
  detail:
    'One thing per emoji (relational, FUNDAMENTALS §3 — never an array on the community). The ' +
    'image is an inline base64 data URI (gif/webp/png/apng/jpeg, ≤' +
    `${Math.round(MAX_EMOJI_DATA_URI_CHARS / 1024)}K chars), the avatar-storage pattern. Scope is ` +
    'a community (targetId set) or personal (targetId null); names are unique per scope via ' +
    'crystal.emojiKey. Reaction tokens reference emojis by id (`custom:<shareId>`), so renames ' +
    'never orphan reactions.',
  createdVia: 'POST /api/v1/emojis',
  fields: [
    { name: 'name', type: 'string', required: true, max: MAX_EMOJI_NAME_CHARS, description: 'Lowercase [a-z0-9_-] name, rendered as :name:.' },
    { name: 'emojiKey', type: 'string', required: true, description: 'Unique `<scope>:<name>` key (scope = communityId or user:<userId>).' },
    { name: 'image', type: 'string', required: true, description: 'Inline data:image/... base64 URI.' },
    { name: 'animated', type: 'boolean', required: false, description: 'True for gif/apng uploads.' }
  ],
  example: { name: 'party-parrot', emojiKey: 'c0ffee…:party-parrot', image: 'data:image/gif;base64,R0lGOD…', animated: true }
};

const followSchema: ThingtimeSchema = {
  id: 'follow',
  version: 1,
  kind: 'crystal',
  collection: null,
  title: 'Follow',
  summary: 'One user following another (the start of the relationship graph).',
  detail:
    'ownerId = the follower, targetId = the followed user\'s shareId; unique per pair via ' +
    'crystal.followKey. Powers the messenger request buckets (a DM from someone you follow ' +
    'lands normally; from a follower it queues as a "follower" request; otherwise "unknown"). ' +
    'The acl circle entries (tt:userFriends…) are designed to plug into this graph later.',
  createdVia: 'POST /api/v1/users/follow',
  fields: [
    { name: 'followKey', type: 'string', required: true, description: 'Unique `<followerId>:<followeeId>` pair key.' }
  ],
  example: { followKey: '5eed…:c0ffee…' }
};

// ---------------------------------------------------------------------------
// System kinds — the satellite collections collapsing into things (see
// TODO/claude-todo/22-everything-is-a-thing-collections.md). These kinds are
// PROTECTED: the generic /api/v1/things CRUD unconditionally refuses them.
// Only their dedicated utils (register, profile update, themes/algorithms/
// waitlist) write them, each a direct insert that owns the right secure/
// uniqueKeys shape — they do NOT go through createThing. Private state lives
// under the root `secure` field (never crystal, never projected, a single
// BinData blob so the $** text index can't tokenize any field inside it) and
// uniqueness rides the root `uniqueKeys` array (multikey unique sparse index;
// BinData elements, PII keys hashed).

// follow/friend/notification are protected for a different reason than the
// system kinds above: they are server-owned state machines. A forged `friend`
// doc would fake an ACL friendship (friends-only posts leak), a forged
// `follow` would skip dedup + notification emission, and notifications are
// minted only by the server on someone ELSE's action. Their dedicated
// endpoints (/api/v1/users/follow, /api/v1/users/friend, notifications utils)
// do direct inserts.
export const PROTECTED_THINGTIME = ['user', 'theme', 'feed-algorithm', 'waitlist', 'follow', 'friend', 'notification'] as const;
export const isProtectedThingtime = (ids: string[]): boolean =>
  ids.some((id) => (PROTECTED_THINGTIME as readonly string[]).includes(id));

// Messenger kinds are owned by /api/v1/chats* end to end. Create/update are
// already refused by the missing crystal sanitizers, and DELETE must be too:
// a chat thing "owned" by its creator is one doc standing in for EVERY
// member's conversation, so the generic owner-may-delete rule cannot apply.
export const MESSENGER_THINGTIME = [
  'community',
  'community-member',
  'community-invite',
  'chat-section',
  'chat',
  'chat-member',
  'chat-message',
  'custom-emoji',
  'follow'
] as const;

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
  createdVia: 'POST /api/v1/auth/register',
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
  createdVia: 'POST /api/v1/themes',
  fields: [
    { name: 'name', type: 'string', required: true, max: 60, description: 'Theme name.' },
    { name: 'theme', type: 'record', required: true, description: 'Resolved theme tokens.' }
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
  createdVia: 'POST /api/v1/algorithms',
  fields: [
    { name: 'name', type: 'string', required: true, max: 60, description: 'Algorithm name.' },
    { name: 'emoji', type: 'string', required: true, description: 'Display emoji.' },
    { name: 'parentId', type: 'id', required: false, description: 'Branch lineage parent.' },
    { name: 'description', type: 'string', required: false, max: 300, description: 'Owner-written directory description.' },
    { name: 'listed', type: 'boolean', required: false, description: 'Explicit public directory opt-in, requires shared=true. Existing link-only profiles remain unlisted.' },
    {
      name: 'weights',
      type: 'record',
      required: true,
      description: '{ types, tags, authors } weight maps — open keys, so the shape stays a record.'
    },
    { name: 'eventCount', type: 'number', required: true, description: 'Engagement events trained on.' },
    { name: 'lastTrainedAt', type: 'date', required: false, description: 'Last training time.' },
    {
      name: 'shared',
      type: 'boolean',
      required: false,
      description:
        'Owner-granted branch invitation ("try my feed brain"). Never changes the acl — it only lets ' +
        '/feed?algorithm=<shareId> holders read the name/emoji/eventCount preview and branch their own copy.'
    }
  ],
  example: { name: 'Chronological+', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, shared: false }
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
  createdVia: 'POST /api/v1/waitlist',
  fields: [],
  example: {}
};

export const thingtimeSchemas: ThingtimeSchema[] = [
  ...['mail-account', 'mail-folder', 'mail-message', 'mail-inbox', 'mail-operation'].map(id => ({
    id, version: 1, kind: 'crystal' as const, collection: null, title: id.replace('mail-', 'Mail '),
    summary: 'Private encrypted mail record.', detail: 'Owned mail records use the same versioned model in the cloud, browser and local connector. Credentials and message content are encrypted. Proxy inboxes contain folder references only. Generic Thing reads, writes and sharing cannot access these records.',
    createdVia: '/api/v1/mail', fields: [], example: {}
  })),

  { id: 'password-manager-entry', version: 2, kind: 'crystal', collection: null, title: 'Password manager entry',
    summary: 'An encrypted, private credential with ordered custom fields.',
    detail: 'Created only through the password manager API. The title, password type, ordered fields and field types form an extensible document; field values are encrypted together with the account vault key. Generic Thing CRUD, search, sharing and history cannot disclose the entry. The Thing fields mod supplies sectioned and typed field editors. Imported source JSON, account/vault attributes, flags, tags, and password history are encrypted alongside the fields; private encrypted files are relational attachment Things.',
    createdVia: '/api/v1/passwords', fields: [
      { name: 'title', type: 'string', required: true, description: 'Entry title.' },
      { name: 'passwordType', type: 'enum', required: true, values: [...PASSWORD_TYPES], description: 'Credential category. Native passkeys hold encrypted signing material.' },
      { name: 'fields', type: 'array', required: true, children: [
        { name: 'id', type: 'string', required: true, description: 'Stable field id.' },
        { name: 'label', type: 'string', required: true, description: 'Field label.' },
        { name: 'type', type: 'enum', required: true, values: [...FIELD_TYPES], description: 'Field editor.' },
        { name: 'value', type: 'string', required: false, description: 'Encrypted field value. The password manager has no character-count cap.' },
        { name: 'section', type: 'string', required: false, description: 'Section heading.' },
        { name: 'concealed', type: 'boolean', required: false, description: 'Hide the value until revealed.' },
        { name: 'structured', type: 'boolean', required: false, description: 'Preserve the original JSON type of structured values.' }
      ], description: 'Ordered fields in the encrypted document: id, label, type and value. Defaults are username, password and website.' }
    ], example: { title: 'Example login', passwordType: 'login', fields: [{ id: 'username', label: 'Username', type: 'text', value: '' }, { id: 'password', label: 'Password', type: 'password', value: '' }] } },
  { id: 'draft', version: 1, kind: 'crystal', collection: null, title: 'Draft or template',
    summary: 'Private account-backed editing snapshots and reusable templates.',
    detail: 'Owner-only, quota-accounted drafts, version-checked through the drafts API. Each is an atomic Thing; files are relational attachment children. Generic CRUD, feeds and search cannot publish drafts.',
    createdVia: '/api/v1/drafts', fields: [], example: {} },
	{ id: TIMELINE_SNAPSHOT_PART_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline snapshot part',
		summary: 'One bounded private fragment of a retained large version.',
		detail: 'The shared canonical part record lives in secure BinData. parentId and targetId reference its immutable event; scalar side and ordinal identify its position. Each part is a separate atomic Thing, with no accumulating arrays. The parent event accounts for retained customer bytes exactly once. Only the canonical content transaction writes parts; generic reads and writes are refused.',
		createdVia: 'Canonical Timeline transaction', fields: [], example: {} },
	{ id: TIMELINE_BRANCH_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline branch',
		summary: 'A named private branch with relational Thing memberships.', detail: 'The shared branch record lives in secure BinData. Each contained Thing has a separate timeline-branch-head record; neither revisions nor heads accumulate in this document. Dedicated Timeline commands own the lifecycle and record branch changes in History.',
		createdVia: 'Timeline branch command', fields: [{ name: 'name', type: 'string', required: true, system: true, description: 'Branch display name.' }], example: { name: 'Design experiment' } },
	{ id: TIMELINE_BRANCH_HEAD_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline branch version',
		summary: 'One current version for one branch and Thing.', detail: 'A protected atomic relationship with scalar branchId, thingId, eventId and optimistic revision. targetId names its Thing and parentId its branch. A push requires the current revision and preserves ancestry; divergence requires a merge. The canonical head record is identical locally and remotely.',
		createdVia: 'Timeline branch command', fields: [], example: {} },
	{ id: TIMELINE_NOTE_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline note',
		summary: 'A private contextual message attached to one immutable Timeline event.',
		detail: 'Each note is its own protected relational Thing: the identical local/server note record (owner or Lopu author, plain text up to 2000 characters, at most 8192 bytes) lives in secure BinData, targetId points to its event Thing, and hashed crystal.targetId plus crystal.linkKind support reverse lookup through the existing shared index. Events stay immutable and exact-keyed; notes never accumulate as an array on the event, the Thing or the Timeline folder. At most 8 notes per event; the owner may remove either author’s note, refunding metered storage. Only the dedicated Timeline note commands write notes; generic Things reads, search and sharing never expose them.',
		createdVia: 'Timeline note command', fields: [{ name: 'name', type: 'string', required: true, system: true, description: 'Value-free display label.' }], example: { name: 'Note' } },
	{ id: TIMELINE_VERSION_NAME_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline version name',
		summary: 'A private pinned display name for one saved Timeline version.',
		detail: 'One protected relational Thing per named event: the identical local/server name record (1–80 characters, at most 4096 bytes) lives in secure BinData, targetId points to its event Thing, hashed crystal.targetId plus crystal.linkKind support reverse lookup through the existing shared index, and a root nameRevision fences concurrent renames. The crystal label is constant, so the name text never reaches crystal projections, search or root data. Events stay immutable and exact-keyed; names never accumulate on the event, the Thing or the Timeline folder and invent no version numbers. The record is unbilled control metadata, but every name, rename and clear appends a metered timeline-version-name effect event beside the named version. Only the dedicated name-version Timeline command writes names; generic Things reads, search and sharing never expose them.',
		createdVia: 'Timeline name-version command', fields: [{ name: 'name', type: 'string', required: true, system: true, description: 'Value-free display label.' }], example: { name: 'Version name' } },
	{ id: TIMELINE_LINK_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline relationship',
		summary: 'One immutable private link between an event and a version, Thing, branch or operation.',
		detail: 'Each relationship is its own protected Thing in Timeline. The identical local/server link record lives in secure BinData; targetId points to its event Thing. Hashed crystal.targetId and crystal.linkKind support reverse lookup through the existing shared index. Links commit with the event, never accumulate in document arrays, and cannot be edited through generic Things APIs.',
		createdVia: 'Canonical Timeline transaction', fields: [], example: {} },
	{ id: TIMELINE_EVENT_KIND, version: 1, kind: 'crystal', collection: null, title: 'Timeline event',
		summary: 'An immutable private change and its server acceptance receipt.',
		detail: 'An atomic Thing under the owner’s Timeline folder. targetId names the affected Thing, including deleted Things. The shared versioned event and receipt live in secure BinData, excluded from generic reads/search. V3 stores the canonical relational event record; parent, dependency, Thing, branch and operation links are separate atomic timeline-link Things. Logical storage accounting meters retained customer snapshot content. Dedicated Timeline reads authenticate the owner; ordinary content sharing never shares its history.',
		createdVia: 'Canonical mutation transactions and the Timeline sync API',
		fields: [{ name: 'name', type: 'string', required: true, system: true, description: 'Value-free display label.' }], example: { name: 'Change' } },
	{ id: 'lopu-background-task', version: 1, kind: 'crystal', collection: null, title: 'Background AI task',
    summary: 'Protected owner-private execution and reconnect state.',
    detail: 'Home control Thing with origin/data-source scope, immutable request digest and bounded secure BinData output. Seven-day output access; lazy byte removal; retained operation marker prevents replay. Chat output additionally requires current conversation access. Optional management and workflowStatus track a durable chain. The root workflowInput is protected BinData containing the initial request and a revocable session grant; it is never indexed or projected and is removed at terminal completion. Child parts link by protected rootTaskId. Protected activeWorkerRequestId, workerStarted, workerFinishedAt, workflowFinalStatus and workflowFinalizedAt fence admission and preserve the conversation claim until all executors acknowledge their final saved output; lease expiry alone never releases that claim.',
    createdVia: 'Background transport on the canonical AI endpoints', fields: [], example: {} },
	...(['lopu-recording-settings', 'lopu-recording-job', 'lopu-recording-reminder', 'lopu-reminder'] as const).map((id): ThingtimeSchema => ({
		id, version: 1, kind: 'crystal', collection: null, title: id,
		summary: 'Protected owner-private recording or reminder automation state.',
		detail: 'Managed by the Lopu recording API. Bounded operational state; private processing scratch is in secure BinData, never indexed or projected. Transcript comments and generated Things use ordinary quota-billed content writes.',
		createdVia: id === 'lopu-reminder' ? 'POST /api/v1/lopu/reminders' : 'POST /api/v1/lopu/recordings', fields: [], example: {}
	})),
  rootThingSchema,
  postSchema,
	attachmentSchema,
	fileSchema,
  commentSchema,
  reactionSchema,
  shareSchema,
  dataSchema,
  {
    id: 'scheduled-task-run', version: 1, kind: 'crystal', collection: null,
    title: 'Scheduled task run', summary: 'An owner-private, editable run note linked to its task by targetId.',
    requiresTarget: true,
    detail: 'A quota-billed child Thing, not an embedded task history. These owner-editable notes are not security audit records. Deleting the task cascades its run notes; destination conversations remain separate.',
    fields: [
      { name: 'title', type: 'string', required: true, max: 240, description: 'Run title.' },
      { name: 'chatId', type: 'id', required: true, description: 'Destination Lopu conversation.' },
      { name: 'scheduledAt', type: 'date', required: true, description: 'Scheduled occurrence.' },
      { name: 'status', type: 'enum', required: true, values: ['running', 'done', 'needs-attention'], description: 'Last saved run status.' },
      { name: 'notificationStatus', type: 'string', required: false, description: 'Optional notification delivery diagnostic.' }
    ], example: { title: 'Daily update', chatId: 'chat-id', scheduledAt: '2026-09-10T09:00:00.000Z', status: 'done' }
  },
  schemaThingSchema,
  componentSchema,
  actionSchema,
  actionRunSchema,
  saveThingSchema,
  folderSchema,
  appSchema,
  appDataSchema,
  // messenger kinds (dedicated endpoints only — no generic sanitizers)
  communitySchema,
  communityMemberSchema,
  communityInviteSchema,
  chatSectionSchema,
  chatSchema,
  chatMemberSchema,
  chatMessageSchema,
  customEmojiSchema,
  followSchema,
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
  rateLimitSchema,
  deploymentPeerSchema,
  adminIntegrationSecretSchema,
  adminIntegrationEndpointSchema,
  adminIntegrationClaimSchema,
  adminIntegrationAuditSchema,
  lopuCredentialSchema
];

export const getThingtimeSchema = (id: string): ThingtimeSchema | null => thingtimeSchemas.find((schema) => schema.id === id) || null;

export const crystalSchemas = (): ThingtimeSchema[] => thingtimeSchemas.filter((schema) => schema.kind === 'crystal');

// ---------------------------------------------------------------------------
// Crystal validation. Pure and hand-rolled (no schema library — repo style),
// shared by the API layer and anything else that wants to check a crystal.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const isFail = <T extends { ok: boolean }>(value: T | Fail): value is Fail => value.ok === false;

const UNSAFE_HTTP_URL_CHAR_RE = /[\p{Cc}\p{Cf}\p{Cs}\s]/u;
const isHttpUrl = (value: string): boolean => {
	if (!/^https?:\/\//i.test(value) || UNSAFE_HTTP_URL_CHAR_RE.test(value) || value.includes('\\')) return false;
	try {
		const parsed = new URL(value);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname && !parsed.username && !parsed.password;
	} catch {
		return false;
	}
};

const sanitizeAttachmentCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
	const sanitized = sanitizeAttachmentPublicMetadata(input);
	if (sanitized.ok === false) return fail(400, sanitized.error);
	return sanitized;
};

export type ThingtimeCrystalValidationOptions = {
	// Server-only attachment preflight. Generic Thing input never controls this
	// context; the dedicated attachment store verifies ownership/state first and
	// the post transaction rechecks while binding.
	postAttachments?: { hasAny: boolean; hasVisual: boolean };
};

// Owner-chosen gallery layout for a post's visual attachments. Post-LEVEL
// presentation data (one bounded object on the post crystal), never a field on
// the attachments themselves — absent means the automatic masonry default.
// Shared with the client so the composer controls and this validator agree.
export const MEDIA_LAYOUT_MODES = ['masonry', 'rows', 'grid'] as const;
export const MEDIA_LAYOUT_SPAN_VALUES = ['normal', 'wide', 'tall', 'big'] as const;
export const MAX_MEDIA_LAYOUT_ENTRIES = 25; // pattern rows + span entries share the attachment cap
export const MAX_MEDIA_LAYOUT_TRACK = 6; // max images per row / grid columns
export type MediaLayoutSpan = (typeof MEDIA_LAYOUT_SPAN_VALUES)[number];
export type PostMediaLayout = {
	mode: (typeof MEDIA_LAYOUT_MODES)[number];
	pattern?: number[];
	columns?: number;
	spans?: Record<string, MediaLayoutSpan>;
};

const sanitizeMediaLayout = (value: unknown): { ok: true; mediaLayout: PostMediaLayout | null } | Fail => {
	if (value === undefined || value === null) return { ok: true, mediaLayout: null };
	if (typeof value !== 'object' || Array.isArray(value)) return fail(400, 'mediaLayout must be an object');
	const raw = value as Record<string, unknown>;
	const mode = MEDIA_LAYOUT_MODES.includes(raw.mode as any) ? (raw.mode as PostMediaLayout['mode']) : null;
	if (!mode) return fail(400, 'mediaLayout.mode must be masonry, rows, or grid');
	if (mode === 'masonry') return { ok: true, mediaLayout: { mode } };

	if (mode === 'rows') {
		const pattern = raw.pattern;
		if (!Array.isArray(pattern) || !pattern.length || pattern.length > MAX_MEDIA_LAYOUT_ENTRIES) {
			return fail(400, `mediaLayout.pattern must be 1-${MAX_MEDIA_LAYOUT_ENTRIES} row sizes`);
		}
		const rows: number[] = [];
		for (const entry of pattern) {
			if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1 || entry > MAX_MEDIA_LAYOUT_TRACK) {
				return fail(400, `mediaLayout.pattern rows must be integers 1-${MAX_MEDIA_LAYOUT_TRACK}`);
			}
			rows.push(entry);
		}
		return { ok: true, mediaLayout: { mode, pattern: rows } };
	}

	// grid
	const columns = raw.columns === undefined ? 3 : raw.columns;
	if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > MAX_MEDIA_LAYOUT_TRACK) {
		return fail(400, `mediaLayout.columns must be an integer 1-${MAX_MEDIA_LAYOUT_TRACK}`);
	}
	let spans: Record<string, MediaLayoutSpan> | undefined;
	if (raw.spans !== undefined && raw.spans !== null) {
		if (typeof raw.spans !== 'object' || Array.isArray(raw.spans)) return fail(400, 'mediaLayout.spans must be an object');
		const entries = Object.entries(raw.spans as Record<string, unknown>);
		if (entries.length > MAX_MEDIA_LAYOUT_ENTRIES) return fail(400, `mediaLayout.spans can hold at most ${MAX_MEDIA_LAYOUT_ENTRIES} entries`);
		const cleaned: Record<string, MediaLayoutSpan> = Object.create(null);
		for (const [key, entry] of entries) {
			// Attachment ids are generated UUIDs or att_<sha256> values. Keep the
			// persisted map free of Mongo path characters and prototype keys rather
			// than treating arbitrary object properties as attachment identities.
			if (!/^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/.test(key)) {
				return fail(400, 'mediaLayout.spans keys must be attachment ids');
			}
			if (!MEDIA_LAYOUT_SPAN_VALUES.includes(entry as any)) {
				return fail(400, 'mediaLayout.spans values must be normal, wide, tall, or big');
			}
			// normal is the default — storing it would be dead weight
			if (entry !== 'normal') cleaned[key] = entry as MediaLayoutSpan;
		}
		if (Object.keys(cleaned).length) spans = { ...cleaned };
	}
	return { ok: true, mediaLayout: { mode, columns, ...(spans ? { spans } : {}) } };
};

// Post → subspace references are shareIds (uuid / seeded ids) and flair ids
// are short slugs; both are bounded here so the multikey/lookup indexes never
// see arbitrary strings.
const SUBSPACE_REF_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SUBSPACE_FLAIR_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

const sanitizePostCrystal = (
	input: Record<string, unknown>,
	appliedIds: string[],
	options: ThingtimeCrystalValidationOptions = {}
): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const type = POST_TYPES.includes(input.type as any) ? (input.type as string) : null;
  if (!type) return fail(400, 'Post type must be text, image, marketplace, or thingtime');
  // share things render the shared original, so their post payload may be
  // an empty caption regardless of type
  const isShare = appliedIds.includes('share');
	// This context is server-only and arrives only after the attachment store
	// verifies the exact owner, purpose, ready state and unbound expiry. It may
	// therefore satisfy the same body rules for a top-level post or a rich
	// ['post', 'comment'] Thing without opening those rules to generic input.
	const hasAnyAttachment = options.postAttachments?.hasAny === true;
	const hasVisualAttachment = options.postAttachments?.hasVisual === true;

  const richTextProvided = input.richText !== undefined;
  let richText: Record<string, unknown> | null = null;
  let text = typeof input.text === 'string' ? input.text.trim() : '';
  if (richTextProvided && input.richText !== null) {
    if (!input.richText || typeof input.richText !== 'object' || Array.isArray(input.richText)) {
      return fail(400, 'richText must be a native rich-text document');
    }
    const sanitized = sanitizeDataValue(input.richText, { path: 'richText', depth: 2 });
    if (sanitized.ok === false) return sanitized;
    if (!isEditorJsDoc(sanitized.value) || !isEditorJsDocSafeToEdit(sanitized.value)) {
      return fail(400, 'richText must be a safe native rich-text document');
    }
    richText = sanitized.value as Record<string, unknown>;
    text = blocksToText(richText.blocks as any[]).trim();
  }
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
  if ((type === 'marketplace' && !isShare) || ((type === 'marketplace' || type === 'thingtime') && listingProvided)) {
    const value = input.listing;
    if (!value || typeof value !== 'object') return fail(400, 'Marketplace posts need listing details');
    const raw = value as Record<string, unknown>;
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
    if (!title) return fail(400, 'Listing title is required');
    const price = Number(raw.price);
    if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
      return fail(400, 'Listing price must be a non-negative number');
    }
    const currency = typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency.trim()) ? raw.currency.trim().toUpperCase() : 'AUD';
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
      const sanitized = sanitizeDataValue(raw, { path: 'thing', depth: 2 });
			if (sanitized.ok === false) return sanitized;
      thing = sanitized.value as Record<string, unknown>;
      if (thing.kind === 'thing-collection') {
        if (!Array.isArray(thing.items) || !thing.items.length || thing.items.length > MAX_POST_THINGS ||
          thing.items.some(item => !item || typeof item !== 'object' || !['data', 'interactive'].includes(item.mode))) {
          return fail(400, `Attach 1-${MAX_POST_THINGS} Things with a data or interactive mode`);
        }
        const items = postThingReferences(thing);
        if (items.length !== thing.items.length) return fail(400, 'Attached Things require unique valid ids');
        if (thing.data !== undefined && (!thing.data || typeof thing.data !== 'object' || Array.isArray(thing.data))) return fail(400, 'Inline Thing data must be an object');
        thing = { kind: 'thing-collection', items, ...(thing.data ? { data: thing.data } : {}) };
      }

    }
    if (!isShare && (!thing || !Object.keys(thing).length)) {
      return fail(400, 'Thingtime posts need a thing with at least one field 🌀');
    }
  }

	if (!isShare && type === 'text' && !text && !hasAnyAttachment) return fail(400, 'Say something first ✍️');
	if (!isShare && type === 'image' && !images.length && !hasVisualAttachment) {
		return fail(400, 'Image posts need at least one image or video attachment');
	}

	const layout = sanitizeMediaLayout(input.mediaLayout);
	if (layout.ok === false) return layout;

	// Subspace vocabulary (title / subspaceId / flairId). Shape-only here — the
	// registry is pure; whether the author may post into that subspace with
	// that flair is decided by api/utils/subspaces/gate.ts on every write.
	// Empty/null values drop the key, so a PATCH with `title: ''` clears the
	// headline and `subspaceId: null` pulls the post out of its subspace.
	if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') {
		return fail(400, 'title must be a string');
	}
	const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
	if (title.length > MAX_POST_TITLE_CHARS) return fail(400, `Post title is too long (max ${MAX_POST_TITLE_CHARS})`);
	let subspaceId: string | null = null;
	if (input.subspaceId !== undefined && input.subspaceId !== null && input.subspaceId !== '') {
		if (typeof input.subspaceId !== 'string' || !SUBSPACE_REF_PATTERN.test(input.subspaceId.trim())) {
			return fail(400, 'subspaceId must be a subspace id');
		}
		subspaceId = input.subspaceId.trim();
	}
	let flairId: string | null = null;
	if (input.flairId !== undefined && input.flairId !== null && input.flairId !== '') {
		if (typeof input.flairId !== 'string' || !SUBSPACE_FLAIR_ID_PATTERN.test(input.flairId.trim())) {
			return fail(400, 'flairId must be a flair id');
		}
		flairId = input.flairId.trim();
	}
	if (flairId && !subspaceId) return fail(400, 'Flairs belong to subspace posts — set subspaceId too');

	return {
		ok: true,
		crystal: {
			type,
			text,
			...(richTextProvided ? { richText } : {}),
			images,
			listing,
			thing,
			...(layout.mediaLayout ? { mediaLayout: layout.mediaLayout } : {}),
			...(title ? { title } : {}),
			...(subspaceId ? { subspaceId } : {}),
			...(flairId ? { flairId } : {})
		}
	};
};

const sanitizeCommentCrystal = (input: Record<string, unknown>, ids?: string[]): { ok: true; crystal: Record<string, unknown> } | Fail => {
  // Rich comments are ["post","comment"] things — the post sanitizer owns the
  // whole crystal there (its own text/image/listing rules apply, so an
  // image-only comment is legal the same way an image-only post is).
  if (ids?.includes('post')) return { ok: true, crystal: {} };
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

// Single source for the search grammar's root fields + datatypes, shared by the
// server compiler (things/search.ts) AND the client query builder (Search
// components) so the two can't drift — a root field the server searches but the
// client never suggests (shareId was exactly this) is the drift this prevents.
// Root fields are searchable by bare name; anything else auto-prefixes to crystal.
export const SEARCHABLE_ROOT_FIELDS = ['tags', 'thingtime', 'createdAt', 'updatedAt', 'shareId', 'targetId', 'folderId'] as const;
// Friendly datatype names offered by the `type` operator (mapped to Mongo $type
// aliases server-side — 'boolean' → 'bool', the rest are identity).
export const SEARCH_DATATYPES = ['string', 'number', 'boolean', 'date', 'array', 'object', 'null'] as const;

// Free-form data crystals: any JSON, bounded and key-validated. The walk fails
// loudly (never silently drops) so writers know exactly what didn't fit.
const DATA_KEY_PATTERN = KEY_SEGMENT_PATTERN;

// Prototype-chain accessors match DATA_KEY_PATTERN (letters/underscores) but
// `out[key] = value` on them mutates the prototype instead of creating an own
// property, so the value is silently dropped — a contract violation. Reject them
// loudly. Shared with the render-tree sanitizer below.
const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Iterative walk — an explicit work stack instead of recursion, so nesting
// depth never touches the JS call stack and needs no rail. Cycle safety is
// identity: any object/array seen twice (circular OR merely repeated) fails
// loudly. LIFO + reversed pushes keeps document order, so the first failure
// reported matches what the old recursive walk would have said.
type DataWalkItem = {
  value: unknown;
  path: string;
  depth: number; // containers only — checked against MongoDB's storable limit
  key?: string; // object entry key, validated when this item is processed
  assign: (out: unknown) => void;
};

const sanitizeDataValue = (
  input: unknown,
  // where the walked root actually lives relative to the stored crystal —
  // crystal.thing payloads sit one level deeper, so their storable nesting
  // budget is one less and their error paths carry the prefix
  base?: { path: string; depth: number }
): { ok: true; value: unknown } | Fail => {
  let rootOut: unknown;
  let nodes = 0;
  const seen = new WeakSet<object>();
  const stack: DataWalkItem[] = [
    {
      value: input,
      path: base?.path ?? '',
      depth: base?.depth ?? 1,
      assign: (out) => {
        rootOut = out;
      }
    }
  ];
  while (stack.length) {
    const item = stack.pop()!;
    const { value, path, depth } = item;
    if (item.key !== undefined) {
      if (item.key.length > MAX_DATA_KEY_CHARS || !DATA_KEY_PATTERN.test(item.key)) {
        return fail(400, `Data keys are letters/numbers/_/- up to ${MAX_DATA_KEY_CHARS} chars (got ${item.key.slice(0, 80)})`);
      }
      if (PROTOTYPE_POLLUTION_KEYS.has(item.key)) {
        return fail(400, `Data keys cannot be prototype accessors (got ${item.key})`);
      }
    }
    nodes += 1;
    if (nodes > MAX_DATA_CRYSTAL_NODES) {
      return fail(400, `Data crystals can hold at most ${MAX_DATA_CRYSTAL_NODES} values`);
    }
    if (value === null || typeof value === 'boolean') {
      item.assign(value);
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return fail(400, `Data numbers must be finite (${path})`);
      item.assign(value);
      continue;
    }
    if (typeof value === 'string') {
      item.assign(value);
      continue;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) return fail(400, `Data can’t hold circular or repeated object references (${path || 'root'})`);
      seen.add(value);
      if (depth > MAX_STORABLE_NESTING) {
        return fail(400, `MongoDB can store at most ${MAX_STORABLE_NESTING} nested levels per crystal (${path || 'root'})`);
      }
      if (value.length > MAX_DATA_ARRAY_ITEMS) return fail(400, `Data arrays cap at ${MAX_DATA_ARRAY_ITEMS} items (${path})`);
      const out: unknown[] = new Array(value.length);
      item.assign(out);
      for (let index = value.length - 1; index >= 0; index--) {
        const slot = index;
        stack.push({
          value: value[slot],
          path: `${path}[${slot}]`,
          depth: depth + 1,
          assign: (child) => {
            out[slot] = child;
          }
        });
      }
      continue;
    }
    if (typeof value === 'object') {
      if (seen.has(value as object)) return fail(400, `Data can’t hold circular or repeated object references (${path || 'root'})`);
      seen.add(value as object);
      if (depth > MAX_STORABLE_NESTING) {
        return fail(400, `MongoDB can store at most ${MAX_STORABLE_NESTING} nested levels per crystal (${path || 'root'})`);
      }
      const out: Record<string, unknown> = {};
      item.assign(out);
      const entries = Object.entries(value as Record<string, unknown>);
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, entry] = entries[index];
        stack.push({
          value: entry,
          path: path ? `${path}.${key}` : key,
          depth: depth + 1,
          key,
          assign: (child) => {
            out[key] = child;
          }
        });
      }
      continue;
    }
    return fail(400, `Data values must be JSON (${path})`);
  }
  return { ok: true, value: rootOut };
};

// Data crystals reserve NO field names: relationship dedupe (followKey,
// memberKey, dmKey, inviteCode, emojiKey, friendKey, voteKey …) rides the
// server-only root uniqueKeys namespace (api/utils/messenger/shared.ts +
// the uniqueKeys index in collections.ts), never crystal-path unique
// indexes, so a data thing carrying any of those names at its crystal root
// is ordinary user data — it enters no unique index and can collide with
// nothing. Keep it that way: a new unique index over a crystal path would
// reopen the squat class the uniqueKeys migration closed (see
// KIND-BLIND history in collections.ts).
const sanitizeDataCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const sanitized = sanitizeDataValue(input);
	if (sanitized.ok === false) return sanitized;
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
// EXTENDED_RESERVED_KEY) live with the other caps up top; depth has no
// validator rail — only MongoDB's storable-nesting bound applies.

// Keys-only walk: values pass through verbatim, but a key that would corrupt
// storage (BSON null byte, the text-index override) fails loudly. Iterative
// (explicit stack) so nesting never touches the JS call stack, with an
// identity WeakSet against circular/repeated references — belt-and-braces
// here, since sanitizeExtended's JSON.stringify already rejects true cycles.
// Never mutates or drops — extended is stored exactly as given.
const checkExtendedKeys = (root: unknown): true | Fail => {
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value: root, path: '', depth: 1 }];
  while (stack.length) {
    const { value, path, depth } = stack.pop()!;
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) return fail(400, `extended can’t hold circular or repeated object references (${path || 'root'})`);
    seen.add(value);
    if (depth > MAX_STORABLE_NESTING) {
      return fail(400, `MongoDB can store at most ${MAX_STORABLE_NESTING} nested levels in extended (${path || 'root'})`);
    }
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ value: value[index], path: `${path}[${index}]`, depth: depth + 1 });
      }
      continue;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key] of entries) {
      if (key.includes('\u0000')) return fail(400, 'extended keys can’t contain null bytes');
      if (key === EXTENDED_RESERVED_KEY) {
        return fail(400, `extended can’t use the reserved key ${EXTENDED_RESERVED_KEY}`);
      }
    }
    for (let index = entries.length - 1; index >= 0; index--) {
      const [key, entry] = entries[index];
      stack.push({ value: entry, path: path ? `${path}.${key}` : key, depth: depth + 1 });
    }
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
  const keys = checkExtendedKeys(value);
  if (keys !== true) return keys;
  return { ok: true, value };
};

// Schema-thing field names double as crystal paths in the search builder
// (crystal.<name>). A name is ONE path segment — nesting is expressed via
// `children`/`items`, never dots — so a schema tree bounded by
// MAX_SCHEMA_FIELD_DEPTH can never flatten to a dotted path deeper than the
// search grammar's MAX_FIELD_DEPTH or a crystal deeper than MongoDB can
// store. Exported so the builtin-schema seed migration maps
// registry fields onto the exact same grammar sanitizeSchemaCrystal enforces
// on user-authored schema things.
export const SCHEMA_FIELD_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const MAX_SCHEMA_FIELD_NAME_CHARS = 60;
export const MAX_SCHEMA_FIELD_DESCRIPTION_CHARS = 200;

// top-level crystal keys that tag data things with their schema — a schema
// field by either name could never round-trip. Exported so the builder's
// inline validation and the server sanitizer share one list (lowercased for
// case-insensitive comparison).
export const SCHEMA_RESERVED_TOP_LEVEL_FIELD_NAMES: ReadonlySet<string> = new Set(['schema', 'schemaid']);

// ---------------------------------------------------------------------------
// Builtin-schema projection: maps a code-registry crystal schema onto the
// schema-thing grammar sanitizeSchemaCrystal enforces, so the seed migration
// can publish builtin mirrors through validateThingtimeCrystal(['schema'], …)
// — the SAME write gate every user-published schema passes. Lives here, next
// to the grammar it must stay congruent with; the colocated
// builtinSchemaProjection.test.ts pins that congruence so registry/grammar
// drift fails a test instead of seeding an invalid thing.
//
// Open 'record' and opaque 'object' fields become bounded 'json' fields so
// copies retain crystals, program payloads, rich text and other open structures.
// Deliberately dropped names:
// - reserved top-level names ('schema'/'schemaid' — data's convention field IS
//   the tagging namespace the reservation protects)
// - names outside the field grammar (the '*' catch-all)
// 'id' fields project as 'string' (ids are strings on the wire). Everything
// else carries through: required, enum values, number min/max, string
// maxLength / string[] maxItems (registry `max`), object children (recursed).
// An object without projectable children remains available as bounded JSON.
const projectBuiltinField = (field: ThingtimeSchemaField, depth: number): Record<string, unknown> | null => {
  const type = field.type === 'id' ? 'string' : field.type === 'record' ? 'json' : field.type;
  if (!(SCHEMA_FIELD_TYPES as readonly string[]).includes(type)) return null;
  if (field.name.length > MAX_SCHEMA_FIELD_NAME_CHARS || !SCHEMA_FIELD_NAME_PATTERN.test(field.name)) return null;
  if (depth === 1 && SCHEMA_RESERVED_TOP_LEVEL_FIELD_NAMES.has(field.name.toLowerCase())) return null;
  const out: Record<string, unknown> = { name: field.name, type };
  if (field.description) out.description = field.description.slice(0, MAX_SCHEMA_FIELD_DESCRIPTION_CHARS);
  if (field.required) out.required = true;
  if (type === 'enum' && Array.isArray(field.values) && field.values.length) out.values = [...field.values];
  if (type === 'number') {
    if (typeof field.min === 'number') out.min = field.min;
    if (typeof field.max === 'number') out.max = field.max;
  }
  // `max` maps onto the grammar's constraints only in their default units —
  // a declared non-default maxUnit (reaction.emoji counts emoji, not chars)
  // would publish a machine-readable cap that rejects legal values
  const maxInDefaultUnit = typeof field.max === 'number' && !field.maxUnit;
  if (type === 'string' && maxInDefaultUnit) out.maxLength = field.max;
  if ((type === 'string[]' || type === 'array') && maxInDefaultUnit) out.maxItems = field.max;
  if (type === 'object' || type === 'array') {
    const children = (field.children || [])
      .map((child) => projectBuiltinField(child, depth + 1))
      .filter((child): child is Record<string, unknown> => child !== null);
    if (type === 'array') out.items = children.length ? { type: 'object', children } : { type: 'json' };
    else if (children.length) out.children = children;
    else out.type = 'json';
  }
  return out;
};

export const projectBuiltinSchemaCrystal = (schema: ThingtimeSchema): Record<string, unknown> => ({
  name: schema.title,
  description: schema.summary,
  fields: schema.fields.map((field) => projectBuiltinField(field, 1)).filter((field): field is Record<string, unknown> => field !== null),
  ...(schema.render ? { render: structuredClone(schema.render) } : {})
});

// whole-number constraint (maxLength/minItems/maxItems); fail-loudly on junk
const sanitizeCountConstraint = (raw: unknown, label: string, ceiling: number): { ok: true; value: number | null } | Fail => {
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
    if (['__proto__', 'prototype', 'constructor'].includes(fieldName.toLowerCase())) return fail(400, `Unsafe schema field name: ${fieldName}`);
    if (depth === 1 && SCHEMA_RESERVED_TOP_LEVEL_FIELD_NAMES.has(fieldName.toLowerCase())) {
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
  path: string,
  // top-level only: zero-field marker schemas are legal (share/save/waitlist —
  // "this thing IS the payload"), so the builtin seed validates through the
  // exact same grammar as user publishes. Nested children keep the >=1 rule: a
  // childless object node is meaningless.
  allowEmpty = false
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
  if (!fields.length && !allowEmpty) return fail(400, `Schemas need at least one field (${path})`);
  return { ok: true, fields };
};

// The optional serialised component preview a schema can carry: a chakra tree
// ({ type: 'chakra', chakra: 'Box', props, children }) or an element tree
// ({ tag: 'div', props, children }). This bounds shape/size and storage-safe
// keys only — SAFETY lives client-side, where render trees are only ever
// drawn through the sanitising allowlist gates (ChakraThingRenderer /
// HtmlThingRenderer), never the legacy unsanitised chakra path.
const SCHEMA_RENDER_BLOCKED_KEYS = PROTOTYPE_POLLUTION_KEYS;

const checkSchemaRenderTree = (value: unknown, depth: number, counter: { nodes: number }): true | Fail => {
  counter.nodes++;
  if (counter.nodes > MAX_SCHEMA_RENDER_NODES) {
    return fail(400, `render can hold at most ${MAX_SCHEMA_RENDER_NODES} nodes`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (depth >= MAX_SCHEMA_RENDER_DEPTH) return fail(400, `render nests at most ${MAX_SCHEMA_RENDER_DEPTH} levels`);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const checked = checkSchemaRenderTree(entry, depth + 1, counter);
      if (checked !== true) return checked;
    }
    return true;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key.includes('\u0000') || key.includes('.') || key.startsWith('$') || SCHEMA_RENDER_BLOCKED_KEYS.has(key)) {
        return fail(400, `render keys can’t contain dots or null bytes, start with $, or shadow object internals (${key.slice(0, 40)})`);
      }
      const checked = checkSchemaRenderTree(entry, depth + 1, counter);
      if (checked !== true) return checked;
    }
    return true;
  }
  return fail(400, 'render must be JSON-serializable (objects, arrays, strings, numbers, booleans)');
};

const sanitizeSchemaRender = (input: unknown): { ok: true; render: Record<string, unknown> } | Fail => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail(400, 'render must be a serialised component object');
  }
  const root = input as Record<string, unknown>;
  const chakraShaped = typeof root.chakra === 'string' || root.type === 'chakra';
  const elementShaped = typeof root.tag === 'string';
  if (!chakraShaped && !elementShaped) {
    return fail(400, 'render must be chakra shaped ({ chakra: "Box", … }) or element shaped ({ tag: "div", … })');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return fail(400, 'render must be JSON-serializable');
  }
  if (typeof serialized !== 'string') return fail(400, 'render must be JSON-serializable');
  // same UTF-16 code-unit byte-cap shortcut sanitizeExtended uses
  if (serialized.length > MAX_SCHEMA_RENDER_BYTES) {
    return fail(400, `render exceeds the ${MAX_SCHEMA_RENDER_BYTES} byte limit`);
  }
  if (serialized.length * 3 > MAX_SCHEMA_RENDER_BYTES) {
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > MAX_SCHEMA_RENDER_BYTES) {
      return fail(400, `render exceeds the ${MAX_SCHEMA_RENDER_BYTES} byte limit`);
    }
  }
  const checked = checkSchemaRenderTree(input, 0, { nodes: 0 });
  if (checked !== true) return checked;
  return { ok: true, render: root };
};

const sanitizeSchemaCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return fail(400, 'Schemas need a name');
  if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Schema name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);

  const description = typeof input.description === 'string' ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : '';

  const sanitized = sanitizeSchemaFieldList(input.fields, 1, { nodes: 0 }, 'fields', true);
  if (isFail(sanitized)) return sanitized;

  const crystal: Record<string, unknown> = { name, description, fields: sanitized.fields };

  // fork provenance: a bare thing id, never resolved or trusted on write
  if (input.forkOf !== undefined && input.forkOf !== null && input.forkOf !== '') {
    const forkOf = typeof input.forkOf === 'string' ? input.forkOf.trim() : '';
    if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, 'forkOf must be a thing id');
    crystal.forkOf = forkOf;
  }

  // optional serialised component preview — bounded here, sanitised on render
  if (input.render !== undefined && input.render !== null) {
    const render = sanitizeSchemaRender(input.render);
    if (isFail(render)) return render;
    crystal.render = render.render;
  }

  return { ok: true, crystal };
};

// Component things: bounded arg descriptors + a required render template.
// Template wrapper objects (ttArg/ttMap/ttIf/ttMerge/ttRepeat) are plain keys,
// so the shared render tree check ($-key/proto guards, node/depth/byte caps)
// applies unchanged; token resolution and draw-time safety live client-side.

const sanitizeComponentArgScalar = (value: unknown, cap: number): string | number | boolean | null => {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') return value.slice(0, cap);
	return null;
};

const sanitizeComponentArgs = (input: unknown): { ok: true; args: Record<string, unknown>[] } | Fail => {
	if (!Array.isArray(input)) return fail(400, 'Component args must be a list of arg descriptors');
	if (input.length > MAX_COMPONENT_ARGS) return fail(400, `Components can declare at most ${MAX_COMPONENT_ARGS} args`);
	const args: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	for (const entry of input) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(400, 'Each component arg must be an object');
		const raw = entry as Record<string, unknown>;
		const name = typeof raw.name === 'string' ? raw.name.trim() : '';
		if (!name || name.length > MAX_COMPONENT_ARG_NAME_CHARS || !COMPONENT_ARG_NAME_PATTERN.test(name)) {
			return fail(400, `Component arg names must match ${COMPONENT_ARG_NAME_PATTERN} (got "${String(raw.name).slice(0, 40)}")`);
		}
		const lower = name.toLowerCase();
		if (seen.has(lower)) return fail(400, `Duplicate component arg: ${name}`);
		seen.add(lower);
		const type = typeof raw.type === 'string' ? raw.type : '';
		if (!(COMPONENT_ARG_TYPES as readonly string[]).includes(type)) {
			return fail(400, `Component arg ${name} has an unknown type (expected ${COMPONENT_ARG_TYPES.join('/')})`);
		}
		const arg: Record<string, unknown> = { name, type };
		if (typeof raw.label === 'string' && raw.label.trim()) arg.label = raw.label.trim().slice(0, MAX_COMPONENT_ARG_LABEL_CHARS);
		if (typeof raw.description === 'string' && raw.description.trim()) {
			arg.description = raw.description.trim().slice(0, MAX_COMPONENT_ARG_DESCRIPTION_CHARS);
		}
		if (type === 'enum') {
			if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > MAX_SCHEMA_ENUM_VALUES) {
				return fail(400, `Enum arg ${name} needs 1–${MAX_SCHEMA_ENUM_VALUES} values`);
			}
			const values: string[] = [];
			for (const value of raw.values) {
				if (typeof value !== 'string' || !value.trim() || value.length > MAX_SCHEMA_ENUM_VALUE_CHARS) {
					return fail(400, `Enum arg ${name} has an invalid value`);
				}
				if (!values.includes(value)) values.push(value);
			}
			arg.values = values;
		}
		if (raw.default !== undefined) {
			const fallback = sanitizeComponentArgScalar(raw.default, MAX_COMPONENT_ARG_DEFAULT_CHARS);
			if (fallback === null && raw.default !== null) return fail(400, `Arg ${name} default must be a string, number, or boolean`);
			if (fallback !== null) arg.default = fallback;
		}
		if (typeof raw.min === 'number' && Number.isFinite(raw.min)) arg.min = raw.min;
		if (typeof raw.max === 'number' && Number.isFinite(raw.max)) arg.max = raw.max;
		if (typeof raw.maxLength === 'number' && Number.isFinite(raw.maxLength)) {
			arg.maxLength = Math.max(1, Math.min(Math.round(raw.maxLength), MAX_TEXT_CHARS));
		}
		args.push(arg);
	}
	return { ok: true, args };
};

const sanitizeComponentCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name) return fail(400, 'Components need a name');
	if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Component name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);

	const crystal: Record<string, unknown> = { name };

	const description = typeof input.description === 'string' ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : '';
	if (description) crystal.description = description;

	const library = typeof input.library === 'string' ? input.library.trim() : '';
	crystal.library = (COMPONENT_LIBRARIES as readonly string[]).includes(library) ? library : 'custom';

	const category = typeof input.category === 'string' ? input.category.trim().slice(0, MAX_COMPONENT_CATEGORY_CHARS) : '';
	crystal.category = category || 'general';

	if (input.componentKey !== undefined && input.componentKey !== null && input.componentKey !== '') {
		const componentKey = typeof input.componentKey === 'string' ? input.componentKey.trim() : '';
		if (!componentKey || componentKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(componentKey)) {
			return fail(400, 'componentKey must be a lowercase-dashed slug');
		}
		crystal.componentKey = componentKey;
	}

	// familyKey groups the library renditions (designs) of one functional
	// component — /components collapses a family into one card
	if (input.familyKey !== undefined && input.familyKey !== null && input.familyKey !== '') {
		const familyKey = typeof input.familyKey === 'string' ? input.familyKey.trim() : '';
		if (!familyKey || familyKey.length > MAX_COMPONENT_KEY_CHARS || !COMPONENT_KEY_PATTERN.test(familyKey)) {
			return fail(400, 'familyKey must be a lowercase-dashed slug');
		}
		crystal.familyKey = familyKey;
	}

	if (input.version !== undefined && input.version !== null) {
		const version = Number(input.version);
		if (!Number.isInteger(version) || version < 1 || version > 999999) return fail(400, 'version must be a positive integer');
		crystal.version = version;
	}

	if (input.forkOf !== undefined && input.forkOf !== null && input.forkOf !== '') {
		const forkOf = typeof input.forkOf === 'string' ? input.forkOf.trim() : '';
		if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, 'forkOf must be a thing id');
		crystal.forkOf = forkOf;
	}

	if (input.previewBg !== undefined && input.previewBg !== null && input.previewBg !== '') {
		const previewBg = typeof input.previewBg === 'string' ? input.previewBg.trim() : '';
		if (!previewBg || previewBg.length > MAX_COMPONENT_PREVIEW_BG_CHARS || /[<>]|javascript:/i.test(previewBg)) {
			return fail(400, 'previewBg must be a short CSS background value');
		}
		crystal.previewBg = previewBg;
	}

	if (input.args !== undefined && input.args !== null) {
		const args = sanitizeComponentArgs(input.args);
		if (isFail(args)) return args;
		if (args.args.length) crystal.args = args.args;
	}

	if (input.savedArgs !== undefined && input.savedArgs !== null) {
		if (typeof input.savedArgs !== 'object' || Array.isArray(input.savedArgs)) {
			return fail(400, 'savedArgs must be an object of scalar arg values');
		}
		const savedArgs: Record<string, unknown> = {};
		const entries = Object.entries(input.savedArgs as Record<string, unknown>);
		if (entries.length > MAX_COMPONENT_SAVED_ARGS) return fail(400, `savedArgs can hold at most ${MAX_COMPONENT_SAVED_ARGS} entries`);
		for (const [key, value] of entries) {
			if (!COMPONENT_ARG_NAME_PATTERN.test(key) || key.length > MAX_COMPONENT_ARG_NAME_CHARS) {
				return fail(400, `savedArgs key "${key.slice(0, 40)}" is not a valid arg name`);
			}
			const scalar = sanitizeComponentArgScalar(value, MAX_COMPONENT_SAVED_ARG_CHARS);
			if (scalar === null && value !== null) return fail(400, `savedArgs.${key} must be a string, number, or boolean`);
			if (scalar !== null) savedArgs[key] = scalar;
		}
		if (Object.keys(savedArgs).length) crystal.savedArgs = savedArgs;
	}

	if (input.render === undefined || input.render === null) {
		return fail(400, 'Components need a render template ({ tag: "div", … })');
	}
	const render = sanitizeSchemaRender(input.render);
	if (isFail(render)) return render;
	crystal.render = render.render;

	return { ok: true, crystal };
};

// ---------------------------------------------------------------------------
// Action grammar — the save-time half of the bounded-execution contract.
// Pure and shared: the executor (api/utils/actions/) re-uses the ref parser
// and limit tables, the /actions inspector derives its effect summary from
// the same steps the executor runs, and this sanitizer guarantees that any
// action that SAVES also DECLARES (every step must be covered by a declared
// capability). References are whole-value string substitutions, never
// evaluation; "$$" escapes a literal leading dollar.

const ACTION_REF_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION_BANNED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const ACTION_STEP_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const MAX_ACTION_REF_PATH_SEGMENTS = 6;

export type ActionRef =
	| { kind: 'input'; name: string }
	| { kind: 'step'; step: number; path: string[] }
	| { kind: 'now' };

// Parse a whole-value reference string ("$input.name", "$step.1.id", "$now").
// Returns null when the string is not a reference (plain literal data) and
// Fail when it LOOKS like a reference but is malformed — a typo'd ref that
// silently became a literal would be a debugging trap.
export const parseActionRef = (value: string): ActionRef | null | Fail => {
	if (!value.startsWith('$') || value.startsWith('$$')) return null;
	if (value === '$now') return { kind: 'now' };
	const parts = value.slice(1).split('.');
	if (parts[0] === 'input') {
		if (parts.length !== 2 || !COMPONENT_ARG_NAME_PATTERN.test(parts[1])) {
			return fail(400, `Invalid input reference "${value.slice(0, 80)}" (expected $input.<name>)`);
		}
		return { kind: 'input', name: parts[1] };
	}
	if (parts[0] === 'step') {
		const step = Number(parts[1]);
		if (!Number.isInteger(step) || step < 1 || step > MAX_ACTION_STEPS) {
			return fail(400, `Invalid step reference "${value.slice(0, 80)}" (expected $step.<n> with n 1–${MAX_ACTION_STEPS})`);
		}
		const path = parts.slice(2);
		if (path.length > MAX_ACTION_REF_PATH_SEGMENTS) return fail(400, `Step reference path is too deep "${value.slice(0, 80)}"`);
		for (const segment of path) {
			if (!ACTION_REF_SEGMENT_PATTERN.test(segment) || ACTION_BANNED_SEGMENTS.has(segment)) {
				return fail(400, `Invalid step reference segment in "${value.slice(0, 80)}"`);
			}
		}
		return { kind: 'step', step, path };
	}
	return fail(400, `Unknown reference root "${value.slice(0, 80)}" (expected $input, $step, or $now)`);
};

// Validate one step-value tree: literal JSON, whole-value refs, or
// { ttConcat: [...] } string composition. stepIndex is 1-based; refs may only
// point at EARLIER steps so the program is executable top to bottom.
const validateActionValue = (value: unknown, stepIndex: number, depth = 0): Fail | { ok: true } => {
	if (depth > MAX_ACTION_STEP_VALUE_DEPTH) return fail(400, `Step ${stepIndex} values nest too deeply (max ${MAX_ACTION_STEP_VALUE_DEPTH})`);
	if (value === null || typeof value === 'boolean') return { ok: true };
	if (typeof value === 'number') {
		return Number.isFinite(value) ? { ok: true } : fail(400, `Step ${stepIndex} numbers must be finite`);
	}
	if (typeof value === 'string') {
		if (value.length > MAX_ACTION_STEP_STRING_CHARS) {
			return fail(400, `Step ${stepIndex} strings cap at ${MAX_ACTION_STEP_STRING_CHARS} characters`);
		}
		const ref = parseActionRef(value);
		// discriminate on 'kind': plain literals come back null (never a Fail)
		if (ref && !('kind' in ref)) return ref;
		if (ref && 'kind' in ref && ref.kind === 'step' && ref.step >= stepIndex) {
			return fail(400, `Step ${stepIndex} references $step.${ref.step} before it has run`);
		}
		return { ok: true };
	}
	if (typeof value !== 'object') return fail(400, `Step ${stepIndex} values must be JSON data`);
	if (Array.isArray(value)) {
		if (value.length > MAX_ACTION_STEP_VALUE_KEYS) return fail(400, `Step ${stepIndex} lists cap at ${MAX_ACTION_STEP_VALUE_KEYS} entries`);
		for (const entry of value) {
			const checked = validateActionValue(entry, stepIndex, depth + 1);
			if (isFail(checked)) return checked;
		}
		return { ok: true };
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (keys.length === 1 && keys[0] === 'ttConcat') {
		if (!Array.isArray(record.ttConcat) || !record.ttConcat.length || record.ttConcat.length > MAX_ACTION_CONCAT_PARTS) {
			return fail(400, `ttConcat needs 1–${MAX_ACTION_CONCAT_PARTS} parts`);
		}
		for (const part of record.ttConcat) {
			if (typeof part !== 'string' && typeof part !== 'number' && typeof part !== 'boolean') {
				return fail(400, 'ttConcat parts must be strings, numbers, booleans, or refs');
			}
			const checked = validateActionValue(part, stepIndex, depth + 1);
			if (isFail(checked)) return checked;
		}
		return { ok: true };
	}
	if (keys.length > MAX_ACTION_STEP_VALUE_KEYS) return fail(400, `Step ${stepIndex} objects cap at ${MAX_ACTION_STEP_VALUE_KEYS} keys`);
	for (const key of keys) {
		if (!ACTION_STEP_KEY_PATTERN.test(key) || ACTION_BANNED_SEGMENTS.has(key)) {
			return fail(400, `Step ${stepIndex} has an invalid key "${key.slice(0, 64)}"`);
		}
		const checked = validateActionValue(record[key], stepIndex, depth + 1);
		if (isFail(checked)) return checked;
	}
	return { ok: true };
};

const sanitizeActionSchemaRef = (value: unknown, label: string): Fail | { ok: true; ref: string } => {
	const ref = typeof value === 'string' ? value.trim() : '';
	if (!ref || ref.length > MAX_ACTION_SCHEMA_REF_CHARS || /[$\s]/.test(ref)) {
		return fail(400, `${label} must be a schema id or name (max ${MAX_ACTION_SCHEMA_REF_CHARS} chars, no $ or spaces)`);
	}
	return { ok: true, ref };
};

const sanitizeActionInputs = (input: unknown): Fail | { ok: true; inputs: Record<string, unknown>[] } => {
	if (!Array.isArray(input)) return fail(400, 'Action inputs must be a list of input descriptors');
	if (input.length > MAX_ACTION_INPUTS) return fail(400, `Actions can declare at most ${MAX_ACTION_INPUTS} inputs`);
	const inputs: Record<string, unknown>[] = [];
	const seen = new Set<string>();
	for (const entry of input) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(400, 'Each action input must be an object');
		const raw = entry as Record<string, unknown>;
		const name = typeof raw.name === 'string' ? raw.name.trim() : '';
		if (!name || name.length > MAX_COMPONENT_ARG_NAME_CHARS || !COMPONENT_ARG_NAME_PATTERN.test(name)) {
			return fail(400, `Action input names must match ${COMPONENT_ARG_NAME_PATTERN} (got "${String(raw.name).slice(0, 40)}")`);
		}
		const lower = name.toLowerCase();
		if (seen.has(lower)) return fail(400, `Duplicate action input: ${name}`);
		seen.add(lower);
		const type = typeof raw.type === 'string' ? raw.type : '';
		if (!(ACTION_INPUT_TYPES as readonly string[]).includes(type)) {
			return fail(400, `Action input ${name} has an unknown type (expected ${ACTION_INPUT_TYPES.join('/')})`);
		}
		const descriptor: Record<string, unknown> = { name, type };
		if (raw.required === true) descriptor.required = true;
		if (typeof raw.label === 'string' && raw.label.trim()) descriptor.label = raw.label.trim().slice(0, MAX_COMPONENT_ARG_LABEL_CHARS);
		if (typeof raw.description === 'string' && raw.description.trim()) {
			descriptor.description = raw.description.trim().slice(0, MAX_COMPONENT_ARG_DESCRIPTION_CHARS);
		}
		if (type === 'enum') {
			if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > MAX_SCHEMA_ENUM_VALUES) {
				return fail(400, `Enum input ${name} needs 1–${MAX_SCHEMA_ENUM_VALUES} values`);
			}
			const values: string[] = [];
			for (const value of raw.values) {
				if (typeof value !== 'string' || !value.trim() || value.length > MAX_SCHEMA_ENUM_VALUE_CHARS) {
					return fail(400, `Enum input ${name} has an invalid value`);
				}
				if (!values.includes(value)) values.push(value);
			}
			descriptor.values = values;
		}
		if (raw.default !== undefined) {
			const fallback = sanitizeComponentArgScalar(raw.default, MAX_COMPONENT_ARG_DEFAULT_CHARS);
			if (fallback === null && raw.default !== null) return fail(400, `Input ${name} default must be a string, number, or boolean`);
			if (fallback !== null) {
				// Defaults must be congruent with the declared type: the executor
				// substitutes them verbatim when the input is omitted, so an
				// incongruent default would make every default-using run fail
				// input validation instead of failing here, at save time.
				if ((type === 'string' || type === 'text') && typeof fallback !== 'string') {
					return fail(400, `Input ${name} default must be text to match its ${type} type`);
				}
				if (type === 'number' && typeof fallback !== 'number') {
					return fail(400, `Input ${name} default must be a number to match its number type`);
				}
				if (type === 'boolean' && typeof fallback !== 'boolean') {
					return fail(400, `Input ${name} default must be true or false to match its boolean type`);
				}
				if (type === 'enum' && (typeof fallback !== 'string' || !(descriptor.values as string[]).includes(fallback))) {
					return fail(400, `Input ${name} default must be one of its enum values`);
				}
				descriptor.default = fallback;
			}
		}
		if (typeof raw.min === 'number' && Number.isFinite(raw.min)) descriptor.min = raw.min;
		if (typeof raw.max === 'number' && Number.isFinite(raw.max)) descriptor.max = raw.max;
		if (typeof raw.maxLength === 'number' && Number.isFinite(raw.maxLength)) {
			descriptor.maxLength = Math.max(1, Math.min(Math.round(raw.maxLength), MAX_TEXT_CHARS));
		}
		inputs.push(descriptor);
	}
	return { ok: true, inputs };
};

export type ActionCapabilityEntry = { capability: string; schemas?: string[]; actions?: string[] };

const sanitizeActionCapabilities = (input: unknown): Fail | { ok: true; capabilities: ActionCapabilityEntry[] } => {
	if (!Array.isArray(input)) return fail(400, 'Action capabilities must be a list');
	if (input.length > MAX_ACTION_CAPABILITY_ENTRIES) {
		return fail(400, `Actions can declare at most ${MAX_ACTION_CAPABILITY_ENTRIES} capabilities`);
	}
	const capabilities: ActionCapabilityEntry[] = [];
	const seen = new Set<string>();
	for (const entry of input) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(400, 'Each capability must be an object');
		const raw = entry as Record<string, unknown>;
		const capability = typeof raw.capability === 'string' ? raw.capability.trim() : '';
		if (!(ACTION_CAPABILITIES as readonly string[]).includes(capability)) {
			return fail(400, `Unknown capability "${String(raw.capability).slice(0, 40)}" (expected ${ACTION_CAPABILITIES.join('/')})`);
		}
		if (seen.has(capability)) return fail(400, `Duplicate capability: ${capability}`);
		seen.add(capability);
		const sanitized: ActionCapabilityEntry = { capability };
		if (raw.schemas !== undefined && raw.schemas !== null) {
			if (!Array.isArray(raw.schemas) || raw.schemas.length > MAX_ACTION_CAPABILITY_SCOPES) {
				return fail(400, `Capability ${capability} scopes cap at ${MAX_ACTION_CAPABILITY_SCOPES} schemas`);
			}
			const schemas: string[] = [];
			for (const value of raw.schemas) {
				const ref = sanitizeActionSchemaRef(value, `Capability ${capability} schema scope`);
				if (isFail(ref)) return ref;
				if (!schemas.includes(ref.ref)) schemas.push(ref.ref);
			}
			if (schemas.length) sanitized.schemas = schemas;
		}
		if (raw.actions !== undefined && raw.actions !== null) {
			if (capability !== 'actions.invoke') return fail(400, `Only actions.invoke takes an actions allowlist`);
			if (!Array.isArray(raw.actions) || raw.actions.length > MAX_ACTION_CAPABILITY_SCOPES) {
				return fail(400, `actions.invoke allowlist caps at ${MAX_ACTION_CAPABILITY_SCOPES} entries`);
			}
			const actions: string[] = [];
			for (const value of raw.actions) {
				const ref = sanitizeActionSchemaRef(value, 'actions.invoke allowlist entry');
				if (isFail(ref)) return ref;
				if (!actions.includes(ref.ref)) actions.push(ref.ref);
			}
			if (actions.length) sanitized.actions = actions;
		}
		capabilities.push(sanitized);
	}
	return { ok: true, capabilities };
};

const sanitizeActionLimits = (input: unknown): Fail | { ok: true; limits: Record<string, number> } => {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'Action limits must be an object');
	const raw = input as Record<string, unknown>;
	const limits: Record<string, number> = {};
	for (const key of Object.keys(ACTION_LIMIT_CEILINGS) as (keyof typeof ACTION_LIMIT_CEILINGS)[]) {
		if (raw[key] === undefined || raw[key] === null) continue;
		const value = Number(raw[key]);
		if (!Number.isInteger(value) || value < 1) return fail(400, `Limit ${key} must be a positive integer`);
		limits[key] = Math.min(value, ACTION_LIMIT_CEILINGS[key]);
	}
	const unknown = Object.keys(raw).find((key) => !(key in ACTION_LIMIT_CEILINGS));
	if (unknown) return fail(400, `Unknown limit "${unknown.slice(0, 40)}"`);
	return { ok: true, limits };
};

export type ActionStep = Record<string, unknown> & { op: string };

// Step sanitizer + the capability-coverage cross-check. Returns the sanitized
// steps AND the capability each step needs, so sanitizeActionCrystal can
// refuse any program whose declared capabilities don't cover its behaviour.
const sanitizeActionSteps = (
	input: unknown,
	declared: ActionCapabilityEntry[]
): Fail | { ok: true; steps: ActionStep[] } => {
	if (!Array.isArray(input) || !input.length) return fail(400, 'Actions need a non-empty steps list');
	if (input.length > MAX_ACTION_STEPS) return fail(400, `Actions cap at ${MAX_ACTION_STEPS} steps`);
	const byCapability = new Map(declared.map((entry) => [entry.capability, entry]));
	const requireCapability = (stepIndex: number, capability: string, schemaRef?: string): Fail | null => {
		const entry = byCapability.get(capability);
		if (!entry) return fail(400, `Step ${stepIndex} needs the ${capability} capability declared`);
		if (schemaRef && entry.schemas && !entry.schemas.includes(schemaRef)) {
			return fail(400, `Step ${stepIndex} touches schema "${schemaRef}" but the ${capability} capability is scoped to ${entry.schemas.join(', ')}`);
		}
		return null;
	};
	const steps: ActionStep[] = [];
	for (let index = 0; index < input.length; index += 1) {
		const stepIndex = index + 1;
		const entry = input[index];
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return fail(400, `Step ${stepIndex} must be an object`);
		const raw = entry as Record<string, unknown>;
		const op = typeof raw.op === 'string' ? raw.op : '';
		if (!(ACTION_STEP_OPS as readonly string[]).includes(op)) {
			return fail(400, `Step ${stepIndex} has an unknown op "${String(raw.op).slice(0, 40)}" (the vocabulary is closed: ${ACTION_STEP_OPS.join(', ')})`);
		}
		if (op === 'return' && stepIndex !== input.length) return fail(400, 'return must be the last step');
		const step: ActionStep = { op };
		const checkValues = (value: unknown, field: string, required: boolean): Fail | null => {
			if (value === undefined || value === null) {
				return required ? fail(400, `Step ${stepIndex} (${op}) needs ${field}`) : null;
			}
			if (typeof value !== 'object' || Array.isArray(value)) return fail(400, `Step ${stepIndex} ${field} must be an object`);
			const checked = validateActionValue(value, stepIndex);
			if (isFail(checked)) return checked;
			step[field] = value;
			return null;
		};
		const checkRefString = (value: unknown, field: string): Fail | null => {
			if (typeof value !== 'string' || !value.trim()) return fail(400, `Step ${stepIndex} (${op}) needs ${field}`);
			const checked = validateActionValue(value.trim(), stepIndex);
			if (isFail(checked)) return checked;
			step[field] = value.trim();
			return null;
		};
		let failure: Fail | null = null;
		if (op === 'things.create') {
			const schema = sanitizeActionSchemaRef(raw.schema, `Step ${stepIndex} schema`);
			if (isFail(schema)) return schema;
			step.schema = schema.ref;
			failure = checkValues(raw.values, 'values', true) || requireCapability(stepIndex, 'things.create', schema.ref);
		} else if (op === 'things.get') {
			failure = checkRefString(raw.id, 'id') || requireCapability(stepIndex, 'things.read');
		} else if (op === 'things.search') {
			if (raw.schema !== undefined && raw.schema !== null) {
				const schema = sanitizeActionSchemaRef(raw.schema, `Step ${stepIndex} schema`);
				if (isFail(schema)) return schema;
				step.schema = schema.ref;
			}
			if (raw.limit !== undefined && raw.limit !== null) {
				const limit = Number(raw.limit);
				if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTION_SEARCH_LIMIT) {
					return fail(400, `Step ${stepIndex} limit must be 1–${MAX_ACTION_SEARCH_LIMIT}`);
				}
				step.limit = limit;
			}
			failure = requireCapability(stepIndex, 'things.read', typeof step.schema === 'string' ? step.schema : undefined);
		} else if (op === 'things.update') {
			failure =
				checkRefString(raw.id, 'id') ||
				checkValues(raw.values, 'values', true) ||
				requireCapability(stepIndex, 'things.update');
		} else if (op === 'actions.invoke') {
			const actionRef = sanitizeActionSchemaRef(raw.action, `Step ${stepIndex} action`);
			if (isFail(actionRef)) return actionRef;
			step.action = actionRef.ref;
			failure = checkValues(raw.inputs, 'inputs', false) || requireCapability(stepIndex, 'actions.invoke');
			if (!failure) {
				const invoke = byCapability.get('actions.invoke');
				if (invoke?.actions && !invoke.actions.includes(actionRef.ref)) {
					failure = fail(400, `Step ${stepIndex} invokes "${actionRef.ref}" but the actions.invoke allowlist is ${invoke.actions.join(', ')}`);
				}
			}
		} else if (op === 'return') {
			if (raw.value === undefined) return fail(400, `Step ${stepIndex} (return) needs value`);
			const checked = validateActionValue(raw.value, stepIndex);
			if (isFail(checked)) return checked;
			step.value = raw.value;
		}
		if (failure) return failure;
		steps.push(step);
	}
	return { ok: true, steps };
};

// Derive the inspectable effect summary from the program itself — the UI
// renders THIS, never an author-written claim, so the display can't drift
// from the behaviour.
export type ActionEffects = {
	creates: string[];
	reads: string[];
	updates: boolean;
	invokes: string[];
	returns: boolean;
};

export const deriveActionEffects = (steps: unknown): ActionEffects => {
	const effects: ActionEffects = { creates: [], reads: [], updates: false, invokes: [], returns: false };
	if (!Array.isArray(steps)) return effects;
	for (const entry of steps) {
		if (!entry || typeof entry !== 'object') continue;
		const step = entry as Record<string, unknown>;
		const schema = typeof step.schema === 'string' ? step.schema : null;
		if (step.op === 'things.create' && schema && !effects.creates.includes(schema)) effects.creates.push(schema);
		if ((step.op === 'things.get' || step.op === 'things.search') && schema && !effects.reads.includes(schema)) effects.reads.push(schema);
		// an UNSCOPED get or search is the broadest read in the vocabulary —
		// it must surface as the '*' ("reads things") effect, never as nothing
		if ((step.op === 'things.get' || step.op === 'things.search') && !schema && !effects.reads.includes('*')) effects.reads.push('*');
		if (step.op === 'things.update') effects.updates = true;
		if (step.op === 'actions.invoke' && typeof step.action === 'string' && !effects.invokes.includes(step.action)) {
			effects.invokes.push(step.action);
		}
		if (step.op === 'return') effects.returns = true;
	}
	return effects;
};

// Exported: the executor re-runs this at invocation time so run-time and
// save-time enforce the identical contract (legacy docs included).
export const sanitizeActionCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (!name) return fail(400, 'Actions need a name');
	if (name.length > MAX_SCHEMA_NAME_CHARS) return fail(400, `Action name is too long (max ${MAX_SCHEMA_NAME_CHARS})`);

	const crystal: Record<string, unknown> = { name };

	const description = typeof input.description === 'string' ? input.description.trim().slice(0, MAX_SCHEMA_DESCRIPTION_CHARS) : '';
	if (description) crystal.description = description;

	if (input.actionKey !== undefined && input.actionKey !== null && input.actionKey !== '') {
		const actionKey = typeof input.actionKey === 'string' ? input.actionKey.trim() : '';
		if (!actionKey || actionKey.length > MAX_ACTION_KEY_CHARS || !ACTION_KEY_PATTERN.test(actionKey)) {
			return fail(400, 'actionKey must be a lowercase-dashed slug');
		}
		crystal.actionKey = actionKey;
	}

	const category = typeof input.category === 'string' ? input.category.trim().slice(0, MAX_COMPONENT_CATEGORY_CHARS) : '';
	crystal.category = category || 'general';

	if (input.version !== undefined && input.version !== null) {
		const version = Number(input.version);
		if (!Number.isInteger(version) || version < 1 || version > 999999) return fail(400, 'version must be a positive integer');
		crystal.version = version;
	}

	if (input.forkOf !== undefined && input.forkOf !== null && input.forkOf !== '') {
		const forkOf = typeof input.forkOf === 'string' ? input.forkOf.trim() : '';
		if (!forkOf || forkOf.length > 128 || /[$\s]/.test(forkOf)) return fail(400, 'forkOf must be a thing id');
		crystal.forkOf = forkOf;
	}

	let inputs: Record<string, unknown>[] = [];
	if (input.inputs !== undefined && input.inputs !== null) {
		const sanitized = sanitizeActionInputs(input.inputs);
		if (isFail(sanitized)) return sanitized;
		inputs = sanitized.inputs;
		if (inputs.length) crystal.inputs = inputs;
	}

	let capabilities: ActionCapabilityEntry[] = [];
	if (input.capabilities !== undefined && input.capabilities !== null) {
		const sanitized = sanitizeActionCapabilities(input.capabilities);
		if (isFail(sanitized)) return sanitized;
		capabilities = sanitized.capabilities;
		if (capabilities.length) crystal.capabilities = capabilities;
	}

	const steps = sanitizeActionSteps(input.steps, capabilities);
	if (isFail(steps)) return steps;
	crystal.steps = steps.steps;

	// $input refs must point at declared inputs — a ref to an undeclared input
	// would always resolve to undefined and is certainly an authoring mistake.
	const declaredInputs = new Set(inputs.map((descriptor) => String(descriptor.name)));
	const walkForInputRefs = (value: unknown): Fail | null => {
		if (typeof value === 'string') {
			const ref = parseActionRef(value);
			if (ref && 'kind' in ref && ref.kind === 'input' && !declaredInputs.has(ref.name)) {
				return fail(400, `Step references $input.${ref.name} but no such input is declared`);
			}
			return null;
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				const found = walkForInputRefs(entry);
				if (found) return found;
			}
			return null;
		}
		if (value && typeof value === 'object') {
			for (const entry of Object.values(value as Record<string, unknown>)) {
				const found = walkForInputRefs(entry);
				if (found) return found;
			}
		}
		return null;
	};
	const inputRefIssue = walkForInputRefs(steps.steps);
	if (inputRefIssue) return inputRefIssue;

	if (input.limits !== undefined && input.limits !== null) {
		const limits = sanitizeActionLimits(input.limits);
		if (isFail(limits)) return limits;
		if (Object.keys(limits.limits).length) crystal.limits = limits.limits;
	}

	return { ok: true, crystal };
};

// ---------------------------------------------------------------------------
// Value validation against a schema-thing field tree. Pure and shared: the
// schema builder previews with it, the create-a-thing form validates with it.
// It is a HELPER, never a write gate — a schema never gates OTHER things'
// writes (things are validated by their thingtime crystal sanitizers, not by
// user-published schemas). Schema things THEMSELVES are validated on write
// like any crystal, builtin seeds included.

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
    case 'json': {
      const checked = sanitizeDataValue(value);
      if (checked.ok === false) issues.push({ path, message: checked.error });
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

const boundedString = (value: unknown, max: number): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);

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

const sanitizeFeedAlgorithmCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
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
      lastTrainedAt: boundedString(input.lastTrainedAt, 40),
      // Carried, not dropped: this allowlist rebuilds the crystal from scratch,
      // so an omitted `shared` would silently unshare the algorithm. Strict
      // === true matches updateAlgorithm's boolean-only gate.
      //
      // Defensive, not load-bearing today: 'feed-algorithm' is in
      // PROTECTED_THINGTIME, so generic Thing CRUD refuses the kind (403) and
      // no feed-algorithm crystal is ever WRITTEN through this sanitizer —
      // algorithms.ts and the feed-algorithms-to-things migration build the
      // crystal directly. Keep the field listed anyway so the allowlist stays
      // honest if the kind ever becomes generically writable.
      shared: input.shared === true,
      listed: input.shared === true && input.listed === true,
      description: boundedString(input.description, 300) || ''
    }
  };
};

const sanitizeFolderCrystal = (input: Record<string, unknown>): { ok: true; crystal: Record<string, unknown> } | Fail => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return fail(400, 'Folder name is required');
  if (name.length > MAX_FOLDER_NAME_CHARS) return fail(400, `Folder name is too long (max ${MAX_FOLDER_NAME_CHARS})`);
  const crystal: Record<string, unknown> = { name };
  if (input.icon !== undefined && input.icon !== null) {
    if (typeof input.icon !== 'string' || input.icon.trim().length > MAX_FOLDER_ICON_CHARS) {
      return fail(400, `Folder icon must be a short emoji (max ${MAX_FOLDER_ICON_CHARS} chars)`);
    }
    if (input.icon.trim()) crystal.icon = input.icon.trim();
  }
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== 'string' || input.description.trim().length > MAX_FOLDER_DESCRIPTION_CHARS) {
      return fail(400, `Folder description is too long (max ${MAX_FOLDER_DESCRIPTION_CHARS})`);
    }
    if (input.description.trim()) crystal.description = input.description.trim();
  }
  return { ok: true, crystal };
};

const crystalSanitizers: Record<
  string,
	(
		input: Record<string, unknown>,
		appliedIds: string[],
		options?: ThingtimeCrystalValidationOptions
	) => { ok: true; crystal: Record<string, unknown> } | Fail
> = {
	attachment: sanitizeAttachmentCrystal,
  post: sanitizePostCrystal,
  folder: sanitizeFolderCrystal,
  comment: sanitizeCommentCrystal,
  reaction: sanitizeReactionCrystal,
  share: () => ({ ok: true, crystal: {} }),
  save: () => ({ ok: true, crystal: {} }),
  schema: sanitizeSchemaCrystal,
  component: sanitizeComponentCrystal,
  // action-run deliberately has NO sanitizer — run records are executor-
  // minted only, and the missing entry makes the generic write path 403.
  action: sanitizeActionCrystal,
  data: sanitizeDataCrystal,
  'scheduled-task-run': (input, ids) => {
    if (ids.length !== 1) return fail(400, 'Scheduled run notes cannot combine with other schemas');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 240) return fail(400, 'A run title is required (up to 240 characters)');
    if (typeof input.chatId !== 'string' || !/^[\w-]{1,128}$/.test(input.chatId)) return fail(400, 'A valid destination chat is required');
    if (typeof input.scheduledAt !== 'string' || !Number.isFinite(Date.parse(input.scheduledAt))) return fail(400, 'A valid occurrence is required');
    if (!['running', 'done', 'needs-attention'].includes(String(input.status))) return fail(400, 'Invalid run status');
    return { ok: true, crystal: { title: input.title, chatId: input.chatId, scheduledAt: input.scheduledAt, status: input.status, ...(input.notificationStatus === 'unavailable' ? { notificationStatus: 'unavailable' } : {}) } };
  },
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
export const validateThingtimeCrystal = (
	thingtime: unknown,
	crystal: unknown,
	options: ThingtimeCrystalValidationOptions = {}
): ValidatedCrystal | Fail => {
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

  // Folders are pure organization: combining them with a content schema would
  // make a doc that is both a container and content (and would let e.g.
  // ["post","folder"] ride the folder sanitizer past the post whitelist).
  if (ids.includes('folder') && ids.length > 1) {
    return fail(400, 'folder things stand alone — put content IN the folder via folderId instead');
  }

  const input = crystal && typeof crystal === 'object' && !Array.isArray(crystal) ? (crystal as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = {};
  let requiresTarget = false;
  for (const id of ids) {
    const schema = getThingtimeSchema(id)!;
    if (schema.requiresTarget) requiresTarget = true;
    const sanitizer = crystalSanitizers[id];
    if (!sanitizer) {
      // Registered crystal kinds with no generic sanitizer (app, app-data) are
      // written ONLY by their dedicated endpoints. /docs/schemas lists them, so
      // refuse with the real reason instead of pretending they don't exist.
      return fail(403, `${id} things are managed by their own endpoints`);
    }
		const sanitized = sanitizer(input, ids, options);
    if (sanitized.ok === false) return sanitized;
    Object.assign(merged, sanitized.crystal);
  }
  // Every generically writable Thing may have an owner-chosen display title.
  // Typed sanitizers retain their stricter title rules; schemas without one
  // gain the same bounded metadata without changing their content.
  if (input.title !== undefined && !Object.prototype.hasOwnProperty.call(merged, 'title')) {
    if (input.title !== null && typeof input.title !== 'string') return fail(400, 'Thing title must be text');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length > 300) return fail(400, 'Thing title is too long (max 300)');
    if (title) merged.title = title;
  }
  return { ok: true, thingtime: ids, crystal: merged, requiresTarget };
};
