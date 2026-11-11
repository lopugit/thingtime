# Native web bundles and offline runtime

Status: implementation in progress, 11 November 2026. This extends the anonymous
and local-first work in PR #1000; release API delivery and production updater acceptance remain incomplete.

## Required result

Native apps start from a complete shipped web application and local API without
depending on a remote page. After startup they discover compatible released
bundles through the selected API, download and verify them, and activate them
without losing local data. Failed downloads, bad signatures, incompatible native
dependencies and failed startup retain a working local version. Cloud-dependent
operations retain their existing authority and explicit offline/retry state.

## Existing foundations and concrete gap

Electron already packages the actual Vite client and `node_middleware` Nitro
server. `startNitroServer` starts the server before opening the window and the
profile retains its local origin. Its signed-app updater and recovery catalogue
replace whole native applications. They do not provide independent web releases.
The browser offline-shell cache is useful for web reloads, but is not executable
update authority for a native host.

iOS currently loads its selected hosted URL in `WebView.swift`. Its project has
no Node runtime or web-bundle build phase. The shared release protocol cannot
establish those capabilities merely by accepting `ios` as a target.

## Implemented release and recovery primitives

The [shared release contract](../native-bundles/README.md) binds every payload
file, entrypoint, release sequence, target, runtime ABI and supported shell range
to an Ed25519 signature. Trust comes from the shipped shell, never downloaded
metadata. The canonical Electron build records the actual Electron runtime and
produces a complete integrity inventory. The separate signing packager accepts
a protected stdin source and publishes only verified immutable directories.

`electron/lib/web-bundle-store.cjs` stages independently copied and verified
bytes under a profile-owned cache. It retains active and previous confirmed
releases separately from a pending candidate. Before returning a candidate for
launch it durably records the trial. Only an explicit matching successful-boot
acknowledgment promotes it. A later startup encountering an unconfirmed trial
falls back to the retained release or the shipped bundle. This keeps the release
sequence floor even after rollback, so the same failing update cannot loop.

The host must hold its existing profile single-instance lock. The store also
serializes callers within that process. Corrupt state is preserved and reported,
not replaced with a new empty profile. Signature, compatibility and byte integrity
are rechecked before loading retained executable code. User content, accounts,
credentials and application data are outside the release cache.

## Native startup integration and executable verification

The Electron host now selects a verified bundle before importing Nitro. A trial
is confirmed only after the real loopback capability manifest and a committed,
error-free React application are ready. React Router's component error callback
is an independent veto because its recovery UI can render while router state
contains no error. An unconfirmed failure requests a fresh application process;
confirmed/shipped startup failures retain the ordinary diagnostic path. An
in-process deadline cannot detect a synchronously frozen main process; external
watchdog acceptance remains open.

The retained development preparation includes the shared host validators,
shipped trust policy and complete web inventory. The shipped policy intentionally
contains no production download trust keys until the release signing process is
provisioned. It still starts the shipped app offline.

Run the real startup fixture only against its dedicated development workspace:

```sh
corepack pnpm --dir electron run build:web
corepack pnpm --dir electron run dev:parallel --workspace=native-bundle-qa-pr1000 --prepare-only --use-staged
THINGTIME_NATIVE_BUNDLE_QA=1 node electron/scripts/verify-web-bundle-startup.mjs \
  --workspace=native-bundle-qa-pr1000 --output=<new-evidence-directory> \
  --chromium=<absolute-Chromium-or-Chrome-for-Testing-executable>
```

The React Router fixture runs in a separate clean Chromium process: Electron's
CDP target rejects `Target.createBrowserContext`. Actual update selection,
Nitro/renderer confirmation and fresh-process rollback run in the installed
isolated development app, with its own profile and managed database. Synthetic
signing authority stays in memory and never authorizes production releases.
The final receipt is successful only after cleanup succeeds; failures retain a
phase, diagnostic and explicit failed result. The [11 November real startup and
rollback run](../artifacts/anonymous-release-2026-11-11/native-startup-recovery/README.md)
passes in the installed isolated development app. Reuse neither a screenshot alone
nor a missing receipt as successful acceptance.

## Planned API delivery using existing publication primitives

Keep the canonical GitHub Release catalogue and add a signed release envelope
plus a deterministic stored ZIP of the declared payload. Reuse the existing
`thingTransfer/storedZip.ts` ZIP64 layout planner/writer rather than introducing
a second archive format or extracting arbitrary archive paths. A release API
can derive each declared file's byte range from that signed layout, resolve
only approved canonical repository assets and stream bounded exact ranges.
Native clients negotiate the catalogue/content capabilities at the selected
origin, verify the envelope against shipped trust, then stage verified file
bytes. This API and transport are not implemented by the startup integration.

