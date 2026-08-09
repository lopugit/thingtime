# PR #206 — Keep feature promotion running across historical Git failures

Branch: `codex/harden-feature-promoter`

## Context

The feature promoter run `31303856070` created promotion PRs #202, #203, and
#204, then stopped globally while inspecting source PR #186. GitHub still
reported #186's original merge commit, but a historical force rewrite of
`develop` had made that commit unreachable from every advertised ref. A full
checkout therefore did not contain the object, and an unguarded `git rev-list`
exception terminated the batch after its first three successful side effects.

## Resolution

- Probe each historical merge object before planning it, fetch a missing object
  by exact SHA, and re-check that it is a readable commit with its parents.
- Distinguish Git's normal “not an ancestor” status from object/inspection
  failures and return structured per-source planning results instead of
  throwing through the whole run.
- Verify that a recovered patch is still effective at the current `develop`
  tip, including multi-commit ranges; later removals, reverts, and ambiguous
  source evolution fail closed for review.
- Continue later independent groups after a source, Git, or cherry-pick failure
  while stopping only the remaining dependent members of the same named stack.
  Unexpected group errors are accumulated and reported after all other groups
  run, so the workflow still receives a failing conclusion without hiding the
  partial work.
- Always emit the partial step summary, even after an unexpected workflow-level
  failure.
- Refresh reused remote promotion branches, reconstruct and compare their exact
  expected trees, require one-to-one cherry-pick provenance and the expected PR
  base, validate external stack chains back to `main`, and check every truly
  earlier CLOSED predecessor before adding dependents.
- Apply `MAX_NEW_PRS` to PRs opened from reusable branches and scan up to 1,000
  historical promotion records so reruns remain idempotent as the repository
  grows.
- Guard the module entry point so helper imports used by tests cannot execute a
  live promotion run.

## Regression coverage

The built-in self-test now constructs a real bare Git remote, creates a merge,
force-rewrites `develop` to an equivalent commit, and proves that a fresh full
clone does not contain the orphaned merge. It then fetches the exact SHA,
verifies both merge parents and mainline cherry-pick output, and covers:

- ancestry-preserving and post-rewrite reverts;
- complete multi-commit range verification;
- malformed and unavailable object IDs;
- stale remote-tracking refs;
- unrelated, same-path/whitespace, reverted, and duplicate-provenance branch
  drift;
- standalone continuation, stack deferral, partial summaries, and ambiguous
  stack chronology.

## Validation

- `node --check .github/scripts/promote-features-to-main.mjs`
- `node .github/scripts/promote-features-to-main.mjs --self-test`
- workflow YAML parse
- `git diff --check`
- live no-write run with `DRY_RUN=1 LOOKBACK=50 MAX_NEW_PRS=50`; it scanned all
  13 eligible sources, reported isolated blocks/conflicts, continued to later
  groups, emitted the complete summary, and exited successfully
- Graphify semantic refresh and multigraph diagnostics: zero missing,
  dangling, self-loop, duplicate, or collapsed edges

## Diagnostic-side-effect note

Before the module entry guard existed, one helper-import diagnostic
unintentionally entered the script's live main path. It briefly pushed
`promote/pr-186-develop-main-auto-pr-365e02` and opened PR #205. The process was
stopped, the exact branch was deleted, and GitHub automatically closed #205;
the remote branch no longer exists. The new entry guard permanently covers
that import-time failure mode.
