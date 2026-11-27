# PR #1230: Open Things and files with one click

Ordinary clicks open Things, files and paired devices. Cmd/Ctrl/Shift clicks
select; hover or keyboard focus reveals independent checkbox and three-dot
controls. Touch keeps those controls visible with 44px targets. Folder clicks
reveal the next column or expand the tree in place.

The shared click-intent helper suppresses repeated activation from a double
click. File opening retains the existing download behavior. Tree browsing
controls are optional so the Move dialog remains a folder picker.

## Verification — 26 October 2026

- 339 Things tests passed after integrating main's shared theme changes.
- Scoped lint: zero errors, eight existing warnings. Raw TypeScript checking
  reported 92 diagnostics in untouched files; the warning-only ratchet is not
  evidence of a clean typecheck.
- The isolated real-API runner passed desktop/mobile grid, list and columns,
  names/previews, tree expansion, keyboard/modifier selection and context menus.
  It paired a synthetic device and uploaded a file through the normal APIs.
  Single and deliberate double-click each downloaded the expected filename and
  exact source bytes. Both Thing and device touch controls measured 44×44px.
- Browser and backend direct-IP/redirect network denial was verified. Test
  processes, profiles, database and synthetic credentials were removed.
- Source review found no outstanding correctness issues.

The acceptance runner explicitly enables download events and touch emulation;
viewport screenshots avoid full-page capture resetting touch emulation. Those
runner corrections did not require product workarounds.

Production signed-in UI, physical-device filesystem commands and the compact
drawer remain unverified. External fonts and telemetry were blocked by the test
network policy. Graphify structural output was refreshed; interrupted semantic
extraction leaves documentation semantics unrefreshed. PR checks and deployment
statuses are the current source for CI and preview delivery.

[Pull request](https://github.com/lopugit/thingtime/pull/1230).
