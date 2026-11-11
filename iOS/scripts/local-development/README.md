# Opt-in real iOS application with embedded local Nitro

This simulator-only development lane derives a separate XcodeGen target from
`iOS/project.yml` outside source. It builds the normal Thingtime SwiftUI app,
WebView and native bridges, adding a compile-guarded Node startup gate. The
hosted target, app identity and stored account data are preserved. It does not
embed Watch/share/widget extension targets in the diagnostic development app.

The development bundle identifier is `com.thingtime.localdevelopment`; its
app/group/profile and generated build output are separate. The server binds
only `127.0.0.1:29741`. Startup must verify genuine canonical Nitro discovery,
Vite HTML and an actual built JS asset before creating the normal WebView.
The app has no Mongo/signing configuration or remote API fallback. The embedded
Node environment is shared with native code: the lane retains only explicit OS
launch-context keys (container HOME/TMPDIR/PATH, locale/user identity, simulator
and OS-activity keys, and named XPC/dyld paths). It never logs their values or
replaces native HOME. Every application/provider/account/API configuration key
is cleared before Nitro imports. Local
account APIs must return503 `LOCAL_API_NOT_CONFIGURED`; SQLite primitive probe
success does not establish full account/service integration.

The runtime is the digest-pinned imported NodeMobile24.22.1-0 prerelease; real
bcrypt6 and Sharp0.35.5 simulator addons are reused only when their bytes match
the prior successful native probes. Source-to-binary reproducibility and
physical-device distribution remain unproven. This lane does not authorize
production installation, TestFlight or release signing. Native binaries,
canonical builds and caches stay outside source.

After the parent freezes and verifies a fresh canonical `build:web` output:

```sh
python3 iOS/scripts/local-development/run.py \
  --cache /tmp/thingtime-ios-local-development-new-run \
  --web-output "$PWD/electron/dist/web/.output" \
  --entry-sha256 '<verified-canonical-server-index-sha256>' \
  --runtime-cache /path/to/verified-node-runtime-cache \
  --native-app /path/to/verified-native-fetch-probe.app \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

`prepare.py --check-inputs` takes the same preparation arguments (omit
`--runtime`) and validates without creating a cache or executing imported code.
Preparation compares complete canonical output inventories before/after copy,
records their digest, validates prepared full-copy contents on an allowed
pre-build resume, refuses changed addon package versions, and preserves
canonical source bytes before adding the verified platform-specific addons.
The generated target supplies a narrow127.0.0.1 ATS exception rather than
permitting arbitrary insecure hosts. Never use a stale web build as proof of
the current checkout's runtime behavior.

For offline acceptance, this development WebView installs a content rule list
that blocks external HTTP(S) resources and allows its exact local origin. Its
receipt requires a real Things-library heading and ordinary visible New folder,
Rename and reload controls, retaining the same synthetic Thing ID and edited
name across WebView reload, plus a local capability fetch and rejected external
request. No private store rows or alternate renderer state are inserted. This is **WebView-scoped** external networking unavailability; the OS,
Node network stack and other apps/simulators retain normal networking. The
external Undici counter describes startup acceptance only, not all Node traffic
or subsequent app activity. Native
bridge origin/permission checks are unchanged. No network sandbox, global
network setting or privacy grant is changed.

One bounded30-minute attempt builds the actual app and starts a fresh owned
simulator, retains build/process diagnostics plus startup/rendered screenshots,
then independently bounds exact-app termination and simulator shutdown/deletion.
Inspect `verification.json` even on failure. `runtime.json` and `webview.json`
are copied from the app-private Application Support directory; malformed config
or readiness failure writes `startup-error.json`. No automatic remote fallback
or alternate account is selected. Local command records and raw diagnostic
logs remain private; publish only reviewed, sanitized evidence.

The final signed app records complete payload/app inventories and signed addon
hashes. Canonical files must match the frozen source output except the two
explicit genuine iOS addon substitutions; installed app inventory must equal the
exact built/signed app before UI acceptance. Preparation recovery is permitted
only before any build/simulator exists and retains the original elapsed budget.

## Explicit fresh-profile local-home bootstrap

The native development lane negotiates `local-workspace-status` before an
ordinary **Work on this device** action can send `local-workspace-initialize`.
The independent feature version is1.0.0; initialize binds the exact negotiated
origin, version and native main-document token. Native admission and post-await
commit both require the selected/current/frame origins to match the local
runtime. Provisional navigation changes the document token, including a reload
to the same URL, and exact live URL checks reject changed same-origin paths.
Only a profile first observed with no website records/cookies is owned by this
lane; cookies are rechecked before initialization. Native state mutates only
synchronously after all final document/capability checks.

The browser's canonical device-home initializer refuses any pre-existing or
pending workspace pointer and stale identity generation. Its distinct explicit
local selection does not authenticate a server account or make unavailable
account APIs succeed. Acceptance must click the real recovery button, create
and rename a real local folder through ordinary controls, then retain the same
Thing ID/name after WebView reload. Direct module calls and storage seeds are
not substitutes.

The actual native origin/document predicate is independently executable:

```sh
xcrun swiftc -D THINGTIME_LOCAL_DEVELOPMENT \
  iOS/Thingtime/Lopu/LopuVoiceContract.swift \
  iOS/Thingtime/LocalRuntime/ThingtimeLocalWorkspaceFence.swift \
  iOS/scripts/local-development/test-document-fence.swift \
  -o /tmp/thingtime-local-document-fence-tests
