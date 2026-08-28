# Thingtime performance audit

A full performance pass over the codebase: an exhaustive audit across ten
dimensions, every finding verified against real source before being recorded,
and the highest value-to-risk fixes landed on this branch.

- **Backlog:** [TODO.md](TODO.md) — the open items, ordered by severity.
- **Working notes:** `../PRs/299-claude-thingtime-performance-optimization-55ea95-performance-audit-findings-notes-and-fixes.md`
- **PR:** https://github.com/lopugit/thingtime/pull/299

## Headline results

**Initial JS payload: 1,165 KB → 168 KB gzipped (−86%).** Every anonymous
visitor to the landing page had been downloading the admin dashboard, the CI
control panel, the migrations console, the `/tests` fixture table, the
7,565-line API docs registry, and the entire FontAwesome solid icon set —
which nothing in the app has ever rendered.

| Entry chunk | raw | gzip |
|---|---|---|
| Before | 4,112 KB | 1,165 KB |
| After route splitting | 1,545 KB | 482 KB |
| After FontAwesome removal | **578 KB** | **168 KB** |

Other measured wins:

| Change | Measured effect |
|---|---|
| Sparse `shareOfId` index | share-count aggregation: **4,846-document COLLSCAN → 6 documents examined**, on every feed page, post read, search page and reaction toggle |
| `{kind, createdAt, shareId}` index | feed plan: **blocking SORT over every visible post → SORT_MERGE**, no in-memory sort |
| Partial unread-notification index | badge count stops fetching a user's entire notification history (0 docs examined when caught up) |
| Concurrent session/user/subscription | **3 → 1** Mongo round trips on *every* authenticated request |
| Shared recent-reactions fetch | **8 → 1** identical requests per page (≈40 → 1 on a 20-post feed) |
| Batched chat-member writes | **50 → 1** round trips per add |
| Immutable `/assets/` caching | ~80 conditional GETs per repeat visit → 0 |

## How the audit was produced

Ten parallel finders swept one dimension each — N+1 patterns, index coverage,
scan and payload bloat, connection lifecycle, per-request handler work,
caching, React re-render cost, client fetching, bundle size, and the
multi-node/real-time architecture.

Every finding was then handed to an independent adversarial verifier whose
default was to **refute** it: open the file, confirm the quoted code exists,
confirm the path is genuinely hot (not dev-only, test-only or flag-gated),
confirm nothing already mitigates it, and confirm the proposed fix would not
break correctness or a documented house rule.

**74 raw findings → 63 confirmed, 11 refuted.** Verifiers also corrected
finder exaggerations rather than passing them through: impact figures that
assumed the old cross-region layout were restated against the current `syd1`
pinning, and several severities were downgraded on evidence.

## Status

| | count |
|---|---|
| Confirmed findings | 63 |
| Fixed | 20 |
| Partially addressed | 1 |
| Open | 42 |
| Refuted (recorded, not real) | 11 |


## Verification standard

Nothing here was taken on trust:

- `tsc --noEmit` against the documented pre-existing baseline (`app/smarts/index.tsx` and friends; `things.ts` holds at 7).
- `lint:files` on every changed file.
- Anything user-visible or security-relevant verified against a **running stack** — not just types. Auth changes were checked with forged bearer tokens and tampered cookies; ACL changes with a private-root thread; feed projections by **diffing live API output byte-for-byte** against the unmodified code.
- Index changes verified with `explain()` before and after, confirming the plan actually flipped, plus a check that `ensureIndexes` creates them on bootstrap.

### Two traps worth remembering

**Projections must include the era discriminator.** The first `resolveRelated`
projection silently emptied every post's comments and reactions. `isV2(doc)`
reads `doc.schemaVersion`, and `thingtimeOf` / `crystalOf` / `targetIdOf` all
branch on `isV2()`. Projecting `schemaVersion` away made every child doc read
as a v1 post, so `thingtimeOf` returned `['post']`, neither the comment nor the
reaction branch matched, and the whole child set vanished — with no error, no
type failure and no lint complaint. The audit's own suggested field list
omitted it too. Any projection over `things` must carry `schemaVersion` plus
the v1 fallbacks those helpers read (`shareOfId`, `type`, `text`, `images`,
`listing`).

**`tsc` can report no errors on a file it is genuinely checking.** An early run
passed silently on a file that had a real arity error. Coverage was afterwards
proven by appending a deliberate type error and confirming it surfaced. Treat
"no output" as unverified until proven.

## Deliberately not changed

