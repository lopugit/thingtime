# PR #550 — Saved Feature Stack run controls

## Outcome

Admin CI Control now gives each saved Feature Stack explicit **Pause**, **Stop**,
and **Restart** controls. Pause and Stop cancel only the exact linked GitHub
Actions run and retain the reusable stack definition plus bounded run history.
Restart cancels active compute first, then creates a new immutable run identity
and dispatch record.

## Safety contract

- Lifecycle mutations remain behind the existing admin-session gate.
- Cancellation requires the exact durable `workflowRunId`; the server refuses
  to guess from timestamps while a link is pending.
- A workflow that finishes during the cancellation race is accepted only after
  a second GitHub status read proves it is terminal.
- Late workflow webhooks and signed progress receipts cannot overwrite a
  deliberate `paused` or `stopped` root state.
- Editing a saved definition preserves its lifecycle state. Ordinary Run is
  rejected for paused/stopped stacks; Restart is the explicit resume path.

## Contract and UI

- `api.admin-ci-feature-stacks` advances from `1.2.0` to `1.3.0` for the
  additive lifecycle actions.
- Saved-stack cards expose labelled controls with mobile wrapping, busy states,
  and confirmations for Stop and active-run Restart.
- Target badges show the held stack state instead of stale target progress.

## Verification

- CI-control unit suite: 51 passed.
- Thingtime capability-manifest contract: 2 passed.
- Typecheck-ratchet tests: 3 passed.
- Targeted ESLint: passed.
- Production client/server build and Vercel output verification: passed.

