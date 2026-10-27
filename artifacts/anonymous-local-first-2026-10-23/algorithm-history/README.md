# Algorithm History acceptance — 23 October 2026

The final integrated package rerun passed **2/2 native cases, zero skips** in
192.98 seconds. [`final-core/browser.log`](final-core/browser.log) records the
run; [`final-core/build.json`](final-core/build.json) pins the immutable package
snapshot `c41befc0600c979d80f4912e1cdb01cb22218c834531d80088922e9d7f1d319e`
(2,033 files, 242,614,199 bytes). The final package includes the feed deletion
fence and native menu positioning fixes. Final screenshots, exported canonical
versions and verification JSON are under `final-core/anonymous/` and
`final-core/account/`; the completed isolation proof is
[`final-core/isolation-verification.json`](final-core/isolation-verification.json).
The account case records four real History receipts and three induced content
upload refusals before an independent successful retry. No page errors or
offline writes occurred.

The earlier `browser.log`, `anonymous/` and `account/` remain prior acceptance
evidence for the package identified by
[`../linux-isolation/build.json`](../linux-isolation/build.json):
`4214b9abff3ba514a02130bcd2be4bdc853b015bb97d7595ad540bf0f98aaec3`.
The browser and backend share an enforced Linux network namespace, disposable
synthetic account/database, and fresh browser contexts. No host configuration,
credentials or personal browser profiles enter the fixture. This is local
canonical web-app acceptance, not installed Mac-app, CI or deployed evidence.

Each case creates and edits an algorithm offline, renames its library title,
reloads, exports its canonical History version, reviews the native restore at
1440, 390 and 320 pixels, applies it, and reloads again. The restored design
keeps the current library title. The narrow details sheet remounts the editor;
the fixture reviews again after changing that breakpoint. Screenshots show the
actual native confirmation, and verification JSON records viewport bounds.
No page errors or offline writes occurred; anonymous requests emitted no writes.

The account case additionally holds algorithm-content uploads at HTTP 503
while normal Timeline synchronization accepts all four immutable device drafts.
`accepted-history.json` contains the real API receipts; `account-version-export.json`
is the actual `api.timeline` 1.22.0 canonical export. Guest access returns 401.
Releasing the content failure and using Retry sync independently saves the
restored profile name and current library title to the disposable account.

`unit.log`: 10 focused tests pass, including restore/undo/merge conflicts,
exact retry, rollback, identity fences, protected-data refusal and server
export provenance/validation. `capabilities.log`: 129 tests pass; missing,
older and breaking remote export contracts refuse. `lint.log`: zero errors,
one pre-existing `useApi.tsx` dependency warning.

Deleted algorithm recovery and named-branch checkout/composition remain
unsupported. Generic protected writes remain refused. Current live-profile
restore, undo and merge use the shared planner and dedicated algorithm writer.
