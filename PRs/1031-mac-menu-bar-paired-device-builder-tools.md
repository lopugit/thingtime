# PR 1031 — Mac menu bar and paired-device Builder tools

## Design

Two private installable suites reuse editable Components, browser Actions, page
sources, device pairing and the existing approved command queue. The native
boundary is a read-only macOS menu collector and a bounded Bash executor.
There is no feature-specific React page or separate telemetry database.

Menu scans run off the main thread every thirty seconds. A lock invalidates any
in-flight scan and publishes an empty locked snapshot. Public accessibility and
CoreGraphics APIs provide best-effort inventory, owning program/app/executable
paths and whole-process resident memory/cumulative CPU time. Missing values are
unavailable, not zero. The first live scan found 29 entries and independently
matched paths against NSRunningApplication; coverage was partial.

`script.run` always needs fresh approval of the full source. Execution uses a
minimal environment, no profile, an unlinked source descriptor, its own process
group, a 1–30 second monotonic deadline and a combined 16 KiB output limit. This
is approved user code, not a sandbox. Ordinary child processes are cleaned up;
intentionally detached daemons are outside the contract. Exact owner reads
retain result bytes for ten minutes; list/event projections omit output. Saving
to a private Thing is a separate explicit Action. Full output lives in
`extended.result`; searchable metadata stays in `crystal`. Saved recipes use
literal JSON string defaults so 16 KiB source and leading `$input` survive
validation. Shared form fields are declared explicitly; saving requires no pairing.

The API manifest versions and optional native negotiation move together. An old
origin receives the old heartbeat shape and cannot dispatch scripts to the new
node. The server rejects malformed snapshots/results and locked inventory.

## Verification

- 39 focused Swift tests pass, including approval, lock, timeout/output bounds,
  minimal environment and old-origin/unapproved-script rejection and optional heartbeat transport.
- Hardware read-only scan verifies owning application paths independently.
- 96 manifest/capability tests pass after integration with main.
- Eight focused data/recipe/result-retention tests pass; broader device tests
  and suite-definition validation also run during this task.
- OS-isolated Chromium checks exercise actual rendered saved suites at 1440px
  and 390px, all menu states, expanded long paths, bottom-of-page overflow,
  10,001-item search/pagination, script receipt/result and explicit saving.
- Acceptance found and fixed HTML initial-value handling, independent result
  form groups and missing collection styles. Screenshots/traces are retained
  locally under `remix/tmp/menu-bar-qa/`.
- Full native XCTest currently aborts because the existing host lacks
  NSBluetoothAlwaysUsageDescription. Focused tests avoid that unrelated path.
  The existing Electron fallback source-regex assertion was updated to the
  current guarded variable name; all 107 Electron tests pass. The full TypeScript baseline has existing failures; new
  suite typing issues found in this run were corrected.

## Delivery checkpoints

Signed build, installed-copy verification, deployed manifest negotiation and
real-account page installation must be verified before declaring the feature
complete. See the PR delivery record for the live acceptance and installation checkpoint.

The installed app currently includes unmerged Password AutoFill PR #996 at
`1851b2e7c1`. Local installation must preserve that implementation in a separate
integration build; it must not add those unrelated changes to this PR or main.

Graph refresh: the local semantic proxy completed extraction but Graphify
rejected unverified changelog shrink (13 to 8 nodes). The prior semantic graph
is retained and the structural graph is refreshed; changed documentation is not
claimed semantically current.
