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

## Release relationship and remaining goal

Schema controls were independently promoted in PR #716 to main merge
5e0e33fd0ff4560c6bb2dec54d46d6898ba0f979 after exact-head Web/API/CodeQL checks.
Production deployment 6349628659 succeeded, and live Chrome showed that exact
commit with frontend/API/Vercel/database ready. That does not release this CSS
branch. Rich/raw HTML and stored-argument media discovery, independent protected
uploads, general containment/performance and intermittent initial-render latency
remain unfinished goal work.
