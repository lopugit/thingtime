# PR 1216 — browser device folder sync

[Pull request](https://github.com/lopugit/thingtime/pull/1216) ·
`codex/browser-device-folder-sync` → `develop`

## Behavior

The owned-device sync page now offers management in an ordinary signed-in
browser, without local Electron availability or local pairing. Existing private
connection settings remain editable while the target device is offline. New
folder bindings require a current device response.

Live folder selection/removal, transfer start/pause, automatic intervals,
conflict review, recoverable files/versions, progress hierarchy, backup coverage
and upload priorities use a high-level account control channel. The target app
keeps the actual grants, transfers, local journals and scheduler. Native pickers
and OS permission dialogs still run there. Remote management uses editable
settings blocks and shared configuration/progress/recovery components.

The protected Home-plane API checks the full account, owned pairing and origin.
Requests have stable identities, immutable payloads, a single atomic claim,
lease-bound completion and short retention. Pairing changes invalidate old
requests. Scoped tokens, Characters and synthetic Action callers cannot dispatch
controls. The worker reauthorizes native identity and exact saved connection
revisions. Browser mutations retain uncertain receipts across reloads; Pause has
an independent receipt and remains available during an unacknowledged Start.

## Verification

- Device, file-sync and capability suites pass. Added checks cover the command
  allowlist, owner/device boundaries, stale settings/reviews, request replay,
  revocation, pagination, remote journal selectors and priority revision checks.
- The browser harness passes in React StrictMode at 1440×1000 and 390×844,
  with no native bridge or local pairing. It verifies offline editing/reload,
  wrong-owner/device filtering, visible command failure, start/pause/intervals,
  current-root verification for new connections, preserved stale-save drafts,
  upload priorities without browser-local sync journals, and viewport overflow.
  A held Start acknowledgment explicitly proves Pause finishes first and a late
  acknowledgment cannot restart the paused task.
- The compiled Nitro endpoint passes with a disposable Mongo 8.0 replica:
  canonical synthetic signup and signed pairing, JSON routing/discovery,
  unauthenticated/foreign refusal, eight competing claims with one winner,
  lease refusal, immutable completion/replay, concurrent queue admission,
  protected-kind write refusal and disconnect fencing. No production accounts,
  credentials or database are used. The reproducible harness is documented in
  [browser device sync](../docs/browser-device-sync.md).
- Production client and server builds pass. Changed-file ESLint has no errors;
  existing shared-component/schema warnings remain. Repository-wide TypeScript
  retains existing unrelated diagnostics; no changed-file errors remain.

## Remaining acceptance

The cloud workspace cannot verify the installed Mac's signed app, native folder
and recovery dialogs, OS permissions, window-close behavior or a live transfer
from another computer. An updated installed app must run the new worker before
browser live controls can work. The PR remains draft for that acceptance and
normal review; it has not been merged or deployed to production.

Graphify structural output is refreshed using the repository wrapper. A local
Codex semantic extraction service is not configured in this cloud workspace;
documentation semantic freshness is not claimed.
