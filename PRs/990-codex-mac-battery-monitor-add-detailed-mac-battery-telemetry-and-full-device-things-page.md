# PR #990 — Mac battery telemetry and full device Things page

Branch `codex/mac-battery-monitor` → `main`.
PR: https://github.com/lopugit/thingtime/pull/990

## Scope and root causes

- The native node reported only basic charge state. The server contract had no
  detailed battery fields, so the device drawer could not display cycles,
  capacity, current, voltage, temperature, time estimates or adapter ratings.
- Quick Controls inferred Power from an unset `sleeping` field, yielding
  “Unknown” despite an observed battery percentage in the device header.
- Devices had drawer navigation but no context-menu route or full page. The
  page presentation now renders the same detail component as the drawer.
- An installed-app click-through caught a page crash: Chakra's `DrawerHeader`
  and `DrawerBody` require a Drawer context. The shared detail tree now uses
  plain layout wrappers in page mode, while drawer mode retains those Chakra
  components.
- The Electron web-bundle build assumed `MCP/node_modules` already existed.
  `MCP` uses its own npm lockfile outside the Remix pnpm workspace; a new
  worktree therefore failed at the helper bundle when `fflate` was absent.
  The canonical build now runs `npm ci` for `MCP` before the web build.
- The prior local build chose Apple Development even when the installed app
  used Developer ID, changing the macOS privacy designated requirement. The
  local build reuses an installed valid signing identity when available.
- The installed app footer showed the selected production server's `main`
  branch and SHA because root data is proxied to that server. The footer now
  reads the packaged branch and full commit through the existing desktop
  bridge, leaving the remote server's deployment status intact.
- Post-install QA exposed that every detail row still said “Unavailable.” The
  selected production server advertises device state 1.9.0, so the node
  correctly sent only basic battery values there. QA had checked synthetic
  native readings and the rendered card but accepted the all-placeholder live
  card as an older-server exception. The first local read attempt exposed a
  second missed contract: the signed setup XPC bridge deliberately forbids the
  full `telemetry.snapshot` method. The installed renderer now requests a new
  narrow `telemetry.battery` read for a device that is both paired locally and
  listed in the current account; the same local readings reach the drawer and
  full page without weakening the remote capability contract or exposing the
  whole device snapshot through the setup bridge. The native
  collector also reads adapter details from AppleSmartBattery when IOPS
  adapter details are empty. The 2026-10-13 global and repo AI guidance and
  `TESTING.md` now require live values checked against independent OS readings.

## Contract and rollout

The native node collects a bounded allowlist of non-identifying IOKit battery
and adapter fields. It sends detailed fields only when the selected origin
advertises `api.devices-node-state` 1.10.0 or later. Older origins continue to
receive basic battery state; the installed desktop app reads an allowlisted
local battery projection from its signed node for the paired Mac. Adapter watts are the reported adapter rating;
signed battery current and voltage estimate battery-side power, not wall draw.

## Validation

- Swift node tests: 130 passed, one skipped, including the adapter registry fallback.
- Device tests: 79 passed, including native snapshot projection and paired-account gating; API capability tests: 93 passed.
- Things tests and client build passed.
- Electron tests: 104 passed, including the narrow local battery method.
- Removed the worktree's `MCP/node_modules`; the canonical web-bundle build
  restored its locked dependencies and bundled both desktop entry points.
- Signed local build completed with the same outer-app and nested-node
  designated requirements as the previously installed app.
- On 2026-10-13, the installed signed app displayed 282 charge cycles,
  5,044 mAh full capacity, 6,249 mAh design capacity, 12.82 V battery
  voltage and a 65 W / 20 V adapter in both the drawer and the shared full
  page. Current and remaining capacity changed live. The simultaneous
  AppleSmartBattery `ioreg` reading matched the cycles, capacities and adapter
  rating. Temperature and time estimates were absent or sentinel values in
  IOKit and correctly stayed unavailable.
- Added a durable unsigned `electron dev:parallel` lane. It launched beside
  the signed app on a distinct 127.0.0.1 port with an isolated temporary
  profile; its Node IPC returned `dev_node_unavailable`. The signed app and
  managed Node stayed at their original PIDs. Quitting the dev app removed
  its profile and staged web/AI bundles. Global and local AI guidance plus
  `TESTING.md` require this iterative lane and a final signed install check.

Earlier validation did not constitute battery acceptance: the card had no
non-null detail fields in the actual installed app. The 2026-10-13 signed-app
click-through and `ioreg` comparison above closed that gap. Browser-only live
battery acceptance on the PR preview depends on a paired preview device and
cannot be inferred from a loaded page.
