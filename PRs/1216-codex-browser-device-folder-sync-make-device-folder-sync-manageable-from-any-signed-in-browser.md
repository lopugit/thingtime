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

### Installed pairing correction — 2026-10-26

The installed test reproduced `The pairing capabilities are invalid` after
native approval. A read-only projection of the disposable backend confirmed
server preparation without a consumed claim. The native helper's normalization
still allowed only 64 entries, while the Mac can advertise 65 and the server
already permits 128. Native normalization now uses the same 128-entry bound.
Focused Swift validation passed 34 tests, including signature verification for
65 capabilities and rejection of 129 entries and malformed identifiers.

Production was restored and the existing Home job was directly verified paused
with its missing folder grant, draft and priorities preserved. Rebuilt installed
pairing, real transfer hashes, pause/recovery and window-close acceptance remain
pending; no transferred-byte result is claimed by these regression tests.

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
- The focused viewer boundary suite now passes 11/11, including the real browser
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

### Installed acceptance continuation — 2026-10-26

- Fixed the test viewer's Electron entry point: Electron 43 owns `require.main`,
  so the Node-only entry check never opened the GUI. The explicit script check
  now launches the actual viewer while ordinary imports remain inert. All 11
  focused tests pass, including the new entry-point regression.
- The actual viewer rendered its bound isolated tab and completed full-account
  registration for the disposable identity through masked credential entry.
  The credential came from the saved on-device password-manager entry; no
  credential was placed in command arguments, logs or task records.
- Raising the exact installed window restored responsive native controls. The
  Production Home view was directly confirmed paused with its source grant
  missing before switching to the isolated acceptance endpoint. Native pairing,
  transfer hashes, recovery and window-close behavior still require evidence.
- Published head `6b0ce35a9344b050ef40853b1ac5da42d1453e90` passed build,
  typecheck, unit/API, CodeQL, GitGuardian and Vercel checks. Its separate
  merge-conflict sweep failed with a GitHub installation API rate-limit 403;
  that is an automation access failure, not a failing feature assertion.

### Real native pairing and upload refusal — 2026-10-26

- Signed source `50fe2d907978d0258d6062324d4a1684054e46c8` is installed at
  `~/Applications/Thingtime.app`. Strict/deep signature verification, helper
  source SHA and unchanged designated requirement passed. Swift: 239 tests,
  2 skipped, 0 failures. The 128-capability correction fixed the real native
  pairing failure for this Mac's 65-capability claim.
- The installed app paired the approved disposable full account. Native picker
  grants were restricted to the synthetic fixture; the isolated browser saw the
  actual Mac online and its saved connection. Native Start created a nested
  directory, then failed with HTTP 403: **zero of two files and zero file bytes
  were confirmed uploaded**. Source hashes alone are not transfer evidence.
- Native Pause worked. Closing and reopening the installed window preserved the
  pairing, fixture grant, paused connection and failed journal. This verifies
  paused-state recovery only, not active-transfer or browser-close continuity.
- Authenticated canonical `/api/v1/auth/me` returned the expected full user with
  private and public uploads disabled. This is a definite fixture eligibility
  gap; the original generic 403 did not identify its exact endpoint/reason.
  No upload gate, credential boundary or account data was bypassed. Positive
  tests need a normally approved disposable account; the existing runtime cannot
  safely restart only its API to bootstrap one.
- Cloud transport now retains only allowlisted operation/policy refusal codes,
  never arbitrary response text. All 39 transport tests passed. The viewer now
  reports fixed operation/stage/code diagnostics and retries only an explicit
  page-context failure in the read-only tabs preflight, once, with all ownership
  checks repeated. It never replays a dispatched input. All 17 viewer tests
  passed. The observed viewer refusal remains unresolved; diagnostics are not
  proof of successful browser control.
- These latest diagnostic changes are tested source changes, not another signed
  installed build. Real upload/download hashes, browser Start/Pause/resume and
  active window-close continuity remain incomplete.
- Production and the normal Nikk account were restored through the installed
  app's controls. Fresh readback confirmed Home paused, source folder access
  missing and its draft saved. The owned viewer, relay, lease and disposable
  container were stopped; unrelated apps were untouched. The native synthetic
  paused journal is retained. Local evidence:
  `/tmp/pr1216-installed-final-evidence.json` and
  `/tmp/pr1216-upload-eligibility.json`.

### Generic folder cards and absolute source paths — 2026-10-26

- Removed the Home preset from ordinary sync editors. Existing Home settings
  are preserved as an ordinary connection; this change does not resume it.
  Granted folders and saved connections use shared, individually editable
  cards with title, path, description, quick statistics and disclosure controls.
  Only the selected folder exposes its editor. Optional viewers start closed.
