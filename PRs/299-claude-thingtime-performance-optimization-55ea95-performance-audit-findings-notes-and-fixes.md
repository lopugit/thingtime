# PR #299 — Thingtime performance audit: findings, notes and fixes

Branch: `claude/thingtime-performance-optimization-55ea95` → `develop`
PR: https://github.com/lopugit/thingtime/pull/299

A full performance pass over the codebase: an exhaustive audit across ten
dimensions, each finding verified against the real source before being written
down, and the highest value-to-risk fixes landed incrementally on this branch.

## How this was produced

Ten parallel finders swept one dimension each — N+1 query patterns, index
coverage, scan/payload bloat, connection lifecycle, per-request handler work,
caching, React re-render cost, client fetching, bundle size, and the
multi-node/real-time architecture. Every finding a finder produced was then
handed to an independent adversarial verifier whose default was to refute it:
open the file, confirm the quoted code exists, confirm the path is actually hot
(not dev-only, test-only or flag-gated), confirm nothing already mitigates it,
and confirm the proposed fix would not break correctness or a documented house
rule.

74 raw findings → **63 confirmed, 11 refuted**. The refuted ones are listed at
the end rather than deleted, so the same false leads are not re-investigated
later.

Everything landed here was additionally checked by hand: `tsc --noEmit` against
the documented pre-existing baseline, `lint:files` on every changed file, and —
for anything user-visible or security-relevant — verified against a running
stack in a browser.

## Landed in this PR

| # | Change | Effect |
|---|---|---|
| 1 | `perf(messenger)` batch chat-member writes | membership round trips 50 → 1 per add; 2 → 1 per DM create |
| 2 | `perf(feed)` overlap attachments + profiles in `toPublicPosts` | one fewer DB round trip on every feed page, permalink and timeline |
| 3 | `perf(nav)` visibility-gate the notifications bell | backgrounded tabs stop polling entirely |
| 4 | `perf(emoji)` share one recent-reactions fetch | 8 → 1 identical requests per page (≈40 → 1 on a 20-post feed) |
| 5 | `perf(bundle)` drop unused FontAwesome solid set | ~1 MB of never-rendered icons out of the entry chunk |
| 6 | `perf(routes)` code-split every non-primary route | **entry chunk 1,165 KB → 168 KB gzipped (−86%)** |
| 7 | `perf(auth)` concurrent session/user/subscription | 3 → 1 round trips on *every* authenticated request |
| 8 | `perf(search)` batch the ACL inheritance walk | 50 point lookups → 1 batched `$in` per chain level |
| 9 | `perf(messenger)` concurrent chat + membership gate | one fewer round trip on all 11 messenger call sites |
| 10 | `perf(docs)` bound the `/api/docs` render cache | unbounded Host-keyed map of ~300 KB renders → LRU-capped at 8 |
| 11 | `perf(vercel)` immutable caching for hashed assets | ~80 conditional GETs per repeat visit → 0; restores the disk-cache path |
| 12 | `perf(things)` batch the comment permalink's ancestor ACL checks | n + n(n-1)/2 round trips → one per chain level |
| 13 | `perf(mongo)` partial index for unread notifications | count stops fetching every notification a user ever received |
| 14 | `perf(mongo)` `listCollections` nameOnly | status endpoint stops pulling full per-collection metadata |
| 15 | `perf(messenger)` `buildSummaryContext` 6 serial stages → 3 | chat sidebar, polled by every session |
| 16 | `perf(messenger)` batch member-existence check | ~100 lookups → 2 on a 50-person create |
| 17 | `perf(feed)` project the child reads in `resolveRelated` | drops `extended` (≤512KB/doc) + unread crystal fields; removes the $group 100MB failure mode |
| 18 | `perf(mongo)` index the v1 branch of the dual-era post match | feed plan: blocking SORT over every visible post → SORT_MERGE |
| 19 | `perf(mongo)` sparse `shareOfId` index | share counts: full COLLSCAN → 6 docs, on every feed/read/reaction |
| 20 | `perf(feed)` memoize the post row | `PostCard`'s `React.memo` goes from 0% hit rate to actually hitting |

### Measured bundle result

Built with `pnpm run build:client`, sizes from the emitted assets:

| | raw | gzip |
|---|---|---|
| Entry chunk before | 4,112 KB | 1,165 KB |
| After route splitting | 1,545 KB | 482 KB |
| After FontAwesome removal | **578 KB** | **168 KB** |

`apiDocs` (253 KB), `admin` (73 KB), `messages` (68 KB), `tests` (65 KB) and
`things` (58 KB) are now fetched only when those screens are opened, instead of
by every anonymous visitor to the landing page.

### Verification notes worth keeping

- **`tsc` can pass silently on a file it is checking.** An early run reported no
  errors on a file that genuinely had an arity error. Coverage was afterwards
  proven by appending a deliberate type error and confirming it surfaced. Do not
  read "no output" as "checked" without that probe.
- **The graphify post-commit hook full-rebuilds the graph**, producing ~850k
  lines of churn in `graphify-out/` on every commit. Source-only commits with
  `git checkout -- graphify-out/` afterwards keep the branch clean.
- **`develop` was 85 commits ahead of `main`** when this branch was cut. The
  branch was rebased onto `develop` before auditing, so nothing here reports a
  problem already fixed there.

## Lesson: projections must include the era discriminator

The first attempt at the `resolveRelated` projection silently emptied every
post's comment and reaction list. `isV2(doc)` reads `doc.schemaVersion`, and
`thingtimeOf` / `crystalOf` / `targetIdOf` all branch on `isV2()`. Projecting
`schemaVersion` away made every child doc read as a v1 post, so `thingtimeOf`
returned `['post']`, neither the comment nor the reaction branch matched, and
the whole child set vanished — with no error, no type failure and no lint
complaint. The audit's own suggested field list omitted it too.

It was caught only by diffing live API output against the unprojected code. Any
future projection over `things` must carry `schemaVersion` plus the v1 fallback
fields those helpers read (`shareOfId`, `type`, `text`, `images`, `listing`).

## Deliberately not changed

**`getMongoStatus` opens a fresh MongoClient per call** (flagged Critical). The
fresh-connect-and-close is *documented as intentional* in the function's own
header — "Fails fast (2s) and always closes the client so a status check never
hangs a request or leaks a connection." Reusing the pooled client would remove a
full SRV + TLS + auth + topology handshake per call, but it also changes what the
check *tests*: the pooled path cannot detect a cluster that is up but refusing
new connections, and it inherits the pool's 5s selection timeout rather than the
deliberate 2s. That is a judgement about what "healthy" should mean for this
app, so it is left for the owner rather than changed silently. The unambiguous
half — `listCollections` pulling full metadata to compute a count — is fixed.

## Confirmed findings not yet fixed

Ordered by severity within each dimension. These are the verified backlog — each
one has been confirmed to exist in the current source.

### Database — N+1 and per-item round trips

#### getThing comment permalink walks the thread chain O(D²) times, all sequential

**Critical** · `remix/app/api/utils/things/things.ts:2199` · fix safety: safe-mechanical

Sequential Mongo round trips in getThing's comment branch are n + n(n-1)/2 for a comment at nesting level n (n=1 means a direct comment on a post): n=1 -> 1 RT, n=2 -> 3, n=3 -> 6, n=5 -> 15, n=10 -> 55. Shallow threads (n=1-2) are cheap, so this is not a p50 regression — it is a tail-latency cliff on deep reply chains, which the repo explicitly supports (comment nesting is uncapped; aclChainCore's header records a real bug where 5-deep replies broke). At the repo's own measured ~209ms/RT for Vercel iad1 <-> Atlas Sydney, n=5 costs ~3.1s and n=10 ~11.5s inside this block alone, on top of findViewableThingAs (line 2165) which already walks the same chain again, plus toPublicPosts projection — i.e. a serverless function timeout on a permalink load for a deep thread. Every one of these queries re-fetches documents the function is already holding in `chain`. Downgrade severity from critical to high: the quadratic blowup is real and unbounded, but it only bites at nesting depth >= 4-5, so it is a tail/timeout bug rather than a constant tax on every permalink.

*Proposed fix.* Mechanically mirror the pattern already proven at things.ts:2310-2313. Replace lines 2198-2201 with a shared batched lookup plus concurrent checks:

  const lookup = batchedThingLookup();
  const verdicts = await Promise.all(chain.map((entry) => canViewInherited(entry, viewer, lookup)));
  const visibleChain = chain.filter((_, index) => verdicts[index]);

This alone collapses n + n(n-1)/2 sequential round trips to at most n (one $in query per chain LEVEL, since all same-tick lookups coalesce and `batchedThingLookup` memoises hits and misses for the request). It is a byte-for-byte copy of an existing, shipped code path in the same file, preserves chain order (the filter-by-index form is what listThings uses, and lines 2205-2207 depend on chain[0]/chain[last] identity, which is untouched), and needs no new helper.

The finder's extra optimisation — seeding a Map<shareId, ThingDoc> from `doc` + `chain` and consulting it before falling back to `batchedThingLookup()` — is a valid further win (drops the residual n to ~0) but is optional and carries the one correctness constraint worth calling out: the fallback MUST be kept. The walk at 2190-2197 breaks as soon as it pushes a non-comment ancestor, and that ancestor can itself carry ['tt:inherit'] (e.g. a 'share' thing), so ancestors beyond `chain` still need a real DB lookup. A Map-only lookup with no fallback would return null there, resolveInheritChain would treat the chain as broken and fail closed, and parent/root would silently disappear from permalinks. Prefer landing the mechanical batched-lookup version first.

#### bulkThings runs up to 100 (or 500) items serially through updateThing, each doing a full public projection it then throws away

**Critical** · `remix/app/api/utils/things/things.ts:3857` · fix safety: needs-care

Live path: POST /api/v1/things/bulk (the /things multi-select UI), auth + `things.write` rate-limited only. Every item runs serially, and each one pays a `resolveProfiles` query (uncached, remix/app/api/utils/things/things.ts:1243) whose result bulkThings throws away — it only records `{ id, ok }`. With the deployment pinned to syd1 alongside the Sydney Atlas cluster (~1-3ms/RT), a 100-item bulk move costs roughly 300-1000 sequential round trips (~0.5-3s), and a 500-child recursive folder share roughly 1500+ (~2-5s). The discarded projection is ~25-30% of that for the common `data`/`folder` kinds. The worst case is bulk-moving/sharing POST things, where `isPostThing` (:3662) additionally fires toPublicPosts' ~5 serial stages per item — several hundred extra round trips, essentially all discarded. Not the 170-210s the finder claimed (that assumed a cross-region layout vercel.json no longer uses), but a genuine multi-second stall on an interactive action, most of which is avoidable.

*Proposed fix.* Apply (a) only; (b) as proposed is unsafe.

(a) SAFE-ISH, DO THIS: give updateThing/deleteThing an internal option that skips the projection when the caller discards it (e.g. `options.skipProjection`), and have bulkThings pass it at :3862, :3868, :3888, :3901. Caveat: updateThing's return type is `{ ok: true; thing: PublicThing; post: PublicPost | null }` and is consumed widely (upsertThing at :3712 forwards `thing`/`post` straight out), so this is a signature/type change — either widen `thing` to `PublicThing | null` under the option or add a separate internal write function that the public updateThing wraps. Contained, but not a one-line edit.
Cheaper alternative with zero signature churn: memoize resolveProfiles per-request (or just per bulkThings call), since every doc in a bulk run has the same ownerId — that removes ~100 identical queries with no contract change.

(b) DO NOT parallelize the id loop mechanically. Real correctness hazards the finder missed:
  - `folderAncestryContains` (:769, called at :3521) is a read-then-write cycle guard. Two concurrent moves (A→B and B→A) can each pass the check independently and produce a folder cycle that the serial loop makes impossible.
  - updateThing's storage accounting runs `applyUserStorageDelta` / `withMongoTransaction` (:3620-3625) against the SAME user document for every item in the batch; concurrent same-user transactions invite write conflicts / TransientTransactionError, and the `expectedSize` optimistic guard surfaces as spurious 409 "Thing changed while it was being updated" per-item failures.
  - The copy path's `idMap` (:3931) requires parent folders copied before their children (BFS order) — that inner loop must stay strictly ordered regardless.
If concurrency is still wanted, it must be scoped (e.g. delete-only, or move-only with the ancestry guard hoisted to a single up-front validation over the whole id set) and covered by a test that asserts no folder cycle can be formed by a concurrent batch.

#### Search result pages check ACL inheritance without the batched lookup, re-introducing the per-doc walk that already timed out /things in production

**High** · `remix/app/api/utils/things/search.ts:384` · fix safety: safe-mechanical

Every /api/v1/things/search page whose results carry tt:inherit (comments, reactions, shares) walks each doc's ACL chain with its own findOne instead of one batched $in per chain level. Docs without tt:inherit cost nothing extra (resolveInheritChain short-circuits), so this is a pure regression on attached-thing result sets with no offsetting cost elsewhere. Realistic hot case, depth-1 comments at MAX_SEARCH_LIMIT=50: 50 concurrent findOnes against a 10-connection pool (maxPoolSize:10) serialize into 5 pool waves, ~1.0s at the documented ~200ms iad1<->Sydney round trip, versus 1 round trip (~0.2s) batched — a 5x latency multiplier and 50 queries where 1 would do. A 3-deep reply thread reaches 150 queries in 15 waves, ~3.0s versus 3 round trips (~0.6s). resolveInheritChain caps depth at MAX_INHERIT_CHAIN=256, so nothing bounds this below the thread depth. All of it sits on the request's critical path before any response bytes are emitted, and it is the same shape that already timed out the /things function in production.

*Proposed fix.* Two-file mechanical change mirroring listThings exactly. (1) things.ts:1738 — add `export` to `const batchedThingLookup` (it is currently module-private, contrary to the original finding). (2) search.ts — add `batchedThingLookup` to the existing named-import block from './things' (search.ts:10-37). (3) search.ts:384 — replace with:
  const lookup = batchedThingLookup();
  const verdicts = await Promise.all(page.map((doc) => canViewInherited(doc, viewer, lookup)));
Construct the lookup inside projectVisiblePage so each page gets a fresh cache, identical to things.ts:2311. No behaviour change: batchedThingLookup returns the same ThingDoc|null as findThing, caches misses as well as hits, and is created per call so there is no cross-request staleness. The `if (app)` branch above (appVisiblePage) is untouched.

#### resolveChatAccess does two sequential findOne on every chat read/write, on a 4-second poll

**High** · `remix/app/api/utils/messenger/messenger.ts:296` · fix safety: safe-mechanical

Removes one avoidable serial DB round trip from the gate on every messenger read and write (11 call sites: listMessages, sendMessage, react, edit, delete, member ops). With the app pinned to syd1 alongside the Sydney Atlas cluster (vercel.json "regions": ["syd1"]), a findOne round trip costs roughly 1-3ms, not the 209ms cross-region figure the original finding assumed — that region mismatch was already fixed. So this saves ~1-3ms per messenger request, about one seventh of the ~7-stage serial DB chain in listMessages, or ~0.05% of the 4000ms poll interval per open chat. Query count is unchanged; only serialization improves. Worth taking as a zero-risk one-line cleanup on the most-called messenger gate, but it is not a bottleneck and does not warrant high severity.

*Proposed fix.* In resolveChatAccess, hoist the trimmed id and run both lookups concurrently, keeping the guard order identical:

  const id = chatId.trim();
  const [chat, member] = await Promise.all([findThingByKind('chat', id), getChatMemberDoc(id, viewerId)]);
  if (!chat) return fail(404, 'Chat not found');
  const state = member?.crystal?.state;
  ...

Substituting `id` for `chat.shareId` is exactly equivalent (findThingByKind matches on shareId === id). Only behavioural delta: on the 404 path the member query now runs and is discarded — one wasted indexed findOne on an error path, no correctness change. Promise.all handles a rejection from either branch, so no unhandled-rejection risk.

Do NOT apply the finder's secondary listMessages proposal as written: resolveProfiles(memberIds) at 1136 consumes listChatMemberDocs' output at 1134-1135, so those two are inherently serial. What is available there is running the (listChatMemberDocs -> resolveProfiles) pair concurrently with projectMessages (1124), i.e. two branches in one Promise.all — a second, separate ~1-3ms saving that needs care because both branches read `chat.shareId`.

#### Per-user findUserById fan-out instead of the existing findUsersByIds batch (2 queries × N users)

**High** · `remix/app/api/utils/messenger/messenger.ts:341` · fix safety: needs-care

Medium, not high. Worst case (createChat/manageChatMembers with the full MAX_CHAT_MEMBERS_PER_ADD=50) fires 100 point reads for an existence check that findUsersByIds answers in 2. Both halves hit the home client (maxPoolSize 10, collections.ts:41), so those 100 ops drain as ~10 sequential pool waves. Deployment is syd1 (vercel.json "regions": ["syd1"]) co-located with the Sydney Atlas cluster, so per-wave cost is ~2-3ms, giving ~20-30ms vs ~3ms — a ~20ms saving, not the claimed 2.1s (the finder used a stale iad1 209ms RTT). The more meaningful cost is pool occupancy: under Fluid concurrency one 50-member add monopolizes all 10 home connections for 10 rounds, adding queueing latency to every co-tenant request on that instance. Secondary sites are smaller: appData.ts:651 is bounded by MAX_SHARED_PAGE=50 / DEFAULT_SHARED_PAGE=20 distinct authors (~4 waves typical, ~8ms), and _owned.tsx:17 iterates 0-5 admin-assigned account links (negligible — drop it from the fix set or fix it only for consistency).

*Proposed fix.* Replace Promise.all(ids.map(findUserById)) with findUsersByIds(ids) at messenger.ts:341 and messenger.ts:817, then diff by id instead of by index: `const found = await findUsersByIds(memberIds); const have = new Set(found.map((u: any) => String(u._id))); const missing = memberIds.filter((id) => !have.has(id));`. This is exact — userThingToDoc sets _id to the thing's shareId (users.ts:272) and legacy String(ObjectId) equals the requested hex, and both id arrays are already Set-deduped, so the 404 message still names the first missing id. At appData.ts:651 and _owned.tsx:17 the same swap requires converting the index-aligned `users[index]` access into a Map keyed by String(user._id), because findUsersByIds filters out missing users and therefore breaks positional alignment; appData's "author account gone -> skip entry" behaviour is preserved by the map miss. Consider skipping _owned.tsx entirely — the array is 0-5 elements.

#### buildSummaryContext issues six sequential round trips where three of them are independent

**Medium** · `remix/app/api/utils/messenger/messenger.ts:488` · fix safety: safe-mechanical

buildSummaryContext runs 6 sequential DB stages where 3 suffice. Stage 1 currently costs 3 serial round trips (chatDocs find at 488, the unread $group aggregate at 501, the member-count $group aggregate at 542) that could be 1; stage 3 costs 2 more (resolveProfiles at 555, then the receipts Promise.all at 558) that could be 1. Parallelizing removes 3 of 6 serial round trips — 50% of the DB wall clock of this function. In the normal syd1 deployment, co-located with the Atlas Sydney cluster, that is roughly 5-30ms saved per call (the removed cost is the shorter of the overlapped queries; the unread aggregate over chat-message docs is the slow one and stays on the critical path either way). The multiplier is the traffic, not the per-call size: /api/v1/chats/updates is polled every 25s by MessengerNotifications for every logged-in user, and /api/v1/chats every 15s for every user with the messenger page visible, so this is one of the highest-QPS handlers in the app. If the deployment ever lands outside syd1 (memory notes the Vercel dashboard region has read iad1 while vercel.json pins syd1 — the override is load-bearing), the same 3 removed round trips are worth ~600ms instead.

*Proposed fix.* Stage 1: move the chatDocs find (488) down below the unreadClauses construction (496) and combine it with both aggregates into one `const [chatDocs, unreadAgg, countAgg] = chatIds.length ? await Promise.all([...]) : [[], [], []]`, then build lastByChat/unreadByChat/memberCountByChat from the results. The ordering requirement is the only subtlety: unreadClauses must be built before the Promise.all, so chatDocs moves down rather than the aggregate moving up. Stage 2 (memberDocs at 529) stays as-is since it needs chatDocs. Stage 3: fold resolveProfiles (555) into the existing Promise.all at 558 as a third entry — profileIds needs memberDocs and lastByChat, receiptUserIds needs memberDocs, and both are settled by then. Note resolveProfiles is itself internally sequential (home things query, then a legacy users fallback), so it stays the long pole of stage 3 and the saving there is only the receipts lookups, which are already TTL-cached for 60s in getUsersReadReceiptsMap.

#### Every quota reserve reads and writes the same document four times sequentially, and each CAS retry repeats all four

**Medium** · `remix/app/api/utils/things/quota.ts:360` · fix safety: needs-care

A warm reserve (quota doc already exists) costs 4 sequential round trips on a single document where 2 would do: a no-op upsert write, a findOne to verify it, a second findOne for the CAS preimage, then the findOneAndUpdate. With functions and Atlas both in Sydney (vercel.json regions: ["syd1"]) each RT is ~1-3ms, so the waste is roughly 2-6ms per reserve, and a fully contended reserve (MAX_QUOTA_CAS_ATTEMPTS = 5, each attempt repeating all four) is ~20-60ms before the 503 rather than the ~40ms a 2-RT retry loop would take. One of the two wasted RTs is a write, so it also costs a needless majority-ack on the primary. Scope is narrow: the only caller is POST /api/v1/things/quota, a service-account-credential-gated server-to-server primitive with no first-party callers in the repo, and per its own docs reserve is the per-batch op while permit (already 2 RTs) is the per-unit one.

