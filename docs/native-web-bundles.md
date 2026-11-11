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

## Implemented API delivery and native download path

The source now exposes GET `/api/v1/releases/native-web` and
`/api/v1/releases/native-web/content`, independently negotiated through
`api.releases-native-web` and `api.releases-native-web-content` 1.0.0 at the
selected origin. The catalogue returns `{ok:true,release:envelope|null}` after
signature, target/runtime, channel, shell-range and sequence checks. The service
resolves only approved assets from the canonical GitHub Release catalogue;
callers cannot supply publication URLs, repositories or credentials.

`native-bundles/archive.mjs` streams a deterministic stored ZIP/ZIP64 using the
shared `thingTransfer/storedZipCore.mjs` layout. The packager emits signed JSON
and archive assets named by release ID alongside its verified payload. The API
derives each signed file's archive offset from that layout and serves exact
HTTP 206 windows of at most 2 MiB. Content requests require the quoted signed
file SHA-256 in `If-Match`; changed identity/ranges fail closed. Metadata/body
processing has explicit budgets, deadlines and cancellation. These are bounded
processing windows, not a maximum bundle size.

`electron/lib/web-bundle-download.cjs` negotiates the selected origin, omits
credentials, refuses API redirects/encoding changes, and checks exact range,
length, ETag and final signed file hash. It writes with backpressure, retains
durable partial bytes for resume and rechecks complete files before reuse.
`web-bundle-updates.cjs` starts checks after healthy renderer startup, stages an
independent verified copy and removes the temporary download copy after staging.
Cancellation preserves resumable bytes; a subsequent check can retry. A staged
release activates on the next normal process start. It never reloads a live
editor. Guarded automatic activation is implemented below; its complete installed
acceptance remains open.

These source implementations and local fixtures do not establish a signed
production publication, configured trust, reachable deployed release routes or
a complete installed download/update journey. The shipped policy still has no
production keys, so background download is disabled until supported trust
provisioning. The existing whole-app updater remains responsible for shell and
native ABI changes. Keep deployed-origin discovery, actual API download and
installed acceptance distinct from the recorded startup/rollback receipt.

## Automatic activation work in progress

The renderer now supports a nonce-bound durable persistence checkpoint through
`native.web-bundle-activation` 1.1.0. The existing automatic-update preference
controls it. An unfocused window must be idle for 30 seconds; dirty or unknown
editors, active media, failed persistence and identity changes keep the candidate
pending. This source checkpoint still requires final installed-app acceptance.
The isolated remote-mode fixture used the canonical release API and real native
downloader to stage 1,823 signed payload files. Dirty-input refusal, normal Enter
submission, integrity-checked persisted value and hard navigation readback pass.
Automatic process replacement then timed out. Known closed navigation editors
are now omitted from the rendered projection; open hidden drafts and Builder
layouts remain protected. The updated actual renderer confirms the closed
fields are absent, but that run stopped at initial text-entry readiness before
publication. No positive automatic replacement or local-account recovery is
claimed. See the [current receipt](../artifacts/anonymous-release-2026-11-11/runtime-continuations/README.md).

The main process reserves the embedded HTTP server, ChatGPT runtime and
loaded Nitro background-work lifecycle before starting close. Existing requests, streamed responses, websocket sessions,
queued storage/model work and pending OAuth refuse the reservation. New requests
receive retryable 503 while held. A veto releases it; a stalled close retains one
observer and its reservation. Electron cannot cancel an already dispatched
`beforeunload`, so this path never forces close or queues a second attempt. An
accepted close fences `activate` and `second-instance` window recreation until
canonical restart/recovery. No renderer-supplied value grants shutdown authority.

The native host now negotiates `thingtime.runtime-work.lifecycle` 1.x directly
inside the loaded server process. Both remote-account and local-API lanes require
this contract; unknown or older bundles remain pending. The local lane also
requires unchanged initialized authority and, for a managed database, a live
owned child process. This source eligibility is not installed acceptance.

Admission follows the actual asynchronous operation after response deadlines or
reader cancellation: transcript saves and lease renewal, parallel tools, provider
cleanup, catalogue/inventory/overview streams, ZIP and avatar cleanup,
notification/email and moderation queues, backup start/receipt/handler work,
index warmup and pool/cursor cleanup. Backup SDK acceptance and its exactly-once
fenced attachment are one continuation, including an abort between acceptance
and response observation. Request completion alone cannot make this work idle.
The existing HTTP/ChatGPT reservations and renderer persistence checkpoint remain
independent requirements. No account, origin or credential boundary is relaxed.

Local MongoDB and SQLite are complementary provider paths, not a replacement
of one by the other. The macOS app already embeds checksum-pinned MongoDB
Community 8.0.34, its source and notices at build time. `LocalRuntime` starts an
authenticated loopback single-node replica set with profile-scoped data and
credentials; normal transactions run through the existing canonical API.
An isolated compiled-runtime check now proves private CRUD, two-account ACLs,
session/content retention across API and database restart, stale-revision refusal
and deletion without cloud access. This is not signed app/OS-vault acceptance.
See [MongoDB evidence](../artifacts/anonymous-release-2026-11-12/mongo-provider/README.md).

Keep provider selection explicit per local workspace and preserve existing
database choices. Do not silently migrate, dual-write, or select another store
when the chosen provider is unavailable. The shipped Mongo binary currently
targets macOS arm64/x64; it does not establish an iOS server port. SQLite remains
the in-process portability path for the mobile runtime.

