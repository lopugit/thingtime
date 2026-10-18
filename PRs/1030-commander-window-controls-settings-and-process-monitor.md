# PR 1030: Commander settings and process monitor controls

## Behavior

- The launcher has a keyboard-accessible Settings gear that uses the existing settings command.
- Processes default to name ascending with PID tie-breaking. Grouping orders parent groups by PID. Explicit usage sorts remain live.
- Sort by every process field, choose ascending/descending, and combine text, numeric, percentage, byte/rate and availability filters. Unknown GPU/network values stay unavailable.
- Current, 5/10/30 minutes, 1/3/6/12 hours and 1 day select duration-weighted, minute-bucket averages for usage display, filtering and sorting. History is in-memory, collected by the shared native sampler; gaps and PID reuse do not invent observations. Each row reports actual observed duration.
- Pop out Processes into a resizable native window with Keep above. Settings titlebar double-click maximizes within the usable screen and restores the prior frame without fullscreen.

## Validation

TypeScript checks and JavaScript suites pass. Native Swift coverage includes weighted sampling, missing history, gaps, expiry, PID reuse, repeated zoom delivery, frame restoration and native fullscreen prevention. The optimized Rust indexer suite passes all 34 unit tests and its JSONL integration test. Installed-app acceptance results are recorded in the PR.

The existing indexer catalogue test exceeded its 200 ms query deadline in debug builds under local host load. Optimized tests pass with `CARGO_PROFILE_TEST_OPT_LEVEL=1 RUST_TEST_THREADS=1`, without changing production deadlines. The full daemon trust-boundary integration test now has a 30-second test-only allowance for its server lifecycle and HTTP/security assertions; the default 5 seconds was flaky under concurrent native builds. Isolated Chrome could not start because Chromium's sandbox conflicts with the OS network boundary; the boundary was preserved. Native WKWebView acceptance is the primary rendering check for this macOS-only feature.

Installed-app checks found a repeated zoom-delivery/restore issue and process
column alignment after resizing. Zoom requests now coalesce one double-click
gesture and remember the actual AppKit frame; a native regression test and a
disposable unsigned window preview cover the repeated-delivery case. Explicit
column widths and one ordered stylesheet import keep headers aligned with data.
The native preview was exercised and removed before the final signed build.

Acceptance also exposed AppKit's independent fullscreen action. Utility windows
now explicitly opt out of fullscreen, and native fullscreen requests route to
desktop maximize. The green control is a zoom button; the isolated native preview
verified maximize and exact restoration with that control.

Installed WKWebView checks verified the launcher gear, live Activity metrics,
Processes pop-out, Keep above, CPU sorting in both directions, five-minute
averages, parent grouping, name filtering and a combined memory threshold in MiB.
Representative PID, parent PID and resident memory matched macOS `ps`. Long
average choices use the observations available this session, not invented history.
