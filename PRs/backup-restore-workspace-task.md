# Backup workspace implementation state

Starting branch: `codex/backup-restore-workspace`, base
`65d3b7e8e87e6fbb544f0935d6a45328af554dc7`.

The intended product flow is independent snapshot capture, paged review and
explicit destination-bound restore with durable progress after the page closes.
The selected production origin is Vercel. Existing Vercel Workflow continuation
is the supported durable scheduler; an additional privileged forever-running
supervisor is not selected. Browser requests must only admit/control work.

Current engines are trusted long-running Node 24 workers using private SQLite
scratch. Full inventory/preflight/capture/seal cannot be placed wholesale inside
one serverless request. The first implementation prerequisite is independent
destination registration, followed by bounded capture with a durable private
checkpoint. Checkpoints are scheduler-owned state,
never HTTP input or archived authority. Independent destination provisioning,
bounded seal verification and certified writer intents remain separate gates.

Independent destination registration now uses the existing encrypted admin
integration vault's fixed `portable-backup-destinations` label. The AWS OIDC
adapter refuses primary attachment bucket reuse. The read-only destination API
publishes configuration readiness only, never execution/provider proof. Live
separate-bucket/role provisioning and vault registration remain unverified.
No source credentials will be copied into job Things. UI readiness must
accurately expose unavailable storage/worker paths.

All acceptance fixtures must use a separate database/account/backend/browser and
synthetic file bytes. Whole-account readiness remains false.

Destination milestone verification: focused tests 7/7, capability tests 152/152,
raw TypeScript clean, compiled Nitro manifests/docs plus anonymous 401 passed.
The source branch was updated to `origin/main` at `520fb4ec7` before publication.
A scoped semantic Graphify attempt through the local proxy exceeded its bounded
75-second observer before completion; the prior snapshot was preserved. The
structural/code refresh remains usable; changed Markdown semantic coverage is
not claimed.


Continuation branch: `codex/backup-resumable-verification`, based on main
`d0699759b17ce6bcc71a340042d0bbd08d6d084a` after PR1398. The scoped continuation
composes a protected original-session coordinator, ID-only Vercel Workflow steps,
encrypted resumable SHA-256 and bounded pinned-timestamp producer/reference pass.
The snapshot engine uses independent retained bytes and canonical v1 multipart
fingerprints/manifests, not a new backup format. Reference traversal uses immutable
bounded sidecars and an index; no new Mongo collection or index is introduced.
Transient snapshot unavailability retries the same timestamp; history expiry is
an explicit new-backup dependency. Checkpoint uncertainty retains original IDs.

Coordinator actual Request-handler/API-utils replica evidence was independently
reviewed by the parent. It covers pause/revoke at content commit, protected read
and export refusal, encrypted hash CAS and killed-process continuation. Separate
producer cadence and actual integrated engine evidence remain in progress.
Snapshot unit interoperability is bounded synthetic evidence, not HTTP/browser,
deployed Workflow or live S3 acceptance. Review/restore/public admission/UI are
still unfinished. Prepared editable UI fragments remain unmounted and unshipped.

First actual snapshot engine proof passed through production Request handlers and
API-utils on a disposable replica, synthetic approved uploads and a private
independent local vault: 281 bounded units, 177,117 ms elapsed, maximum 4,352 ms
per unit. It recovered accepted capture-cursor acknowledgement loss and pause /
resume, removed the synthetic primary bytes, then independently verified the v1
seal and recovered current bytes, retained historical bytes and ordinary content.
Receipt basename: `1793969945563-a3125f704bd2bba6701f8fe046df4ea7121180e7c160be9cf2741075af7398f9.json`.
This is handler/API-utils + real replica evidence, not HTTP/browser/deployed
Workflow/S3 or selected-restore acceptance.

The 1,000-ordinary-item profile exposed a real cadence defect: source census had
only retained 1,325 items after 257 seconds and eventually refused the expired
pinned timestamp. It did not select a newer timestamp or publish a seal. Immutable
reference bundles and bounded verified-node caches reduced object round trips;
the remaining coordinator bottleneck was renewing/accounting the job lease on
every authorization read. Guard now freshly reads original session/principal and
exact live lease without writes, renewing transactionally only near expiry.
Canonical effects, checkpoints and hash CAS retain the full original transaction
fence. New guard unit tests pass, and actual producer/engine reruns are pending.

## Public workflow integration checkpoint — 7 November 2026

