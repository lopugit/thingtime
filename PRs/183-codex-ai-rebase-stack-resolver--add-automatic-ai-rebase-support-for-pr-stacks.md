# PR #183 — Add automatic AI rebase support for PR stacks

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

- A separate **Rebase PR stacks (AI)** workflow detects same-repository PRs
  whose `rebaseable` state is false. It reacts to branch pushes and PR
  open/reopen events, scans twice per hour because GitHub emits no dedicated
  failed-stack-rebase event, and supports deliberate manual dispatch.
- Automatic selection walks the open PR graph from roots toward leaves. A
  blocked parent is handled first; a clean intermediate may be traversed; and
  paused, active, protected, opted-out, or not-yet-computed ancestors form
  barriers when they still require a rewrite.
- A root rebases onto the exact inspected base SHA. Each child snapshots its
  unique old merge base and later uses `rebase --onto` with the rewritten
  parent SHA, preventing duplicated parent commits.
- The merge resolver now computes stack membership before labels are added, so
  merge and rebase workflows have deterministic, disjoint ownership.
  `no-ai-rebase` opts a stack member back into merge-based resolution.
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
  set, rejects sensitive paths and unsafe file types or modes, verifies the
  immutable Git/rebase state, scans resolved content, stages only the approved
  files, and continues the real rebase outside the model workspace.
- Automatic runs refuse fork heads, the default branch, protected branches,
  ambiguous child fork points, stale PR/ref metadata, and concurrent ownership.
  Failures add `ai-rebase-paused`; orphaned in-progress locks can recover after
  90 minutes without creating an automatic retry loop.
- Nothing reaches the remote until the complete rebase succeeds. Immediately
  before publication, the workflow rechecks the live PR, refs, SHAs, labels,
  branch protection, and current default branch. The update uses an exact
  `--force-with-lease`, then classifies the live ref as published, unchanged,
  unexpected, or unverifiable even if the client reports an ambiguous failure.
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
  stack plus standalone PR, `no-ai-rebase`, and active rebase ownership.
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