- Drafts survive switching folders, collapsing cards and closing the parent
  section, including temporarily invalid inputs, automatic intervals and
  unsaved upload priorities. Speed-tracker field values, unsaved tracker layouts
  and recovery selections also survive closing their sections. Read-heavy
  progress viewers and speed timers unmount while hidden. Missing folder grants
  and paused observations are not presented as ready to transfer.
- Mac file-access 1.15.0 reports the current absolute location of the exact
  owner-authorized bookmark. It grants no parent-directory access. Remote
  projection additionally requires sync-control 1.1.0; ordinary controls retain
  their 1.0.0 minimum. Stale/denied bookmarks and Photos expose no path.
- Explicitly saving a new connection without a destination creates private
  ordinary Folder Things for the verified absolute hierarchy. Deterministic
  identities bind origin, owner, data plane, device, parent and name. Exact
  ownership/name/parent readback makes retries safe. Existing destinations are
  never retargeted; missing path support requires choosing a destination.
  No user-specific folder name or filesystem location is hardcoded.
- Validation: 665 file-sync tests, 349 Electron tests, and 239 Mac tests
  passed (two Mac tests skipped). Focused source-path, capability and canonical
  Things-validator checks passed. Desktop/phone browser checks cover drafts,
  nested Builder editing, new-folder Save, unchanged existing destinations and
  no unsolicited Start. Browser fixtures are not real transferred-byte proof.
- Final signed-install observations and the exact installed source commit are
  recorded in the PR description and the existing HTML tracker after the build.
  Earlier installed transfer/hash and active window-close acceptance remains
  incomplete unless separately supported by new evidence there.
- Installed source `686dc0beb` verified the actual authorized source location
  and successfully saved an ordinary new connection with a matching private
  cloud hierarchy. The existing Home source grant remained absent; no Home
  settings were edited. A final follow-up preserves unsaved speed/recovery
  fields and corrects compact pause summaries; its seven focused tests and
  desktop/390px browser regressions passed before the final signed build.

### Isolated upload fixture bootstrap — 2026-10-26

- The opt-in acceptance relay can approve one named non-admin test account for private uploads through the canonical admin API. It creates a namespace-only administrator, restarts only the API with retained database/signing material, and never exports bootstrap credentials. Ordinary launches are unchanged; the fixture requires enforced isolated networking.
- All used endpoint capabilities are negotiated. User discovery has a bounded deadline and 15–60 second backoff. Unexpected child exits still terminate the fixture. Focused regression coverage includes child lifecycle, identity/approval checks and refusal outside the isolated fixture.
- The installed generic-folder build already confirmed real DJ DODA payloads and matching absolute cloud ancestry, with Home paused. These results do not replace the remaining isolated browser start/pause, hash, recovery and active-window-close acceptance. Final current evidence remains in the PR description and HTML tracker.
- Corrected local folder-access copy to acknowledge the optional absolute paths retained in private synced Things.

### Signed install and isolated eligibility verified — 2026-10-27

- Final runtime source `f81a9deead4fe59a782eb1d83eb644b449c98d45` built, passed strict/deep signature verification, and was installed through `install:local`. The installed interface reports that source and displays the corrected absolute-path privacy explanation.
- Real immutable isolated backend bootstrap passed canonical registration, supervised API restart and admin readback. The browser and installed app signed into the disposable full account using its existing on-device password-manager entry. `/auth/me` confirmed non-admin, private uploads enabled, public uploads disabled. No secrets or real-account sessions entered the fixture.
- Native pairing reached the helper's real `NSAlert`; a read-only process sample confirmed the node was waiting for that modal rather than failing to launch. Fresh identity access confirmation is pending. The prompt was dismissed and Production restored so personal uploads were not held up.
- DJ DODA resumed from saved progress: 141 operations before the temporary pause, 143 afterward. Home remains paused with its removed source grant absent. These are growing prepared-work counts, not full-backup completion evidence.
- The isolated fixture is retained by one bounded 12-hour lease keeper, without model polling. Its task-local state/handles are recorded in the HTML tracker; no production boundary was broadened. Before continuation, verify the fixture still exists, stop the keeper when taking over, and reuse the same identity rather than recreating a database unnecessarily.
- Remaining acceptance: approved native pairing, synthetic native folder grant, browser Start/Pause/resume, independent upload/download hashes, recovery and active browser/window-close continuity. The PR remains open against `develop`; CI is not fully green. The latest published preview is linked in the PR description.
