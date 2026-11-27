# PR #1070 — Lopu defaults and per-chat AI credentials

PR: https://github.com/lopugit/thingtime/pull/1070
Branch: `codex/lopu-credential-selection` → `develop`

## Behavior

Lopu settings choose the AI credential, model, effort and speed for new chats.
Defaults are scoped to the account on this device. Each chat's settings menu
independently selects Thingtime credits or one of the user's saved credentials,
including ChatGPT plan connections. The selected connection supplies its model
and endpoint through the existing secure connection settings.

Saved chat choices persist through the chat API. Pending changes finish saving
before sending; failed saves prevent sending. Missing connections remain pinned
as unavailable rather than silently charging credits. Cold deep links, legacy
chats, background replies and account changes retain their own routing.

Visible controls are ordinary editable Thingtime blocks. Labels, inputs and
repeated choices remain separately editable; runtime account data is transient.

## Verification — 20 October 2026

- 391 focused tests passed: Lopu UI 246, settings 55, ChatGPT plan 8 and
  chat streaming 82.
- 102 capability tests passed after integration.
- Production build and Vercel output verification passed.
- Isolated Chromium acceptance at 1440px and 390px passed: defaults and chat
  selection, independent backend readback, reload, popup overflow/scroll,
  nested Builder label and control edits, save/reload and subsequent actions.
  Browser and synthetic HTTP backend ran inside a kernel-network-isolated
  container without real credentials. The task container was released.
- Lint had no errors and one existing recovery-loop warning. The typecheck
  ratchet reported 92 diagnostics against the 89 baseline; none were in the
  changed feature implementation.

## Integration and remaining acceptance

The feature builds on main's merged ChatGPT runtime and editable settings
framework (#1034). Develop still lacks that ancestry, so the PR comparison
includes prerequisite changes already on main. Commit `400811850` contains the
16-file feature change; graph snapshots are separate. Integrating develop
retained the tested source.

A real reply using the new selector and a saved ChatGPT connection on the
intended installed runtime remains pending. Synthetic acceptance is not native
or production acceptance. No installed app was replaced. The OAuth endpoint
stays bound to its supported connection/runtime; tokens are not forwarded to
an arbitrary URL.

Structural Graphify output was refreshed. Some semantic extraction chunks
returned hollow responses, so documentation semantic coverage remains partial;
the final incremental refresh uses the structural fallback.
