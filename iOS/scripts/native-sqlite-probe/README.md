# Real iOS simulator SQLite persistence probe

This opt-in experiment compiles a separate UIKit harness, imports the pinned
NodeMobile24.22.1-0 arm64 simulator framework, and bundles the actual frozen
DocumentStore/CollectionProvider TypeScript modules with real MongoDB6.21 BSON
using the checkout's installed esbuild. It does not replace the app runtime,
implement a mock SQL store, contact MongoDB, load credentials or change any
existing simulator, app, account or production service.

From the repo root, with Xcode, an installed arm64 iOS simulator runtime and the
checkout's Remix dependencies available:

```sh
python3 iOS/scripts/native-sqlite-probe/run.py \
  --cache /tmp/thingtime-ios-sqlite-new-run \
  --runtime-cache /path/to/verified-native-runtime-probe-cache \
  --source-ref 40c57f919ac1824103cb8307a1fcda145ceb25f5 \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

The runtime cache is read only; its `runtime.zip` must match the pinned upstream
release digest `3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e`.
No download occurs. Supply a fresh private output cache outside the checkout.
The imported framework's source-to-binary reproducibility remains unproven;
see the existing [runtime provenance](../native-runtime-probe/README.md).

A single new task-owned simulator is created and deleted. The app first writes
real SQLite files, checks rollback and BSON fidelity, closes/reopens both stores,
then commits another primitive document while leaving handles open. The runner
requires nonempty WALs for both stores, verifies the returned launch PID's
executable against the exact installed task app twice, then sends SIGKILL only
to that proven task-owned PID. It verifies the process exited and retained WAL
size/hash values are unchanged before relaunching as a distinct process to check
committed-data recovery, saved collection definitions and typed data. The probe deliberately
keeps its Node thread alive for external lifecycle control. Each command has a
bounded deadline, with an overall 30-minute experiment budget and bounded exact
simulator cleanup. Each cleanup operation is independently bounded and exception handled; the final
receipt is persisted even on cleanup failure and acceptance requires successful
cleanup. Source freezing preserves raw Git bytes. Dependencies resolve through
the workspace's actual MongoDB package and Vite's esbuild dependency.
Simulator commands receive only normal build-path variables.

`verification.json` in the private output cache contains the observed versions,
source and executed bundle SHA256 values, per-phase assertions, real SQLite
headers, process IDs and cleanup result. `commands.local.json` records local
reconstruction paths; do not publish it verbatim. Frameworks, binaries and
synthetic database files stay outside git. The dated artifact directory holds
only sanitized receipts. This is primitive/collection runtime acceptance on a
simulator; it does not establish Mongo query compatibility, integration of the
canonical HTTP services, offline WebView UI, device signing or physical-device
acceptance. The collection engine documents its own deliberately bounded
operation vocabulary and scan-based performance.
