# iOS runtime provenance audit — 12 November 2026

This was a read-only provenance audit of retained artifacts and pinned public
source. No runtime was rebuilt, no simulator/app was started, and no new runtime
acceptance or distribution approval is established by this note.

## Verified lineage and artifact

- Imported full runtime: `nodejs-mobile-ios-24.22.1-0.zip`, 62,732,962 bytes,
  SHA-256 `3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e`.
  The retained archive was rehashed and matched the current public release asset
  digest. [Release metadata](https://api.github.com/repos/fogtape/nodejs-mobile/releases/tags/v24.22.1-0)
- Official Node tag object `d01285110044365f0ad4fec24482a585646640e2`
  peels to `ce7aaf1cee78b8cf0ce17364260535c418d3ed26`; GitHub reports its
  signature verification as valid.
  [Official tag metadata](https://api.github.com/repos/nodejs/node/git/tags/d01285110044365f0ad4fec24482a585646640e2)
- Fork tag object `421dd797441369a6911989a3d9c3d94a718a4678` is unsigned
  and points to materialized commit `b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5`.
  Its tree `59a1f9b50b39080936dc0e78838b3945da83d8e0` matches the expected
  tree in recipe commit `d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5`.
  [Fork tag](https://api.github.com/repos/fogtape/nodejs-mobile/git/tags/421dd797441369a6911989a3d9c3d94a718a4678),
  [materialized commit](https://api.github.com/repos/fogtape/nodejs-mobile/git/commits/b5bcc8d8e70f055333cd5efc317e3eb55bf0c9a5),
  [expected tree](https://github.com/fogtape/nodejs-mobile/blob/d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5/expected-tree.txt).
- The exact archive's public [attestation lookup](https://api.github.com/repos/fogtape/nodejs-mobile/attestations/sha256:3fa1b8fb0720768b01c2e0dae3a17e788476e8c1613a1d9a54e206793b45326e)
  returned HTTP 404. Integrity and source-tree lineage do not prove that these
  source bytes produced the imported framework.

## Toolchain and packaging observations

Read-only `vtool -show-build` inspection of the retained simulator framework
reported `IOSSIMULATOR`, minimum OS 14.0, SDK 26.5, and linker 1267.0. These do
not identify the complete original compiler/toolchain. The active host reported
Xcode 27.0 build `27A5194q` and iPhoneOS SDK 27.0. Installed release
`Xcode.app` bundle metadata reported 26.6 / `17F112`; Python 3.13 is available.
No matching-toolchain rebuild comparison has been performed.

The pinned fork's [NOTICE](https://github.com/fogtape/nodejs-mobile/blob/d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5/NOTICE.md)
and [workflow](https://github.com/fogtape/nodejs-mobile/blob/d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5/.github/workflows/build.yml)
explicitly remove physical-device gates and permit release-path libnode cache
restoration. Generic upstream documentation describing cold releases and
physical-device gates must not be treated as evidence for this fork's artifact.

The archive inventory contains arm64 device and arm64 simulator slices, but no
LICENSE/NOTICE-named files. Distribution packaging still needs to retain the
fork NOTICE, the complete [Node/dependency LICENSE](https://github.com/fogtape/nodejs-mobile/blob/d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5/LICENSE),
and the applicable notices for bcrypt, Sharp/libvips and their dependencies.
This observation is not a completed license-compliance review.

## Supported next build and verification

Public source is available; no missing source was demonstrated. In a new owned
checkout pinned to recipe `d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5`, the
documented commands are:

```sh
scripts/prepare.sh
git -C out rev-parse 'HEAD^{tree}'
cd out
NODEJS_MOBILE_FLAVOR=full ./tools/ios_framework_prepare.sh
```

Require tree `59a1f9b50b39080936dc0e78838b3945da83d8e0`. The helper builds
both arm64 slices; `full` retains `node:sqlite`, whereas `lite` omits it.
Pin macOS/Xcode/SDK, Python 3.13 and setuptools/build-tool versions, and use clean
owned output without imported compiler-cache artifacts.
[Pinned build instructions](https://github.com/fogtape/nodejs-mobile/blob/d4aedf536d035bf4eeab7a7a6e18b73d154d0ea5/docs/BUILDING.md)

Next acceptance requires two clean builds with compared unsigned framework and
header inventories, documented nondeterminism if present, and a source/toolchain
receipt bound to the resulting runtime. Then rebuild genuine platform addons
against that runtime and exercise the existing Nitro/fetch/SQLite/app tests.
Device builds, valid release signing/provisioning, signed physical-iPhone
acceptance and distribution approval remain separate checks; this audit did not
inspect credential availability or prove that hardware/signing access is absent.

Existing local evidence: [runtime provenance](../../anonymous-release-2026-11-11/ios-native-runtime/verification.json),
[dependency pins](../../../iOS/scripts/native-image-probe/inputs.json), and
[historical simulator app acceptance](../ios-webview-navigation/foreground-acceptance-08/outcome.json).
The current probe/development scripts import the verified archive; they do not
themselves build Node from source.

Audit tooling exception: the mandatory Graphify query unexpectedly started an
automatic AST refresh. Its own session was interrupted with exit 130 before
completion and the parent was notified about possible partial graph scratch.
No graph result, runtime change or build acceptance is claimed from that action.