The internal `documentStore` primitive uses file-backed SQLite transactions and
lossless BSON bytes. Real temporary-file tests cover typed data, rollback,
serialization, scoped sessions and independent-process recovery. It does not yet
implement the canonical collection/query/index facade, authorize an account,
select a native storage path or advertise local API readiness. See
[local development foundations](feature-map/local-development-and-worktrees.md).

## Remaining integration and acceptance

The 12 November actual native run, following the reproduced input-mount fix,
passes single typing, signed staging, 70-second dirty refusal, normal submission,
canonical persistence and hard reload. Automatic replacement still times out.
Home reports zero draft blockers and no new prepare messages; later native-info
observations time out. This narrows the next investigation to host eligibility
and responsiveness but does not identify a particular failed predicate. Keep
every safety gate; retain the exact-source diagnostics under
`artifacts/anonymous-release-2026-11-12/native-auto-activation/editor-readiness/`.
The subsequent historical-value reset correction has its own component tests;
do not retroactively call this run final-source native acceptance.

1. **P0 — publication, trust and deployed acceptance.** Provision real public
   trust through the supported native release process, publish a compatible
   signed envelope/archive, verify both deployed capability manifests and run
   the complete installed API download/stage/restart journey. Synthetic keys
   do not grant production authority. Private repository grants, if needed,
   require the supported server-vault path; no caller credential input exists.
2. **P0 — interruption and editor safety.** Verify resumable network interruption,
   cancellation, retry and independent staging against the actual selected API.
   Preserve origin/profile and unsaved work. Next-normal-start activation is
   implemented. Automatic activation has a guarded source implementation, but
   installed acceptance of both account modes and external frozen-process
   recovery remain open.
3. **P1 — iOS runtime and storage.** Continue from the actual simulator result:
   Node 24, genuine bcrypt and Sharp/libvips now import the canonical Nitro
   bundle in a disposable simulator. Prove the full API and in-process
   transactional storage, stable local origin and lifecycle. Do not substitute
   a static shell or weaken the Node/transaction contract.
4. **P1 — complete platform acceptance.** Verify cold offline startup, durable
   data/edit recovery, compatible updates, incompatible-shell refusal and
   identity boundaries in every intended app/device. Existing isolated Mac
   startup/rollback evidence is scoped; physical iOS and stable distribution
   remain separate gates.

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

The [Fetch fidelity follow-up](../artifacts/anonymous-release-2026-11-11/ios-native-fetch-fidelity/README.md)
starts the genuine compiled Nitro middleware and serves its exact-origin manifest
with HTTP 200 through global Fetch (367 features / 729 operations). Repeated
manifest reads, binary/UTF-8 streaming, gzip, redirect modes and cancellation also
pass. The initial `0xFD` failure came from the probe deleting Node Mobile's
runtime-provided `UNDICI_NO_WASM_SIMD=1` default while sanitizing the environment.
Preserving that exact documented non-secret setting fixes the harness; no runtime
patch, parser replacement or weakened security policy is used.

The experiment uses the previous pinned source snapshot (`39be8cf1…`), whose
Things/search versions are 1.63/1.7, not the current merged 1.64/1.8 contract.
`node:sqlite` exposes `DatabaseSync`, but no database was opened or transaction
contract tested. A reserved non-listening loopback destination fences Mongo;
no data writes or credentials are used. The server and owned simulator were
cleaned up. This proves API startup/discovery and Fetch behavior, not full
offline storage or production WebView/device integration.

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
no child processes and sandboxed writable paths. A disposable simulator harness
now runs this checksum-pinned runtime and imports the actual canonical Nitro
entry. The first attempt failed at bcrypt; cross-compiling the genuine bcrypt
6.0.0 N-API addon made cost-10 hashing and positive/negative comparisons pass.
The identical Nitro import then failed at sharp 0.35.5's missing `ios-arm64`
implementation/libvips >=8.18.7. The API never started and storage was not tested.
Both task-owned simulators were deleted. The reusable
[probe lane](../iOS/scripts/native-runtime-probe/README.md) and
[sanitized original receipts](../artifacts/anonymous-release-2026-11-11/ios-native-runtime/README.md)
retain source hashes, commands and limits. The checked-in reusable runner has now been run end to end against the actual
`bab94d1d9` Nitro output: genuine bcrypt passed, Sharp import failed, and owned
simulator cleanup passed. [Runner acceptance](../artifacts/anonymous-release-2026-11-11/ios-native-runtime/reusable-probe-bab94d1d/README.md)
remains partial runtime evidence, not API startup. Distribution
integrity matches the published SHA-256, while source-to-binary reproducibility
is unproven. Simulator dynamic addon success does not establish physical-device
linking, production target integration or App Store distribution acceptance.

The largest independent gap is persistence: desktop starts `mongod`, while the
API relies on Mongo collections and transactions. iOS needs an in-process device
storage boundary preserving identities, authorization, uniqueness, atomic
mutations/accounting and recovery. The tested simulator bcrypt addon does not remove the need for physical-device
linking; the separately retained Sharp/libvips simulator experiment now passes
real image operations and canonical Nitro import. It remains separate from the
production target and physical-device integration. A static shell or a mock database
would not establish the requested offline API capabilities.

Apple's [current review guidelines](https://developer.apple.com/app-store/review/guidelines/#software-requirements)
restrict downloaded code that changes application functionality and constrain
background execution. Bundled offline execution and downloadable web assets must
be assessed separately from downloadable Node/server code. The App Store release
lane needs a compliant, reviewed update policy; the technical protocol does not
claim distribution approval or bypass native signing/security restrictions.
