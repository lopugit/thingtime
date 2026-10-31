# PR #211 — Centralize Actions and add the CI control dashboard

Branch: `codex/ci-control-plane-dashboard`

## Goal

Stop workflow behavior from drifting between `main` and `develop`, while preserving GitHub's native trigger behavior and free Actions compute. Give administrators one operational view of features, branches, pull requests, runs, deployments, previews, dispatches, and their history.

## Control-plane architecture

- The protected `github-actions` branch owns all reusable workflow implementations, local composite actions, and workflow scripts.
- `main` and `develop` retain only thin native-event listeners. GitHub selects workflow definitions from particular branches for events such as `push`, `schedule`, `pull_request_target`, and `repository_dispatch`, so those listener files cannot be removed entirely.
- Each listener delegates to a reusable workflow pinned to `lopugit/thingtime/.github/workflows/<name>@github-actions` and passes inherited secrets. The caller contract rejects runner steps, shell commands, and local executable references in listeners.
- The `github-actions` ruleset blocks deletion and force pushes and requires pull requests with resolved review conversations. There are no bypass actors.
- Privileged dispatch never accepts an arbitrary code ref. Each allowlisted workflow enters through a reviewed fixed listener ref (`develop` or `main`), which then calls the protected implementation.

## Admin CI dashboard

The Admin CI tab renders cached last-known state immediately and reconciles in the background. It provides:

- integration health and repository statistics;
- searchable/filterable features and pull requests;
- branch and promotion topology;
- workflow run, deployment, and preview state;
- append-only status history;
- guarded reconcile and workflow-dispatch controls;
- a mobile bottom drawer and responsive detail view.

## Thing model

Provider state is stored as protected, non-billable control Things:

- `ci-repository`
- `ci-feature`
- `ci-branch`
- `ci-pull-request`
- `ci-workflow-run`
- `ci-deployment`
- `ci-preview`
- `ci-dispatch`
- `ci-event`

`ci-event` records are relational children linked by `parentId`; histories never grow as unbounded embedded arrays. IDs are deterministic, updates reject stale provider timestamps, and provider-owned fields cannot be replaced by dynamic payload data.

## Integrations and security

- GitHub webhook bodies are bounded and verified with HMAC-SHA256 before JSON parsing.
- Vercel webhook bodies are bounded and verified with HMAC-SHA1 before JSON parsing.
- GitHub App authentication uses short-lived installation tokens.
- Repository ingestion is allowlisted and defaults to `lopugit/thingtime`.
- Reconciliation paginates through all open pull requests and branches rather than assuming a small repository.
- Client-visible failures use fixed authored copy and never reflect raw provider exception text.
- Dispatch workflows and inputs are allowlisted, with explicit confirmation for higher-risk rebase and Electron operations.

## External bootstrap

No provider secret is committed. After this change reaches a stable deployment, configure the documented GitHub App permissions/events, Vercel webhook, and environment variables against the stable webhook endpoints. A preview URL is intentionally not the permanent callback target.

## Validation

- full Remix unit suite passed;
- CI control tests passed 6/6;
- schema tests passed 45/45;
- thin workflow caller contract passed 7/7;
- typecheck ratchet remained at the 143-error baseline;
- targeted lint passed;
- production/Vercel build and output verification passed;
- reusable workflow YAML parsed successfully;
- Graphify semantic refresh completed with zero missing, dangling, duplicate, collapsed, or self-loop edges;
- `git diff --check` passed.

## Review notes

- The thin listeners are deliberate compatibility shims, not duplicated implementations.
- Native GitHub triggers remain active so the dashboard/webhook service is an observability and recovery control plane, not a new single point of failure.
- Browser QA requiring authenticated admin state remains separate from unit/build verification and should be completed on the deployed preview or a signed-in local session.
