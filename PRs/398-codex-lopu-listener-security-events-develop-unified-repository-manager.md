# PR #398 — Unified Lopu repository manager on develop

## Purpose

Keep `develop` on the same thin, protected Lopu contract as `main`: all PR
signals compile with the delegated CodeQL permission, rebase/stack work has no
competing public trigger, and promotion plus branch synchronization are jobs of
the one **Lopu PR manager** workflow.

## Final consolidation

- The listener forwards conversations, inline review comments, completed
  checks, every branch push, PR lifecycle signals, both maintenance schedules,
  and explicit repository-maintenance inputs to `@github-actions`.
- The old product-branch `promote-develop-to-main.yml`,
  `promote-features-to-main.yml`, and `sync-main-into-develop.yml` entries are
  removed. Their protected implementations remain reusable only from Lopu.
- Develop pushes now contain both promotion lanes inside one Lopu run. Main
  pushes contain main→develop synchronization there, and each internal
  component queues without cancelling in-flight work.
- The internal rebase listener remains only for the exact legacy
  `rebase-pr-stack-ai` handoff; every public/manual scan enters through Lopu.

## Validation

The product caller contract proves that only the required thin listeners
remain, every maintenance input is forwarded, the historical promotion/sync
files stay absent, and no product branch contains executable Actions support.
Graphify structural and semantic outputs are refreshed after the source and
documentation changes.
