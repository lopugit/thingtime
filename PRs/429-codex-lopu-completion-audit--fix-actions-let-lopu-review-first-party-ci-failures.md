# PR #429 — Let Lopu review first-party CI failures

## Goal

Complete Lopu's principal-repository-manager loop for failing GitHub Actions
checks while preserving one non-cancelling repository-wide agent queue.

## Changes

- Added a bounded `workflow_run` route for PR-associated first-party CI
  failures that GitHub does not surface through `check_run` events.
- Bound the exact originating workflow-run id into the review handoff so Lopu
  reads authoritative jobs and logs before changing a PR or the controller.
- Added exact-scope handoff coalescing: duplicate unstarted review sessions are
  skipped, while an active review may retain one newest waiter.
- Kept conflict/stale-branch ownership out of the CI-review route so the merge
  and rebase lanes remain mutually exclusive.
- Enforced the live CodeQL dismissal-comment limit of 280 characters in both
  the model contract and isolated trusted writer.
- Accepted GitHub's transient `state: null` alert shape only when the exact
  newest instance is still open with no dismissal or fix timestamp, and
  repeated that exact-instance check immediately before mutation.

## Live evidence

- Two #429 detector events originally queued equivalent unstarted review
  sessions. The new exact-title admission check retains the first and skips the
  duplicate without interrupting an active review.
- GitHub rejected a 487-character CodeQL evidence comment. The validator now
  caps comments at the documented API boundary; alert #92 was then revalidated
  against the live #429 merge ref and dismissed as a false positive with a
  217-character evidence comment.
- The current #429 CodeQL Actions and JavaScript/TypeScript analyses are green.

## Verification

- Workflow YAML parse
- `node .github/scripts/resolve-pr-conflicts-routing-contract.mjs --self-test`
- `node .github/scripts/workflow-control-plane-contract.mjs --self-test`
- `node .github/scripts/promotion-worker-routing-contract.mjs --self-test`
- `bash .github/scripts/promotion-worker-contract.sh`
- `bash .github/scripts/rebase-ownership-routing-contract.sh`
- Build-all, CodeQL-backfill, and Claude credential-failure self-tests
- `git diff --check`

## Rollout

Merge this PR into `github-actions` before PR #428. The protected controller is
then ready when #428 activates the complete default-branch event listener and
retires the final standalone **Build all branch** product listener.
