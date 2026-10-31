# PR #756 — Public component audience boundaries on main

Promotes the focused sharing changes from [PR #753](753-codex-shared-public-component-boundaries.md),
without the unfinished binary-file copying in PR #755.

## Main integration — 2026-09-10

Main advanced to `523272a02` while this promotion was prepared. Its Lopu
comment approval and capability-cache changes are preserved. The changelog
conflict keeps both histories; generated graph snapshots are taken as one
consistent set and regenerated rather than hand-merged.

Main also enabled the origin-scoped manifest suite in the standard capability
command. Five older assertions needed the deliberate sharing patch versions:
Things 1.9.1, things-update 1.2.6, actions-run 1.3.1, things-fork 1.2.1 and
attachment-content 1.6.2. The runtime contracts and permission guards were not
weakened to satisfy the tests.

Combined local validation: actions 76 passed; capabilities 38 passed;
webpages 91 passed with two opt-in skips; full Vite/embed/Nitro build and
Vercel output verification passed. The source audience resolver and media
regressions match the signed-out browser/API-tested PR #753 revision.
Fresh CI and deployment evidence must still be checked on this PR's exact head.

PR #753 merged to develop as `77ee7f3373dcb311c401ea1c563e6796e8b3083f`.
Its final security check succeeded; 11 existing unrelated dismissed findings
were present, with no open findings. This note does not claim main deployment
or binary-copy acceptance.
