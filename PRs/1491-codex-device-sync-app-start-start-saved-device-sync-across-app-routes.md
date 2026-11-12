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

The parent source freeze records the exact 30 source, documentation and test
files at `parent-source-freeze.json` in the task's local evidence directory.
Publication verified those hashes; the only later authored changes are this
numbered note and its changelog link. The base is main commit
`f2538e19257bcfdf35ba050e7b187c94ea2252c0`.

## Validation and delivery gates

- Frontend owner reports 46 focused startup/enrollment tests and 34
  native-client tests passing.
- Native owner reports 56 native tests passing and one documented opt-in
  scheduler skip. Raw TypeScript has no diagnostics; targeted lint has no errors
  and two existing warnings.
- Two isolated browser acceptance cases pass, including desktop and phone-width
  rendering, held ordinary work, sibling discovery and navigation coalescing.
- Installed Simulator acceptance with real PhotoKit photos and video is a
  separate gate and remains pending at publication. Initial root-route startup
  reached uploading/publishing without Files or Retry; iOS declined continued
  processing, so this observation does not prove a background lease.
- Physical iPhone background acceptance is not established. TestFlight build68
  is the earlier combined background-progress release and excludes this change.
- Canonical structural Graphify snapshots and HTML are refreshed. The single
  55-second semantic attempt timed out; no new documentation semantic coverage
  is claimed.

Keep `no-ai-merge` and auto-merge disabled until the parent records installed
acceptance and required checks. This label excludes automatic conflict
resolution; it is not a universal controller merge lock. No TestFlight upload
is dispatched as part of this publication batch.
