# PR #295 — third-party-app-integration: connect 3rd party apps

Branch `claude/third-party-app-integration-c96057` → `develop` ·
[PR #295](https://github.com/lopugit/thingtime/pull/295)

Link external accounts to a Thingtime account (one external account linkable
from MULTIPLE Thingtime accounts), browse their feeds inside Thingtime with
native Thingtime comments/reactions layered on the synced posts, and apply AI
feed filters ("warn for sad news" → veil + Show button, or hide). Built by a
cron-backed /loop automation across five iterations; durable state lived in
untracked `TODO/.loop/third-party-apps-STATE.md`.

## Architecture

- Five PROTECTED things kinds: `external-account` (one per provider identity,
  shared many-to-many; OAuth/session tokens sealed in the root `secure`
  BinData blob, home-pinned), `external-account-link` (user ↔ account join,
  home-pinned), `external-post` (synced item, deterministic reserved
  `ext-post-*` shareId on the DATA plane so comments/reactions/permalinks work
  natively; root `sourceIds` array = one post through many sources),
  `feed-filter` + `feed-filter-verdict` (AI rules + cached per-revision
  verdicts). `ext-` prefix reserved in `sanitizeShareId`.
- Provider adapter registry (`api/utils/connections/providers.ts`), 21
  providers in three auth modes: keyless public (demo, RSS/Atom, Reddit-public
  via .rss twins, Hacker News, YouTube channels, Mastodon-public, Bluesky-
  public, Lemmy, GitHub), OAuth2 SSO (Facebook, Instagram, TikTok, YouTube
  account/Google, Reddit account, Mastodon account, X w/ PKCE, Twitch, Tumblr,
  Pinterest, LinkedIn — all config-gated by env creds, honest about-copy on
  official-API limits), and credential (Bluesky app password → AT-proto
  session, never stored).
- Real algorithmic home feeds where the APIs expose them: Reddit `/best`
  front page, Mastodon home timeline, Bluesky following timeline, Tumblr
  dashboard, Twitch followed-live; Meta/TikTok/YouTube sync own-content /
  subscriptions (their home feeds are not exposed to apps — stated in-UI).
- Virtual YouTube subscription system (ytsubber-style): per-user managed
  channel list, add/remove + name search (YouTube Data API key; ids/URLs
  keyless via RSS), merged uploads feed; shares its post namespace with the
  Google-SSO provider so the same video is ONE post with unified comments.
- OAuth core: begin/callback endpoints, state = short-lived signed JWT bound
  to the starting session (S256 PKCE verifier rides the signed state for X),
  token refresh near expiry with compare-and-set persistence (rotation-safe),
  reconnect-needed surfacing via lastSyncError.
- Feed: per-account sync cooldown, deepen-on-scroll (capped page depth),
  stale-while-revalidate first paint (`sync=defer` read + client background
  revalidate — serverless-safe: revalidation is a second request, never
  post-response background work).

## Verification

`pnpm --dir remix run verify:connections` — real-API E2E per FUNDAMENTALS §2
(no direct Mongo anywhere): walls, idempotent connect, many-to-many linking,
acl gating + unlink revocation, native comment/react layering + permalinks,
filter lifecycle, SSO guardrails (forged state, session binding, env-naming
400s, masked secret fields), virtual-YouTube CRUD, squat/forge protections.
Browser-verified desktop + mobile. `TT_VERIFY_LIVE=1` adds a live network
pull.

## Review rounds

Iteration 3 ran a 10-angle adversarial review (48 candidates → 30 unique →
15 confirmed findings, all fixed): YouTube-reconnect list wipe, filter-toggle
action reset, unlink grant revocation, cross-provider video dedupe,
external-post Share 404, link-cap reconnect block, stale-accountId grants,
tab-bar collapse, pre-1970 cursor loop, TikTok error envelope, IG null-expiry
refresh, degraded-verdict cache poisoning, error-union break on malformed
URLs, stripHtml ReDoS hardening, legacy $or index defeat — plus ~14 cleanups
(shared sha48/fail/cursor helpers, pagedGraphFeed, oauthCredsFor, page-clamp
helpers, verdict batching/pruning/cache policy, external author links).

## Round 3 — relational source membership

The §3 debt the earlier rounds logged turned out to be sharper than "bounded
but inelegant". `sourceIds` and the per-source `tt:extacct/<accountId>` acl
entries each grew by one element per *sourcing account*, and personal-timeline
providers mint one account per user — so on a post that surfaces in many home
timelines both arrays grew per user, with no cap: monotonic growth toward the
16 MB document ceiling on the hottest docs, a full-document rewrite per sync,
and — because `toPublicPosts` projects `acl` verbatim — every reader received
the external-account ids of everyone else who sourced the post.

Membership is now one `external-post-source` thing per (post, account):
canonical root `targetId` child of the post, `uniqueKeys`-deduped on
`sourceKey:<postId>:<accountId>`, with the post's publish time denormalized
onto the row so the feed pages membership directly (same sort, same chrono
cursor, same existing `(thingtime, crystal.accountId, createdAt, shareId)`
index) and then fetches that page's posts. Rows are de-duplicated by post so a
viewer holding two accounts that both source a post still sees it once, and the
cursor rides the last row actually consumed.

The post's acl became a CONSTANT: `tt:all` (public) or `tt:extsourced`
(personal). `tt:extsourced` names no account, so it discloses nothing and
cannot grow; it resolves live through `viewer.extSourcedPostIds`, primed for
free from the membership page the feed already read (single-doc paths — the
permalink, comment chains — pay one indexed existence check, memoised per
request). `aclAllows`/`aclEntryMatches` take an optional `docId` for this;
callers that don't pass it simply never match the entry, which fails closed.
Retiring an account's last link now also drains its membership rows.

`relational-external-post-sources` migrates legacy residue (rows keep resolving
through the retained `tt:extacct/` compatibility branch until it runs). Drilled
end-to-end against the real admin API — 20/20 — including that a legacy post
stays visible to its linked member *both before and after* the run, that an
outsider stays 404 throughout, and that a second run is a no-op.
`verify:connections`: **94/94** (was 81).

## Known boundaries / future work

All of these are external constraints, not outstanding code:

- LinkedIn feed content is partner-gated (identity-only link today); X
  timeline reads need a paid API tier.
- Live SSO pulls need the owner's app credentials in `remix/.env` (env names
  in README "SSO account linking").

(The round-2 form-OAuth grant factory and the round-3 relational membership
retired the two architectural items previously listed here.)