Before implementation, prove upstream range support and the exact public/private
repository credential boundary. Private upstream grants use the supported
server-vault workflow; the anonymous caller cannot supply URLs, credentials or
publication identity. Extend the protected existing release publisher, both
capability manifests and compiled route coverage. Production trust provisioning,
actual API download and unsaved-work-aware activation remain required.

## Remaining integration and acceptance

1. **P0 — release API and trust provisioning.** Register an origin-scoped semantic
   capability, negotiate it in native clients, and expose only approved released
   descriptors and immutable bytes. Choose and provision actual public trust
   keys through the supported release process. Synthetic test keys do not grant
   production authority. No release HTTP endpoint has been added in this batch.
2. **P0 — transport and Electron startup.** Stream permitted release bytes into
   private staging, enforce cancellation and transport resource budgets, complete actual download acceptance. Startup selection and real server/renderer
   acknowledgment are implemented separately above.
   Retain the stable renderer origin and profile. Defer reload while work is
   unsaved; preserve the existing whole-native-app updater for shell/ABI changes.
3. **P1 — iOS runtime.** Establish a maintained compatible embedded Node build,
   statically linked native modules, a local storage/API adapter, stable local
   origin and lifecycle handling. Build and run the actual Nitro payload before
   wiring automatic selection. Do not lower the web runtime requirement or call
   a static page shell the complete offline API.
4. **P1 — installed verification.** On the separate development app and an iOS
   simulator/device, verify cold offline startup, data/edit persistence, real
   compatible update, interrupted download, failed startup rollback, incompatible
   shell refusal and restart. Test identity boundaries and recovery after an
   update. Stable distribution and production activation remain separate gates.

Contract/store unit tests exercise synthetic payloads. They do not prove power
loss durability on every filesystem, actual native module compatibility, API
availability, a signed installed update or iOS functionality.

`node electron/scripts/verify-web-bundle-store.cjs` additionally uses the actual
built renderer/Nitro directory. It signs a disposable release in memory, stages
an independent copy, removes the intermediate publication, and verifies cold
recovery after an unconfirmed second trial. Its boot acknowledgment is simulated;
it deliberately does not execute the server or access account data. The
11 November run covered 1,809 files / 269,396,784 bytes with Electron 43.1.0,
Node 24.18.0 and native module ABI 148, then removed its temporary resources.

## iOS evidence and constraints

On 11 November, the official [Node.js Mobile release catalogue](https://github.com/nodejs-mobile/nodejs-mobile/releases)
reported `v18.20.4` as latest, while this checkout's Remix engine is `24.x`.
Its [iOS guide](https://nodejs-mobile.github.io/docs/guide/guide-ios/building-complex/)
requires native modules to be linked into the application; the
[runtime differences](https://nodejs-mobile.github.io/docs/api/differences/)
also exclude child-process/cluster support. Electron's process-managed database
and desktop native bindings therefore cannot simply become the iOS runtime.
These are unresolved compatibility requirements, not an authorization problem.

A further primary-source audit found a third-party Node 24 candidate: the
[fogtape Node.js Mobile fork](https://github.com/fogtape/nodejs-mobile/blob/recipe/README.md)
advertises a full arm64 device/simulator XCFramework in
[prerelease 24.22.1-0](https://github.com/fogtape/nodejs-mobile/releases/tag/v24.22.1-0).
Its [runtime constraints](https://github.com/fogtape/nodejs-mobile/blob/recipe/docs/FAQ.md)
describe jitless V8, a JavaScript WebAssembly implementation for fetch/Undici,
no child processes and sandboxed writable paths. The artifact has not yet been
downloaded, provenance-verified or built into Thingtime; this is a candidate,
not runtime acceptance. A separate simulator target should first import the
actual canonical Nitro payload and render its real web application.

The largest independent gap is persistence: desktop starts `mongod`, while the
API relies on Mongo collections and transactions. iOS needs an in-process device
storage boundary preserving identities, authorization, uniqueness, atomic
mutations/accounting and recovery. Native bcrypt and sharp also need compatible
linked builds or equivalent reusable adapters. A static shell or a mock database
would not establish the requested offline API capabilities.

Apple's [current review guidelines](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
restrict downloaded code that changes application functionality and constrain
background execution. Bundled offline execution and downloadable web assets must
be assessed separately from downloadable Node/server code. The App Store release
lane needs a compliant, reviewed update policy; the technical protocol does not
claim distribution approval or bypass native signing/security restrictions.
