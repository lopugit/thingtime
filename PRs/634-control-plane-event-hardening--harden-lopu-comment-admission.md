# PR #634: Lopu comment admission and idempotent preview writes

## Evidence and scope

On September 4, preview comment `5541425923` on PR #610 was posted as
`lopugit` with GitHub user type `User`. Its 18:15:19Z update was followed by
issue-comment run `33904904840` at 18:15:21Z. The September 4 owner-attributed
issue-comment workflow inventory had reached 97 runs at this investigation's
read time; that count includes human events and is not a count of proven model
sessions or an invoice estimate.

Control-plane CI run `33909377070`, attempt 1, was cancelled at 19:06:34Z.
Attempt 2 completed successfully. The original workflow used one global
cancelling concurrency key for unrelated PRs.

Repairs #624, #625, and #626 merged while this follow-up was being prepared.
This branch was rebased onto `8932fb480`, including #632's native queue
coalescing and the other intervening controller fixes. Their behavior is
preserved. The follow-up improves the remaining comment paths; it does not
reimplement the concurrency queue or change repository mutation ownership.

## Behavior

- Bot and canonical marker-prefixed PAT comment events stop before runner
  allocation. Other human comments are classified by protected code, preserving
  quote replies and fenced examples that #624's broad substring gate dropped.
- Standalone legacy markers, removed markers, empty comments, and unchanged
  edits cannot wake a model. Suppression markers never grant authorization.
- Queued conversation workers re-fetch the exact comment and check its PR
  association before creating worktrees. Automated or deleted comments stop;
  malformed scopes and unreadable metadata fail closed.
- Every rebase comment path emits an unconditional automation marker. Both
  preview publishers use one bounded writer that skips identical bodies and
  never adopts human quotes as an owned status comment.
- The new regression suites run in `verify`, not only in the advisory lane.

## Validation

- 29 focused event/comment tests pass, alongside all 9 native queue tests.
- Develop preview self-test: 141/141. Admin preview self-test: pass.
- Both routing/control-plane contracts: pass. All 12 advisory contracts and
  the existing required verification checks passed locally.
- The real queued dispatch for comment `5541425923` was replayed read-only:
  `automation-marker`, `eligible=false`.
- Actionlint 1.7.12 reports only its pre-existing lack of support for the five
  `concurrency.queue: max` keys in the touched workflows. YAML parses and the
  new expressions are exercised directly by regression tests.
- Graphify's portable snapshot and local HTML are regenerated after integration.

## Rollout

Target only `github-actions`; thin listeners resolve it at runtime. No product
branch merge or application preview is needed. Controller-only heads correctly
skip product builds because they lack `remix/package.json`. Inspect CI and
naturally arriving comment events after merge. Replay tests do not establish
long-term absence of event loops.
