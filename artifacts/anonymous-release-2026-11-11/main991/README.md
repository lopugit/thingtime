# Main integration checkpoint — 11 November 2026

Merge main `991a3d9d62ec06a050c078499e12ae4ca5cb7261` into the existing
feature branch, preserving AppID assertions and accounted password-file recovery
under the combined passwords 1.10 contract. This checkpoint updates the feature branch only; it does not activate production.

Local resulting-source checks: 206 capability tests, 7 file-transport tests,
10 AppID tests, 12 extension-hook tests and 8 hosted-worker tests pass. Raw
TypeScript and its zero-error ratchet pass. Full lint has 0 errors / 370 warnings.
The production-format build and 27 compiled manifest/docs contracts pass; the
smoke uses a synthetic unavailable database and proves no persistence behavior.
The progress plan passes isolated Chromium checks at 1440, 390 and 320 pixels,
including top-to-bottom scroll, counts, filters, search and navigation targets.

The first static plan probe did not disable CSS smooth scrolling before its
bottom assertion. Its failed receipt is retained in `plan-scroll-probe/`; the
corrected harness and successful final-text results are in `plan-final/`. No layout change was
needed for that test-harness error. Browser cleanup passed.

[Machine-readable verification](verification.json) records checks and source
hashes. Retained provider/iOS/native receipts remain scoped to their documented
sources. The automatic native verifier's last diagnostic correction is unrerun.
Current production/host artifact delivery, full native automatic activation,
iOS transactional storage and physical-device acceptance remain open. Graphify
is refreshed structurally; new semantic documentation indexing is unavailable.
