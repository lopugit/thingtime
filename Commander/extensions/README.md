# Commander extensions

This directory keeps Commander-owned extension projects beside the launcher while preserving each host platform's
native package shape.

- [`raycast/`](raycast/) is the existing Thingtime Raycast extension, moved intact from the repository root. It
  retains the legacy image commands and adds the real Raycast `Open Commander` no-view command at
  [`src/openCommander.ts`](raycast/src/openCommander.ts).

Commander's built-in lifecycle commands are implemented separately in the daemon catalog because they execute
through Commander's trusted native bridge. The Raycast companion command launches the installed macOS app by bundle
identifier, so it can reopen Commander even after the built-in `Close Commander` command has quit the entire app.
