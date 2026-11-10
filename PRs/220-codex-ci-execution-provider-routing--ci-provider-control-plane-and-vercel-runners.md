# PR #220 — CI provider control plane and Vercel runners

Branch: `codex/ci-execution-provider-routing`

## Goal

Let administrators choose, per supported automation, whether work runs on GitHub-hosted Actions or on ephemeral Vercel compute without duplicating workflow behavior or weakening the protected `github-actions` control plane.

## Execution architecture

- Native GitHub event listeners stay deliberately thin and call the protected provider router on `github-actions`.
- The router sends a bounded, signed, idempotent request to Thingtime.
- A GitHub selection continues on the ordinary GitHub-hosted runner.
- A Vercel selection starts a durable Vercel Workflow, creates one ephemeral Vercel Sandbox, registers it as a uniquely labelled GitHub self-hosted runner, and dispatches the same reviewed reusable workflow to that exact label.
- Runner registration is short-lived and cleanup runs after success, failure, cancellation, or timeout.
- Router/setup outages fail open to GitHub-hosted compute. If Vercel fails after the original GitHub trigger has exited, the durable workflow dispatches the same protected workflow back to GitHub-hosted compute and records that fallback.
- Web CI and Electron release remain GitHub-only because their Docker MongoDB and native-platform requirements are not safely portable to the initial Sandbox runner.

## Admin controls and state

- The Admin CI Control tab now exposes execution-provider controls for supported automations.
- Provider policy is stored as a protected, non-billable `ci-automation-policy` Thing.
- Changes append relational `ci-event` children so status history is bounded and auditable.
- The dashboard renders an explicit setup/reconcile empty state instead of a silent zero-state.
- Dispatch, reconciliation, provider routing, runner startup, cleanup, and fallback events appear in the existing feature/run history model.

## Security boundaries

- Provider requests use HMAC-SHA256 over bounded raw request bodies and reject stale timestamps or replayed request IDs.
- Workflow names, provider names, repository identity, event kinds, and executable refs are allowlisted.
- Feature branches cannot select executable workflow YAML; reusable implementations remain pinned to the protected `github-actions` branch.
- GitHub App installation tokens are short-lived, and ephemeral runners are registered for one exact job label.
- No provider credential or webhook secret is committed.

## Live bootstrap and acceptance completed — 2026-08-10

- The `Thingtime CI Control` GitHub App (App ID `4546468`, installation ID
  `152644267`) is installed only on `lopugit/thingtime`. It has the bounded
  Actions/Administration write and Contents/Deployments/Metadata/Pull requests
  read permissions required by routing, runner registration, reconciliation,
  and cleanup.
- Production, `develop` preview, and this PR's preview have the App identity,
  private key, signed GitHub webhook secret, and shared provider-router secret
  configured in Vercel. The repository carries the matching router secret and
  stable router URL; no credential value is committed or recorded here.
- Credentialed deployment `dpl_BHkHgofhf8i9WMYvuxvM9kwE4KLW` reached READY
  at `thingtime-dzafldfdg-lopugits-projects.vercel.app` and the stable branch
  preview alias serves HTTP 200.
- The first real route, [run 31388001114](https://github.com/lopugit/thingtime/actions/runs/31388001114),
  reached Vercel but proved GitHub's universal runner archive still needed its
  version-matched ICU dependencies. The durable Workflow safely fell back via
  the App-authored [run 31388082177](https://github.com/lopugit/thingtime/actions/runs/31388082177).
  The exact provisional GitHub runner and Sandbox left by the pre-handle
  failure were removed after diagnosis.
- The second real route, [run 31389237667](https://github.com/lopugit/thingtime/actions/runs/31389237667),
  registered a uniquely labelled online runner and created App-authored
  [run 31389299848](https://github.com/lopugit/thingtime/actions/runs/31389299848).
  That runner exposed one more universal-image assumption: `/proc/self/fd`
  existed but the conventional `/dev/fd` link required by Bash process
  substitution did not. The failed job still removed its GitHub registration
  and Sandbox automatically.
- The final canary, [run 31389760018](https://github.com/lopugit/thingtime/actions/runs/31389760018),
  routed through Vercel; registered runner
  `thingtime-vercel-3a334083c40ef2fb9252f1d3a483`; re-entered the protected
  workflow as `thingtime-ci-control[bot]` in
  [run 31389810843](https://github.com/lopugit/thingtime/actions/runs/31389810843);
  executed the exact PR #220 detector successfully; and then removed both the
  GitHub runner registration and the exact Sandbox. Post-run API checks found
  neither resource.
- Admin → CI Control was reconciled and visually accepted in authenticated
  Chrome at desktop and 375 px mobile widths. Readiness badges, provider
  selection/persistence, PR detail panel/mobile drawer, dispatch confirmation,
  top-to-bottom scrolling, and horizontal-overflow checks all passed.
- `THINGTIME_CI_ROUTER_URL` was restored to the stable
  `https://dev.thingtime.com/api/v1/integrations/ci/route`. Because that route
  correctly remains unavailable until this PR reaches `develop`, the live
  Resolve-conflicts policy was returned to GitHub-hosted compute after the
  canary. It can be switched to Vercel again after the merged `develop`
  deployment exposes the route.

## Validation

- targeted Remix lint passed;
- CI control tests passed 19/19, including complete/partial readiness, runner
  identity/job summaries, version-matched dependency bootstrap, `/dev/fd`
  compatibility, and fail-closed setup coverage;
- the aggregate unit suite passed, including 19/19 CI-control tests and the
  seven-listener protected-control-plane contract; the redundant
  product-branch copy of `.github/scripts/deploy-develop-pr-preview.mjs` was
  removed because the listener already checks out its trusted controller from
  `main` before execution;
- typecheck ratchet remains warning-only at 145 errors versus the inherited
  143-error baseline; none of the reported errors is in this readiness patch;
- production/Vercel build and output verification passed;
- durable workflow compilation produced 79 steps and one workflow;
- Graphify semantic refresh completed with zero missing, dangling, duplicate,
  or collapsed edges; the one pre-existing
  `remix/app/routes.tsx` self-loop is unchanged from the branch baseline;
- `git diff --check` passed.

## Review notes

- Vercel Sandbox is used as ephemeral self-hosted runner infrastructure; GitHub still performs event delivery, workflow orchestration, checks, and comments.
- GitHub does not bill GitHub-hosted runner minutes for self-hosted execution, while the Vercel Sandbox usage remains subject to the Vercel account's compute billing.
- The GitHub fallback is intentional availability protection and preserves the existing reviewed workflow rather than maintaining a second implementation.
