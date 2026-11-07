# PR 1408 — iOS Photos backup start and recovery

The installed Photos acceptance reproduced two independent failures: the runner
required native resource limits even when the iOS host did not advertise them,
and the PhotoKit reader reported every export error as an unavailable iCloud original.

The shared runner now allows the legacy iOS path only for connections without
explicit saved connection or device limits. Explicit policies remain unchanged and fail closed;
Mac resource enforcement remains unchanged. Unsupported native CPU/scan/rate
limits must remain unavailable in the UI, since renderer pacing cannot constrain
whole-file native uploads.

PhotoKit export failures distinguish denied access, unavailable originals,
insufficient device storage, cancellation and other safe read failures. Retry
keeps prior indexed observations and original companion resources.

The installed test tooling uses a separate XCTest UI target for ordinary Photos
consent, the same verified disposable account/origin/grant for original-byte
checks, unique protected run files, a derived-data lock, and nonzero executed-test
assertions. Canonical storage readiness is checked before and after each phase;
the harness never silently reconciles a normal writer failure.

## Verification

- Apple Photos regressions: 12 passing tests.
- Shared Photos policy/native inventory: 35 passing tests; expanded policy suite 5 passing.
- Resource compatibility/native-host regressions: 11 passing tests.
- Full TypeScript check and focused lint passed.
- Real hosted bridge authorized-grant test: 1 passing test.
- Installed ordinary Photos consent: separate UI runner passed; no injected grants.
- On the owned iOS 27 iPhone simulator, the same normally granted Photos source
  published all 9 resources through 12 native parts (41,282,425 bytes, no legacy
  byte chunks, retained-part cache released). An independent attachment download
  of the 9,448,788-byte synthetic original matched SHA-256; observed confirmation
  took 72,020 ms from WebView reload/start. The complete hosted run took 274.818 s
  before its final reopen check hit a stale-document test-driver race.
- A fresh-document fence and exact readback of the existing saved connection and
  9 cloud revisions allowed a 73.698 s passing installed retry without any new
  native upload job. All 9 revisions remained unchanged, and accounting reported
  pending zero before and after the retry.
  The first-byte proof used stable runtime `f46b588e3` (same runtime blobs in
  integrated remote head `b1bbc4dec`). The fixture used only a compact native
  setup entry supplied by the device-folder branch; it did not exercise that
  branch's later paused-connection CTA.

## Limits and provenance

The disposable backend initially reported health ready while canonical accounting
migration still had pending prerequisites. Canonical scoped recovery completed;
subsequent baseline, pairing and consent gates report pending zero. The initial
pending count does not establish which earlier writer/bootstrap prerequisite was
responsible.

Strict Photos scan still prepares the complete accessible library before upload.
An iCloud-only original still blocks it; this change does not implement controlled
iCloud downloads or partial-library backup. Simulator evidence does not prove
physical iPhone or arbitrary iOS background completion. Automated mode retains
originals until owned simulator cleanup; manual deletion/retention coverage is
separate. The pre-existing simulator was never erased and was returned to shutdown.
