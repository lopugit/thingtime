# 16 — Full-power app namespaces

Owner ask (2026-07-29): integrated apps should get the **full Thingtime things
API** — querying, search, object update, the works — not just the app-data KV
store; doc-count caps should die in favour of **storage-byte budgets**; and the
logged-in user should be able to **browse everything an app stores for them
inside Thingtime itself**, including what they'd see in the third-party app.

## The model in one paragraph

Every thing written through an app token is stamped server-side with a scalar
root **`appId: <clientId>`** — the namespace marker — plus a server-computed
root **`sizeBytes`**. App-token reads conjoin `{ appId }` into every Mongo
filter *and* every per-doc verdict (two-tier rule); app-token writes stamp it
and clamp the expressible acl to `tt:user` / `tt:app/<own clientId>` (private ↔
shared-to-this-app's-users; never `tt:all`, never other apps, never other
users, never exclusions — the `resolveAppDataAcl` clamp generalised). The acl
array keeps its PR #150 meaning untouched: it is the **audience among the
app's users**, not the namespace. The namespace is `appId`; the audience is
`acl`. The end user owns every doc (`ownerId` = user), sees all of it via the
owner short-circuit, and can browse/delete it in Thingtime.

Why not `acl.push('tt:app/<id>')` as the namespace: (a) users can already
hand-write `tt:app/<x>` entries through the site API (`sanitizeAcl` accepts
them) — an acl-based namespace is spoofable into an app's view (confused
deputy); (b) private app-data carries **no** app entry today — acl-contains is
simply not the membership predicate; (c) `acl` is multikey and cannot share a
compound index with `thingtime` — a scalar `appId` indexes cleanly.

## Consent surface (unchanged — deliberately)

- `app-data` scope ⇒ full CRUD + rich query **inside the app's namespace,
  own entries**. Same privacy boundary the user already consented to; richer
  querying moves filtering server-side over bytes the app could already read.
- `app-data.shared` (exact) ⇒ cross-user reads of entries whose acl carries
  the app's entry, still second-gated by **author-liveness** (author must hold
  a live grant covering `app-data.shared`; revoke ⇒ entries vanish, docs stay).
- Protected kinds (`user`,`theme`,`feed-algorithm`,`waitlist`) stay refused;
  `app`/`app-data` kinds stay off the generic write route (missing-sanitizer
  403). Apps use ordinary kinds (`post`,`comment`,`reaction`,`data`,…) inside
  their namespace.
- `tt:all` is **inexpressible** for app tokens. A future `app-data.public`
  exact scope could lift this; explicitly out of scope now.

## Routes

