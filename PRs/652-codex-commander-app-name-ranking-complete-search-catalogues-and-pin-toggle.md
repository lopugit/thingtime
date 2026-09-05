# PR #652: Complete Commander search catalogues, app ranking, and pin toggle

Date: 2026-09-05. Branch: `codex/commander-app-name-ranking`. Base: `develop`.

## Diagnosis and changes

- Generic filename tiers outranked complete words inside app names. A narrow
  application-title word boost now handles `magician` / `SamsungMagician` and
  `recovery` / `Thingtime Recovery`, without promoting path-only matches or
  arbitrary substrings. Exact filenames, user preferences, and the Emoji picker
  retain their intended priority in both Rust and TypeScript ranking.
- A later check found that completed indexing replaced the catalogue with only
  the first 1,000 apps. Complete catalogue reads now use `limit: null`, supported
  for applications, files, and directories. Interactive file pages cannot crowd
  apps out before ranking. Catalogue reads bypass typing-query supersession.
- Removed arbitrary strict-FTS, prefix, coarse-fuzzy, and path candidate-count
  cutoffs. Numeric limits describe ranked output pages; they do not cap stored
  catalogues. Explicit scanner resource settings and search time budgets remain.
- Removed the unconditional app scan at startup. A fresh persisted index is
  reused; watchers and scheduled reconciliation continue independently. Typing
  performs reads, not index operations.
- Added `Open New Windows Pinned` to the pin icon context menu. It uses General
  settings' existing optimistic save/rollback path, displays the saved check
  state, and does not change the current window's pin state.

## Verification

- Canonical development build, typechecks, all 185 TypeScript tests, packaging,
  installation, and runtime verification passed with
  `COMMANDER_SIGNING_MODE=development ./script/build_and_run.sh --verify`.
- 68 Rust tests passed across the search core and filesystem indexer. Coverage
  includes 1,501 entries of each kind, unlimited CLI/JSONL reads, ranking before
  pagination, catalogue/typing concurrency, and repeated read-only queries.
- The old streaming-cache test depended on the removed startup scan. It now
  explicitly refreshes commands while a search is in flight, preserving its
  stale-cache regression assertion.
- Installed native search and Chrome checks showed matching apps first for
  `magician`, `recovery`, and `thingtime recovery`; exact `Magician.png` and
  `recovery.c` files still led. The live persisted catalogue returned all 1,890
  distinct application records, including both reported apps.
- The menu fits a 780 by 550 launcher without horizontal overflow. Both toggle
  states saved; the current window stayed pinned. The original default was
  restored and reloaded successfully. Native pointer automation was unreliable,
  so toggle interaction used the identical installed UI in Chrome. Opening a
  new native window and testing focus-loss behavior was not repeated in this run.
- The installed bundle's strict signature verification passed with its existing
  stable Apple Development designated requirement. This is a local development
  install, not a notarized distribution release or a Vercel web deployment.
- Graphify's code and semantic outputs were refreshed; local portable HTML is
  available. CI status is reported on the PR, separately from local checks.