The first-party workspace now has typed, origin/account/home-scoped catalog,
browse, review and command contracts. Commands enqueue protected durable jobs;
HTTP never exhausts a backup or restore. The canonical Vercel Workflow advances
bounded units, and the existing scheduler authenticates a bounded dispatch
outbox. Fixed attempt IDs, original-session fences, generation/lease checks and
immutable receipts preserve pause/cancel, lost replies and process recovery.
Outbox scanning is oldest first with a stable keyset and persisted transient
backoff so stale or slow authority checks cannot permanently hide later jobs.
Scheduling acknowledgements do not establish executed Workflow or provider
readiness. Current-deployment first-step confirmation is separate from storage
read/write/restore acceptance; configured/unverified execution permits ordinary
admission to establish that confirmation, including recovery from old snapshots.

Presentation catalogs derive from verified plan items and exact-timestamp
retained parent/name descriptors. A separate bounded catalog stage prepares full
paths, caching immutable ancestry through at most 32 edges per unit. HTTP reads
prepared pages and signed continuations; it does not walk live source folders.
Selected restore still independently certifies the sealed graph and destination
revision. Presentation metadata never grants restore authority.

The isolated HTTP/browser harness uses a disposable replica/account, independent
private local object store, normal networking and a fresh Chrome profile. Its
provider and scheduling adapters are trusted fixture injection, not deployed
Vercel Workflow/S3 proof. The first complete desktop diagnostic exercised actual
login, canonical HTTP routing, snapshot, browse, review, restore, independent
current/historical bytes and ordinary readback, and nested Builder save/reload.
Mobile duplicate-name selection exposed a test selector bug; exact source-ID
selection and retained full paths address it. Final frozen desktop/mobile
acceptance remains open until the subsequent run passes.

Real provider provisioning/acceptance is still unavailable: authorized AWS CLI
identity checks returned InvalidClientTokenId and the supported saved-credential
fill refused its account binding. No bucket, role, vault configuration or secret
was changed. Hosted Workflow scheduling overhead, deployed cron execution and
large indivisible S3 part timing remain separate acceptance gates. Whole-account
readiness remains false; original ordinary Timeline history remains retained in
the archive rather than imported.


Frozen isolated HTTP/Chrome acceptance passed desktop and phone on
`1793977135531-74e17f4d4810643db84c5e7c3edd929eadf48071e7bf2209d6db06d02be8609d.json`.
This includes independent current/historical bytes, ordinary readback, the real
shared picker and nested Builder save/reload. The subsequent normal-device-entry
run passed actual Pause/Resume, a provider interruption persisted as
needs-attention, Retry and closed-page completion, then exposed device query
inheritance inside `ThingsPage.locationPicker`. The canonical embedded picker
now ignores only the containing device view selector, preserving its URL and
sync drafts. Final normal-entry rerun remains required after that correction.
Names/paths over the display budget have an explicit preview label, with full
source metadata retained losslessly; >4MiB Unicode metadata regression passes.


Final normal-device-entry regression PASS:
`1793978243479-260f56f368a24554cd08ee9928c9285b9c92329d4632d923e55662fec312e1ea.json`.
Both desktop and phone use actual `RemoteDeviceSync`, collapsed editable entry,
shared picker, review/restore, independent current/historical byte and ordinary
readback, and nested Builder save/reload. Desktop additionally covers actual
Pause/Resume, provider interruption persisted as needs-attention, Retry and page
closure/completion. Recovery is not claimed as separately exercised on phone.
229 HTTP requests measured a maximum 266.48ms locally; per-job bounded units and
elapsed timings are retained in the proof receipt. This is local HTTP/replica/
Chrome with independent local storage, not hosted Workflow/S3 or native install.

Updated exact-T descriptor-scale proof PASS: 6008 plan items, 135658ms census,
35883ms references, 186992ms full capture/seal/readback, max7577ms unit and
73604 fresh authorization calls under the unchanged 300s history floor.
Additional hosted dispatch budget 3353ms per 49 census units is theoretical;
actual hosted dispatch latency remains unmeasured. After this frozen proof,
the runner's workspace-mode source certificate list added `ThingsPage.tsx`;
producer runtime and measured scale behavior did not change.

The full raw TypeScript check passes. The backup unit batch passed 222 tests;
focused additional display-preview/legacy workspace/worker confirmation checks
pass separately. Existing ThingsPage hook lint warnings are retained; changed
backup/UI modules have no new lint errors. Final build/main integration and
normal protected PR checks remain publication gates.


The final scoped semantic Graphify attempt used the healthy local Codex proxy
and stopped at its 75-second bound without publishing partial output. The prior
active snapshot and other snapshots remain preserved. Structural/code refresh
is used for publication; changed Markdown semantic coverage is not claimed.
The compiled middleware smoke now passes all three registered backup contracts,
JSON docs and anonymous 401 refusals after canonical Request facade adaptation.
The facade's streamed body and cancellation regressions pass 10 focused tests.
