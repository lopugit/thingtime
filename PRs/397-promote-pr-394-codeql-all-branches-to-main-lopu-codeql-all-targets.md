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

## Default-branch listener compiler fix

Live `check_run`, comment, push, and scheduled events exposed a reusable-
workflow permission boundary that static controller tests could not exercise:
GitHub rejected the entire call before creating a job because the protected
controller's CodeQL reader/writer jobs request `security-events`, while the
thin product caller granted none. The listener now grants
`security-events: write`, which is only the caller's maximum delegation. The
controller continues to give its model-backed review job read-only access and
keeps any alert disposition in a separate fenced writer. The product caller
contract asserts this permission so a future thin-listener cleanup cannot
silently restore the startup failure.

## Single automatic Lopu entry point

The unified manager already owns merge, stale-branch, rebase, and stack
detection. Its former standalone rebase listener is retained only for the
exact internal `rebase-pr-stack-ai` worker handoff; it has no push, PR,
schedule, or manual trigger. This prevents one branch update from launching
two overlapping model-management workflows and avoids the legacy rebase run
being cancelled when Lopu's embedded rebase lane starts. Manual recovery now
uses **Lopu PR manager** with an exact PR or branch selector.
