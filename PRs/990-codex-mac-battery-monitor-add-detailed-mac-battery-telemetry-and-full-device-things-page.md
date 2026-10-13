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

## Contract and rollout

The native node collects a bounded allowlist of non-identifying IOKit battery
and adapter fields. It sends detailed fields only when the selected origin
advertises `api.devices-node-state` 1.10.0 or later. Older origins continue to
receive basic battery state. Adapter watts are the reported adapter rating;
signed battery current and voltage estimate battery-side power, not wall draw.

## Validation

- Swift node tests: 129 passed, one skipped.
- Device tests: 77 passed, including the page rendering regression; API capability tests: 93 passed.
- Things tests and client build passed.
- Electron tests: 103 passed.
- Removed the worktree's `MCP/node_modules`; the canonical web-bundle build
  restored its locked dependencies and bundled both desktop entry points.
- Signed local build completed with the same outer-app and nested-node
  designated requirements as the previously installed app.

Authenticated browser acceptance of the device context menu, expand button,
full page, and live battery readings remains a manual check after deployment
and sign-in.