/tmp/thingtime-local-document-fence-tests
```

The latest corrective run's native HTTP readiness passed but WK provisional
navigation timed out before rendering, so real explicit bootstrap/edit/reload
acceptance remains incomplete. Consult the dated evidence instead of treating
source assertions or helper tests as a working native UI.

## Protected SQLite account development bootstrap

`prepare.py` / `run.py --native-accounts` enables a separate protected account
home within this already isolated development app. The default lane retains its
previous unavailable-account behavior. This flag changes no hosted target,
production signing, selected remote origin, or existing WebView IndexedDB home.
The ordinary anonymous workspace and the account SQLite home remain distinct.

The native host creates a single Keychain generic-password envelope, scoped to
this development bundle, using random independent 32-byte JWT/vault/outbox keys.
It uses `AfterFirstUnlockThisDeviceOnly`, no synchronization, and a noninteractive
`LAContext`; an unavailable Keychain stops startup. The nonsecret profile marker
and SQLite file are under Application Support/ThingtimeLocalDevelopment/
NativeAccountHome. An existing missing/corrupt/mismatched envelope or marker,
changed origin/path, or orphaned existing database refuses startup. There is no
implicit recovery, rekey, migration, or deletion. Container/path changes can
therefore require an explicit future recovery design; do not reset keys to fix it.

A CLOEXEC anonymous pipe transfers the transient envelope directly into embedded
Node. The native bridge puts only descriptor numbers into the shared process environment. No key is
written to a plaintext file, command argument, receipt, renderer bridge or log.
After the existing environment scrub, the private bootstrap applies the protected
JWT/vault keys and publishes the immutable canonical native-home descriptor
before importing genuine Nitro. Native account readiness requires the canonical
anonymous `auth/me` response (`200`, null user); it is not registration/login or
email delivery acceptance. Sensitive queued mail still awaits a real transport.

The simulator account signature includes only its distinct application identifier
and matching private Keychain group. It grants no production trust, real team
identity or shared account group. A device/distribution build must instead obtain
its valid application identifier and entitlements through normal Apple signing.
Unsigned/ad-hoc simulator code without this private group fails Keychain access
with `errSecMissingEntitlement`; never replace the key store with plaintext.

A private control pipe supports listener drain → canonical
`thingtime.native-home.close` → bootstrap key retirement. UIKit termination is
best-effort: iOS may suspend/kill an app without a termination notification. This
hook alone is not proof of graceful shutdown or unclean-WAL recovery.

Focused checks (no production data):

```sh
node --test iOS/scripts/local-development/test-native-home.mjs \
  iOS/scripts/local-development/test-environment.mjs
PYTHONDONTWRITEBYTECODE=1 python3 \
  iOS/scripts/local-development/account-profile-control/run.py \
  --cache /tmp/thingtime-protected-profile-new-control
```

The latter uses one fresh simulator and two actual Keychain/profile processes,
retaining only safe booleans/PIDs/hashes and independently cleaning its simulator.
Its ten-minute budget includes any explicit `--budget-anchor` recovery. It does
not start Node, HTTP or WebView. Full application/account acceptance must consume
the parent-frozen canonical payload with complete built/signed/installed inventory
checks; the existing renderer observer still exercises its ordinary device-home
flow and must not be presented as a full account lifecycle fixture.

OS contract references: [Apple Keychain accessibility](https://developer.apple.com/documentation/security/ksecattraccessibleafterfirstunlockthisdeviceonly),
[noninteractive authentication context](https://developer.apple.com/documentation/localauthentication/lacontext/interactionnotallowed),
[application Keychain groups](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps).

Current bounded validation: the actual full development target compiles; profile
logic tests use an in-memory key-store adapter. The live simulator fixture first
returned Keychain `-34018`; its corrected private-group signature was read back,
but the subsequent launch returned no process handle. Actual Keychain retention,
full iOS Node/account HTTP startup and graceful shutdown remain unverified. All
owned simulator cleanup receipts succeeded; no unchanged launch retry follows.
