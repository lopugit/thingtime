# Native web bundles and offline runtime

Status: implementation in progress, 11 November 2026. This extends the anonymous
and local-first work in PR #1000; it is not installed updater acceptance.

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

## Remaining integration and acceptance

1. **P0 — release API and trust provisioning.** Register an origin-scoped semantic
   capability, negotiate it in native clients, and expose only approved released
   descriptors and immutable bytes. Choose and provision actual public trust
   keys through the supported release process. Synthetic test keys do not grant
   production authority. No release HTTP endpoint has been added in this batch.
2. **P0 — transport and Electron startup.** Stream permitted release bytes into
   private staging, enforce cancellation and transport resource budgets, call the
   store before Nitro starts, and acknowledge real server plus renderer startup.
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

Apple's [current review guidelines](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
restrict downloaded code that changes application functionality and constrain
background execution. Bundled offline execution and downloadable web assets must
be assessed separately from downloadable Node/server code. The App Store release
lane needs a compliant, reviewed update policy; the technical protocol does not
claim distribution approval or bypass native signing/security restrictions.
