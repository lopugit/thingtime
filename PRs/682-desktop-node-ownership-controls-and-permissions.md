# PR 682: Desktop Node ownership, controls, and permission status

Desktop now adopts a recognized bundled Node LaunchAgent after XML comments have been removed, persists ownership and Desktop version as plist fields, and reconciles missing, stopped, stale, and unresponsive helpers on launch. It rejects unrelated or unsafe LaunchAgents and retains rollback behavior.

Settings exposes serialized Start, Stop, and Restart controls. Stop retains pairing and configuration and suppresses automatic restart for the current Desktop session. Node's native menu includes About Thingtime Node with version, build, source commit, architecture, OS, and management context.

Privacy checks use live helper preflights, coalesce concurrent refreshes, refresh every five seconds while visible and on focus/visibility changes, and expose Check access. Failed or incomplete checks preserve clearly labelled last-known results; missing data is not treated as denial. Recovery guidance explains grants associated with an older signing identity. No privacy grant is reset automatically.

## Validation

- Electron lifecycle suite: 90 tests passed.
- Native Swift suite: 116 tests passed.
- Device UI logic suite: 25 tests passed, including failed/incomplete preflight, revocation, and unknown/stale presentation.
- Targeted frontend lint and packaged web verification passed.
- Developer ID signed helper and Desktop runtime verification passed; designated requirement matches the currently installed production helper.
- Local macOS logs confirm an old Apple Development Accessibility grant fails to match the running Developer ID helper. System Settings can therefore show an enabled switch while the running helper is denied. A one-time user grant refresh remains necessary.
- Installed Desktop start, stop, and restart passed: stop leaves no Node process, start creates one, and restart replaces its PID; pairing remains intact. The live Things card shows current helper preflight results. Chrome fixture validated denied, unknown, stale, and allowed states at desktop and 390 CSS pixel widths. Native About menu is implemented and covered by metadata/menu tests; CUA could not attach to the windowless helper for a live panel check. Local candidate signing does not establish notarization; production notarization belongs to the protected release lane.
- Graphify portable code graph refreshed. Markdown additions were not semantically reindexed by the code-only update.
