# PR 878: remote brightness and the shared file browser

Branch: `codex/remote-device-files` · target: `main`.

Apple Silicon brightness reads previously depended on legacy IOKit services
that are absent on some built-in displays. The native adapter now uses
DisplayServices when available, validates its result and falls back to the
matched IOKit display. Paired device capabilities refresh on revision-fenced
heartbeats, so existing pairings gain restored brightness and filesystem support.

The existing Things views now host ephemeral remote inode entries and durable
private file attachment Things. A single browser supplies full-page, drawer and
pop-up layouts, grid/list/filter/type/sort controls, selection, context menus and
copy/cut/paste. The main Things portable transfer format also preserves files.
See [the contract](../docs/remote-files.md) for compatibility and exact limits.

## Validation rounds

1. Native unit and filesystem tests, shared transfer orchestration, attachment
   ownership/accounting and API capability coverage. Failures exposed expected
   new command/purpose shapes and test fixtures; these were corrected.
2. Actual display hardware round-trip: read brightness, change by 0.05, read it
   back, restore the original and verify restoration. All four brightness tests
   passed with `TT_BRIGHTNESS_HARDWARE_TEST=1`.
3. Review of interrupted and partial transfers added atomic folder-copy staging,
   24-hour chunk cleanup, bounded native read-result retention, retry identity,
   source-change fences and cloud self-descendant rejection. Regression tests
   caught a shared-directory-cursor bug in cleanup; independent descriptors fixed it.
4. Chrome at 1280×900 and 390×844: real local folder creation/navigation/reload,
   upload-access denial, page-to-footer scrolling; a labelled synthetic transport
   exercised populated grid/list/filter views, 340px dock scrolling, expanded
   pop-ups, context/action menus, recursive copy, cut/paste, duplicate refusal,
   approval/decline and cached content while waiting. Popup menu stacking,
   stale error progress, filter reset on navigation and double refresh were fixed.
5. Repeated final suites: 128 native tests (one opt-in hardware skip in ordinary
   runs, tested separately above), 278 Things tests, 252 attachments, 73 API
   capability tests, 96 Electron tests, and device/core plus five route tests.
   Two full production web builds passed their Vercel output verification.
   TypeScript retains existing repository baseline errors; no changed-surface
   errors remain in the latest source check.
6. Developer ID native bundle build verified deeply and retained the designated
   requirement used by the installed embedded helper. Installation and protected
   runtime operations must be verified against the final compatible web rollout.

The local QA account has no paired devices and no private upload entitlement.
Its upload rejection is an authorization test, not proof of a real S3 transfer.
The synthetic relay proves browser interactions; actual filesystem byte/hash
and failure behavior is covered by temporary-directory native tests, and command
leasing/reporting/result isolation is covered through the real server service
with a test collection. Live paired-device and production checks are separate.

## Rollout

Deploy the new web capability contracts before updating Thingtime Node. The
ordinary `main` macOS-path release workflow builds the updated desktop helper.
Keep the installed Developer ID identity and path stable; never reset TCC as a
substitute for verification. A server without required features is rejected
before native requests or browser transfers activate.

Local dev: `http://localhost:22420` (HMR 22421, Nitro 22422), unique PM2 process
`tt-wt-remote-device-files-22420`, automatic restart disabled. Funnel unavailable:
the configured launcher points to an absent Tailscale app. No mapping changed.
