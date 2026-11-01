# PR #530 — Exact Feature Stack run history and terminal status

## Incident

The saved stack `Lopu auto stack merge test 1` was queued with 30 pull
requests for `main`. Its public workflow run
[`33372516606`](https://github.com/lopugit/thingtime/actions/runs/33372516606)
finished successfully, but it did not publish a target pull request.

The trusted controller validated the immutable stack plan, then GitHub skipped
the target worker because its job condition did not opt out of transitive skip
propagation. The controller correction is delivered separately in PR #529 on
the protected `github-actions` branch.

The admin page compounded the incident by associating the saved stack with a
nearby arbitrary `workflow_dispatch` run. It mixed events from different
sources without sorting their timestamps and continued to show a live status
and moving estimate after the wrapper workflow had already terminated.

## Product behavior

- Each dispatch now receives a durable Feature Stack run ID which is forwarded
  through the public listener and immutable controller plan.
- Saved stacks expose a bounded history of their own dispatches and exact
  GitHub workflow identities.
- Existing stacks are repaired through a bounded legacy reconciliation: only a
  run in the dispatch time window whose jobs include the immutable Feature
  Stack validation job may be linked.
- The live stream is sorted by its real timestamps with stable ordering for
  ties.
- A successful controller with no published target is terminal `Needs
  attention`, not perpetually live, and explains that the target worker did not
  publish a stack PR.
- A new status section links the current GitHub Actions run and every bounded
  historical run retained for that saved stack.

## Verification

- Feature Stack/GitHub client/core tests: 11/11.
- Public workflow caller contract: 6 thin listeners passed.
- Targeted ESLint: passed.
- Full Vite + Nitro production build and Vercel output verification: passed.
- Public workflow YAML parse: passed.
- Capability manifest contract updated to `api.admin-ci-feature-stacks` 1.1.0
  and covered by the capability suite.
- Graphify incremental refresh, hooks, and union merge driver: verified.

Signed-in production desktop and mobile QA is completed after the main release
and recorded in the task handoff.
