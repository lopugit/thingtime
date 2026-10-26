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
`browser-device-folder-sync-mac` worktree. The signed app is installed and its
existing session is preserved. Native folder selection now passes: the actual
macOS chooser granted only the synthetic two-file fixture. Home remains paused
with its source grant absent. Browser-to-device start/pause, transferred bytes,
recovery and window-close behavior remain open; a private browser/backend
harness is being used for those checks. This PR has not been merged or deployed
to production.

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

### Installed acceptance recovery — 2026-10-25

- Native Computer Use recovered after cancelling a stuck application menu.
  Selecting the embedded Node helper exposed the real macOS folder chooser;
  selecting the exact synthetic fixture produced a visible native grant.
  The earlier timeout did not justify changing the picker implementation.
- Personal Chrome could not reliably retain the assigned window across actions.
  Task-created blank tabs were closed, with existing tabs and sessions preserved.
  The [private installed acceptance harness](../docs/installed-sync-acceptance.md)
  instead keeps a task-owned browser and real backend in one network-isolated
  container and exposes only a loopback relay to the installed signed app.
- Full Electron suite: 331 tests passed, none failed or skipped. New regressions
  cover exact loopback authority selection, lease/Host fencing and private bounded
  failure diagnostics. These tests do not establish installed transfer success.
- The immutable test image built successfully after non-destructively growing
  the dedicated test VM disk. Existing images and unrelated runtimes were kept.
- Real startup exposed a second acceptance-runtime bug: packaged Mac output
  exports Nitro `node_middleware` and does not listen when executed directly.
  The isolated runtime now reuses the installed app's canonical
  `renderer-server.cjs` listener. A real HTTP regression checks health, assets
  and error redaction for that export shape; the installed app itself did not
  require a speculative rebuild.
- The corrected immutable image started the actual packaged backend and
  rendered client. Its browser and backend share a private loopback authority;
  container preflight confirmed no external routes and IPv4/IPv6 egress refusal.
  The packaging regression also checks that every local Docker COPY source is
  staged and allowlisted. Thirteen focused acceptance tests passed after that
  packaging correction. This establishes harness readiness, not native transfer
  acceptance.
- Published head `f38af78b4ff8775908ae695e2291d8dadba2f82d` passed web/API,
  CodeQL, secret-scanning and preview checks. Subsequent acceptance-tooling work
  requires its own pushed-head checks before delivery.

Graphify refresh and the remaining installed acceptance evidence are tracked
separately from the historical browser/compiled-server harness results above.

### Acceptance viewer helper — 2026-10-26

- Added an opt-in, test-only Electron viewer for the already-running isolated
  acceptance browser. It is fenced to the task/session/lease and loopback
  acceptance origin; it adds no new listener and does not launch or modify the
  production app.
- The focused viewer boundary suite passed 12/12, including the real browser
  manager/lease/dispatch/driver contracts with native I/O stubbed. Syntax and
  diff checks passed. These checks verify the helper boundary, not its rendered
  GUI, password-manager flow, account sign-in or installed sync behavior.
- The isolated Docker relay had already passed network-none readiness. It was
  stopped and its descriptor and lease removed. No new pairing or transfer was
  performed. Existing user approval for native pairing remains in force.
- Native controls recovered to Production settings after the restart, but the
  final Home pause view was not re-read. The last verified Home state remains
  paused with its source grant absent; no settings were changed during cleanup.
- Actual GUI inspection/sign-in, installed start/pause/resume, transferred
  bytes, recovery and window-close behavior remain incomplete and unverified.
