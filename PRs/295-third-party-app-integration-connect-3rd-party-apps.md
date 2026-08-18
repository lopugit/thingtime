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

## Known boundaries / future work

- Per-post acl grants and sourceIds are bounded (MAX_LINKS_PER_ACCOUNT=100,
  MAX_LINKS_PER_USER=50) but the §3-clean long-term shape is relational
  per-(post, member) grant docs.
- LinkedIn feed content is partner-gated (identity-only link today); X
  timeline reads need a paid API tier.
- Form-style OAuth exchange/refresh could consolidate into a grant-helper
  factory (rotation-aware) before the next provider lands.
- Live SSO pulls need the owner's app credentials in `remix/.env` (env names
  in README "SSO account linking").
