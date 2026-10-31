# PR #428 — Activate every Lopu PR signal on main

## Goal

Make the default-branch listener match the protected Lopu controller so PR
lifecycle changes and first-party CI failures are handled immediately, while
retiring the last competing wildcard-union listener.

## Changes

- Added the missing PR synchronize/draft/edit/close signals, the hourly
  wildcard-union backstop, and explicit build-all/CodeQL-backfill maintenance
  inputs to the default-branch **Lopu PR manager** listener.
- Added a bounded `workflow_run` list for PR-associated first-party CI failures;
  Lopu excludes its own workflow so failed repair attempts cannot recurse.
- Removed `.github/workflows/all-branch.yml` from the product branch. Union
  rebuild signals now enter Lopu's protected `lopu-maintenance-build-all`
  namespace, which preserves an active build and coalesces obsolete pending
  snapshots.
- Extended the workflow-caller contract and manual checklist so reintroducing a
  public **Build all branch** listener fails validation.

## Evidence

Before the retirement commit, two separate **Build all branch** runs remained
pending on this PR in addition to the Lopu manager run. The repository rulesets
do not require that standalone workflow context; Web CI and CodeQL remain the
required checks on the default branch.

## Verification

- `node remix/scripts/workflow-caller-contract.mjs`
- YAML parse of `.github/workflows/resolve-pr-conflicts.yml`
- `git diff --check`
- Graphify semantic extraction through the local Codex proxy, followed by
  cluster/report/HTML regeneration with the raised visualization limit
- Graphify hook and `graphify-out/graph.json` merge-driver checks

## Rollout

Merge PR #429 first so the protected controller can route and coalesce the new
listener signals. Merge this PR second. The standing main-to-develop sync then
carries the retired-listener deletion to `develop`; Lopu remains the sole public
repository-management entrypoint.
