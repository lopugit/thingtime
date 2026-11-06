# PR #1397 — private device location history and alerts

[Pull request](https://github.com/lopugit/thingtime/pull/1397). Branch:
`codex/device-location-history`. Evidence date: 2026-11-06. Integrated main
`520fb4ec7` and then `d0699759b` after the initial feature commit; their unrelated sync and backup changes are
imported, not authored by this task.

## Behavior and boundaries

Paired Device Things support private relational location observations, explicit
collection consent and configurable retention defaulting to Never. Disabling
collection preserves retained history. Expired samples are hidden immediately
and removed through the existing accounted storage lifecycle. Observation IDs,
collection generations, owner/device identity and timestamps fence retries and
late samples.

The device drawer binds observations and typed actions into private saved,
individually editable Builder layouts. Mapbox displays current and historical
markers, date filters, age colours, an ImageGen marker frame and licensed model
artwork with a generic fallback. Public model identifiers select images; no
serial number is sent to an external lookup. Private layouts and vault bindings
are account data, deliberately absent from source control.

Locate actions send exact-device messages, default tones or approved uploaded
MP3 audio. iOS notification sounds use a separate compatible CAF derivative;
the original upload is retained. Command identities survive uncertain retries,
APNs dispatch resumes after approval, and native playback reauthorizes the
selected attachment/version immediately before its effect. Provider acceptance,
command completion and physically heard sound remain separate evidence.

The general contract supports Device Things with capable adapters. This change
ships iOS and Mac collectors; unsupported platforms report their limitation.
iOS uses authorized significant-change location and discretionary background
refresh. It does not promise continuous wakefulness or access Apple's Find My
network. Normal pairing and existing user data are preserved.

## Verification

- Current-main integration: 220 device tests, 152 API capability tests, 304
  schema tests, raw TypeScript and focused lint passed; 64 notification tests
  passed for the changed notification contract.
- iOS: 29 focused tests plus 9 after the scoped-status correction; two native
  simulator tests against an isolated real API passed (pairing and location
  history/command leases). Synthetic positions and a silent command executor
  do not prove physical GPS or speaker behavior.
- Mac: 262 Swift tests (3 platform skips), 51 focused checks after media
  reauthorization corrections; Electron 458 passed with 5 platform skips.
- Real-API isolated Chrome checks passed at 1280px and 390px: full scrolling,
  date filters, custom retention/reload/expiry, disabled collection retaining
  history, idle loading state and lost-response retry yielding one command.
- Builder acceptance independently selected, edited, saved and reloaded a
  nested heading, input placeholder and repeated template field, with private
  audience verified.
- Actual authorized Mapbox tiles rendered from the private saved layout.
  Physical device markers still require a permitted location sample.
- Independent review corrections cover latest-position cleanup, APNs approval
  dispatch and terminal retention, and media reauthorization before playback.
- A transient native-fixture settings POST returned 503 before a subsequent
  read established readiness and the same test passed. Its original body was
  unavailable, so canonical accounting recovery is an inference, not a proven
  diagnosis. Storage admission errors now retain safe machine-readable codes,
  retryability and private/no-store headers without automatically retrying a
  mutation or bypassing accounting. Eleven focused tests, lint and raw TypeScript
  passed for that correction, including two new response-boundary regressions.

- Final logout privacy correction: an essential identity observer runs independently
  of optional connection polling. Scoped native suspension fences late verification
  without forgetting collection consent; same-account return revalidates read-only.
  Fourteen focused JavaScript tests, eleven native tests, lint and raw TypeScript
  passed. The iOS native location bridge is 1.1.0; desktop and HTTP feature
  versions remain independently negotiated.

## Installed build and remaining delivery evidence

The canonical signed Mac build from feature commit `bb6bc3c708` was installed
at `~/Applications/Thingtime.app` (version 0.1.2). Strict deep signature
verification passed; installed app.asar and Node bytes match the build. Both
processes run from the installed path, with the existing signed-in account,
paired device and online transport preserved. Its location permission is
`notDetermined`; no OS permission was changed. Later changes in this PR affect
server error responses, documentation and imported main sync code, not these
verified native feature files.

Exact-head CI, preview/production rollout and native physical permissions,
location samples, notification display and audible playback are tracked
separately. The physical iPhone is locked; no reset, permission
bypass or repeated unlock attempt is part of this change. Current release receipts and any remaining physical-device dependencies are
recorded in the pull request and completion report.

Graphify structural coverage and semantic indexing for the three new source
documents completed. The bounded semantic refresh of other changed large
documents/images timed out; partial output was not activated.