*Proposed fix.* Restructure so the preimage read comes first and initialize runs only on a miss. Concretely: split validatedQuotaPreimage into a variant that returns null instead of calling quotaNotFound(), have reserveQuota try that first, and only when it returns null call initializeQuotaThing and then re-read the preimage. That makes the warm path 2 RTs and the cold path 3, and — critically — preserves the legacy-row semantics documented at :136-138: on a preimage miss caused by a same-owner legacy `data` row at the same shareId, initializeQuotaThing's updateOne still matches without a duplicate-key error, its findOne at :139 still runs, and requireCanonicalServiceQuotaDocumentState still raises the specific canonical-state error instead of a misleading 404 from the narrower quotaMatch filter. Also fix the retry: retryQuotaContention should re-enter after the initialize step (the doc provably exists by then) so each retry is 2 RTs. Do NOT take the second half of the original proposal — having initializeQuotaThing return its locally-constructed doc to skip the preimage read on the cold path — because quotaPreimageMatch uses the full stored envelope (_id, crystal, createdAt, updatedAt) as the optimistic-concurrency token and a client-built doc will not reliably match stored BSON.

### Database — index coverage and query shape

#### Legacy `visibility` $or branch has no index — /search and every audience query is a full COLLSCAN + blocking sort

**Critical** · `remix/app/api/utils/mongodb/collections.ts:469` · fix safety: needs-care

Scoped down from the finder's claim, with measured numbers.

MongoDB can only use an index union for an `$or` when every branch is indexed. `circleClause`'s `{ visibility: … }` branch has no covering index (the only one containing the field requires `kind` bound first), so the entire audience clause demotes to a collection scan plus a blocking in-memory sort whenever it is the leading selective predicate.

Measured on the local `thingtime` DB (4404 docs in `things_v2`), query `{$or:[{acl:'tt:all'},{visibility:'public'}]}` sorted `{createdAt:-1,shareId:1}` limit 21:
  - current: SUBPLAN → SORT → COLLSCAN, 4404 docs examined, 0 keys, 149ms
  - acl branch alone: IXSCAN, 21 docs, 21 keys, 2ms
  - with the proposed index: SORT_MERGE over two IXSCANs, 21 docs, 21 keys, 4ms
That is ~210x read amplification and ~40-75x latency, growing linearly with total collection size — at 1M things it is a 1M-doc scan and a 1M-doc blocking sort to return 21 rows.

