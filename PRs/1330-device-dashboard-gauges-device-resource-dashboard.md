# Device resource dashboard

Device links open the dedicated device page. The page and Quick view share an always-expanded, individually editable two-column dashboard for CPU, RAM, startup-disk capacity and activity, and network traffic. File sync and backup have a dedicated section and destination.

The macOS node publishes measured values after negotiating device capabilities 1.14.0. Missing measurements remain unavailable. The network ring shows the download and upload shares of measured traffic. Device state stays owner-scoped, and older BSON snapshots remain readable with their exact-retry semantics intact.

## Verification

- Device API, capability, and focused macOS resource tests passed (155, 131, and 4). Electron passed 406 tests with 2 skips. Final Remix TypeScript and focused lint passed.
- Compiled Nitro with an isolated replica set verified heartbeat readback, exact retry, and owner isolation. Desktop and mobile checks covered device links, the shared dashboard, file-sync navigation, the Midnight theme, and independent Builder edits followed by save and reload.
- The schema suite passed all 295 tests after early-refusal checks switched from wall-clock thresholds to deterministic work counts. The evaluator is unchanged.
- Graphify refreshed structural coverage and retained existing semantic data. Changed documentation awaits semantic re-indexing after the backend returned empty results.

The dashboard branch incorporates main commit `2e9d7bb2e9`, which includes the
standalone browser navigation controls and separately authorized named
connections. Both changelog entries and capability contracts are preserved.
The required checks passed before these integrations and are rerun for the
combined branch.

The [pre-integration product preview](https://thingtime-mzg7q7sa4-lopugits-projects.vercel.app) served HTML and the expected origin-scoped device capabilities. The current preview, signed installation, and production acceptance are tracked in [PR #1330](https://github.com/lopugit/thingtime/pull/1330).
