# PR #397 — Lopu CodeQL for every PR target

## Why this promotion needed a second review

An unfiltered `pull_request` trigger is not sufficient for a PR whose target
branch predates `.github/workflows/codeql-analysis.yml`: GitHub resolves that
event against the PR merge ref, so the target must already carry the listener.
Thingtime has long-lived feature and stack branches that do not.

## Final design

- The normal `pull_request` path remains the owner when the target already
  carries the listener, preserving its branch-protection job contexts.
- The copy on the default branch also receives `pull_request_target` lifecycle
  events for every PR target.
- That privileged run never checks out or analyzes repository code and receives
  no AI credential. The protected `github-actions` worker validates the event
  PR number and immutable head SHA, then starts a separate default-branch
  `workflow_dispatch` run.
- The dispatched run re-reads the live PR, rejects a stale or closed request,
  checks whether both CodeQL language categories already exist for the exact
  selected revision, and otherwise analyzes the PR merge ref with explicit
  ref/SHA upload metadata. The merge commit's parents must equal the current
  base and head; a conflicting PR with a missing or stale merge ref uses
  `refs/pull/<number>/head` while Lopu resolves its branch.
- `CODEQL_CENTRAL_PR_ENABLED` gates the target-context handoff independently of
  `CODEQL_ADVANCED_ENABLED`, preserving the ordered migration from GitHub
  default setup without a coverage gap.

## Activation order

1. Merge the protected worker/queue PR #396.
2. Merge this listener promotion.
3. Set `CODEQL_CENTRAL_PR_ENABLED=true`.
4. Disable GitHub CodeQL default setup.
5. Set `CODEQL_ADVANCED_ENABLED=true` and verify a normal target plus an older
   feature/stack target.

## Verification

The executable contract must prove that the target-context block is
metadata-only and that checkout/CodeQL steps are excluded from that event. The
product caller contract must prove that all target lifecycle events reach the
single protected reusable implementation and that only the two bounded inputs
are forwarded.
