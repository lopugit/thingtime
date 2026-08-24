# PR #383 — Fix Thingtime Recovery SwiftUI startup crash

## Incident

`Thingtime Recovery.app` exited during `ThingtimeRecoveryApp.init()` with a
Swift runtime nil-optional trap. The older installed bundle was retired before
the repaired build was installed.

## Fix

The app now initializes its `@StateObject` backing storage explicitly instead
of relying on SwiftUI's compiler-generated app initializer. A main-actor
regression test constructs the full app to cover this launch path.

## Validation

- `swift test --package-path macos/ThingtimeRecovery`
- `macos/ThingtimeRecovery/script/build_and_run.sh --verify`
- verified the installed signed bundle remained running for the launch-stability
  check and created no new recovery crash report
