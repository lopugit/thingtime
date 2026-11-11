# PR 1466 — iOS Photos background transfer hardening

PR: https://github.com/lopugit/thingtime/pull/1466

Photos backups could lose their active transfer when iOS ended a continued-processing task, and a single unreadable original could prevent later available originals from backing up. This change separates authorized file transfer from the app's execution lease and keeps interrupted work recoverable.

- Negotiate transfer-admissions 1.5.0 and opt in to bounded, canonical S3 background-file grants. Legacy and local transports retain their existing path. Current account, grant, source, checksum and publication checks remain enforced.
- Stage protected files for background URLSession, retain exact task and receipt identity, and recover without duplicating byte accounting. Explicit Pause and access changes cancel matching work; ordinary system expiry preserves authorized PUTs.
- Use five shared upload lanes, prepare the next ten-asset batch in parallel, and retain fair retries with separate Photos-download and Photos-read reasons.
- Keep editable progress, counts and logs stable, restore visible speed/data/notification settings, and remove the irrelevant download/recovery sections for Photos-only backup.

Validation is recorded separately for server authorization, native lifecycle logic, rendered UI, simulator transport, and physical device behavior. Simulator BGTaskScheduler submission returns unavailable; it cannot prove a real continued-processing grant or iPhone background completion. TestFlight and physical acceptance remain pending until their corresponding checks complete.

Verified so far:

- 151 attachment/S3/capability tests and the built isolated transfer-admissions API integration passed, including checksums, exact receipts, expiry, access changes and local fallback.
- 26 shared Photos-library queue tests passed with the canonical Rust helper. 27 focused native regressions passed, with zero failures. The actual scheduler probe was excluded from this minimal fixture-host run; its separate unavailable result is retained.
- 19 UI/progress tests, full web TypeScript check and targeted lint passed (two existing hook warnings). Isolated Chrome exercised desktop 1440 and phone 390, save/reload, nested Builder editing and all progress phases; following-content movement was 0 px / 1 px.

Background average scheduling is advisory at the iOS transfer layer; it does not promise a strict instantaneous speed ceiling. Force-quitting still stops iOS background transfers until the app is reopened. These limits are stated alongside the settings and in the iOS runbook.

- A separately launched simulator fixture reached observed suspension, then its receiver completed 8 MiB with the expected SHA-256 and one PUT. An injected terminal journal-write failure recovered on normal reopen without another upload. TCP buffering prevents asserting that every byte was emitted after suspension. This is isolated transport evidence, not canonical S3/PhotoKit or physical-device acceptance.
- Final bounded review found the orphan task, terminal receipt, and duplicate crash-accounting paths addressed. All 47 tested native runtime hashes match the source.
- Graphify structural output refreshed; full changed-document semantic extraction was stopped after bounded slow progress. Existing semantic output is retained and is not claimed to cover all new documentation.

## Evidence boundaries — 11 November 2026

Implementation revision `753863261841a70277c834039b42cc748d825d69` was tested before integration with current main. The first source integration preserves all 47 tested native runtime files. A subsequent integration of main `c5cc2b08` imports the separately merged shared-draft reminder changes from PR #1458, including its iOS WebView and ShareInbox changes; those imported changes are covered by the combined-head CI rather than the earlier runtime hash comparison. The Photos background-transfer runtime itself is unchanged. The combined registry capability suite passed 170/170 after updating its second manifest assertion to 1.5.0 and covering compatible/older/breaking versions; CI validates the combined application.

The suspension fixture uses the committed conditional app entry in `iOS/ThingtimeTests/BackgroundPhotoUploadInstalledTests.swift`, loopback receiver in `iOS/ThingtimeTests/Fixtures/BackgroundPhotoDaemon/server.mjs`, and passive observer in `iOS/ThingtimeUITests/BackgroundPhotoSuspensionUITests.swift`. It is compiled in a temporary isolated app with `BACKGROUND_PHOTO_DAEMON_FIXTURE`, uses a distinct bundle identity, and is normally launched through simctl after the observer is ready. The receiver holds reads at 65,536 bytes until observed application state 2 (background suspended). It then records one 8,388,608-byte PUT with SHA-256 `7d212b9c884f5c77896de960ae17cc341cda43b14d6a971f34ca29ebd4badf7f`. The intentional first terminal journal-save refusal is observed before reopening; reopen recovers the same result without another PUT. This is a transport fixture with an injected descriptor, not a production S3 grant or a Photos-library backup. The temporary raw orchestration logs and xcresults under `/tmp/thingtime-background-daemon.C1Fqpi/` are no longer retained after the host/session reset. The previously observed results remain recorded here and in private task progress; no raw artifacts have been recreated.

The real isolated transfer-admissions API test separately exercises authorization and canonical publication through the built server. It uses a disposable replica set and synthetic identity; it does not write production data. Local object transport deliberately omits the background descriptor. The canonical S3 descriptor is independently tested with the AWS presigner and altered-target refusal cases.

## Required release acceptance

- Confirm exact PR head checks and preview, merge through the normal process, and verify the selected production origin advertises transfer-admissions 1.5.0.
- Build through the canonical iOS release workflow, verify signing/export/upload, then verify Apple processing and internal TestFlight availability for the exact new build. Existing build 59 does not contain this change.
- On the physical iPhone, verify continued-task progress and background transfer/publication with the app away, automatic recovery on reopening, explicit Pause, and unchanged settings. Simulator success does not establish these results.
- Independently count unique committed original bytes for the existing 10 GB acceptance goal. Transfer traffic, repeated attempts, fixture bytes and build success do not satisfy that goal.
