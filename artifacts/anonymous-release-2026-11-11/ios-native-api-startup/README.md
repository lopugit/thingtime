# Real iOS Nitro HTTP startup

11 November 2026. `verification.json` is an actual arm64 iOS27.0 simulator
receipt (SDK27.0, runtime24A5355p), Node24.22.1, using the genuine recovered
Sharp0.35.5/libvips8.18.7 addon and unchanged canonical Nitro entry
SHA25639be8cf1b16f9eb99455cd337adb26e32829521d2643de72addc4169cb0dbfde.

The exported compiled middleware started a real `node:http` server on an
OS-selected loopback port. A real HTTP GET using `node:http` returned HTTP200
JSON from `/.well-known/thingtime-capabilities.json`: schema1, exact requested
origin,367features,729operations, and registered manifest operation. This
snapshot advertises Things1.63/search1.7; it is **not** acceptance of the later
merged Things1.64/search1.8 source. The HTTP server closed and the newly owned
simulator was deleted.

A distinct runtime gap remains: global Fetch failed with cause
`Unsupported instruction: 0xFD`. Standard Node HTTP succeeded against the same
real route. No adapter or server response was mocked. The built-in
`node:sqlite` module exposed `DatabaseSync`; no database was opened. This is
capability evidence, not storage/API parity.

Database isolation was checked before import: no copied environment or
credentials, app-private cwd/HOME/tmp, and the sole compiled Mongo URI input
pointed to an exclusively reserved, non-listening, non-default task loopback
port. A PID/port-scoped host listener check passed before launch and after app
teardown. Native TCP reported timeout, accurately recorded as unreachable
rather than independently proving listener absence. No authentication or data
route/write was attempted. No real DB backend was started or used.

`first-fence-verification.json` preserves the over-strict initial refusal-only
probe. `host-guard-boundary.txt` records a host-only unsupported socket-option
check, corrected before simulator execution using scoped `lsof`.
`fetch-first-verification.json` preserves the initial opaque Fetch failure.
The final diagnostic retained Fetch's cause and used standard Node HTTP.

Tooling: `iOS/scripts/native-image-probe/{run-simulator.py,http-probe.mjs}`.
Final source hashes and database-input audit are adjacent. Final Python/JS
syntax checks and exact executed probe/entry byte checks passed. Runtime
source-to-binary reproducibility remains unproven. Database-backed routes,
offline persistence, authentication, WebView integration, physical devices and
production distribution remain unaccepted.
