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

## Live bootstrap prepared

- Stable GitHub and Vercel webhook endpoints are deployed at `dev.thingtime.com`.
- Project-scoped Vercel deployment webhook and protected preview/production environment entries are prepared.
- The GitHub repository has the signed router secret and stable router URL configured.
- Readiness is computed once on the server and shared by routing, policy writes,
  and Admin UI. Partial configuration cannot be labelled ready or selected
  through a direct API request.
- GitHub App creation/installation and the first authenticated Reconcile remain the final external bootstrap steps.

## Validation

- targeted Remix lint passed;
- CI control tests passed 16/16, including complete/partial readiness and
  Vercel runner identity/job-summary coverage;
- the aggregate unit suite passed, including 16/16 CI-control tests and the
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
