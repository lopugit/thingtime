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

Installed-Mac acceptance remains incomplete in the dedicated
`browser-device-folder-sync-mac` worktree. The signed app is installed, its
existing session is preserved, and a native source-choice prompt was observed.
Folder selection then hit native-control timeouts; browser sign-in could not
be completed through the available controls. No test folder was granted and no
test transfer occurred. Browser-to-device start/pause, transferred bytes,
recovery and window-close behavior remain open. This PR has not been merged or
deployed to production.

### Local Mac follow-up — 2026-10-25

- Fixed a native-only blocker: the desktop host's capability projection omitted
  `api.devices-sync-control`, so the installed worker rejected a compatible
  server before polling. The regression exercises `readCapabilities` through
  `DesktopFolderSync`, including invalid versions and foreign origins.
- Repaired the canonical desktop build order: Remix dependencies are checked
  before staging mail/database resources. A fresh worktree had failed with
  unresolved `imapflow`, `mailparser` and `ipaddr.js` before reaching the old
  dependency check.
- Native host tests: 38 passed. Full Electron tests: 326 passed, none skipped.
  The actual host capability reader accepts sync-control 1.0.0 from the PR
  preview. Production currently lacks that feature; this is not a production
  acceptance result.
- Before installation, the existing Mac UI confirmed the home source grant is
  absent and automatic home sync is paused. Only a new synthetic two-file,
  2 MiB folder is eligible for this acceptance run; personal backup data and
  recordings remain untouched.
- The canonical signed build and rollback-safe local installer passed. The
  installed `~/Applications/Thingtime.app` verifies with Developer ID Application
  signing, team `6DQQ9V7C84`, and the same designated requirement as the previous
  installation. The existing signed-in session survived. Installation initially
  refused a still-exiting process; after its exit, the retry passed.
- Preview endpoint selection restarted the app, but native control exposed no
  window even though its backend was healthy. Rebinding controls and reopening
  the exact installed bundle did not resolve that observation. Production was
  restored through the canonical settings store, preserving all other settings,
  sessions, grants and pairing. Its window reopened normally; the home backup
  was again visibly paused with its source grant absent. This does not yet prove
  either an application visibility defect or a control-tool defect.
- The native source-choice prompt belongs to the embedded Thingtime Node app;
  selecting its exact bundle exposed it even when general app inventory omitted
  the helper. After selecting Existing folder, native control timed out through
  a fresh observation and handle recovery. The request cancelled, Choose folder
  became available again, and no grant or connection was created. The final
  installed Production UI still showed the preserved session and paused Home
  backup with missing source access. Task-created Chrome and Finder tabs were
  closed; unrelated tabs were preserved.
- Local evidence: `/tmp/pr1216-installed-acceptance.json`,
  `/tmp/pr1216-signed-build.log`, `/tmp/pr1216-install-retry.log` and
  `/tmp/pr1216-electron-tests.log`. These distinguish actual installed results
  from the existing synthetic browser/server harness evidence.

Graphify refresh and the remaining installed acceptance evidence are tracked
separately from the historical browser/compiled-server harness results above.
