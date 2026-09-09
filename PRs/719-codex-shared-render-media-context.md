# PR #719: shared CSS media context

## Contract and scope

Link and group readers inherit the authorized root audience for same-author
media in page/block backgrounds, HTML styles and Chakra responsive/pseudo
styles. CSS discovery and transport use the same parser. External URLs, quoted
text, independent keys and non-render metadata do not delegate root access.
Shared writers cannot inject unreadable private media. Attachment content is
1.3.0; Things is feature 1.6.3 / contract 1.5.3.

Visitors may use the app, but this does not grant saved-data or design mutation
authority. They can copy the composition to fresh private Things. Physical
protected-upload copies are still unfinished; never persist the original
root bearer into a copy as a substitute.

## 2026-09-09 integration follow-up

- Merge develop 94eda03d36dd624e2b5a43c9f7ffd1fb45668b53 into the CSS branch;
  preserve both changelog sections. No sharing implementation conflict occurred.
- Correct escaped CSS function identifiers, including hex-terminating whitespace
  and quoted/unquoted arguments. Reconstruct only valid escape boundaries and
  validate unquoted arguments with a bounded linear scanner. Preserve original
  spelling and never reinterpret external URL contents as nested CSS.
- Regression failed before the correction on escaped unquoted url; after it,
  all nine focused parser/authorization tests pass. The webpage suite passes
  79 tests with one optional fixture skipped; capability tests pass 26.
  Focused parser typecheck and changed-file lint pass. These are not a new
  whole-project typecheck claim (the original CSS head had 108 baseline errors,
  with no added diagnostics).
- Original CSS head dc966e545 passed the real API + Chrome fixture at 1440/390
  in 307.954 seconds. Media bytes are stubbed, not proof of physical S3 copying.
- The updated fixture exercises escaped HTML background and Chakra hover URLs.
  Initial execution stopped before assertions with a stale local Nitro module
  resolution error after branch switching. Restarting only this managed
  worktree restored the API; the existing storage-migration warning remains.
- The next run passed desktop checks but failed mobile first render after
  ERR_NETWORK_CHANGED aborted JavaScript downloads (264.544 seconds total).
  One clean retry also exceeded the 60-second Draw visibility wait (146.555
  seconds total); its diagnostic captured the app content after the deadline.
  No further retry was performed. This is NOT a green updated browser receipt.
  Keep the PR open until the initial-render path has been investigated and the
  exact current branch has a complete desktop/mobile pass.

## 2026-09-09 early-startup recovery

- Reproduced a static entry-dependency download failure in real Chrome:
  entry.client never evaluates, so its existing lazy-chunk listener cannot
  recover the blank root. The pre-fix native test timed out (12.411 seconds).
- Register a same-origin module error listener in the earlier classic boot
  script, sharing the existing one-reload guard. Preserve the full share URL
  and never overwrite prior content. Persistent failures show a manual retry;
  denied session storage never starts an automatic loop.
- `test:preview-build` passes all 18 tests with native Chrome enabled, including
  transient failure at 1440/390 and persistent failure at 1440/390 plus a
  storage-denied mobile session. Native portion: 35.913 seconds. Retry controls
  fit the viewport; top/bottom screenshots were inspected. Changed-file lint
  and the production client/embed build pass. Existing eval build warnings
  remain; this is not a claim to remove unrelated eval code.
- Added opt-in `TT_SHARED_BUILT_CLIENT=1` to the real API fixture: client bytes
  come from the freshly built local dist under the production CSP, while API
  requests, origin and authorization are unchanged. This is functional UI
  coverage, not a network or deployment-performance benchmark.
- Instrumented dev-client run rendered the desktop app after 59.064 seconds,
  then exceeded the shared Data wait with ERR_NETWORK_CHANGED events; its
  final diagnostic already contained the Data controls. It is not a pass.
  A subsequent host check measured load averages 387.51 / 366.21 / 302.76.
  Slow local runs under that contention cannot establish an app-level latency
  cause. No assertion timeout was relaxed and no unrelated process was stopped.
- Current live Safari still displays the complete Tarot app signed out,
  including Draw and Copy, with no edit control, on develop 411c23c. That is
  evidence for the previously delivered schema fix, not release of this branch.
- The executable named Google Chrome.app was version 87.0.4280.88. Its bundled
  fixture run failed the mobile document-load deadline (254.266 seconds);
  this remains a failure, not a waived assertion. Switch the isolated fixture
  to the installed Chrome 152.0.7977.84 executable without using the live user
  profile. The complete real API plus bundled-client fixture then passes in
  150.744 seconds, covering both widths, CSS backgrounds/downloads, schema
  controls, authenticated private copying, denied writes, revocation and
  foreign-private isolation. Sample first renders were 8.033 / 5.018 seconds;
  these are observations, not controlled production performance comparisons.
- All 18 startup/recovery tests also pass on Chrome 152 (native portion
  69.800 seconds), with no timeout changes. Fresh desktop/mobile sharing and
  recovery screenshots were inspected top-to-bottom. Current local validation
  is green; publication still needs fresh exact-head CI and preview receipts.

## Release relationship and remaining goal

Schema controls were independently promoted in PR #716 to main merge
5e0e33fd0ff4560c6bb2dec54d46d6898ba0f979 after exact-head Web/API/CodeQL checks.
Production deployment 6349628659 succeeded, and live Chrome showed that exact
commit with frontend/API/Vercel/database ready. That does not release this CSS
branch. Rich/raw HTML and stored-argument media discovery, independent protected
uploads, general containment/performance and intermittent initial-render latency
remain unfinished goal work.
