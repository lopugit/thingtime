# Actual arm64 iOS Simulator image build experiment

**Latest: passed real Sharp operations and unchanged Nitro import.**
`native-image-verification.json` records Node24.22.1, Sharp0.35.5,
libvips8.18.7 on arm64 iOS27.0/runtime24A5355p with SDK27.0. PNG/RGBA/alpha,
WebP/social-PNG, EXIF rotate/cover, two-frame stats and corrupt later-frame
rejection all passed. Nitro SHA39be8cf1b16f9eb99455cd337adb26e32829521d2643de72addc4169cb0dbfde
imported and exported `middleware` as a function. Simulator deletion passed.
API startup, storage, physical devices and production parity remain untested.
The earlier failure evidence below is preserved as history.

11 November 2026. First bounded attempt; no production target, account, app,
service or physical device changed. No simulator was created. The earlier
successful Node24/bcrypt runtime cache was read only.

- `dependency-build-verification.json`: actual completed ten-library simulator
  cross-build, including libvips8.18.7.
- `libvips-format-build-extract.log`: selected actual format/configure/build lines.
- `sharp-link-verification.json`, `sharp-link.log`: actual seven-source
  Sharp0.35.5 compile/link stopped on unresolved optional jemalloc `_mallctl`.
- `sharp-link-command.json`: exact argument array with cache/source/SDK paths
  replaced by explicit placeholders. No secret inputs were used.

Tooling and pinned inputs: `iOS/scripts/native-image-probe/`. The first gap is a
prototype linker-convention issue, not evidence of an impossible platform.
Sharp behavior, full animated decode rejection, unchanged Nitro import, API,
storage and production parity remain unverified in this lane. Source-to-binary
reproducibility remains unproven. All experiment subprocesses have exited.

## Subsequent approved linker recovery

The per-symbol optional `_mallctl` lookup linked successfully. All 53 N-API
imports remain bound to NodeMobile; the exact selected symbols are retained in
`recovery-symbols.log`. `recovery-link-verification.json` and
`recovery-link.log` preserve the result.

`recovery-simulator-verification.json` records the next boundary: no native
receipt, own simulator successfully deleted. `runtime-boundary.log` shows the
concrete UIKit27 requirement for UIScene lifecycle adoption. The inherited
legacy harness failed before real JS acceptance. This is not a failed Sharp
image operation. The actual unchanged canonical Nitro entry was copied and
hash checked, but not imported successfully. No operation, API or storage
success is claimed. Proper scene lifecycle adoption is the bounded next change;
no Apple protection or SDK requirement was bypassed.


## Shared scene-harness repair and final execution

AppDelegate now starts Node once; ProbeSceneDelegate owns the UIWindow/root,
and the shared manifest disables multiple scenes. Both lanes use the same
canonical harness and manifest helper. Actual scene-enabled execution passed
bcrypt. A probe-only CJS/ESM path error was corrected against the existing
built module; that intermediate receipt remains preserved. The final fresh
simulator completed the real image suite and unchanged Nitro import, then
was deleted. `scene-manifest.json` records the actual built app's scene settings;
`source-hashes.json` identifies final source/tooling. No production target or
existing cache was modified, and no graph or commit was created.
