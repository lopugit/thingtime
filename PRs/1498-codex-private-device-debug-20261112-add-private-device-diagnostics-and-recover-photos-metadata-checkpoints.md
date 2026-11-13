# PR 1498: private device diagnostics and Photos metadata recovery

## Delivered source

The private, normally hidden Debug folder holds atomic safe device events. `/things/debug` uses editable Builder blocks for filters, capture settings, individual event fields, export and snapshot clearing. The owner and paired-device APIs negotiate independently versioned capabilities, enforce home-plane privacy and use canonical quota accounting. The iOS outbox binds immutable events to the exact owner, origin and paired device, retains offline delivery and honors server retry deadlines without acquiring background execution time.

An acknowledged Photos queue now emits one empty metadata checkpoint per admitted pass. If its cloud metadata index was discarded, the existing conflict path rotates and reconstructs only metadata while retaining original byte/publication receipts.

## Verification and evidence layers

- Prior final-source checks: 313 backend checks, 15 native logger checks, and the integrated native suite with 58 tests and one explicitly opt-in skip. Retained evidence is separate from physical-device acceptance.
- Built API acceptance verifies private exact reads, hidden root placement, paired authority, immutable replay/accounting, redaction, filtered pagination, capture opt-out, canonical event deletion, watermarked clear/refund and revocation.
- Installed metadata recovery proof covers 12 originals with unchanged file IDs, revisions and full hashes; rebuilding metadata consumed zero additional payload bytes.
- Corrected coherent client/server build served `/assets/index-C1JF-fMC.js`. Actual browser acceptance passed four scenarios across 390px and 1280px widths, including full scrolling, opened event details, reload, persisted capture toggle and confirmed snapshot clearing.
- Actual Builder acceptance independently edited the heading and a repeated event field label, retained its data binding, saved a private layout, verified anonymous refusal and reloaded the saved result.
- The local fixture's Vercel analytics script path returns the SPA shell. A scoped diagnosis traced the browser SyntaxError exclusively to `/_vercel/insights/script.js`; diagnostics API/UI behavior passed. Production analytics acceptance is separate.
- Main integration preserves the newer Webpage resolve 1.20 and Agent overview 2.2 contracts. Diagnostics deliberately advances Things to 1.66 and Things update to 1.30. Both manifest suites pass 162/162 tests.

- Installed native diagnostics independently delivered background-request submitted/declined outcomes and app-start events through the actual paired transport into owner-readable API records. A failed first harness assertion expected the wrong nested projection; the corrected harness separately checks the flattened diagnostics projection and exact saved Thing payload.
- The combined installed test exited 65 with failed optional lifecycle assertions. Its external observer retained a stale pre-install container and dispatched no app transitions; the independently verified two-event delivery portion does not make the combined test pass. Earlier disposable fixture startup and disk exhaustion also interrupted acceptance. Actual foreground/background transition and physical iPhone background success remain unverified.
- Targeted lint after main integration completed with zero errors and eight pre-existing API documentation style warnings.

The scoped seven-document semantic graph refresh reached its measured 900-second limit after four of 147 chunks. Its partial private cache was preserved, and the supported structural refresh supplies the graph, report and HTML; changed-document semantic coverage is incomplete. Required source CI passed, and the current-head preview shell and exact-origin diagnostics manifest are publicly reachable. Installed Mac delivery and automatic TestFlight state remain tracked separately on this same branch. Physical iPhone background execution remains unfinished and is not a condition newly claimed by this publication.
