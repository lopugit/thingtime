# Performance backlog

42 confirmed, still-open findings from the audit, plus 1 partially
addressed. Every one was verified to exist in the source at the time of the
audit — re-confirm against current `develop` before starting, since some of
this file's neighbourhood has changed.

Context, measured results and the verification standard: [README.md](README.md).

**Fix safety** is the verifier's judgement of how mechanical the change is:

- `safe-mechanical` — contained, behaviour-preserving, mirrors an existing pattern.
- `needs-care` — correct fix requires judgement; the naive version is wrong.
- `risky` — touches a wide contract or a correctness-sensitive path.

Read the *proposed fix* before starting. Several explicitly warn against the
obvious approach.

## Partially addressed

- [ ] **resolveRelated loads EVERY comment and reaction doc (full documents, no limit, no projection) for each page of posts**  
      `remix/app/api/utils/things/things.ts:1307` · Critical · needs-care  
      Projections have landed. Still open: bounding the per-target comment set without corrupting `totalComments`, which counts legacy no-doc entries.


## Database — N+1 and per-item round trips

- [ ] **bulkThings runs up to 100 (or 500) items serially through updateThing, each doing a full public projection it then throws away**  
      `remix/app/api/utils/things/things.ts:3857` · **Critical** · fix safety: needs-care

      *Impact.* Live path: POST /api/v1/things/bulk (the /things multi-select UI), auth + `things.write` rate-limited only. Every item runs serially, and each one pays a `resolveProfiles` query (uncached, remix/app/api/utils/things/things.ts:1243) whose result bulkThings throws away — it only records `{ id, ok }`. With the deployment pinned to syd1 alongside the Sydney Atlas cluster (~1-3ms/RT), a 100-item bulk move costs roughly 300-1000 sequential round trips (~0.5-3s), and a 500-child recursive folder share roughly 1500+ (~2-5s). The discarded projection is ~25-30% of that for the common `data`/`folder` kinds. The worst case is bulk-moving/sharing POST things, where `isPostThing` (:3662) additionally …

      *Proposed fix.* Apply (a) only; (b) as proposed is unsafe. (a) SAFE-ISH, DO THIS: give updateThing/deleteThing an internal option that skips the projection when the caller discards it (e.g. `options.skipProjection`), and have bulkThings pass it at :3862, :3868, :3888, :3901. Caveat: updateThing's return type is `{ ok: true; thing: PublicThing; post: PublicPost | null }` and is consumed widely (upsertThing at :3712 forwards `thing`/`post` straight out), so this is a signature/type change — either widen `thing` to `PublicThing | null` under the option or add a separate internal write function that the public updateThing wraps. Contained, but not a one-line edit. Cheaper alternative with zero signature churn: …

- [ ] **Every quota reserve reads and writes the same document four times sequentially, and each CAS retry repeats all four**  
      `remix/app/api/utils/things/quota.ts:360` · **Medium** · fix safety: needs-care

      *Impact.* A warm reserve (quota doc already exists) costs 4 sequential round trips on a single document where 2 would do: a no-op upsert write, a findOne to verify it, a second findOne for the CAS preimage, then the findOneAndUpdate. With functions and Atlas both in Sydney (vercel.json regions: ["syd1"]) each RT is ~1-3ms, so the waste is roughly 2-6ms per reserve, and a fully contended reserve (MAX_QUOTA_CAS_ATTEMPTS = 5, each attempt repeating all four) is ~20-60ms before the 503 rather than the ~40ms a 2-RT retry loop would take. One of the two wasted RTs is a write, so it also costs a needless majority-ack on the primary. Scope is narrow: the only caller is POST /api/v1/things/quota, a …

      *Proposed fix.* Restructure so the preimage read comes first and initialize runs only on a miss. Concretely: split validatedQuotaPreimage into a variant that returns null instead of calling quotaNotFound(), have reserveQuota try that first, and only when it returns null call initializeQuotaThing and then re-read the preimage. That makes the warm path 2 RTs and the cold path 3, and — critically — preserves the legacy-row semantics documented at :136-138: on a preimage miss caused by a same-owner legacy `data` row at the same shareId, initializeQuotaThing's updateOne still matches without a duplicate-key error, its findOne at :139 still runs, and requireCanonicalServiceQuotaDocumentState still raises the …


## Database — index coverage and query shape

- [ ] **Legacy `visibility` $or branch has no index — /search and every audience query is a full COLLSCAN + blocking sort**  
      `remix/app/api/utils/mongodb/collections.ts:469` · **Critical** · fix safety: needs-care

      *Impact.* Scoped down from the finder's claim, with measured numbers.

      *Proposed fix.* Do NOT delete the `visibility` branches from `circleClause` (things.ts:1765-1779) — that is a silent correctness regression against v1 residue docs (see reason). Apply ONLY the index variant. In `createThingsDataIndexes` in `remix/app/api/utils/mongodb/collections.ts`, beside the existing `col.createIndex({ acl: 1, createdAt: -1, shareId: 1 })` (line 469), add: // The audience $or pairs `acl` with the v1-era `visibility` enum. Mongo can // only index-union an $or when EVERY branch is indexed, so without this the // whole clause demotes to a COLLSCAN + blocking sort (measured: 4404 docs // examined / 149ms vs 21 keys / 4ms with it, on a 4.4k-doc collection). col.createIndex({ visibility: 1, …

