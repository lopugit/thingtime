# PR #642: Discoverable preview status and missed-build repair

## Evidence and cause

PR #596's current head `3a3e4d8fe611170037de89ad8642ed01557c200c` already
had a successful preview comment (`5523959998`), updated in place at
2026-09-05 07:25 UTC. Its original timeline position made it hard to find.
Vercel deployment `dpl_35eNyf8BHK8NLXdyaj2EH4jWzHCD` is READY for that exact
SHA/ref; both its immutable URL and `pr-596.previews.dev.thingtime.com` returned
HTTP 200. This differs from #611's previously repaired comment-permission 403.

The scheduled controller previously enumerated only Vercel-owned deployments.
A missed event or failure before creation therefore could never be recovered.
One failure also aborted the remaining PR sweep. An initial comment failure
could prevent the build plan, and an admin comment failure could poison its
serialized writer for every later phase.

## Changes

- PR-scoped last-success labels use actual Vercel READY timestamps, Melbourne
  DST-aware time, and separate admin environment lanes. Current status is
  independent; failure/removal preserves history. Foreign labels are untouched.
- Comment and label retries reread ownership after uncertain writes. Initial
  notification failures no longer prevent secretless builds, independent label
  writes still run, and final incomplete publication remains a visible error.
- The existing six-hour scheduled controller now visits open PRs with no Vercel
  objects, restores verified READY receipts without rebuilding, and requests
  missing builds through the normal exact-SHA unprivileged path. Native active
  queues and active Vercel deployments are left alone. One PR's failure does not
  prevent the others' inspection.
- Recovery dispatches are Actions-bot authored and bound to this repository's
  fixed default-branch scheduled workflow. Durable per-SHA deployment receipts
  precede dispatch, impose a 30-minute cooldown, and stop at three attempts.
  The sweep never fabricates backend admin policy selections.

## Validation and rollout

All 125 Node tests passed, including uncertain accepted writes, DST/midnight,
multi-environment independence, stale heads, shared-label ownership, cleanup,
source provenance, native queue failure handling, and retry exhaustion.
Develop self-tests passed 146/146; admin, workflow and routing contracts passed.
Both changed YAML files parse and `git diff --check` is clean.

Merge only into `github-actions`. Then rerun #596, verify the same comment ID,
exact head and both URLs, confirm its label retains the original READY time,
and run the scheduled recovery sweep. Record live receipts in the PR timeline;
local tests are not a substitute for those rollout checks. Controller-only
branches intentionally have no app preview.

The separately requested missing-build wildcard page is a follow-up: this PR
does not change the existing wildcard fallback routing.
