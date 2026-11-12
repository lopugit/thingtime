# Start saved device sync across app routes

Opening Thingtime on a non-device route must start eligible saved sync work
without requiring Files, Retry or another settings save. App entry, route
changes and foreground activation now share the existing discovery and task
manager. Files & Sync exposes immediate scoped startup feedback; one Lopu
notification follows acknowledged admission of the eligible configs.

Ordinary jobs keep their durable identities, pending folder validation and
automatic cadence. Foreground entry may advance the local periodic scan, while
Pause, server retry deadlines and hourly data-budget waits remain binding.
Discovery waits for admission rather than a complete upload, so repeated route
events do not cancel the current transfer or prevent sibling discovery. Saved
local setup intents use the existing occupied-lane queue, bounded recovery
batches continue only after durable progress, and unresolved intents prevent
an all-config success notification.

Photos uses the negotiated native 1.8 control lane for status and foreground
wake while ordinary file work occupies the transfer lane. This reuses the saved
run and authority; periodic discovery does not create a continued-processing
activity. iOS may decline background scheduling, which remains a refusal or
foreground-only outcome rather than a claimed lease.

The branch starts at main commit
`f2538e19257bcfdf35ba050e7b187c94ea2252c0`. Its initial source freeze is retained
in the task evidence; subsequent changes address the observed preparation
bottleneck and the two old asynchronous test contracts exposed by full CI.

The installed trace located a long no-upload interval in original verification.
A controlled test using the real embedded Rust inventory reproduced 33 exports
for five unchanged originals across concurrent reads, versus the five required
exports. Writes took 0.013 seconds; repeated verification/materialization took
26.49 seconds. The fixed test prepares those five originals plus five lookahead
originals once (ten exports total); the repeated read phase takes 0.09 seconds. The single-original cache was discarded on every sibling switch.
The reader now uses bounded, scoped original reuse while preserving current
provider access, exact resource revisions and native file-stamp validation.
Owned temporary files and borrowed iCloud preparation lifetimes remain distinct;
large originals are not rejected by the reusable cache budget.

## Validation and delivery gates

- Frontend owner reports 46 focused startup/enrollment tests and 34
  native-client tests passing.
- Native owner reports 56 native tests passing and one documented opt-in
  scheduler skip. Raw TypeScript has no diagnostics; targeted lint has no errors
  and two existing warnings.
- The final cache/native selection passes 33 tests, including six cache
  regression cases. The shared macOS PhotoLibrary suite passes all 31 tests.
  The two CI test-contract corrections plus startup suite pass 9 tests, with
  zero raw TypeScript diagnostics. Existing terminal retry/receipt assertions
  are preserved after waiting for admitted work to finish.
- Two isolated browser acceptance cases pass, including desktop and phone-width
  rendering, held ordinary work, sibling discovery and navigation coalescing.
- Installed Simulator acceptance TIMED OUT after 360 seconds before the
  full-set/hash, reopen and Lopu assertions completed. Root-route startup
  reached uploading/publishing without Files or Retry. Fresh retained receipts
  show seven published files totaling 12,941,177 bytes at host exit, plus one
  confirmed 8 MiB part for each of two additional PNGs: over 29 MB of useful
  published/part progress. The earlier five-file/about-9-MB observation was
  intermediate; a deadlock was not established. A same-run ordinary relaunch
  subsequently verified root-page wake and exactly one visible Lopu notification.
  Its timing trace isolated the repeated original-verification interval; actual
  8 MiB upload traffic took about 1.5 seconds. Read-only server checks verified
  correct 10 MB/s and 1 GB/hour settings with an unsaturated budget. iOS declined
  continued processing; no background lease was established. Final installed
  continuation, complete resource/hash and unchanged-revision acceptance remain
  release gates whose results are recorded on the PR.
- Physical iPhone background acceptance is not established. TestFlight build68
  is the earlier combined background-progress release and excludes this change.
- Canonical structural Graphify snapshots and HTML are refreshed. The single
  55-second semantic attempt timed out; no new documentation semantic coverage
  is claimed.

Keep `no-ai-merge` and auto-merge disabled until the parent records installed
acceptance and required checks. This label excludes automatic conflict
resolution; it is not a universal controller merge lock. No TestFlight upload
is dispatched as part of this publication batch.
