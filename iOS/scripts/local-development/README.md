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
