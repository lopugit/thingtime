# PR 728 — Promote shared media context and startup recovery to main

Promotes the owned CSS-media and early-startup recovery increment from
[PR 719](719-codex-shared-render-media-context.md), including its reviewed
single media-grant predicate and preservation of unresolved templates.
It does not include the separate nested/HTML media increment or claim the
entire inheritance and independent-copy goal is finished.

## Source and validation

- Initial promotion `e89394437a23156ef6bb675b063125b14acc4c9a` starts at
  main `60f07ce4e`. Its Remix code equals reviewed source `907a079` except
  changelog text. That source is already deployed to develop as `5839533`
  and was verified in signed-out Safari: full Tarot, working Draw, Copy and
  no edit control.
- The initial main worktree passed 80 webpage/sharing tests, 26 capability
  tests, 6 origin-manifest tests, 16 preview/startup tests, and the production
  client/embed build. Optional real-browser tests were skipped by those unit
  commands; the original source's real-API/browser evidence is in PR 719.
- Main advanced to `fa3624d3a9902bbd022d92a6d47e7a6351fba2ed` (PR 726)
  during publication. Integrating it preserves its native recording/push
  work and resolves the changelog conflict by retaining both entries.
- The updated merge head requires fresh checks, exact deployed preview
  validation and a production receipt before delivery. No pending check is
  recorded as successful and no full typecheck pass is claimed.
- Integration `c02d1f9` passed both actual Web CI build and API jobs. Main
  subsequently advanced through PR 729 to `2ec5267f0`; the next integration
  preserves its bounded APNs collapse identifiers and both changelog entries.
  Exact-head checks and deployment verification must be repeated after that
  integration; earlier green checks do not substitute for them.
- Graphify uses the code-only fallback because the local semantic proxy
  health request times out. New release-note Markdown is not semantically
  indexed; the available structural snapshot and portable reports are kept.

## Remaining goal work

Rich/raw HTML and nested-bound upload inheritance are a separate increment.
Stored component-argument media, independently copied protected uploads,
general containment/performance auditing, and distinct retryable page-resolve
errors remain unfinished. Never preserve the original root bearer in a fork
as a substitute for independent media ownership.