- [ ] **People search $or on unindexed displayName scans the whole user partition per keystroke, plus a COLLSCAN of legacy users**  
      `remix/app/api/utils/auth/users.ts:1376` · **High** · fix safety: needs-care

      *Impact.* Every people-search request FETCHES the entire user-thing partition in the worst case: measured 156 keys / 156 documents examined for 0 results against 156 total user things (7ms locally on a warm cache). The scan is bounded only by {thingtime:'user'}, so it grows linearly with the user base — at 100k users a non-matching keystroke fetches ~100k full user documents (crystal + profile fields, order 1-2KB each => roughly 100-200MB pulled through the WiredTiger cache per request), while an 8-row typeahead response needs 8. This is a per-keystroke endpoint in Messenger (200ms debounce, 2-char floor), and the rate limiter permits 120 such requests per minute per client, so one active search box …

      *Proposed fix.* Do NOT apply the proposed fix as written — one third of it is ineffective and another third breaks behaviour. (a) $text is not a drop-in: things_text_search is word-tokenized with stemming, so "nik" would stop matching "nikolaj" and typeahead prefix matching dies. (b) Adding a displayName index to legacy users does NOT remove that scan — an unanchored $options:'i' regex cannot seek, so it just converts a COLLSCAN into a full IXSCAN of identical cardinality; skip it entirely since the collection is empty and frozen. (c) The workable route is the case-folded field: stamp crystal.searchName (lowercased username + displayName, e.g. a small array) on user-thing write, add col.createIndex({ …

- [ ] **ciControl readKind sorts on updatedAt, which no thingtime-prefixed index contains**  
      `remix/app/api/utils/ciControl/store.ts:232` · **Medium** · fix safety: needs-care

      *Impact.* Every /api/v1/admin/ci request runs nine blocking sorts, one per CI kind, each forced to IXSCAN and then FETCH every document in its partition because updatedAt appears in no thingtime-prefixed index. Six of those partitions (ci-event, ci-workflow-run, ci-pull-request, ci-deployment, ci-preview, ci-dispatch) are append-only with no TTL and no pruning, so scanned+fetched document count grows monotonically with webhook delivery volume while the endpoint still returns at most 200-250 rows. The admin dashboard polls this every 30 seconds while visible (CIControlDashboard.tsx:530), so one open tab issues ~2,880 requests/day = ~26,000 full-partition scans/day. At 50k ci-event docs the event query …

      *Proposed fix.* Do not add a bare col.createIndex({ thingtime: 1, updatedAt: -1, shareId: 1 }). It is legal (only thingtime is multikey; updatedAt/shareId are scalars — same shape as the existing line 427 index), but thingtime is set on essentially every v2 thing, so it would build a full-collection multikey index on the largest collection in the system, adding storage and per-write amplification to all thing writes, purely to serve one admin-only endpoint. Prefer one of: (a) a partial index scoped to the CI kinds, e.g. col.createIndex({ thingtime: 1, updatedAt: -1, shareId: 1 }, { partialFilterExpression: { thingtime: { $in: [...CI_THINGTIME] } } }) — verify the $in form is accepted by the target MongoDB …


## Database — unbounded scans, projections and payload bloat

- [ ] **resolveThreadCounts runs an unbounded $graphLookup over the whole comment tree of every post on the page just to take $size**  
      `remix/app/api/utils/things/things.ts:1479` · **High** · fix safety: needs-care

      *Impact.* Unbounded-depth `$graphLookup` runs once per feed/profile/search/permalink render for up to ~100 root ids (20-50 posts + their share originals), buffering every descendant comment DOCUMENT of every thread on the page just to take `$size`. Server-side work per render is O(total comments in all threads on the page) — ~2,000 full docs (~1-2 MB) for a 20-post page averaging 100-comment threads, growing without limit as threads grow. Because `$graphLookup` is capped at 100 MB and ignores `allowDiskUse`, one hot thread turns the shared aggregation into a hard error that fails the counts for every post on the page, i.e. a 500 on the feed. There is no cache on the feed route and no denormalized …

      *Proposed fix.* Denormalize the whole-thread count: maintain a counter on the root post (e.g. `crystal.threadCount`, mirroring the existing `crystal.lastMessage` denormalization) incremented on comment create and decremented on delete, walking to the thread root; `resolveThreadCounts` then becomes a projection off the docs already in hand. This requires a one-time backfill (the current graphLookup is exactly the backfill query, run offline per post), hooks on every comment create/delete path, and preserving the legacy `!entry.doc` addend at things.ts:1626. Do NOT apply the "project the graphLookup output before $size" half of the original suggestion — `$graphLookup` has no sub-pipeline and cannot project …

- [ ] **Every reaction tap re-runs resolveRelated, refetching the post's whole comment tree to compute an emoji tally**  
      `remix/app/api/utils/things/things.ts:2652` · **High** · fix safety: needs-care

      *Impact.* Every first-party emoji tap (POST /api/v1/things/react) runs the full page-batch resolver for a single target: 3 serial DB round trips instead of 1, fetching up to 500 full comment docs plus ~2500 reply docs (MAX_COMMENTS_PER_POST=500, REPLIES_PER_LEVEL=5, SHIPPED_REPLY_LEVELS=1) and a share-count aggregate, all discarded — only `reactionsByTarget` is read. Cost is wasted DB work, bandwidth and 2 extra serial hops per tap (intra-region since vercel.json pins syd1, so ~ms each, not the 630ms the finder claimed); on heavily-commented posts it is hundreds of KB of comment text transferred per reaction. Zero-comment targets already cost only 1 round trip.

      *Proposed fix.* Replace the resolveRelated call at things.ts:2652 with a target-scoped reaction resolver, but it must reproduce mergedReactionsOf's three sources or counts will regress on legacy data: (a) v2 `things.find({targetId, thingtime:'reaction'})` projected to `{ownerId, 'crystal.emoji'}`, (b) legacy `things.find({kind:'reaction', parentId: target.shareId})` using `token`, and (c) the embedded `target.reactions` map — then dedupe by (userId, emoji) exactly as mergedReactionsOf does before counting. A plain `$group` on `crystal.emoji` alone would drop legacy `kind:'reaction'` docs and the embedded v1 map (migrateThingInteractions only runs on the write branch and only when `!app`; the read-only …

- [ ] **browsePopular loads every schema id in the visibility superset with no limit, then ranks and pages in JS**  
      `remix/app/api/utils/schemas/browse.ts:198` · **High** · fix safety: needs-care

      *Impact.* Every `sort=popular` request does three unbounded O(N) units of work where N = every schema thing visible to the viewer (all public schemas for an anonymous caller): (1) one document fetch per schema — the `{shareId, createdAt}` projection is not covered, since the visibility `$or` touches `acl`/`visibility` which are absent from the `{thingtime:1, createdAt:-1, shareId:1}` index at collections.ts:427, so Mongo materialises every matching doc before projecting; (2) an `$in` of all N shareIds against the reaction partition — index-served via `{targetId:1, thingtime:1, ...}` (collections.ts:442), so N index seeks rather than a collection scan, but still linear in N; (3) a full in-memory …

      *Proposed fix.* Add the bounded candidate window the file already claims to have, matching the established in-repo pattern (search.ts:97/561-564, things.ts:349/2077): introduce `const POPULAR_CANDIDATE_WINDOW = 500;` and change line 198 to `collection.find(match as any).project({ shareId: 1, createdAt: 1 }).sort({ createdAt: -1, shareId: 1 }).limit(POPULAR_CANDIDATE_WINDOW).toArray()`. The sort is served by the existing `{thingtime:1, createdAt:-1, shareId:1}` index at collections.ts:427, so no new index is needed. Critically, the offset must be reconciled with the window or the change introduces dead pages: `POPULAR_MAX_OFFSET` is 500 while a 400-wide window would leave offsets 400-500 returning nothing. …

- [ ] **resolveViewStats re-aggregates one postViews doc per unique viewer on every feed render**  
      `remix/app/api/utils/things/views.ts:166` · **Medium** · fix safety: needs-care

      *Impact.* Every post-returning API response pays a MongoDB aggregate whose document-fetch count equals the total number of unique viewers across the posts on the page. The index {postId:1, viewerKey:1} makes the match an IXSCAN but cannot cover the group (impressions/dwellMs are non-indexed), so it is a real FETCH per viewer document. A 20-post feed at 1,000 unique viewers/post = ~20,000 doc fetches per render, per viewer, per scroll page; a single 100k-viewer post = ~100k fetches (~12-16 MB scanned) on every render that includes it. Cost is unbounded and grows monotonically with product success, since postViews docs never expire. This runs on the chronological feed, ranked feed, profile lists, …

      *Proposed fix.* Denormalize the rollup, but NOT into `crystal`. The finder proposed `crystal.viewCount` / `crystal.impressions` / `crystal.dwellMs`; `crystal` is a client-supplied patch object merged over the doc on own-thing PATCH (things.ts:3444: `const patch = input.crystal && typeof input.crystal === 'object' ... `), so an owner could PATCH their own view count directly. That would defeat anti-manipulation layer 3 ("owner self-views dropped entirely") documented at views.ts:18. Put the rollup in a server-only top-level field the update sanitizer never accepts (e.g. `viewStats: { uniques, impressions, dwellMs }`) and confirm it is not writable through any thing-update path. Then in recordPostViews …

- [ ] **enforceReactionCaps adds 4 serial round trips plus two unbounded distinct() scans before every reaction write**  
      `remix/app/api/utils/things/things.ts:1977` · **Medium** · fix safety: needs-care

      *Impact.* Every reaction add pays, inside enforceReactionCaps alone, 3 round trips minimum and 4 when the emoji is new to the post (2 parallel per-user counts, then countDocuments on crystal.emoji, then sequentially countDocuments on the legacy kind branch, then 2 parallel distinct()). In-region (syd1 <-> Atlas Sydney) that is roughly 4-12ms of latency, not the ~840ms claimed. The real cost is scan volume: none of the three v2-era queries can use the things_reaction_unique partial index (no crystal.emoji predicate), so each falls back to {targetId, thingtime, createdAt, shareId} and, because that index lacks ownerId and crystal.emoji, does a full FETCH of every reaction document on the target. A post …

      *Proposed fix.* Two-part, and only part one is mechanical. (1) Safe now: collapse the era check into one query - countDocuments({$or: [{targetId: targetShareId, thingtime: 'reaction', 'crystal.emoji': token}, {kind: 'reaction', parentId: targetShareId, token}]}, {limit: 1}) - semantically identical to the `||` truthiness test, one round trip instead of two sequential. (2) The real win is index coverage, not query rewriting: add col.createIndex({targetId: 1, thingtime: 1, 'crystal.emoji': 1, ownerId: 1}) in ensureIndexes (remix/app/api/utils/mongodb/collections.ts, beside the existing {targetId, thingtime, createdAt, shareId} entry). That makes all three v2 cap queries covered (no FETCH), lets the …


## Database — connection lifecycle and cold start

- [ ] **getMongoStatus opens and closes a brand-new MongoClient on every page view**  
      `remix/app/api/utils/mongodb/status.ts:58` · **Critical** · fix safety: needs-care

      *Impact.* Every full page load on every route except /messages triggers TWO uncached `/api/v1/health/mongodb` requests (the effect re-fires when `targetOrigin` resolves post-mount; the client-side `xhr.abort()` does not cancel the server work), and each one builds and tears down a fresh authenticated MongoClient instead of using the memoised pool sitting in the same process. Per call that is ~5-6 wasted round trips beyond the 3 the check actually needs — SRV + TXT DNS, TCP handshake, TLS handshake, driver `hello`, SCRAM-SHA-256 saslStart/saslContinue — plus TLS/SCRAM CPU, then the authenticated connection is discarded. In-region (syd1 ↔ Atlas Sydney) that is roughly 20-40 ms wasted per call, ~40-80 …

      *Proposed fix.* In remix/app/api/utils/mongodb/status.ts, replace the throwaway-client block (lines 53-63 and the `finally` close at 97-103) with the memoised pool. Use the already-exported `getThingtimeDb()` from `./collections` rather than the finder's `getClientCachedFor(...)`, which is not exported: import { getThingtimeDb } from './collections'; ... const db = await getThingtimeDb(); // active plane: home, or the request's override const start = Date.now(); await db.command({ ping: 1 }); const pingMs = Date.now() - start; const collections = (await db.listCollections().toArray()).length; const hello = await db.command({ hello: 1 }).catch(() => null); Delete the `let client: any`, the `new …

- [ ] **maxPoolSize:10 caps concurrent DB work per instance on Fluid compute**  
      `remix/app/api/utils/mongodb/collections.ts:41` · **High** · fix safety: needs-care

      *Impact.* Every home-database request shares a 10-connection pool per Fluid instance, a number chosen on 2026-07-29 for one-request-per-instance serverless and never revisited when Fluid compute was enabled on 2026-08-08 (665e2d28). Ceiling is ~10 simultaneous in-flight DB operations per instance regardless of how many invocations Fluid multiplexes into the process. In steady state post-syd1 (2-5ms/op) that supports roughly 5-10 concurrent requests before checkout queueing begins, with each queued checkout costing one op duration (~2-5ms) — modest. The real exposure is at the tail: the 50 `withMongoTransaction`/`withHomeMongoTransaction` call sites pin a connection for an entire snapshot-read + …

      *Proposed fix.* Two separable changes at collections.ts:37-48, of different risk: (a) Low risk, do first: add `waitQueueTimeoutMS: 5000` to the home options. This does not change capacity, only the failure mode — pool starvation becomes a fast, attributable driver error instead of an indefinite hang. Note it converts some current slow-successes into errors, so confirm the API error paths surface it sanely (the rate limiter already has fail-open/fail-closed semantics in rateLimit/enforce.ts that will now see a throw). (b) Needs verification before landing: raise `maxPoolSize` (driver default is 100; 25-50 is a sane middle) and add `minPoolSize: 5`. This MUST be checked against the actual Atlas tier's …

- [ ] **Rate limiter costs two sequential round trips and two pool checkouts per mutating request**  
      `remix/app/api/utils/rateLimit/enforce.ts:61` · **Medium** · fix safety: needs-care

      *Impact.* Every rate-limited request pays one strictly sequential, behaviourally-redundant MongoDB round trip and one extra checkout from the home client's 10-connection pool (maxPoolSize:10, mongodb/collections.ts:41) before the route does any work; rejected requests pay two extra (the trailing findOne at :78). This fires on all 154 enforceRateLimit call sites under app/routes/api/v1/, including high-frequency polling reads — notifications.list (bell poll, 120/min budget), chats.read (240/min), chats.message (120/min), things.views, things.search, and oauth.read on app-token GETs — so it is not confined to mutations. Concretely the limiter costs 2 DB ops where 1 suffices: a 2x reduction in limiter …

      *Proposed fix.* Collapse enforce.ts consume() to a single findOneAndUpdate with upsert:true and a pipeline update, filtering on {key} alone. Do NOT keep the limit test in the filter: rateLimits has a unique index on key (collections.ts:798), so an unmatched filter plus upsert throws E11000 on every over-limit request. Move the test into the pipeline, e.g. requests: {$cond: [{$lt: [{$size: activeRequestsExpr(windowStart)}, limit]}, {$concatArrays: [activeRequestsExpr(windowStart), [now]]}, activeRequestsExpr(windowStart)]}, and set updatedAt/expiresAt unconditionally so TTL refresh behaviour is preserved. Array length alone cannot distinguish "admitted at limit-1" from "rejected at limit", so also set an …


## API — per-request handler work

- [ ] **Rate limiter does two sequential writes per call; 73 API routes pay it**  
      `remix/app/api/utils/rateLimit/enforce.ts:61` · **High** · fix safety: needs-care

      *Impact.* Every rate-limited request pays 2 sequential writes to the home cluster's rateLimits collection instead of 1; a blocked request pays 3 (write, write, read). That is one unavoidable extra serialized DB round trip on 154 call sites across 73 v1 route files, all enabled by default — including the pollers (notifications.list, chats.read at 240/min) and every mutation (things.react/save/write, chats.message). Cost is one full DB RTT per request: ~1-3ms same-region, but ~200ms+ if the app region and Atlas region are mismatched (a previously measured failure mode in this repo), where it alone roughly doubles the pre-handler latency of e.g. POST /api/v1/things/react. Secondary write amplification: …

      *Proposed fix.* Do NOT apply the finder's fix verbatim. `rateLimits` has a UNIQUE index on `key` (collections.ts:798). If you drop the priming write and give the single findOneAndUpdate `upsert: true` with an `$or`/`$expr` filter, then on the blocked path (doc exists but is over limit) nothing matches, Mongo attempts an insert, and it throws E11000. That exception propagates to enforceRateLimit's catch, which fails OPEN for ordinary endpoints — silently disabling rate limiting exactly when a caller is over the limit. That is a security regression, not just a bug. Safe shape instead: (1) run the existing findOneAndUpdate FIRST with no upsert; (2) if it returns a doc, done — 1 round trip in the steady state; …

- [ ] **resolveActor resolves the session twice for every Bearer-token request**  
      `remix/app/api/utils/auth/resolveActor.ts:72` · **High** · fix safety: needs-care

      *Impact.* Affects exactly 8 call sites in 6 route files, all of which pass thingsScope: things/_things.tsx:88 (GET) and :180 (CRUD POST/PUT/DELETE), things/update/_update.tsx:18, things/delete/_delete.tsx:16, things/comment/_comment.tsx:22, things/search/_search.tsx:77 and :114, things/react/_react.tsx:21. CORRECTIONS to the finder: (1) /things/feed and /things/save are NOT affected — they import resolveThingsActor from patTokens directly (_feed.tsx:41, _save.tsx:12) and resolve once; (2) /things/bulk is NOT affected — it uses getCurrentUser (_bulk.tsx:14), so the "this is exactly the bulk-write traffic" framing is wrong; (3) app tokens themselves are NOT affected — they return early at …

      *Proposed fix.* Do NOT rewrite the three resolvers into one merged branch — resolveAppToken and resolveThingsActor have other callers (things/feed, things/save, tokens introspection at patTokens.ts:339) and each carries security checks that must survive verbatim: the claims.sub-vs-session.userId binding (appTokens.ts:111, patTokens.ts:269), the Bearer-only re-check for PATs (patTokens.ts:281-283), sandbox-user synthesis, findAppByClientId/appAllowsOrigin/appIsRevoked, and resolveSessionUser's explicit rejection of app/app-sandbox/pat purposes. Safer shape: resolve {claims, session} once at the top of resolveActor (only when an Authorization: Bearer header is present, so cookie behaviour is byte-identical), …

- [ ] **Every attachment/image fetch pays the full auth chain plus a fail-closed rate-limit write before a 302**  
      `remix/app/routes/api/v1/attachments/content/_content.tsx:24` · **High** · fix safety: needs-care

      *Impact.* 7 sequential DB round trips (8-9 total ops) to produce a 302 redirect, on a route hit once per post attachment AND once per distinct profile avatar/banner rendered. Breakdown: sessions.findOne -> findUserById -> getSubscription (1-2 findOne, entirely unused here — the route only reads user.id/username/accountKind) -> limiter updateOne -> limiter findOneAndUpdate -> attachment getById -> canViewTarget findOne. Amplified by Cache-Control: private, no-store, max-age=0 on the redirect (attachmentResponses.ts:5), which forbids browser caching and forces the full 7-RT chain again on every re-render, remount, and back-navigation — even though the presigned URL it returns is valid for 10 minutes. A …

      *Proposed fix.* Apply the low-risk subset first, and treat two parts of the original proposal as hazardous. SAFE: (1) In resolveSessionUser (auth/getCurrentUser.ts:28), Promise.all([getLiveSession(jti), findUserById(expectedUserId)]) — both inputs come from the JWT claims alone, so they can run concurrently as long as every rejection guard (session exists, session.userId === expectedUserId, purpose not app/app-sandbox/pat, user exists, serviceAccountAuthenticationAllowed) still runs in the same order before returning; costs one wasted read on the reject path. (2) Add a lean getCurrentUser variant that returns only {id, username, accountKind} and skips toPublicUserWithStorage/getSubscription, and use it …

- [ ] **resolveAppToken serializes the app lookup and the user lookup, then adds a subscription read**  
      `remix/app/api/utils/apps/appTokens.ts:135` · **Medium** · fix safety: needs-care

      *Impact.* Every app-token request pays 4-5 SERIALIZED indexed round trips just to establish the actor, before its own rate limiter (2 more writes) and the actual data read. Two of those trips are removable outright. Parallelizing the app+user reads saves 1 RT; replacing toPublicUserWithStorage with toPublicUser(user, null) saves 1-2 more (getSubscription is 1 RT for a trusted ledger doc, 2 sequential when it falls back to the initialSubscription seed lookup). Net: 4-5 serialized RTs collapse to 2 (session, then app+user in parallel) — a ~50-60% cut in pre-route latency on /oauth/userinfo, /oauth/shared, /app-data GET/POST/delete/usage/shared, and every app-token /things* call. With vercel.json …

      *Proposed fix.* Two independent changes, both in resolveAppToken (appTokens.ts:135-147). 1. Parallelize the two independent lookups (safe, purely mechanical): const [app, user] = await Promise.all([findAppByClientId(clientId), findUserById(claims.sub)]); if (!app || !appAllowsOrigin(app, origin)) return null; if (appIsRevoked(app)) return null; if (!user) return null; Keep the app checks BEFORE the !user check so the rejection ordering and error semantics are unchanged. Note this now always issues the user read even when the app check fails — one extra indexed read on the rejection path, no correctness or disclosure change (the user doc never escapes the function). 2. Drop the subscription trip: replace …

- [ ] **POST/PUT/PATCH /api/v1/things buffers and parses the whole body with an uncapped request.json() before any auth**  
      `remix/app/routes/api/v1/things/_things.tsx:178` · **Medium** · fix safety: needs-care

      *Impact.* Pre-auth, unauthenticated body buffering + JSON.parse on the repo's primary CRUD mutation endpoint. The Content-Length pre-check at line 166 is the only size guard and is skipped entirely by a chunked-transfer request (no content-length header, so Number(null || 0) === 0 passes), letting an anonymous caller reach line 178 before resolveActor (180) and the 401 (182). On production (Vercel Fluid, syd1) the gateway's ~4.5 MB function request-body limit bounds each request to roughly 6x the intended 768 KB MAX_BODY_BYTES, so this is a bounded overrun rather than unbounded heap; it still matters because Fluid packs concurrent invocations into a single instance's memory, so concurrent oversized …

      *Proposed fix.* Do NOT use the finder's suggested `readJsonBody(request, MAX_BODY_BYTES)` verbatim — it throws a bare 413 with no CORS headers, and this route is cross-origin (appDataPreflight line 161, appCorsHeaders on the existing 413 line 170), so cross-origin callers would see an opaque fetch rejection instead of the readable 413 JSON. That exact regression is what remix/app/api/utils/apps/cors.ts:35-39 documents and guards against. Instead, at line 178 replace `const body = await request.json().catch(() => ({}));` with `const body = await readJsonBodyWithCors(request, MAX_BODY_BYTES, appCorsHeaders(request.headers.get('Origin')));` and add `readJsonBodyWithCors` to the existing …

- [ ] **users/relationships serializes three independent awaits**  
      `remix/app/routes/api/v1/users/relationships/_relationships.tsx:22` · **Medium** · fix safety: needs-care

      *Impact.* Removes 1 of ~8-9 sequential Mongo round trips (~11%) from GET /api/v1/users/relationships, i.e. roughly 1-3ms in-region (syd1 -> Atlas Sydney). Applies to the profile page's background relationship reconcile, which already paints from localCache, so it is a server-latency/serverless-compute saving rather than a first-paint win except on a cold cache. Severity is closer to low than medium.

      *Proposed fix.* Hoist the URL parse and start the target lookup alongside auth, keeping the limiter gate before relationshipSummary: `const params = new URL(request.url).searchParams; const targetPromise = resolveSocialTarget({ userId: params.get('userId') || undefined, username: params.get('username') || undefined }); const user = await getCurrentUser(request); const limit = await enforceRateLimit(request, 'users.relationships', user ? `user:${user.id}` : null); if (!limit.allowed) { targetPromise.catch(() => {}); return json(...); } const result = await relationshipSummary(user?.id || null, await targetPromise);` Note this makes a throttled request still perform one user lookup, which slightly weakens …


## API — caching and cache headers

- [ ] **/api/v1/health/mongodb opens a brand-new MongoClient per request, bypassing the memoised connection cache**  
      `remix/app/api/utils/mongodb/status.ts:58` · **High** · fix safety: needs-care

      *Impact.* Every page load that renders the footer builds and tears down a whole MongoClient server-side. Cost per check, over the pooled alternative: for a mongodb+srv URI, an SRV + TXT DNS resolution (not cached by the driver across clients); TCP + TLS handshake; the driver handshake `hello`; SCRAM-SHA-256 (saslStart + saslContinue) — roughly 5 network round trips before the first useful command. Then 3 more commands (ping, listCollections, hello) and a close. The driver also starts topology monitoring, opening a monitor connection per replica-set member (3 on a standard Atlas RS), so one footer render churns ~4 connections rather than one. Going through the existing cache would cost 1-2 round trips …

      *Proposed fix.* Route getMongoStatus through the memoised cache instead of `new MongoClient` + `close()`, but do NOT do a blind swap to `getThingtimeDb()`. Two behaviours are load-bearing and must be preserved: (1) the deliberate 2000 ms serverSelection/connect fail-fast documented at status.ts:26-29 — the cached client uses 5000 ms, so an unreachable endpoint would stall the footer request 5 s instead of 2 s; (2) `getThingtimeDb()` has side effects on a custom endpoint (`ensureCustomDataIndexes(uri, db)`, collections.ts:200) and triggers the home adoption pass — a read-only status probe should not create indexes in a user-supplied database. Preferred shape: export a thin cached-client accessor from …

- [ ] **Production build emits and deploys 10.6 MB of source maps as public static assets**  
      `remix/vite.config.ts:184` · **Low** · fix safety: needs-care

      *Impact.* Every production build emits 139 source maps totalling 12.26 MB alongside only 4.42 MB of JS — maps are ~2.8x the shipped JS payload. All 12.26 MB is copied into .vercel/output/static by Nitro's publicAssets (dist -> '/') and uploaded/stored on every deploy to every branch and preview, and each map is publicly fetchable because the emitted JS carries a `//# sourceMappingURL` comment and the filesystem route serves /assets/* before the SPA fallback. Largest single map is index-BHYVSjYE.js.map at 3.4 MB. End-user latency is unaffected (browsers request .map only with devtools open); the real cost is deploy artifact size/upload time on the hot deploy path plus publication of full …

      *Proposed fix.* Do NOT use the finder's primary suggestion of `sourcemap: 'hidden'` — it only drops the `//# sourceMappingURL` comment while Vite still writes all 139 maps into dist, Nitro still copies them into .vercel/output/static, and they remain fetchable by name, so it saves zero deploy bytes. To actually remove the cost, set `sourcemap: false` in remix/vite.config.ts:184 (optionally gated so local/dev builds keep maps, e.g. `sourcemap: process.env.VERCEL !== '1'`), or leave generation on and delete/exclude `*.map` from `.vercel/output/static` inside remix/scripts/patch-vercel-output.mjs before staging. Nothing consumes the maps today — no Sentry/Bugsnag/Rollbar or upload step exists in …


## Frontend — re-render cost

- [ ] **ThingtimeContext value is a fresh object literal every provider render**  
      `remix/app/Providers/ThingtimeProvider.tsx:506` · **Critical** · fix safety: risky

      *Impact.* Every `setThingtime` (one per keystroke batch, undebounced) re-renders ThingtimeProvider and allocates a fresh `{ Everything }` context value, waking all 29 `useThingtime()` subscribers unconditionally. Since `props.children` keeps a stable element identity, this wrapper is the sole propagation channel — so the fan-out is all-or-nothing with zero granularity. Worst case is the editor: `Thingtime` is recursive, un-memoized, and subscribes at line 179, so a keystroke re-renders O(nodes in tree) components, each of which also runs the large `useMemo` at lines ~880-915. Concurrently, every mounted non-editor consumer (Nav, drawer, the 8 useTtTheme call sites, DevKit, EasterEggs, Commander) …

      *Proposed fix.* Do NOT apply the naive `useMemo` — it is a no-op here (thingtimeState and paths are new objects on every set). Two viable steps: (1) Cheap and safe: wrap non-tree leaf reads in a selector, or split the context into a stable API context (`setThingtime`, `getThingtime`, `thingtimeRef`, `events` — all already `useCallback`/ref-stable, memoize with `[]`-ish deps) and a data context (`thingtime`, `loading`, `paths`). Dispatch-only and leaf-only consumers subscribe to the API context and stop re-rendering on data changes. This must be mirrored in `LocalThingProvider` (ThingView.tsx:137), which supplies the same context to feed sandboxes, or feed cards break. (2) Independently, wrap the recursive …

- [ ] **setSessionEventCount fires on every engagement event, re-rendering the entire feed page**  
      `remix/app/components/Feed/useFeedEngagement.ts:73` · **High** · fix safety: needs-care

      *Impact.* Each recordEvent bumps FeedPage state, re-rendering FeedPage -> PostList -> all N PostCards (memo defeated by the inline onChanged closure at PostList.tsx:82) and detaching/re-attaching all N card refs, each of which runs observeView's O(N) isConnected sweep. With 100 loaded posts (5 pages of 20, no virtualization), ONE counter increment costs ~100 full PostCard renders (PostCard is a ~1000-line Chakra component) plus ~10,000 DOM isConnected checks. Dedup bounds the session at ~2 increments per post, so a first-pass scroll of 100 posts produces up to ~200 increments -> on the order of 20,000 PostCard renders and ~2M isConnected checks, all to increment a number that is only read inside an …

      *Proposed fix.* Preferred: throttle/coalesce the state write rather than change the hook's public API. Keep sessionEventsRef as the source of truth and publish the count at most once per ~1-2s (or via useSyncExternalStore with a getSnapshot reading sessionEventsRef.current.length), so a scroll burst yields one render instead of one per event. The alternative (replace sessionEventCount with getSessionEventCount()) is also viable but touches three files and depends on AlgorithmMenu re-rendering on open for the isDisabled/badge values to be fresh — verify that before adopting it. Note the two real amplifiers are separate fixes worth doing regardless: hoist a stable per-post onChanged (and the ref callback) in …

- [ ] **paths recomputes an O(N²) full-tree walk of the entire thingtime object on every mutation**  
      `remix/app/Providers/ThingtimeProvider.tsx:326` · **High** · fix safety: needs-care

      *Impact.* A full synchronous walk of the entire thingtime object runs in the ThingtimeProvider render body on every setThingtime flush — i.e. every keystroke in the tree editor (MagicInput onInput → Thingtime.tsx:921, undebounced) — and can never be memo-skipped because setThingtimeObjectWrapper always spreads a fresh root. Cycle detection uses an Array with `includes`, making it O(N²) reference comparisons. Critically, the walked tree is not bounded by the ~196 defaults keys: the undo/redo timemachine lives inside the thingtime object and `timeline.past` is uncapped and persisted to localforage, so it gains 1-2 object nodes per keystroke and never shrinks across sessions. Measured on a …

      *Proposed fix.* Two steps, in order. (1) Mechanical: change `seen = []` to `seen = new Set()` and `!seen?.includes(val)` / `seen.push(val)` to `!seen.has(val)` / `seen.add(val)` in populatePaths (ThingtimeProvider.tsx:306-324). Removes the quadratic term; measured ~6.5x faster at 5k lifetime edits. (2) Reviewed: make paths lazy — keep a stable `getPaths()` callback that walks on demand and caches against the current thingtimeState identity, and switch CommanderV2.tsx:151, CommanderV1Deprecated.tsx:180 and EasterEggs.tsx:37 to call it (Commander should only build the Fuse index while the palette is actually open, since that index rebuild is now the dominant cost). Separately, and needing owner sign-off …

- [ ] **Recursive Thingtime tree component is unmemoized and subscribes to the whole context**  
      `remix/app/components/Thingtime/Thingtime.tsx:158` · **High** · fix safety: risky

      *Impact.* Every keystroke in any Thingtime value re-renders every visible node in the tree, not just the edited one. ThingtimeProvider.tsx:506 hands a fresh `{ Everything }` literal to the Provider on every render, so context identity changes unconditionally on each `setThingtime`; every node is a bare `useContext` consumer (Thingtime.tsx:179) with no `React.memo` anywhere in the file. Per node that re-render replays 18 useState + 31 useMemo + 7 useRef slots plus `useThings()`, `useLopu()` and a Chakra subtree; each node also mounts ~2-3 `<Icon>` instances which are themselves unmemoized consumers of the same context via `useTtIconStyle` (useTtTheme.tsx:184). A 200-node open tree therefore costs ~200 …

      *Proposed fix.* Do NOT apply mechanically — `React.memo` alone is near-worthless here and the context refactor is invasive. (a) React.memo is defeated at the recursion site as written. Thingtime.tsx:719-737 passes `seen={nextSeen}` (fresh array every render), `path={key}` (fresh object literal when `key.human` is falsy), `parent={thing}`, and `fullPath={[...fullPath, key.key]}` (fresh array). All four break referential equality, so wrapping line 158 in memo changes nothing until those are stabilised or a custom `areEqual` comparator is supplied that compares `safeJoin(fullPath)` rather than the array. Note also line 168 mutates `props.thing = props.value` after the spread. (b) Splitting the context is the …

- [ ] **Inline ref callbacks drive an O(n²) DOM sweep on every PostList render**  
      `remix/app/components/Feed/useViewTracking.ts:83` · **Medium** · fix safety: safe-mechanical

      *Impact.* Quadratic, but second-order in absolute terms — real waste rather than the bottleneck. Per PostList commit the sweep costs n² Map-entry visits plus n² `Node.isConnected` binding reads: 400 at n=20 (one page), 10,000 at n=100 (5 pages), 40,000 at n=200. At roughly 50-120ns per entry visit that is ~0.5-1.2ms per render at 100 posts and ~2-5ms at 200 — 3-30% of a frame budget, growing as the square of scroll depth. Scrolling a 100-post feed triggers ~200 such renders (2 per post, from the first-view and dwell-close engagement events), so ~1-2M wasted iterations across a session. Honest caveat that argues for low-medium rather than medium severity: every one of those renders also re-renders 100 …

      *Proposed fix.* Prefer the two-line reorder over the finder's ref-factory refactor: move `if (elementIdsRef.current.get(element) === thingId) return;` ABOVE the `elementIdsRef.current.forEach(...)` sweep in useViewTracking.ts:78-92, and make the identical move in useFeedEngagement.ts:123-136. The sweep then runs only when a genuinely new (element, id) pair registers — i.e. n times per page append instead of n times per render — which is exactly the situation the sweep's comment describes ("filter/algorithm resets"), so its detached-node cleanup purpose is fully preserved. This removes essentially all the waste without touching PostList at all. Memoising a per-post-id ref-callback map in PostList is a valid …

- [ ] **useApi rebuilds a 101-callback nested object tree on every render of all 49 consumers**  
      `remix/app/hooks/useApi.tsx:51` · **Medium** · fix safety: needs-care

      *Impact.* Every `useApi()` call allocates, per render: 101 inline arrow closures, 101 `[asyncFetcher]` dep arrays, and ~15 nested object literals — roughly 220 short-lived allocations plus 101 hook-slot reads, none of which ever hit a memo fast path because `useAsyncFetcher` returns an unmemoized object literal. A 100-post cold feed mount runs this ≥100 times (PostCard has two `useApi()` call sites, lines 585 and 1069) for ~22,000 allocations — real but modest, low single-digit milliseconds of young-gen garbage, not a dominant cost. PostCard's `React.memo` means this does NOT recur on every scroll frame.

      *Proposed fix.* The fix must start one level down, at `useAsyncFetcher`, or nothing improves: 1. `remix/app/hooks/useAsyncFetcher.tsx:67` — return `useMemo(() => ({ submit, setDefaultOpts }), [submit, setDefaultOpts])`. `submit` already depends only on `defaultOpts` state, and nothing in the app calls `setDefaultOpts`, so `asyncFetcher` becomes genuinely stable for the process lifetime. 2. Only then does `remix/app/hooks/useApi.tsx` benefit: wrap the return as `useMemo(() => ({ v1 }), [asyncFetcher])`. With step 1 in place all 101 leaves are stable, so this actually holds. Do NOT hoist to a module-level singleton as originally proposed — `submit` closes over `useState`, so it cannot leave React. Optional …


## Frontend — data fetching

- [ ] **PostCard prefetches whole comment threads on mount, one HTTP GET per shipped comment, before comments are even opened**  
      `remix/app/components/Feed/PostCard.tsx:1093` · **Critical** · fix safety: needs-care

      *Impact.* Ungated, speculative, on-mount request fan-out on the main feed render path, proportional to comment depth rather than to anything the user asked for.

      *Proposed fix.* Gate on user intent and bound the fan-out. The strongest argument for safety, which the finder missed: PostCard.tsx:731 ALREADY calls prefetchNextDepth(api, fetched) inside fetchThread's success handler, so the "stay one depth ahead" cascade is already implemented on the reveal path. Gating the mount-time effect therefore does not lose that capability — it is largely redundant with existing lazy behaviour. Recommended: move the body of the effect (PostCard.tsx:1093-1103) into toggleComments (PostCard.tsx:1285), keeping the prefetchedPostRef one-shot guard so a reopen does not refire it. This does NOT violate the optimistic-rendering house rule: level-1 comments already ship inside the feed …

- [ ] **ChatView re-downloads the entire 40-message page (plus members, emoji map, all reactions) every 4 seconds — no incremental/since parameter**  
      `remix/app/components/Messenger/ChatView.tsx:122` · **High** · fix safety: needs-care

      *Impact.* Per open, visible chat: 15 requests/minute, each a full recomputation. Server cost per poll, counted from messenger.ts: ~11 Mongo queries across ~7 sequential await stages — findThingByKind('chat') and getChatMemberDoc (resolveChatAccess, :292-301), the messages find (:1115-1119), projectMessages' 4-way parallel reactions find + thread-count aggregate + replyTo find + attachments find (:939-970), listChatMemberDocs (:1134), resolveProfiles (:1136), and the paired read-receipt lookups (:1137). That is ~165 queries and ~105 sequential DB round trips per minute per viewer, all to re-derive data the client already holds.

      *Proposed fix.* Do NOT apply the proposed `since` parameter mechanically — a createdAt-based delta is silently incorrect here. The payload carries mutable state that changes without any new message: editedAt/text on edit (editMessage), the `deleted` flag, reactionCounts and viewerReactions (react), threadCount/threadLastAt, and every other member's lastReadMessageId/lastReadAt (markRead — read receipts are exactly what the 4s poll exists to surface). A `since=<newest createdAt>` filter would freeze edits, deletions, reaction chips and read receipts for anyone who does not scroll or send. A correct incremental endpoint needs a monotonic updatedAt/version stamp written on every mutation path plus separate …

- [ ] **Feed page never seeds from the localCache tier — every mount clears to a skeleton and refetches page 1**  
      `remix/app/components/Feed/Feed.tsx:40` · **High** · fix safety: needs-care

      *Impact.* Every remount of /feed (post permalink and back, /messages -> /feed, tab switch through any other route) paints three skeleton cards and re-issues GET /api/v1/things/feed?limit=20. For authenticated viewers there is no cache at any tier: the response carries 'private, no-store', useApi's things.feed is a bare getJson, and no localCache seed exists. Each of those requests costs roughly 5-6 serial Mongo round trips inside getFeed/toPublicPosts: withFriendIds, the feed query itself, then (on the ranked path, which is the default whenever the viewer has an activeFeedAlgorithmId) a RANKED_CANDIDATE_WINDOW=400-document candidate scan plus in-process rescoring followed by a SECOND find for the 20 …

      *Proposed fix.* Seed the pager from the synchronous localCache tier, following the SearchPage.tsx precedent rather than the finder's one-liner. (1) Key per viewer AND algorithm, e.g. `tt-feed-${user?.id ?? 'anon'}` combined with the algorithm id, and clear the key on logout / viewer change (SearchPage.tsx:292-295 purges a legacy unscoped key for exactly this reason) so one account's circle-visible posts can never paint for the next account on a shared device. (2) Store a cachedAt timestamp alongside the posts and pass it to mergeReactionOverlays on read, the way threadCache.ts stamps entry.at — without it a cached copy older than the viewer's last reaction tap will paint stale reaction state. (3) …

- [ ] **ProfilePage serializes two independent requests: posts wait for the profile fetch to resolve**  
      `remix/app/components/Profile/ProfilePage.tsx:156` · **Medium** · fix safety: needs-care

      *Impact.* Every view of another user's profile pays one avoidable serial client round trip before the page's main content (posts) even starts loading. The real endpoints are GET /api/v1/users/profile?username= and GET /api/v1/things/user?username=. The finder's 300-500ms figure is stale — it cites the iad1-vs-Atlas-Sydney mismatch, but root vercel.json now pins "regions": ["syd1"], co-located with the Atlas cluster, so the extra hop is a client-to-edge round trip, not a cross-region DB hop. Server-side the profile call is cheap (findUserByUsername issues two parallel queries, then one countPublicPosts) — order 10-30ms of in-region DB. The dominant term is client RTT plus TLS/HTTP overhead: roughly …

      *Proposed fix.* Set postsUsername from the `username` prop directly (falling back to user.username in self mode) so both fetches start from the same render, but do NOT rely on generationRef to clean up the missing-user case — the finder's justification is wrong. generationRef only increments when postsUsername/loadPage/appliedAdvanced change; if postsUsername is the URL param it does not change when the profile resolves to 'missing', so the stale-response guard never trips and loadPage's catch block (lines 221-232) will fire the user-facing lopu toast 'Could not load posts 😔' on every nonexistent-profile view. That is exactly the regression the comment at lines 154-155 was written to prevent. The fix must …

- [ ] **Every read-receipt advance triggers a full messenger list refresh (2 extra GETs) on top of two active polls**  
      `remix/app/components/Messenger/ChatView.tsx:166` · **Medium** · fix safety: needs-care

      *Impact.* Per NEW message in an open, visible chat (not per poll — readMarkRef dedupes). Incoming message: 1 POST /api/v1/chats/read + GET /api/v1/chats (7 sequential Mongo round-trip stages: memberships find, chat docs find, unread aggregate, member docs find, member-count aggregate, resolveProfiles, receipts pair) + GET /api/v1/communities (2 stages, fully redundant — reading a message cannot change the community list) + 2 auth lookups, ~10 sequential DB round trips of which ~3 are pure waste. Outgoing message is 3x worse: ChatView.tsx:286-289 fires props.onChatsChanged() and emitMessengerRefresh() back to back, both hitting the same MessengerPage refresh() listener, then the pending->real id swap …

      *Proposed fix.* Three changes, in increasing risk order. (1) Split MessengerPage.refresh() into refreshChats() and refreshCommunities(); refreshChats keeps setChats/setRequestsCount/writeChatList/writeUnread and the thingtime:messenger-unread dispatch (all derived from chatsPayload), refreshCommunities keeps setCommunities/writeCommunities, and BOTH keep the Unauthorized -> navigate('/login') catch. Point onChatsChanged (MessengerPage.tsx:281) at refreshChats only. (2) Remove the duplicate fan-out on send: ChatView.tsx:286-289 calls props.onChatsChanged() and emitMessengerRefresh(), and both resolve to the same MessengerPage refresh listener — drop one (keep emitMessengerRefresh if other listeners are …


## Frontend — bundle size and code splitting

- [ ] **apiDocs.ts (7,565-line server route registry) ships to every browser**  
      `remix/app/routes/docs/DocsLayout.tsx:19` · **High** · fix safety: needs-care

      *Impact.* Understated by the finder, not overstated. Measured with the repo's own esbuild (tree-shaken probe importing only `apiEndpointDocs`, --bundle --minify): 257,750 bytes raw / 70,962 bytes gzip — roughly 2.3x the claimed 112,578 / 31,499. Source file is 7,565 lines / 326,754 bytes. Three corrections/additions to the finding: (1) There are TWO independent eager entry points into apiDocs.ts, not one. Besides DocsLayout, remix/app/routes/tests.tsx:18 imports `~/tests/api/apiTests`, whose line 2 imports apiEndpointDocs and whose line 122 flatMaps it into apiDocsSmokeTests at module scope. TestsPage is also a static import in routes.tsx, so lazy-splitting only the /docs subtree will NOT remove the …

      *Proposed fix.* Prefer the route-splitting variant, and make it cover both entry points. In remix/app/routes.tsx convert the entire `docs` subtree (DocsLayout, DocsIndex, DocsApi, DocsEmbed, DocsDesign, DocsDesignSystem, DocsConcepts, DocsSchemas) AND the `tests` route (TestsPage) from static imports to React Router `lazy` route objects. That alone evicts apiDocs.ts, docsSearchIndex.ts and app/schemas/registry.ts from the entry chunk with no change to apiDocs.ts itself. Verify with `npm run build:client` and grep the entry chunk for a distinctive apiDocs string literal to confirm eviction. Two constraints the finder's alternative fix misses: (a) nitro.config.ts:3 imports `apiV1DocsRouteKeys, …

- [ ] **No manualChunks/vendor split — any app edit invalidates the whole 977 KB cached bundle**  
      `remix/vite.config.ts:182` · **High** · fix safety: needs-care

      *Impact.* Production `vite build` emits a single content-hashed entry chunk of 4,112,407 b raw / 1,150,623 b gzip (measured, gzip -9). Sourcemap attribution shows 3,996,743 of 7,466,231 source bytes (53.5%) come from node_modules — dependencies that change only on upgrade — concatenated into the same hashed file as application code. Any deploy touching one component rewrites that hash, so returning users refetch the entire ~1.10 MB gzip rather than a small app chunk; roughly 450-550 KB gzip of that is dependency code that could sit behind a stable long-lived hash. Important narrowing the original finding got wrong: a vendor split saves ZERO bytes on first load — this is purely a repeat-visit / …

      *Proposed fix.* Add build.rollupOptions.output.manualChunks to remix/vite.config.ts (inside the existing build block at lines 182-185), keeping emotion bundled together with Chakra and framer-motion in one chunk, and react/react-dom/react-router together in another. Do NOT apply mechanically: (1) the originally proposed `id.includes('/react/')` test is fragile under pnpm's `node_modules/.pnpm/react@18.3.1/node_modules/react/...` layout and relies entirely on clause ordering to avoid swallowing react-icons/react-router — prefer matching on the resolved package directory segment rather than a raw substring; (2) splitting Chakra/emotion/framer-motion across chunks is a known source of module-execution-order …

- [ ] **1,857-line /tests API fixture table shipped to all users**  
      `remix/app/routes.tsx:39` · **Medium** · fix safety: needs-care

      *Impact.* A developer-only, completely ungated API smoke-test console is shipped to 100% of users in the first-paint JS. Measured from the committed build (remix/dist/assets/index-CTp0qeNY.js, 4,112,407 bytes — the ONLY app chunk in dist/index.html, since app/routes.tsx has zero `lazy:` routes), sourcemap byte attribution gives: app/tests/api/apiTests.ts = 55,666 minified bytes, app/routes/tests.tsx = 10,761, app/tests/api/apiTestRunner.ts = 2,969. Total 69,396 minified bytes (~1.7% of the entry chunk, roughly 12-16 KB over the wire after gzip) parsed and evaluated on every cold load by every real user, none of whom can reach /tests meaningfully. Correction to the original claim: the apiDocs.ts …

      *Proposed fix.* Do NOT apply the fix as originally written — `lazy: () => import('./routes/tests')` would break the route. app/routes/tests.tsx has only `export default function TestsPage()` (line 82); React Router's `lazy` merges route-property exports (Component/loader/action/ErrorBoundary) from the resolved module and ignores `default`, so the route would render nothing and RR would warn about an unsupported key. Correct form: delete the static import at app/routes.tsx:39 and change line 187 to `{ path: 'tests', lazy: async () => ({ Component: (await import('./routes/tests')).default }) }`. This is the first lazy route in the codebase, so also (a) rebuild and confirm a new split chunk appears and that …

- [ ] **All six kind-renderer families statically loaded on every page**  
      `remix/app/components/Kinds/kindRegistry.tsx:58` · **Medium** · fix safety: risky

      *Impact.* Real but modest, and smaller than claimed. The three families a /login or /settings visitor never touches (Commerce 18,414 + Planning 17,770 + Knowledge 16,793) total 52,977 minified bytes, roughly 15 KB gzip — about 1.3% of the 1,154,775-byte gzip entry bundle. All of app/components/Kinds is 149,128 minified bytes (208,023 source bytes across 12 modules), which does make it one of the largest single app-code directories in the bundle. But the claim that removing the sampleKindThings barrel re-export keeps it "out of every barrel consumer's graph" is FALSE as measured: ConceptStories.tsx is itself in the entry chunk (confirmed via sourcemap sources), and with no route splitting the module …

      *Proposed fix.* Do NOT apply the proposed `await import('./kindRenderersCommerce')` change as written — it breaks rendering. ensureBuiltinKinds() is reached from four SYNCHRONOUS render-path callers: ThingView.tsx:241 `useMemo(() => resolveKindRender(thing), [thing])`, conceptBits.tsx:184 `resolveKindRenderer(props.thing)`, ConceptStories.tsx:635 `getKindRenderers().map(...)`, and RenderThing itself (kindRegistry.tsx:189). Making registration async makes the first call return null; ThingView's useMemo then caches that null keyed on `thing` with no re-render trigger, so the card stays blank permanently even after the import resolves. The header comment at lines 51-57 also documents a real production …

- [ ] **emojis-list array (31 KB) plus O(n) linear scan inside the shared Icon component**  
      `remix/app/components/Icon/Icon.tsx:222` · **Medium** · fix safety: needs-care

      *Impact.* ~30.9 KB raw / ~8.3 KB gzip of the root-imported `Icon-*.js` chunk (72% of that chunk's weight) is the emojis-list string array — 3,075 entries downloaded, parsed and allocated on every page load, because root.tsx statically imports Icon. Secondary: `emojis.includes(name)` at line 222 is a linear scan over 3,075 strings; measured 112µs to resolve 50 icons vs 2.2µs with a Set. Memoized on `[name]`, so this is a per-mount cost, not per render.

      *Proposed fix.* Only one third of the proposed fix is safe; apply that part alone. SAFE (mechanical): add a module-level `const EMOJI_SET = new Set(emojis)` and change line 222 to `if (EMOJI_SET.has(name))`. Identical semantics, keeps the `emojis` array in scope for the "random" branch at line 227. Saves ~110µs per 50 icons but saves ZERO bytes — the array still ships. DO NOT lazy-load emojis-list the way emojiData.ts does. That comparison is not apples-to-apples: emojiData.ts feeds an async picker panel, whereas Icon resolves its glyph synchronously inside `useMemo` and returns it for the current render. Making the lookup async means every emoji-character icon paints the 🤷‍♂️ fallback on first frame and …

- [ ] **9.9 MB of production sourcemaps published as public static assets**  
      `remix/vite.config.ts:184` · **Low** · fix safety: needs-care

      *Impact.* Every production build emits 12 MB of sourcemaps into `remix/dist/assets/` (16 files; `index-CTp0qeNY.js.map` alone is 10,675,721 bytes, ~2.6x the 4,112,407-byte JS bundle it maps). Since nitro.config.ts publishes all of `dist` as public assets, that ~12 MB — roughly half the 24 MB `dist` — is uploaded to Vercel's static store on every deploy and cached for a year. Verified present in real output: `.vercel/output/static/assets/index-Qc6TpQHw.js.map` = 6,769,847 bytes. The retained `//# sourceMappingURL=` comment in the shipped bundle means any devtools open or crawler can pull the full map, exposing complete pre-bundle client source. No consumer benefits: there is no Sentry or other …

      *Proposed fix.* Because nothing ingests these maps (no error-tracking dep in remix/package.json), the direct fix is `build.sourcemap: false` at remix/vite.config.ts:184 — one line, removes all 12 MB from the published output. Important correction to the original proposal: `sourcemap: 'hidden'` alone does NOT achieve the stated impact. It only strips the `//# sourceMappingURL` comment; the `.map` files are still written to `dist`, still uploaded by nitro's `publicAssets`, and still fetchable by guessing the hashed filename. If maps are wanted for future error reporting, `'hidden'` must be paired with either an upload-then-delete step or an explicit `*.map` exclusion in scripts/patch-vercel-output.mjs (which …


## Architecture — multi-node, cross-region and real-time

The cross-region half of this section has a companion proposal:
[docs/architecture/geo-distribution.md](../docs/architecture/geo-distribution.md).
Its Phase 0 is precisely the round-trip items below, so fixing them first is a
prerequisite there rather than a parallel effort.

- [ ] **All real-time messaging is client polling; the open-chat poll refetches the entire page every 4s**  
      `remix/app/components/Messenger/ChatView.tsx:122` · **Critical** · fix safety: needs-care

      *Impact.* Per open, visible chat tab: 15 GET /api/v1/chats/messages per minute, 30/min when a thread panel is open (second 4s poll at ChatView.tsx:538-544). Each request is 9 SEQUENTIAL Mongo round trips (13 queries total) — 2 for auth, 2 for resolveChatAccess, 1 page find, 1 batched projectMessages fan-out, 1 member list, 1 resolveProfiles, 1 receipts pair. That is ~135 sequential DB round trips per minute per idle open chat, ~270 with a thread open, and it is per browser tab, not per user.

      *Proposed fix.* The finder's proposed delta ("return only messages newer than the client's newest id") is NOT correct as stated and would silently break existing behaviour. Reactions live in separate `things` docs aggregated in projectMessages (reactionDocs), and edits/deletes mutate `crystal.editedAt` / `crystal.deletedAt` on EXISTING messages. Today those changes reach other viewers ONLY because the poll refetches the whole page with `replace: true`. An id-newer-than delta, and equally an ETag keyed on (chat.updatedAt, newest message id, member revision), would freeze reaction counts, edits and deletions for every other participant — a real regression, not a wash. A correct version must key the …

- [ ] **listMessages re-resolves the same profiles twice and re-reads the viewer's secure blob a third time, bypassing the receipts cache**  
      `remix/app/api/utils/messenger/messenger.ts:1136` · **High** · fix safety: needs-care

      *Impact.* listMessages is the 4s-poll endpoint behind every open chat (ChatView.tsx:25). Its serial DB stages are roughly: findThingByKind + getChatMemberDoc (2), message page find (1), projectMessages Promise.all of 4 queries (1 stage), resolveProfiles (1), emoji lookup (1), listChatMemberDocs (1), duplicate resolveProfiles (1), receipts stage (1) — about 8-9 serial stages. The two avoidable ones are therefore ~20-25% of the endpoint's serial DB stages. Absolute latency is much smaller than the finder implied: vercel.json now pins "regions": ["syd1"], co-located with the Atlas Sydney cluster, so an intra-region round trip is ~1-5ms rather than the historic ~209ms cross-region figure. Realistic …

      *Proposed fix.* Two independent fixes, different risk profiles. (A) Receipts — do NOT globally add caching to getUserReadReceiptsEnabled as proposed: chats/settings/_settings.tsx:14 uses it for the settings toggle GET, so a 60s process-local TTL would let a user's own toggle read back stale for up to 60s when the write and the read land on different serverless instances (setUserReadReceiptsEnabled only invalidates its own process). Fix it locally in messenger.ts instead: drop the getUserReadReceiptsEnabled(viewerId) call and derive the flag from the batch, e.g. `const memberReceipts = await getUsersReadReceiptsMap(memberIds.includes(viewerId) ? memberIds : [...memberIds, viewerId]); const viewerReceipts = …

- [ ] **Weekly-summary cron runs a serial per-recipient loop of 3 queries + one SES send, up to 2000 times, inside a single Vercel function invocation**  
      `remix/app/api/utils/notifications/weeklySummary.ts:186` · **High** · fix safety: needs-care

      *Impact.* Corrected numbers. (1) The claimed "~100-300ms per DB round trip / over an hour" is WRONG: vercel.json now pins "regions": ["syd1"], co-located with the Sydney Atlas cluster, so DB round trips are ~1-5ms. Both post queries are also fully index-supported by things `{thingtime:1, ownerId:1, createdAt:-1, shareId:1}` (collections.ts:428). loadPostsAndViews costs 2 serial hops per target (a parallel countDocuments+find, then the postViews count), so at the 2000 cap the DB N+1 is ~4000 hops x ~2-4ms = roughly 8-16 seconds, not an hour. (2) The finder UNDERSTATED the send phase, which is the real wall-clock risk: sendEmail (email/service.ts:98) is not one round trip but four serial ones per send …

      *Proposed fix.* Do not apply the proposed fix as written — three parts of it are unsafe. (a) The suggested cohort-wide `$match {postId: {$in: allPostIds}}` is dangerous: 2000 owners x MAX_POSTS_PER_USER_FOR_VIEWS (500) is up to 1,000,000 ids in a single filter, which blows the 16MB BSON document limit, and postViews is indexed `{postId:1, viewerKey:1}` (collections.ts:804) with no createdAt component, so the in-window filter is a post-scan. Batch in bounded chunks instead (e.g. 100-200 owners per aggregation pass), and roll views up to owner by joining on the owner's post ids within the chunk. (b) The suggested "small concurrency pool (5-10 in flight)" contradicts the load-bearing comment at :125-126 — …

- [ ] **trimRecipient fires a 3-round-trip cap sweep after every single notification emit**  
      `remix/app/api/utils/notifications/notifications.ts:88` · **Medium** · fix safety: safe-mechanical

      *Impact.* Every reaction, comment, reply, share and follow fires a fire-and-forget cap sweep that costs exactly 2 Mongo round trips (countDocuments then a skip-500 find) and deletes nothing in ~499 of 500 invocations. Server-side work is negligible — the { thingtime, ownerId, createdAt:-1, shareId } index (collections.ts:428) matches the sort exactly so there is no blocking sort, and the {_id:1} projection makes the skip a covered index walk of at most 500 keys. The real cost is network and connection-pool pressure: the sweep is void-launched so it does not lengthen the response, but it holds slots in the home client's maxPoolSize:10 pool (collections.ts:41) for the duration. On the deployed iad1 -> …

      *Proposed fix.* Delete the countDocuments guard and run the skip-500 find directly. When the recipient is under the cap the find returns an empty array, `if (overflow.length)` is false, and behaviour is byte-identical — but it costs 1 round trip instead of 2, with the same covered index walk. Concretely, remove lines 90-91 (`const total = await things.countDocuments(...); if (total <= MAX_NOTIFICATIONS_PER_USER) return;`) and leave the rest of trimRecipient untouched. Only reach for probabilistic trimming (~1 in 50 emits, tail bounded at ~510 instead of exactly 500) or a TTL index if the remaining single round trip is still unacceptable — both change the cap's semantics and are not drop-in.
