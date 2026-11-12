# Actual iOS Node/Nitro compatibility experiment — 11 November 2026

The checksum-pinned NodeMobile 24.22.1-0 runtime executed in a separate arm64
iOS 26.5 simulator. The actual canonical Nitro entry was unchanged:
`2c0bab9c081214a3f7e5772c5da4025d44f73ba0b5f7f5ac6b67dcc7740c027a`.

- [First import](initial-nitro-import.json): Node started; actual Nitro import
  failed at bcrypt's missing `ios-arm64` native build.
- [After genuine bcrypt compilation](bcrypt-nitro-import.json): upstream bcrypt
  6.0.0 compiled against the runtime and node-addon-api headers; cost-10 hashing
  accepted the matching synthetic fixture and rejected a different fixture.
  The identical Nitro import then failed at sharp 0.35.5, which requires a
  compatible `ios-arm64` implementation/libvips >=8.18.7.
- [Provenance and cleanup](verification.json): distribution SHA-256 matched the
  published asset digest; source-to-binary reproducibility remains unproven.
  Both task-owned simulators were shut down and deleted.

These are original observed outcomes with app-container paths and task simulator
identifiers redacted for publication. Raw receipt digests are retained in the
summary so the safe copies are not mistaken for unmodified originals.
No runtime/framework/addon binary, third-party source, private account data or
credential is committed. The only password-like strings were disposable public
test fixtures; no generated hash or credential is published.

**Nitro import did not complete, its API did not start, and storage was not
tested.** The simulator addon does not establish physical-device linking or
distribution acceptance. Nothing changed the production iOS target, installed
Thingtime app, signing identity or existing simulator data.

The [reusable runner and limitations](../../../iOS/scripts/native-runtime-probe/README.md)
reconstruct the checksum validation, real addon build and isolated experiment.
This checkpoint stops at sharp; it does not claim a fix or silently substitute
an image-processing API, static shell or mock database.
