# Isolated Node 24 / actual Nitro simulator probe

This opt-in compatibility experiment does not modify `project.yml`, the normal
iOS application, signing identities, existing simulators, accounts or profiles.
It compiles a separate UIKit harness and imports the **actual completed canonical
Nitro output**, without a substitute server, mocked database or hashing shim.
It does not start an HTTP listener or establish complete offline API acceptance.

The 11 November 2026 experiment ran Node 24.22.1 on an arm64 iOS 26.5 simulator.
The first unchanged import failed at bcrypt. Building the genuine bcrypt 6 addon
made cost-10 hash/compare pass, then the identical Nitro entry failed at sharp
0.35.5's missing `ios-arm64` implementation. Stop there; this lane does not retry
sharp or test local persistence. See the [sanitized receipts](../../../artifacts/anonymous-release-2026-11-11/ios-native-runtime/README.md).

## Prerequisites and provenance

- Apple Silicon macOS, Python 3.11+, Xcode with an installed iOS simulator runtime,
  and `xcrun`, `clang++`, `simctl`, `codesign`. `DEVELOPER_DIR` may select Xcode.
- A completed canonical `electron/dist/web/.output`, not a mock server.
- bcrypt **6.0.0** and node-addon-api **8.9.2** source installed by the checkout's
  package manager. The runner verifies every compiled source and included local
  header against the pinned SHA-256 values in `run.py`; it does not vendor them.
- Explicit acceptance of the public prerelease through
  `--allow-public-prerelease` for this disposable, non-credentialled experiment.

The runtime is the full public [v24.22.1-0 release](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.22.1-0),
asset `nodejs-mobile-ios-24.22.1-0.zip`, pinned SHA-256
`3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e`.
The digest was independently compared with GitHub release-asset metadata.
The runner checks it **before extraction or execution**. The archive supplies
the Node headers and arm64 simulator framework. This verifies distribution
integrity; source-to-binary reproducibility remains **unproven**. The tag is
unsigned and the exact artifact's public attestation lookup returned 404.

Reviewed lineage: release tag object `421dd797441369a6911989a3d9c3d94a718a4678`
points to materialized source commit `b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5`;
release notes identify recipe commit
`d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5`. The pinned
[Build workflow](https://github.com/fogtape/nodejs-mobile/blob/d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5/.github/workflows/build.yml)
publishes its gated build artifacts with `SHA256SUMS` as a prerelease. This
source review supplied expected lineage for the experiment, not a reproducible
build or production trust grant.

## Run

From the repository root, select an installed runtime using
`xcrun simctl list runtimes`; do not reuse an existing device. Supply explicit
source directories, the expected canonical server entry SHA-256 and a **new**
private cache outside the checkout. For the original checkpoint the entry hash
was `2c0bab9c081214a3f7e5772c5da4025d44f73ba0b5f7f5ac6b67dcc7740c027a`.
For changed builds, record the new source revision/hash rather than claiming
parity with that receipt.

```sh
python3 iOS/scripts/native-runtime-probe/run.py \
  --cache "$TMPDIR/thingtime-node24-probe-new" \
  --web-output "$PWD/electron/dist/web/.output" \
  --entry-sha256 '<expected-server-index-sha256>' \
  --bcrypt '<installed-bcrypt-6.0.0-source-directory>' \
  --addon-api '<installed-node-addon-api-8.9.2-directory>' \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-26-5 \
  --allow-public-prerelease
```

Use `--check-inputs` with the same arguments for hash/input validation without
downloads, builds, simulator creation or cache writes. It does not require
`--allow-public-prerelease`.

The runner downloads and checks the archive, copies the actual web output, and
cross-compiles upstream `blowfish.cc`, `bcrypt.cc`, `bcrypt_node.cc` with C++17,
exceptions, `NODE_GYP_MODULE_NAME=bcrypt_lib` and the pinned Node/N-API headers.
It links against `NodeMobile`, places the genuine addon in the copied bcrypt
`prebuilds/ios-arm64` directory, and signs only the generated simulator code
ad hoc. The UIKit harness starts Node on its own thread. The JavaScript probe
does real hash/compare, then imports the unchanged Nitro entry.

Only `PATH`, `HOME`, `TMPDIR` and optional `DEVELOPER_DIR` reach build/simulator
commands. No credential files, application `.env`, user profile or account data
are copied. One newly created simulator is owned by this run; bounded boot and
receipt waits precede cleanup of that exact device. The runner never erases a
pre-existing cache. Review `verification.json` even when the command fails.

`experimentCompleted` means an observed compatibility result was saved; inspect
`native.imported` and `native.error`. It never means Nitro/API/offline readiness.
`commands.local.json` records local reconstruction paths and should not be
published verbatim. The sanitized receipt removes app-container paths. Frameworks,
addons, source copies and binaries remain in the private cache, outside git.

Simulator dynamic N-API loading is not proof of physical-device linking,
distribution approval or native-module equivalence. Device storage, MongoDB
transaction semantics, image processing, lifecycle and production signing need
separate work. A host frozen synchronously can also outlast a JavaScript timer;
the subprocess/receipt deadlines are diagnostic bounds, not that guarantee.