**`getMongoStatus` opens a fresh `MongoClient` per call** (flagged Critical).
The fresh-connect-and-close is documented as intentional in the function's own
header — *"Fails fast (2s) and always closes the client so a status check never
hangs a request or leaks a connection."* Reusing the pooled client would remove
a full SRV + TLS + auth + topology handshake per call, but it changes what the
check *tests*: the pooled path cannot detect a cluster that is up but refusing
new connections, and it inherits the pool's 5s selection timeout rather than
the deliberate 2s. That is a judgement about what "healthy" should mean for
this app, so it is left to the owner rather than changed silently. The
unambiguous half — `listCollections` pulling full metadata to compute a count —
is fixed.

Where a faster fix would have been possible but semantically lossy, the
behaviour-preserving option was taken and the reason recorded in the commit:
dropping the v1 `$or` branch from the post match or the share-count
aggregation would be faster still, but would silently hide un-migrated v1 posts
and shares.

## Fixed in this pass

- **getThing comment permalink walks the thread chain O(D²) times, all sequential**  
  `remix/app/api/utils/things/things.ts:2199` · was Critical
- **postMatch's dual-era $or forces the main feed into a blocking in-memory sort of every matching post**  
  `remix/app/api/utils/things/things.ts:648` · was Critical
- **getCurrentUser serializes 3 independent Mongo round trips on every authenticated request**  
  `remix/app/api/utils/auth/getCurrentUser.ts:31` · was Critical
- **Hashed client bundles ship with no Cache-Control — the 1-year publicAssets maxAge is silently discarded**  
  `remix/scripts/patch-vercel-output.mjs:21` · was Critical
- **useRecentReactions fetches the same MRU list once per PostCard AND per CommentRow — no in-flight/module dedupe**  
  `remix/app/components/Emoji/useRecentReactions.tsx:26` · was Critical
- **Entire FontAwesome solid icon set (1 MB) is bundled and never used**  
  `remix/app/hooks/useIcons.tsx:2` · was Critical
- **Zero route code splitting: all 38 routes statically imported into one 977 KB-gzip chunk**  
  `remix/app/routes.tsx:110` · was Critical
- **getCurrentUser costs 3-4 sequential Mongo round trips on every authenticated API request, uncached**  
  `remix/app/api/utils/auth/getCurrentUser.ts:31` · was Critical
- **Search result pages check ACL inheritance without the batched lookup, re-introducing the per-doc walk that already timed out /things in production**  
  `remix/app/api/utils/things/search.ts:384` · was High
- **resolveChatAccess does two sequential findOne on every chat read/write, on a 4-second poll**  
  `remix/app/api/utils/messenger/messenger.ts:296` · was High
- **Per-user findUserById fan-out instead of the existing findUsersByIds batch (2 queries × N users)**  
  `remix/app/api/utils/messenger/messenger.ts:341` · was High
- **Share-count aggregation matches on unindexed `shareOfId` — a full COLLSCAN inside every toPublicPosts() call**  
  `remix/app/api/utils/things/things.ts:1321` · was High
- **Reply-level aggregation $push'es every reply's whole document into a $group accumulator before slicing to 5**  
  `remix/app/api/utils/things/things.ts:1397` · was High
- **/api/docs memoises a 308 KB render into an unbounded Map keyed by request origin**  
  `remix/server/routes/api/docs.ts:11` · was High
- **Inline onChanged closure in PostList defeats PostCard's React.memo entirely**  
  `remix/app/components/Feed/PostList.tsx:82` · was High
- **resolveChatAccess runs two independent point lookups serially on the hottest messenger path**  
  `remix/app/api/utils/messenger/messenger.ts:294` · was High
- **buildSummaryContext runs 6 serial round trips where 3 are independent — and it is polled globally by every logged-in user**  
  `remix/app/api/utils/messenger/messenger.ts:484` · was High
- **buildSummaryContext issues six sequential round trips where three of them are independent**  
  `remix/app/api/utils/messenger/messenger.ts:488` · was Medium
- **Notification unread count fetches every one of a user's notification documents because readAt is not in the index**  
  `remix/app/api/utils/notifications/notifications.ts:228` · was Medium
- **Status endpoint fetches full collection metadata just to count collections**  
  `remix/app/api/utils/mongodb/status.ts:71` · was Medium


## Partially addressed

- **resolveRelated loads EVERY comment and reaction doc (full documents, no limit, no projection) for each page of posts**  
  `remix/app/api/utils/things/things.ts:1307` · Critical — projections landed; bounding the result set remains (see TODO.md).


## Refuted findings

Reported by a finder, then rejected on verification. Recorded so the same false leads are not re-investigated.

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
