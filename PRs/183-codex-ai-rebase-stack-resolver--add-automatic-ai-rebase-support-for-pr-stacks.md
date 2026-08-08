# PR #183 — Add automatic AI rebase support for PRs and stacks

- **Branch:** `codex/ai-rebase-stack-resolver` → `main`
- **PR:** https://github.com/lopugit/thingtime/pull/183

## Why this exists

GitHub can report a pull request as mergeable while still being unable to
rebase its commits. That is the failure mode behind a stopped **Rebase stack**
operation: the existing merge-based resolver may legitimately find no merge
conflict even though replaying the same branch onto its base stops. A stacked
child also has to follow its rewritten parent rather than independently merging
the parent branch.

## What changed

- A separate **Rebase PRs and stacks (AI)** workflow evaluates every
  same-repository PR regardless of base branch. It automatically owns
  standalone PRs that merge cleanly but cannot rebase plus stack members whose
  current history needs a merge or rebase update; standalone merge conflicts
  remain owned by the existing merge resolver. It
  reacts to branch pushes and PR open/reopen events, scans all open PRs twice
  per hour because GitHub emits no dedicated failed-stack-rebase event, and
  supports one-PR or repository-wide manual dispatch.
- Automatic selection walks the open PR graph from roots toward leaves. A
  blocked parent is handled first; a clean intermediate may be traversed; and
  paused, active, protected, opted-out, or not-yet-computed ancestors form
  barriers when they still require a rewrite.
- A root rebases onto the exact inspected base SHA. Each child snapshots its
  unique old merge base and later uses `rebase --onto` with the rewritten
  parent SHA, preventing duplicated parent commits.
- The merge resolver now computes stack membership before labels are added, so
  merge and rebase workflows have deterministic, disjoint ownership. Its
  `push.branches: ["**"]` detector covers PRs targeting or originating from
  every branch, not only `main`. A staggered twice-hourly sweep and blank
  manual dispatch scan every open PR, then hand off one trusted resolution run
  per conflicted base. An unchanged eligible failure adds `ai-merge-paused`,
  preventing the sweep from spending AI budget forever; the hold is tied to an
  exact bot-authored ref/SHA/topology snapshot, and a named-base manual run
  retries an unchanged hold. `no-ai-rebase` opts a merge-conflicting stack
  member back into merge-based resolution. Global scans use true GraphQL
  pagination rather than a fixed open-PR limit.
- Merge and rebase pauses now share one strict snapshot marker contract. Pause
  labels never determine current resolver ownership; owner/ref/topology changes
  invalidate the old hold, and the newly proven owner clears the opposing
  pause. A queued retry re-proves ownership and rejects a newer exact-snapshot
  hold before deletion. Publication requires pauses to be absent, while
  post-push cleanup preserves any fresh hold for the new snapshot.
  `ai-rebase-in-progress` remains the only hard cross-workflow mutex.
- Repository-wide rebaseability checks poll unknown candidates round-robin so
  one slow GitHub verdict cannot starve later PRs. Ancestor ordering and child
  cascade retain a finite loop guard, raised from eight to 64 stack levels.
- The existing resolver pins its checkout and Claude actions and disables
  checkout's global safe-directory write, removing the misleading
  `could not lock config file /dev/null` annotation from successful runs.
- Rewritten web diffs authenticated by `GITHUB_TOKEN` explicitly dispatch Web
  CI for the published SHA; ordinary PAT-authenticated pushes retain the normal
  synchronize-triggered CI path.

## Security and publication boundaries

- The model never works inside the repository. Trusted code copies only the
  exact regular conflict files into a bounded, repo-less scratch directory and
  gives Claude only Read/Edit/Write tools—no shell, Git, search, network,
  repository metadata, credentials, or trusted action implementation.
- The trusted action is copied from the exact default-branch workflow SHA and
  hash-checked around every round. It independently recomputes the conflict
  set, records configuration/security-adjacent paths for reviewer comments,
  rejects unsafe file types or modes, verifies the immutable Git/rebase state,
  scans resolved content, stages only the approved files, and continues the
  real rebase outside the model workspace. Path sensitivity is advisory rather
  than a resolution stop; executable drivers, credentials, unsafe paths,
  non-regular files, binaries, and publication capabilities remain hard
  boundaries.
- Automatic runs refuse fork heads, the default branch, protected branches,
  ambiguous child fork points, stale PR/ref metadata, and concurrent ownership.
  Failures add snapshot-bound `ai-rebase-paused`; stale snapshots recover
  automatically, while orphaned in-progress locks recover after 90 minutes
  without creating an automatic retry loop.
- Nothing reaches the remote until the complete rebase succeeds. Immediately
  before publication, the workflow rechecks the live PR, refs, SHAs, labels,
  branch protection, and current default branch. The update uses an exact
  `--force-with-lease`, then classifies the live ref as published, unchanged,
  unexpected, or unverifiable even if the client reports an ambiguous failure.
- Merge resolution now uses the same publication discipline without rewriting
  history: exact live head/base snapshots drive checkout and merge; immediately
  before the push it rechecks the PR, refs, ownership labels, stack topology,
  protection, and default branch; an exact head lease and live-ref query
  preserve concurrent work and classify ambiguous transport outcomes.
- Every rewritten commit is checked for `.github/workflows/` changes. Those
  changes require the optional `CONFLICT_RESOLVER_PAT`; the narrower
  `GITHUB_TOKEN` path is refused.

## Verification

- Ruby YAML parsing and Actionlint passed for the new workflow; structural
  Actionlint passed for both conflict workflows. The existing merge workflow
  retains only its four pre-existing ShellCheck style/informational notices.
- `bash -n` and ShellCheck passed for both trusted scripts and all five
  composite-action shell blocks. `git diff --check` passed.
- Root-order fixtures passed for a blocked chain, clean parent, direct parent
  barrier, and transitive barrier. Ownership fixtures passed for a normal
  stack, a standalone mergeable-but-unrebaseable PR, a standalone merge
  conflict, `no-ai-rebase`, and active rebase ownership; the final 12-case
  boolean truth table is mutually exclusive. Strict bot marker round-tripping
  and multi-page GraphQL aggregation fixtures passed. Repository-wide merge
  fixtures passed for standalone PRs on multiple bases, fork/clean/stack/label
  exclusions, unique per-base handoffs, round-robin verdict polling, and exact
  pre-push race refusal.
- A temporary repository built from the live PR #156 refs reproduced its four
  actual rebase conflicts. The round-preparation boundary exposed exactly
  those four regular files—no `.git`, symlink, device, repository file, or
  extra path—to the AI scratch directory.
- A temporary bare remote proved that an exact matching lease publishes, while
  a stale expected SHA fails and preserves the competing commit. No live PR
  branch was rewritten during validation.
- Graphify semantic extraction used the healthy local Codex proxy, followed by
  clustering, report generation, high-limit HTML export, hook verification,
  and union merge-driver verification.

## Rollout

The detector can validate this feature branch, but trusted dispatch runs always
load the workflow implementation from the repository default branch. Automatic
AI rebase publication therefore becomes active only after PR #183 is reviewed
and merged. The workflow should then be allowed to detect and resolve the
existing #156/#158 stack in root-to-leaf order; it does not need both resolver
actions on the same stack member.
