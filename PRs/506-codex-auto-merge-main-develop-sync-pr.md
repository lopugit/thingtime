# PR #506 — Auto-merge resolved main to develop sync PR

## Problem

The standing `sync/main-into-develop` PR was refreshed and conflict-resolved,
but nothing terminally merged it into `develop`. GitHub native auto-merge could
not fill that gap because the API refuses to arm it while `develop` has no
protected-branch rule.

## Resolution

- Added one trusted terminal merger shared by the clean synchronization lane
  and the Lopu conflict resolver.
- Fenced the mutation to the exact Thingtime repository, PR number,
  `sync/main-into-develop` head, `develop` base, expected head/main/develop
  SHAs, and proof that the published head contains live `main`.
- Used GitHub's exact-head REST merge and verified afterward that the resulting
  live `develop` contains the expected `main` commit.
- Made moving refs, remaining conflicts, GitHub mergeability calculation, and
  stale candidates defer safely to a later Lopu pass.
- Added required self-tests plus control-plane and resolver-routing contracts.

## Validation

- Required control-plane JavaScript, shell, Graphify, status-rendering,
  all-branch, credential-classifier, and Electron release checks passed.
- Advisory preview, workflow, resolver, rebase, promotion, changelog, and
  feature-promoter contracts passed.
- Every workflow YAML file parsed successfully.
- Semantic Graphify extraction used the healthy local Codex proxy; the final
  structural refresh and immutable snapshot were committed separately.

## Operational proof gate

After this PR lands on `github-actions`, dispatch PR #475 through the protected
Lopu entrypoint. Completion requires the new resolver run to publish and merge
the standing PR, followed by a live GitHub ancestry check proving current
`main` is contained by `develop`.
