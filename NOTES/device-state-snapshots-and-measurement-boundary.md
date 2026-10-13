# Device-state snapshots and the measurement boundary

**Reviewed:** 2026-10-13 (Australia/Melbourne)
**Status:** Evidence note and proposed boundary; no production or hardware
acceptance claim.

## Why this distinction matters

The open [PR #990](https://github.com/lopugit/thingtime/pull/990) proposes a
full Things device page and additional Mac battery/adapter readings. Its PR note
describes a bounded allowlist, detailed fields gated on the selected origin's
`api.devices-node-state` capability (1.10.0 or later), and a basic-state
fallback for older origins. It also says that authenticated browser acceptance
of live readings remains manual. PR #990 is still open against `main`; this is
proposal evidence, not proof that the code has merged, deployed, or behaved on a
real device. The exact reported values and their interpretation must be checked
against the source on that device before anyone calls them verified.

This proposal surfaces a useful distinction missing from the wider measurement
discussion: a user-requested device status read can be functional product state
without becoming an analytics signal. [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md)
already excludes battery state and device inventories from performance/resource
signals. That prohibition should not be misread as banning a necessary value
from the device page; equally, showing a value in the UI is not authority to
copy it into analytics, diagnostics, personalization, or a durable event
stream. [TODO 54](../TODO/claude-todo/54-measurement-agency-and-privacy-respecting-telemetry.md)
owns that separation.

## Proposed product and data boundary

- Treat a battery or adapter reading as a bounded snapshot for an explicit,
  authorized device view—not as proof of a person's presence, routine, device
  health, or wall-power draw.
- Keep each field's source, unit, meaning, and sample time visible or
  inspectable. Distinguish current, stale, unknown, unsupported, unavailable,
  and permission-denied states; a missing value is not zero. Do not imply that
  adapter rating or battery-side current/voltage estimates equal measured wall
  consumption.
- Decide a foreground/explicit-refresh sampling policy and resource budget
  before implementation. Do not add periodic background collection or upload
  merely because a native bridge can read a field. Pause sampling when the
  relevant view is not active unless a separately reviewed user purpose allows
  otherwise.
- Do not retain a history of samples, send readings to analytics, or create one
  Timeline event per refresh by default. Any requested history is a separate
  purpose requiring an owner, visible choice, bounded cadence, retention,
  export/deletion behavior, and a clear distinction from actual Thing changes
  under [TODO 56](../TODO/claude-todo/56-unified-thing-history-and-timeline-browser.md).
- Preserve origin capability negotiation and the older-origin fallback. A
  capability advertises contract support; it does not replace device ownership,
  authorization, field validation, or a live behavior check.
- Treat cycle counts, capacity, current, voltage, temperature, charging state,
  and adapter details as potentially revealing or easy to over-interpret.
  Avoid fingerprinting, staff/user scoring, health claims, location/routine
  inference, or secondary use.

## Evidence and acceptance before claiming completion

The PR description reports native bridge, device/API, Things/client, and
Electron tests, while retaining authenticated live-device acceptance as a
manual step. That split is appropriate: mocks and builds can validate parsing,
allowlists, capability fallback, units, and status rendering, but cannot prove
that a real installed app displays the correct reading or permissions.

Before describing this surface as verified, use an authenticated installed
app, exercise the actual device-read path, and compare at least one displayed
reading with an independent operating-system source. Record unavailable fields
separately. Rehearse stale samples, unsupported origins, permission failure,
device switch, app background/foreground, and offline recovery. Confirm that a
refresh produces no analytics event, unrequested network upload, or duplicate
history record. Keep the rehearsal synthetic until the PR is reviewed and
qualified owners approve any real-device handling.

## Related garden work

- [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md) — resource
  budgets and device-data exclusions from performance signals.
- [TODO 49](../TODO/claude-todo/49-personalization-agency-and-accountable-memory.md)
  — inspectable memory and derivative state.
- [TODO 54](../TODO/claude-todo/54-measurement-agency-and-privacy-respecting-telemetry.md)
  — purpose-separated telemetry and optional measurement.
- [TODO 55](../TODO/claude-todo/55-temporal-agency-and-humane-time-semantics.md)
  — freshness and timestamp semantics.
- [TODO 56](../TODO/claude-todo/56-unified-thing-history-and-timeline-browser.md)
  — durable change history, not a high-frequency sensor log.