Reachable via:
  - `POST /api/v1/things/search` (`search.ts:514`) whenever `q` is empty and no kind/condition narrows the match — the bare visibility clause becomes the whole match. Reachable from the /search UI by submitting with nothing typed, and from any filter-only search whose conditions are not leading-indexed.
  - `schemas/browse.ts:95` (`decorate`'s schema-usage aggregation), which has no leading indexed predicate. `browsePopular` (`:184`) is partly shielded by a leading `{thingtime:'schema'}`.

NOT reachable via the paths the finder named:
  - the feed (`getFeed`, things.ts:2036) is unaffected — `postMatch()`'s indexable `$or` drives the plan and the visibility clause is a residual filter (63 docs examined with the branch, 63 without — zero delta, verified by explain).
  - `/things` (`listThings`, things.ts:2231) never calls `visibilityQueryFor` at all.
  - a plain `/search` page visit issues no query (`SearchPage.tsx:509-515`), and a `?q=` deep link is driven by the `things_text_search` text index.

Cross-region amplification is real but secondary: iad1→Atlas Sydney means the connection is held for the duration of the scan rather than a single ~209ms seek, so the tail is scan-time plus RTT, not RTT alone. Severity is HIGH, not critical: one endpoint shape, no correctness impact, and it degrades with collection growth rather than failing today.

*Proposed fix.* Do NOT delete the `visibility` branches from `circleClause` (things.ts:1765-1779) — that is a silent correctness regression against v1 residue docs (see reason).

Apply ONLY the index variant. In `createThingsDataIndexes` in `remix/app/api/utils/mongodb/collections.ts`, beside the existing `col.createIndex({ acl: 1, createdAt: -1, shareId: 1 })` (line 469), add:

    // The audience $or pairs `acl` with the v1-era `visibility` enum. Mongo can
    // only index-union an $or when EVERY branch is indexed, so without this the
    // whole clause demotes to a COLLSCAN + blocking sort (measured: 4404 docs
    // examined / 149ms vs 21 keys / 4ms with it, on a 4.4k-doc collection).
    col.createIndex({ visibility: 1, createdAt: -1, shareId: 1 }),

Verified by explain: the plan changes from SUBPLAN → SORT → COLLSCAN to SUBPLAN → LIMIT → FETCH → SORT_MERGE over `acl_1_createdAt_-1_shareId_1` + the new index, with the sort fully index-provided (no blocking SORT stage).

Do not make it sparse: a sparse index would exclude the 100% of documents that lack the field, and the planner requires a branch-covering index for the union — a sparse one on a field no live doc carries would not qualify. A non-sparse index on a 0%-populated field costs one all-nulls b-tree, which is cheap.

Because it lives in `createThingsDataIndexes`, it lands on both the home DB and lazily on custom data-plane endpoint DBs, which is correct.

Optional follow-up (separate change, not mechanical): the 'private' case at things.ts:1775-1777 uses `{acl:{$exists:true,$nin:[…]}}`, which is inherently non-selective even with an index. That only fires for a logged-in viewer requesting a narrowed circle set, so it is a lower-value target.

Verification after applying: restart so `ensureIndexes()` runs, then re-explain
`db.things_v2.find({$or:[{acl:'tt:all'},{visibility:'public'}]}).sort({createdAt:-1,shareId:1}).limit(21).explain('executionStats')`
and assert the winning plan contains SORT_MERGE (not COLLSCAN) and `totalDocsExamined` ≈ 21.

#### postMatch's dual-era $or forces the main feed into a blocking in-memory sort of every matching post

**Critical** · `remix/app/api/utils/things/things.ts:648` · fix safety: safe-mechanical

Every chronological feed page (getFeed things.ts:2054) and every profile page (listUserPosts things.ts:2141) does a blocking SORT whose input is a FETCH of EVERY post the viewer can see — the limit cannot be pushed into the index scan. Measured on the local 63-post collection: docsExamined 63 to return 21, versus keys=35/docs=35 with the kind branch removed. The cost scales linearly with visible-post count, so at 100k visible posts the server fetches ~100k full documents per feed request instead of walking ~35 index keys. Two corrections to the original claim: (a) the sort itself is a bounded top-K (explain shows limitAmount:21, totalDataSizeSorted:11523, usedDisk:false), so the damage is the full FETCH per request, not sort memory or a 100k-element heap; (b) listUserPosts's countDocuments at things.ts:2133 is NOT affected the same way — a count needs no sort, so the OR plan costs it nothing beyond the inherent full-owner scan. The ranked path (things.ts:2079) does suffer identically, fetching all visible posts before taking its RANKED_CANDIDATE_WINDOW=400 slice. The comment at collections.ts:388 claiming the (createdAt desc, shareId asc) page sort is "fully index-provided instead of an in-memory sort per request" is false for both feed paths.

*Proposed fix.* Do NOT apply the finder's primary fix (dropping the {kind:'post'} branch) — it would silently hide v1-era posts. The dual-era contract is documented at things.ts:645-647 and mirrored in thingtimeInClause (things.ts:657), and custom data-plane endpoint DBs bootstrap through the same lazy ensure and may hold unmigrated docs; countDocuments({kind:{$exists:true}})=0 is true of this local dev DB only and says nothing about prod or override endpoints. Apply the index-only fix instead, in createThingsDataIndexes (remix/app/api/utils/mongodb/collections.ts, beside line 423): col.createIndex({ kind: 1, createdAt: -1, shareId: 1 }). I verified this empirically — created that index locally, re-ran the exact feed match, and the plan became LIMIT -> FETCH -> SORT_MERGE over both IXSCANs with docsExamined 35 (down from 63) and no blocking SORT; then dropped the temp index. Purely additive, zero query/behaviour change, both eras stay correct, and it restores the index-provided sort the collections.ts:388 comment promises. Optionally also fix the comment.

#### Share-count aggregation matches on unindexed `shareOfId` — a full COLLSCAN inside every toPublicPosts() call

**High** · `remix/app/api/utils/things/things.ts:1321` · fix safety: needs-care

One unconditional full COLLSCAN of `things_v2` per feed page, ranked-feed page, profile page, single-post read, search result page, post create, comment create, thing update, and — additionally, missed by the finder — per reaction toggle (`resolveRelated([target])` at things.ts:2652).

Measured on the local dev DB (4,404 things): the aggregation examines 4,404 documents and 0 index keys to produce share counts for 20 posts. Removing the `shareOfId` branch drops that to 0 documents / 0 keys via a fully covered IXSCAN on `targetId_1_thingtime_1_createdAt_1_shareId_1`; keeping the branch but adding a sparse `shareOfId` index gives an OR of two IXSCANs, also 0 documents examined. So the entire scan is pure waste — it currently produces zero matches (`countDocuments({shareOfId:{$exists:true}})` = 0) while forcing every other branch off its index.

Cost scales linearly with collection size and is unbounded: at 100k things every emoji tap scans 100k docs; at 1M things every post publish scans 1M docs on the response path. It also runs inside a `Promise.all` alongside three other reads, so it sets the floor on `toPublicPosts` latency rather than hiding behind a slower sibling. This is aggravated by the known iad1↔Atlas-Sydney region gap: the scan holds a working-set-sized read open on the highest-frequency endpoint in the app.

*Proposed fix.* Prefer the index-add over the branch-drop — I verified both, and only the index-add is behaviour-preserving.

Recommended (verified, zero semantic change): add to `createThingsDataIndexes()` in `remix/app/api/utils/mongodb/collections.ts`, next to the existing `targetId` index at line 442:

    col.createIndex({ shareOfId: 1 }, { sparse: true }),

Live-verified this flips the plan to `OR[ IXSCAN targetId_1_thingtime_1_createdAt_1_shareId_1, IXSCAN shareOfId_1 ]` with `totalDocsExamined: 0`. Use `sparse: true` rather than the finder's `partialFilterExpression: { shareOfId: { $type: 'string' } }` — sparse is provably usable for an `$in` over non-null strings, whereas `$type` subsumption proving is more fragile across server versions.

The finder's headline fix (delete the `shareOfId` branch, simplify `$group` to `_id: '$targetId'`) is faster still (covered IXSCAN, no FETCH) but is NOT purely mechanical: `thingtimeOf()` (things.ts:624-625) and `targetIdOf()` (things.ts:638) still read v1 docs where a share is a post carrying `shareOfId`, and the things migration (`migrations.ts:460,467,482`) is what converts them. Un-migrated v1 shares would silently stop being counted. Local shows 0 such docs, but that is not evidence about prod. If you want the branch gone, confirm `countDocuments({shareOfId:{$exists:true}})` = 0 on the production/home DB first, and note the same check must pass on any custom data-plane endpoint DB.

Either way, adding an index to `createThingsDataIndexes()` means it is built on the home DB AND lazily on every custom-endpoint data-plane DB, so schedule the deploy accordingly.

#### People search $or on unindexed displayName scans the whole user partition per keystroke, plus a COLLSCAN of legacy users

**High** · `remix/app/api/utils/auth/users.ts:1376` · fix safety: needs-care

Every people-search request FETCHES the entire user-thing partition in the worst case: measured 156 keys / 156 documents examined for 0 results against 156 total user things (7ms locally on a warm cache). The scan is bounded only by {thingtime:'user'}, so it grows linearly with the user base — at 100k users a non-matching keystroke fetches ~100k full user documents (crystal + profile fields, order 1-2KB each => roughly 100-200MB pulled through the WiredTiger cache per request), while an 8-row typeahead response needs 8. This is a per-keystroke endpoint in Messenger (200ms debounce, 2-char floor), and the rate limiter permits 120 such requests per minute per client, so one active search box can drive ~120 full user-base scans per minute. Cost concentrates on exactly the queries users type most — progressively narrowing strings that match few or no users. The legacy-users branch is structurally unindexed on displayName but currently scans an EMPTY collection (0 docs, EOF plan) that is frozen to new writes, so it contributes nothing measurable.

*Proposed fix.* Do NOT apply the proposed fix as written — one third of it is ineffective and another third breaks behaviour. (a) $text is not a drop-in: things_text_search is word-tokenized with stemming, so "nik" would stop matching "nikolaj" and typeahead prefix matching dies. (b) Adding a displayName index to legacy users does NOT remove that scan — an unanchored $options:'i' regex cannot seek, so it just converts a COLLSCAN into a full IXSCAN of identical cardinality; skip it entirely since the collection is empty and frozen. (c) The workable route is the case-folded field: stamp crystal.searchName (lowercased username + displayName, e.g. a small array) on user-thing write, add col.createIndex({ thingtime: 1, 'crystal.searchName': 1 }) in ensureIndexes, query with an anchored prefix regex ^escapeRegex(q.toLowerCase()) so the index seeks. That requires a write-path change, a backfill migration for existing user things, a FUNDAMENTALS section 3 index-table update, and an accepted semantics change from substring to prefix matching (searching "kolaj" would no longer find "nikolaj") — get that behavioural call confirmed before implementing. A cheaper interim mitigation with zero semantic change: keep the current query but add a short-TTL in-process cache keyed on the normalized query string, which collapses the repeated per-keystroke scans without touching matching rules.

#### ciControl readKind sorts on updatedAt, which no thingtime-prefixed index contains

**Medium** · `remix/app/api/utils/ciControl/store.ts:232` · fix safety: needs-care

Every /api/v1/admin/ci request runs nine blocking sorts, one per CI kind, each forced to IXSCAN and then FETCH every document in its partition because updatedAt appears in no thingtime-prefixed index. Six of those partitions (ci-event, ci-workflow-run, ci-pull-request, ci-deployment, ci-preview, ci-dispatch) are append-only with no TTL and no pruning, so scanned+fetched document count grows monotonically with webhook delivery volume while the endpoint still returns at most 200-250 rows. The admin dashboard polls this every 30 seconds while visible (CIControlDashboard.tsx:530), so one open tab issues ~2,880 requests/day = ~26,000 full-partition scans/day. At 50k ci-event docs the event query fetches 50,000 full documents (crystal.data holds the raw webhook payload, so they are not small) to return 200 — roughly a 250x read amplification versus an index-provided sort. Because this runs on the home things collection shared with the whole app's serving path, each poll also churns the Atlas working set and evicts hot pages for ordinary user traffic. Memory is NOT at risk: .limit() gives Mongo a bounded top-K sort, so this degrades as latency and I/O, never as a QueryExceededMemoryLimit error — which is why it will silently get slower rather than failing loudly.

*Proposed fix.* Do not add a bare col.createIndex({ thingtime: 1, updatedAt: -1, shareId: 1 }). It is legal (only thingtime is multikey; updatedAt/shareId are scalars — same shape as the existing line 427 index), but thingtime is set on essentially every v2 thing, so it would build a full-collection multikey index on the largest collection in the system, adding storage and per-write amplification to all thing writes, purely to serve one admin-only endpoint. Prefer one of: (a) a partial index scoped to the CI kinds, e.g. col.createIndex({ thingtime: 1, updatedAt: -1, shareId: 1 }, { partialFilterExpression: { thingtime: { $in: [...CI_THINGTIME] } } }) — verify the $in form is accepted by the target MongoDB version before relying on it; or (b) change readKind's sort to { createdAt: -1, shareId: 1 }, which is already fully index-provided by collections.ts:427 and is near-equivalent ordering for append-only event documents, then confirm the dashboard's freshness display (store.ts:410, events[0].occurredAt ?? events[0].updatedAt) still reads correctly. Separately, the real structural fix is retention: these six CI partitions have no TTL and no pruning, so any index-only change just defers the problem. Note the finder's claim that this index also fixes listThemesForUser is wrong — that query filters on ownerId and would need {thingtime:1, ownerId:1, updatedAt:-1}, and is bounded per user anyway.

#### Notification unread count fetches every one of a user's notification documents because readAt is not in the index

**Medium** · `remix/app/api/utils/notifications/notifications.ts:228` · fix safety: safe-mechanical

The bell badge count fetches every notification document the owner has, not just the unread ones — measured 2000 docsExamined to return a count of 500 on a 2000-doc owner. Typical accounts are capped near 500 docs/poll by trimRecipient (~250KB of documents touched every 90s per visible tab instead of 500 index keys), but accounts fed only by post fan-out are never trimmed at all (emitNotificationsBulk skips trimRecipient), so their per-poll document read grows linearly and unbounded with account age — a lurker following 100 posters at 3 posts/day reaches ~110k documents fetched per 90-second poll within a year. The count runs in the same Promise.all as the page fetch on the app's most frequently polled authenticated endpoint, so it sets the floor latency of the notification bell for every active session.

*Proposed fix.* Add the partial index alongside the existing partial-index patterns in `createThingsDataIndexes` (remix/app/api/utils/mongodb/collections.ts):

  col.createIndex({ thingtime: 1, ownerId: 1, readAt: 1 }, { partialFilterExpression: { readAt: null } }),

Verified on a live mongod: Mongo accepts `readAt: null` in a partialFilterExpression, and the driver's countDocuments aggregate then plans GROUP←COUNT_SCAN with docsExamined=0. `thingtime` stays the only multikey field, so the compound is legal. Prefer this ADDITIVE partial index over the finder's alternative of folding `readAt` into the existing `{thingtime,ownerId,createdAt,shareId}` compound — that one is the serving index for the notification page fetch (line 224-226) and for other thingtime+ownerId listings, and reordering its keys would deoptimise them.

Separately (optional, not required for this fix): the count still FETCHes for users who have disabled notification types, because line 219 adds `crystal.type: {$nin: disabled}` outside the index.

### Database — unbounded scans, projections and payload bloat

#### resolveRelated loads EVERY comment and reaction doc (full documents, no limit, no projection) for each page of posts

**Critical** · `remix/app/api/utils/things/things.ts:1307` · fix safety: needs-care

Every feed/profile/search/permalink render fetches the COMPLETE child set of all posts on the page as full documents. For a 20-post page containing one viral post with 5k reactions and 2k comments: reaction docs (shareId, ownerId, targetId, thingtime[], acl[], crystal.emoji, createdAt/updatedAt) run ~300-500B each -> ~2MB; comment docs carry full `crystal` (text, images[], listing, arbitrary `thing`), `extended`, `acl`, `tags` and run ~1KB+ -> ~2MB. So roughly 3-5MB pulled across the cross-region Atlas link (iad1 -> Sydney, ~209ms RTT — here payload, not RTT, dominates) to render 20 comment rows and an emoji tally. Cost is strictly linear in post popularity and unbounded. The finder actually UNDERSTATED the blast radius; three amplifications follow from the same unbounded pass: (1) lines 1380-1383 turn EVERY fetched comment id into `levelIds`, so the reply-level query at 1387-1390 issues `$in` with 2,000 ids and again fetches un-projected reaction docs; (2) the sibling aggregate at 1391-1402 does `$group {docs: {$push: '$$ROOT'}}` over all matching comment docs BEFORE `$slice: REPLIES_PER_LEVEL(5)`, and `allowDiskUse` is never set anywhere in this file — a large enough thread makes the feed request FAIL with QueryExceededMemoryLimit (100MB $group cap), not merely run slow; (3) every commenter id feeds `resolveProfiles` (1584) and every comment shareId feeds `resolvePostAttachments` (1576), so two further unbounded `$in` queries scale with the same number. Note the sorts at 1310/1317 (`{createdAt:1, shareId:1}` across a multi-value `$in`) also cannot be fully index-provided, adding an in-memory SORT (32MB cap) on top.

*Proposed fix.* Split the fix into a safe half and a careful half. SAFE / mechanical: add `.project()` to both finds at 1307-1318 and to the level-reaction find at 1387-1390, whitelisting only the fields actually read — reactions need `{targetId:1, parentId:1, ownerId:1, thingtime:1, kind:1, token:1, 'crystal.emoji':1}`; comments need `{shareId:1, _id:1, commentId:1, targetId:1, parentId:1, ownerId:1, createdAt:1, tags:1, thingtime:1, kind:1, text:1, 'crystal.text':1, 'crystal.type':1, 'crystal.images':1, 'crystal.listing':1, 'crystal.thing':1}` (that set covers pushComment/pushReaction at 1341-1367 plus everything buildComment reads at 1593-1618). Also add the same projection inside the `$push: '$$ROOT'` aggregate at 1397 (replace `$$ROOT` with a `$$ROOT`-shaped `$project` upstream) — that removes the 100MB-blowup risk. NEEDS CARE — do NOT apply the finder's proposal verbatim: (a) reactions cannot become a pure `$group` count. `mergedReactionsOf` (1510-1525) dedupes by exact `(userId, emoji)` ACROSS the standalone reaction things and the v1 embedded `doc.reactions` map, so a server-side count would double-count any user present in both eras. Keep per-row `{ownerId, crystal.emoji}` (now projected, ~40B/row) or carry the dedupe into the pipeline. (b) Bounding comments per target must not disturb `totalComments` at line 1626, which is `threadCounts + allComments.filter(entry => !entry.doc).length` — i.e. it counts the LEGACY no-doc entries, which come from the `kind`-era pass at 1315-1318 and the embedded `doc.comments`. Limiting that legacy pass silently corrupts the comment counter; limit only the v2 pass, or recompute the legacy tail via a separate count. (c) After limiting v2 comments to the newest ~20 per target, `levelIds` (1380-1383) shrinks accordingly — that is desirable, but confirm the thread view (route 2200) does not rely on reply levels for comments outside the returned-20 window.

#### Reply-level aggregation $push'es every reply's whole document into a $group accumulator before slicing to 5

**High** · `remix/app/api/utils/things/things.ts:1397` · fix safety: safe-mechanical

On every feed/post render (`toPublicPosts` → `resolveRelated`), the reply-level stage does a blocking in-memory `$sort` of every second-level reply of the page (the sort direction `{createdAt:-1, shareId:1}` does not match the only usable index `{targetId:1, thingtime:1, createdAt:1, shareId:1}`, so it cannot be an index scan), then buffers every one of those docs whole into per-parent `$push: '$$ROOT'` accumulators, discarding all but 5. The `$in` list of parents is itself unbounded by anything but the write-time cap: pass 1 (line 1308) fetches ALL comments for the page with no limit, so a 20-post feed page can feed up to ~10,000 parent ids into this stage. Because `MAX_COMMENTS_PER_POST = 500` is enforced per direct parent at write time, the worst-case discard ratio is 100:1 per parent (500 buffered, 5 kept) and the largest single group value is ~500 × 5KB ≈ 2-3MB — expensive in primary RAM/BSON decode per feed render, but NOT past the 16MB group-value ceiling, so it degrades rather than fails. Note the `count` accumulator requires touching every matched doc regardless, so the win is memory/decode and eliminating the blocking sort, not fewer index reads.

*Proposed fix.* Replace the `$sort` + `$group($push)` + `$project($slice)` trio (lines 1394-1399) with a single `$group` using `$topN`, which bounds the accumulator to 5 and removes the blocking sort entirely: `[{ $match: { targetId: { $in: levelIds }, thingtime: 'comment' } }, { $group: { _id: '$targetId', count: { $sum: 1 }, docs: { $topN: { output: '$$ROOT', sortBy: { createdAt: -1, shareId: 1 }, n: REPLIES_PER_LEVEL } } } }]`. Output shape is identical (`_id`, `count`, `docs` newest-first), so the downstream consumer at lines 1408-1423 — including the `.reverse()` to oldest→newest and the `seenIds` dedupe — needs no change. Keep the finder's `$lookup`-with-sub-pipeline alternative off the table: it would turn one aggregation into a per-parent lookup and still need a second pass for `count`. Caveat: `$topN` requires MongoDB 5.2+ / FCV 5.2+; on an older server it errors loudly at parse time rather than silently misbehaving, so verify the Atlas cluster version before merging.

#### resolveThreadCounts runs an unbounded $graphLookup over the whole comment tree of every post on the page just to take $size

**High** · `remix/app/api/utils/things/things.ts:1479` · fix safety: needs-care

Unbounded-depth `$graphLookup` runs once per feed/profile/search/permalink render for up to ~100 root ids (20-50 posts + their share originals), buffering every descendant comment DOCUMENT of every thread on the page just to take `$size`. Server-side work per render is O(total comments in all threads on the page) — ~2,000 full docs (~1-2 MB) for a 20-post page averaging 100-comment threads, growing without limit as threads grow. Because `$graphLookup` is capped at 100 MB and ignores `allowDiskUse`, one hot thread turns the shared aggregation into a hard error that fails the counts for every post on the page, i.e. a 500 on the feed. There is no cache on the feed route and no denormalized counter; the `{targetId, thingtime, createdAt, shareId}` index at collections.ts:442 makes each hop a seek but cannot bound or cover the traversal. Marginal cost over the existing direct-children read in `resolveRelated` is the re-read of level 1 plus all deeper levels — and unlike `resolveRelated`'s deeper passes (which slice to REPLIES_PER_LEVEL and go count-only), this one has no bound at all.

*Proposed fix.* Denormalize the whole-thread count: maintain a counter on the root post (e.g. `crystal.threadCount`, mirroring the existing `crystal.lastMessage` denormalization) incremented on comment create and decremented on delete, walking to the thread root; `resolveThreadCounts` then becomes a projection off the docs already in hand. This requires a one-time backfill (the current graphLookup is exactly the backfill query, run offline per post), hooks on every comment create/delete path, and preserving the legacy `!entry.doc` addend at things.ts:1626. Do NOT apply the "project the graphLookup output before $size" half of the original suggestion — `$graphLookup` has no sub-pipeline and cannot project its `as` output. If a stopgap is needed before the counter lands, `maxDepth` is the only lever and it changes the contract (deep threads undercount), so it needs an explicit product decision.

#### Every reaction tap re-runs resolveRelated, refetching the post's whole comment tree to compute an emoji tally

**High** · `remix/app/api/utils/things/things.ts:2652` · fix safety: needs-care

Every first-party emoji tap (POST /api/v1/things/react) runs the full page-batch resolver for a single target: 3 serial DB round trips instead of 1, fetching up to 500 full comment docs plus ~2500 reply docs (MAX_COMMENTS_PER_POST=500, REPLIES_PER_LEVEL=5, SHIPPED_REPLY_LEVELS=1) and a share-count aggregate, all discarded — only `reactionsByTarget` is read. Cost is wasted DB work, bandwidth and 2 extra serial hops per tap (intra-region since vercel.json pins syd1, so ~ms each, not the 630ms the finder claimed); on heavily-commented posts it is hundreds of KB of comment text transferred per reaction. Zero-comment targets already cost only 1 round trip.

*Proposed fix.* Replace the resolveRelated call at things.ts:2652 with a target-scoped reaction resolver, but it must reproduce mergedReactionsOf's three sources or counts will regress on legacy data: (a) v2 `things.find({targetId, thingtime:'reaction'})` projected to `{ownerId, 'crystal.emoji'}`, (b) legacy `things.find({kind:'reaction', parentId: target.shareId})` using `token`, and (c) the embedded `target.reactions` map — then dedupe by (userId, emoji) exactly as mergedReactionsOf does before counting. A plain `$group` on `crystal.emoji` alone would drop legacy `kind:'reaction'` docs and the embedded v1 map (migrateThingInteractions only runs on the write branch and only when `!app`; the read-only `emoji === null` path never migrates), and would double-count where embedded residue and a migrated standalone thing coexist. Run (a) and (b) in one Promise.all — one round trip, two tiny index-served finds — and derive both reactionCounts and viewerReactions from the deduped entries. Nothing else in the response uses `related`.

#### browsePopular loads every schema id in the visibility superset with no limit, then ranks and pages in JS

**High** · `remix/app/api/utils/schemas/browse.ts:198` · fix safety: needs-care

Every `sort=popular` request does three unbounded O(N) units of work where N = every schema thing visible to the viewer (all public schemas for an anonymous caller): (1) one document fetch per schema — the `{shareId, createdAt}` projection is not covered, since the visibility `$or` touches `acl`/`visibility` which are absent from the `{thingtime:1, createdAt:-1, shareId:1}` index at collections.ts:427, so Mongo materialises every matching doc before projecting; (2) an `$in` of all N shareIds against the reaction partition — index-served via `{targetId:1, thingtime:1, ...}` (collections.ts:442), so N index seeks rather than a collection scan, but still linear in N; (3) a full in-memory `Array.sort` of N entries on the app server, from which exactly `limit + 1` (21) ids survive at line 229. At N=2,000 schemas that is roughly 2,000 document fetches plus 2,000 index seeks plus a 2,000-element JS sort to render 20 cards. Paging amplifies rather than amortises: `POPULAR_MAX_OFFSET = 500` (line 34) with the default limit of 20 means all 26 pages each redo the identical full scan, group, and sort — the offset only changes which 20 entries are sliced out at the end. Because the whole ranked array is recomputed per request there is no reuse across pages or across viewers, and the per-request cost grows in lockstep with the schema catalog with no ceiling at any size.

*Proposed fix.* Add the bounded candidate window the file already claims to have, matching the established in-repo pattern (search.ts:97/561-564, things.ts:349/2077): introduce `const POPULAR_CANDIDATE_WINDOW = 500;` and change line 198 to `collection.find(match as any).project({ shareId: 1, createdAt: 1 }).sort({ createdAt: -1, shareId: 1 }).limit(POPULAR_CANDIDATE_WINDOW).toArray()`. The sort is served by the existing `{thingtime:1, createdAt:-1, shareId:1}` index at collections.ts:427, so no new index is needed. Critically, the offset must be reconciled with the window or the change introduces dead pages: `POPULAR_MAX_OFFSET` is 500 while a 400-wide window would leave offsets 400-500 returning nothing. Either size the window at `POPULAR_MAX_OFFSET + limit` (about 550) so every reachable offset stays inside it, or clamp the offset to the window the way search.ts:553 does (`Math.min(..., ENGAGEMENT_CANDIDATE_WINDOW)`) and let `nextCursor` at line 240 stop at the window edge. Also set `totalCapped` true when `candidates.length >= POPULAR_CANDIDATE_WINDOW` (search.ts:648 does exactly this) so the UI does not advertise a total the ranking never actually considered — but note `total` itself comes from the independent `cappedCount` helper, so leave that call alone. Accept and document the semantic trade-off: an old schema with many reactions can fall outside the newest-N window and vanish from the popular list. That is precisely the determinism trade-off search.ts and things.ts already make and comment on. The longer-term denormalised `reactionCount` plus `{thingtime:1, reactionCount:-1, createdAt:-1}` index is a sound follow-up but is a separate change requiring write-path maintenance of the counter on every react/unreact, and should not be bundled here.

#### resolveViewStats re-aggregates one postViews doc per unique viewer on every feed render

**Medium** · `remix/app/api/utils/things/views.ts:166` · fix safety: needs-care

Every post-returning API response pays a MongoDB aggregate whose document-fetch count equals the total number of unique viewers across the posts on the page. The index {postId:1, viewerKey:1} makes the match an IXSCAN but cannot cover the group (impressions/dwellMs are non-indexed), so it is a real FETCH per viewer document. A 20-post feed at 1,000 unique viewers/post = ~20,000 doc fetches per render, per viewer, per scroll page; a single 100k-viewer post = ~100k fetches (~12-16 MB scanned) on every render that includes it. Cost is unbounded and grows monotonically with product success, since postViews docs never expire. This runs on the chronological feed, ranked feed, profile lists, search, permalinks, and every create/update response.

*Proposed fix.* Denormalize the rollup, but NOT into `crystal`. The finder proposed `crystal.viewCount` / `crystal.impressions` / `crystal.dwellMs`; `crystal` is a client-supplied patch object merged over the doc on own-thing PATCH (things.ts:3444: `const patch = input.crystal && typeof input.crystal === 'object' ... `), so an owner could PATCH their own view count directly. That would defeat anti-manipulation layer 3 ("owner self-views dropped entirely") documented at views.ts:18. Put the rollup in a server-only top-level field the update sanitizer never accepts (e.g. `viewStats: { uniques, impressions, dwellMs }`) and confirm it is not writable through any thing-update path.

Then in recordPostViews (views.ts:135-155): read `result.upsertedIds` from the bulkWrite to identify which ops actually INSERTED (a new unique viewer) versus updated, and issue one batched things bulkWrite `$inc`-ing `viewStats.uniques` only for the inserted ops while `$inc`-ing impressions/dwellMs for all accepted ops. resolveViewStats then reads fields already on the docs the feed fetched — the aggregate disappears entirely.

Additional work this requires (why it is not mechanical):
1. A backfill migration running the existing aggregate once per post to seed `viewStats`, or counts silently reset to zero on deploy.
2. The duplicate-key retry path at views.ts:152-153 re-runs the whole batch; on retry `upsertedIds` is empty for already-inserted pairs so uniques stay correct, but impressions/dwellMs can double-count (a pre-existing wart that the denormalized counter would now make permanent rather than recomputable from source docs).
3. Keep the `isCustomMongoEndpointActive()` semantics: with stats on the doc itself the custom-plane guard at line 170 becomes structurally unnecessary, but views.test.ts:22 asserts `resolveViewStats(['home-collision']).size === 0` and must be updated deliberately, not incidentally.
4. Verify the `things` write here targets the home plane consistently — recordPostViews resolves posts via getThingsCollection() (data plane) while postViews is a home collection (getHomeCollection); the custom-plane early return at line 107 means these coincide today, but the new write must not become a cross-plane mutation.

A cheaper interim mitigation if the full denormalization is too large: keep the aggregate but make it index-covered by adding impressions/dwellMs to the index, or drop them from the public projection. That removes the FETCH but leaves the O(unique viewers) index scan, so it only buys time.

#### enforceReactionCaps adds 4 serial round trips plus two unbounded distinct() scans before every reaction write

**Medium** · `remix/app/api/utils/things/things.ts:1977` · fix safety: needs-care

Every reaction add pays, inside enforceReactionCaps alone, 3 round trips minimum and 4 when the emoji is new to the post (2 parallel per-user counts, then countDocuments on crystal.emoji, then sequentially countDocuments on the legacy kind branch, then 2 parallel distinct()). In-region (syd1 <-> Atlas Sydney) that is roughly 4-12ms of latency, not the ~840ms claimed. The real cost is scan volume: none of the three v2-era queries can use the things_reaction_unique partial index (no crystal.emoji predicate), so each falls back to {targetId, thingtime, createdAt, shareId} and, because that index lacks ownerId and crystal.emoji, does a full FETCH of every reaction document on the target. A post with 5,000 reactions therefore triggers ~15,000 document fetches per new reaction; the per-user count fetches 5,000 docs to find at most 20. distinct() additionally has no limit and no 16MB-safe bound. Cost is O(reactions on target) per write and grows with post popularity, which is exactly backwards for a hot post.

*Proposed fix.* Two-part, and only part one is mechanical. (1) Safe now: collapse the era check into one query - countDocuments({$or: [{targetId: targetShareId, thingtime: 'reaction', 'crystal.emoji': token}, {kind: 'reaction', parentId: targetShareId, token}]}, {limit: 1}) - semantically identical to the `||` truthiness test, one round trip instead of two sequential. (2) The real win is index coverage, not query rewriting: add col.createIndex({targetId: 1, thingtime: 1, 'crystal.emoji': 1, ownerId: 1}) in ensureIndexes (remix/app/api/utils/mongodb/collections.ts, beside the existing {targetId, thingtime, createdAt, shareId} entry). That makes all three v2 cap queries covered (no FETCH), lets the emoji-existence count be an index-only probe, and gives distinct('crystal.emoji', {targetId, thingtime}) a DISTINCT_SCAN over the index prefix instead of a full fetch of every reaction doc. Do NOT apply the proposed $group+$limit aggregate: $group is a blocking stage, so the $limit runs after the whole group completes and saves nothing. A denormalized token set or count on the target would be the strongest fix but is a larger, transactional change.

### Database — connection lifecycle and cold start

#### getMongoStatus opens and closes a brand-new MongoClient on every page view

**Critical** · `remix/app/api/utils/mongodb/status.ts:58` · fix safety: needs-care

Every full page load on every route except /messages triggers TWO uncached `/api/v1/health/mongodb` requests (the effect re-fires when `targetOrigin` resolves post-mount; the client-side `xhr.abort()` does not cancel the server work), and each one builds and tears down a fresh authenticated MongoClient instead of using the memoised pool sitting in the same process. Per call that is ~5-6 wasted round trips beyond the 3 the check actually needs — SRV + TXT DNS, TCP handshake, TLS handshake, driver `hello`, SCRAM-SHA-256 saslStart/saslContinue — plus TLS/SCRAM CPU, then the authenticated connection is discarded. In-region (syd1 ↔ Atlas Sydney) that is roughly 20-40 ms wasted per call, ~40-80 ms per page load; in the cross-region case this repo has measured at 209 ms/RT it is ~1.0-1.3 s per call and ~2-2.6 s of lambda hold per page load. It also churns 2 authenticated Atlas connections per page load against the cluster connection cap, directly defeating the deliberate `maxPoolSize: 10` budget in collections.ts. Because the fetch happens after mount, it does not block first paint or LCP — the cost is server compute, serverless hold time, and Atlas connection pressure, which shows up as cost and as cap exhaustion under traffic bursts rather than as page latency.

*Proposed fix.* In remix/app/api/utils/mongodb/status.ts, replace the throwaway-client block (lines 53-63 and the `finally` close at 97-103) with the memoised pool. Use the already-exported `getThingtimeDb()` from `./collections` rather than the finder's `getClientCachedFor(...)`, which is not exported:

  import { getThingtimeDb } from './collections';
  ...
  const db = await getThingtimeDb();   // active plane: home, or the request's override
  const start = Date.now();
  await db.command({ ping: 1 });
  const pingMs = Date.now() - start;
  const collections = (await db.listCollections().toArray()).length;
  const hello = await db.command({ hello: 1 }).catch(() => null);

Delete the `let client: any`, the `new MongoClient(...)`, the `await client.connect()`, and the entire `finally { await client?.close() }` — never close a pooled client. `getMongoDb` becomes an unused import; drop it. `db.databaseName` stays 'thingtime' for home, so the payload is unchanged. `probeMongoUrl` (endpoint.ts:152) remains the correct throwaway-client path for a never-before-seen override URI being validated, and is untouched.

Verify after the change: load any non-/messages page, confirm the footer still shows "MongoDB: connected (Nms)", and confirm /mongodb-status and its refresh button still work. Watch for the timeout delta — an unreachable cluster now takes ~5 s (home client options) instead of 2 s to paint "disconnected".

Optional second step, worth doing but not mechanical: fix the double-fire in the UI. `FooterStatusPanel`'s `targetOrigin` flips from `undefined` to `window.location.origin` after mount (FooterStatusPanel.tsx:38-40 + statusEnvironment.ts:110), re-running MongoStatus's effect and doubling every status endpoint hit — NitroStatus, FrontendStatus and VercelStatus take the same `targetOrigin` prop and very likely double too. Gating the fetch on `currentOrigin` being resolved, or omitting `targetOrigin` from the URL when it equals the current origin, halves all four.

Skip or defer the proposed 5 s per-URI status memo: `StatusRefreshButton` exists to force a fresh check and a blanket memo would serve it stale.

#### maxPoolSize:10 caps concurrent DB work per instance on Fluid compute

**High** · `remix/app/api/utils/mongodb/collections.ts:41` · fix safety: needs-care

Every home-database request shares a 10-connection pool per Fluid instance, a number chosen on 2026-07-29 for one-request-per-instance serverless and never revisited when Fluid compute was enabled on 2026-08-08 (665e2d28). Ceiling is ~10 simultaneous in-flight DB operations per instance regardless of how many invocations Fluid multiplexes into the process. In steady state post-syd1 (2-5ms/op) that supports roughly 5-10 concurrent requests before checkout queueing begins, with each queued checkout costing one op duration (~2-5ms) — modest. The real exposure is at the tail: the 50 `withMongoTransaction`/`withHomeMongoTransaction` call sites pin a connection for an entire snapshot-read + w:majority-commit transaction, and slow aggregations (feed `$and`-of-`$or` collection scans, `$graphLookup` thread counts, share-count aggregates noted in the perf audit) hold slots for tens to hundreds of ms. Under a burst, throughput collapses toward ~pool_size / hold_time, and because `waitQueueTimeoutMS` is unset (driver default 0 = wait indefinitely), the symptom is unbounded latency growth and eventual gateway timeouts rather than a fast error or a clean 429. The cap has already forced a code workaround in messenger.ts:213 ("maxPoolSize is 10, so 50 concurrent inserts still drain as 5 sequential pool rounds").

*Proposed fix.* Two separable changes at collections.ts:37-48, of different risk:

(a) Low risk, do first: add `waitQueueTimeoutMS: 5000` to the home options. This does not change capacity, only the failure mode — pool starvation becomes a fast, attributable driver error instead of an indefinite hang. Note it converts some current slow-successes into errors, so confirm the API error paths surface it sanely (the rate limiter already has fail-open/fail-closed semantics in rateLimit/enforce.ts that will now see a throw).

(b) Needs verification before landing: raise `maxPoolSize` (driver default is 100; 25-50 is a sane middle) and add `minPoolSize: 5`. This MUST be checked against the actual Atlas tier's connection limit — the existing comment asserts M0 with a ~500-connection cap, but the 2026-07-29 perf audit recorded an M0 upgrade as contemplated-but-conditional, so the live tier is not established by anything in this repo. Budget as (peak concurrent Fluid instances across prod + every preview deployment, which share the same cluster) × maxPoolSize, and confirm headroom before picking the number. Also note `minPoolSize: 5` interacts with the boot-time index battery (server/plugins/mongo-warmup) — the perf audit's KEY LESSON was that adding boot-time connection work made cold starts worse when it contended with the first request, so re-measure cold start after this change rather than assuming warm-pool improvement.

Do not update the number without also rewriting the stale justifying comment at lines 29-36, which still describes the pre-Fluid instance model.

#### Status endpoint fetches full collection metadata just to count collections

**Medium** · `remix/app/api/utils/mongodb/status.ts:71` · fix safety: needs-care

Low. Endpoint is warm (footer MongoStatus mounts on every non-fullBleed page, uncached, ~1 call per app mount per visitor), but the saving is ~5-8KB of BSON (~25 collections x ~200-300B of CollectionInfo: name, type, options, info{readOnly,uuid}, idIndex) on a round trip that happens either way, plus ~2-6ms if ping/hello were also dropped — prod is pinned to syd1 (vercel.json) co-located with the Sydney Atlas cluster, so per-command RTT is ~1-3ms, not the ~200ms a cross-region deployment would cost. The endpoint's real cost is the per-request `new MongoClient` + connect + close at status.ts:58-63/99, which the finding missed entirely.

*Proposed fix.* Change only line 71 to `const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).length;`, matching the existing convention at collections.ts:142. Do NOT drop the `ping` (pingMs is a documented, user-visible ping RTT at status.ts:16-17 and in the footer label) and do NOT read setName from `client.topology?.s?.description?.setName` (private driver internals; also cannot be cached from warnIfTransactionsUnsupported, which probes the HOME db while getMongoStatus intentionally probes the request's ACTIVE/custom endpoint). If real latency on this endpoint matters, the item to fix is status.ts:58-63/99 — a fresh MongoClient is connected and closed per request, so every page view pays a full TCP+TLS+SCRAM handshake and throws the pool away.

#### Rate limiter costs two sequential round trips and two pool checkouts per mutating request

**Medium** · `remix/app/api/utils/rateLimit/enforce.ts:61` · fix safety: needs-care

Every rate-limited request pays one strictly sequential, behaviourally-redundant MongoDB round trip and one extra checkout from the home client's 10-connection pool (maxPoolSize:10, mongodb/collections.ts:41) before the route does any work; rejected requests pay two extra (the trailing findOne at :78). This fires on all 154 enforceRateLimit call sites under app/routes/api/v1/, including high-frequency polling reads — notifications.list (bell poll, 120/min budget), chats.read (240/min), chats.message (120/min), things.views, things.search, and oauth.read on app-token GETs — so it is not confined to mutations. Concretely the limiter costs 2 DB ops where 1 suffices: a 2x reduction in limiter round trips and pool-slot consumption. With app and Atlas co-located in Sydney (vercel.json regions:["syd1"]) the latency saved is roughly 1-5ms of serial time per request, so the real value is pool-throughput headroom under burst, not a dramatic latency win. byteBudget.ts has one cold call site and should be treated as a separate, lower-priority item.

*Proposed fix.* Collapse enforce.ts consume() to a single findOneAndUpdate with upsert:true and a pipeline update, filtering on {key} alone. Do NOT keep the limit test in the filter: rateLimits has a unique index on key (collections.ts:798), so an unmatched filter plus upsert throws E11000 on every over-limit request. Move the test into the pipeline, e.g. requests: {$cond: [{$lt: [{$size: activeRequestsExpr(windowStart)}, limit]}, {$concatArrays: [activeRequestsExpr(windowStart), [now]]}, activeRequestsExpr(windowStart)]}, and set updatedAt/expiresAt unconditionally so TTL refresh behaviour is preserved. Array length alone cannot distinguish "admitted at limit-1" from "rejected at limit", so also set an admission marker only in the admitting branch (e.g. lastAdmittedAt: {$cond: [<same test>, now, '$lastAdmittedAt']}) and derive allowed by comparing the returned lastAdmittedAt to now. This also removes the reject-path findOne at :78. Concurrent upserts on the unique index can still raise E11000 (same exposure as today's first updateOne, which currently fails open via the catch) — add a single retry on duplicate-key to be safe. Leave byteBudget.ts for a separate change; its middle write performs real window-roll work and its awaited ensureIndexes() is the bigger cost there.

### API — per-request handler work

#### getCurrentUser serializes 3 independent Mongo round trips on every authenticated request

**Critical** · `remix/app/api/utils/auth/getCurrentUser.ts:31` · fix safety: needs-care

Every authenticated API request pays 3-4 strictly sequential Mongo round trips before the handler body runs: getLiveSession(jti) -> findUserById(expectedUserId) -> getSubscription() (which is itself 2 sequential findOnes for any user without a trusted subscription ledger doc, i.e. most free accounts). Both keys are known the moment verifyJwt returns, so at minimum the session and user reads are trivially independent. Production is same-region (vercel.json pins regions: ["syd1"], co-located with Atlas Sydney), so at ~1-3ms per Atlas round trip this is roughly 4-12ms of fixed auth latency on every one of the 83 getCurrentUser call sites, of which ~3-9ms is recoverable by collapsing to a single fan-out. The cost is paid per poll tick, not per page view: ChatView polls an open chat every 4s (15 auth chains/min/open chat), MessengerPage every 15s, MessengerNotifications every 25s, NotificationsBell every 90s. Aggregate DB query volume drops too (4-5 queries per auth today). The finder's ~630ms figure came from the repo's older cross-region perf note and no longer holds after the syd1 region pin; the correct framing is a fixed few-ms tax on 100% of authenticated traffic plus a multiplied query load on the DB, not a user-visible half-second stall.

*Proposed fix.* In resolveSessionUser, fan out the two independent reads: `const [session, user] = await Promise.all([getLiveSession(jti), findUserById(expectedUserId)])`, then run the existing checks in the same order (session exists -> session.userId binding -> purpose not app/app-sandbox/pat -> user exists -> serviceAccountAuthenticationAllowed) against the already-resolved pair. A user doc fetched for a session that then fails validation is simply discarded — findUserById is a pure read with no side effects, so no security property changes. Add the subscription read to the same Promise.all only with a guard: getSubscription is currently keyed on String(user._id), and while that equals expectedUserId on both branches (userThingToDoc sets _id: thing.shareId at users.ts:275 and findUserById matches shareId === String(id); the legacy branch matches new ObjectId(id) so String(_id) is the canonical lowercase hex of id), pre-keying on expectedUserId assumes claims.sub is already canonical. Either assert that or keep the subscription read keyed off the fetched doc. Also attach a .catch to the eagerly-started promises (or use Promise.allSettled) so a rejection on a path that returns null early does not surface as an unhandled rejection. Separately, and independently of this change, getSubscription's own second findOne (subscriptions.ts:258) can be folded into a Promise.all with the first, since the initialSubscription seed read only depends on subjectId — that removes the 4th trip for free-tier users.

#### Rate limiter does two sequential writes per call; 73 API routes pay it

**High** · `remix/app/api/utils/rateLimit/enforce.ts:61` · fix safety: needs-care

Every rate-limited request pays 2 sequential writes to the home cluster's rateLimits collection instead of 1; a blocked request pays 3 (write, write, read). That is one unavoidable extra serialized DB round trip on 154 call sites across 73 v1 route files, all enabled by default — including the pollers (notifications.list, chats.read at 240/min) and every mutation (things.react/save/write, chats.message). Cost is one full DB RTT per request: ~1-3ms same-region, but ~200ms+ if the app region and Atlas region are mismatched (a previously measured failure mode in this repo), where it alone roughly doubles the pre-handler latency of e.g. POST /api/v1/things/react. Secondary write amplification: the pipeline `$concatArrays` rewrites the entire `requests` array (up to `limit` Date entries — 240 for chats.read, 600 for attachments.parts/things.write.service) on every single hit, and the priming updateOne separately dirties updatedAt/expiresAt on the same doc, so each request produces two writes/oplog entries against one hot document per (endpoint, identity).

*Proposed fix.* Do NOT apply the finder's fix verbatim. `rateLimits` has a UNIQUE index on `key` (collections.ts:798). If you drop the priming write and give the single findOneAndUpdate `upsert: true` with an `$or`/`$expr` filter, then on the blocked path (doc exists but is over limit) nothing matches, Mongo attempts an insert, and it throws E11000. That exception propagates to enforceRateLimit's catch, which fails OPEN for ordinary endpoints — silently disabling rate limiting exactly when a caller is over the limit. That is a security regression, not just a bug. Safe shape instead: (1) run the existing findOneAndUpdate FIRST with no upsert; (2) if it returns a doc, done — 1 round trip in the steady state; (3) if it returns null, disambiguate "missing doc" from "over limit" with a single `updateOne({key, requests:{$exists:false}}, {$setOnInsert…}, {upsert:true})`-then-retry, or an upsert wrapped in a try/catch that treats E11000 strictly as "blocked" (never as an outage) — so the extra round trips are paid only on the first hit of a window and on genuinely blocked requests. Separately worth considering: `$slice` the `requests` array or store a bucketed counter instead of one Date per hit, so the hot doc stops being rewritten wholesale.

#### resolveActor resolves the session twice for every Bearer-token request

**High** · `remix/app/api/utils/auth/resolveActor.ts:72` · fix safety: needs-care

Affects exactly 8 call sites in 6 route files, all of which pass thingsScope: things/_things.tsx:88 (GET) and :180 (CRUD POST/PUT/DELETE), things/update/_update.tsx:18, things/delete/_delete.tsx:16, things/comment/_comment.tsx:22, things/search/_search.tsx:77 and :114, things/react/_react.tsx:21. CORRECTIONS to the finder: (1) /things/feed and /things/save are NOT affected — they import resolveThingsActor from patTokens directly (_feed.tsx:41, _save.tsx:12) and resolve once; (2) /things/bulk is NOT affected — it uses getCurrentUser (_bulk.tsx:14), so the "this is exactly the bulk-write traffic" framing is wrong; (3) app tokens themselves are NOT affected — they return early at resolveActor.ts:92 after a single resolve. The waste is confined to Bearer requests whose session purpose is 'browser'/'service'/'pat'. Cost per such request: one extra sessions.findOne({jti}) — served by the unique index at collections.ts:732, so cheap server-side and dominated by the network round trip (roughly 1-3 ms same-region Atlas; the ~200 ms figure from the iad1-vs-Sydney era only applies if the vercel.json syd1 region override is ever lost) — plus one extra jose ES256 jwtVerify (sub-millisecond, WebCrypto ECDSA P-256). For a PAT request the pat path already costs 3 round trips (getLiveSession, consumePatUse updateOne, findUserById), so the duplicate adds roughly 25-33% to auth round trips, not to total request time. Also note the first-party web UI is cookie-based (no route outside docs/tokens sends an Authorization header), so this is the external API-client / PAT / service-account surface only. Severity is medium, not high: real, systematic, trivially avoidable waste on the whole programmatic API surface, but a single indexed lookup rather than an algorithmic blowup.

*Proposed fix.* Do NOT rewrite the three resolvers into one merged branch — resolveAppToken and resolveThingsActor have other callers (things/feed, things/save, tokens introspection at patTokens.ts:339) and each carries security checks that must survive verbatim: the claims.sub-vs-session.userId binding (appTokens.ts:111, patTokens.ts:269), the Bearer-only re-check for PATs (patTokens.ts:281-283), sandbox-user synthesis, findAppByClientId/appAllowsOrigin/appIsRevoked, and resolveSessionUser's explicit rejection of app/app-sandbox/pat purposes. Safer shape: resolve {claims, session} once at the top of resolveActor (only when an Authorization: Bearer header is present, so cookie behaviour is byte-identical), then thread it into resolveAppToken and resolveThingsActor as an optional pre-resolved argument that each function uses in place of its own verifyJwt+getLiveSession while keeping every subsequent check unchanged. Alternatively, memoize verifyJwt+getLiveSession per request via a WeakMap keyed on the Request object. Critically, the cache must be request-scoped only — a process-global or TTL cache of live sessions would break immediate revocation, which FUNDAMENTALS §5 makes the whole point of the sessions collection.

#### Every attachment/image fetch pays the full auth chain plus a fail-closed rate-limit write before a 302

**High** · `remix/app/routes/api/v1/attachments/content/_content.tsx:24` · fix safety: needs-care

7 sequential DB round trips (8-9 total ops) to produce a 302 redirect, on a route hit once per post attachment AND once per distinct profile avatar/banner rendered. Breakdown: sessions.findOne -> findUserById -> getSubscription (1-2 findOne, entirely unused here — the route only reads user.id/username/accountKind) -> limiter updateOne -> limiter findOneAndUpdate -> attachment getById -> canViewTarget findOne. Amplified by Cache-Control: private, no-store, max-age=0 on the redirect (attachmentResponses.ts:5), which forbids browser caching and forces the full 7-RT chain again on every re-render, remount, and back-navigation — even though the presigned URL it returns is valid for 10 minutes. A feed screen with 20 attachments/avatars issues ~140 serialized-per-request DB ops and 40 rate-limiter writes per paint, against maxPoolSize: 10 (collections.ts:41), and re-issues all of it on the next paint. Roughly 3 of the 7 RTs (the subscription read, its seed follow-up, and the serialization of session vs user lookup) are pure waste on this route.

*Proposed fix.* Apply the low-risk subset first, and treat two parts of the original proposal as hazardous. SAFE: (1) In resolveSessionUser (auth/getCurrentUser.ts:28), Promise.all([getLiveSession(jti), findUserById(expectedUserId)]) — both inputs come from the JWT claims alone, so they can run concurrently as long as every rejection guard (session exists, session.userId === expectedUserId, purpose not app/app-sandbox/pat, user exists, serviceAccountAuthenticationAllowed) still runs in the same order before returning; costs one wasted read on the reject path. (2) Add a lean getCurrentUser variant that returns only {id, username, accountKind} and skips toPublicUserWithStorage/getSubscription, and use it here — this needs a new return type since PublicUser carries storage fields, so it is not a one-line change but carries no correctness risk. Those two remove 2-3 of the 7 RTs. HAZARDOUS, do not apply mechanically: (a) Collapsing the limiter to a single op is NOT safe — the leading updateOne upsert in consume() exists because findOneAndUpdate with an $expr size filter cannot upsert (an upsert whose $expr fails would insert a duplicate bucket), and this call site is failClosed, so getting it wrong is a rate-limit bypass on a security surface. (b) A signed-URL cache must be keyed on (viewer, attachmentId), never attachmentId alone — canViewTarget is a per-viewer authorization decision, so an id-only cache leaks private attachments across users. Separately worth raising with the owner but out of scope for a mechanical perf fix: the no-store header is a deliberate policy constant (ATTACHMENT_PRIVATE_CACHE_CONTROL), and relaxing it to a short private max-age would eliminate most of these requests entirely — but that is a security decision, not a refactor.

#### resolveAppToken serializes the app lookup and the user lookup, then adds a subscription read

**Medium** · `remix/app/api/utils/apps/appTokens.ts:135` · fix safety: needs-care

Every app-token request pays 4-5 SERIALIZED indexed round trips just to establish the actor, before its own rate limiter (2 more writes) and the actual data read. Two of those trips are removable outright. Parallelizing the app+user reads saves 1 RT; replacing toPublicUserWithStorage with toPublicUser(user, null) saves 1-2 more (getSubscription is 1 RT for a trusted ledger doc, 2 sequential when it falls back to the initialSubscription seed lookup). Net: 4-5 serialized RTs collapse to 2 (session, then app+user in parallel) — a ~50-60% cut in pre-route latency on /oauth/userinfo, /oauth/shared, /app-data GET/POST/delete/usage/shared, and every app-token /things* call. With vercel.json pinning regions ["syd1"] beside Atlas Sydney that is single-digit ms per request; under the documented region-mismatch regression (iad1 vs Sydney, ~209ms/RT) the same change is worth roughly 400-600ms per app-token call. Severity medium is fair: modest absolute win today, but it is per-request, on the whole public third-party API surface, and costs nothing to take.

*Proposed fix.* Two independent changes, both in resolveAppToken (appTokens.ts:135-147).

1. Parallelize the two independent lookups (safe, purely mechanical):
   const [app, user] = await Promise.all([findAppByClientId(clientId), findUserById(claims.sub)]);
   if (!app || !appAllowsOrigin(app, origin)) return null;
   if (appIsRevoked(app)) return null;
   if (!user) return null;
   Keep the app checks BEFORE the !user check so the rejection ordering and error semantics are unchanged. Note this now always issues the user read even when the app check fails — one extra indexed read on the rejection path, no correctness or disclosure change (the user doc never escapes the function).

2. Drop the subscription trip: replace `user: await toPublicUserWithStorage(user)` at line 147 with `user: toPublicUser(user, null)` (import toPublicUser from '../auth/users'; it is already exported at users.ts:122). This yields exactly the storage shape the sandbox branch already returns (status 'unavailable', nulls), which every consumer of ctx.user already tolerates. If a future consumer ever needs real storage on an app token, it should call getSubscription itself rather than taxing every request.

Verify with the app/oauth smoke suites (verify-app-namespaces.mjs, verify-pat-tokens.mjs) plus a live GET /api/v1/oauth/userinfo and /api/v1/app-data/usage with a real app token.

#### POST/PUT/PATCH /api/v1/things buffers and parses the whole body with an uncapped request.json() before any auth

**Medium** · `remix/app/routes/api/v1/things/_things.tsx:178` · fix safety: needs-care

Pre-auth, unauthenticated body buffering + JSON.parse on the repo's primary CRUD mutation endpoint. The Content-Length pre-check at line 166 is the only size guard and is skipped entirely by a chunked-transfer request (no content-length header, so Number(null || 0) === 0 passes), letting an anonymous caller reach line 178 before resolveActor (180) and the 401 (182). On production (Vercel Fluid, syd1) the gateway's ~4.5 MB function request-body limit bounds each request to roughly 6x the intended 768 KB MAX_BODY_BYTES, so this is a bounded overrun rather than unbounded heap; it still matters because Fluid packs concurrent invocations into a single instance's memory, so concurrent oversized parses stack toward the instance memory ceiling, and the CPU cost of JSON.parse on multi-MB payloads is paid before any authentication or rate limiting (enforceRateLimit does not run until line 197). On the local/self-hosted Nitro node server there is no gateway limit at all, so the buffer is genuinely unbounded there. Characterize this as a DoS hardening gap, not a latency regression: legitimate browser/SDK clients always send Content-Length for a JSON string body and are correctly rejected by the existing fast path, so normal traffic incurs no cost today.

*Proposed fix.* Do NOT use the finder's suggested `readJsonBody(request, MAX_BODY_BYTES)` verbatim — it throws a bare 413 with no CORS headers, and this route is cross-origin (appDataPreflight line 161, appCorsHeaders on the existing 413 line 170), so cross-origin callers would see an opaque fetch rejection instead of the readable 413 JSON. That exact regression is what remix/app/api/utils/apps/cors.ts:35-39 documents and guards against. Instead, at line 178 replace `const body = await request.json().catch(() => ({}));` with `const body = await readJsonBodyWithCors(request, MAX_BODY_BYTES, appCorsHeaders(request.headers.get('Origin')));` and add `readJsonBodyWithCors` to the existing `~/api/utils/apps/cors` import on line 4 (appCorsHeaders is already imported). This mirrors remix/app/routes/api/v1/oauth/sandbox/_sandbox.tsx:51. Semantics are otherwise preserved: readJsonBody returns {} on malformed JSON just like the current `.catch(() => ({}))`, and the thrown Response propagates through the catch-all's `if (err instanceof Response) return err` handler. The declared-length pre-check at lines 166-172 can stay as a cheap fast path (readJsonBody repeats it internally, but the existing one carries the route's CORS headers). Verify the 413 still returns Access-Control-Allow-Origin after the change, and confirm the pre-auth ordering comment at lines 174-176 still holds — the body must still be parsed before resolveActor so patScopeFor can route the PAT scope.

#### users/relationships serializes three independent awaits

**Medium** · `remix/app/routes/api/v1/users/relationships/_relationships.tsx:22` · fix safety: needs-care

Removes 1 of ~8-9 sequential Mongo round trips (~11%) from GET /api/v1/users/relationships, i.e. roughly 1-3ms in-region (syd1 -> Atlas Sydney). Applies to the profile page's background relationship reconcile, which already paints from localCache, so it is a server-latency/serverless-compute saving rather than a first-paint win except on a cold cache. Severity is closer to low than medium.

*Proposed fix.* Hoist the URL parse and start the target lookup alongside auth, keeping the limiter gate before relationshipSummary: `const params = new URL(request.url).searchParams; const targetPromise = resolveSocialTarget({ userId: params.get('userId') || undefined, username: params.get('username') || undefined }); const user = await getCurrentUser(request); const limit = await enforceRateLimit(request, 'users.relationships', user ? `user:${user.id}` : null); if (!limit.allowed) { targetPromise.catch(() => {}); return json(...); } const result = await relationshipSummary(user?.id || null, await targetPromise);` Note this makes a throttled request still perform one user lookup, which slightly weakens the bucket's stated purpose of bounding DB work for anonymous public reads; attach a .catch so the in-flight promise cannot reject unhandled on the 429 path. Do NOT apply the proposed change to things/views/_views.tsx.

### API — caching and cache headers

#### Hashed client bundles ship with no Cache-Control — the 1-year publicAssets maxAge is silently discarded

**Critical** · `remix/scripts/patch-vercel-output.mjs:21` · fix safety: needs-care

Measured against the current build (remix/dist), not the finder's stale numbers:

- 141 content-hashed JS chunks, 4.21 MB total (excluding .map files) — not "13 files".
- Entry chunk is index-BHYVSjYE.js at 1,582,563 B (1.51 MB) — not 3,427,915 B / 3.4 MB. The finder's figure was from the stale artifact and/or included the sourcemap.
- The number that actually matters and that the finder missed: dist/index.html eagerly references 80 of those chunks (79 `<link rel=modulepreload>` plus the module entry), totalling 2,728,654 B (2.6 MB). So a repeat navigation or hard reload issues ~80 conditional GETs, not ~13.

Cost, stated honestly: these 80 revalidations are multiplexed over one HTTP/2 connection, so this is NOT "80 serial round trips". It is roughly one RTT of added blocking latency before module execution can begin, plus 80x request/response header overhead and 80 edge lookups per load. On a ~150 ms-RTT mobile link that is on the order of 150-400 ms added to every repeat visit and every reload, on files whose content hash guarantees they can never change. The qualitative loss is larger than the millisecond count: it removes the zero-network disk-cache path entirely, so back/forward and reload never restore instantly, and the app cannot paint at all without the network even though every byte is already on disk. The 3.4 MB / "13 x 20-60 ms serialised" framing in the original report overstates the per-request arithmetic while understating the request count by 6x.

*Proposed fix.* Land the header in remix/scripts/patch-vercel-output.mjs, NOT in nitro.config.ts (the patch script would discard a Nitro-emitted route).

In patch-vercel-output.mjs, add alongside `appShellHeaders`:

  const immutableAssetHeaders = { 'Cache-Control': 'public, max-age=31536000, immutable' };

and insert into the `config.routes` array before `filesystemRoute` (line 56), after the CSP continue-route:

  { src: '^/assets/(?:.*)$', headers: immutableAssetHeaders, continue: true },

`continue: true` means it stamps the header and lets `{ handle: 'filesystem' }` serve the file. index.html is at `/`, not `/assets/`, so it keeps its `private, no-store` shell headers and deploys are still picked up immediately.

Then assert it in remix/scripts/verify-vercel-output.mjs next to the existing `expectedAppShellCacheControl` block (~line 92-101): find the `/assets` route, require the exact Cache-Control value, `continue === true`, and that its index is less than `filesystemIndex`. Optionally mirror the assertion in remix/scripts/vercel-config.test.mjs.

Do NOT set `fallthrough: false` on the top-level publicAssets entry as a shortcut — it would restore the header but 404 every SPA route.

Optional follow-up, out of scope: the second publicAssets entry (`/docs/design-bundles`, maxAge 3600) has fallthrough falsy, so the Vercel preset gives it a hardcoded `max-age=31536000, immutable` (_presets.mjs:1460-1464), silently ignoring the intended 1 hour. Worth a separate look.

#### /api/docs memoises a 308 KB render into an unbounded Map keyed by request origin

**High** · `remix/server/routes/api/docs.ts:11` · fix safety: safe-mechanical

Every distinct Host header that reaches GET /api/docs permanently pins ~613 KiB (314,076 chars stored two-byte because of 758 em dashes) in the warm instance's heap, to save a measured ~2 ms of render CPU. On Vercel this is bounded by host-based edge routing to roughly 3-6 origins per deployment (~2-4 MB) — real but not fatal. On any self-hosted or reverse-proxied deployment that forwards arbitrary Host values, it grows without bound at 613 KiB per unique host until the process is recycled. The defect is the missing bound on a caller-keyed cache holding 0.6 MB values for a 2 ms saving, plus the missing s-maxage that would let the CDN absorb repeats entirely.

*Proposed fix.* Two-part, both low-risk. (1) Bound the Map: keep insertion-order eviction at a small cap (1-4 entries), matching the existing MAX_CUSTOM_CLIENTS / READ_RECEIPTS_CACHE_MAX pattern — e.g. after `cache.set(origin, markdown)`, `if (cache.size > 4) cache.delete(cache.keys().next().value)`. Given the ~2 ms render, a cap of 1 is defensible. (2) Add `s-maxage=300, stale-while-revalidate=86400` to the existing `public, max-age=300` Cache-Control so Vercel's CDN actually absorbs repeat hits (plain max-age does not enable Vercel edge caching for functions). Do NOT adopt the finder's alternative of rendering once with a relative-URL placeholder and dropping the origin key: `origin` appears 158 times in the rendered output, including every `curl` example and the /docs/api link, so that variant changes user-facing documentation content and is a behaviour regression, not a mechanical fix.

#### /api/v1/health/mongodb opens a brand-new MongoClient per request, bypassing the memoised connection cache

**High** · `remix/app/api/utils/mongodb/status.ts:58` · fix safety: needs-care

Every page load that renders the footer builds and tears down a whole MongoClient server-side. Cost per check, over the pooled alternative: for a mongodb+srv URI, an SRV + TXT DNS resolution (not cached by the driver across clients); TCP + TLS handshake; the driver handshake `hello`; SCRAM-SHA-256 (saslStart + saslContinue) — roughly 5 network round trips before the first useful command. Then 3 more commands (ping, listCollections, hello) and a close. The driver also starts topology monitoring, opening a monitor connection per replica-set member (3 on a standard Atlas RS), so one footer render churns ~4 connections rather than one. Going through the existing cache would cost 1-2 round trips on a warm instance and 0 new connections. Concretely: in-region Atlas (~1-3 ms RTT) that is ~30-60 ms of avoidable server time per page load; with the region mismatch this repo has hit before (~200 ms RTT), the same check is ~1.5-2 s of server time versus ~200-400 ms pooled. The connection churn is the more dangerous half: it is exactly the failure mode the clientCache comment was written to prevent (Atlas connection caps under bursty serverless fan-out), and here it is driven by anonymous page views, so it scales with traffic rather than with authenticated activity. `listCollections()` (a full namespace listing over the whole DB) on this path is pure waste — the payload only uses `.length`.

*Proposed fix.* Route getMongoStatus through the memoised cache instead of `new MongoClient` + `close()`, but do NOT do a blind swap to `getThingtimeDb()`. Two behaviours are load-bearing and must be preserved: (1) the deliberate 2000 ms serverSelection/connect fail-fast documented at status.ts:26-29 — the cached client uses 5000 ms, so an unreachable endpoint would stall the footer request 5 s instead of 2 s; (2) `getThingtimeDb()` has side effects on a custom endpoint (`ensureCustomDataIndexes(uri, db)`, collections.ts:200) and triggers the home adoption pass — a read-only status probe should not create indexes in a user-supplied database. Preferred shape: export a thin cached-client accessor from collections.ts (or reuse `getClientCachedFor`) that returns the already-connected client for the active URI, have status.ts call `client.db(getActiveMongoDbName())` directly, and wrap the ping/hello in an explicit 2 s `Promise.race`/`maxTimeMS` so the fail-fast contract survives. Drop `listCollections()` from the hot path or memoise its count behind a ~30 s TTL keyed by URI. Add `Cache-Control: private, max-age=15` in the four route files (or in getMongoStatus's callers) so a footer remount inside the same session does not re-hit it. Note one semantic change worth calling out in review: with a pooled client the probe no longer verifies that a *fresh* connection can be established — it verifies the live pooled connection, which is the correct signal for "can this app talk to Mongo right now", but it is a change to what the indicator asserts.

#### Production build emits and deploys 10.6 MB of source maps as public static assets

**Low** · `remix/vite.config.ts:184` · fix safety: needs-care

Every production build emits 139 source maps totalling 12.26 MB alongside only 4.42 MB of JS — maps are ~2.8x the shipped JS payload. All 12.26 MB is copied into .vercel/output/static by Nitro's publicAssets (dist -> '/') and uploaded/stored on every deploy to every branch and preview, and each map is publicly fetchable because the emitted JS carries a `//# sourceMappingURL` comment and the filesystem route serves /assets/* before the SPA fallback. Largest single map is index-BHYVSjYE.js.map at 3.4 MB. End-user latency is unaffected (browsers request .map only with devtools open); the real cost is deploy artifact size/upload time on the hot deploy path plus publication of full pre-minification source including comments. Build-hygiene and disclosure issue, not a runtime performance one.

*Proposed fix.* Do NOT use the finder's primary suggestion of `sourcemap: 'hidden'` — it only drops the `//# sourceMappingURL` comment while Vite still writes all 139 maps into dist, Nitro still copies them into .vercel/output/static, and they remain fetchable by name, so it saves zero deploy bytes. To actually remove the cost, set `sourcemap: false` in remix/vite.config.ts:184 (optionally gated so local/dev builds keep maps, e.g. `sourcemap: process.env.VERCEL !== '1'`), or leave generation on and delete/exclude `*.map` from `.vercel/output/static` inside remix/scripts/patch-vercel-output.mjs before staging. Nothing consumes the maps today — no Sentry/Bugsnag/Rollbar or upload step exists in remix/package.json, nitro.config.ts, remix/scripts/vercel-build.mjs, or the root scripts/vercel-build.mjs — and remix/scripts/verify-vercel-output.mjs only asserts the index.html shell and config.json route ordering, so neither the build verifier nor any test will break. The tradeoff to accept consciously is losing readable production stack traces.

### Frontend — re-render cost

#### ThingtimeContext value is a fresh object literal every provider render

**Critical** · `remix/app/Providers/ThingtimeProvider.tsx:506` · fix safety: risky

Every `setThingtime` (one per keystroke batch, undebounced) re-renders ThingtimeProvider and allocates a fresh `{ Everything }` context value, waking all 29 `useThingtime()` subscribers unconditionally. Since `props.children` keeps a stable element identity, this wrapper is the sole propagation channel — so the fan-out is all-or-nothing with zero granularity. Worst case is the editor: `Thingtime` is recursive, un-memoized, and subscribes at line 179, so a keystroke re-renders O(nodes in tree) components, each of which also runs the large `useMemo` at lines ~880-915. Concurrently, every mounted non-editor consumer (Nav, drawer, the 8 useTtTheme call sites, DevKit, EasterEggs, Commander) re-renders despite reading only static leaves such as `thingtime?.settings?.animationSpeed`, which cannot have changed. `React.memo` on any of these is inert — context updates bypass memo boundaries.

*Proposed fix.* Do NOT apply the naive `useMemo` — it is a no-op here (thingtimeState and paths are new objects on every set). Two viable steps: (1) Cheap and safe: wrap non-tree leaf reads in a selector, or split the context into a stable API context (`setThingtime`, `getThingtime`, `thingtimeRef`, `events` — all already `useCallback`/ref-stable, memoize with `[]`-ish deps) and a data context (`thingtime`, `loading`, `paths`). Dispatch-only and leaf-only consumers subscribe to the API context and stop re-rendering on data changes. This must be mirrored in `LocalThingProvider` (ThingView.tsx:137), which supplies the same context to feed sandboxes, or feed cards break. (2) Independently, wrap the recursive `Thingtime` node in `React.memo` and give it a path-scoped subscription so a keystroke re-renders one node, not the tree. Do NOT "stop mutating Everything in place": `EverythingRef.current` identity is load-bearing — `useThingtimeLine(Everything)` (line 103) memoizes its undo/redo callbacks on `[Everything]` and reads `Everything.thingtime.set(...)` inside them (useThingtimeMachine.tsx:125, 196, 271), and the effect at line 493 deliberately calls `setEverything(EverythingRef.current)` with an identical reference so React bails out. Replacing the object would churn those callbacks and needs the undo/redo path re-verified.

#### Inline onChanged closure in PostList defeats PostCard's React.memo entirely

**High** · `remix/app/components/Feed/PostList.tsx:82` · fix safety: needs-care

On /feed and /profile, PostCard's React.memo has a 0% hit rate. Every engagement event re-renders every mounted card. Concretely: scrolling a 100-post feed (5 pages x 20) fires up to 200 setSessionEventCount updates (one 'view' + one 'dwell' per post, both session-deduped), each re-rendering all currently-mounted PostCards. Wasted work is quadratic in posts loaded — on the order of 10,000+ PostCardImpl executions per full scroll versus the ~100 actually needed, roughly a 100x multiplier. Per execution: 13 useState calls, 4 useMemo/useEffect/useCallback dep comparisons, 3 context reads (useApi/useCurrentUser/useLopu), and reconciliation of a large Chakra v2 subtree where every Box/Flex/Text re-runs emotion's styled-system prop resolution. Cards with an open comment panel (commentsOpen gates at lines 1783/1814) multiply this further. The same inline-identity bug on the wrapper Box's ref callback (line 79) additionally forces observeView(null)+observeView(element) for all N wrappers on each of those re-renders.

*Proposed fix.* Do NOT change PostCard's public contract as originally proposed — onChanged has 30 references inside PostCard.tsx plus a second consumer at remix/app/routes/post.tsx:182, so that route is a wide, risky edit.

Contained fix, entirely within PostList.tsx: extract a memoized row component and build the bound callback inside it with useCallback (hooks cannot go in the .map body).

  const PostRow = React.memo(function PostRow({ post, onPostChanged, onEngagement, observeView }) {
    const handleChanged = React.useCallback(
      (next: PostChange) => onPostChanged(post.id, next),
      [onPostChanged, post.id]
    );
    const setRef = React.useCallback(
      (el: HTMLDivElement | null) => observeView(el, post.id),
      [observeView, post.id]
    );
    return (
      <Box data-thing-id={post.id} ref={setRef}>
        <PostCard post={post} onChanged={handleChanged} onEngagement={onEngagement} />
      </Box>
    );
  });

Then render `<PostRow key={post.id} post={post} onPostChanged={onPostChanged} onEngagement={onEngagement} observeView={observeView} />`. This fixes the ref-identity churn (line 79) in the same edit. Confirm observeView from useViewTracking is a stable useCallback before relying on it as a dep; if it is not, ref it the way Feed.tsx refs its handlers.

Optional follow-up (separate change, bigger win): sessionEventCount is consumed only by one child at Feed.tsx:256. Moving that counter into a context or a selector-style subscription would stop engagement telemetry from re-rendering the whole feed subtree at all, making the memo fix belt-and-braces rather than load-bearing.

Verify with the React DevTools Profiler: a scroll tick that fires a view/dwell event should render 0 PostCards after the fix, versus N before. Then run the /feed and /profile manual checklists in TESTING.md — reactions, comment open/close, optimistic post edit/delete — since this touches the feed's reconciliation identity and the house rule requires optimistic rendering to keep working.

#### setSessionEventCount fires on every engagement event, re-rendering the entire feed page

**High** · `remix/app/components/Feed/useFeedEngagement.ts:73` · fix safety: needs-care

Each recordEvent bumps FeedPage state, re-rendering FeedPage -> PostList -> all N PostCards (memo defeated by the inline onChanged closure at PostList.tsx:82) and detaching/re-attaching all N card refs, each of which runs observeView's O(N) isConnected sweep. With 100 loaded posts (5 pages of 20, no virtualization), ONE counter increment costs ~100 full PostCard renders (PostCard is a ~1000-line Chakra component) plus ~10,000 DOM isConnected checks. Dedup bounds the session at ~2 increments per post, so a first-pass scroll of 100 posts produces up to ~200 increments -> on the order of 20,000 PostCard renders and ~2M isConnected checks, all to increment a number that is only read inside an already-open AlgorithmMenu. React 18 auto-batching collapses entries within one observer callback, but a slow scroll delivers 1-2 entries per callback, so it degenerates to roughly one full-feed render per card entering and per card leaving the viewport. Cost grows quadratically as the infinite scroll grows N; re-scrolling over already-seen posts is free.

*Proposed fix.* Preferred: throttle/coalesce the state write rather than change the hook's public API. Keep sessionEventsRef as the source of truth and publish the count at most once per ~1-2s (or via useSyncExternalStore with a getSnapshot reading sessionEventsRef.current.length), so a scroll burst yields one render instead of one per event. The alternative (replace sessionEventCount with getSessionEventCount()) is also viable but touches three files and depends on AlgorithmMenu re-rendering on open for the isDisabled/badge values to be fresh — verify that before adopting it. Note the two real amplifiers are separate fixes worth doing regardless: hoist a stable per-post onChanged (and the ref callback) in PostList so React.memo actually bails out, and stop the O(N) isConnected sweep from running on every ref re-attach.

#### paths recomputes an O(N²) full-tree walk of the entire thingtime object on every mutation

**High** · `remix/app/Providers/ThingtimeProvider.tsx:326` · fix safety: needs-care

A full synchronous walk of the entire thingtime object runs in the ThingtimeProvider render body on every setThingtime flush — i.e. every keystroke in the tree editor (MagicInput onInput → Thingtime.tsx:921, undebounced) — and can never be memo-skipped because setThingtimeObjectWrapper always spreads a fresh root. Cycle detection uses an Array with `includes`, making it O(N²) reference comparisons. Critically, the walked tree is not bounded by the ~196 defaults keys: the undo/redo timemachine lives inside the thingtime object and `timeline.past` is uncapped and persisted to localforage, so it gains 1-2 object nodes per keystroke and never shrinks across sessions. Measured on a defaults-sized base: 0.56 ms at 0 edits, 7.8 ms at 1k lifetime edits, 27 ms at 5k, 107 ms at 10k — per keystroke, on the main thread. Swapping the Array for a Set cuts those to 1.0/4.2/20.6 ms. The walk also feeds an always-mounted consumer: CommanderV2 (Nav.tsx:255, every page) rebuilds `new Fuse(paths)` over the whole growing array on every change even while the palette is closed, and CommanderV1Deprecated does the same once per undefined node in the /things editor — so the downstream index rebuild costs more than the walk itself.

*Proposed fix.* Two steps, in order. (1) Mechanical: change `seen = []` to `seen = new Set()` and `!seen?.includes(val)` / `seen.push(val)` to `!seen.has(val)` / `seen.add(val)` in populatePaths (ThingtimeProvider.tsx:306-324). Removes the quadratic term; measured ~6.5x faster at 5k lifetime edits. (2) Reviewed: make paths lazy — keep a stable `getPaths()` callback that walks on demand and caches against the current thingtimeState identity, and switch CommanderV2.tsx:151, CommanderV1Deprecated.tsx:180 and EasterEggs.tsx:37 to call it (Commander should only build the Fuse index while the palette is actually open, since that index rebuild is now the dominant cost). Separately, and needing owner sign-off because it changes undo behaviour: cap `timeline.past` in useThingtimeMachine.tsx:328-330 (e.g. keep the last N events) so the persisted state stops growing without bound.

#### Recursive Thingtime tree component is unmemoized and subscribes to the whole context

**High** · `remix/app/components/Thingtime/Thingtime.tsx:158` · fix safety: risky

Every keystroke in any Thingtime value re-renders every visible node in the tree, not just the edited one. ThingtimeProvider.tsx:506 hands a fresh `{ Everything }` literal to the Provider on every render, so context identity changes unconditionally on each `setThingtime`; every node is a bare `useContext` consumer (Thingtime.tsx:179) with no `React.memo` anywhere in the file. Per node that re-render replays 18 useState + 31 useMemo + 7 useRef slots plus `useThings()`, `useLopu()` and a Chakra subtree; each node also mounts ~2-3 `<Icon>` instances which are themselves unmemoized consumers of the same context via `useTtIconStyle` (useTtTheme.tsx:184). A 200-node open tree therefore costs ~200 component bodies + ~400-600 Icon renders per keystroke. Node-level useMemos do not save this because most are keyed on `thingtime`, whose identity changes on every mutation. This is live on the `/` landing page (Landing.tsx:349 renders a real editor), plus /thing, /ode and /branding.

*Proposed fix.* Do NOT apply mechanically — `React.memo` alone is near-worthless here and the context refactor is invasive.

(a) React.memo is defeated at the recursion site as written. Thingtime.tsx:719-737 passes `seen={nextSeen}` (fresh array every render), `path={key}` (fresh object literal when `key.human` is falsy), `parent={thing}`, and `fullPath={[...fullPath, key.key]}` (fresh array). All four break referential equality, so wrapping line 158 in memo changes nothing until those are stabilised or a custom `areEqual` comparator is supplied that compares `safeJoin(fullPath)` rather than the array. Note also line 168 mutates `props.thing = props.value` after the spread.

(b) Splitting the context is the real fix but is architecturally risky. ThingtimeProvider deliberately MUTATES `Everything` in place via `Object.assign(EverythingRef.current, ...)` and carries an explicit "⚠️ ORDER OF THESE OPERATIONS IS IMPORTANT ⚠️" comment; consumers may read through `thingtimeRef.current` and rely on that mutation-based propagation. Splitting stable setters (`setThingtime`/`getThingtime`) into their own context and giving nodes a path-scoped selector for their own value is correct in principle, but it must be done with the provider's mutation semantics preserved and `useTtIconStyle` migrated to a narrow selector at the same time, or Icons keep dragging the whole tree.

Recommended sequencing: first memoize the Provider value and stabilise the recursion-site props, verify no behavioural regression in the landing demo editor, then attempt the context split as a separate change with the TESTING.md tree-editor checklist run.

#### Inline ref callbacks drive an O(n²) DOM sweep on every PostList render

**Medium** · `remix/app/components/Feed/useViewTracking.ts:83` · fix safety: safe-mechanical

Quadratic, but second-order in absolute terms — real waste rather than the bottleneck. Per PostList commit the sweep costs n² Map-entry visits plus n² `Node.isConnected` binding reads: 400 at n=20 (one page), 10,000 at n=100 (5 pages), 40,000 at n=200. At roughly 50-120ns per entry visit that is ~0.5-1.2ms per render at 100 posts and ~2-5ms at 200 — 3-30% of a frame budget, growing as the square of scroll depth. Scrolling a 100-post feed triggers ~200 such renders (2 per post, from the first-view and dwell-close engagement events), so ~1-2M wasted iterations across a session. Honest caveat that argues for low-medium rather than medium severity: every one of those renders also re-renders 100 unmemoized Chakra PostCards, which costs an order of magnitude more than the sweep — fixing the sweep alone will not be perceptible below ~200 posts. The defect is worth fixing because it is free to fix and is the only superlinear term, not because it currently drops frames.

*Proposed fix.* Prefer the two-line reorder over the finder's ref-factory refactor: move `if (elementIdsRef.current.get(element) === thingId) return;` ABOVE the `elementIdsRef.current.forEach(...)` sweep in useViewTracking.ts:78-92, and make the identical move in useFeedEngagement.ts:123-136. The sweep then runs only when a genuinely new (element, id) pair registers — i.e. n times per page append instead of n times per render — which is exactly the situation the sweep's comment describes ("filter/algorithm resets"), so its detached-node cleanup purpose is fully preserved. This removes essentially all the waste without touching PostList at all. Memoising a per-post-id ref-callback map in PostList is a valid additional cleanup (it would also stop the pointless 2n detach/attach churn), but it is a larger change for a smaller remaining win and should be a separate step.

#### useApi rebuilds a 101-callback nested object tree on every render of all 49 consumers

**Medium** · `remix/app/hooks/useApi.tsx:51` · fix safety: needs-care

Every `useApi()` call allocates, per render: 101 inline arrow closures, 101 `[asyncFetcher]` dep arrays, and ~15 nested object literals — roughly 220 short-lived allocations plus 101 hook-slot reads, none of which ever hit a memo fast path because `useAsyncFetcher` returns an unmemoized object literal. A 100-post cold feed mount runs this ≥100 times (PostCard has two `useApi()` call sites, lines 585 and 1069) for ~22,000 allocations — real but modest, low single-digit milliseconds of young-gen garbage, not a dominant cost. PostCard's `React.memo` means this does NOT recur on every scroll frame.

The larger cost is correctness-adjacent, not throughput: `api` has an unstable identity, so the ~20 `useCallback`/`useEffect` dep arrays that already list `api` are silently defeated. `Footer.tsx:55` (`handleLogout`), `DevKit.tsx:348` and `:353`, `UserSettingsModal.tsx:183,207`, and `PostCard.tsx:746` all re-allocate their handlers every render, which then propagates re-renders into any memoized child receiving them as props. This is also why the codebase carries the `apiRef.current = api` shims in Feed and useFeedEngagement — the ref workaround exists precisely to route around the unstable identity.

*Proposed fix.* The fix must start one level down, at `useAsyncFetcher`, or nothing improves:
1. `remix/app/hooks/useAsyncFetcher.tsx:67` — return `useMemo(() => ({ submit, setDefaultOpts }), [submit, setDefaultOpts])`. `submit` already depends only on `defaultOpts` state, and nothing in the app calls `setDefaultOpts`, so `asyncFetcher` becomes genuinely stable for the process lifetime.
2. Only then does `remix/app/hooks/useApi.tsx` benefit: wrap the return as `useMemo(() => ({ v1 }), [asyncFetcher])`. With step 1 in place all 101 leaves are stable, so this actually holds.
Do NOT hoist to a module-level singleton as originally proposed — `submit` closes over `useState`, so it cannot leave React.
Optional follow-up once identity is stable: delete the `apiRef` shims in `app/components/Feed/Feed.tsx:62-63` and `app/components/Feed/useFeedEngagement.ts:51-52`.

### Frontend — data fetching

#### useRecentReactions fetches the same MRU list once per PostCard AND per CommentRow — no in-flight/module dedupe

**Critical** · `remix/app/components/Emoji/useRecentReactions.tsx:26` · fix safety: needs-care

Every feed paint fires 20 byte-identical authenticated GET /api/v1/things/reactions-recent requests in the same tick (PAGE_SIZE=20 at Feed.tsx:25, one PostCard per item at PostList.tsx:80), and each infinite-scroll page mounts 20 more cards for 20 more requests. The per-request server cost is higher than the finder stated: it is at least TWO Mongo round trips, not one — resolveThingsActor (api/utils/auth/patTokens.ts:259) does verifyJwt plus getLiveSession(claims.jti) (a sessions findOne), then getUserRecentReactions (api/utils/auth/users.ts:1030) does a things.findOne({shareId, thingtime:'user'}), with a possible THIRD findOne on the legacy users collection when the user thing is absent (users.ts:1044). So one feed paint costs ~20 serverless invocations and ~40-60 Mongo round trips to obtain a single small emoji array that is identical across all 20 callers. Expanding comments compounds it: visibleComments defaults to 5 (PostCard.tsx:1087) and CommentRow recurses at PostCard.tsx:988, so a 5-wide x 3-deep thread mounts ~20 more rows and adds ~20 more identical GETs (~40+ more DB round trips). All of it is redundant — 19 of the 20 responses are discarded duplicates.

*Proposed fix.* Hoist the fetch into a module-level per-userId shared promise (mirroring threadCache.ts:87's `inflight` map) or a single RecentReactionsProvider, but this is NOT a mechanical hoist — three behaviours must be preserved or the fix regresses correctness. (1) pushRecent (useRecentReactions.tsx:48-58) currently mutates only the calling instance's state; today a newly-mounted card refetches and therefore sees the post-reaction MRU, so a shared cached promise must be invalidated/overwritten by pushRecent and broadcast to already-mounted subscribers (a module-level Set of setState listeners), or newly-mounted cards will paint a stale list. (2) The cache must be keyed by userId and cleared on account switch so the previous account's recents never leak — this is the documented purpose of keyFor() at line 13. (3) A rejected fetch must not be cached permanently; clear the entry on failure so a later mount can retry, keeping the current silent fall-back to the optimistic localCache snapshot. Keep the synchronous readLocalCache seed at line 20 untouched so first paint stays optimistic per the CLAUDE.md house rule.

#### PostCard prefetches whole comment threads on mount, one HTTP GET per shipped comment, before comments are even opened

**Critical** · `remix/app/components/Feed/PostCard.tsx:1093` · fix safety: needs-care

Ungated, speculative, on-mount request fan-out on the main feed render path, proportional to comment depth rather than to anything the user asked for.

Concrete bounds from the real constants: a feed page is PAGE_SIZE=20 posts (Feed.tsx:25), all mounted without virtualization (PostList.tsx:76-80). Each post ships up to RETURNED_COMMENTS=20 level-1 comments (things.ts:338, sliced at things.ts:1626), each carrying up to REPLIES_PER_LEVEL=5 level-2 replies (things.ts:343). The mount effect issues one GET /api/v1/things?id= per level-1 comment whose direct-reply count exceeds the 5 shipped (<=20/post), plus — via prefetchNextDepth — one GET per level-2 comment with any reply at all (<=100/post, since level-3 docs are never shipped and so are never cached). Worst case ~120 GETs per post and ~2400 per feed page; zero for shallow posts, so the blast radius scales with exactly the threaded content the product wants to encourage.

Each of those GETs is a getThing on a comment id, which is one of the most expensive reads in the API: ~10-12+ Mongo round trips including a $graphLookup thread count and a sequential unbounded ancestor-chain walk (findThing + canViewInherited awaited per ancestor), plus a second toPublicPosts pass over the chain. At the documented cross-region 209ms/DB-RT that is ~2s+ of DB time per prefetched comment. The browser's 6-connection cap then serializes this speculative burst ahead of every request the user actually initiated.

Two extra facts that sharpen it beyond the original report: (1) the UI reveals only 5 comments on first open (visibleComments=5 at PostCard.tsx:1086) and only when commentsOpen — so prefetching all 20 shipped comments is over-eager even relative to what a reveal would need; (2) warmAvatars(post.comments) at PostCard.tsx:1096 recurses the whole shipped tree, constructing an Image per avatar across up to ~120 comments per post, adding a parallel image-request burst on the same mount.

*Proposed fix.* Gate on user intent and bound the fan-out. The strongest argument for safety, which the finder missed: PostCard.tsx:731 ALREADY calls prefetchNextDepth(api, fetched) inside fetchThread's success handler, so the "stay one depth ahead" cascade is already implemented on the reveal path. Gating the mount-time effect therefore does not lose that capability — it is largely redundant with existing lazy behaviour.

Recommended: move the body of the effect (PostCard.tsx:1093-1103) into toggleComments (PostCard.tsx:1285), keeping the prefetchedPostRef one-shot guard so a reopen does not refire it. This does NOT violate the optimistic-rendering house rule: level-1 comments already ship inside the feed payload (things.ts:1626), so the panel still paints instantly from post.comments with no skeleton, and fetchThread's own guard at PostCard.tsx:723 only shows a skeleton when there is truly nothing to paint — which the house rule explicitly permits on a true cold start.

Additionally bound the loop: iterate at most the first ~5 level-1 comments (matching visibleComments=5) rather than all 20, and drop the unconditional prefetchNextDepth(api, comment.comments) cascade, letting line 731 pull the next depth only once a thread is actually revealed.

Why needs-care rather than safe-mechanical: warmAvatars currently runs on mount and would move with the effect (acceptable, but it is a real behaviour change to image warming); the interaction with the existing line-731 cascade should be verified so depth-ahead is not double-issued; and the change is user-visible enough to warrant a live browser check of thread expansion at depth, per the repo's UI-validation rule. A more conservative alternative that preserves current warm-ahead semantics is to keep the effect but fire it from an IntersectionObserver so it only runs for cards actually in the viewport, reusing the observer already present in useViewTracking/PostList.

#### ChatView re-downloads the entire 40-message page (plus members, emoji map, all reactions) every 4 seconds — no incremental/since parameter

**High** · `remix/app/components/Messenger/ChatView.tsx:122` · fix safety: needs-care

Per open, visible chat: 15 requests/minute, each a full recomputation. Server cost per poll, counted from messenger.ts: ~11 Mongo queries across ~7 sequential await stages — findThingByKind('chat') and getChatMemberDoc (resolveChatAccess, :292-301), the messages find (:1115-1119), projectMessages' 4-way parallel reactions find + thread-count aggregate + replyTo find + attachments find (:939-970), listChatMemberDocs (:1134), resolveProfiles (:1136), and the paired read-receipt lookups (:1137). That is ~165 queries and ~105 sequential DB round trips per minute per viewer, all to re-derive data the client already holds.

The worst part is one the finder missed: listChatMemberDocs (messenger/shared.ts:95-101) is UNCAPPED — no limit, no projection. A 500-member channel re-reads all 500 chat-member docs, then resolveProfiles(500) and getUsersReadReceiptsMap(500), every 4 seconds, forever, for every viewer with that channel open. Ten viewers in one big channel = ~1,650 queries/minute against things_v2 for zero new information. Note also the repo's known Vercel-region sensitivity: at ~200ms per DB round trip in a mismatched region, ~7 sequential stages is ~1.4s of pure latency per poll.

Two finder claims are overstated and should not be quoted as-is:
1. Bandwidth. Custom emoji images are deliberately NOT shipped in this payload — messenger.ts:1018-1032 sets `image: ''` with a comment saying clients resolve images once via GET /api/v1/emojis?ids= and cache them. FeedAuthor.avatarUrl (things.ts:207-213) is a URL string, not embedded bytes. A realistic 40-message page is ~20-50KB uncompressed / ~5-12KB gzipped, so ~300-750KB/min uncompressed and well under 200KB/min on the wire — not the claimed 1-2MB/min. The database and round-trip cost is the real problem here, not downlink.
2. The thread panel (ChatView.tsx:537-543) is NOT a duplicate of the main poll: it requests threadRootId-scoped replies with limit 100, which is a different message set. It does redundantly re-ship members, chat, myMember and the emoji map alongside those replies, so it roughly doubles the per-chat server cost — but describing it as "a second identical 4s poll" is inaccurate.

*Proposed fix.* Do NOT apply the proposed `since` parameter mechanically — a createdAt-based delta is silently incorrect here. The payload carries mutable state that changes without any new message: editedAt/text on edit (editMessage), the `deleted` flag, reactionCounts and viewerReactions (react), threadCount/threadLastAt, and every other member's lastReadMessageId/lastReadAt (markRead — read receipts are exactly what the 4s poll exists to surface). A `since=<newest createdAt>` filter would freeze edits, deletions, reaction chips and read receipts for anyone who does not scroll or send. A correct incremental endpoint needs a monotonic updatedAt/version stamp written on every mutation path plus separate change feeds (or a bumped chat-level version) for reactions and receipts — that is a real feature, not a patch.

Safe, high-value changes that can land now without touching correctness:
1. Stop re-resolving the roster on every poll. members/myMember/customEmojis only change on join/leave/rename/receipt changes. Either cap listChatMemberDocs with a projection + limit, or add an opt-out query flag (e.g. `members=0`) that ChatView passes on poll iterations and omits on chat open / after onChatsChanged. This alone removes 3-4 of the ~7 sequential stages per poll and kills the unbounded 500-member fan-out. Low risk, localized to listMessages + one client call site.
2. Adaptive backoff in ChatView: keep 4s for ~60s after the last observed change, then step to 10-15s while idle, and reset instantly on visibilitychange (the handler at :126-129 already exists) or on send. Purely client-side, ~10 lines, no API change.
3. Give the thread panel (:537-543) a lighter response (replies only, no members/chat/emoji re-ship) rather than removing the poll — the poll itself is load-bearing for live thread replies.

Given house rules, note that any change here must preserve optimistic rendering (pending- prefixed messages are merged in applyPage at :90-99) and must not introduce a loading flash on poll.

#### Feed page never seeds from the localCache tier — every mount clears to a skeleton and refetches page 1

**High** · `remix/app/components/Feed/Feed.tsx:40` · fix safety: needs-care

Every remount of /feed (post permalink and back, /messages -> /feed, tab switch through any other route) paints three skeleton cards and re-issues GET /api/v1/things/feed?limit=20. For authenticated viewers there is no cache at any tier: the response carries 'private, no-store', useApi's things.feed is a bare getJson, and no localCache seed exists. Each of those requests costs roughly 5-6 serial Mongo round trips inside getFeed/toPublicPosts: withFriendIds, the feed query itself, then (on the ranked path, which is the default whenever the viewer has an activeFeedAlgorithmId) a RANKED_CANDIDATE_WINDOW=400-document candidate scan plus in-process rescoring followed by a SECOND find for the 20 selected shareIds, then toPublicPosts' two Promise.all batches (related/reactions + threadCounts + viewStats, then attachments + profiles). The per-post work is properly batched, so this is not an N+1, but it is still the single heaviest read in the app, re-executed in full for a list the user was looking at seconds earlier. Guests are unaffected because the anon=1 path is absorbed by the Vercel edge for 60s; the waste is entirely on logged-in users, i.e. exactly the traffic that matters.

*Proposed fix.* Seed the pager from the synchronous localCache tier, following the SearchPage.tsx precedent rather than the finder's one-liner. (1) Key per viewer AND algorithm, e.g. `tt-feed-${user?.id ?? 'anon'}` combined with the algorithm id, and clear the key on logout / viewer change (SearchPage.tsx:292-295 purges a legacy unscoped key for exactly this reason) so one account's circle-visible posts can never paint for the next account on a shared device. (2) Store a cachedAt timestamp alongside the posts and pass it to mergeReactionOverlays on read, the way threadCache.ts stamps entry.at — without it a cached copy older than the viewer's last reaction tap will paint stale reaction state. (3) Lazy-init: posts from the cached snapshot, loading = seededPosts.length === 0, nextCursor intentionally left null so the seed never enables load-more against a stale cursor. (4) Write the snapshot back in load() on a successful reset only (never on the load-more branch, never in the catch), and slice/trim comments before writing since 20 posts with up to 20 comments each can approach the localStorage quota; writeLocalCache already swallows quota errors, so the failure mode is a lost seed rather than a crash. The existing background refetch, sequence guard, and reset-replaces-posts logic need no change: load({reset:true}) sets loading synchronously on the same tick the effect runs, so the infinite-scroll sentinel (rootMargin 600px, gated on stateRef.current.loading) cannot fire a spurious loadMore against the seeded list.

#### ProfilePage serializes two independent requests: posts wait for the profile fetch to resolve

**Medium** · `remix/app/components/Profile/ProfilePage.tsx:156` · fix safety: needs-care

Every view of another user's profile pays one avoidable serial client round trip before the page's main content (posts) even starts loading. The real endpoints are GET /api/v1/users/profile?username= and GET /api/v1/things/user?username=. The finder's 300-500ms figure is stale — it cites the iad1-vs-Atlas-Sydney mismatch, but root vercel.json now pins "regions": ["syd1"], co-located with the Atlas cluster, so the extra hop is a client-to-edge round trip, not a cross-region DB hop. Server-side the profile call is cheap (findUserByUsername issues two parallel queries, then one countPublicPosts) — order 10-30ms of in-region DB. The dominant term is client RTT plus TLS/HTTP overhead: roughly 50-120ms for an Australian client near syd1, and 250-400ms for a US/EU client. So the honest range is ~50-400ms of added time-to-first-post depending on viewer location, on the page's primary content, on a fully client-rendered page with no cached fallback to paint.

*Proposed fix.* Set postsUsername from the `username` prop directly (falling back to user.username in self mode) so both fetches start from the same render, but do NOT rely on generationRef to clean up the missing-user case — the finder's justification is wrong. generationRef only increments when postsUsername/loadPage/appliedAdvanced change; if postsUsername is the URL param it does not change when the profile resolves to 'missing', so the stale-response guard never trips and loadPage's catch block (lines 221-232) will fire the user-facing lopu toast 'Could not load posts 😔' on every nonexistent-profile view. That is exactly the regression the comment at lines 154-155 was written to prevent. The fix must therefore also swallow the posts error when it is a 404 (or when `remote.status === 'missing'`): thread a suppress flag or check err?.status === 404 before calling lopuRef.current, and leave setPosts([]) / cursor reset intact. Worth double-checking the two isSelf transitions too: while useCurrentUser is still resolving, isSelf is false, so a self-profile visit could briefly fire the public posts fetch under the URL param — harmless, but it changes the request pattern for signed-in users landing on their own /profile/:username.

#### Every read-receipt advance triggers a full messenger list refresh (2 extra GETs) on top of two active polls

**Medium** · `remix/app/components/Messenger/ChatView.tsx:166` · fix safety: needs-care

Per NEW message in an open, visible chat (not per poll — readMarkRef dedupes). Incoming message: 1 POST /api/v1/chats/read + GET /api/v1/chats (7 sequential Mongo round-trip stages: memberships find, chat docs find, unread aggregate, member docs find, member-count aggregate, resolveProfiles, receipts pair) + GET /api/v1/communities (2 stages, fully redundant — reading a message cannot change the community list) + 2 auth lookups, ~10 sequential DB round trips of which ~3 are pure waste. Outgoing message is 3x worse: ChatView.tsx:286-289 fires props.onChatsChanged() and emitMessengerRefresh() back to back, both hitting the same MessengerPage refresh() listener, then the pending->real id swap triggers the markRead effect for a third refresh — 6 GETs (3x chats + 3x communities), ~30+ sequential Mongo round trips, with no in-flight dedupe on refresh(). The repo's own perf note measures a mismatched-region DB round trip at ~209ms, so this is material, and it multiplies by every client with the conversation open. The 15s LIST_POLL_MS refresh would have surfaced the same unread change on its own within 15s.

*Proposed fix.* Three changes, in increasing risk order. (1) Split MessengerPage.refresh() into refreshChats() and refreshCommunities(); refreshChats keeps setChats/setRequestsCount/writeChatList/writeUnread and the thingtime:messenger-unread dispatch (all derived from chatsPayload), refreshCommunities keeps setCommunities/writeCommunities, and BOTH keep the Unauthorized -> navigate('/login') catch. Point onChatsChanged (MessengerPage.tsx:281) at refreshChats only. (2) Remove the duplicate fan-out on send: ChatView.tsx:286-289 calls props.onChatsChanged() and emitMessengerRefresh(), and both resolve to the same MessengerPage refresh listener — drop one (keep emitMessengerRefresh if other listeners are wanted). (3) Add a trailing coalesce (2-3s) plus an in-flight guard to the markRead-driven refresh so a burst of incoming messages produces one list refresh. Do not debounce the markRead POST itself. Verify in a browser on /messages that the sidebar unread badge still clears promptly when a chat is opened and that chat ordering still updates after send.

### Frontend — bundle size and code splitting

#### Entire FontAwesome solid icon set (1 MB) is bundled and never used

**Critical** · `remix/app/hooks/useIcons.tsx:2` · fix safety: safe-mechanical

1,008,206 bytes of the 4,090,531-byte entry chunk (24.6%) are dead FontAwesome icon data, verified by sourcemap byte attribution — the largest single source in the bundle, 5.5x larger than react-dom. Removing it shrinks the entry chunk by 1,020,530 raw bytes, 323,304 gzip bytes (1,151,736 -> 828,432, -28.1%) and 226,330 brotli bytes (869,918 -> 643,588, -26.0%). Every first-time visitor downloads, decompresses, parses and JIT-compiles ~1 MB of SVG path data for zero rendered pixels, and `library.add(fas)` additionally walks all 1,966 icon objects at module init, on the critical path before first paint. On a 4G connection the ~226 KB of extra brotli-compressed transfer is roughly 0.3-0.5s, plus ~200-350ms of parse/compile on a mid-range phone. This runs on every route because the side effect is at module top level in a file imported by root.tsx.

*Proposed fix.* Delete remix/app/hooks/useIcons.tsx, plus the `import { useIcons } from './hooks/useIcons';` at remix/app/root.tsx:10 and the `useIcons();` call at remix/app/root.tsx:112. That alone captures the full ~1 MB win and is purely subtractive — nothing else in the repo imports useIcons or references FontAwesome. As a separate follow-on commit, drop @fortawesome/fontawesome-svg-core, @fortawesome/free-regular-svg-icons, @fortawesome/free-solid-svg-icons and @fortawesome/react-fontawesome from remix/package.json; keep that step separate since it churns pnpm-lock.yaml (repo convention is no incidental lockfile changes). If FontAwesome is ever reintroduced, import individual icons (`import { faUser } from '@fortawesome/free-solid-svg-icons/faUser'`) rather than the `fas` barrel.

#### Zero route code splitting: all 38 routes statically imported into one 977 KB-gzip chunk

**Critical** · `remix/app/routes.tsx:110` · fix safety: needs-care

The app renders entirely client-side (createBrowserRouter + empty `<div id="root">`, no SSR markup), so the single entry chunk is on the critical path to first paint: nothing renders until 4,090,531 raw / 1,154,775 gzip bytes are downloaded, parsed and executed. Verified across two builds today, and the number is growing (an earlier build the same afternoon was 3,427,915 raw / 976,521 gzip — a ~178 KB gzip regression in one rebuild, because nothing structurally bounds entry-chunk growth). Sourcemap byte attribution shows ~758 KB raw / ~210 KB gzip (~18.5% of the entry chunk) belongs to routes almost no visitor opens: apiDocs 259,657, /docs/* routes 178,292, Admin 112,909, Schemas 62,948, MongoDB workbench 57,727, Settings 44,892, Search 24,937, Commander 17,193, plus vercel 15,627, crypto 15,626 and /tests fixtures. Every cold visit to /login or /feed pays that download, parse and compile cost before first paint.

*Proposed fix.* Use React Router's `lazy:` route property (react-router@8.2.0 is installed, so it is available) — NOT React.lazy + Suspense. This is not a style preference: the repo house rule in CLAUDE.md says "never flash a loading screen, spinner, or skeleton when prior state exists", and `lazy:` keeps the current route mounted while the chunk resolves, whereas a Suspense fallback would violate that rule. Example: `{ path: 'docs', lazy: () => import('./routes/docs/DocsLayout').then(m => ({ Component: m.default })) }`. Split highest-value first: docs/* (incl. apiDocs), admin, schemas, mongodb-status, settings, search, tests, crypto, vercel, Commander. Leave _index, feed, login, register, profile eager so common entry points keep current first-paint behaviour. Loaders already defined inline in routes.tsx (rootLoader, requireUser/requireGuest, vercelDeploymentsLoader, the mongodb-status and status fetchJson loaders) stay in the eager config and are unaffected. RISK the finder missed: this repo has a documented history of `sideEffects:false` tree-shaking dropping side-effect registry imports — invisible in dev, empty in the Vercel build. Moving a route behind a dynamic import changes when transitively-imported registration modules execute, so each split needs a real `npm run build:client` plus a live browser check of the affected route, not just a dev-server pass. Verify after each batch that the entry chunk shrank and that new per-route chunks appear in dist/assets.

#### apiDocs.ts (7,565-line server route registry) ships to every browser

**High** · `remix/app/routes/docs/DocsLayout.tsx:19` · fix safety: needs-care

Understated by the finder, not overstated. Measured with the repo's own esbuild (tree-shaken probe importing only `apiEndpointDocs`, --bundle --minify): 257,750 bytes raw / 70,962 bytes gzip — roughly 2.3x the claimed 112,578 / 31,499. Source file is 7,565 lines / 326,754 bytes. Three corrections/additions to the finding: (1) There are TWO independent eager entry points into apiDocs.ts, not one. Besides DocsLayout, remix/app/routes/tests.tsx:18 imports `~/tests/api/apiTests`, whose line 2 imports apiEndpointDocs and whose line 122 flatMaps it into apiDocsSmokeTests at module scope. TestsPage is also a static import in routes.tsx, so lazy-splitting only the /docs subtree will NOT remove the bytes — /tests must be split too. (2) The consumption is at module scope in every case (DocsLayout.tsx:107, docsSearchIndex.ts:299, apiTests.ts:122), so the cost is not just parse — the reduce/flatMap/index-build execute on every page load. (3) The finder's docsSearchIndex note is real and larger than described: DocsLayout imports DocsSearch (DocsSearch.tsx:6) which imports docsSearchIndex, whose line 299 runs `const indexedDocs: IndexedDoc[] = buildDocs().map(...)` at module scope. buildDocs() additionally drags in app/schemas/registry.ts (157,188 bytes) plus design/design-system/concepts/embed entry tables, and lowercases the entire corpus for the search index — so the true entry-graph cost of this dependency cluster is meaningfully above the ~71 KB gzip attributable to apiDocs.ts alone. All of it is dead weight on /feed, /login and /profile.

*Proposed fix.* Prefer the route-splitting variant, and make it cover both entry points. In remix/app/routes.tsx convert the entire `docs` subtree (DocsLayout, DocsIndex, DocsApi, DocsEmbed, DocsDesign, DocsDesignSystem, DocsConcepts, DocsSchemas) AND the `tests` route (TestsPage) from static imports to React Router `lazy` route objects. That alone evicts apiDocs.ts, docsSearchIndex.ts and app/schemas/registry.ts from the entry chunk with no change to apiDocs.ts itself. Verify with `npm run build:client` and grep the entry chunk for a distinctive apiDocs string literal to confirm eviction. Two constraints the finder's alternative fix misses: (a) nitro.config.ts:3 imports `apiV1DocsRouteKeys, apiV1RouteKeys` from './app/docs/apiDocs.ts', and those are derived from apiEndpointDocs at apiDocs.ts:7429-7431. Per CLAUDE.md, Nitro's explicit route table is derived from the docs registry — documenting an endpoint IS its registration — so any attempt to move `apiEndpointDocs` behind `await import()` must keep a synchronous build-time path for the route keys, or every /api/v1 route 404s. Do not attempt that split without a build-time verification of the Nitro route table. (b) Per the CLAUDE.md optimistic-rendering house rule ("never flash a loading screen when prior state exists"), give the lazy docs/tests routes a non-spinner fallback; a first-visit chunk fetch on a docs page is acceptable, but do not introduce a spinner on any already-cached path. Also confirmed safe to scope: docsSearchIndex.ts and DocsSearch.tsx have zero importers outside app/routes/docs/, so nothing else in the app regresses.

#### No manualChunks/vendor split — any app edit invalidates the whole 977 KB cached bundle

**High** · `remix/vite.config.ts:182` · fix safety: needs-care

Production `vite build` emits a single content-hashed entry chunk of 4,112,407 b raw / 1,150,623 b gzip (measured, gzip -9). Sourcemap attribution shows 3,996,743 of 7,466,231 source bytes (53.5%) come from node_modules — dependencies that change only on upgrade — concatenated into the same hashed file as application code. Any deploy touching one component rewrites that hash, so returning users refetch the entire ~1.10 MB gzip rather than a small app chunk; roughly 450-550 KB gzip of that is dependency code that could sit behind a stable long-lived hash. Important narrowing the original finding got wrong: a vendor split saves ZERO bytes on first load — this is purely a repeat-visit / cross-deploy caching cost, not a cold-start perf win. Separately and larger for first load (not this finding): @fortawesome/free-solid-svg-icons contributes 1,036,484 source bytes via a `fas` barrel import at remix/app/hooks/useIcons.tsx:2.

*Proposed fix.* Add build.rollupOptions.output.manualChunks to remix/vite.config.ts (inside the existing build block at lines 182-185), keeping emotion bundled together with Chakra and framer-motion in one chunk, and react/react-dom/react-router together in another. Do NOT apply mechanically: (1) the originally proposed `id.includes('/react/')` test is fragile under pnpm's `node_modules/.pnpm/react@18.3.1/node_modules/react/...` layout and relies entirely on clause ordering to avoid swallowing react-icons/react-router — prefer matching on the resolved package directory segment rather than a raw substring; (2) splitting Chakra/emotion/framer-motion across chunks is a known source of module-execution-order regressions (TDZ `Cannot access 'X' before initialization`) and can add a request waterfall that regresses first paint. Required verification after the change: run `npm --prefix remix run build:client`, confirm the entry chunk shrank and stable vendor chunks appeared, confirm `npm run verify:vercel-output` still passes, then load the app in a real browser and check the console for initialization errors on at least the feed, /things and an editorjs-backed page.

#### 1,857-line /tests API fixture table shipped to all users

**Medium** · `remix/app/routes.tsx:39` · fix safety: needs-care

A developer-only, completely ungated API smoke-test console is shipped to 100% of users in the first-paint JS. Measured from the committed build (remix/dist/assets/index-CTp0qeNY.js, 4,112,407 bytes — the ONLY app chunk in dist/index.html, since app/routes.tsx has zero `lazy:` routes), sourcemap byte attribution gives: app/tests/api/apiTests.ts = 55,666 minified bytes, app/routes/tests.tsx = 10,761, app/tests/api/apiTestRunner.ts = 2,969. Total 69,396 minified bytes (~1.7% of the entry chunk, roughly 12-16 KB over the wire after gzip) parsed and evaluated on every cold load by every real user, none of whom can reach /tests meaningfully. Correction to the original claim: the apiDocs.ts dependency (259,657 minified bytes) does NOT leave the entry chunk, because four eagerly-imported /docs route modules import it independently. Removing apiDocs from the entry chunk is a separate, ~4x larger win that requires lazy-loading the whole docs route family as well.

*Proposed fix.* Do NOT apply the fix as originally written — `lazy: () => import('./routes/tests')` would break the route. app/routes/tests.tsx has only `export default function TestsPage()` (line 82); React Router's `lazy` merges route-property exports (Component/loader/action/ErrorBoundary) from the resolved module and ignores `default`, so the route would render nothing and RR would warn about an unsupported key. Correct form: delete the static import at app/routes.tsx:39 and change line 187 to `{ path: 'tests', lazy: async () => ({ Component: (await import('./routes/tests')).default }) }`. This is the first lazy route in the codebase, so also (a) rebuild and confirm a new split chunk appears and that `grep -l "thingtime-tests-page" dist/assets/*.js` no longer matches the entry chunk, and (b) load /tests in a live browser and run a non-mutating test to confirm the page still mounts — required by the repo's house rule that UI changes be verified in a live browser before finishing. Optionally drop the misleading apiDocs claim from any changelog/PR text. A larger follow-up (separate change) is to lazy-load the /docs route family, which is what would actually evict apiDocs.ts's 259,657 bytes.

#### All six kind-renderer families statically loaded on every page

**Medium** · `remix/app/components/Kinds/kindRegistry.tsx:58` · fix safety: risky

Real but modest, and smaller than claimed. The three families a /login or /settings visitor never touches (Commerce 18,414 + Planning 17,770 + Knowledge 16,793) total 52,977 minified bytes, roughly 15 KB gzip — about 1.3% of the 1,154,775-byte gzip entry bundle. All of app/components/Kinds is 149,128 minified bytes (208,023 source bytes across 12 modules), which does make it one of the largest single app-code directories in the bundle. But the claim that removing the sampleKindThings barrel re-export keeps it "out of every barrel consumer's graph" is FALSE as measured: ConceptStories.tsx is itself in the entry chunk (confirmed via sourcemap sources), and with no route splitting the module lands in the same chunk regardless of which import edge pulls it in — that sub-fix saves 0 bytes today. The dominant bundle problem is not this registry: it is that 53 routes ship in a single 4.1 MB chunk, with app/docs/apiDocs.ts (326,040 source bytes), app/schemas/registry.ts (156,739) and @fortawesome/free-solid-svg-icons (1,036,484) all ahead of or comparable to the cold Kinds families.

*Proposed fix.* Do NOT apply the proposed `await import('./kindRenderersCommerce')` change as written — it breaks rendering. ensureBuiltinKinds() is reached from four SYNCHRONOUS render-path callers: ThingView.tsx:241 `useMemo(() => resolveKindRender(thing), [thing])`, conceptBits.tsx:184 `resolveKindRenderer(props.thing)`, ConceptStories.tsx:635 `getKindRenderers().map(...)`, and RenderThing itself (kindRegistry.tsx:189). Making registration async makes the first call return null; ThingView's useMemo then caches that null keyed on `thing` with no re-render trigger, so the card stays blank permanently even after the import resolves. The header comment at lines 51-57 also documents a real production incident — `"sideEffects": false` shipped an EMPTY registry to Vercel while unbundled dev looked fine — so any restructure here re-enters that hazard and dev will not catch the regression. If pursued at all, the safe shape is: keep resolveKindRender synchronous, add a module-scoped `registryVersion` counter bumped on registration plus a `useSyncExternalStore`/subscription so ThingView and conceptBits re-render when a lazily-imported family lands, gate the async families behind an explicit non-render bootstrap, and verify with `npm run build:client` + grepping the emitted chunks that the registry is non-empty in the PRODUCTION build (not dev). Drop the sampleKindThings barrel change entirely — it is a measured no-op. Far better value for the same effort: introduce React.lazy route splitting so the 4.1 MB single chunk is broken up at all, which subsumes this finding.

#### emojis-list array (31 KB) plus O(n) linear scan inside the shared Icon component

**Medium** · `remix/app/components/Icon/Icon.tsx:222` · fix safety: needs-care

~30.9 KB raw / ~8.3 KB gzip of the root-imported `Icon-*.js` chunk (72% of that chunk's weight) is the emojis-list string array — 3,075 entries downloaded, parsed and allocated on every page load, because root.tsx statically imports Icon. Secondary: `emojis.includes(name)` at line 222 is a linear scan over 3,075 strings; measured 112µs to resolve 50 icons vs 2.2µs with a Set. Memoized on `[name]`, so this is a per-mount cost, not per render.

*Proposed fix.* Only one third of the proposed fix is safe; apply that part alone.

SAFE (mechanical): add a module-level `const EMOJI_SET = new Set(emojis)` and change line 222 to `if (EMOJI_SET.has(name))`. Identical semantics, keeps the `emojis` array in scope for the "random" branch at line 227. Saves ~110µs per 50 icons but saves ZERO bytes — the array still ships.

DO NOT lazy-load emojis-list the way emojiData.ts does. That comparison is not apples-to-apples: emojiData.ts feeds an async picker panel, whereas Icon resolves its glyph synchronously inside `useMemo` and returns it for the current render. Making the lookup async means every emoji-character icon paints the 🤷‍♂️ fallback on first frame and then swaps — which is both a visible regression and a direct violation of the repo's "never flash a loading state when prior state exists" optimistic-rendering house rule in CLAUDE.md.

DO NOT swap in a `\p{Extended_Pictographic}` regex without a behaviour audit. It is not equivalent to the list: a naive single-codepoint test rejects the multi-codepoint ZWJ sequences emojis-list contains (only a handful, like 🧙‍♂️ and 🤷‍♂️, are already hardcoded above), and it accepts pictographic characters that are not in the list today. It also does not eliminate the import, since line 227's `random` branch needs the array to index into.

If shipping the 8.3 KB gzip is genuinely the goal, the real fix is to drop the emojis-list dependency entirely — replace the membership test with the regex AND replace the `random` branch with a small hand-picked constant array — and then verify the icon set renders unchanged. That is a behaviour-changing refactor needing visual verification, not a mechanical edit.

#### 9.9 MB of production sourcemaps published as public static assets

**Low** · `remix/vite.config.ts:184` · fix safety: needs-care

Every production build emits 12 MB of sourcemaps into `remix/dist/assets/` (16 files; `index-CTp0qeNY.js.map` alone is 10,675,721 bytes, ~2.6x the 4,112,407-byte JS bundle it maps). Since nitro.config.ts publishes all of `dist` as public assets, that ~12 MB — roughly half the 24 MB `dist` — is uploaded to Vercel's static store on every deploy and cached for a year. Verified present in real output: `.vercel/output/static/assets/index-Qc6TpQHw.js.map` = 6,769,847 bytes. The retained `//# sourceMappingURL=` comment in the shipped bundle means any devtools open or crawler can pull the full map, exposing complete pre-bundle client source. No consumer benefits: there is no Sentry or other sourcemap-ingesting tool in remix/package.json. Cost is deploy size, upload duration, and source disclosure — not end-user page latency, since browsers do not fetch maps unless devtools is open.

*Proposed fix.* Because nothing ingests these maps (no error-tracking dep in remix/package.json), the direct fix is `build.sourcemap: false` at remix/vite.config.ts:184 — one line, removes all 12 MB from the published output. Important correction to the original proposal: `sourcemap: 'hidden'` alone does NOT achieve the stated impact. It only strips the `//# sourceMappingURL` comment; the `.map` files are still written to `dist`, still uploaded by nitro's `publicAssets`, and still fetchable by guessing the hashed filename. If maps are wanted for future error reporting, `'hidden'` must be paired with either an upload-then-delete step or an explicit `*.map` exclusion in scripts/patch-vercel-output.mjs (which currently has no map handling at all). Either variant is safe with respect to existing gates: scripts/verify-vercel-output.mjs asserts only index.html, the `<div id="root"></div>` shell, the module script tag, and route ordering — it never references `.map` files.

### Architecture — multi-node, cross-region and real-time

#### All real-time messaging is client polling; the open-chat poll refetches the entire page every 4s

**Critical** · `remix/app/components/Messenger/ChatView.tsx:122` · fix safety: needs-care

Per open, visible chat tab: 15 GET /api/v1/chats/messages per minute, 30/min when a thread panel is open (second 4s poll at ChatView.tsx:538-544). Each request is 9 SEQUENTIAL Mongo round trips (13 queries total) — 2 for auth, 2 for resolveChatAccess, 1 page find, 1 batched projectMessages fan-out, 1 member list, 1 resolveProfiles, 1 receipts pair. That is ~135 sequential DB round trips per minute per idle open chat, ~270 with a thread open, and it is per browser tab, not per user.

Latency: in-region syd1↔Sydney (~1-2ms/RT) the serial DB wait is ~10-20ms/poll, which is annoying but survivable — the dominant cost at that RTT is request volume and bandwidth, not wall time. The severe case is region divergence: the repo's own perf note records 209ms/RT when compute ran iad1 against Atlas Sydney, where 9 serial RTs = ~1.9s per poll. Two concurrent 4s polls at ~1.9s each leave almost no headroom, and any regression to 3+ RTs of latency makes polls overlap and stack. The vercel.json syd1 override is the only thing keeping this off the cliff.

Bandwidth/waste: every poll returns the full 40-message page plus the complete member array, every member profile and the receipt map, unconditionally — tens of KB, ~99% identical to the previous response, 15-30x/minute. There is no conditional-request path of any kind, so an idle chat with zero activity costs exactly as much as an active one.

Correction to the finder's framing: the claim "no cursor" is wrong in one respect — the endpoint DOES accept `cursor`, but it is a backward history cursor (chronoCursorClause pages older), so it cannot express "give me only what changed since". That is the actual gap.

*Proposed fix.* The finder's proposed delta ("return only messages newer than the client's newest id") is NOT correct as stated and would silently break existing behaviour. Reactions live in separate `things` docs aggregated in projectMessages (reactionDocs), and edits/deletes mutate `crystal.editedAt` / `crystal.deletedAt` on EXISTING messages. Today those changes reach other viewers ONLY because the poll refetches the whole page with `replace: true`. An id-newer-than delta, and equally an ETag keyed on (chat.updatedAt, newest message id, member revision), would freeze reaction counts, edits and deletions for every other participant — a real regression, not a wash.

A correct version must key the conditional response on a revision that moves on reaction/edit/delete too — e.g. max(updatedAt) across the message page plus its reaction docs, or a monotonically bumped chat-level revision written by sendMessage/react/edit/delete. Getting that cheaply is the actual design work; a naive ETag still costs the same 9 round trips to compute unless the revision is denormalized onto the chat doc (which the codebase already does for `lastMessage`, so there is a precedent to follow).

Cheap, low-risk wins that need no protocol change and could land first: (1) collapse the two sequential resolveChatAccess queries into one Promise.all — chat doc and member doc do not depend on each other; (2) run listChatMemberDocs/resolveProfiles/receipts concurrently with the message find instead of after it, cutting 9 serial RTs to ~4; (3) back the thread-panel poll off from 4s or make it share the parent poll's payload. Note the GET loader has no enforceRateLimit while the POST action does — worth adding regardless.

SSE + change stream is the right end state but is a genuine infra change: it needs a replica set (per the repo's own notes, transactions/change streams already require RS and local standalone 27017 does not support them), plus reconnect/backfill so a dropped stream does not lose messages. Not a drop-in.

#### getCurrentUser costs 3-4 sequential Mongo round trips on every authenticated API request, uncached

**Critical** · `remix/app/api/utils/auth/getCurrentUser.ts:31` · fix safety: needs-care

Every authenticated request pays 4 strictly serial home-DB round trips (5 queries) in resolveSessionUser before any endpoint logic runs: sessions.findOne({jti}) -> findUserById (2 parallel queries) -> subscription ledger findOne -> userSeed findOne (taken for every free-tier user, and it re-reads the same things_v2 user doc findUserById already fetched). All lookups are indexed and the deployment is co-located (vercel.json regions ["syd1"] + Sydney Atlas), so this is ~5-16 ms of pure auth latency per request at ~1-4 ms/RT — but it is paid 83 call sites deep across 67 route files with zero caching. Messenger polling makes the volume the real cost: ChatView ACTIVE_POLL_MS=4000 on two intervals + MessengerPage LIST_POLL_MS=15000 + MessengerNotifications IDLE_POLL_MS=25000 = ~34 authed requests/min per user with one chat open, i.e. ~136 redundant auth round trips/min/user resolving identical data. chats/updates and chats/messages never read user.subscription or user.storage, so half of those round trips are unconditional waste on the two hottest endpoints. The same code is a latent 20x latency cliff (~840 ms/request) if the syd1 region pin ever drifts from the Atlas region.

*Proposed fix.* Apply in order of safety. (1) SAFE: memoise the resolved user per request in the AsyncLocalStorage context the dispatcher already establishes (runWithMongoEndpoint, server/routes/api/[...].ts:279 + api/utils/mongodb/endpoint.ts:112), keyed by the token/jti. This is purely additive, scoped to one request, cannot affect revocation semantics, and immediately halves the cost of routes like chats/messages that call getCurrentUser twice. (2) SAFE-ISH, do next: thread the already-fetched user doc into getSubscription (or add getSubscriptionForUserDoc(userDoc)) so the userSeed findOne at subscriptions.ts:258 is skipped when the caller already holds the user thing — this removes RT4 for every free-tier request. Only 8 external getSubscription call sites, so an added optional parameter is contained; keep the existing signature working. (3) RISKY, needs owner sign-off, do NOT bundle mechanically: the proposed 30-60s process-local TTL cache keyed by jti. The Mongo sessions document exists specifically for revocation (CLAUDE.md: "httpOnly cookie carrying a signed JWT plus a Mongo sessions document for revocation"); a TTL cache means logout, session revoke, account-switch and admin ban do not take effect for up to the TTL on any other serverless instance, since revokeSession (sessions.ts:58) can only invalidate the local process's map. Under Fluid compute with multiple warm instances this is a real security-behaviour regression, not a tuning knob. Similarly, a getCurrentUserLite() that omits the subscription changes the PublicUser shape (storage*, tier fields) returned by toPublicUserWithStorage, which has 16 call sites — it must be a genuinely separate function used only by endpoints audited to not read those fields, never a change to the existing one.

#### resolveChatAccess runs two independent point lookups serially on the hottest messenger path

**High** · `remix/app/api/utils/messenger/messenger.ts:294` · fix safety: safe-mechanical

Severity should be medium, not high. listMessages already issues ~9 serial DB round trips (gate x2 -> optional threadRoot findOne -> page find -> projectMessages -> listChatMemberDocs -> resolveProfiles -> receipts Promise.all pair), so parallelizing the gate removes 1 of ~9 serial RTs: ~11% of the endpoint's DB latency and ~50% of the gate itself. Same-region (Vercel syd1 + Atlas Sydney) that is ~2ms saved out of ~20ms of DB time per request. Volume is real but modest: an open chat polls every 4s (15 req/min), and 30 req/min when a thread panel is also open, plus the 15s list poller (MessengerPage.tsx:36) and 25s notification poller — all pausing on document.visibilityState !== 'visible'. The load-bearing argument is the cross-region failure mode: this repo's measured iad1<->Atlas-Sydney round trip is ~209ms, held off only by the syd1 region override in vercel.json. If that override is ever dropped, this single avoidable serial hop becomes a flat +209ms on every message send, edit, reaction, read-receipt and every 4s poll. The fix is one line with essentially zero risk, so it is worth taking on the cross-region insurance alone rather than on the ~2ms steady-state win.

*Proposed fix.* In resolveChatAccess, keep the `typeof chatId !== 'string' || !chatId.trim()` guard first, then hoist the trimmed id and run both lookups concurrently, keying the member lookup off the input id rather than chat.shareId (they are provably identical, and this avoids a data dependency):

  const id = chatId.trim();
  const [chat, member] = await Promise.all([
    findThingByKind('chat', id),
    getChatMemberDoc(id, viewerId)
  ]);
  if (!chat) return fail(404, 'Chat not found');
  const state = member?.crystal?.state;
  ...unchanged...

Keeping `if (!chat) return fail(404, ...)` before any member check preserves the existing 404-before-403 ordering exactly. Two caveats the finder did not mention, neither blocking: (1) on the 404 path the member lookup now fires needlessly — one wasted indexed findOne on a rare path, sub-ms, no correctness impact; (2) the String(message.targetId) call sites at lines 1330/1362/1397 are unaffected because the typeof guard still runs before either query. No house rule is violated: this is still one indexed query per kind, no N+1 introduced.

#### listMessages re-resolves the same profiles twice and re-reads the viewer's secure blob a third time, bypassing the receipts cache

**High** · `remix/app/api/utils/messenger/messenger.ts:1136` · fix safety: needs-care

listMessages is the 4s-poll endpoint behind every open chat (ChatView.tsx:25). Its serial DB stages are roughly: findThingByKind + getChatMemberDoc (2), message page find (1), projectMessages Promise.all of 4 queries (1 stage), resolveProfiles (1), emoji lookup (1), listChatMemberDocs (1), duplicate resolveProfiles (1), receipts stage (1) — about 8-9 serial stages. The two avoidable ones are therefore ~20-25% of the endpoint's serial DB stages. Absolute latency is much smaller than the finder implied: vercel.json now pins "regions": ["syd1"], co-located with the Atlas Sydney cluster, so an intra-region round trip is ~1-5ms rather than the historic ~209ms cross-region figure. Realistic saving is ~2-10ms of server latency per poll, plus one duplicated `secure` BinData fetch + JSON.parse per chat member per poll (SecurePayload carries email, passwordHash and an open-ended meta blob that can hold up to 20 saved mongo endpoint URLs, so it is the fattest field in either projection). At 15 polls/min per open chat that is ~15 duplicate profile queries/min and ~14 fully redundant viewer-secure-blob reads/min per open chat, scaling linearly with concurrent open chats. Real and worth fixing, but medium rather than high severity now that the region mismatch is resolved.

*Proposed fix.* Two independent fixes, different risk profiles. (A) Receipts — do NOT globally add caching to getUserReadReceiptsEnabled as proposed: chats/settings/_settings.tsx:14 uses it for the settings toggle GET, so a 60s process-local TTL would let a user's own toggle read back stale for up to 60s when the write and the read land on different serverless instances (setUserReadReceiptsEnabled only invalidates its own process). Fix it locally in messenger.ts instead: drop the getUserReadReceiptsEnabled(viewerId) call and derive the flag from the batch, e.g. `const memberReceipts = await getUsersReadReceiptsMap(memberIds.includes(viewerId) ? memberIds : [...memberIds, viewerId]); const viewerReceipts = memberReceipts[viewerId] !== false;`. The `!== false` default matches the single accessor's own missing-user default, and the explicit union guards the theoretical case of a chat-member doc with an unset crystal.state (passes resolveChatAccess but is excluded by listChatMemberDocs). Apply the same edit at :559, :665 and :754. (B) Duplicate resolveProfiles — not mechanical. projectMessages has five callers (:1124, :1250, :1320, :1352, :1449), so thread the member profiles in as an OPTIONAL parameter and have projectMessages resolve only the author ids missing from the passed map, so authors who have since left the chat still resolve. This also requires moving listChatMemberDocs above the projectMessages await (ideally into the same Promise.all as the message-page find) so the member ids exist before projection. Do (A) first — it is small, self-contained and independently verifiable — and treat (B) as a separate reviewed change.

#### buildSummaryContext runs 6 serial round trips where 3 are independent — and it is polled globally by every logged-in user

**High** · `remix/app/api/utils/messenger/messenger.ts:484` · fix safety: safe-mechanical

Real but smaller than claimed, and I'd rate it medium rather than high. Two corrections. (1) The 6-hop chain only fires for users who actually have chats. With zero memberships every `chatIds.length ?` guard short-circuits and `resolveProfiles([])` early-returns (things.ts:1245), so a chat-less user's poll costs 2 DB hops (memberships find + the uncached viewer `getUserReadReceiptsEnabled`), not 6 — the "every signed-in session costs ~10 RTs" framing overstates it for the majority of accounts. (2) The finder's ~209ms/RT-era arithmetic no longer applies: vercel.json pins `"regions": ["syd1"]`, co-located with the Sydney Atlas cluster, so a round trip is single-digit ms. The saving is therefore ~3 RTs (~5-15ms) of wall time per poll for chat-having users, and — the part that actually matters — a permanent ~3x reduction in per-request serial DB occupancy on the one endpoint the whole app polls unconditionally every 25s. At A active chat-having sessions the badge floor is A/25 req/s x 6 ops; the fix takes the serial depth to 3 without changing the op count. Worth noting the op count itself is untouched: `$or: unreadClauses` still fans out to up to MAX_LISTED_CHATS = 300 clauses (messenger.ts:51) per poll, and the viewer receipts findOne is a wholly avoidable uncached hop every 25s.

*Proposed fix.* Apply only the parallelisation half. Hoist RT1/RT2/RT4 into one `Promise.all` — all three read only `chatIds`/`unreadClauses`, both of which exist before line 488, there is no write between them, and no Mongo session is threaded through, so the reordering is behaviour-identical. `getUserReadReceiptsEnabled(viewerId)` can join that same first batch (it depends on nothing) at no extra cost. Then keep RT3 (memberDocs) as its own hop and RT5/RT6 as the final parallel pair: 6 serial hops -> 3. DO NOT apply the finder's second suggestion as written — a `?summary=1` mode that skips `memberDocs` and `resolveProfiles` would break the toasts it exists to serve: `chatDisplayName` (messengerTypes.ts:132-138) falls back to `chat.members` for any chat without a `name`, so every DM toast would read "Direct message" instead of the sender, and `last.authorName` is populated from `ctx.profiles` in `summaryEntry`, so every toast title would degrade to "Someone". A slim mode is still worth doing but needs the sender's profile and the DM counterpart name kept in the payload, which is a design change, not a mechanical one. Separately (optional, non-mechanical): give `getUserReadReceiptsEnabled` the same 60s TTL cache `getUsersReadReceiptsMap` already has, removing a per-poll findOne for every logged-in user including chat-less ones.

#### Weekly-summary cron runs a serial per-recipient loop of 3 queries + one SES send, up to 2000 times, inside a single Vercel function invocation

**High** · `remix/app/api/utils/notifications/weeklySummary.ts:186` · fix safety: needs-care

Corrected numbers. (1) The claimed "~100-300ms per DB round trip / over an hour" is WRONG: vercel.json now pins "regions": ["syd1"], co-located with the Sydney Atlas cluster, so DB round trips are ~1-5ms. Both post queries are also fully index-supported by things `{thingtime:1, ownerId:1, createdAt:-1, shareId:1}` (collections.ts:428). loadPostsAndViews costs 2 serial hops per target (a parallel countDocuments+find, then the postViews count), so at the 2000 cap the DB N+1 is ~4000 hops x ~2-4ms = roughly 8-16 seconds, not an hour. (2) The finder UNDERSTATED the send phase, which is the real wall-clock risk: sendEmail (email/service.ts:98) is not one round trip but four serial ones per send — email_messages insertOne (:115), getSuppressedRecipients find (:135), the SES deliverEmail call, and updateMessageStatus (:159) — so each delivered digest costs ~150-350ms end to end. At ~1000 recipients with activity that is ~2.5-6 minutes of strictly serial work, which does cross the 300s default function limit; at the 2000 cap it is ~5-12 minutes and is certainly killed. (3) The finder's "the tail never gets mailed / silently truncates" claim is overstated: the six-day email_messages idempotency lookback (:147-162) means a re-run skips already-sent recipients and makes forward progress, and the >2000 truncation is console.warn'd (:137), not silent. Vercel crons do not auto-retry though, so a killed run does leave the tail unmailed until an admin re-runs. Net: real defect, real N+1 in a function whose sibling helper already proves the batch pattern, but the binding constraint is the serial 4-hop-plus-SES send loop, not the post/view queries. I would rate this medium at today's scale (targets are further narrowed to opted-in, email-verified, has-activity users) and high at the 2000 scale the code explicitly designs for.

*Proposed fix.* Do not apply the proposed fix as written — three parts of it are unsafe. (a) The suggested cohort-wide `$match {postId: {$in: allPostIds}}` is dangerous: 2000 owners x MAX_POSTS_PER_USER_FOR_VIEWS (500) is up to 1,000,000 ids in a single filter, which blows the 16MB BSON document limit, and postViews is indexed `{postId:1, viewerKey:1}` (collections.ts:804) with no createdAt component, so the in-window filter is a post-scan. Batch in bounded chunks instead (e.g. 100-200 owners per aggregation pass), and roll views up to owner by joining on the owner's post ids within the chunk. (b) The suggested "small concurrency pool (5-10 in flight)" contradicts the load-bearing comment at :125-126 — "serial per-recipient so a big user base can't stampede SES" — and SES enforces a hard sends-per-second quota; naive parallelism would surface as Throttling errors counted into result.skipped.failed and could damage sending reputation. Any parallelism here needs an actual token-bucket rate limiter tuned to the account's SES quota, which is a design decision for the owner, not a mechanical edit. (c) Batching must run AFTER the alreadySent filter (:181-184), not before, or the run does post/view work for recipients it is about to skip — a partial regression. (d) The persisted resume cursor is a new stateful feature, not a mechanical change; note that the existing six-day email_messages lookback already provides coarse resume-on-rerun. Safest incremental change: keep the send loop serial, add the chunked two-aggregation prefetch of posts/views over the post-alreadySent target set, and separately raise/execute the send phase off the request path (queue or admin-paged run) if the owner wants the 2000-recipient case to actually complete.

#### trimRecipient fires a 3-round-trip cap sweep after every single notification emit

**Medium** · `remix/app/api/utils/notifications/notifications.ts:88` · fix safety: safe-mechanical

Every reaction, comment, reply, share and follow fires a fire-and-forget cap sweep that costs exactly 2 Mongo round trips (countDocuments then a skip-500 find) and deletes nothing in ~499 of 500 invocations. Server-side work is negligible — the { thingtime, ownerId, createdAt:-1, shareId } index (collections.ts:428) matches the sort exactly so there is no blocking sort, and the {_id:1} projection makes the skip a covered index walk of at most 500 keys. The real cost is network and connection-pool pressure: the sweep is void-launched so it does not lengthen the response, but it holds slots in the home client's maxPoolSize:10 pool (collections.ts:41) for the duration. On the deployed iad1 -> Atlas Sydney topology (~209ms per DB round trip) that is roughly 420ms of pool occupancy per social interaction doing no useful work, and with no waitUntil anywhere in remix/app or remix/server the delete can also be cut off when the serverless invocation freezes.

*Proposed fix.* Delete the countDocuments guard and run the skip-500 find directly. When the recipient is under the cap the find returns an empty array, `if (overflow.length)` is false, and behaviour is byte-identical — but it costs 1 round trip instead of 2, with the same covered index walk. Concretely, remove lines 90-91 (`const total = await things.countDocuments(...); if (total <= MAX_NOTIFICATIONS_PER_USER) return;`) and leave the rest of trimRecipient untouched. Only reach for probabilistic trimming (~1 in 50 emits, tail bounded at ~510 instead of exactly 500) or a TTL index if the remaining single round trip is still unacceptable — both change the cap's semantics and are not drop-in.

## Refuted findings

Reported by a finder, then rejected on verification against the real source. Recorded so they are not re-reported later.

- createThing blocks every reaction, comment and post write on the notification side effect (The code fact is accurate but the finding fails on two refute criteria: its impact is off by ~30-50x because it prices r)
- listThings owner browse violates ESR — folderId sits between the equality and the sort key, forcing a blocking sort (The code quoted is real (match block is at remix/app/api/utils/things/things.ts:2257-2261, sort at :2293, index at remix)
- listThemesForUser sorts on updatedAt with no supporting index in either store (The quoted code exists exactly as described (themes.ts:294-306), and the blocking SORT stage is real. But the finding fa)
- ~90-command createIndex battery fires on every cold instance boot and saturates the pool (The code exists but the finding is both already-mitigated and measurably negligible, and the proposed fix is a correctne)
- getSubscription re-fetches the user document that findUserById already loaded, on every authed request (The quoted code exists (subscriptions.ts:252-270; the fallback findOne is on line 258, not 256), but the finding's core )
- /api/v1/schemas re-serialises 83 KB of compile-time-constant JSON on every request with no Cache-Control or ETag (Code exists as quoted (remix/app/routes/api/v1/schemas/_schemas.tsx:21-25; json() at app/api/http.ts:5-16 sets only Cont)
- /api/v1/tiers makes 4+ Mongo round trips per request for a static public catalog, including a duplicate 'live' query, and sets no cache header (The code quoted is real and I confirmed it verbatim (listLiveSubscriptionTiers at tierCatalogStore.ts:371-404; the dupli)
- The server entry statically imports the apiDocs chunk, defeating the deliberate lazy import and adding it to every cold start (The quoted source lines exist (root-data-docs.ts:3 static import; [...].ts:236-238 lazy import with the comment), but th)
- JSON.stringify of theme overrides runs in a dependency array on every render (Code exists verbatim at remix/app/hooks/useTtTheme.tsx:35-39, but the impact is negligible and the analysis is inverted.)
- NotificationsBell keeps polling in hidden/background tabs — the only poller in the app without a visibilityState guard (Already fixed in current source. The claimed evidence (an unguarded `window.setInterval(refresh, POLL_MS)` at Notificati)
- Notification email fan-out is a serial per-recipient loop of countDocuments + SES round trip (The loop exists as quoted (emails.ts:129, sendToTarget:65-71, recentNotificationEmailCount:55-63), but the claimed cost )

## Review record (independent review loop)

A second Claude session reviewed this branch as it was pushed (PR comments of
2026-08-18). Outcome, so the verification standard is auditable:

**Round 1 — full diff `2322f192..a59b1583`** ([comment](https://github.com/lopugit/thingtime/pull/299#issuecomment-5328516495)):
no invalid changes. The load-bearing equivalences were re-derived from source
rather than trusted: `toPublicUserWithStorage` ≡ `toPublicUser(user,
getSubscription('user', String(user._id)))` with id symmetry across both user
stores; `findThingByKind` matches `{shareId, thingtime}` only, so the
`resolveChatAccess` gate's raw-id membership lookup is equivalent;
`findUsersByIds` set-membership is symmetric with the requested ids; zero
FontAwesome usages remained; no `remix/public/assets/` collision for the
immutable-cache rule; the `/api/docs` LRU eviction math is sound; the
`notification_unread` partial index was tested empirically (creation, planner
selection with `isPartial: true`, missing-vs-explicit-null counting).

**Round 2 — increment `a59b1583..4251726`**: clean. The
`RELATED_CHILD_PROJECTION` whitelist was checked against every consumer
(pass-1/level loops, `buildComment`, `mergedCommentsOf`/`mergedReactionsOf`,
the attachment target pass, and the v1 fallbacks inside
`isV2`/`thingtimeOf`/`crystalOf`/`targetIdOf`) — no consumer reads a projected-
away field; embedded v1 residue is only ever merged off unprojected page-level
docs. Both round-three indexes are additive and version-safe; `PostRow`
memoization is identity-correct.

**Caveat closed**: null equality in `partialFilterExpression` was flagged as a
possible boot-time `ensureIndexes()` risk on older servers. Verified: the
production Atlas cluster runs **MongoDB 8.0.1** — the same version the index
was empirically tested on — and CI's API suite (which boots `ensureIndexes()`)
is green with all three new indexes.

**Fix landed from review**: `insertChatMembers` now rethrows bulk errors that
carry `writeConcernErrors` before the all-11000 duplicate swallow — a
write-concern failure means the memberships may not be durably replicated, and
the old per-id `insertOne` path always rethrew those.

**Considered and deliberately left**: the `useRecentReactions` one-fetch-per-
session latch (cross-device MRU staleness until reload). It follows the
optimistic-rendering house rule and `pushRecent` keeps the local list current;
revalidate-on-`visibilitychange` is the upgrade path if staleness ever matters.
