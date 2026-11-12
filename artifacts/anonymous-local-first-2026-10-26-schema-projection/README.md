# Private instruction schema projection follow-up — 26 October 2026

Web CI at `8c690d2984b0cff8322c408625fe2c36488232f5` passed its build and typecheck ratchet, then failed three assertions in `builtinSchemaProjection.test.ts`. Both newly registered instruction-transfer kinds were missing from the independent pinned projection table.

The repair pins each kind to an empty public projection and explicitly asserts generic CRUD protection. Their private payloads remain in the existing secure records; no production schema or access behavior changed. The complete local schema suite passes **277/277**, with no skips. See [verification](verification.json) and [test log](schema-suite.log). A later CI run must verify the pushed repair; this local result does not change the failed CI result.

## Remaining catalogue contract

Remote theme creation/read/sync still caps the library at 100 entries; algorithm creation/read/sync at 50. Dedicated complete snapshots additionally cap payloads at 8 MiB. Generic Things pagination is live keyset traversal, not a stable snapshot, and cannot safely replace these complete snapshots for deletion reconciliation. A paged or streamed stable snapshot contract is required, with staged local admission, legacy deduplication, scoped cancellation, and no reconciliation until verified completion. Larger command transfer must preserve canonical validation rather than merely raising receiver limits. This audit does not mark catalogue capacity complete.

CodeQL completed successfully at the same prior head ([analysis jobs](ci-40289045204.json)). The [preview controller](ci-40289041612.json) failed before any preview build/publish jobs ran; no permission or deployment setting was changed.

## Native instruction diagnostics

The first diagnostic run pasted the exact 12,002 lines in **2,633 ms**. Native events measured about 2,503 ms between `beforeinput` and `input`; the first following frame arrived at 2,560 ms. Native undo/redo, subsequent typing, local save, cold offline reload, all three responsive widths and independent resumable account readback reached their assertions. It then failed because the legacy GET returned 200 instead of the expected 413. Its response body was not recorded, so authentication or routing was not yet established as the cause. See [first run](native-instructions-first/failure-summary.json), [paste timing](native-instructions-first/capacity-paste-result.json) and [cleanup](native-instructions-first/cleanup.json).

A repeat with request-path diagnostics failed earlier: exact paste took **8,182 ms**, including a 7,959 ms native long task. It did not reach the added legacy-read comparison. The unchanged five-second gate remains failed; neither one faster sample nor tooling latency establishes a performance repair. See [repeat timing](native-instructions-repeat/capacity-paste-result.json) and [failure](native-instructions-repeat/failure-summary.json). Both runs reported no page errors, no offline mutations, no OOM and completed owned-runtime cleanup.

The independently runnable legacy protocol fixture exercises the real isolated built server, canonical multipart writes, browser and direct request paths, and anonymous refusal without making editor performance its prerequisite. It complements the full native test; it does not replace that test or relax its timing requirement.

The focused native protocol check **passes 1/1**, with 18 committed parts. The raw test client is refused as `ACTOR_CHANGED` when it pins the expected actor, and its unpinned legacy GET returns an empty anonymous snapshot. The actual same-origin browser path authenticates successfully and returns **413 / USE_INSTRUCTION_TRANSFER** with no personal payload; the guest still receives empty personal settings. See [request results](legacy-protocol/legacy-protocol-result.json), [initial client refusal](legacy-client-refusal/legacy-protocol-command-refusal.json), [native log](legacy-protocol/run.log), and [cleanup](legacy-protocol/cleanup.json). The test now checks the authenticated browser path while separately asserting that the raw client's anonymous response contains no data. Production cookie flags and authentication are unchanged.

Scoped lint passes. Graph refresh uses structural extraction only; new documentation and image semantics are not re-indexed because semantic extraction is unavailable in this validation run.
