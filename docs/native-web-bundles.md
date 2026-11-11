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
editor. Guarded automatic activation now has actual isolated development-app
acceptance for an anonymous device workspace; local-account recovery remains open.

These source implementations and local fixtures do not establish a signed
production publication, configured trust, reachable deployed release routes or
a complete installed download/update journey. The shipped policy still has no
production keys, so background download is disabled until supported trust
provisioning. The existing whole-app updater remains responsible for shell and
native ABI changes. Keep deployed-origin discovery, actual API download and
installed acceptance distinct from the recorded startup/rollback receipt.

## Automatic activation work in progress

The renderer now supports a nonce-bound durable persistence checkpoint through
`native.web-bundle-activation` 1.3.0. The existing automatic-update preference
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

Version 1.2 adds a read-only eligibility projection to `getInfo().webBundle.activation`
on the existing bridge. The real eligibility decision uses that same projection:
named boolean gates, counts and idle/busy/unavailable/error states only. It never
returns account content, credentials, provider exceptions or native handles.
The isolated verifier negotiates the loaded origin and compatible feature version
before relying on it. Task development builds emit the same projection only while
a candidate is pending, on changed blockers and at a bounded heartbeat interval.
This gives evidence independent of renderer IPC; it cannot acquire a reservation,
force a restart or relax a safety gate. Throwing lifecycle discovery fails closed.

Version 1.3 adds optional closed-enum renderer checkpoint and host cancellation
reasons. They are diagnostics only: the current window, origin and nonce still
govern acceptance, and stale receipts cannot overwrite current diagnostics.
Older 1.x hosts continue to receive the original two-field checkpoint. Actual
renderer-module Chromium tests distinguish pre-ready draft refusal, durable
persistence completion, DOM invalidation and safety invalidation; their host
and background controls are synthetic, not native activation acceptance.

A dispatched close now retains its operation, nonce and shutdown reservations
after cancellation until Chromium confirms an actual veto or closure. It cannot
start another close or claim cancellation has completed while native close is
still pending. Focused regressions cover cancellation followed by delayed veto
or closure and exactly-once relaunch/release. Task-development lifecycle logs use
closed stage names only; a supervisor send callback is send completion, not an
acknowledgment that a replacement process started.

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
lossless BSON bytes. Its explicit collection provider adds typed identities,
validated filters, conditional set/unset/increment, deterministic paging and
durable single-field sparse/multikey uniqueness. Transactions span collections;
a caught failed operation still aborts the entire transaction. Unsupported query
syntax, options and executable/custom object hooks are refused before mutation,
including when a collection is empty or no row matches.

This vocabulary is deliberately not MongoDB query syntax or a drop-in Mongo
driver. Numeric equality retains BSON types; null and missing are distinct;
paths do not implicitly traverse arrays. The current correctness-first provider
scans a collection for each operation, so it is not ready for production scale.
It does not yet translate canonical API queries, authorize an account, integrate
canonical history or select a native profile. No runtime switches to
SQLite as a result of these tests. See [collection evidence and next integration](../artifacts/anonymous-release-2026-11-12/sqlite-collections/README.md)
and [local development foundations](feature-map/local-development-and-worktrees.md).

An explicit native transaction capability now reaches the canonical
`applyUserStorageDelta` entry point. It checks the persisted ordinary account,
home/content plane, trusted ready ledger and allowance before exposing a writable
callback. Content, ledger and synthetic history test rows commit or roll back
together, even after a caught accounting error. Mongo mutation/deletion paths
retain their existing behavior; importing them does not load SQLite. This is a
bounded accounting consumer, not API activation. Character inheritance, pending
accounting, reconciliation, deletion recovery, normal registration/session
initialization and the real Timeline adapter remain required. See
[accounting evidence](../artifacts/anonymous-release-2026-11-12/sqlite-accounting/README.md).

The isolated iOS simulator now executes the actual frozen SQLite primitive and
collection modules in embedded Node 24.22.1 / SQLite 3.53.4. It verifies BSON
fidelity, rollback, uniqueness, queries and reopening. A stronger follow-up
verifies both nonempty WALs, force-kills only the independently identified task
app process, confirms unchanged WAL bytes and recovers the committed data in a
new process. The task simulator is deleted after the run. This is simulator
storage acceptance with an imported runtime, not source-to-binary reproducibility,
canonical Nitro/account integration, full WebView lifecycle or physical-device
acceptance. [Probe and exact evidence](../artifacts/anonymous-release-2026-11-12/ios-sqlite-runtime/README.md).

## Current native acceptance — 12 November 2026

The helper-inclusive development app completes the actual signed catalogue/content
journey, holds an unsaved edit for 70 seconds, persists through normal Enter and
hard reload, then automatically replaces its process. The replacement confirms
the new release, retains the stable loopback origin and reads the same durable
content. Desktop and 390px drawer draft/cancel checks pass. No manual restart or
forced checkpoint is used. The signing authority and release API are isolated
fixtures; this does not establish production trust or a local-account recovery
journey. [Actual receipt and screenshots](../artifacts/anonymous-release-2026-11-12/native-auto-activation/helper-replacement/README.md).

