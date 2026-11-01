# Fix Commander launch and icon beachballs

PR: https://github.com/lopugit/thingtime/pull/389

## Summary

- Retains the all-row Finder-icon cache, coalescing, and bounded main-loop renderer.
- Submits `application.open` through AppKit's asynchronous Launch Services API and immediately returns control to the web UI.
- Adds a regression test that leaves the Launch Services completion unresolved and proves Commander does not wait.
- Makes the signed build/install verifier terminate only its own stuck `open` helper after the installed app process is confirmed running.
- Refreshes the manual launch-responsiveness checklist and Graphify artifacts.

## Root cause and fix

A live sample captured Commander's main thread in:

`CommanderNativeBridge.handle → NSWorkspace.open → _LSRemoteOpenCall → xpc_connection_send_message_with_reply_sync`

macOS Launch Services can delay that reply indefinitely. The daemon and indexer remained healthy, but the synchronous bridge call made the menu-bar launcher beachball.

Commander now uses `NSWorkspace.open(_:configuration:completionHandler:)`, which submits asynchronously and never holds the UI thread waiting for Launch Services. The helper runner uses the same bounded pattern, so verification cannot remain wedged after the app has launched.

## Validation

- `swift test --package-path Commander/hosts/macos` — 21 passing.
- `Commander/script/build_and_run.sh --verify` — full TypeScript typecheck/test, production build, codesign, install, launch, daemon health, and process-lineage verification passed.
- Installed `~/Applications/Commander.app` — strict deep codesign check, executable check, `/healthz`, and host/daemon/indexer lineage verified.
- Live sampling — the old `/usr/bin/open` helper reproduced the stuck Launch Services XPC wait; the newly installed Commander host was idle in its run loop, not blocked in the native bridge.
