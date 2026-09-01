# 🏛️ Thingtime Fundamentals

Core engineering principles for this codebase. These are deliberately short and
non-negotiable — read before adding features. (Roadmap lives in
`TODO/claude-todo/`.)

## 1. The API is the only gateway to data

All data access — reads, writes, seeding, tests — goes through the Thingtime API
(`remix/app/routes/api/v1/...`) and the API utils layer
(`remix/app/api/utils/...`). UI components, scripts, and tests **never** touch
MongoDB directly.

## 2. Seed and test through the real API (functionality cohesion) ⭐

**Seeding and tests create data by calling the same API the live app calls — not
by writing to Mongo directly.**

Why: a seeded user and a user who signs up on the site must be **identical** —
same validation, same password hashing, same schema, same side effects. If
seeding writes straight to the DB, the two paths drift and "works when seeded /
breaks on real signup" bugs appear.

- ✅ Seed a user → `POST /api/v1/auth/register` (the real endpoint).
- ❌ Seed a user → `collection.insertOne({...})` in a script.

This makes **test, live, and direct-API behaviour one and the same code path.**
Applies to every entity (users, things, sessions): there is one creation path,
and everything uses it.

## 3. One database: `thingtime` — and (almost) one collection

Single Mongo database `thingtime`. **Everything that can be a thing IS a
thing**: users, themes, feed algorithms, waitlist entries, schemas, posts,
comments, reactions, shares, and free-form data all live in `things`, each
kind declared through the `thingtime` schema-id array (see
`app/schemas/registry.ts` and `TODO/claude-todo/22-everything-is-a-thing-collections.md`).

**Physical collections are versioned.** The names below are _logical_ — the
vocabulary of code, docs, and the admin query API. On the MongoDB server each
collection physically lives at `<name>_v<N>`, where `N` is that collection's
entry in `COLLECTION_SCHEMA_VERSIONS` (`app/schemas/registry.ts`): logical
`things` at version 2 is the physical collection `things_v2`. The mapping has
exactly one implementation (`api/utils/mongodb/collectionNames.ts`), every
handle flows through `getCollection()` in `api/utils/mongodb/collections.ts`,
and on first db contact an adoption pass renames any unversioned legacy
collection in place (instant, index-preserving). Bumping a collection's
version points the code at the next physical generation; the superseded one
stays behind as a frozen snapshot until the admin runs the destructive
`drop-stale-collection-generations` migration — run the migration, verify,
then everything below the current version can safely be deleted. Runbook and
edge cases live in `api/utils/migrations/migrations.ts`.

