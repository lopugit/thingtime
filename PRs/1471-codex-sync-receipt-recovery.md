# PR 1471 — saved sync receipt and scanner recovery

## Observed failures

The installed Downloads backup retained 465 of 977 confirmed operations but
stopped at “Preserve the published or uncertain revision receipt.” Its saved
file upload had a prematurely set canonical dispatch marker and no recorded
receipt. The owner-authenticated, production-selected Files lookup returned a
null receipt; the deterministic staged attachment was not found. Neither read
proves a late original publication cannot still commit. No live journal was
reset or retried during diagnosis.

Desktop separately retained six confirmed operations while its native scan
generation repeatedly reported an interrupted source. The old native producer
can be cancelled while the durable cursor and confirmed receipts remain.
After the first signed repair build, a later Desktop attempt exhausted the
bridge's 30-second early path-observation deadline while hashing a large file.
Repeating the same full hash on every attempt could starve that file. An active
Desktop task also delayed the cold-start read-only root list for roughly four
minutes, leaving folder management unavailable until the task became inactive.

## Repair and safety boundary

The final publication hooks now mark after byte staging. Native Photos requests
that can publish directly mark immediately before native dispatch, after source
and authority checks. A source change before publication can retire only an
unpublished operation. For an older marked file upload, the client keeps the
original operation and asks the canonical Files writer to occupy its exact
Timeline event identity with a terminal no-effect receipt. A competing complete
file commit wins instead and replays its immutable original request. The fence
charges its private Timeline metadata through the normal transaction and does
not create a file revision, bind or delete bytes, or clear an uncertain journal.
`api.files` 1.13.0 is required before interpreting or issuing a terminal fence.

A validated interrupted native producer closes only its positive feed prefix.
Confirmed receipts drain under original IDs; complete fresh local and cloud
scans are required before a checkpoint. A failed one-way folder stream releases
its exact native scanner so another config can use the lane. Pause, changed
authority, incomplete scans and deletion safety remain guarded. Exact matching
enrollment resumes the existing saved job. Job admission and discovery now page
without a 256-config account ceiling.
Cold-start root listing can run while another native task owns the transfer
lane; grant mutation controls remain disabled. Only the bridge's own elapsed
observation deadline becomes a typed deferral to sealed indexing. Mac file
access 1.22.0 then checks a fresh owner/grant-scoped source stamp for local
file uploads instead of hashing the same captured file again. The captured
verified fingerprint remains provisional until uploaded byte digests or the
canonical verified ready attachment match it. Changed stamps, changed bytes,
lost authority, Stop and older hosts retain their refusal or full-inspection
paths.

## Verification and remaining acceptance

Focused file service, transport, stream, journal, capability and Swift scanner
tests passed. The real request-handler integration on a disposable Mongo
replica set holds an old file POST both before and inside its transaction,
commits a competing terminal receipt, and proves the late old request cannot
publish. It also covers complete-first, terminal replay, anonymous and
cross-origin refusal. The terminal-replay stream regression seeds a durable
interrupted row and models restart lookup; it does not reopen an IndexedDB
connection in a second process. The native tests use a built fixture indexer.
The follow-up focused file-sync suites passed 154 tests and cover a two-way
elapsed observation followed by sealed transfer with no second full source
hash, wrong part digest, ready attachment reuse, stale stamp, authority refusal
and Mac capability rejection. The shared Apple reader compiled in an isolated
iOS Debug simulator build; no physical iOS acceptance is claimed. Cold-start
active-task folder management passed an isolated browser fixture at desktop
and 375-pixel widths. Final signed installed acceptance remains pending.

These are source and isolated test results. Deployment must first publish
`api.files` 1.13.0 at the exact selected production origin. The final signed
Mac build must then be installed and checked against the retained Downloads,
Desktop and Thingtime jobs through normal worker controls. Do not use a null
receipt or attachment 404 alone to clear a saved dispatch marker.
