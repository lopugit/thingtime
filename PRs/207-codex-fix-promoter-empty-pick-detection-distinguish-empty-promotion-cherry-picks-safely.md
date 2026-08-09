# PR #207 — Distinguish empty promotion cherry-picks safely

## Incident

After PR #206 merged into `develop`, **Promote features to main** run
`31311361586` failed in its orphaned-history self-test. The expected tree
`8d4b79974d19b99de43aed745258ccc5c9e8740e` contained the recovered feature;
the actual tree `4b36dfd79db36d8c59d1fb032de66b57f0457b65` contained only the target base.

The fresh fixture clone did not configure a Git author identity. On the Ubuntu
runner, the mainline cherry-pick therefore stopped with `fatal: empty ident
name` after staging the recovered feature. The promoter's broad
`/empty|nothing to commit/` heuristic mistook that operational error for an
empty patch, ran `git cherry-pick --skip`, discarded the staged source change,
and incorrectly returned success. Git 2.51 and 2.54 reproduce the same state;
the regression was not caused by object hydration or a Git-version change.

## Repair

- Give the isolated fixture clone its own deterministic test identity.
- Treat a failed pick as genuinely empty only when `CHERRY_PICK_HEAD` exists
  and both the staged and tracked worktree diffs are clean.
- Abort and return the original operational failure whenever intended changes
  remain staged or in the worktree.
- Keep unmerged paths classified separately as real conflicts.
- Cover both the blank-identity failure and a genuinely empty repeat pick with
  real-Git integration assertions, including clean abort state.

## Verification

- Node syntax check.
- Promoter self-test with normal local configuration.
- Promoter self-test with an explicitly blank global Git author name.
- Workflow YAML parse and `git diff --check`.
- Live no-write scan of 14 eligible merged `develop` PRs; it continued through
  all independent groups, emitted the complete summary, and exited zero.
- Graphify semantic refresh and multigraph diagnosis with no missing,
  dangling, self-loop, duplicate, or collapsed edges.
- Independent code review found no P0, P1, or P2 issue.