| Collection                                                                                                                                 | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `things`                                                                                                                                   | ALL Thingtime data. System kinds: `user` (public profile in `crystal`, all private state as a single BinData `secure` blob, uniqueness via BinData `uniqueKeys`), `theme`, `feed-algorithm`, `waitlist`, `schema`; content kinds: `post`, `comment`, `reaction`, `share`, `attachment`, `data`, `embed` (cross-site embedded things — see `docs/THINGTIME_EMBED.md`), `component` (a UI component: arg-templated render tree + arg descriptors, browsed on /components; the platform library is seeded system-owned from the repo `components-db/` via `POST /api/v1/admin/components/seed`, shareId `component-<slug>`, and user "Save version" instances ride the same kind), `action` (a declarative capability-bounded program: typed inputs, a closed step vocabulary — things.create/get/search/update, actions.invoke, return — author-declared capabilities that only NARROW the invoker's own access, and a limits envelope; inspected and run on /actions via `POST /api/v1/actions/run`); messenger kinds (dedicated endpoints only, membership-gated, invisible to generic reads: see `api/utils/messenger/`): `chat`, `chat-member`, `chat-message`, `chat-section`, `community`, `community-member`, `community-invite`, `custom-emoji`, `follow`; control-plane kinds: `app` (registered client identity, origin allowlist, and aggregate app-byte ledger), `subscription-tier` (immutable versioned catalog revisions with live/draft/archived lifecycle, pricing, inclusions, and quota defaults), `subscription` (an exact tier-revision/quota snapshot plus the authoritative account-byte ledger per user — app plans live atomically on app Things), `app-storage` (protected per-app-user usage + optional sub-tier), `service-quota` (protected operational admission state), `account-link` (owned accounts + app co-managers, many-to-many), `migration-diagnostic` (short-lived, private admin migration error reports), `moderationFlag` (system-owned NSFW/TOS review records keyed `modflag-<attachmentId>`, `targetId` = the flagged attachment; paired with the protected `moderation` root stamp on attachment things written only by `api/utils/moderation/`), and the protected CI family (`ci-repository`, `ci-feature`, `ci-branch`, `ci-pull-request`, `ci-workflow-run`, `ci-deployment`, `ci-preview`, `ci-dispatch`, `ci-event`), and `action-run` (protected, executor-minted run records — `targetId` = the action, owner-private, `storageClass: "control"`, size-capped inputs/result echo + per-step trace, listed via `GET /api/v1/actions/runs`). Every thing also carries a schema-free `extended` property for arbitrary unvalidated JSON (≤512KB, replace-on-write, never structured-searchable) |
| `sessions`                                                                                                                                 | server-side sessions / JWT records (revocation; `userId` = the user thing's `shareId`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `rosters`                                                                                                                                  | account-switcher rosters (TTL-reaped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `emailVerifications`                                                                                                                       | pending email-verification tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `passwordResets`                                                                                                                           | single-use password-reset tokens (1h TTL; consuming one revokes every live session)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `authOtps`                                                                                                                                 | email-2FA login challenges (gated by user `meta.twoFactorEmailEnabled`; sha256 code hashes only, 10-min TTL, attempt-capped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `email_messages` + `email_events`/`email_suppression_list`/`email_unsubscribes`/`email_templates`/`email_subscriptions`/`email_identities` | the owned email layer — outbox rows for every send plus deliverability satellites (see `api/utils/email/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `lopuMusingRateLimits` / `rateLimits`                                                                                                      | rate-limit windows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `settings`                                                                                                                                 | admin-editable app settings singletons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `users` / `themes` / `feedAlgorithms` / `waitlist`                                                                                         | LEGACY — new records are always written as things; a legacy doc is only ever _updated in place_ (dual-era fallback) until the admin migrations (`/api/v1/admin/migrations`) convert it into a thing and delete it. No NEW records land here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

System-kind rules (never bypass):

- **Protected** kinds — `user`, `theme`, `feed-algorithm`, `waitlist`, `app`,
  `subscription-tier`, `subscription`, `app-storage`, `service-quota`,
  `account-link`, `migration-diagnostic`, `attachment`, and every `ci-*`
  control-plane kind — are
  refused by the generic `/api/v1/things` CRUD; only their dedicated utils
  write them (register, profile, themes, algorithms, waitlist, apps, and the
  admin-gated tier/subscription/link endpoints — forging a client identity or
  origin allowlist, publishing a tier,
  self-assigning one, or creating an ownership link would be privilege
  escalation). The deterministic `subscription-*` shareId namespace is also
  reserved so ordinary Things cannot squat future tier revisions or assignment
  records. The deterministic `quota-*` namespace is reserved for protected
  service-quota records for the same reason. The
  `migration-diagnostic-*` namespace is likewise reserved; those records are
  written after a failed real migration releases its lease, expire after 30
  days, and are readable only through the exact-owner current-admin endpoint.
  A v2 diagnostic may advertise value-free references for a bounded set of
  MongoDB ObjectIds supplied through an explicitly authored server-side error
  context. Error prose alone never grants reveal access. Resolving one reference
  repeats current-password verification through the closed
  `/api/v1/things/reveal` codec; there is no generic `secure` field/path/blob
  decoder and no reusable confirmation token.
  CI current-state Things have deterministic shareIds; webhook/reconciliation
  updates replace the bounded current projection only when their provider
  timestamp is not older. Every status transition is a separate relational
  `ci-event` Thing attached by `parentId`, idempotent by provider delivery id.
  History is never an embedded array, and all CI Things carry
  `storageClass: "control"` so operational telemetry is not customer content.
  The `schema` kind is NOT protected: anyone may publish a schema thing. Builtin
  schemas are reserved system-owned seeds with root `storageClass: "control"`;
  community/user schemas remain ordinary billable content. The `component` kind
  follows the same posture: user "Save version" components are ordinary content,
  while the seeded platform library (`component-<slug>` shareIds — the prefix is
  reserved in `sanitizeShareId`) is system-owned `storageClass: "control"`. The
  `action` kind is likewise user-creatable through the unified things path
  (save-time validation requires every step to be covered by a declared
  capability), while `action-run` records are PROTECTED: only the executor
  (`api/utils/actions/execute.ts`) mints them, so the audit trail cannot be
  forged. The `action-` shareId prefix is reserved.
- Private state lives under root `secure` as a single **BinData blob** (the
  search wildcard text index tokenizes string _fields_ only, so a binary blob
  is entirely unsearchable — no field inside it can ever leak via `q=<value>`),
  never in `crystal`; the one queryable flag (`admin`) is a root boolean. BinData
  is an indexing/access boundary, not application-level encryption: dedicated
  readers must still authenticate, authorize, bound, and project every value.
  `uniqueKeys` elements are BinData for the same reason, PII keys additionally
  sha256-hashed. New writers use the shared builders/helpers in `auth/users.ts`
  so nothing hand-rolls the binary encoding.
  Migration diagnostics use the same binary root boundary for their bounded,
  redacted error detail; only safe run metadata and value-free reveal descriptors
  leave it. Credentials, tokens, authorization values, connection strings,
  private keys, URL query identifiers, and ambiguous 24-hex strings are always
  irreversibly redacted rather than retained for reveal.

### Appended/child data is relational — never an unbounded embedded array

Data that accumulates on a parent (post **reactions**, post **comments**, and
protected **attachments**) is stored as its OWN atomic `things` doc
(`thingtime: ['reaction']`, `thingtime: ['comment']`, …) and aggregated back on
read. The canonical v2 child relation is root `targetId`, containing the
parent's stable `shareId`; `parentId` is legacy compatibility only. NEVER append
accumulating data as an ever-growing array/map field on the parent doc.

Why: an embedded array/map has no natural bound — one actor can grow a single
doc toward Mongo's 16 MB cap (bricking it) and bloat every reader's
payload/DOM, and every write rewrites the whole parent. Relational children keep
the parent bounded, make each write per-item + concurrency-safe (a partial-unique
index enforces invariants like one-reaction-per-user), and give natural paging.

How (see `api/utils/things/things.ts`):

- Canonical child records are full Things with a stable `shareId`, `ownerId`,
  their `thingtime` discriminator, server-validated root `targetId`, and payload.
  Protected attachment binding sets `targetId` server-side. Post attachments
  carry server-owned purpose `post` and inherit the exact post ACL; comment and
  reply attachments carry purpose `comment` and walk the complete parent chain
  to that root ACL. Message/thread attachments carry purpose `message` and
  authorize against the exact live message plus current chat membership.
  Custom emoji images carry purpose `emoji` and bind to the exact owner/scope.
  Profile attachments carry server-owned purpose `profile` plus exact `avatar`
  or `banner` slot; the user root stores the current attachment id and content
  authorization rechecks that exact slot reference. No purpose can be replayed
  into another surface. A child without a
  `shareId`, or any child using `kind`/`parentId` instead of
  `thingtime`/`targetId`, is legacy compatibility data, not the shape for new
  writers.
- Reads **batch-aggregate** children for the whole page in ONE query per kind
  (canonical filter: `{ thingtime: <kind>, targetId: { $in: postIds } }`) —
  never N+1 — while folding legacy `kind`/`parentId` rows through the explicit
  compatibility path. Project the same shape the client already consumes, so
  the UI is unchanged.
- Writes create/delete one child doc; per-parent/per-user caps become soft
  product limits, not structural safety rails.
- Legacy embedded data folds in on read and migrates to children on first write.
- Deleting a parent drains the complete transitive attachment graph
  (`targetId` plus legacy `parentId`) child-first in bounded transactions. Each
  protected attachment's exact S3 version is permanently deleted before its
  Mongo row and quota reservation can disappear; the parent remains a retry
  anchor until no comments/replies/reactions/saves/attachment bytes can survive
  it.

### Account storage is one exact, transactional ledger

Every billable Thing has a server-owned `storageClass: "content"`, a versioned
`storageAccountingVersion`, and `sizeBytes` equal to the UTF-8 byte length of
exactly `JSON.stringify({ crystal, extended, tags })` after the API has
normalized those three stored payload fields. This is the stable logical
customer-content measure. It deliberately excludes platform envelope fields,
Mongo indexes, compression, replication, and other physical database overhead
that cannot be deterministically assigned to one account.

Protected `attachment` Things extend that same canonical measure by their
server-verified root `objectSizeBytes`. Pending, finalizing, ready, and deleting
attachments all remain billable; a malformed attachment envelope fails closed.
Uploads reserve the complete logical allocation transactionally before S3
accepts data, and deletion refunds it only after the private object is confirmed
inaccessible. Ordinary user-authored Things cannot supply the protected root
envelope or opt themselves into or out of object-byte accounting.

User Things remain non-billable identity/control-plane records. Managed avatar
and banner objects are still ordinary billable protected attachment Things:
their server-owned root references do not move object bytes into the user
crystal or hide them from the account ledger. An external profile image URL is
only bounded metadata and never causes Thingtime to fetch or store the remote
image bytes.

`currentContentStorageSizeBytes()` is the shared proof used by every
incremental writer: current schema + array `thingtime` + current content stamp

- a fresh canonical payload re-measurement. An old, missing, fractional,
  unsafe, or stale stamp is never used for delta arithmetic. Updates fail with a
  migration-required response; deletes remain available but fence affected
  ledgers for exact source reconciliation instead of guessing a refund.

The protected user `subscription` Thing is the authoritative account ledger:
its tier snapshot/override resolves `userStorageBytes`, while
`storageUsedBytes` is the one enforced and displayed total. Every customer
content create/update/delete changes that counter in the **same Mongo
transaction** as the content. Unknown future user-content kinds default to
billable. Only protected control-plane kinds or a server-written root
`storageClass: "control"` are excluded; user-authored `crystal` values can never
opt a Thing out.

App data contributes to the account ledger exactly once. The app aggregate and
per-(app,user) ledgers are overlapping sub-limits used for app-plan admission,
not extra bytes added to the account total. In one 100-byte app write, account,
app, and app-user counters each move by 100, while the account total remains 100. Public/admin UI and API projections read this canonical ledger; legacy
flat user fields are compatibility aliases derived from the same nested
`storage` value, never independent counters. Used/remaining compatibility
aliases are null while the ledger is not ready, so cached or malformed values
cannot masquerade as exact usage.

Growth fails closed until the versioned ledger is `ready`, and finite
allowances are checked atomically with the increment. A detected underflow
marks `needs-reconcile`; the next growth attempt repairs from canonical content
stamps inside its transaction before applying the new delta exactly once. The
idempotent admin migration stamps all legacy content, ignores the old
never-maintained usage values, preserves explicit legacy allowances as real
subscription overrides, reconciles the ledger, and only then marks it ready.
That migration first fences account, app, and app-user ledgers, runs every
storage-affecting prerequisite to convergence, stamps content with compare-and-
swap writes, and reconciles every overlapping ledger before publishing ready.
Running a source-changing prerequisite by itself is refused while ledgers are
live; the orchestrating storage migration is the safe entry point.
Any new content writer must use these shared storage/transaction primitives;
directly updating `things` is a quota bypass and violates §1.

Operational boundaries are explicit rather than silent. Reconciliation and
the whole-corpus migration fail closed: interruption leaves affected ledgers
fenced and the idempotent migration must be rerun before growth resumes. A
single very high-cardinality app may eventually need a batched, fenced
background reconciliation instead of the current one-transaction repair.
Admin account totals and app-data subtotals are separate read projections and
can briefly reflect adjacent committed snapshots during active writes; quota
admission itself remains transactional. The exact legacy compare-and-swap
uses the complete bounded source Thing, so a malformed historical document at
Mongo's BSON ceiling requires operator repair. These are logical content bytes,
not physical BSON/WiredTiger/index/replication billing bytes.

### App namespaces ("Login with Thingtime")

Things written through an app-scoped token carry a server-stamped scalar root
`appId` — the NAMESPACE marker. It is deliberately not the acl (users can
hand-write `tt:app/<x>` acl entries, so acl membership would be spoofable);
`acl` stays what it always was — the AUDIENCE: `tt:user` private, plus
`tt:app/<clientId>` for that app's user base. Every app-token read and write is
fenced to the namespace (`api/utils/apps/namespace.ts`), and storage is bounded
by TWO standing BYTE allowances — the app Thing's aggregate subscription
ceiling (Free 5 GiB, Plus 25 GiB, Pro 100 GiB, PAYG metered/unbounded) and one
effective per-(user, app) ceiling (the app-owner default, 50 MiB initially,
optionally replaced by a relational `app-storage` sub-tier and always clamped
to the aggregate). Root `sizeBytes` is charged against the account, app, and
app-user ledgers — never doc counts — in the same transaction as registered
app content, so partial commits cannot drift them. Plan + aggregate counter are
one app document, so entitlement and admission cannot drift; recoverable
underflow fences reconcile from stamped app content before admitting growth.
Sandboxes instead get a 5 MiB
ephemeral namespace plus the global windowed brake. The end user owns
every namespace doc and can browse (`GET /api/v1/things?appId=`,
`/api/v1/apps/data-summary`) and delete
(`POST /api/v1/apps/data/delete-all`) everything an app stores. Full model in
`TODO/claude-todo/16-full-power-app-namespaces.md`.

## 4. One MongoDB connection source

The connection string comes from exactly one place:
`remix/app/api/utils/mongodb/config.ts` → `getMongoUri()`, fed by
`MONGODB_CONNECTION_STRING` (+ `MONGO_PASS` for the `<db_password>` placeholder).
No alternate env vars, no fallbacks. Every helper resolves through it.

For **local dev**: set `MONGODB_CONNECTION_STRING=mongodb://localhost:27017/thingtime`
(no placeholder → `MONGO_PASS` unused).

**Data-endpoint override (thin-frontend mode):** a browser session — logged in
or not — may point the open DATA PLANE at a custom MongoDB via
`/api/v1/mongodb/endpoint` (httpOnly `tt_mongo` session cookie; API clients
send `x-tt-mongo-url` per request). The API dispatcher establishes a
request-scoped context (`mongodb/endpoint.ts`, AsyncLocalStorage) and
`collections.ts` splits resolution: `getThingsCollection()` (posts, comments,
reactions, shares, data, schemas, app-data) follows the active endpoint, while
identity/auth and every control-plane collection (users, sessions, rosters,
the protected kinds user/theme/feed-algorithm/waitlist via
`getHomeThingsCollection()`, email/token satellites, settings, rate limits)
ALWAYS resolve the home deployment DB. Admin routes always run home. Logged-in
users can persist saved endpoints (inside their `secure` blob — URLs embed
credentials); raw endpoint URLs never reach a client — responses carry the
sanitised host + db name only, and activation probes the endpoint first.

## 5. Auth = httpOnly cookie + revocable JWT + Mongo session

One auth model used everywhere (see `claude-todo/03-auth-login-register.md`):

- On login/register: create a **session doc** in `sessions` (Mongo) → gives a
  `jti` (token id) we can revoke.
- Mint a **signed JWT** (`sub` = userId, `jti`, `exp`) via `userGenerateJWT`.
- **Browser:** store the JWT in a signed **httpOnly cookie** (the Remix
  `Session` cookie) — JS can't read it, sent automatically.
- **API clients:** send the same JWT as `Authorization: Bearer <jwt>`.
- Every authed request: verify signature + `exp`, then check the `jti` is still
  live in `sessions` (not revoked). Logout / revoke = flip the session in Mongo →
  the JWT stops working immediately, before `exp`.

So the JWT lives in the cookie for the website _and_ works as a Bearer token for
API clients — and either way Mongo is the source of truth for revocation.

Multi-account: a second httpOnly cookie, **`tt_accounts`**, holds an opaque id
naming this browser's account-switcher roster — a doc in the Mongo `rosters`
collection whose entries reference sessions by id (no account limit, no raw
JWTs stored anywhere). `tt_auth` stays the single ACTIVE credential; switching
mints a fresh JWT from the chosen live session. Every roster account is
independently revocable and validated by the same session→user path as
`tt_auth`, and raw tokens never reach the client (the switcher API returns
public users only). See `TODO/claude-todo/11-account-switcher.md`.

## 6. Never leak secrets

- Strip credentials from any connection string shown to a client
  (`sanitiseMongoHost`).
- Never return password hashes, session tokens, or raw JWTs in read responses;
  project them out.

## 7. One notification: Lopu 🦄

**All user-facing notifications go through the Lopu toast component**
(`remix/app/components/Lopu/useLopu.tsx`) — never raw Chakra `useToast`, browser
`alert()`, or ad-hoc banners. This keeps one consistent voice (messages read as
coming from "Lopu", the Thingtime AI) and one visual style (the rainbow-bordered
card below the nav, with a built-in ✕ close button).

Two hooks, same look:

- `useLopu()` → one-shot toast: `lopu({ title, description?, status?, duration?, link? })`.
  `status` is `'success' | 'error' | 'info'`; default `duration` is 15s.
- `useLopuStream()` → a streaming toast that pops instantly ("Lopu is thinking…")
  and types an NDJSON response in live (used by the DevKit musing). The read-timer
  starts when the stream _finishes_.

Don't pass Chakra-native toast props (e.g. `isClosable`, `render`) to `lopu()` —
the component owns presentation. `console.error`/logging is for developers and is
not a user notification; surface anything the user should see through Lopu.
