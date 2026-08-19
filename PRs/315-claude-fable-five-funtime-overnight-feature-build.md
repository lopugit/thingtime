# PR #315 — claude/fable-five-funtime — overnight feature build

An autonomous overnight loop (2026-08-18 23:00 → 08-19 ~04:00 AEST, finalized
~10:30 after a session-limit pause) that shipped seven self-contained features
on one branch, PR #315 → develop. Each feature: builder agent → two
adversarial reviewers (correctness + security, live-probing the dev stack
with fixture users) → fixer → independent browser/curl verification →
separate commit.

## Features / commits

| # | Feature | Commit |
|---|---------|--------|
| 1 | 🗳️ Interactive poll voting (vote child kind, POST /api/v1/things/vote, live bars, composer mode) | e8ed46cd |
| 2 | 🔥 /explore trending page (GET /api/v1/things/trending, decayed engagement score) | f0f63a1c |
| 3 | 🌱 Profile activity heatmap (GET /api/v1/users/activity, SVG grid) | d591853c |
| 4 | #️⃣ Clickable hashtags + tag chips (+ /search?tags= deep link) | f1b16687 |
| 5 | 🔗 OG/Twitter cards for permalinks (+ Vercel permalink routing fix) | 15746fcf |
| 6 | 📡 Atom feed (GET /api/v1/things/rss) | 9af84c9f |
| 7 | ⌨️ Feed keyboard shortcuts + '?' cheatsheet | 75cc6760 |

## Review-caught bugs (fixed pre-ship)

- **Silent vote loss via voteKey squatting** (major): a generic `data` thing
  could claim `crystal.voteKey` slots; the vote util's E11000 reconcile
  matched nothing and still returned ok:true. Now 409s. The same squatting
  gap pre-exists for followKey/memberKey/dmKey/inviteCode/emojiKey on
  develop — spun off as its own task, NOT addressed here.
- **Cross-account cache leak** (major): /explore first cut cached
  viewer-personalised boards in one shared localStorage key. Now
  per-viewer `tt-explore-<userId>` `{at, posts}` seeded through
  mergeReactionOverlays; tt-activity-* caches swept on logout
  (new `clearLocalCachePrefix`).
- **`$`-pattern HTML injection in social meta** (major, confirmed live):
  `String.replace` with a string replacement let post text containing
  `` $` ``/`$$` dump raw shell HTML into permalink pages. Replacement
  function now.
- **Surrogate-pair truncation crashes** (critical for tags): UTF-16
  `slice(0, 40)` could bisect an emoji and make `encodeURIComponent`
  throw during render (white screen). Code-point capping + lone-surrogate
  stripping at all canonicalizer sites (hashtags.ts, things.ts
  sanitizeTags, attachmentUiCore.ts, socialMeta truncate).
- **Comment permalinks got generic meta**: `acl.includes('tt:all')` never
  matched comments' `['tt:inherit']`; inherit accepted after the anonymous
  visibility walk already proved world-readability.
- **Heatmap window/grid misalignment**: server rolling 366-day cutoff vs the
  client's Sunday-aligned 53-week grid; server now computes the exact grid
  window start.
- **Demo poll renderer in comments**: untrusted surfaces painted a fake
  tappable vote; now static results.

## Operational notes (for future overnight loops)

- Vite/Nitro dev children can survive PM2 app restarts and squat the
  worktree ports → the PM2 app crash-loops on bind (hit 140 restarts).
  Diagnosis: `lsof -nP -iTCP:<port> -sTCP:LISTEN` + ppid=1 orphans.
- The PM2 God Daemon itself wedged after a hung `web-pms` spawned a second
  daemon; `pm2 ping` timing out machine-wide. Left for manual recovery
  (other sessions' apps run under it); dev stack ran as a plain foreground
  process instead.
- Session usage limits kill workflow agents mid-flight; the Workflow
  resume-from-run-id path (cached builds, re-run dead reviews) recovered
  both times it was needed.
- graphify's post-commit hook rebuilds the graph with version-drift churn —
  discard `graphify-out/` diffs before every commit (house convention).

## Verification

TESTING.md gained a checklist section per feature. Full-project tsc remains
at its pre-existing broken baseline (~150 errors, none in files touched
here); targeted lint + live Vite/Nitro compile + browser verification were
the gates, per repo docs.

## Sequel run (2026-08-19 daytime, owner-requested continuation)

| # | Feature | Commit |
|---|---------|--------|
| 8 | ⌘ Cmd+K quick switcher | 02b6aa69 |
| 9 | 🕰️ On this day memories card | caa5a569 |
| 10 | 💬 @mentions (autocomplete + bell/email, acl-gated) | c78e2e27 |
| 11 | 🐑 One-click Duplicate on /things | 3db64c3c |
| 12 | 🔖 Surface Saves (/saved library) | 65ea4e93 |
| 13 | 🎆 Emoji Splash | a04c940d |
| 14 | ▶️ API docs Try-it runner | 42131a22 |

Sequel review catches (fixed pre-ship): Cmd+K collision with Editor.js's
inline-link chord + Escape dead-spots + macOS Ctrl+K hijack; on-this-day
UTC/local anniversary mis-bucketing; @mention notifications leaking private
post text to non-viewers (now gated by the exact read-path acl evaluation);
Duplicate landing in the browsed folder instead of each thing's own; poll
splash bursting on guard-dropped taps. All 14 features carry TESTING.md
checklist sections.
