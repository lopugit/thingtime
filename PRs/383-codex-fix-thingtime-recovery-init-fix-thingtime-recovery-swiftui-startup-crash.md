# PR #383 — Fix Thingtime Recovery SwiftUI startup crash

## Incident

`Thingtime Recovery.app` exited during `ThingtimeRecoveryApp.init()` with a
Swift runtime nil-optional trap. The older installed bundle was retired before
the repaired build was installed.

## Fix

The app now initializes its `@StateObject` backing storage explicitly instead
of relying on SwiftUI's compiler-generated app initializer. A main-actor
regression test constructs the full app to cover this launch path.

The recovery catalog now follows every GitHub Release pagination link so an
older rollback bundle cannot disappear behind an arbitrary page cap. It
rejects pagination loops rather than presenting a partial catalog. Both the
desktop and independent Recovery production builders also now round-trip their
ZIPs through clean staging and the same signed-bundle checks before publication;
a malformed archive is blocked before it can become a recovery choice.

## Validation

- `swift test --package-path macos/ThingtimeRecovery`
- `corepack pnpm@10.12.1 --dir electron test`
- a real `verify-release-archive.mjs --mode local` pass using an archive made
  from the installed Apple Development-signed `Thingtime.app`
- `macos/ThingtimeRecovery/script/build_and_run.sh --verify`
- verified the installed signed bundle remained running for the launch-stability
  check and created no new recovery crash report
- verified the Recovery UI rejects the malformed public `build.4` asset and
  can cache, expose, and launch a real verified installed desktop bundle
