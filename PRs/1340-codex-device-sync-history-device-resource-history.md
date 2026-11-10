# PR #1340: Device sync resource history

## Problem and resulting behavior

The resource panel treated an idle local device as an unavailable remote device,
expired remote readings after 2.5 seconds despite ten-second polling, and rejected
valid CPU scope metadata. It had no durable history or time-window controls.

The shared editable panel now offers Live, 1 minute, 5 minutes, 1 hour, 24 hours
and custom dates. Fresh, idle, stale, unknown and error states remain distinct.
Remote freshness uses viewer receipt age and source-relative measurement age;
rolling ranges follow the source clock, while explicit dates remain absolute.
Source observations are retained during admitted sync runs independently of the
panel and survive reopening the app. Five-second native resource reads use the
separate resources lane. Delayed transfer receipts do not fabricate a period
rate. Sample averages and coverage expose partial data and preserve gaps.

History uses the existing source IndexedDB journal, identity-qualified by origin,
owner, device and data plane. Range aggregation reads bounded batches and releases
transactions between them. A separately bounded read lane prevents long history
requests delaying Pause. The existing paired mailbox's read-only history command
requires api.devices-sync-control 1.4.0; client and server validate the immutable
requested range and strict result projection. Local storage failure is reported
without interrupting sync. Electron advertises the compatible native resource correction as fileResourceLimitsVersion 1.1.1; older 1.1.0 collectors retain explicitly partial readings. History starts after the new collector is installed;
unobserved earlier periods cannot be reconstructed.

## Verification record

- Desktop 1440x1000 and mobile 375x812 Chromium fixture: actual editable Builder
  rendering, preset/custom requests, clock skew, gaps/zero, stale/idle, inline
  loading, failure/retry, saved targets and dirty drafts, focus and full scrolling.
  This uses synthetic resource data and is not paired-device acceptance.
- Core protocol, journal, recorder, worker, API completion and capability tests
  cover strict projection, immutable scope/range, unknown values and cancellation.
  Reviewed core tests: 106 passed; worker tests: 10 passed; UI/display and receipt-clock tests: 9 passed. Raw TypeScript, canonical Electron web build and verify:web pass. The compiled Nitro middleware returns JSON capabilities with sync-control 1.4.0 and both operations at its exact test origin. The Electron governor and native bridge regression suite passes 54 tests, including read-only scope separation, capability advertisement and stale child expiry.
- Isolated Chromium exercised the production admitted runner and IndexedDB with synthetic native permissions and HTTP. History recorded with Files unmounted, Pause wrote terminal values, all samples survived a browser process restart, and origin/account/device scopes remained separate. This is not installed Mac acceptance.
- Review identified long-transfer receipt spikes, missing in-flight native
  measurements, source/viewer clock drift and history reads blocking control.
  These are explicit regression cases, not accepted exceptions.
- Isolated Electron renderer-restart verification passed four launches using the real built web bundle, IndexedDB and synthetic receipts; this does not establish native transfer acceptance.
- Scoped semantic Graphify extraction was attempted for five changed documents, but the 104-chunk run did not finish within its bounded run. The code graph is refreshed; changed documentation is not claimed as semantically reindexed.
- Changed-file lint completed with no errors: two pre-existing API-doc escape warnings and one closure warning on the intentionally shared, single history-read lane. An additional concurrency audit confirmed the native singleton prevents overlapping admissions; 23 runtime/window-retention/history regressions passed.
- Production deployment and signed installed-device acceptance remain pending.
  The installed app currently includes separate in-progress filesystem work;
  delivery must preserve that source rather than downgrade the installation.

## Task provenance

Started from freshly fetched origin/main b273c14d8107613fa354e6156343a64558588474
on codex/device-sync-history. Private lifecycle reporting could not be updated:
the connected reporting tools returned Authentication required and the native
Agent overview snapshot timed out. No public or owner-identity fallback was used.
