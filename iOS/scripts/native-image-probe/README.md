# iOS image dependency compatibility experiment

This separate opt-in lane tests a real arm64 **iOS Simulator** cross-build based
on [TimOliver/vips-cocoa](https://github.com/TimOliver/vips-cocoa/tree/987c467028a20f4813523f6c821a037adc1f8ae0).
It does not change the production iOS target, signing, installed apps or data.
No framework, downloaded source archive, object or library belongs in this folder.

**Latest actual outcome (11 November 2026):** the shared scene harness ran on
arm64 iOS Simulator27.0 (build24A5355p), SDK27.0, Node24.22.1. Genuine
Sharp0.35.5/libvips8.18.7 passed PNG/RGBA/alpha, WebP/social-PNG, EXIF
rotate/cover, full two-frame GIF stats and corrupt-later-frame rejection.
The unchanged canonical Nitro entry imported and exported a middleware function.
The owned simulator was deleted. API startup, persistent storage, physical
devices and production integration remain unverified. Earlier failure receipts
below document resolved prototype boundaries, not current Sharp failures.

The current canonical API requires actual Sharp 0.35.5 and libvips >=8.18.7.
The pinned Apple recipe uses 8.18.0; this lane updates that input to 8.18.7.
`inputs.json` pins the reviewed recipe files and ten source archives by SHA256.
The libvips release digest also matches the upstream GitHub release asset digest.
Other source digests were captured from the publishers' listed HTTPS URLs; they
are integrity pins, not an independent signature or reproducible-build claim.

## Reconstruct the bounded build

Prerequisites: Apple Silicon Mac, configured Xcode with iPhone Simulator SDK,
Python 3.11+ with `venv`, command-line build tools, `pkg-config` on PATH, and
normal HTTPS access to the pinned publishers and PyPI. No Apple account, signing
identity, credential file, global package installation or running simulator is
needed for this dependency build. The runner installs exact Meson/Ninja/CMake
versions in its new cache-local venv. PyPI wheels are version pinned; this lane
does not attest their build reproducibility.

Choose a **new** private cache outside the checkout:

```sh
python3 iOS/scripts/native-image-probe/run.py \
  --cache /tmp/thingtime-ios-image-unique-run
```

Optional `--download-cache /path/to/source-archives` reads existing archives
without modifying them and still checks every digest. Do not point `--cache` at
an existing run or the separate successful native-runtime probe cache. The cache
is exclusively created and is never automatically erased.

The runner uses a sanitized environment and task-owned HOME, downloads and
verifies inputs before executing build scripts, resolves the active simulator
SDK through `xcrun`, selects only `ios-sim-arm64`, and limits builds to four jobs.
The entire run has a 30-minute deadline. Each subprocess has a new process group;
on timeout/interruption that group is terminated and, if necessary, killed.
`active-process.json` records the current process handle while it runs.
`verification.json` and one log per build step retain the first failed boundary.
A failed configure/compile/link exits immediately. There is no automatic retry.

The upstream helper invokes build functions as `if ! function`; Bash disables
`errexit` within that conditional. The adapted helper invokes them directly so
an earlier failed command cannot be obscured by a later successful command.
All adaptations require the expected pinned text to match before writing the
cache copy. The original recipe files remain hash pinned.

## Scope and acceptance boundaries

Dependency order: expat 2.7.4, libffi 3.5.2, PCRE2 10.47 (JIT disabled),
JPEG Turbo 3.1.3, libpng 1.6.54, WebP 1.6.0, GLib 2.87.2, libexif 0.6.25,
Little CMS 2.18, libvips 8.18.7. The simulator SDK supplies zlib.

The bounded image subset preserves the dependencies required for current
PNG/JPEG/WebP input/output, bundled nsgif GIF reading, EXIF orientation, ICC,
RGBA/alpha and multi-frame validation. GIF encoding, HEIF, JPEG XL, TIFF, FFTW
and Highway are outside this experiment. This is not a production replacement
or a claim that Sharp's complete format catalogue is supported.

Passing dependency builds alone proves neither Sharp addon compatibility nor
Nitro startup. Subsequent acceptance must compile the actual Sharp sources for
N-API 9 against verified Node Mobile headers, link simulator-only libraries,
and execute real pixel/metadata/alpha/orientation checks plus complete animated
`.stats()` validation. It must then import the **unchanged** canonical Nitro
entry with its hash checked. An earlier native-runtime lane established real
Node24+bcrypt behavior; it stopped at Sharp's missing `ios-arm64` addon.
Storage, local database, API startup, app integration, physical devices, App
Store distribution and source-to-runtime binary reproducibility remain separate
requirements. No catch-and-stub module or first-frame-only substitute is used.

## Actual first experiment, 11 November 2026

All ten dependency builds passed with Apple clang 21.0.0 and iPhone Simulator
27.0 SDK. The genuine Sharp seven-source C++17/N-API9 compile reached linking.
The strict prototype `-dynamiclib` link failed on `_mallctl` in
`utilities.cc` (`_isUsingJemalloc`). Upstream declares that allocator-detection
symbol `__attribute__((weak))` and expects optional runtime resolution. This is
an unresolved linker-convention boundary in the prototype; it does **not** prove
that iOS cannot run Sharp. No allocator implementation, stub or error-swallowing
adapter was added. No simulator was created for this attempt, and the existing
Node/bcrypt experiment/cache remains unchanged.

The new `build-sharp.py` reproduces that exact next stage against an already
completed cache, using actual Sharp 0.35.5 source and pinned node-addon-api8.9.2:

```sh
python3 iOS/scripts/native-image-probe/build-sharp.py \
  --cache /tmp/thingtime-ios-image-unique-run \
  --runtime-cache /path/to/previous-verified-node-runtime-cache \
  --sharp /path/to/sharp-0.35.5 \
  --addon-api /path/to/node-addon-api-8.9.2
```

It reads the existing runtime archive/headers/framework, verifies the archive
against the native-runtime lane's published distribution digest, and never
modifies that input cache. Use the already-verified cache from the separate
runtime lane; no independent source-to-framework reproduction is established.
It checks Sharp/header content hashes from `inputs.json`, records its exact
local command, and writes only a new `sharp-stage` inside the owned dependency
cache. It refuses an existing stage and does not renew the original 30-minute
window (a single compiler invocation is additionally bounded to five minutes).

Retained sanitized receipts and command:
[`ios-native-image-build`](../../../artifacts/anonymous-release-2026-11-11/ios-native-image-build/).
The full per-dependency logs and binaries stay exclusively in the private cache.
The final runner received only interpreter-path/receipt-field cleanup after the
first dependency run; final Python syntax was checked, not a second full build.

The next bounded experiment should verify Apple's optional weak-import and
normal Node addon linker conventions before changing the link command. Do not
add a fake `mallctl`, disable security or weaken image validation to force a
pass. Real Sharp operation checks and the unchanged canonical Nitro import
remain unexecuted in this image lane; the prior Node/bcrypt lane's Nitro entry
SHA256 was `39be8cf1b16f9eb99455cd337adb26e32829521d2643de72addc4169cb0dbfde`.

## Bounded optional-symbol recovery

[Node-gyp's canonical loadable-module settings](https://github.com/nodejs/node-gyp/blob/main/addon.gypi)
use `-undefined dynamic_lookup` for Mach-O addons. Apple's
[linker manual](https://github.com/apple-oss-distributions/ld64/blob/main/doc/man/man1/ld-classic.1)
documents `-U symbol_name` as the per-symbol dynamic-lookup form.
[Apple weak linking](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPFrameworks/Concepts/WeakLinking.html)
allows absent optional symbols only when callers check for their existence.
Sharp's allocator check compares `mallctl` with null and never calls it.

`recover-link.py` reuses the original strict command and permits only optional
`_mallctl` with `-Wl,-U,_mallctl`. Every other unresolved symbol still fails the
link. It verifies with `nm -m` that `_mallctl` is the sole dynamically looked-up
symbol, marked weak, and that all N-API imports bind to NodeMobile. No Sharp
source is patched and no allocator stub is introduced. The original failed
stage is preserved. Use a fresh cache for this one bounded link attempt:

```sh
python3 iOS/scripts/native-image-probe/recover-link.py \
  --build-cache /tmp/thingtime-ios-image-unique-run \
  --cache /tmp/thingtime-ios-image-recovery-unique-run
python3 iOS/scripts/native-image-probe/run-simulator.py \
  --cache /tmp/thingtime-ios-image-recovery-unique-run \
  --runtime-cache /path/to/previous-verified-node-runtime-cache \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

The simulator runner requires the checked recovered addon and unchanged
canonical entry hash. It copies the earlier verified app into the recovery
cache, adds the genuine addon through Sharp's normal local build discovery
path, and compiles its separate UIKit harness. It uses ad-hoc signing solely for
the disposable simulator app and a distinct bundle identity. It creates and
removes exactly its own new simulator; never passes an existing device UUID.
The JS probe uses synthetic pixels/GIF bytes, checks real Sharp behavior, and
then imports the unchanged Nitro entry. Failures are recorded, never stubbed.
Runtime and teardown are bounded; production signing and app targets remain
untouched.

The recovered addon linked successfully: `nm` shows exactly one weak optional
`_mallctl` dynamic lookup and 53 N-API symbols bound to NodeMobile. The following
real simulator launch did not reach a JS receipt. UIKit 27 terminated the
inherited legacy UIApplicationDelegate harness because this SDK requires
UIScene lifecycle adoption. This is a harness lifecycle boundary, **not** an
observed Sharp operation failure. Its 60-second receipt deadline expired and
the new simulator was successfully deleted. No image-operation or Nitro-import
success is claimed. That boundary was subsequently repaired through the shared scene harness below,
preserving Apple lifecycle requirements and the current SDK.

The initial link-launcher command briefly placed the linker flag before
`clang++`; `xcrun` rejected that invocation before any compiler ran. Its local
record was retained, the argument position was corrected, and the one actual
recovery link passed. Final tooling additionally records active subprocess and
own-simulator handles and automatically retains own process logs on a missing
receipt; those bookkeeping changes were syntax checked, not rerun end to end.

## Shared scene lifecycle repair

Both lanes now compile `../native-runtime-probe/main.mm` and obtain the
single-scene manifest from `probe_scene_manifest()` in that lane's `run.py`.
There is one UIKit harness: AppDelegate starts Node once with `dispatch_once`,
and ProbeSceneDelegate owns its scene's UIWindow/root controller. Multiple
scenes are disabled. The image lane no longer carries a duplicate `main.mm`.
The shared report filename is `Documents/nitro-import.json`; the image probe
writes its real image-operation results there before any accepted outcome.
The selected test remained SDK27.0/runtime iOS27.0, build24A5355p; minimum
simulator deployment18.0. No SDK or UIKit requirement was disabled or lowered.


## Final scene-harness acceptance

The first scene-enabled run reached JS and passed bcrypt, then found a probe
entry-path mistake: canonical Nitro emits Sharp ESM `dist/index.mjs`, whereas
the prototype requested source-package `dist/index.cjs`. Only the probe path
was corrected; no canonical module was replaced. A fresh simulator then passed
all real image checks and the unchanged Nitro import. Its receipt is
`native-image-verification.json`; the earlier test-entry receipt is retained
as `scene-entrypath-verification.json`. Both simulators were deleted.
Final shared harness and probe source hashes plus the actual scene manifest
are retained with the evidence. The final image runner was exercised end to
end. The canonical runtime-only runner's manifest change was syntax checked
and shared by that actual image execution; its standalone lane was not rerun.

## Actual HTTP manifest probe

**Current fidelity verdict:** global Fetch passes. The earlier0xFD failure was
caused by this probe deleting the runtime-provided `UNDICI_NO_WASM_SIMD=1`, not
an unresolved runtime Fetch defect. The pinned mobile bootstrap supplies that
non-secret setting for polywasm; the corrected probe preserves it exactly and
requires its initial value to match. No runtime, parser or security protection
is changed. See the source pins and actual native receipt in
[`ios-native-fetch-fidelity`](../../../artifacts/anonymous-release-2026-11-11/ios-native-fetch-fidelity/).


`run-simulator.py --http` selects `http-probe.mjs` instead of the image-operation
probe. Use a fresh cache with the same checked recovered addon/verification
inputs as above. The canonical Nitro entry and native addon are unchanged.

Before native import the JS probe clears inherited environment, creates an
app-private working directory/HOME/tmp, and sets the sole compiled MongoDB
connection-string input to a unique non-default loopback port. The Python
runner exclusively binds that port without listening and retains it through
app teardown. A PID-and-port-scoped `lsof` check verifies no listening socket.
Native TCP probing records refusal or timeout as the observed unreachable
outcome; a timeout alone is never described as proof of listener absence.
A successful connection refuses the probe. No copied env, credentials, auth
cookies, custom database-selection headers or existing database are used.

The probe starts a real `node:http` server from the compiled Nitro `middleware`
on an OS-selected loopback port and fetches only the public
`/.well-known/thingtime-capabilities.json` route. It verifies HTTP200, JSON,
exact selected origin, schema, feature versions and executable operation
registration. It closes its own HTTP server before receipt/cleanup. This does
not exercise authenticated/data routes or prove a full offline backend.
The optional `node:sqlite` check imports the built-in module and records
whether `DatabaseSync` exists; it never opens a database or writes a table.

The actual HTTP smoke passed on iOS27.0/SDK27.0: the genuine compiled middleware
served HTTP200 JSON through `node:http`, with the exact requested origin,
367features and729operations. This pinned snapshot reports Things1.63/search1.7;
it does not establish the later merge's1.64/1.8 contracts. Global Fetch failed
with cause `Unsupported instruction: 0xFD`; standard Node HTTP then passed on
the identical route. Both attempts and the concrete Fetch cause are retained.
The HTTP server closed and the task simulator was deleted. `node:sqlite`
exposed `DatabaseSync`, without opening a database. No data route/write or real
backend was used. Actual receipts:
[`ios-native-api-startup`](../../../artifacts/anonymous-release-2026-11-11/ios-native-api-startup/).

The corrected global Fetch check passed against the genuine Nitro manifest
without falling back to Node HTTP. Its separate synthetic read-only transport
fixture also passed repeated real manifest reads, chunked binary/UTF8 bytes,
gzip decoding, redirect follow/manual/refusal and AbortSignal cancellation.
The native receipt records Mobile24.22.1-0, Undici7.30.1, polyfill WebAssembly,
and the pre-sanitization parser setting. Both HTTP servers and the owned
simulator were cleaned up; the database remained fenced with no data writes.
Earlier failed receipts remain unchanged as historical harness evidence.
