# PR #692 — Thing index consolidation

Branch: `codex/thing-index-consolidation`, base `develop`.
PR: https://github.com/lopugit/thingtime/pull/692

The owner authorized production/develop migrations and merge-commit releases
to both branches. `ai-merge-paused` keeps unfinished consolidation out of the
automatic merge path. This PR is independent of Watch PR #665.

## 2026-09-08 — baseline and migration preparation

- Full [architecture audit](../docs/architecture/thing-index-consolidation.md)
  accounts for every baseline index and records rollout gates.
- Production has 60 indexes; develop has 61, including the still-needed Watch
  recording due index. Both origins have zero root `kind` documents.
- The source plan is now introspectable without a database connection.
  Ordinary-prefix deduplication finds zero automatically safe candidates.
- Stop creating and retire the unused non-unique emoji lookup on home only.
  Preserve shared protected uniqueness and any older unique ancestor.
- Repair the relationship migration before switching readers: add missing
  individual keys, preserve existing keys, compare source identity, terminate
  on finite duplicate batches, and report actual writes and conflicts.
- Tests cover partial keys, reruns, data-kind isolation, empty optional keys,
  1,001 duplicate rows, concurrent edits, lease loss, and database failure.
  Migration capability patches and compatibility tests accompany the change.

## Outstanding release proof

The production workbench rejected `$indexStats` with MongoDB Location40602:
its privacy projection preceded a stage that must run first. A narrow fix
keeps the exact empty `$indexStats` stage first and retains the strip before
all subsequent document ingress. Tests retain protected-field probe rejection
and `$unionWith` stripping. Shared-key document queries remain blocked by the
workbench; this fix does not relax that restriction.

The initial preview is reachable at
https://pr-692.previews.dev.thingtime.com/migrations (first verified SHA
`8f83161868f1d9e2a8f4f34f8108feda9cd71ab8`). Its new origin requires an admin
login; the user has been asked to sign in. Full local unit/build/output checks
and the 108-error typecheck ratchet passed for migration repair `96cbd6bd3`.
That does not constitute native MongoDB or deployed migration proof.

No production/develop migration or merge is claimed yet. The source count of
59 is only the first increment, not completion of the owner's request. The
shared-key reader cutover, remaining index-family benchmarks, real API and
Mongo query-plan acceptance, deployed manifests, exact-head CI, and final
before/after production/develop inventory remain required.