The development password helper has a distinct signed host/provider identity,
private Keychain group, notification and URL scheme. A separate compile-guarded
fixture uses atomic insert-only session creation and exact-state readback to
preserve unrelated authority. Actual signed verification preserves a wrong-origin
synthetic session, retires the matching session and verifies empty storage. The
subsequent loopback app replacement exercises an empty group, not restoration of
a real account or vault. Stable app and user credentials remain unchanged.
[Helper isolation and authority evidence](../artifacts/anonymous-release-2026-11-12/native-auto-activation/helper-integration/README.md).

Canonical user insert/read and session operations now compose with SQLite storage
accounting through explicit home repositories and one shared Things definition.
The document-store suite passes 56 checks. Identity batches use one scan/transaction;
the provider remains correctness-first and does not claim indexed-query scaling.
Normal signup still needs tier/subscription, vault, roster, verification/outbox,
transaction and Nitro readiness integration. No account selects SQLite implicitly.
[Identity evidence](../artifacts/anonymous-release-2026-11-12/sqlite-identities/README.md).

The next bounded integration is the existing `createUserAccount` path: introduce
an explicit home-account transaction for identity plus initial subscription/ledger,
reuse canonical tier descriptors/admission, and scope tier bootstrap per provider.
Test actual `createUserAccount` with rollback, duplicate races and reopening before
attempting HTTP activation. Normal `/auth/register` still requires every vault,
outbox/verification, notification, roster, resolver and readiness effect; do not
turn on a partially adapted registration route.

A cold native profile can explicitly choose **Work on this device** after compatible
exact-origin capability negotiation. Initialization requires a fresh owned profile,
no existing workspace/account pointer or cookies, and the same live document and
immutable bundled runtime origin after asynchronous checks. The resulting local home is anonymous;
account APIs stay unavailable until actually configured. Real RootRecovery UI
checks pass at 1440/390/320px with a controlled host; actual iOS initialization and
edit/reload acceptance remain separate. [Browser evidence](../artifacts/anonymous-release-2026-11-12/device-home-recovery-ui/README.md).
The actual development app subsequently passed Work on this device, New folder
and Rename with the same local item ID. Active-scene admission removed the
observed provisional timeout in that run. Reload then preceded a task-app SIGABRT
in Apple LinguisticData/ProofReader by about182ms; the underlying assertion cause
is not established. The full acceptance receipt remains false, and the isolated
simulator was deleted. [Actual partial result and crash evidence](../artifacts/anonymous-release-2026-11-12/ios-webview-navigation/ui-followup/outcome.json).


## Remaining integration and acceptance

The following failed runs are retained as historical diagnosis; the helper-inclusive
run above supersedes their missing anonymous-workspace process replacement proof.


The fresh 1.3 run passes download/staging, dirty refusal, canonical persistence
and reload. It observes `renderer-ready`, then `cancel-pagehide` six milliseconds
later while close is pending, followed by a detached renderer frame. It does not
observe the terminal close/relaunch stages, so pagehide alone does not establish
the cause of missing process replacement. Cleanup passes. The later close
ownership correction has separate focused tests and needs its own actual path
acceptance. [Immutable 1.3 receipt](../artifacts/anonymous-release-2026-11-12/native-auto-activation/checkpoint-1.3.0/README.md).

The ownership-fix run passes the same download, dirty protection, persistence and
reload checks, but never reaches preparation or close: its final blocker is
`embeddedHttpIdle`, while renderer request/IPC counts are zero and the Nitro and
ChatGPT providers are idle. The bounded observation does not expose which HTTP
request or upgraded socket remains active. Cleanup succeeds. Thus the fix has
51 passing focused native checks but no positive actual close-path acceptance.
The next investigation must identify that real HTTP lifetime, not bypass it.
[Ownership-run evidence](../artifacts/anonymous-release-2026-11-12/native-auto-activation/close-ownership-1.3.0/README.md).

The earlier 1.2 diagnostics run observes a host-eligible state, zero work
counters and idle HTTP/ChatGPT/Nitro providers, followed by a prepare/release
exchange one millisecond apart. It again passes dirty refusal, persistence and
reload, then times out awaiting process replacement. Later bridge observations
are unavailable. The next required evidence is the renderer's checkpoint refusal
or the host's cancellation reason; neither is inferred from DOM state alone.
The retained launcher intentionally suppresses stdout, so that run has no host
heartbeat samples. A shell-only stderr correction preserves this suppression and
needs its own actual run. [Diagnostics evidence](../artifacts/anonymous-release-2026-11-12/native-auto-activation/host-eligibility-1.2.0/README.md).

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
   implemented. Guarded automatic activation passes the actual isolated anonymous
   workspace journey. Local-account/vault restoration and external frozen-process
   recovery remain open.
3. **P1 — iOS runtime and storage.** Continue from the actual simulator result:
   Node 24, genuine bcrypt and Sharp/libvips import the canonical Nitro bundle;
   a separate SQLite experiment verifies transactions and process-crash recovery.
   Connect that storage to the full API, stable local origin and lifecycle. Do not substitute
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
That earlier Fetch experiment exposed `DatabaseSync` but opened no SQLite
database; the separate 12 November SQLite probe above supplies that evidence.
A reserved non-listening loopback destination fenced Mongo in the Fetch fixture;
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