Opened to app tokens via the new tagged-union resolver `resolveActor`
(`user | app | anonymous`; `getCurrentServiceAccount`-style typed results;
`getCurrentUser`'s purpose-'app' wall is untouched — routes opt in):

| Route | App-token behaviour |
|---|---|
| `GET/POST/PUT/PATCH/DELETE /api/v1/things` | full CRUD, namespace-conjoined reads, stamped writes, acl-clamped |
| `GET/POST /api/v1/things/search` | full condition-tree grammar + sorts + cursors, namespace-conjoined (server-injected; `appId`/`acl` stay out of `SEARCHABLE_ROOT_FIELDS`) |
| `POST /api/v1/things/update` / `delete` | namespace-conjoined (delete filter carries `appId`; cascade decrements bytes for namespace children) |
| `POST /api/v1/things/react` / `comment` | only against namespace targets; children auto-stamped; **no** personal recent-reactions MRU write for app actors |

Staying closed: `feed`, `user`, `save`, `share`, `reactions-recent`,
`things/quota` — first-party social/UI surfaces; exposing them leaks the
user's social graph to the app. (An app "feed" is a namespace search.)

Cross-user reads (shared slice) work through the SAME opened reads: with
`app-data.shared`, the read fence widens from `ownerId=self` to
`appId + acl-contains-own-entry + author-liveness`, batch-checked
`liveSharingAuthors`-style. Without it: own entries only.

App-lens projections: acl is never returned raw (cross-app enumeration);
wire shape carries derived `visibility: 'private' | 'app'` + `mine` only.
Child aggregation (reactions/comments) under the app lens filters children by
`appId` so first-party children on the same doc never leak counts/content.

CORS/preflight: every opened route's `action` gains `appDataPreflight`,
413s ride `readJsonBodyWithCors`, origin binding + echoed-origin CORS as in
`resolveAppRequest`. Rate identity for app actors is `user:<id>:app:<clientId>`
against the EXISTING bucket names (reads → `oauth.read`/`things.search`,
things writes → `things.write`/`things.react`/`things.comment`,
update/delete sub-routes → `appData.write`) — the per-(user, app) identity
alone separates the windows, so an app never rides the user's own buckets.

## Storage: bytes, not counts

- `MAX_APP_DATA_KEYS_PER_APP_USER` (200) and `SANDBOX_MAX_KEYS` (50) are
  **deleted**. Unlimited docs.
- Two standing allowances for registered apps: a tiered aggregate across every
  user (Free 5 GiB, Plus 25 GiB, Pro 100 GiB, PAYG metered/unbounded, stored
  atomically with usage on the app Thing), and an app-owner default of 50 MiB
  per (user, app) on a deterministic protected counter Thing. Owners and
  linked co-managers can change the app tier/default at `/apps/manage` and set
  one or many relational per-user overrides; every effective override is
  clamped to the whole-app ceiling. A write reserves aggregate then user with
  guarded `findOneAndUpdate`; user refusal compensates aggregate. Both are
  fail-closed, and the generic `/apps/update` identity/origin route cannot
  rewrite them.
  Sandboxes instead get `SANDBOX_STORAGE_BYTES = 5 MiB` per namespace (counter
  doc carries `sandboxExpiresAt` so it reaps with its namespace) plus the
  global windowed brake.
- `sizeBytes` = `Buffer.byteLength(JSON.stringify({crystal, extended, tags}))`
  stamped at write; updates charge the delta (before-doc read), deletes and
  cascades decrement; drift repair = one `$sum: '$sizeBytes'` sweep.
- KV per-value 32 KiB cap stays on the KV endpoint (compat); generic app
  writes are bounded by the per-kind crystal rails + 512 KB `extended` + the
  768 KB body cap + the budget.
- Global sandbox byte window (`sandbox.storage.global`, rate-limiter-style,
  admin-tunable) lands with this — TODO 15 §1's first step.
- `GET /api/v1/app-data/usage` returns explicit `userStorage` + `appStorage`
  used/allowance/remaining values; `{ usedBytes, budgetBytes }` remain aliases
  for the user ledger (app token).

## KV compat + warm-ups

- `/api/v1/app-data*` endpoints unchanged for existing integrators
  (macrobiotica), except: private list gains `prefix`/`key=*`/`limit`/`cursor`
  (same grammar as shared), and writes dual-stamp root `appId` + `sizeBytes`.
- Admin migrations: `backfill-app-namespace-fields` stamps root `appId` +
  `sizeBytes` onto existing app-data things from `crystal.appId`;
  `backfill-app-storage-allowances` reconciles user ledgers while writes are
  fenced, then initializes each app aggregate last.
- New indexes (via `ensureIndexes`, versioned-collection layer):
  `{ appId: 1, ownerId: 1, updatedAt: -1, shareId: -1 }` and
  `{ appId: 1, acl: 1, updatedAt: -1, shareId: -1 }`, both partial
  `appId $exists` (scalar appId ⇒ one multikey field max ⇒ legal), plus the
  partial `(crystal.quotaKind, crystal.appId, updatedAt, ownerId)` manager
  index for protected per-user ledgers.

## User browsing (in Thingtime)

- Session-auth APIs: `GET /api/v1/apps/data-summary` (per-app: appId, name —
  null when app deleted, entryCount, usedBytes, lastUpdatedAt — enumerated
  **from things**, not grants, so orphaned data stays visible);
  `GET /api/v1/things?appId=<clientId>` (own-things mode conjunction);
  `POST /api/v1/apps/data/delete-all { appId }` (bulk, decrements budget);
  session-auth shared-slice view derived from the user's own live grant.
- UI: Settings → **Connected apps** section (grants list + revoke + storage
  summary, `tt-app-grants-<userId>` localCache, optimistic paint) and an
  `/apps` browse page (per-app entry list → ThingView in trusted context,
  entry delete, shared-slice tab when the user's grant covers it, quiet-state
  explains why when it doesn't). Drawer menu entry. Lopu toasts only.

## Sandbox parity (test == live)

Sandbox tokens run the identical resolver/filter/stamp/budget code path.
`sandboxExpiresAt`/`sandboxSpace` stamped on **every** namespace write (any
kind); real reads exclude `sandboxExpiresAt $exists`; sandbox reads fence to
own namespace or same-space pool; space feeds keep `liveSandboxAuthors`
author shaping.

## Docs / logs / tests to move in the same PR

- `apiDocs.ts`: rewrite the `oauth-authorize` threat-model sentence ("app
  tokens are rejected by every normal endpoint" — now false by design; state
  the new blast radius: an app token reaches the things API **only inside its
  `appId` namespace**), `oauth-sandbox` surface list, `app-data*` cap text
  (grep hardcoded "200"), `things*` auth blocks, new endpoints. `/api/docs`
  is memoised per origin — cold-start to see edits.
- `FUNDAMENTALS.md` §3 table (app-data row), `DECISIONS.md` entry (namespace
  = scalar `appId` not acl; bytes not counts; consent surface unchanged —
  the why), TESTING.md: widen shared-app-data + sandbox rows (51st-key row →
  byte-budget row), add rows per shipped protection (TODO 15 DoD).
- API tests extend `apiTests.ts`; verification against the live dev stack via
  real API calls only.

## Explicitly deferred (logged, not forgotten)

- Global per-user storage ledger across ALL first-party things
  (`storageUsedBytes` on the user doc is still dead — TODO 15 §3 remains).
- `app-data.public` (apps publishing `tt:all` things).
- First-party users reacting/commenting on app things from the browse UI.
- Verification/progressive-trust gates (TODO 15 §2).
