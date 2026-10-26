# Local workspaces

Implementation in progress on `codex/anonymous-local-first`. This is the normal
Thingtime application, separate from the stateless agent export sandbox in
[no-login-draft-preview.md](no-login-draft-preview.md). The full local-first
rollout is **not ready to merge** until the outstanding rows below are verified.

## Current continuation — 2026-10-25

The continuation starts from `5ab9283a19feca1a8328aa066ed037435032a9e8`
and reconciles `origin/develop` at `f41cf65629fe98423405de4bea4e5894f59ccb46`.
The earlier dated evidence below remains historical. See the [current evidence
index](../artifacts/anonymous-local-first-2026-10-25/README.md) for verification
status; implementation alone does not close the native or deployed gates.

Ordinary browser Actions can now read, save, select and delete device themes
and algorithms through their dedicated writers. They preserve independent
History and account synchronization. Public/search operations and arbitrary
managed endpoints remain outside this adapter. Account-backed profiles require
Home; changing a selected data plane does not silently move their storage.

Saved Actions can also annotate or remove standalone files through the existing
leased library writers. Annotation preserves the canonical `updatedAt` response;
local deletion retains normal child cleanup and refuses protected run history.
Account metadata/deletion queues remain independent from the Action result.
Bound, draft, expired and foreign files fail closed. Raw attachment bytes remain
on the dedicated file-reader path: the HTTP Action interpreter accepts JSON and
must not invent a binary response contract.

Account instructions larger than the existing 96 KiB atomic request boundary
remain editable and saved locally. Exact serialized UTF-8 preflight records a
revision-specific refusal and stops guaranteed retries. A later edit resumes
sync, while an uncertain earlier write is retained for receipt reconciliation.
This improves local completion and failure handling; it does not add larger
remote instruction transport.

Shared Fork now makes a private local copy for an anonymous user through the
normal validated importer. The selected origin's export capability is negotiated;
the complete root/dependency/file closure is read without account credentials,
reauthorized, then imported atomically with fresh legitimate IDs. A failure or
source change leaves no partial copy. This never creates or publishes an
account Thing. Signed-in behavior retains the existing account route. Larger originals use negotiated
`api.attachment-content` 1.18.0 streams with exact receipt/length checks and
fresh access checks before completion. Older origins refuse unsupported large
copies before downloading. Existing format, quota and receiving limits remain.


History can recover deleted device themes and algorithms through dedicated
protected writers. The recovery preserves their local identity, design, title
and surviving folder, restores private sharing, and leaves selection unchanged.
It does not reopen generic protected-Thing mutation. Account deletion must have
been acknowledged with no pending queue item or claim before recovery; an
unsent local create/delete has no retained tombstone and is refused explicitly.

The render-only MCP launcher runs the existing native renderer in a network-none
container with bounded resources and no host credentials or writable host mount.
An actual Codex CLI agent host now calls capabilities and render, receives embedded
JSON/PNG resources and reports malformed input without artifacts. The documented
extractor validates and saves those resources as downloadable files. This is
separate from the passing SDK acceptance and from the original desktop chat,
which has not reloaded its configured MCP tools. See the
[actual host proof](../artifacts/anonymous-local-first-2026-10-25/cli-agent-host/verification.json).

## Historical implementation and evidence — 2026-10-23

This checkpoint continues remote `fd49b8d1e63d106ad20d67a77271aaa2a2e4bf4d`.
Current `main` and feature refs were fetched and the newer main commits inspected;
this is not a claim that every newer main change was merged. The referenced
`HANDOFF.md` and `theme-history-in-progress.patch` were not present among the
uploaded files or in this workspace. The work below extends the existing shared
primitives; it does not claim that the missing patch was applied.

Live saved themes and algorithms now support History restore, undo and merge
through the shared planner and dedicated writers. Content, History and account
queue intent commit atomically. Current sharing, library title, folder, lineage
and selection are preserved. Theme Studio and its sync worker explicitly use
Home even when a custom database is selected. Same-head content changes invalidate previews;
concurrent exact retries return the committed result. Deleted protected content
and other protected kinds remain refused. Algorithm History archives use the
canonical exporter; remote algorithm-draft export negotiates `api.timeline`
1.22.0. This does not authorize generic server mutations of protected Things.

The normal feed now has an explicit **On this device** view and a first-page
offline/transient-error fallback for Latest/New and locally retained profiles.
It reads only the selected workspace's owned/retained projections, labels its
coverage as partial, and keeps online cursors separate. Community, location and
subspace membership feeds still require their real online sources. Generic Thing
headers use the shared audience display; matching subspace context informs the
label without granting access. The narrow floating assistant yields when it
would cover an active composer or its collapsed trigger.

Other fixes remove the obsolete 16 MiB editor-tree, 500-entry device-provider
and 12-selected-file admission caps; preserve actual transactional quota errors;
retry theme catalogue/selection reads on reconnect; resolve anonymous local
algorithm previews without HTTP; and route ordinary browser Action bulk
copy/move/delete through the existing leased writers. Account file copies use
complete device byte snapshots through the normal importer, with source
availability checked again inside the destination transaction. Separate valid
transfer files no longer share one aggregate admission budget. URL gallery
attachments reuse local drafts/templates and the account file journal, with
idempotent registration and cancellation receipts. External URL content remains
a reference; the application does not download it for offline storage. Remote
snapshot and individual transfer contracts remain bounded. See the [current source audit and remaining matrix](
../artifacts/anonymous-local-first-2026-10-23/matrix-source-audit.md).

Fresh [canonical JSON, native PNGs and usage examples](
../artifacts/anonymous-local-first-2026-10-23/README.md) are retained in the
repository. The SDK client actually calls the stdio MCP server in a namespace
without outbound networking, an account or a backend. The normal importer and
anonymous Builder run separately against a disposable full application with
browser **and** backend egress denied. This Linux harness is not the installed
macOS app. This chat has no callable Thingtime MCP connector, so its native
agent-host artifact connection remains unverified. No HTTP-only claim replaces
that missing connection.

Current regression reruns: 794 workspace tests plus four offline-shell checks
passed (94 browser opt-ins skipped in that broad run); Timeline 261 passed;
drafts 50 passed and nine opt-ins skipped; attachments 356 passed plus 12
prechecks. Changed-file lint has zero errors and nine warnings (including intentional unsafe-URL rejection fixtures).
The [verification index](../artifacts/anonymous-local-first-2026-10-23/CHECKS.md)
separately records actual native runs and immutable build fingerprints.
The original fetched tree has three missing
test-block closures in two attachment test files; those syntax errors were
repaired. A separately archived, syntax-repaired source baseline has 91
TypeScript diagnostics; the final frozen-product comparison has the same 91 normalized
signatures with none added or removed, including URL/draft/copy integration and the canonical MIME repair. An unqualified
clean typecheck is not claimed.

The dated sections below are historical checkpoints. Their `tmp/` links may be
absent in cloud and are not evidence of a current rerun. Wider managed imports,
transfer/capacity contracts, mail/provider and native-device checks remain open.
Nothing in this checkpoint merges, manually deploys, publishes content, or
changes existing real account data.

## Visible page-block recovery — 2026-10-19

Native visual review found the page-block refresh notice beneath the fixed
navigation. A forced resolver failure reproduced the overlap before the fix.
`SiteBlocksHost` now applies the shared safe-area/nav clearance to the notice,
centers its contents, and avoids duplicating that clearance in following global,
route and native content. Cached content and Retry remain available.

A fresh packaged-app run verifies forced 503, failed Retry, removal of the fault
and real API recovery at 1440×1000, 390×844 and 320px. Notice text starts at y=74
on desktop and y=70 on phones. The same run passes all 36 repeated audience views,
private guest/foreign refusals, scrolling and width checks. Zero page errors,
crashes or OOM; peak sampled namespace memory 2,645 MiB; runtime released.
The stress phase encounters genuine 429 responses; rate limits remain intact,
and these captures prove retained-content behavior, not all-success networking.
Evidence: `tmp/site-blocks-recovery-native/native/verification.json`, the three
`blocks-failure-*.png` files and audience screenshots. The baseline failure is
in `tmp/site-blocks-banner-baseline/`.

Eighteen focused tests, changed-file lint, client/template/server builds pass;
TypeScript retains exactly the same 91 baseline diagnostics. Visual review also
records an existing narrow-screen floating-assistant/composer overlap as a
separate open P1 check. Full local-first acceptance, protected version changes,
target-host MCP artifacts and exact-head CI/deployed verification remain open.
No account/public data, authentication, permissions or rate-limit changes.

## Bounded native navigation diagnostics — 2026-10-19

Repeated full-document navigation reproduced a renderer crash twice after 18
completed views. Both runtimes recorded an OOM kill. Per-navigation measurements
showed collectible documents accumulating (up to 18), with V8 heap growth from
55 MB to 594 MB and renderer RSS near 1.7 GB. A separate diagnostic probe reduced
six documents to one and heap from 196 MB to 40 MB by collecting garbage;
discarding console entries made no further difference. This identifies deferred
collection under the test VM's memory pressure, not a demonstrated application
reference leak.

The native fixture now bounds V8 old space to 256 MiB while retaining Chromium's
sandbox and the browser/backend network boundary. The actual acceptance run does
not force garbage collection. Three complete cycles (36 views at 1440, 390 and
320px) pass with no page errors, crashes or OOM. Peak sampled namespace usage was
2,560 MiB. Private guest/foreign refusals, public control, native labels, scrolling
and widths pass, and the runtime is released. Evidence is in
`tmp/inherited-audience-bounded/native/verification.json` and its twelve PNGs.

Diagnostics now record navigation responses, lifecycle and memory metrics;
failure JSON/PNG use unique run IDs and hashes. A failed capture is explicit.
The older `tmp/inherited-audience-navigation-failure/failure.png` is unpaired
legacy evidence, not proof of a blank page. Preserve the original failures in
`tmp/inherited-audience-diagnostics/` and `tmp/inherited-audience-memory/`.
The forced-GC probe in `tmp/inherited-audience-memory-probe/` is diagnosis only.
A separate single-app image build could not finish because the shared Docker VM
was out of disk space; no other task's images or installed app were removed.

The memory budget and diagnostic changes affect the acceptance fixture. The
separate retry-notice layout correction is recorded above. No API contract changes.
Changed-file lint and the native run pass. Earlier 732
workspace + four shell / 44 focused passes and 91 baseline TypeScript diagnostics
remain the prior product-code checkpoint. Full local-first, protected version
changes, target-host MCP artifacts and exact-head CI/deployed acceptance remain
open. No merge, deployment or public test exposure is included.

## Inherited audience labels and retained subspace context — 2026-10-19

A live private coordination comment incorrectly displayed “anyone can see this
post” on its standalone page. Unauthenticated reads of both the parent and
comment returned 404 without content. The label consumed the resolved parent ACL
but omitted the separate private-subspace membership boundary.

The shared audience display now describes inherited permissions without claiming
public access. Native regression also found that the owned local projection lost
the retained subspace embed after reload. Owned posts and thread context now keep
the matching subspace's display snapshot; an unknown or changed destination
explicitly reports missing access details. These projections never grant access,
change ACLs, copy link secrets, or add server/persisted authority fields.

The packaged native fixture checks a private parent, comment and nested reply,
plus an independently public post, through ordinary APIs and the actual UI.
Guest and foreign-account reads of all three private Things return 404; the
public control returns 200. First-load and repeated navigation at 1440×1000,
390×844 and 320px pass scrolling and width checks. Evidence is in
`tmp/inherited-audience-native/native/verification.json` and its twelve PNGs.
The browser/backend runtime uses network:none and disposable data, and is released.

Validation: 732 workspace checks, four offline-shell checks and 44 focused checks
pass; the native opt-in runs separately. Builds and changed-file lint pass, and
TypeScript retains the identical 91 baseline diagnostics. Deployed code still has
the old label; this PR contains the local fix. No API contract or authorization
change, merge or manual deployment is included. Protected restore/undo/merge,
the remaining local matrix and target-host MCP artifacts remain open.

Earlier runs included an incorrect fixture status expectation and a stale local
HTML template, both corrected in the harness. Two later runs had intermittent
blank navigations without a classified cause. The final instrumented run passed
all twelve page/viewport combinations with no page errors or crash events and
zero OOM. The earlier diagnostics remain in
`tmp/inherited-audience-navigation-failure/failure.json`; blank-navigation
stability remains a separate P1 item, not a closed acceptance gate.

## Native account theme History — 2026-10-19

The packaged application now has native account-theme History acceptance through
`accountThemeHistory.browser.test.ts`. Three edits through Theme Studio survive
cold offline reload. Two earlier versions download through the normal History UI
and pass the canonical History-export parser with exact before/after tokens and
private device-draft provenance. These are History archives, not transfer bundles.

The real isolated API accepts History while theme-content writes receive a forced
503; the account theme remains unchanged until its separate retry. Reversing the
failure proves content can synchronize while History remains queued, then History
retry accepts the same event. Content receipts never acknowledge History and
remote refresh/acknowledgement creates no extra device versions. Guest theme and
History reads and a foreign account's theme/version export are refused.

Native 1440×1000, 390×844 and 320px History/detail views pass scrolling and bounds
checks. Zero page errors or offline mutation requests were observed. The manager
runtime enforces network:none, no host mounts/published ports, read-only root and
disposable data; IPv4/mapped-IPv6 egress denial, zero OOM and empty cleanup pass.
Evidence: `tmp/account-theme-history-native/native/verification.json`, both
`theme-history-*.json` exports and `account-theme-history-*.png` screenshots.

Fourteen focused History checks and changed-file lint pass. TypeScript reports
the identical 91 baseline diagnostics. The current packaged client/server from
52a03edde was reused; this checkpoint adds acceptance coverage and documentation,
not an application or API contract change. Initial fixture failures came from
missing online emulation/account headers and reloading before Save finished;
the final test waits for normal UI completion and preserves production cookies.

Protected theme/algorithm restore, undo and merge, native import/move/title/delete
History coverage, selected-custom-plane History acceptance, the broader local
matrix, target-host MCP artifacts and final CI/deployed verification remain open.
No merge, manual deployment, existing-account data or installed-app change occurs.

## Account large-file download and retention — 2026-10-19

Ordinary account-file downloads now obtain the canonical scoped export plan instead
of constructing a synthetic plan and inheriting the paired-device 32 MiB cap.
They negotiate the export/content contracts they use; missing paired-device
capabilities do not prevent a download. Account, Character, data-plane and abort
leases remain enforced. Paired-device limits and the canonical transfer format's
512 MiB per-file bound remain unchanged.

The new opt-in `accountLargeFiles.browser.test.ts` reproduces the previous failure:
a 70 MiB file completes locally and uploads, but a clean browser displays
“Choose a file up to 32 MiB.” With the fix, the same native flow passes offline
save/cold reload/exact download, real private upload on reconnect, clean-context
download without device capabilities, owned-original retention through the normal
inspector, and another offline cold reload/download. All bytes match independent
SHA-256 `fa2217c74958e707a26a89aacdbc0392dffcbfc5836276659e09fe7b5a18d5f3`.
Guest and foreign-owner reads are refused. Desktop 1440×1000, mobile 390×844 and
320px layouts pass top-to-bottom scrolling with zero overflow, page errors,
whole-file Blob reads or offline mutation requests.

Validation: 731 workspace + four offline-shell checks, 23 focused transfer checks,
client/server builds and changed-file lint pass. TypeScript retains the same 91
baseline diagnostics. The native fixture ran explicitly (default suite skips 80
opt-in cases). Evidence: `tmp/account-large-files-native/native/verification.json`
and PNGs; baseline refusal: `tmp/account-large-files-baseline/native/failure.json`.
The task-owned runtime enforced network:none, no host mounts/published ports,
read-only root and disposable data; zero OOM and empty cleanup were verified.
The fixture uses browser authentication on loopback without changing Secure-cookie
policy. No existing account data, production settings or installed app was changed.

This closes native ordinary-account retention/download acceptance for this size.
Larger transfer limits, clipboard buffering, paired-device transport, catalogue
and traversal capacity, the full local-first matrix, final-head CI/deployment and
target-host MCP artifact delivery remain open. No merge or deployment is included.

## Native large-file and ZIP checkpoint — 2026-10-19

The ordinary anonymous file browser now has real packaged-app acceptance for a
70 MiB file: native selection, independent copy, offline cold reload, exact
native download, canonical folder ZIP export, normal Import dialog and re-export
with remapped identities. SHA-256 matches an independently hashed source. Invalid
JSON reports a visible error; closing an in-progress ZIP parse creates no copies,
and a fresh import succeeds. Image decoding, opened dialogs and top-to-bottom
layout pass at 1440×1000, 390×844 and 320px. No account records, queued account
commands, mutation requests, page errors or whole-file Blob reads were observed.

ZIP decoding now coalesces inflater output in bounded 256 KiB buffers before
creating browser Blob handles. This avoids creating a handle for every small
inflater callback while retaining entry limits, integrity checks and cancellation.
A regression verifies handle count and exact contents; no speedup is claimed.

Validation: 731 workspace tests plus four offline-shell checks pass (79 opt-ins
skipped by that command); the native file fixture ran explicitly and passed.
The 33 focused storage/transfer and 21 archive checks overlap the broad suite.
Client/server builds pass, changed-file lint is clean, and TypeScript retains 91
baseline diagnostics with none in changed files. Evidence:
`tmp/file-blobs-native/native/verification.json`, native PNGs and
`large-transfer.thingtime.json` (manifest only; its binary is not embedded).
The task-owned runtime enforced network:none, read-only root, no host mounts or
published ports, with disposable storage, zero OOM events and confirmed cleanup.
Large fixture inputs/downloads used private runtime scratch; earlier harness
failures remain recorded separately.

This supersedes the historical nested macOS sandbox blocker for these anonymous
checks. Account large-file retention/download, paired-device transports, clipboard
serialization, actual browser quota exhaustion and remaining feature/capacity
coverage are still open. The account download and retention checkpoint above now covers the former
32 MiB reader limit; this earlier fixture exercises anonymous local files.
The target-host MCP artifact connection and final-head CI/deployed acceptance
remain separate gates. No merge or deployment is included.

## Character navigation and media checkpoint — 2026-10-19

The Things workspace selector opens retained Character content through the same
validated roster gate as post permalinks. Library, inspector, post/reply/parent
and History links retain the editor selection. Account controls, copied share
links and external destinations do not inherit it. View caches include the
principal/actor partition, and changing the selection retires the old view.

Quick comments use the selected actor's existing account facade. Selecting the
principal clears an inherited Character scope; anonymous display identities
remain on the anonymous facade. A target unavailable in that actor's partition
still requires an authorized online read. No private parent is copied between
actors to make an offline comment succeed.

Local image registries now share the validated editor's principal/actor scope,
retain the normal file-read lease, and revoke object URLs when their last view
leaves. Shared links and URL-supplied ownership parameters cannot select device
bytes. Remote media continues through the existing authorization path.

Validation: 12 focused navigation/API tests and 730 workspace tests plus four
offline-shell checks pass (79 opt-in fixtures skipped). Client/server builds pass;
changed-file lint has no errors and four existing warnings. Typecheck retains the
same 91 baseline diagnostics. Explicit isolated native acceptance verifies image
decoding, cold reload, library selection, quick comments, reply/parent links,
History-to-inspector navigation, revoked image URLs and private reconnect at
1440/390/320px. Separate draft-save failures do not block posts or files.
Evidence: `tmp/character-navigation-native/native/verification.json` and PNGs.
This is a local packaged-app checkpoint; final-head CI/deployed acceptance,
remaining feature-specific Character routes, and the target-host MCP artifact
connection stay open. No merge or deployment is included.

## Character profile sync checkpoint — 2026-10-19

Theme and feed-algorithm synchronization now resolves the requested or
session-selected Character through the existing live-session authorization path.
The actor is checked again before mutation and before private response disclosure;
foreign, disabled or mismatched actors never fall back to the principal. Clients
negotiate `api.auth-characters` 1.0.0 plus `api.themes-sync` 1.6.0 or
`api.algorithms-sync` 1.4.0, and send the Character and selected-plane fences.
Both capability manifests derive these versions from the canonical registry.

Local checks: 57 focused transport/route/manifest tests; 723 workspace tests plus
four offline-shell tests. The new native browser/API fixture passes against the
built server: two owning accounts, three Characters, private isolated catalogues,
conditional saves and selection, exact retry receipts, session selection, guest
and foreign-Character refusal, wrong-plane refusal and disabled-Character refusal.
Evidence: `tmp/character-profile-sync-native/native/verification.json` and
`tmp/character-profile-sync-native/`. The runtime used network:none, no mounts or
published ports, and was released without OOM. Client/server builds and lint pass;
TypeScript retains the same 91 baseline diagnostics with no new signatures.
An earlier harness run timed out because Chromium reported offline inside the
sealed runtime; the existing loopback connectivity emulation fixed the fixture
without changing its network boundary. Obsolete task-owned images were removed
after the runtime build encountered full Docker storage.

This is a prerequisite for broader delegated workspaces. Offline Character
posting, attachment completion, principal-scoped History caches, the remaining
workspace matrix, final-head CI/deployed acceptance and target-host MCP artifacts
remain open. No merge or deployment is included.

## Character draft checkpoint — 2026-10-19

Storage follow-up: 720 workspace and four offline-shell checks pass. Nine focused
checks pass (overlapping coverage), including 257 retained Characters and
cancellation during identity retirement. Native offline Settings matches the
fixture’s independent record bytes/counts at 1440/390/320px; draft isolation,
verified reconnect and independent private posting still pass. Client/server
builds pass; lint has no errors and one existing warning; the 91 TypeScript
baseline diagnostics are unchanged. Evidence: `tmp/character-storage-native/`.
The network-none runtime was released. Current-head CI/deployment and full
Character workspace coverage remain open.

The device-storage meter now includes principal-owned delegated Character
partitions in the selected database. Its readonly snapshot discovers keys from
both records and ledgers, validates every included ledger, and returns only
aggregate bytes/counts. Missing or orphaned accounting is an error, preserving
the last known UI total. Other origins, principals, direct Character sign-ins
and data planes stay separate; no new remote request or authority is introduced.

Delegated composer drafts now use the existing account draft/catalog/file queues
in a partition keyed by origin, principal, Character and data plane. Owner drafts,
other Characters and direct Character sign-in remain separate. The roster keeps
only selector labels on this device, with no retained credentials or management
authority. Remote sync still requires current root confirmation, capability
negotiation and server-checked delegation. The normal draft picker and shared
sync review panel expose this work; posting does not wait for the draft queue.

Local regression: 718 workspace tests and four offline-shell checks pass; 77
opt-in checks are skipped in that command. Changed-file lint has no errors and
one existing storage warning. The production client/server build passes and the
TypeScript comparison retains 91 baseline diagnostics. Native Character draft
acceptance passes offline cold reload, owner/two-actor isolation, automatic
verified reconnect, 1440/390/320px layout and independent private posting while
draft sync returns 503. The canonical post projection confirms author/text/ACL;
anonymous reading returns 404. The isolated runtime was released with zero OOM.
The test caught duplicate React keys leaving two composers; those keys are now
distinct and each switch asserts exactly one editor. Background remote-only
features can still show a reconnect toast; broader offline UI cleanup remains.
Delegated offline posting, attachment-picker integration, storage cleanup and
the remaining Character feature matrix stay open. This is not final-head CI or
deployed acceptance.

## Audit of existing support

- `ThingtimeProvider` has serialized autosave and cross-tab updates. Its native
  tree now uses the shared workspace transaction adapter, scoped by account,
  origin and data plane. Earlier localforage keys are preserved: anonymous data
  migrates only to the anonymous partition, while owner-only account trees need
  an explicit reviewed copy because their database provenance is unknown.
  Anonymous content is never automatically claimed by an account.
- Timeline already has canonical event/link records, IndexedDB recovery, branch
  and note queues. Account history discovers an authenticated remote scope; the anonymous
  adapter now has a separate browser-local authority (checkpoint below).
- Account drafts already have bounded snapshots, immutable write IDs, revision
  conflicts, discard tombstones and independent template copies.
- `/things` previously created a server temporary account automatically. That
  was a remote account, not a browser-only workspace. This branch removes that
  implicit request; explicit authentication endpoints retain their checks.
- Modern Things, Builder, components, schemas, Actions, themes and algorithms
  mostly use `useApi`, with additional direct clients for drafts, webpage
  resolution, suite installation, attachments and Actions.
- The existing media service worker reauthorizes private media on every use,
  including cache hits. It cannot be used as an offline private-media bypass.
  It did not previously cache the static app shell or route chunks.

## Storage and authority

`app/local-workspace` is a browser adapter behind the existing application API.
UI components do not open IndexedDB themselves. Local records use the shared
Thing crystal validator, composition reference rewriter and portable transfer
collector/validator. Local bookkeeping is excluded from exported content.

The anonymous namespace belongs to this browser origin. It is distinct from
every signed-in account, API origin and remote data plane. `useWorkspaceUser`
supplies content ownership to local-capable editors; `useCurrentUser` remains
the authentication hook. Local identity is not accepted by server endpoints.
Identity changes invalidate outstanding local operations and abort transactions.
Anonymous work is never implicitly adopted by or uploaded to a later login.

Writes and usage accounting are transactional across tabs. IndexedDB admission
uses actual browser/device capacity, without a Thingtime-wide record-count,
aggregate-byte, ordinary JSON-record or raw byte-record ceiling. Native
`QuotaExceededError` becomes `LOCAL_QUOTA` (507); the whole failed transaction
rolls back. Canonical Timeline event bounds and the account password codec
contract remain enforced. Native file/ZIP paths use Blob handles and chunked
hashing; native editor trees no longer have the obsolete 16 MiB envelope limit.
Canonical transfer/traversal, clipboard and remote transport bounds remain
separate contracts requiring further capacity work. Failed saves report an error;
failed imports roll back. Optimistic concurrency checks retain an editor's
base timestamp. Files require the dedicated local attachment adapter rather than
reusing account attachment IDs.

Anonymous public catalog reads omit credentials. Public catalog cache entries
grant no ownership or write permission. Local writes and cloud operations have
explicitly different implementations; a missing local implementation fails
rather than falling through to an account mutation.

The offline app shell contains only build-produced static files. The build
manifest pins sizes and SHA-256 checksums, caps assets at 2,500 / 96 MiB and uses
four download workers with a 90-second overall deadline. A partial or mixed
deployment cannot become a ready offline shell. Account API responses, bearer
URLs and private media are excluded. The existing media authorization checks
remain in place. The local root fallback stores a confirmed anonymous marker or a minimal account
workspace pointer (origin, account ID and data plane). It never stores a profile
or credential, and an offline root has `user: null`. Local content identity
cannot authorize remote requests. Only the latest accepted root response may
change this pointer; logout/account changes revoke it.

## Coverage and remaining acceptance work

| Area | Current evidence / required completion |
| --- | --- |
| Local storage and account boundaries | Unit-tested persistence, atomic rollback, concurrent edits, scope isolation and identity invalidation. Settings now shows scoped device usage and offers browser eviction protection without login, with offline reload, other-tab writes and failed-accounting browser checks. Finish broader multi-tab and account-switch regressions. |
| Builder pages | Live logged-out create, text edit, save and reload verified. Component reference maps now reuse canonical selection, with export/render agreement tested for versioned aliases. Finish responsive, component UI, global/site block and interaction checks. |
| Things and folders | Core CRUD, folder placement, cycle checks, copy/move/delete and portable text/component transfer implemented. Library text search now works across folders offline, with bounded cursor pages and visible error/retry states. Clean-browser acceptance covers 61 matches, kind filters, rename/reload and grid/list mouse selection at 1440/390/320px. The earlier checkbox report came from targeting its hidden input; clicking the visible label works, and descriptive labels/regressions now cover it. The native Search page now has a separate structured device view, with canonical field operators and credential-free anonymous online search (checkpoint below). The normal 20-file import dialog passes offline on integrated package `2f0710ac`, retaining 20 independent IDs and exact Unicode after cold reload at 1440/390/320px (`capacity-integrated-native/`). Account file-bearing copy/fork has focused source/queue tests. The normal Duplicate native scenario now passes on repaired package `15e93be0`: one test, zero skips, 60.04 seconds (`account-file-copy/README.md`). Offline copies retain fresh IDs and exact 18,504-byte content through cold reload; copied content/file upload and placement finish while the source upload fails, then normal Retry completes the source. Real reads verify both folders, exact bytes and guest 404; all three viewport sizes pass. Shared Fork UI still uses its online endpoint and is outside this native local-copy proof. Advanced shortcut filters/ranking, wider account discovery caching and remaining normal UI flows still require completion. |
| Drafts and templates | Shared snapshot/retry/conflict/tombstone semantics implemented locally and unit-tested. Post template creation, independent media copies and reuse pass offline browser checks. Schema builder/form recovery now passes offline reload and malformed-copy preservation checks (checkpoint below). Shared Builder definition and Component source-control recovery now pass anonymous/account offline browser checks (checkpoint below). Direct URL selections, mixed URL/byte drafts, template/recovery copies and receipt-dependent account drafts now pass service tests; four native linked-gallery/composer scenarios now pass on integrated package `2f0710ac` (see `linked-gallery/manifest.json` in the 23 October artifact directory). Independent draft and post completion also passes both directions on that package: each queue progresses while the other response is held and then lost, with exact retry identity, cold reload and preserved templates (`posting/integrated-final/`). Finish other editor consumers, cross-device conflicts and wider account draft acceptance. |
| Components and schemas | Local storage and public discovery adapter started. Bundled suite installation and the Web Standards editable component save/export now have offline browser evidence. The schema catalogue, schema authoring, copies and data forms now pass offline browser checks (checkpoint below). Component catalogue/detail and argument/version recovery now pass local offline browser checks (checkpoint below). Visited online account catalogue pages now retain owned definitions for device browsing; Component/Schema catalogue and Component detail cross-tab refresh pass local browser checks (checkpoint below). Anonymous bundled bookmarks/reactions now survive offline reload and cross-tab changes without becoming owned Things (checkpoint below). Cached owned account bookmarks/reactions now complete locally and use conditional independent sync, with offline, lost-response and conflict-review browser evidence (checkpoint below). Finish remaining Builder surfaces, unvisited account discovery and broader cache membership. Generic local Thing details now expose the standard discussion projection; comments, nested replies, search and owner rename pass a cold-offline browser regression. |
| Actions and app suites | Anonymous data Actions now reuse the canonical interpreter with local schema-scoped CRUD, nested runs, expressions and packs; pure browser flows reuse the browser interpreter. Native no-login create/edit/run/error/history/export/import verified offline. Local page component/collection sources now load and refresh after controls, with cold offline reload evidence. Bundled suites now install atomically offline; browser Actions have closed local Things CRUD and data-Action request adapters. Browser Action bulk copy/move/delete uses ordinary leased writers without an extra selection cap. Copy requires a complete editable closure and rechecks the source inside the destination transaction; unavailable protected children are explicitly refused. Dedicated protected/file endpoint adapters and remaining Component surfaces remain. Retained owned account data/browser Actions now execute locally and queue ordinary effects; live custom-plane acceptance remains pending. The actual opaque-origin Web Platform runtime now runs after a cold offline reload, including worker programs and native form events, with the existing sandbox and network restrictions. External lookups and public/system searches remain explicit remote requirements. |
| Timeline | Canonical anonymous revisions and authored draft admission now use transactional browser authority, the existing History UI and recorded native page previews. Owner notes now save/remove offline through the existing canonical queue and note contract. Version names now name/rename/clear through the shared mutation contract offline. Local variations now create, advance, checkout, edit and merge offline in History and the native Builder, including recorded-component conflict review. Ordinary current-content restore/undo/merge and deleted recovery now reuse the canonical account planner and atomic local writer; native offline restore/undo/merge/reload is verified. Historical version archive export now works offline through the shared account resolver, including compact ancestry, deleted before-images, names and notes. Page + related History now resolves stored local composition and arguments offline, with bounded membership, cursor resets and cold-reload browser coverage. The managed Timeline folder now appears in the local library and literal search, with native offline navigation and cold-rename coverage. Scoped device usage and browser protection controls are available in Settings. Live theme/algorithm restore, undo and merge now use dedicated transactional adapters (23 October checkpoint). Deleted protected recovery, other protected kinds and broader synchronization acceptance remain required. Restored component detail/discussion/Action routing now uses scoped local records and local author projections, with offline regression coverage; IDs alone grant no local access. |
| Attachments and media | Anonymous canonical ZIP import/export/copy/delete now stores metadata and bytes atomically with shared quota accounting; normal UI offline round-trip verified. Normal file-picker save, download, copy/move and native image preview now pass offline browser checks. Native composer file selection and draft/template copies now pass offline browser checks. Account upload and metadata queues now have local service/browser acceptance, including reviewed conflicts and folder dependencies. Completed standalone-file deletion has a durable scoped queue, native review and replay fencing. Ordinary account picker/list/media integration, existing-file retention and file ZIP transfer have browser evidence in the checkpoints below. Standalone recording import/retention and independent offline edit/delete use the shared path (checkpoint below). Post/comment linked galleries now support metadata-only local import/export, normal Attach-by-URL selection, draft/template copies, binding and guarded account reconciliation. Bound byte/URL annotations validate owner, target, immutable content and current version. Four native linked scenarios pass on integrated package `2f0710ac`: anonymous/account mixed ZIP transfer and anonymous/account direct URL composer/draft/template. The artifact manifest records exact URL annotations, order, copied IDs, stored bytes, lost registration response recovery and guest refusal; it does not claim native stored-file annotation coverage or every control hit target. Bound metadata checks pass 64 focused tests after three old response stubs were corrected to include canonical `targetId`; production identity validation was unchanged. Only known device URL registration receipts become editable retained rows; first-seen server-only links use canonical transfer to create independent copies. Other managed targets, native microphone capture, audio cache identity/revocation and remaining audio/video acceptance remain. Never treat a cached cloud attachment as locally authorized bytes. |
| Posts, comments and saved items | Native local post create/edit, image attachments, comment/reply reads and writes pass offline browser checks. Saved items, emoji reactions and poll cast/change/removal now pass native offline browser checks; up/down votes and scoped relational storage pass adapter tests. Retained account posts now support offline bookmarks/reactions, Saved/permalink reload and cross-tab membership, with independent conditional sync and known-refusal eviction (checkpoint below). Generic account discussions and canonical comment-only permalinks now retain scoped offline reads with explicit partial coverage and atomic cross-projection refusal cleanup (checkpoint below). Account text/rich-text post and comment/reply authorship now commits locally with independent verified-account sync (checkpoint below). Account post/comment file admission, upload dependency tracking and canonical binding now use the device queue (checkpoint below). Device-authored bound-media removal now has offline/retry coverage (checkpoint below). Existing owned bound-file retention now has fresh-device offline edit/removal and reconnect evidence (checkpoint below). Offline parent/root navigation now has anonymous/account native-browser evidence, including generic Thing discussions (checkpoint below). Integrated package `2f0710ac` now verifies private posting and draft saving independently in both directions, including lost replies, stable retry IDs and cold reload (`posting/integrated-final/`). Mixed byte/URL gallery transfer and account binding have their separate four-case native manifest. Remaining linked-Thing surfaces, full edit/privacy/deletion browser coverage and broader cross-account/device acceptance remain. Public posting, remote reactions and recipient delivery remain authenticated operations. |
| Themes, visual settings and algorithms | Anonymous saved-theme CRUD, active selection, quota and canonical transfer now work through Theme Studio and have offline browser evidence. Anonymous algorithms now support local CRUD/branching, active selection, bounded public-feed training, per-page ranking and canonical JSON round-trip. Account themes have independent device content/selection sync and canonical offline export/import; anonymous themes have canonical local History. Account theme organization now commits locally with independent conditional sync; anonymous folder deletion preserves children. Theme library display titles now rename locally and survive canonical transfer, with anonymous/account native browser and isolated real API verification (checkpoint below). Account algorithms now have native offline editor/selection/transfer and reviewed conflict-copy acceptance. Normal library display titles survive offline Rename, export/import and conditional sync, with real API and clean-browser evidence. Anonymous, Home and custom-selected account organization now pass native offline/reconnect checks, with Home theme placement preserved. Account-authored theme save/import/move/title/delete History uses the canonical device draft queue and exporter. Live theme/algorithm restore, undo and merge are now implemented; algorithm native anonymous/account acceptance and actual API receipts/export pass. Seven theme History/organization/import scenarios pass in the isolated application on the recorded edd245b3 package; their exact boundary is linked in the 23 October checkpoint. Deleted protected recovery, other protected-kind titles and wider cross-tab acceptance remain outstanding. |
| Passwords | Anonymous encrypted device storage/unlock now reuses the canonical vault envelopes and normal password editor/transfer UI. Offline clean-browser acceptance covers lock/reload, two-tab conflicts, normal CSV export/import and 1440/390/320px layouts with zero account/password API writes. Account encrypted device unlock/edit/export now has offline browser evidence, with separately fenced sync, immutable retries and reviewed conflict copies. The real fixture verifies reconnect and second-account isolation. Account attachment UI now commits files locally with independent push/pull, encrypted remote-only availability, complete-backup refusal and native offline/reconnect/fresh-device evidence (2026-10-18 checkpoint below). Wider native identity/plane transitions, large-entry/capacity parity and signed offline provider integration remain unfinished. See [password-manager.md](password-manager.md). |
| Incoming mail | Anonymous Mail and Email settings now reuse the encrypted store; account mail is partitioned by selected origin and owner. Local reads/settings do not wait for cloud completion, and cloud/Gmail/relay requests require verified account authority. Crypto/transaction retirement, no-network refusal and 2,001-message retention have local tests (checkpoint below). Independent account-settings queues now pass native offline save, cold reload, lost-response retry with newer local intent, both conflict choices and guest refusal through the real isolated API (23 October evidence, e7427480 package). Reader coverage, wider cross-tab/origin transitions and real provider delivery remain separate. |
| Apps, integrations and native/browser tools | Separate locally available adapters from paired remote devices, external services and their consent requirements. Verify each applicable local surface. |
| Lopu and automation | Local documents, authored definitions and drafts should remain editable. Lopu toast/stream messages now persist locally and have a device-history view; verified account messages sync through the existing recorder. Remote social history caching, retry controls and cross-tab history refresh remain unfinished. Personal account instructions pass native offline settings/reload, lost-reply reconciliation with a newer edit, both reviewed conflict choices and guest refusal on integrated package `2f0710ac` (`account-instructions/integrated-final/`, one test, zero skips, 91.8 seconds). Larger instruction transport and wider history surfaces remain separate. Provider inference, external delivery and hosted scheduled execution still need their real services. |
| Auth, social, remote devices, billing and admin | Remote authority is retained. Do not substitute a local actor for a signed-in account. |
| Offline startup | Verified static-shell cache implementation and policy tests added. Production-build offline reload, editing, save and second reload passed in a clean local origin. A rebuilt shell also passed account cold reload/edit/reload with no networking. Continue update recovery, cross-account coverage and real-device startup verification. Chromium offline-emulation module cancellations remain under investigation; request blocking is no longer accepted without its root-read failure probe; the latest checkpoint defaults to actual offline emulation and retains failures as merge gates. |
| Signed-in local-first operation | Owned data/folder/page/component/schema/Action creates and updates now have an atomic account-scoped queue, immutable ambiguous retries, conditional updates and reviewed conflict choices. Native Builder resolves pending pages locally. Local fixture create/edit/reload/reconnect and conflict review passed. Account offline cold startup, native page editing and reconnect verification now pass locally. Ordinary account bulk moves now commit locally with queue intent, survive cold offline folder reload, and sync conditionally after verified reconnect. Ordinary account deletion and Builder reset now commit locally, retain conditional deletion intent and expose reviewed conflicts (checkpoint below). Ordinary JSON imports now create private independent local copies with atomic queue intent and verified canonical server round-trip (checkpoint below). Ordinary JSON downloads now use device content and complete scoped export snapshots, with native offline dialog/download/reload and normal-importer round-trip evidence (checkpoint below). Standalone file ZIP imports/exports now finish locally through the normal dialogs (checkpoints below). Post/comment ZIP imports now use the same local transaction and receipt-dependent queue (checkpoint below). Post/comment linked metadata imports and direct URL drafts now use the existing account-file journal with stable request identity, conditional annotations and durable target/version-fenced deletion; native anonymous/account linked transfer and composer cases now pass on integrated package `2f0710ac`. Ordinary file-bearing Duplicate passes the complete native offline/reconnect flow on repaired package `15e93be0`, including exact bytes, independent upload failure/retry, canonical annotation/move, both file folder placements, guest 404 and 1440/390/320px. The same-file receipt MIME repair preserves the original local MIME and strict identity checks (`file-mime-repair/`). Shared Fork UI remains a separate online path; its local integration/native acceptance is not claimed. Managed kinds without an implemented dedicated adapter, full remote list membership/pagination and broader multi-tab UI refresh remain. Theme/algorithm operations already covered by their dedicated adapters are not listed as missing generic writes. No anonymous sync queue may be replayed as account content. |

The final workspace regression passes 794 tests with 94 opt-in skips, followed by
four passing offline-shell checks (`regression/workspace-copy-repair.log` in the
23 October artifact directory). Skipped browser cases are not counted as passes.
The earlier integrated run's three bound-media failures were stale response stubs
missing canonical attachment `targetId`; the 64-test focused correction and final
regression pass are recorded separately. The final TypeScript comparison retains
91 baseline diagnostic signatures with zero added or removed
(`regression/typecheck-copy-repair-comparison.json`); this is not a clean typecheck
claim. Native scenarios above retain their exact package and fixture boundaries.

## Development verification

Run `npm --prefix remix run test:local-workspace` for the storage, draft,
transport and offline-shell tests. Run the existing media-cache suite as well:
`node --test remix/scripts/media-cache.test.mjs`.

`npm --prefix remix run build:client` now prepares the static offline manifest.
Development HMR modules are deliberately not cached. Test offline startup
against a production client build, using an isolated test origin and clean
browser profile. Keep Mongo/account fixtures disposable and use the real APIs
for any authenticated test setup.

The browser evidence in this document is local. Consult PR #1000 checks for the
exact pushed revision; the full rollout has not been merged.


Posting independence is delivered separately in [PR #999](https://github.com/lopugit/thingtime/pull/999).
Posts, edits, rich comments and plain comments/replies no longer await draft
sync or cleanup. Local browser acceptance blocked the draft endpoint while a
private post and mobile comment/reply still completed. This does not imply the
full anonymous/offline feature matrix above is complete.

## Account sync checkpoint — 2026-10-16

`accountSync.ts` commits canonical Thing content and its queue entry in the same
IndexedDB transaction. Scopes include origin, account ID and data plane. Every
remote read and write carries the existing expected-actor and expected-data-plane
headers. Session mismatch invalidates the worker and refreshes root identity;
temporary/anonymous sessions do not start account workers. No anonymous-to-account
migration occurs.

Ambiguous outcomes retain the exact frozen create/update body. Create IDs are
stable UUIDs; updates use the acknowledged server timestamp. A lost response is
acknowledged only after an owned, matching readback. Account timestamps and local
editor tokens are separate, so acknowledging sync does not invalidate the next
save. Definitive validation failures allow corrected content to be retried.
Unsupported fields retain their dedicated adapter; pending local writes refuse
an incompatible online mutation rather than dropping attachments or controls.

Conflicts stop automatic replay. The review UI compares both versions and lets
the user keep either one. Applying a choice rechecks the reviewed server timestamp
and local revision. Typing, another tab or another device invalidates stale review.
Keeping the local version sends a fresh conditional write; keeping the account
version invalidates old editor tokens. This is explicit replacement, not an
automatic semantic merge.

Native Builder reads the same local page/component data, reusing the canonical
component selector. Previously authorized component dependencies are cached under
the account/page scope without ownership or bearer credentials. Missing dependencies
fail explicitly. The account queue does not execute authored Actions.

Local browser evidence used a disposable private fixture on Vite `22460`, Nitro
`22462` and an isolated Mongo replica on `22463`. Blocking the Things and webpage
resolver endpoints still allowed create, edit, save, native render and reload.
Unblocking and retrying produced the same private Thing on the fixture server.
A concurrent server edit produced a conflict; explicit keep-local then synced the
reviewed content. The sync panel was measured at 320/390 CSS pixels with no
horizontal overflow and at 1440×1000. Test network/viewport overrides were removed
and the fixture was logged out. This is endpoint-outage recovery with an available
root session, **not proof of signed-in cold startup completely offline**.

Retained local evidence (ignored, not deployed):
`tmp/draft-qa/account-conflict-desktop.png`,
`tmp/draft-qa/account-conflict-320.png`,
`tmp/account-sync/remote-verification.json`.

## Offline account startup checkpoint — 2026-10-16

The browser can reopen its last confirmed account workspace after a retryable
root/network failure. That fallback contains no authenticated user, profile,
permissions, session or deployment environment. The ordinary authentication hook
continues to return null. A separate content-ownership hook keeps the editor and
local tree in the same origin/account/data-plane namespace, avoiding a switch to
anonymous storage or loss of unsaved editing when connectivity changes.

Account transport rechecks current remote confirmation before capabilities,
before the request and after its response. Losing confirmation aborts the remote
lease permanently, even if the same account later reconnects. Unsupported remote
API fallthrough and account drafts refuse an unconfirmed workspace. A real root
response must confirm the account before queued sync resumes. Anonymous work
never starts that worker. The legacy tree no longer implicitly copies anonymous
content into a first account; previously saved account keys remain intact.

Root binding and persistent pointer changes now occur only after the root
loader's latest-request/generation fence. An older successful or failed request
cannot overwrite or revoke a newer accepted identity. Stale offline pointers,
wrong origins, malformed account IDs, invalid database names, pending identity
changes and authoritative root refusals fail closed.

An offline Builder list can use saved local records even when its exact server
page was never loaded. It uses distinct `device:` cursors, batch projections and
an explicit incomplete-library notice. It does not claim the entire remote
account library is present. Remote pagination cursors cannot be reused offline.
Reconnection and renewed account confirmation restart the list at its first
page without clearing the visible rows. Background refresh does not replace
cached content with a loading spinner.

Production-build local acceptance on `http://127.0.0.1:22470` verified account
page cold reload while fully offline, editable native text, local save and a
second offline reload. Network observations showed no mutation requests while
offline, or after networking resumed with `/api/root-data` deliberately blocked.
A separate authenticated fixture API read confirmed the server copy was unchanged.
After root verification was restored, the queued edit reached the same private
Thing. A separate unsaved page-name edit survived offline-to-authenticated root
reconnection and then saved successfully. Only disposable local fixture data was
changed; this is not deployed or CI verification.

The offline library was also checked at 1440×1000 and 390×844; the phone
document had no horizontal overflow. Reconnecting cleared the device-only
notice without a reload. Evidence: `tmp/draft-qa/account-offline-library-desktop.png`
and `tmp/draft-qa/account-offline-library-390.png`.

The checkpoint suites passed 297 tests with four opt-in skips across local
workspace/offline shell, root data, webpages, autosave and drafts. The client
build succeeded with 230 verified offline assets. Raw TypeScript still reports
91 existing baseline diagnostics; none matched the changed files. Full feature
acceptance, CI and deployment remain outstanding.


## Anonymous saved themes and storage recovery — 2026-10-16

Theme Studio now saves named themes in the anonymous workspace, using the same
`normalizeSavedTheme` token sanitizer as the account writer. Generic mutations
still refuse the protected theme kind. Dedicated save/delete/active operations
stay local; canonical imports validate theme-only content, mint fresh local IDs,
and enforce the 100-theme limit transactionally. Imports do not change the active
selection. Export excludes local identity and visibility bookkeeping.

A production-build browser check with no account session verified save, reload,
fully offline cold load, edit/save and a second offline reload. The standard
Transfer UI downloaded valid canonical JSON and imported a second editable copy;
apply and delete also worked offline. Save/delete network captures contained no
mutation requests. The library fit 1440×1000, 390×844 and 320px with no horizontal
overflow. Disposable local themes and browser overrides were cleaned up. Evidence:
`tmp/draft-qa/anonymous-theme-export.json`, `anonymous-themes-offline-desktop.png`
and `anonymous-themes-offline-390.png` in the same directory.

Public profiles, activity, people search and shared themes remain available
without login through credential-free public reads; the explicit public waitlist
writer remains available. Retired anonymous API facades cannot run those callbacks
under a later account. Account theme synchronization and local Timeline history
are still separate outstanding work; this is not full theme-family acceptance.

Authoritative root refusals now invalidate active local editors and remote
workers as well as the saved fallback pointer. Reconfirming the same account
cannot revive a retired operation. IndexedDB opening has a ten-second bound,
clear blocked/error/closed diagnostics, retry after failure and cleanup of late
upgrade/success callbacks. Focused regression tests cover these failure paths.

## Anonymous algorithm checkpoint

`LocalAlgorithms` uses the existing canonical profile parser and feed scoring /
training functions. Named profiles are protected `feed-algorithm` Things; generic
Thing updates cannot bypass their writer. Device catalogues have no fixed profile
count; imports remain atomic and use actual browser storage capacity. Portable exports contain only the canonical name,
emoji, weights and training statistics; imports get fresh IDs, no sharing or
lineage, and never change the active selection.

Only credential-free public feed observations supply training features. This
bounded cache stores at most 1,000 post feature records (not complete posts),
200 observations per fetched page and 100 tags per post. Training batches use
the existing 100-event limit. Feed session and pending buffers are bounded,
identity invalidation clears them, and built-in sorts do not train. All flushes
use the workspace facade, including page-hide flushes; no direct beacon can
borrow another account's cookies. Failed training reports a visible error.

Local weights and IDs never go into the feed request. The browser requests the
public chronological feed and ranks each available page locally; this is not a
global ranked cursor. The UI states that limit. Community discovery remains a
credential-free online read; branching remote profiles still requires account
authority. Account profile sync and full offline public-feed pagination remain
separate unfinished work.

Local production-build browser verification covered logged-out create/select,
offline cold reload, rename/branch, canonical download/import/re-export, deletion
and 1440/390/320px layout. A synthetic public-feed response rendered through the
normal feed card and trained the profile with no server mutation; no post was
published. The actual trained JSON and imported re-export had identical profile
content and different IDs. Browser overrides were restored and all four test
profiles deleted. Evidence is in `tmp/draft-qa/anonymous-algorithm-*.json` and
`anonymous-algorithms-offline-*.png`. These are local checks, not deployed proof.

## Anonymous file transfer checkpoint

Canonical ZIP imports store attachment metadata and actual bytes in the same
scoped IndexedDB transaction. The dedicated attachment writer reuses canonical
metadata sanitization, recording/file validation, checksums and composition media
remapping. Generic Thing mutation cannot write attachment bookkeeping. Binary
records share the workspace quota ledger and are inaccessible through generic
JSON collection operations. Imports validate and snapshot all bytes before any
write; failures roll back metadata, placement and bytes together.

The normal Things importer saves local bytes without an upload stage. Export
uses the existing canonical collector, validator and serializer, including
component dependencies and referenced media. Its in-process byte reader is
identity-scoped and never falls back to HTTP. Missing/corrupt bytes fail the
whole export. Copies have independent IDs and bytes; deleting a target cascades
its bound attachments, while deleting a folder containing standalone files still
requires explicit recursive deletion. Portable JSON contains no local storage or
server approval fields. Account file imports remain refused until their dedicated
sync adapter is complete.

A logged-out production-build browser imported a disposable ZIP with networking
disabled, downloaded it through the normal Transfer dialog, cold-reloaded offline,
imported that actual download, deleted the original and exported the surviving
copy. Both downloads passed the canonical archive decoder and serializer with
identical 82-byte content and different root IDs. Observed import/export requests
were empty. The local import notice and controls fit 390px, and the export dialog
fit 320px without horizontal overflow. Test files were removed and browser
network/viewport overrides restored. Evidence: `tmp/local-attachments/` contains
`browser-export.zip`, `browser-roundtrip.zip`, their canonical JSON manifests and
`offline-import-390.png`. These are local results, not deployed acceptance.

Composer uploads, draft attachment copying, linked galleries and account
attachment synchronization remain unfinished. Normal file-picker saving and native
image preview are covered by the checkpoint below. The
existing account upload permissions, access checks, moderation and signed byte
URLs are unchanged.


## Anonymous normal file UI and native preview — 2026-10-16

The existing Files browser now uses the anonymous workspace for **Add files**,
folders, downloads, copy and cut/paste. Each file is saved with canonical
attachment metadata and checksum-verified bytes in one transaction. A stable
request ID makes exact retries idempotent; changed retries, missing/corrupt bytes,
invalid placement, quota failures and cancelled writes fail explicitly. Empty
files are supported. This buffered adapter still limits individual files to 16 MiB; the generic
workspace no longer has a 64 MiB aggregate ceiling.
Paired-device discovery/commands require an account and never run in this adapter.

The existing shared-media URL resolver reads canonical local attachment references
from that same scoped store. It creates reference-counted object URLs for native
Thing/HTML/image/audio/video consumers without HTTP fallback. It bounds reads to
three concurrent files, 64 active references and 64 MiB, revokes URLs on release,
deletion and identity retirement, and reports missing bytes. HTML/SVG and other
non-preview files use opaque download MIME. Local `/media/:id` routes reuse the
normal Thing detail renderer; they do not invent a server social-post projection.
Local comments and media annotations remain unfinished.

Workspace API callback identities now remain stable within one identity. This
fixes repeated Thing detail fetches and React's update-depth failure, while
retired callbacks retain their original forwarding cell and workspace lease.

Local browser evidence: networking disabled, no account session, normal folder
creation and file picker saved a PNG, text file and zero-byte file. Downloaded
text and PNG matched the selected files exactly. Copy, cut/paste into another
folder, native image rendering and cold offline reload passed. The decoded PNG
was 360×240; its native preview fit 1440, 390 and 320 CSS-pixel widths with no
horizontal document overflow. Test data was deleted through normal Things menus;
network/viewport overrides were restored and the task tab closed. Evidence is in
`tmp/local-file-ui/`, including `browser-download.png`, `browser-download.txt`
and `offline-native-preview-390.png`. No account or public content was created.

Checks: 62 workspace/offline, 295 attachment, 315 Things and 48 component tests
passed; webpage/shared-media tests passed 152 with four existing skips. The client
build verified 231 assets (11,032,140 bytes). Raw TypeScript still reports the
same 91 baseline diagnostics, with no added diagnostic signatures. This is local
verification, not CI or deployed acceptance. Normal Things checkbox selection and
folder deletion semantics still need complete UI acceptance; the local adapter
currently refuses a nonempty folder unless explicitly recursive, while the generic
confirmation describes reparenting. Cleanup removed child files before folders.


## Anonymous composer, media drafts and posts — 2026-10-16

The normal PostComposer and attachment queue now use the anonymous workspace
identity and byte adapter. Save on this device validates the canonical post,
binds files and commits it atomically without waiting for draft saving. Account
posting still uses the existing authorized transport. Local posts are private
projections, do not enter the public feed and cannot target remote subspaces.
Local identity labels do not link to an unrelated `/profile/local` account.

Draft snapshots use the existing revision/write-id/tombstone protocol. Media
metadata and bytes share the workspace transaction and quota. Templates and
recovery copies receive new file IDs and remapped layout references. Only active
working drafts can donate their files to a post; cleanup preserves committed
files. Released unbound files expire after 24 hours and are reaped on later local
file/draft writes. No temporary account, server upload or publication is created.

Local production-build browser verification, no account and network disabled:
normal picker upload, draft autosave, post create/edit, cold reload, comment and
nested reply creation/reload, template creation/reuse and independent image
survival after original deletion passed. Existing-image editor tiles reuse the
native shared/local media resolver. Post GET restores relational comments; deeper
replies load on demand through the normal list adapter. 1440×1000, 390×844 and
320×844 had no document horizontal overflow. The audited template-edit/save
interval had zero network mutations; cached static assets and normal shell GETs
remain observable. Disposable posts/comments/template were removed and browser
overrides restored. Evidence: `tmp/local-composer-ui/verification.json` and native
screenshots in that directory.

Local checks: 68 workspace/offline, 26 drafts, 78 feed, 56 hooks and 295 attachments
passed. Canonical post/file export/import preserves exact bytes with fresh IDs.
TypeScript retains the same 91 baseline diagnostics, with no added signatures.
Client build verifies 231 assets (11,047,709 bytes). These are local results;
CI and preview acceptance must be tied to the pushed revision. Linked-media
minting, annotation, reactions/saves/polls, full signed-in offline posting and
account byte synchronization remain unfinished. The full matrix above still
blocks merge.

The normal offline import/export dialogs also passed an image-post ZIP with the
actual 14,451-byte PNG. Its browser download validated canonically and round-tripped
through the isolated normal importer with fresh IDs and identical bytes. The
validator receives verified attachment context; imported comment files retain
comment purpose. Evidence: `tmp/local-composer-ui/browser-image-post.zip`,
`browser-image-post.json` and `roundtrip-verification.json`.

## Anonymous interactions checkpoint — 2026-10-16

`LocalInteractions` uses the normal emoji validator and poll/up-down contracts.
Each reaction, bookmark and vote is a separate scoped child Thing. Generic
CRUD/import cannot mint the managed slots, content export omits local activity,
and deleting content cascades its interaction children. Limits and replacements
share the same atomic transaction/quota boundary as other local Things. Account
interactions still use authenticated endpoints; this does not implement their
future local-first sync adapter or let anonymous users mutate remote posts.

The existing Saved page is available from the logged-out drawer. Its synchronous
cache is keyed by anonymous/account origin, owner and data plane; changing the
scope remounts its state and retires in-flight reads. Native PostCards keep their
optimistic interaction behavior. One target index serves the whole saved page.

Local production-build browser acceptance with no account and networking disabled
covered native poll creation, vote changes/removal, emoji addition/removal,
bookmarking, Saved navigation, reload and unsaving. Deleting the disposable post
removed it from Saved. 1440×1000, 390×844 and 320×844 measurements show no document
horizontal overflow. Evidence: `tmp/local-interactions-ui/verification.json` and
`saved-{1440,390,320}.jpg`. The recorded interaction interval contains no mutation
requests; offline public-marketing GET attempts are separate background reads.
The fixture was removed and temporary browser overrides restored.

Up/down semantics, reaction limits, invalid inputs, cursor behavior, account/
remote-ID refusal, cross-tab transactions, rollback and portable-export exclusion
are covered by `interactions.test.ts`; `api.client.test.ts` proves the facade
uses no remote calls and rejects retired callers. Signed-in sync and the full
matrix remain required before merge. CI/deployment evidence is separate.


## Anonymous Action execution checkpoint — 2026-10-16

`app/actions/runtime.ts` is the existing bounded data interpreter extracted behind
storage/service ports. The account host in `api/utils/actions/execute.ts` retains
its authentication, ACL, Vault, public/system query, Timeline admission/outcome
and notification boundaries. The anonymous host in `local-workspace/actions.ts`
uses only its isolated workspace and the normal local Thing validator/writer.
It re-sanitizes stored programs, resolves schemas and latest Action keys locally,
shares nested operation/expression budgets, pins writes to a current lease and
deadline, and allows at most four concurrent runs per browser database instance.
No Action is queued for remote replay.

The native Actions list, inspector, full program composer and shared definition
editor accept local content ownership. Views and caches are keyed by the full
workspace partition. Definition drafts use the existing local draft adapter;
anonymous edits do not require an account Timeline. Delegated clicks can run
locally owned Actions, but cannot reach cloud install fallbacks. Automatic
component/collection source gates and local suite installation still need work.

Execution details are protected relational `action-run` children, capped at 50
per Action and omitted from ordinary reads/lists, imports and portable exports.
Deleting an Action cascades its details. A run finishing after deletion cannot
recreate orphan history. Failure to save execution details reports `historyError`
without retrying the already completed program. This debug trail is not yet
canonical local Timeline history.

Pure browser Actions use `executeBrowserAction`. Browser request steps explicitly
refuse until their dedicated local endpoint adapter exists. Public/system data
searches and Vault lookups also refuse locally without a request or credential
fallback. Account Actions now use local execution for retained owned definitions whose bounded dependency closure has local adapters; remote-only definitions retain their authenticated execution path;
account offline execution/sync remains incomplete.

Local automated checks: 80 workspace/offline-shell, 156 Action (one opt-in skip),
56 hooks, 44 autosave, 27 draft and 315 Things checks passed. The existing live
`verify-actions.mjs` passed 100/100 against the disposable local server, covering
account permissions, private creation, nested budgets, recursion and protected
history. Raw TypeScript retains the 91-diagnostic parent baseline; it is not clean.

The production-build browser at the isolated local origin verified no-login
creation, pure execution, cold offline reload, definition editing, invalid JSON,
a deliberate execution failure and persisted details. Normal JSON download and
import produced a new local ID; the copied Action returned the same expected
failure. The canonical validator accepted the download with one editable Action,
no account authority and no run history. Desktop 1440×1000, 390×844 and 320×844
had no horizontal overflow. Both disposable Actions were deleted and a fresh
Actions list confirmed cleanup. Evidence lives in `tmp/local-actions-ui/`.
The complete initial create/run network interval contained zero mutation
requests; the longer edit/import event buffer was truncated, so it is not a
complete network transcript. Those operations ran with networking disabled.
Browser overrides were restored and task-created tabs closed.

The generic Thing page still reports unavailable comments and omits owner menu
operations for local Action Things; the Things library supports their deletion.
Those shared-surface gaps remain in the broader rollout. CI and branch-preview
checks are separate from this local acceptance; this checkpoint is not deployed
feature acceptance and does not make the full-suite PR merge-ready.


## Local page sources checkpoint — 2026-10-16

The real page runtime now separates content-workspace availability from account
sign-in. Anonymous owned pages run saved source Actions through the existing local
API adapter. `viewer.signedIn` remains false; this does not grant server authority.
Component and collection hooks retain sibling-load deduplication, bounded paging,
retry behavior and refresh after a control completes. Disabled Builder previews
remain inert. Shared-root runs retain their separate server-authorized path and
never read or write the owned source cache.

Source cache entries now use the full account/origin/data-plane or anonymous
partition rather than an account ID alone. Old unqualified entries are not
adopted. Runtime results, last-control state and local form state retire on a
workspace boundary. The transport's existing lease remains the final authority.
This change does not implement offline account Action execution.

Local production-build acceptance imported a six-Thing canonical fixture through
normal Transfer (schema, Data, two Actions, Component and webpage). With no login,
the source Component and its native Collection rendered the saved Data. With all
networking disabled, a delegated control updated it and both sources refreshed;
a cold offline reload retained the new value. 1440×1000, 390×844 and 320×844 CSS
viewports had no horizontal overflow. The complete recorded update/reload interval
had zero mutation requests. Only disposable local fixture Things were changed.
Evidence: `tmp/local-sources-ui/verification.json` and `offline-sources-*.png`.

Regression coverage: 445 automated checks passed across webpages, Actions,
workspace/offline shell and hooks, plus one real-browser lifecycle regression
(`sourceWorkspace.browser.test.ts`) against Vite. It covers anonymous execution,
sibling deduplication, refresh, inert mode, malformed collection output and
workspace retirement with all API requests refused. Cache tests cover account,
origin and data-plane isolation. Raw TypeScript retains the same 91 baseline
diagnostics; changed-file lint is clean. Client build: 237 verified offline assets.
These are local checks; deployed and full-suite acceptance remain incomplete.


## Bundled suites and local browser requests — 2026-10-16

`schemas/suiteInstallation.ts` shares the existing materialization and installation
plan between the authorized server and anonymous storage. The local adapter runs
the entire install in one transaction, reuses the normal validators/quotas, binds
page component IDs, and preserves seeded sample edits on reinstall. Only-missing
installation preserves authored definitions. Canonical normalization happens
before comparison so repeated installs do not rewrite unchanged content.

The normal demo gallery installs bundled definitions without an account or a
catalog request. Browser Actions reuse their existing interpreter and saved
capability grammar. The local request host accepts only supported versions of
Things CRUD (editable definitions, Data and folders) and data-Action execution.
It never fetches; remote IDs, public ACLs, ownership fields, protected-kind writes
and unsupported services fail explicitly. Identity retirement and cancellation
fence writes. Browser composition keeps its existing shared budgets. Account
installation still uses the authorized endpoint, with expected actor/data-plane
headers, identity cancellation and a bounded request. Account offline installation
and suite sync remain unfinished.

A clean production-build browser with `user: null` installed Web Standards while
fully offline, edited a button, saved it through the suite's browser Action,
opened the native Component and cold-reloaded it with the edited input intact.
The complete automated request capture contained zero network mutations. Normal
Transfer downloaded an eight-Thing JSON bundle; canonical validation and isolated
normal import remapped every ID, preserved the input and ran the catalogue Action.
Re-exporting the page collected its six referenced dependencies/root; the older
unreferenced save-component Action and independently saved button remain separate.
Manual 1440×1000, 390×844 and 320px checks found no horizontal overflow.

**Historical runtime gate (resolved by the next checkpoint):** Chromium's opaque-origin Web Platform iframe cannot
load through the app service worker while disconnected. Run example reports the
existing runtime-load error; it does not return a fabricated result. With network
restored, the actual isolated runtime rendered the button and returned an
HTMLButtonElement. Sandbox permissions and CSP were not relaxed. Vite preview now
applies the same existing isolated-runtime CSP as development. Local Component
comments still show a read error and need their own adapter work.

Local verification: 456 passing workspace/offline-shell, webpage, Action, hook
and media-cache tests, plus two explicit browser tests; seven opt-in skips in
the ordinary suites. The existing server app-suite fixture passed 53/53 against
disposable local Mongo. Targeted lint has no errors (one pre-existing constructor
warning). Raw TypeScript retains the 91-diagnostic baseline. The production
client build has 243 verified offline assets. These are local results, not CI
or deployed acceptance of the complete feature matrix.

Run the opt-in browser test against a production client served on an isolated
localhost origin, with its normal API pointing at disposable test data:

```sh
TT_LOCAL_SUITE_URL=http://127.0.0.1:22470 \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
TT_LOCAL_SUITE_ARTIFACTS=../tmp/local-suites-ui \
  corepack pnpm --dir remix exec node --import tsx --test app/local-workspace/suites.browser.test.ts
```

Evidence: `tmp/local-suites-ui/native-suite-export.transfer.json`,
`roundtrip-verification.json`, `browser-verification.json`,
`offline-saved-component.png`, `offline-component-1440.png`,
`offline-component-390.png`, `offline-component-320.png` and
`online-native-runtime.png`. Manual PNGs are lossless format conversions of the
actual browser JPEG captures, without resizing or redrawing. The eight manual
production-origin fixture Things were deleted; the pre-existing page was retained.


## Offline Web Platform execution — 2026-10-16

The native `WebPlatformSurface` now embeds the exact compiled `runtimeEntry.ts`
renderer as a build-produced `srcdoc`. Opaque-origin frames cannot load through
the application service worker, so caching the old runtime URL was insufficient.
Caller programs remain data sent through the existing validated message protocol;
no caller content enters the document template. Workspace changes retire the frame.

The iframe keeps its opaque origin and existing sandbox. Its CSP permits only
the exact hash of the compiled script, preserving the existing connect, form,
worker and resource restrictions. Production application CSP adds that same hash
so the inherited policy permits the trusted renderer; it adds no inline, eval,
blob-script or wildcard permission. Embed and inert draft bundles retain the
standalone runtime URL. The build checks the deployed hash against its output.

A clean browser using the production CSP installed, edited, ran, saved and
cold-reloaded a Web Standards Component entirely offline. The actual runtime
returned `HTMLButtonElement`. Worker execution returned 42; native form events
cancelled navigation; authored failures were reported; Stop removed the frame
and output. After reconnecting, security probes still could not access the parent,
cookies or local storage, run arbitrary inline JavaScript or fetch a same-origin
URL. The complete capture contained zero mutation requests and zero escaped
probe requests. Manual 1440×1000, 390×844 and 320×844 viewports had no horizontal
overflow. Eight disposable manual fixture Things were removed; the existing page
was retained. Local Component comments still show a read error and remain open.

Normal Transfer downloaded `tmp/offline-platform-ui/native-export.transfer.json`.
Canonical validation and normal import in an isolated local fixture produced a
fresh ID and preserved the editable program and exact “Running entirely offline”
input. Native PNGs, `browser-verification.json` and `runtime-boundaries.json` live
alongside it. Mobile PNGs are full-page captures at the documented CSS viewport;
manual PNGs are format conversions of browser captures without resizing/redrawing.

Run the existing `suites.browser.test.ts` command above with
`TT_LOCAL_SUITE_ARTIFACTS=../tmp/offline-platform-ui` to repeat the production-CSP
browser check. These are local results. Account suite sync, remaining request
adapters and the full feature matrix are still required before merge.

Local verification for this checkpoint: 280 passing automated checks across Web
Platform, workspace/offline shell, draft preview, embed and build/CSP suites,
plus one explicit production-browser regression; two opt-in skips in ordinary
suites. The watcher lifecycle test uses isolated real filesystem output and
checks invalidation, reload and unchanged asset re-emission. Changed-file lint
has no errors. Raw TypeScript matches the same 91 baseline diagnostics. The
production client build contains 245 verified offline assets (21,139,396 bytes).
The full client/server build, Vercel output patch and output verification also
passed locally, including the packaged runtime/CSP hash check. No deployment was
performed by that build.

The original no-login acceptance also passed again after this build: two real
MCP/running-app browser tests verified exact affirmation text, native desktop,
390px and 320px PNGs, card crop, canonical dependencies and explicit invalid/
invisible/overflow failures. The exported JSON is byte-identical to the previous
acceptance export. The normal server importer round-trip passed against the
isolated local draftPreview replica: fresh IDs, remapped dependency, private ACL,
anonymous 404s and canonical re-export. Both imported Things were deleted and the
synthetic fixture logged out. Current artifacts: `tmp/offline-platform-affirmation/`.
This does not connect a web-only agent host to local stdio; the documented host
bridge requirement remains.


## Generic Thing discussions and rename checkpoint — 2026-10-16

Local Component, Action and Data reads now supply the same separate discussion
companion as ordinary server Thing reads. Comments remain relational child Things,
read in bounded cursor pages rather than embedded recursively. One target index
is shared across each comment page. Anonymous public discussion reads continue
through the credential-omitting public adapter, including share keys and cursors;
local identities still cannot comment on remote Things.

The shared detail menu uses workspace content ownership for local rename and
lets the selected API adapter negotiate remote capabilities. Local rename no
longer waits for a remote manifest or triggers an account root refresh. History
and recording handoff continue to require real account authentication. Discussion
and menu state retire on full workspace identity changes, including data plane.

Local verification: 536 passing workspace, feed, Things and hooks checks, two
opt-in browser skips, plus the explicitly enabled production-browser regression
in `app/local-workspace/details.browser.test.ts`. The clean context had no account
session. Import, comment, nested reply, rename, cold reload and comment search
completed offline with zero mutation requests. Measured 1440×1000, 390×844 and
320×844 views had no horizontal overflow. Evidence lives in
`tmp/local-details-ui/` (native PNGs and `browser-verification.json`). Changed-file
lint has no errors; raw TypeScript retains the same 91 baseline diagnostics.
The production client build passed. These are local results, not deployed proof.

Run that opt-in regression with `TT_LOCAL_DETAILS_URL` pointing to the isolated
loopback production preview, `TT_SHARED_PLAYWRIGHT_PATH` to the installed
Playwright module, and `TT_SHARED_CHROME_PATH` to its Chromium executable; set
`TT_LOCAL_DETAILS_ARTIFACTS` to an output directory. Use the same production CSP
and offline-shell setup as the existing browser checks above.

This closes the Component comments-read error. Account discussion sync, local
Timeline authority and other matrix items remain unfinished. Saved currently
lists post-shaped targets, matching the server's existing contract; generic
Component/Data bookmarks are not yet surfaced in that list.


## Library search checkpoint — 2026-10-16

The existing Things library search now calls the current workspace adapter with
an explicit `workspace: true` option. Anonymous search reads only the scoped local
snapshot and never sends an account request. It searches authored crystal/tag
strings literally, case-insensitively with Unicode normalization, across folders.
It excludes activity rows and draft/attached files using the same visibility
predicate as normal library listing. Text is limited to 200 characters, kinds to
20, and pages to 50; cursors bind the query and kind filter. This is library text
search, not the separate public/structured search contract.

Confirmed account searches paint cached owned content first and refresh through
the existing owner-filtered API. Only supported owned kinds enter the local cache;
unsynced edits win over older remote hits. Pending and server results retain
independent continuations, so neither truncates the other. Offline results are
explicitly incomplete. Failed refresh keeps existing content visible with Retry;
query, workspace, data-plane and identity changes retire old responses. Local
substring matching and server relevance matching retain their existing different
semantics. The shared search transport strips the client-only workspace flag.

Clean production-browser verification passed both anonymous and disposable
account paths. Anonymous import of 61 nested Things, two-page search, kind filter,
offline rename, cold reload, oversized-query error and visible checkbox selection
made zero mutation/search requests. Native 1440×1000, 390×844 and 320×844 views
had no horizontal overflow. Account search loaded two private synthetic Things,
retained them under an injected 503, and found them after a cold offline reload;
the final run deleted both through the normal API and logged out. An earlier
cleanup-test failure left two synthetic Things in its separate disposable local
account; no existing account or public content was modified. Empty fixture accounts
remain in the disposable replica. The account offline screen still shows the
existing remote-computer refresh error; native/remote device work is a separate
matrix item.

Evidence: `tmp/local-search-ui/` (native PNGs and separate anonymous/account
verification reports). Run `app/local-workspace/search.browser.test.ts` with
`TT_LOCAL_SEARCH_URL` set to the isolated loopback production preview and the
shared Playwright/Chromium variables above. Set `TT_LOCAL_SEARCH_ACCOUNT=1` only
for the disposable local account fixture; `TT_LOCAL_SEARCH_ARTIFACTS` chooses its
output directory. Ordinary suites skip these browser checks.

Local validation: 463 passing workspace/offline-shell, Things and hooks tests,
four opt-in skips, plus both explicitly enabled browser tests. Changed-file lint
has no errors. Raw TypeScript retains 91 existing diagnostics; the new file
annotation test's missing typed stub was repaired. The production client build
passed with 245 verified assets (21,148,320 bytes). This checkpoint also preserves
the review bot's local-file annotation adapter and regression. Full account sync,
canonical local Timeline and other matrix items remain required before merge.


## Canonical local Timeline checkpoint — 2026-10-16

Ordinary anonymous Thing create/update/delete/import changes append the existing
canonical Timeline event, receipt and individual relationship records in the
same browser transaction as content. The shared `thingContentSnapshot` projection
is now browser-safe; the server keeps its existing behavior. Anonymous snapshots
carry no account audience. The local authority uses `local-workspace` for its
owner and data plane; these local ordering receipts are never uploaded or treated
as account authorization. No account writer has been redirected to this namespace.

`local-workspace/timeline.ts` reads authoritative history from scoped workspace
records, while the existing Timeline IndexedDB store remains an evictable view
and pending queue. Corrupt/missing links, mismatched index metadata, changed retry
payloads, missing ancestry, wrong scope, retired identities and aborted requests
fail explicitly. Pages contain at most 40 entries within the shared event-size
budget; component batches have a 4 MiB ceiling. Workspace record/byte quotas still
apply. A history write failure rolls back the associated content write.

Page versions use the same local component resolver as live pages and the shared
component-capture contract. Unchanged captures are reused, and deleted pages keep
their saved dependencies. The native preview stays inert. Local History labels
say saved on this device, never synced to account. Connection transports retain
the API facade that created them; a later login cannot redirect an anonymous
queue into account APIs. Unsupported commands return explicit 422 refusals, not
an authentication prompt or a cloud fallback.

Local verification: 652 passing workspace/offline-shell, Things and shared
Timeline tests, five ordinary opt-in skips, plus one explicitly enabled clean
production-browser test. It imports a page/component through the normal importer,
renames offline, opens the recorded native preview, and repeats after a cold
offline reload. It observes zero mutation requests, zero account Timeline calls
and zero page errors. Native 1440×1000, 390×844 and 320×844 views have no horizontal
overflow. The in-app Browser separately verified the logged-out History UI and
recorded preview. Evidence: `tmp/local-timeline-ui/` (PNGs, manual JPEGs and
`verification.json`). Changed-file lint has zero errors and three constructor
warnings; raw TypeScript has exactly the same 91 diagnostic identities as the
preceding checkpoint. Production client build succeeds. These are local checks,
not proof of CI or deployed behavior.

Run `app/local-workspace/timeline.browser.test.ts` with `TT_LOCAL_TIMELINE_URL`
pointing at the isolated loopback production preview, the shared Playwright and
Chromium variables used above, and optional `TT_LOCAL_TIMELINE_ARTIFACTS`. The
test owns a clean anonymous context and writes no account data.

This is not the completed Timeline feature: the folder ID currently identifies
the History route, not a persisted protected Timeline folder. Named branches,
notes/version names, restore/merge, version export, related composition history,
protected-kind histories, full account local-first synchronization and storage
cleanup at quota remain on the merge gate. Ordinary draft admission is covered
by adapter tests; every editor's draft-recovery lifecycle still needs its own
acceptance coverage. Existing history is not reconstructed retroactively.


## Local History notes checkpoint — 2026-10-16

Anonymous History's Message tab now saves and removes owner notes through the
existing canonical `TimelineNote`/command/result contract and queue. Each note
is a separate relational workspace record, never an array on a Thing or event.
Pages batch notes once and include their UTF-8 bytes in the response limit.
The shared eight-note cap is enforced in the same serialized transaction as the
write, including simultaneous browser connections. Invalid targets, changed
retries, damaged stored records, aborted operations and retired identities fail
explicitly. Removal records a small internal marker without note text so delayed
adds cannot resurrect a removed note; markers count toward workspace quota.
Quota failure rolls back both removal and its marker. Account note behavior is
unchanged. Provider-generated explanations remain an explicit remote requirement.

The normal UI reports device-only saves/removals. A refused command retains its
text with Retry/Dismiss controls without making the whole History unavailable.
Local tests: 105 workspace/offline-shell and 238 shared Timeline passes, five
ordinary opt-in skips, plus one explicitly enabled production-browser pass.
That clean context verifies offline import/rename, save-note/reload/remove,
rejection and dismissal of a ninth note, and the recorded native preview at
1440×1000, 390×844 and 320×844. It observes zero account Timeline requests,
zero mutation requests and zero page errors. The in-app Browser also verified
normal note editing and the three layouts. Evidence is in
`tmp/local-timeline-notes-ui/`, including `verification.json` and native PNGs.
The production client build passed (245 assets, 21,159,536 bytes); changed-file
lint has zero errors and one constructor warning. Raw TypeScript remains at the
same 91 diagnostic identities as the preceding checkpoint. These are local
checks, not CI or deployed verification. Version names, branches and the other
outstanding rows above remain on the full rollout's merge gate.


## Local History version names checkpoint — 2026-10-16

The normal Versions tab can name, rename and clear anonymous saved versions
without network access. `timeline/versionNameMutation.ts` now holds the shared
mutation planner and replay semantics used by both the existing server service
and the browser adapter. Canonical version names remain separate relational
records; each actual change appends the same immutable effect contract. Local
`source: api` means the local API authority in the isolated local data plane,
not an account receipt or permission. Anonymous receipts never sync to accounts.

Commands use identical canonical SHA-256 signatures. Hashing finishes before
opening the browser transaction. Names, effects, links, ordering and monotonic
clear/recreate metadata commit together. Concurrent edits require the current
revision; retries return the original receipt without overwriting a later name.
No-op names/clears retain the existing server semantics and append no event.
Name records are batched beside selected History entries and count toward page
byte limits. The mounted name editor retains an uncertain request identity for
retry; this is not a durable account name queue or lost-process recovery.

Local verification: 110 workspace/offline-shell and 238 shared Timeline tests
passed, with five ordinary opt-in skips. The explicitly enabled production
browser test passed offline name/rename/reload/clear/reload, notes and recorded
native previews, with zero account Timeline calls, mutation requests or page
errors. Layout checks cover 1440/390/320px; the in-app Browser separately verified
naming and all three layouts. Evidence: `tmp/local-version-names-ui/`.
The real server version integration passed against the disposable loopback
Mongo replica, including canonical naming, concurrency, replay, undo/export and
private access. Its previously mismatched retry ID was corrected, and created
Things now clean up in `finally`. The initial attempt before that cleanup fix
left two synthetic private Things in a disposable test account; no existing
account content was changed. The successful rerun cleaned its own Things.

Production client build: 245 verified assets / 21,163,888 bytes. Application lint
has zero errors and one constructor warning; the `.mts` integration test uses
an explicit TypeScript ESLint parser. Raw TypeScript has the same 91 diagnostic
identities as the previous checkpoint. These are local checks, not deployed
acceptance. Account Timeline offline writes/synchronization and the remaining
full coverage matrix still block completion and merge.


## Local variations checkpoint — 2026-10-16

Anonymous History can create a named variation, edit its fields, open its exact
recorded head in the native Builder and save further edits while offline.
`timeline/branchMutation.ts` and `timeline/versionGraph.ts` share canonical
operation receipts, revision checks, bounded ancestry and historical content
materialization with the existing account services. The account services retain
protected Mongo writers, transactions, storage accounting and authentication.

`local-workspace/timelineBranches.ts` stores the same canonical branch and
per-Thing head records separately in the anonymous partition. A small separate
index retains creation receipt positions for stable pagination. Effects, links,
heads, metadata and quota commit together. A lost reply replays its original
receipt; stale or divergent advances fail without replacing either version.
The ordinary durable branch queue and working copy are reused. Checkout resolves
recorded ancestry and components; it never borrows the current Thing. Browser
routes admit the explicit local owner/plane pair without widening the account
source validator. Actions and live data remain paused in branch previews.

Verification: 116 workspace/offline-shell and 238 shared Timeline tests passed,
plus three focused Builder contract tests. Five ordinary opt-in browser tests
skip unless enabled. The explicitly enabled clean production browser test
passed offline variation creation, field edits, native Builder save/reload,
recorded component rendering, unchanged current content, and 1440/390/320px
layouts. It observed zero HTTP mutations, account Timeline requests or page
errors. Manual in-app Browser checks separately confirmed the same native
branch path. Artifacts: `tmp/local-branches-ui/`.

The real account API regression passed on the disposable local replica with
create/replay/CAS/ancestry/checkout, stale-head errors and anonymous 401s.
Run `node --import tsx scripts/timeline-branches.integration.mts` from `remix`
with `TIMELINE_TEST_BASE` pointing to a disposable loopback app. Its default DB
guard expects `127.0.0.1:20337` / `timeline-rs`; an explicitly isolated fixture
can supply `TIMELINE_TEST_MONGO_HOST` and `TIMELINE_TEST_REPLICA_SET`. The test
creates its own account and private Thing and deletes only that Thing in
`finally`; its test account and canonical audit history remain in the disposable
DB. No pre-existing account is read or changed.

Production build: 245 verified assets / 21,173,785 bytes. Raw TypeScript retains
the prior 91 diagnostics; application lint has zero errors and one existing
constructor warning. These are local checks, not deployed acceptance. Account
Timeline synchronization, branch merging, restore/export and the full remaining
coverage matrix still block completion and merge.


## Canonical local branch merges — 2026-10-16

Anonymous History can now compare a selected saved version with a named variation,
resolve content and recorded-component conflicts, preview through the native
renderer, and save through the existing durable event/branch queue. The shared
`timeline/branchMergePreview.ts` contains the existing account comparison rules;
`recordedComponentReader.ts` preflights the complete component byte budget before
payload reads. Account readers remain owner-scoped and authenticated. The local
adapter uses one read-only anonymous workspace transaction and never reads live
account Things or executes Actions. Applying retains the canonical merge event
before the existing revision-fenced branch command. A stale head preserves the
proposal without overwriting the newer branch or current Thing.

Local verification: 121 workspace/offline-shell and 238 shared Timeline tests
pass, with five ordinary opt-in skips. The explicit production-shell browser
check passes offline conflict review, native preview, save and cold reload at
1440/390/320px with zero HTTP mutations, account Timeline requests, page errors or
document overflow. Manual in-app Browser review/save also passed. Evidence:
`tmp/local-branch-merge-ui/verification.json`, `branch-merge-1440.png`,
`branch-merge-390.png`, `branch-merge-320.png`, and manual phone screenshots in
that directory. The browser test now waits for the branch row before choosing
its merge control and waits for asynchronous note removal to finish repainting.

The guarded real API branch regression also passes comparison, explicit conflict
choices, canonical merge upload, idempotent head advance, cold checkout, stale
preview refusal, unchanged current Thing and anonymous 401s. It uses only a new
synthetic account on the disposable loopback replica and cleans up its created
Thing in `finally`; that test account and immutable audit remain in the fixture
DB. No existing account data was changed.

Build: 245 verified assets / 21,181,018 bytes. Targeted lint has zero errors and
one existing constructor warning. Raw TypeScript retains the exact same 91
baseline diagnostics. This is local verification; CI and deployed evidence are
separate. Current-content restore/undo/merge, historical export, related history,
protected histories/folder, account sync and the full remaining local-first
matrix are unfinished. PR #1000 remains open; do not merge this checkpoint.


## Canonical local restore, undo and current-content merge — 2026-10-16

Anonymous History now applies saved ordinary Thing versions offline, including
restore, undo of one saved edit, current-content three-way merge and deleted
Thing recovery. `timeline/versionPlan.ts` extracts the existing account planner;
`publishedComponentTools.ts` shares component choices, bounded hash preimages,
copy identities and composition rewriting. The canonical request signature and
receipt format are unchanged. Account authentication, protected writers and
transactional component rechecks remain in the server adapter.

`local-workspace/timelineVersions.ts` plans through anonymous readers, performs
WebCrypto hashing outside IndexedDB transactions, then rechecks the content head,
updated timestamp and complete component comparison preimage in the write
transaction. `LocalThings.versionTransaction` reuses normal validation, placement,
quota and canonical capture. Restored components are independent validated Things
with the same deterministic SHA-256 identities as the account planner. Content,
copies, events and head changes commit together. Retries return the original
receipt even after later edits; stale revisions or components never overwrite
newer content. Abort or receipt failure rolls back the complete operation.
Deleted recovery uses a recorded main deletion and the original identity; a
missing folder falls back to Things. Anonymous content stays on this device.

Verification: 134 workspace/offline-shell and 238 Timeline tests passed, five
ordinary opt-in skips. Thirteen new local cases cover restore/replay/CAS, undo
choices, independent merges, recorded copies/cold storage reopen, current mode,
missing definitions, deleted recovery, concurrent submissions, component changes
between plan and commit, schema validation, rollback and cancellation. The clean
production-shell browser passes offline undo, current merge, recorded restore and
native Builder cold reload at 1440/390/320px with zero HTTP mutations, account
Timeline requests, page errors or document overflow. Manual in-app Browser restore
and native Builder reload also passed. Evidence: `tmp/local-restore-ui/`.

Both guarded real API integrations (`timeline-versions` and
`timeline-published-components`) passed against the disposable loopback replica,
including undo/export parity, independent component copies, stale fences, exact
retries and atomic copy rollback. They create synthetic accounts and clean up
only their own Things; test accounts and immutable audit remain in that fixture
DB. No existing account data was changed. Replica host/name can be supplied
explicitly; defaults retain the original test replica. See README.

Build: 245 verified offline assets / 21,198,448 bytes. Raw TypeScript retains
exactly the same 91 baseline diagnostics. Targeted lint has zero errors and three
constructor warnings (two existing, one new TypeScript parameter-property
constructor). These are local checks, separate from CI and deployment. Historical
export, related history, protected-kind adapters/folder/storage controls, account
Timeline sync and the remaining local-first matrix are still unfinished. Do not
merge this checkpoint.


## 2026-10-16: offline historical version archives

The existing Versions → Export control now uses anonymous authority through
`LocalTimeline.exportVersion`. `timeline/exportVersion.ts` is the shared account
and local resolver; the server remains behind its existing authentication,
selected-plane checks and export rate limit. The local adapter takes one readonly
workspace transaction for retained content, notes and names. It never reads the
current Thing to fill missing history and makes no account requests. Compact
folder revisions resolve their recorded ancestors; deletion exports the saved
before-image. Missing/unsupported ancestry, non-revision events, retired scopes,
invalid IDs and cancellation refuse. Large snapshot references are checked before
parts reads; the final archive has the existing 4 MiB ceiling. A download cannot
start after its version editor has unmounted.

History archives retain the existing `formatVersion: 1` record: immutable event
and receipt, resolved content, notes and name. Dependency links remain references;
they are not a self-contained transfer bundle. To make a historical page portable,
restore its recorded components, then use normal Thing export. The round-trip test
uses the normal importer in an independent workspace, verifies remapped IDs and
recorded component text, and leaves the formerly shared component unchanged.

Local evidence: six export tests, 378 workspace/Timeline passes in total, a clean
production-shell offline browser download, and manual in-app Browser export. The
actual JSON and screenshots are in `tmp/local-history-export-ui/`. The browser
retains the existing 1440/390/320px restore/merge/reload checks and reports zero
account Timeline requests, mutations, page errors or document overflow. The real
`timeline-versions.integration.mts` account regression passes against the guarded
disposable loopback replica, including export privacy and rate limits. Build:
245 assets / 21,200,676 bytes. TypeScript retains the identical 91 baseline errors;
targeted lint has zero errors and one existing constructor warning. CI and deployed
verification are separate. The full matrix above remains incomplete.


## 2026-10-16: restored component routing

Restored copies use the canonical account planner's `restored-` identity format.
Local reads and discussions now check the active anonymous partition instead of
assuming every local Thing starts with `local-`. Retained History heads keep
deleted local identities from falling through to public reads. Public restored
IDs still use the credential-free public transport; an account partition never
supplies anonymous content or write authority. Routing rechecks the workspace
lease after asynchronous lookup.

The normal detail page uses workspace ownership for editable local content.
PostCard's local comment/reply controls require a local author projection matching
the anonymous workspace, rather than a prefix. Local Action requests and
interactions still resolve their target in the scoped store, enforce supported
kinds and use the existing atomic writer; they never fall back to HTTP.

Four focused regressions cover a real recorded-component restore, read/comment/
reaction/save/rename/delete, browser Action GET/PATCH/DELETE, account partition
isolation, public reads, deleted identities and identity changes during lookup.
The clean production-shell History test passed restore → Things detail → native
preview → comments/reply → Rename → cold reload at 1440/390/320px, with no
horizontal overflow, HTTP mutations, account Timeline requests, restored-ID public
reads or page errors. Manual in-app Browser verification passed the same detail
editing/reload at 390px. Workspace/offline-shell, Timeline and feed: 460 passes,
five ordinary opt-in skips; both History and ordinary-detail browser tests were
run explicitly and passed. Final build has 245 verified assets / 21,201,007 bytes;
TypeScript remains at 91 identical baseline diagnostics, lint has zero errors
and two existing warnings. Evidence: `tmp/local-restored-routing-ui/` and
`tmp/local-restored-routing-details/`. See the PR checkpoint for the earlier
unclassified offline startup failure and the separately tracked CI/preview state. Related and
protected History, Timeline folder/storage controls, account sync and the full
local-first matrix remain unfinished; this is not a merge-ready completion.

## Anonymous Page + related History — 2026-10-16

`LocalTimeline.page` now supports the existing related-scope contract. It reads
only stored Things in the anonymous partition and traverses the canonical
composition references, including saved/default and per-instance component args,
Action steps, Data and Schema references. Component aliases reuse the normal
selector; Action/schema aliases follow the local runtime ordering. Public caches
and account partitions are not inputs, and discovery executes no Actions or
network requests. Missing external dependencies contribute no event membership.

Both account and local readers use the same request checks and sorted SHA-256
membership identity in `timeline/relatedHistory.ts`. The local adapter hashes
outside IndexedDB, then rechecks membership in the readonly event transaction.
Concurrent changes produce an explicit refresh error. Membership changes since
an existing cursor reset both paging directions, including when a newly related
Thing has older history. Ordinary content edits keep the same membership hash.
Bounds remain 128 Things, 512 contexts/references and the existing page byte cap.

Seven new local tests cover five-kind traversal, exact membership hashing,
reopen, both cursor directions, arg contexts, aliases, cycles, complexity/page
limits, account/public isolation, cancellation and membership races. The guarded
real account API integration retains its auth/source/privacy checks and now
cleans up its own synthetic Things in `finally`; see the README disposable
replica setup. Protected History, Timeline folder/storage controls, account sync
and the other matrix rows remain unfinished.


Local validation: 390 workspace/offline-shell and Timeline tests pass, with five
ordinary opt-in skips. The production-shell History regression passes with all
network requests rejected after the verified cache is ready, including related
filter/cold reload, component membership replacement after restore and layout at
1440/390/320px. It asserts root API reads are unavailable, with zero HTTP
mutations, account Timeline requests, restored-ID public reads or page errors.
Manual in-app Browser also verified related page/component events and reload at
1440/390px; task tabs were closed and viewport overrides reset. Evidence:
`tmp/local-related-ui/`, `tmp/local-related-network-blocked-ui/`.

At this historical checkpoint the History regression used `TT_LOCAL_TIMELINE_NETWORK_MODE=blocked-requests`:
Playwright rejects actual requests while allowing the service worker's cached
responses. `navigator.onLine` remains true in this mode. Select
`TT_LOCAL_TIMELINE_NETWORK_MODE=offline-emulation` to retain the browser's offline
flag diagnosis. That mode intermittently cancelled cached module loads during
cold navigation; this was reproduced independently at navigations 48 and 52.
All 246 cache entries remained present and a failed module was still fetchable.
The original app passed 80 cold navigations with requests blocked. Experimental
preload removal and buffered cached responses were reverted: this evidence does
not establish the cancellation cause or a general startup fix. Keep real-device
offline startup and browser-emulation reliability open before full completion.

Build: 245 verified assets / 21,203,554 bytes. TypeScript retains 91 baseline
diagnostics; targeted lint has no errors and one existing constructor warning.
These are local results, separate from CI and deployed behavior. The complete
local-first rollout remains unfinished and must not be merged yet.


The combined branch preserves review-bot commit `82eae71f6`: unreachable or
damaged CacheStorage falls back to the real network for build assets; a failed
navigation retains its original network error. Its four offline-shell tests and
the rebuilt native History regression pass. This cache-error fallback does not
establish a fix for the separately observed module cancellations.


## Managed anonymous Timeline folder — 2026-10-16

After the first saved local event, Things and its literal library search expose
`timeline-folder-local-workspace`. The existing folder route opens the same
History UI. The folder is a readonly projection of the earliest canonical local
receipt, with stable dates and paged library membership; no mutable folder or
new history format is persisted. Content snapshots, portable transfers and
account partitions exclude it. Ordinary rename/move/delete, target/folder
placement and import into the container fail before mutation. Historical
version export remains available inside History.

Cold navigation exposed another missing local link: library rename required a
fresh server capability manifest after reload. Anonymous local rename now relies
on its existing validator and workspace lease. Account capability negotiation
is unchanged. A clean offline browser verifies import → folder → cold reload →
back to Things → rename → cold reload, plus the entire prior History flow.

Local verification: 149 workspace tests, four offline-shell tests and 238 shared
Timeline tests pass; five opt-in browser cases are skipped by the ordinary unit
command. The explicitly enabled History case passes (35.5 seconds), with no
account Timeline calls, HTTP mutations, restored-ID public reads, page errors or
recovered module errors. Folder bounds are 1440/1440, 390/390 and 320/320 CSS
viewport/scroll widths. Manual in-app Browser verification also passes at
desktop/390px; task tabs are closed and viewport overrides reset. Evidence:
`tmp/local-timeline-folder-ui-checkpoint/` (including `folder-verification.json`),
`tmp/local-timeline-folder-ui/manual-folder-*.png`. Build verifies 245 assets /
21,205,081 bytes. TypeScript retains exactly the prior 91 diagnostics; targeted
lint has zero errors and six pre-existing warnings.

The default History network mode is now `offline-emulation`. A new attempt with
`blocked-requests` failed the explicit root-network probe: routing did not make
the API unreachable. That opt-in mode still asserts the same condition. Two
earlier emulated runs completed the functional steps but failed on recovered
entry-module load errors; the final run passed. This is not a startup reliability
fix. Real-device/offline startup, protected History, local storage controls,
account sync and the rest of the matrix remain unfinished. These are local
results, not CI or deployed acceptance. Do not merge yet.


## Device storage settings — 2026-10-16

Settings → Things shows the current device workspace's accounted bytes and
record count. Available capacity belongs to the browser/device; no fixed quota
or percentage is displayed. The readonly
usage operation compares its scoped ledger with a key-only count in the same
transaction. It does not enumerate other partitions, load file bodies, request
account data or display browser-wide usage estimates. Missing/malformed or
count-mismatched accounting is unavailable, never an empty-success meter;
refresh retains the previous values with an explicit last-known label.

Anonymous, account, API-origin and data-plane partitions stay separate. The
Settings binding uses the existing workspace lease, including offline account
copies whose remote session is unconfirmed. Identity changes hide the previous
meter immediately and retire pending operations. Refreshes also run on local
writes, focus and a bounded 15-second timer, with newer results winning.

The explicit Protect device storage button requests the browser's standard
origin-wide eviction protection. Merely reading settings never requests it.
Granted, declined, unsupported, failed and timed-out results are distinct;
late completion cannot update a retired workspace or start a protection request
after the check has timed out. Protection is not a backup
or protection from manually cleared site data. Normal Things export/management
and History are linked from the same section. No content or history purge,
new transfer format, remote sync or account permission is added.

Five new tests cover logical JSON/binary/zero-byte usage, rollback, exact scope
separation, damaged accounting without content loss, persistence results and
late completion, missing storage APIs, immediate identity retirement and
unconfirmed offline-account reads. The workspace/offline-shell suites pass
159 checks (six opt-in browser skips). The enabled clean-browser storage case
passes with actual networking disabled: import, cold Settings reload, a second
tab's local write, refresh, injected missing ledger, retained last-known usage,
ledger recovery and unchanged Things. The real browser declined protection and
the UI reported that result. No HTTP mutations or page/module errors occurred;
1440/390/320px views have matching viewport/scroll widths. Manual IAB desktop and
390px views also passed; task tab and viewport override were cleaned up.

Evidence: `tmp/local-storage-controls-ui-late/verification.json` and screenshots;
manual screenshots are in `tmp/local-storage-controls-ui/`. Production client
build: 245 verified assets / 21,211,055 bytes. TypeScript retains the previous
91 diagnostics. Targeted lint has zero errors and one existing constructor
warning. These are local results; account UI sync coverage, broader cross-account
acceptance, offline startup reliability and the unfinished matrix still gate
merge. Browser storage protection does not repair the known startup issue.

The branch review fix for a damaged Timeline view cache is included. Its library
regression and the storage timeout boundary pass together (13 targeted checks).


## Account folder moves — 2026-10-16

Normal bulk moves for locally supported account Things now use `LocalThings.move`
and the existing account create/update queue. Placement, revision and queue intent
commit in one transaction; missing sync bases, cycles and failed writes roll back
all selected items. The destination and ancestor chain must belong to this exact
workspace. Previously uncached sources/ancestors may be fetched while confirmed
online; offline missing content reports a clear error. Mixed batches cannot send
pending local Things through a dedicated remote adapter. Anonymous moves retain
their separate local writer and never create account sync entries.

New local destination folders sync before their children. Existing destinations
use the normal conditional PATCH and expected actor/data-plane headers. Lost
responses retain the frozen operation; a subsequent move remains pending until
that exact operation is acknowledged. Concurrent server changes require the
existing explicit conflict review. Local placement filters apply to both fresh
and cached account folder pages, so a stale remote listing cannot put a pending
move back into its previous folder. This does not complete general pagination or
membership reconciliation.

Cold account folder navigation exposed a separate failure: the optional remote
attachment-manifest probe expected a promise rejection, while the account guard
threw synchronously. That escaped the probe's `.catch()` and unmounted the local
screen into session recovery despite an intact account pointer. Guarded account
API calls now reject promises with the same authority refusal. They do not gain
remote permission or send a request while unconfirmed.

Local acceptance: 164 workspace/offline-shell checks pass, with seven opt-in
browser skips. The enabled clean-browser account-move case passes in 6.2 seconds:
register a disposable local fixture, create two private Things and a folder,
move via the normal multi-select dialog offline, cold-navigate/reload the folder,
verify the server is unchanged, reconnect, and verify two conditional account
PATCHes. All fixture Things are deleted by the test's own cleanup. No account
bulk endpoint is called. There are no page/module or caught-router errors in the
final run; viewport/scroll widths match at 1440/390/320px. Evidence:
`tmp/local-account-move-ui-final/verification.json` and PNGs.

The existing success-notification helper attempted one remote history request
while offline; no claim of zero ancillary requests or complete notification
support is made. Earlier failures in `tmp/local-account-move-ui*` retain the
folder-probe crash evidence. This fix is distinct from the known intermittent
entry-module cancellation issue. Build: 245 assets / 21,212,773 bytes. TypeScript
retains the same 91 baseline diagnostics; targeted lint has zero errors and one
existing constructor warning. These are local results, not CI/deployed proof.
Deletion acknowledgements, coordinated dependency imports, protected adapters,
account Timeline sync and the rest of the matrix still gate merge.


## Device notification history checkpoint — 2026-10-16

`useLopu` and completed streams now commit validated, credential-redacted
messages to the current browser workspace before waking background account sync.
Toast/action completion remains independent. The same message contract and safe
internal-link parser serve the existing authenticated recorder; the shared
redactor uses standard cryptographic UUIDs in both Node and browsers. No new
endpoint, private read permission or remote delivery behavior is introduced.

Open `/notifications?source=device` for this workspace's local Lopu messages.
Anonymous/offline workspaces use that view by default, accessible through the
normal nav bell. Verified accounts retain the existing account-history default
and can switch to device history. Both reuse existing rows, URL filters and
pagination controls. Device rows are already-read, history-only messages; they
do not create a second push/email or an unread badge. Account/social history is
not silently represented as a complete offline cache.

History and queue state share one bounded IndexedDB record. The workspace quota
applies; no count-based deletion occurs. Account origin, owner and selected data
plane partition local copies, even though server notification history remains
home-pinned. Anonymous records never enter a sync state. Account changes retire
transactions and requests. The transport rechecks verified identity, uses the
existing body-recipient check, rejects redirects, caps responses and times out
at 20 seconds. A pass sends at most 20 records, claims expire after 30 seconds,
and transient failures stop after five attempts with a visible failed count.
A lost response reuses the same event UUID and canonical server ID. Permanent
or exhausted failures retain the message; a manual retry UI is still pending.

Local verification: canonical/redaction/notification tests, workspace suite and
client build; clean anonymous actual-offline import → history → cold reload →
search → reconnect with zero mutation requests and no page/module errors.
Measured 1440, 390 and 320px pages have no horizontal overflow. The disposable
account move fixture also verifies offline message persistence and one server
row per event after verified reconnect, through both history views. Evidence:
`tmp/local-notifications-ui-final/verification.json` and
`tmp/local-notifications-account-ui/verification.json`. These are local checks;
CI/preview status is reported separately. General offline-entry reliability,
other notification kinds, cross-tab live refresh and the wider matrix remain
open. The earlier account-move checkpoint's ancillary request is fixed here.


## Structured device search checkpoint — 2026-10-16

`/search?source=device` searches only saved Things in the current workspace,
without login or a network connection. Anonymous/offline visitors default to
this view. `Online search` explicitly selects the ordinary server search, with
its existing authentication, visibility and rate-limit checks. Anonymous online
requests use the existing read-only search POST with credentials omitted,
redirects refused, a 20-second deadline and a 32 KiB body ceiling. Public query
caches are separate from authored local content and never confer ownership.

The device adapter reuses `api/utils/things/searchGrammar.ts`, extracted from
the existing server compiler. All existing field operators, nested all/any
groups, literal escaped string predicates, named emoji matches, primitive types,
array membership and root dates use the same validation. Inherited JavaScript
names are no longer accepted as datatype aliases. Device evaluation reads only
own saved properties, excludes protected records and draft files, and cannot
resolve another account or data plane. No Actions execute during search.

Call the application adapter with `{ workspace: true, device: true, conditions,
q, thingtime, sort, limit, cursor }`. Pages contain at most 50 rows; field groups
retain the shared 32-condition/three-level bounds, filters cap at 32 KiB, and
cursors bind a SHA-256 hash of the workspace and filters. A removed continuation
anchor or changed scope/filter returns an error. Account device results explicitly
remain incomplete: they are saved local content, not the whole remote account.
The existing library's local-first account refresh/pagination is unchanged.

Free text searches literal normalized authored values, not field names. Device
sorts are newest/oldest; Mongo stemming/relevance, author/audience, geographic,
engagement and shortcut filters remain outside this adapter and fail explicitly
rather than silently changing the result set. The UI offers supported device
controls and a local schema rail. Field filters can already express predicates
such as schema ID, tags and date ranges. Schema creation/form UI and account
schema dependency handling remain outstanding in the coverage matrix.

Search caches include origin/account/data plane and source. Views remount on
identity generation/source changes; outstanding results cannot repaint or write
another view's cache. Invalid filters retain the last successful result set and
show an explicit error. Normal source changes do not mix account and device
pages or their cursors.

Local verification: 173 workspace tests passed, with ten opt-in browser skips.
The enabled production-build browser regression separately checks anonymous
25-Thing import and two-page offline search, native numeric filtering, invalid
path errors, cold reload, source changes, no mutation/upload and desktop,
390px and 320px bounds. A disposable private account compares 25 canonical field
queries against the real server API and verifies account device cold reload;
a separate anonymous context cannot read those private fixtures. Evidence:
`tmp/local-structured-search-ui-final/`. The client build contains 242 verified
offline assets (21,512,349 bytes). Lint passes; raw TypeScript retains the same
91 normalized diagnostics as the preceding branch checkpoint, with none added.
These are local checks, not CI/deployed verification or full rollout completion.

## Schema workflow checkpoint — 2026-10-16

`/schemas` defaults to **This device**, combining bundled platform shapes with
schemas saved in the active workspace. **Online catalogue** remains an explicit
remote view. Device search filters before paging; library membership, reactions
and usage counts come from relational local records. Account device results
explicitly describe their partial cache. Protected native schemas retain their
dedicated creation requirements; an editable copy grants no protected authority.

Schema creation and schema-driven Thing creation use the existing canonical
validators and workspace API. Draft flush and retirement run independently of
the content write, including when either draft operation hangs or rejects.
Successful creation retires its draft; failed creation preserves it. Account
data waits for its new schema dependency to sync before its own remote write.

Schema draft contexts include a SHA-256 workspace-scope suffix (origin, account
and data plane). Captured leases reject retired workspace callbacks. Earlier
account/device drafts are explicitly recoverable as independent editor copies.
Malformed local recovery is retained byte-for-byte and cannot seed an autosave
or crash the recursive editor; the UI explains that draft saving is paused while
Thing creation stays available. Existing account draft revision, retry and
tombstone rules remain in force. Account draft transport itself is still online;
its complete local-first sync adapter remains outstanding.

Local production-client browser regressions pass for anonymous offline schema
authoring, builder/form draft reload, data creation and second reload, independent
schema copying and saved-library membership. No anonymous mutation requests were
sent. Native builder/detail layouts fit 1440/390/320px. A disposable authenticated
fixture created and synced a schema and its data while three draft mutations
remained stalled; reload did not reopen the completed draft. A separate malformed
recovery fixture created content while retaining its old recovery bytes.

Run these opt-in checks against the documented disposable local stack:

```sh
TT_LOCAL_SCHEMAS_URL=http://127.0.0.1:22470 \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chromium \
TT_LOCAL_SCHEMAS_ARTIFACTS=/absolute/path/to/artifacts \
node --import tsx --test app/local-workspace/schemas.browser.test.ts
```

Run from `remix/`; only loopback targets are accepted. Evidence for this checkpoint
is local, not CI or deployed verification. Broader catalogue caching, account
interactions/draft sync, multi-tab refresh and the full matrix remain merge gates.

## Component catalogue and version drafts — 2026-10-16

`/components` defaults to **This device**, combining existing bundled suite
components with this workspace's saved copies. Bundled projections remain
unowned and are excluded from Mine/Library. Save a version before applying
local library membership or reactions. **Online catalogue** is an explicit
separate source; device account results do not claim a complete server catalogue.
Library/category/family filters and family grouping run before bounded paging.

Detail and card argument editors reuse the native template resolver and renderer.
Arguments, version name and audience recover through the shared scoped draft
session. Saving uses the canonical Thing writer and never waits for draft sync
or retirement. Each saved device copy opens by its own ID. URL Action sources
retain the existing confirmation and trust ladder; catalogue preview controls
remain inert. Account content identity permits local editing but grants no
remote authorization. Failed refreshes keep the prior preview with an explicit
retry instead of reporting a network failure as a missing component.

Local checks: components 48/48, drafts 32/32, workspace 176 passing with 15
opt-in browser skips, offline shell 4/4; enabled browser scenarios cover fully
offline anonymous browsing, native argument rendering, detail/card draft reload,
independent copies, library membership and 1440/390/320px overflow checks. A
separate disposable account completes and syncs its version while draft writes
never finish, then reloads offline. Raw TypeScript retains the same 91 normalized
baseline diagnostics; focused lint and client build pass (247 offline assets,
21,528,619 bytes). Evidence lives in `tmp/local-component-workflow-ui-final/`.
These are local results, not CI or deployed verification.

Run from `remix` against the isolated production client:

```sh
TT_LOCAL_COMPONENTS_URL=http://127.0.0.1:22470 \
TT_LOCAL_COMPONENTS_ARTIFACTS=../tmp/local-component-workflow-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/components.browser.test.ts
```

Pending component coverage includes full account discovery caches, cross-tab
refresh, source-control editing recovery, bundled-only bookmarks and remaining
Builder global/site block surfaces. The broader merge gates above still apply.


## Global and site blocks — 2026-10-16

Builder now offers **Customize a site page** alongside **Global blocks** without
requiring an account. Both surfaces use the existing webpage Thing schema,
canonical writer and native section renderer. The server seed and offline editor
share the same 27 route definitions; saving creates a private workspace version,
not a replacement system definition. Native sections keep their own permissions.

The editor recovers name, blocks and audience with the shared workspace draft
session, fenced against a newer saved page. Save and reset do not await account
draft transport or cleanup. Discard and reset retire unfinished recovery so it cannot
resurrect after reload. Existing Timeline/history behavior is unchanged.

The site host resolves anonymous and offline account pages through their existing
local adapters. Its bounded cache belongs to the full workspace identity, keeps
last loaded blocks after refresh failure, exposes Retry and fences delayed reads.
Same-origin tabs exchange scope-only invalidations, never content or credentials.
Global and route-specific sources have separate existing webpage runtimes; source
execution still uses the normal Action adapters and authorization/trust policies.

Local verification: 156 webpage, 33 draft, 178 workspace and four offline-shell
tests pass (5 webpage and 18 workspace integration/browser tests opt-in). Three
clean production-client browser scenarios cover fully offline draft recovery,
normal save/reset, two-tab updates, native section uniqueness, 1440/390/320px
layout, account/anonymous isolation, confirmed server sync while account drafts
stall, and imported source-bound components after offline reload. The actual
server resolver confirms sync; browser-local reads are not sync evidence.
The build has 247 verified assets (21,535,609 bytes); raw TypeScript retains the
same 91 baseline diagnostics. Focused lint has only six existing useWebpage
warnings. Screenshots and checks: `tmp/local-site-blocks-ui/`.

Run from `remix/` against the isolated production client:

```sh
TT_LOCAL_SITE_BLOCKS_URL=http://127.0.0.1:22470 \
TT_LOCAL_SITE_BLOCKS_ARTIFACTS=../tmp/local-site-blocks-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/siteBlocks.browser.test.ts
```

These are local results. CI and deployment have not verified this checkpoint.
This closes basic global/site composition, draft recovery and source rendering;
full control-editing recovery, account reset/delete sync, cross-device conflicts,
and the broader acceptance matrix above remain merge gates.


## Account deletion and reset — 2026-10-16

The existing account queue now handles ordinary owned data, folders, webpages,
components, schemas and Action definitions through canonical `DELETE /api/v1/things`.
Deleting content and recording deletion intent commit atomically. Never-sent local
creates disappear without a remote request. Attempted creates/updates retain their
frozen request until its outcome is known, then delete using the acknowledged
server timestamp. Ambiguous deletes require scoped absence readback; permission
refusals cannot be mistaken for success. Identity retirement fences late responses.

Folder deletion moves cached direct children to the surviving parent and syncs
those moves first. Target-linked children delete first; a conflicting child holds
its parent. Keeping a linked account version visibly blocks the parent deletion
until that child is explicitly deleted. Unknown/protected content continues using
its dedicated authorized adapter; this does not complete every deletion adapter.

Before-images remain in the same bounded workspace storage while deletion is
pending. Acknowledgment releases their content and retains a small tombstone to
prevent stale list/resolve reads from resurrecting it. Conflict review offers the
account version or deletion of the explicitly reviewed version. Cached list
membership retains hidden IDs so restoration appears immediately; the Things UI
refreshes visible folders after scoped workspace changes. A false browser online
hint cannot make an unverified workspace fetch its reset page remotely.

Local verification covers normal offline Things deletion and Builder global reset,
cold reload, zero offline mutations, real server readback, child preservation and
both conflict choices at 1440/390/320px. The existing account-move and three site
composition browser scenarios also pass. Unit coverage includes reload/lost
responses, in-flight create refusal, two-tab claims, permission refusals, retained
content bounds, identity changes and dependency conflicts. Evidence lives under
`tmp/local-account-delete-ui/` and `tmp/local-account-delete-*-tests.log`.

Run from `remix/` against a disposable production client:

```sh
TT_LOCAL_ACCOUNT_DELETE_URL=http://127.0.0.1:22470 \
TT_LOCAL_ACCOUNT_DELETE_ARTIFACTS=../tmp/local-account-delete-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/accountDelete.browser.test.ts
```

These results are local, not deployed verification. The full matrix above remains
the merge gate; protected History/account Timeline synchronization, dedicated
adapters, imports and wider account discovery still need completion.

Final local checks: 192 workspace tests and four offline-shell tests pass (19
opt-in workspace/browser tests skipped in the default command). Five enabled
browser scenarios pass; the deletion scenario was rerun after the final safety
change. Client build: 247 verified static assets / 21,541,680 bytes. Raw
TypeScript retains the same 91 normalized baseline diagnostics. Focused lint:
zero errors and four existing ThingsPage hook warnings. No baseline was relaxed.


## Account import checkpoint — 2026-10-16

The normal Things import dialog now imports ordinary account data, folders,
webpages, components, schemas and Action definitions locally before networking.
Caller JSON is validated, bounded and copied before asynchronous work. New IDs,
rewritten references, content and sync intent commit atomically. Cancellation,
unsupported kinds, quota or placement failures cannot leave a partial local batch.
No Action runs during import, and legal executable cycles keep their remapped IDs;
structural/provenance cycles use the canonical import rejection.

`utils/thingTransfer/importContent.ts` shares the account server/device copy rules:
fresh definition keys and schema names, no inherited site placement, and canonical
reference remapping. Account destination folders also contain unparented dependencies,
matching the normal importer. Anonymous import retains its existing local IDs and
site/suite behavior; this checkpoint does not claim complete import-semantic parity.
Account copies use the existing private ordinary-Thing queue and expected-actor/
data-plane transport. Server synchronization can complete individual records at
different times; unresolved sync stays visible and exact retries keep their IDs.
Anonymous storage is never adopted by this queue. Files, linked media and managed
kinds continue through their dedicated adapters and remain outstanding offline
account work. Account export UI/cache completeness is also still outstanding;
the export in the browser round-trip below deliberately uses the normal server API.

Local checks: 197 workspace tests, four offline-shell tests and 315 Things tests
pass (20 workspace/browser tests require explicit opt-in). Four enabled browser
scenarios pass: the new normal-dialog account import plus the three existing site
composition checks. The account fixture imports while fully offline, renders
through the native page/component renderer, edits before sync, cold-reloads, fits
1440/390/320px, sends zero offline mutations, and verifies private server copies
after reconnect. A real server export then passes the canonical validator and
normal importer with independent IDs and complete schema/component references.
Evidence: `tmp/local-account-import-ui/`, including `exported.thingtime.json`.

Client build: 247 verified assets / 21,543,863 bytes. Raw TypeScript retains the
same 91 normalized baseline diagnostics. Focused lint has zero errors and one
existing LocalThings constructor warning. These are local results, not deployed
verification or completion of the full matrix.

Run from `remix/` against the disposable production-client fixture:

```sh
TT_LOCAL_ACCOUNT_IMPORT_URL=http://127.0.0.1:22470 \
TT_LOCAL_ACCOUNT_IMPORT_ARTIFACTS=../tmp/local-account-import-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/accountImport.browser.test.ts
```


## Account export checkpoint — 2026-10-16

The normal Things Download dialog now exports ordinary account content locally.
`accountExport.ts` reuses `exportLocalThingSnapshot`, the existing collector,
composition rewriter, canonical validator and serializer. New unsynced content
requires no draft save, sync or network request. Pending edits, moves and
local deletions overlay the last complete device export snapshot. The UI calls
this a device snapshot; it cannot promise changes made elsewhere while offline.

A cached library page is not proof that all folder children, dependencies or
media were read. For existing server content, the adapter prepares missing
coverage through the canonical server exporter while online and verified, then
retains validated content-only snapshots in the account/origin/data-plane scope.
Missing coverage or required dependencies refuse the download while offline;
no partial success is returned. Existing shared-link requests remain uncached.
Export-only dependency copies are not editable owned Things, sync entries or
alias candidates for account-owned definitions. Exact dependency IDs retain
meaning; shared keys cannot capture a local component alias.

Snapshots are keyed by selected IDs and every include option, limited to 16
entries, subject to actual browser storage availability. Cache retention
is optional: an over-quota snapshot does not prevent downloading the only local
copy (`retainedOnDevice: false`). Local collection uses one content/sync snapshot;
identity, cancellation and the canonical 30-second preparation deadline fence
completion. Remote preparation uses bounded responses and the existing actor/
data-plane transport, capability negotiation and 20-second request timeout.

This checkpoint covers ordinary no-file/no-link transfers. Media and managed
content retain their dedicated online export path; pending local edits cannot
silently be replaced with older server content. Offline file/linked-gallery and
managed-account exports remain acceptance work, as do broader catalogue/cache
membership and cross-device refresh. Account imports with files remain gated.

Local verification: 206 workspace tests and four offline-shell tests pass;
20 opt-in workspace/browser cases are skipped in the general suite. All 315
Things tests pass. The enabled disposable-account browser scenario now downloads
actual JSON from the normal dialog while fully offline, preserves all five
Things and the pending page edit, round-trips that exact file through the normal
server importer, and downloads the same device snapshot after sync and cold
reload. It verifies zero offline mutations, no browser errors, native preview
bounds at 1440/390/320px, and a usable 320px Download dialog. Artifacts live in
`tmp/local-account-export-ui/`, including `offline-exported.thingtime.json` and
`export-dialog-320.png`. Run the existing `accountImport.browser.test.ts` with
its documented environment and this artifact directory to repeat it.

Client build: 247 verified offline assets / 21,549,320 bytes. Focused lint has
zero errors and the existing LocalThings constructor warning. Raw TypeScript
retains the same 91 normalized baseline diagnostics. These results are local;
CI and deployed behavior remain separate, and the full matrix is not complete.

Final graph verification: the semantic refresh hit Graphify's shrink guard for
the PR note (two semantic nodes became one), so no partial semantic graph was
accepted. The earlier semantic extraction is retained and the final source uses
the repository-permitted structural refresh. Final documentation semantic
freshness is unverified; source fingerprint and graph/manifest coverage are
checked separately.

## Builder definition and source-control recovery checkpoint — 2026-10-16

Builder menus now use workspace ownership for editing and private duplication;
account authentication still gates sharing. Definition recovery uses the existing
workspace-scoped draft session, retaining raw JSON, Fields/Source mode, expanded
fields, unfinished property names and raw numeric input such as `1e-`. Invalid
numbers cannot silently become a different saved number. Array moves/removals
keep unfinished input with the right row. The original saved-version fence is
retained; stale recovery requires an explicit discard before using newer content.
Malformed recovery is kept verbatim with autosave paused. Canonical content
updates, draft saves, Timeline recovery and cleanup complete independently.

Component source controls retain unfinished Action keys, interval and input JSON
in the same isolated workspace recovery. Restoring them never binds or executes
an Action; explicit binding and existing confirmation still apply. Ordinary
file-free Builder forks and Things copies use canonical export/import locally,
including offline account copies. Dedicated media/managed copies retain their
existing remote path and refuse to replace pending local edits. Account reads
with an absent optional bearer key stay local; an actual key retains its guarded
remote path.

Local verification: 206 workspace, four offline-shell, 33 draft, 52 component and
315 Things tests pass. The general workspace suite skips 22 opt-in scenarios;
the two definition scenarios were separately enabled and passed. Clean anonymous
and disposable account browsers prove numeric/raw-source recovery, native save,
source-control recovery without execution, independent duplication, stale-version
refusal, explicit discard and malformed recovery preservation. Account content
sync completes while draft POSTs are held indefinitely. Offline mutation requests
and browser errors are zero. Dialog bounds and PNGs cover 1440/390/320px in
`tmp/local-definition-ui/`; the production client has 247 verified assets /
21,555,433 bytes. Targeted lint has no warnings/errors; TypeScript retains the
91 baseline diagnostics. Existing anonymous/account Component browser regressions
also pass; the sync assertion now polls the real server through the fixture
request context instead of browser fetch, which intentionally returns local
content first. This is local evidence, separate from CI/deployment.

These checks cover the shared ThingDefinitionEditor and Component source controls.
They do not claim raw-number recovery in other DefinitionValueEditor consumers,
cross-device draft conflict UI, account file/managed copies or the remaining
full-suite acceptance matrix. No main merge or manual deployment.

## Account catalogue discovery and cross-tab refresh — 2026-10-16

Visiting online Component or Schema catalogue pages now retains their owned
ordinary definitions in the same account workspace used by Things and Builder.
Requests use the existing bounded account transport with expected-actor and
data-plane headers, capability checks, identity cancellation and response limits.
Shared/system entries remain read-only catalogue results; they never become
editable owned records or sync intent just because they were displayed.

`AccountThingSync.rememberMany` validates and commits at most 50 owned records
atomically. Invalid content or quota failure cannot partially retain a catalogue
page; the online result remains usable with a device-save warning. Incoming
snapshots cannot overwrite pending edits or revive deletion tombstones. Repeated
identical reads do not broadcast changes. Device Component/Schema catalogues and
Component detail previews now re-read after scoped workspace invalidations from
other tabs, keeping current paint and editor state while reloading. Component
family caches are invalidated too.

Local verification: 208 workspace, four offline-shell, 52 component and 265 schema
tests pass; 23 general-suite opt-in cases are skipped. The enabled catalogue
browser scenario creates 23 private server Components and a Schema through real
APIs in a disposable account, discovers both Component pages, then disables all
networking. All 23 remain pageable after cold reload, rename works natively and
updates another open catalogue/detail, the discovered Schema creates local Data,
and a newly authored Schema appears in another tab. Offline mutation requests
and browser errors are zero. Existing anonymous/account Component browser
regressions also pass. Actual 1440/390/320px PNGs and request/header/bounds evidence
are in `tmp/local-catalog-ui/`. The client build contains 248 verified offline
assets. Targeted lint is clean; raw TypeScript retains 91 baseline diagnostics.
These results are local, separate from CI and deployed verification.

This covers visited catalogue pages, not automatic download of an account's
entire library or complete discovery of unvisited pages. Wider cached Things
membership/pagination, account bookmark/social adapters and cross-account/device
acceptance remain on the full matrix. No main merge or manual deployment.


## Anonymous bundled bookmarks and reactions — 2026-10-16

The device Component catalogue now lets anonymous users bookmark and react to
code-shipped definitions directly. The dedicated local interaction writer accepts
only exact trusted bundled references for these operations. It stores scoped
relational save/reaction records; it never inserts the bundled target into owned
Things, changes its provenance, executes an Action or sends an account mutation.
Unknown IDs, mismatched resolver IDs/kinds and account scopes fail closed. Existing
transactional toggles, quota accounting and reaction limits remain in force.

Library includes saved bundled definitions and orders entries by bookmark time,
while preserving the definitions' original timestamps and keeping Mine limited to
owned copies. Reactions, bookmarks and removals survive offline reload and refresh
other tabs through existing scoped invalidations. Ordinary post interactions do
not load the bundled Component catalogue.

Local verification: 210 workspace, four offline-shell, 52 Component and 265 Schema
tests pass. The general workspace suite skips 24 opt-in scenarios; all three
Component browser scenarios were separately enabled and passed. A clean anonymous
context verifies real offline bookmark/reaction recovery, two-tab save/removal,
unchanged attribution and exclusion from Mine, with zero remote mutation requests
or browser errors. Desktop/390px/320px PNGs and measured bounds are retained in
`tmp/local-bundled-ui/`; all three widths have no horizontal overflow. Existing
anonymous editor and account content-save-with-stalled-drafts regressions pass.
The client build verifies 248 offline assets / 21,558,539 bytes. Targeted lint has
zero errors and one constructor warning; TypeScript retains the same 91 baseline
diagnostics. This is local evidence, separate from CI and deployed verification.

Account bookmarks/reactions still need a dedicated synchronization adapter: the
existing remote toggle cannot safely be replayed after an uncertain response.
Account guards remain enforced. The full acceptance matrix remains open; no main
merge or manual deployment.


## Account bookmark and reaction synchronization — 2026-10-16

Cached owned Things and trusted bundled Component references now complete
bookmark/reaction changes in the scoped account workspace before attempting
remote sync. Device Library membership, counts and cross-tab updates use those
retained choices. A missing server-side bundled target remains local with a
visible synchronization error; it never creates or publishes the target.
This checkpoint initially left uncached/foreign targets on the guarded online
adapter; the following post-snapshot checkpoint extends that coverage. Neither
checkpoint completes the full matrix.

`AccountInteractionSync` stores bounded desired membership independently from
ordinary Thing content and draft queues. The worker drains content and
interactions concurrently after verified account/origin/data-plane binding.
Anonymous namespaces cannot instantiate this synchronizer and never upload.
Frozen retries, transactional tab claims and response identity checks preserve
newer local edits. A reload after claiming a request can wait up to the existing
60-second claim window before another worker retries it.

The first-party `api.things-interactions` 1.0.0 capability provides bounded
private state reads and conditional desired-state writes at
`/api/v1/things/interactions`. It reuses canonical visibility, engagement,
transaction, quota, history and rate-limit helpers. Every canonical save/reaction
create, edit and delete changes the target's internal interaction revision in
the same transaction, including legacy toggles and generic CRUD. A stale command
returns 409; a lost response is reconciled against current membership rather
than replaying a toggle. The review panel shows device/account choices and
rebases only the reviewed local fields, retaining unrelated remote reactions.
Internal revision metadata is absent from normal portable content exports.
Legacy embedded/interim reaction residue is refused for synchronization until
canonical reconciliation; it is never treated as an empty membership baseline.

Local verification: 218 workspace plus four offline-shell tests, 315 Things
tests and 95 capability tests pass (632 total; 25 opt-in workspace cases skip in
the general command). All three existing Component browser scenarios and the
new account-interaction browser scenario were separately enabled and passed.
The latter exercises a disposable replica-backed account, full offline network
failure, cold reload, two-tab bookmarks, a genuinely dropped successful server
response, stale-write races, generic/legacy revision invalidation, permission
and identity refusals, input limits, native conflict review and canonical export.
The browser records zero offline mutation requests or page errors, and PNGs at
1440/390/320px have no horizontal overflow. The 320px review panel clears fixed
navigation and wraps its controls. Evidence: `tmp/local-interaction-ui/` and
`tmp/local-interaction-component-ui/`. The client build verifies 248 offline
assets. Targeted lint has zero errors and three existing Things warnings;
TypeScript has the same 91 baseline diagnostics. These are local results;
CI and deployed verification must be read separately for the pushed revision.

Remaining work includes noncached account social/catalogue membership, complete
account post/file/draft and other dedicated adapters, cross-device recovery and
the rest of the acceptance matrix. Main remains unmerged.

## Account post snapshots, Saved and offline membership — 2026-10-16

Normal authorized feed, trending, Saved and permalink reads now retain bounded
read-only post snapshots in the existing account/origin/data-plane workspace.
They never become owned Things or queued content writes. A whitelist strips
server-only envelopes and hidden-link bearer fields, preserves original authors
and editable display content, and keeps attachment bytes behind the existing
authenticated resolver. Explicit shared-key reads retain their online path.

Save/react now records desired membership locally for account targets even when
the target is not an owned cached definition. Native post and comment reaction
controls use offline workspace identity only for these local intents. Other
account actions still require their actual authority. Conditional independent
sync performs fresh permission checks; anonymous workspaces cannot replay the
queue. Batched interaction retention uses request-start watermarks so delayed
reads cannot roll back newer membership or completed commands. Saved reads also
retain canonical bookmark timestamps instead of reordering by post creation.

The native Saved library supports scoped device pagination, offline reload and
cross-tab changes. Permalinks recover retained posts offline and refresh cached
ordinary posts optimistically online. Offline coverage is explicitly partial:
unvisited posts, uncached conversation context, cloud attachment bytes and full
feed pagination are not fabricated. A known 403/404/410 removes the snapshot,
prunes nested comment/share/linked copies, clears this scope's Saved first-paint
cache, and fences delayed reads from resurrecting the refused content. A fresh
authorized read may retain it again. Scope-keyed post views reset on logout or
account changes; previous snapshots grant no read/write permission.

Local checks: 224 workspace + four offline-shell + 78 feed tests pass (306),
with 26 opt-in browser/integration scenarios skipped by the general workspace
command. The new post browser scenario is separately enabled and passes against
the disposable local replica stack: a post privately shared between two test
accounts survives cold offline permalink/Saved reload, local Save/react and
cross-tab changes; reconnect applies both choices; logout prevents anonymous
offline recovery; revocation prevents later offline resurrection. It records
zero offline mutations/page errors and no horizontal overflow at 1440/390/320px.
Evidence: `tmp/local-social-ui/verification.json` and `account-saved-*.png`.
TypeScript retains the same 91 baseline diagnostics. This is local acceptance,
not deployed verification or completion of the full matrix.

Run from `remix` with shared Playwright/Chrome paths configured:

```sh
TT_LOCAL_ACCOUNT_POSTS_URL=http://127.0.0.1:22470 \
TT_LOCAL_ACCOUNT_POSTS_ARTIFACTS=../tmp/local-social-ui \
node --import tsx --test app/local-workspace/accountPosts.browser.test.ts
```

The target must be the disposable local replica stack. The test uses the normal
API to create/register its fixtures and never weakens registration rate limits.
Broader feed/discovery cache membership, account post/comment writes, private
media recovery, dedicated adapters, cross-device coverage and the remaining
matrix still gate main. Posting and draft completion remain independent.


## Durable account file upload adapter — 2026-10-16

`AccountFileSync` commits immutable upload intent, a local file Thing and its
exact bytes in one scoped IndexedDB transaction. Queue admission failure rolls
back all three. It reuses the canonical attachment start/parts/complete services,
part ranges, checksum requirements, completion retry classifier and public
attachment projection. The original request identity, acknowledged parts and
completion phase survive reload; a lost completion response retries completion
without starting a new upload. Only the server's explicit retryable-parts codes
return an uncertain finalization to byte upload.

The account worker drains file, content and interaction queues concurrently after
verified account/origin/data-plane binding. Anonymous content cannot enter this
queue. Account API calls negotiate capabilities and pin actor and data plane;
signed byte PUTs omit cookies and referrers, refuse redirects, and retain the
normal CSP. No signed storage URLs are persisted. Three files per normal pass,
45-second attempts, 60-second cross-tab claims, existing workspace byte quotas,
and server Retry-After/backoff bound work. Permission refusals preserve bytes and
surface a native retry panel; identity retirement fences late completions.

This is an **internal adapter foundation**, exposed through the account facade's
`attachments.saveLocalFile/readLocalFile`. The ordinary account file picker still
uses its existing upload path. Account file listing/media previews, annotation,
delete/cleanup reconciliation, post attachment binding, expired-upload recovery
and complete account post authoring remain acceptance work. This change does
not make publishing depend on drafts, or claim full offline account file UI.

Local verification: eight queue tests and the upload transport regression cover
atomic quota rollback, malformed plans, account/origin/plane isolation, persisted
reopen, tab claims, cancellation, preserved retry timing, permission refusal,
receipt mismatch and uncertain completion. The opt-in browser test exercises the
actual app and private upload service on a disposable replica: exact bytes save
offline with zero mutations, a normal upload approval refusal leaves them intact,
a local fixture admin grants private uploads through the real admin API, and a
lost successful completion response recovers with exactly one byte PUT. Guest
content reads return 404. The open retry panel has no horizontal overflow at
1440/390/320px. Evidence is in `tmp/local-file-sync-ui/verification.json` and
`file-sync-*.png`. This is local adapter/service acceptance, not deployed or
full native account file-authoring acceptance. Setup is in README's local
workspace section; the test imports real Vite modules and needs the dev origin.

The focused checkpoint passes 233 workspace tests plus four offline-shell,
295 attachment and 95 capability tests (627 total). The general workspace
command skips 27 opt-in scenarios; the account file browser scenario is enabled
separately. Raw TypeScript has the same 91 pre-existing diagnostics and none in
the changed local-workspace files. No main merge or production verification is
claimed; full native account files/posts and the wider acceptance matrix remain.


## Conditional account file metadata — 2026-10-16

The existing attachment annotation endpoint now accepts optional
`expectedUpdatedAt`, checks it inside the canonical home transaction, and returns
its committed timestamp. Real edits advance that timestamp monotonically.
The existing bulk route accepts the same precondition for a single-item move;
managed placement preserves it through its transactional source/destination
checks. Per-item stale failures carry `status: 409` inside the normal HTTP 200
bulk envelope. Other operations and multi-item conditional requests return 400.
Both discovery manifests advertise annotation 1.2.0 and bulk 1.6.0; the account
file transport negotiates these versions and handles per-item refusals.

This supplies the server/transport prerequisites for safe file reconciliation.
The durable local annotation/move/delete queue and ordinary account file picker,
listing, media and post-binding integration remain incomplete. No login gate or
permission check is removed by this change.

Local verification: 947 unit checks passed (233 workspace, 4 offline shell,
295 attachments, 96 capabilities, 319 Things), with 27 opt-in workspace scenarios
skipped by the generic command. The file browser scenario was separately enabled
against the disposable replica and real Vite app: offline bytes, upload approval
refusal, one PUT after a lost completion response, exact private bytes, guest 404,
stale/malformed annotation refusals, one winner from concurrent edits, and stale
folder-move rejection all passed. Retry-panel widths 1440/390/320 had no overflow.
The built Node/Nitro server served both manifests and both docs routes as JSON
and refused anonymous mutation requests with 401. Evidence is in
`tmp/account-file-metadata-ui/verification.json` and
`tmp/account-file-metadata-built-smoke.json`. TypeScript still reports 91 baseline
diagnostics, none in changed paths; focused lint has zero errors and three
existing Things warnings. This is local verification, not production acceptance.

The fixture now cleans completed uploads through the dedicated attachment delete
API, asserts success and then confirms content returns 404. Its previous generic
Thing DELETE could return 404 for protected attachments without cleaning bytes;
previous fixture runs therefore did not prove completed-file cleanup. Browser
closure now runs even when cleanup fails. Existing real accounts are untouched.


## Durable account file details — 2026-10-16

`accountFileMetadata.ts` now retains filename-preview, title, description and
folder edits independently of byte upload. The existing local file writer commits
the edit and queue intent together, including folder selection at initial save.
Upload receipt identity remains immutable. Original file-save retries retain the
initial folder choice for identity checking, so later moves cannot turn a replay
into a second file or erase later details.

After verified account binding, the metadata queue waits for the canonical upload
receipt and a synchronized destination folder. It uses the existing conditional
annotation/move APIs, reconciles lost replies before sending newer edits, adopts
unrelated account changes, and requires review for concurrent edits to the same
field. Claim tokens, 45-second attempts, three files per pass, per-request deadlines
and bounded retry delays keep work scoped. New edits during an in-flight write
survive its completion. The native file sync panel compares both versions and
rechecks local revision and account timestamp before accepting a choice. Bytes,
server-owned storage fields and publication remain outside metadata writes.

The account facade now accepts local-file annotation and `moveLocalFile` without
a network requirement. This still does **not** switch the ordinary account file
picker/list/media surfaces: deletion/cancellation reconciliation, canonical ID
aliases, media resolution, existing-account file retention and post binding remain
required before those paths can be considered complete. Anonymous files retain
their separate local writer and cannot construct the account queue.

Local checks: 955 passing tests (241 workspace, 4 offline shell, 319 Things,
295 attachment, 96 capability); the generic workspace command skips 27 opt-in
browser scenarios. Eight new metadata tests cover reopen, folder dependency,
ambiguous replies/newer edits, cross-tab claims, account conflicts and stale
reviews, quota rollback, cancellation, scope/identity refusal and original save
identity. The enabled real Vite/replica browser test saves details and a folder
offline with zero mutations, reviews a conflict through native controls at
1440/390/320px, drops a successful annotation reply, then verifies exact final
metadata/placement/bytes and canonical attachment cleanup. The fixture resolves
exact app-loaded Vite module URLs; bare imports after HMR create an unrelated,
unbound singleton and are not valid runtime evidence. Screenshots and requests:
`tmp/account-file-reconcile-ui/`. The client build verifies 248 offline assets
(21,602,918 bytes); TypeScript retains 91 existing diagnostics with none in changed
paths; lint has zero errors and one existing LocalThings constructor warning.
These are local results. CI/deployed verification and the full acceptance matrix
remain separate; no main merge or manual deployment is claimed.


## Conditional attachment deletion — 2026-10-16

The existing `/api/v1/attachments/delete` now accepts optional
`expectedUpdatedAt` (capability and contract `api.attachment-delete` 1.2.0).
A stale read returns 409 before object storage is touched. The version also
participates in the atomic deleting claim, so a concurrent annotation or move
cannot be silently discarded between the read and claim. Owner, exact target,
finalization, private access and existing quota/cleanup rules remain enforced.

An already-claimed deletion resumes cleanup with the original precondition even
though its lifecycle timestamp advanced. Deferred multipart cleanup remains
billed until storage verification finishes. A skipped conditional claim reports
409 for a live row or 503 for unfinished cleanup, rather than false completion.
Absence remains idempotent success. It is **not** a cancellation receipt: a delayed
upload start can still reserve an absent request ID. A durable cancellation fence
is required before wiring offline file deletion, and that work remains pending.

Local validation: 396 tests pass (299 attachment, 97 capability), including stale,
malformed and racing versions, deferred cleanup and absence. The enabled real
Vite/replica browser fixture passes in 11 seconds: it verifies offline metadata
and conflict review at 1440/390/320px, then races a conditional deletion against an
annotation and proves exactly one wins; stale deletion preserves the exact bytes,
completed deletion yields content 404, and retrying the lost receipt succeeds.
Evidence is in `tmp/account-file-delete-ui/verification.json`. The Node/Nitro build
passes; both built-server manifests advertise 1.2.0, the docs route returns JSON,
and anonymous deletion returns 401. TypeScript reports the same 91 baseline
diagnostics with none in changed paths; focused lint has no errors or warnings.
CI and deployed feature acceptance remain separate. No main merge, manual deploy,
public publishing or existing-account mutation is included in these checks.


## Durable upload cancellation — 2026-10-16

`POST /api/v1/attachments/uploads/abort {requestId}` now reserves the original
owner-scoped upload identity with a private cancellation receipt, including when
the upload start has not arrived. Abort capability/contract 1.2.0 distinguishes
this mode from legacy `{uploadId}` cleanup. `cancelled:true` confirms a durable
fence; `deferred`/`retryAt` still describe outstanding storage cleanup. Completed,
finalizing or bound uploads return 409 for fresh reviewed deletion. The new mode
requires full user authentication; paired Watch credentials retain legacy cleanup.
Same-origin checks, rate limits, home-plane isolation and upload approval remain.

Pending uploads atomically enter the existing deleting lifecycle with a protected
`attachmentCancellationRequested` marker. Its cleanup transaction replaces the
row with a closed `cancelled` attachment envelope only after byte cleanup passes.
Receipts have zero object bytes, no target/upload/expiry, and a small accounted JSON
payload (134 bytes in the real fixture). They never expire: deletion or expiry
would reopen the original identity to arbitrarily delayed starts. Existing normal
abort/delete cannot remove these receipts. No new collection or uncharged side
store is introduced; generic reads, media and publication cannot expose them.

The account file queue records whether a start was attempted before sending it.
Never-started cancellation completes wholly locally. Ambiguous starts retain bytes
and queue the original request ID offline; the worker negotiates the fenced API
after verified account/data-plane binding. A confirmed receipt atomically removes
device bytes, the local file and its unused metadata intent, retaining a local
replay tombstone. Missing/legacy responses and finalized-file conflicts retain
bytes. Cancelling invalidates competing tab claims, and each next network step
rechecks its claim. The native file sync panel offers Cancel upload offline and
shows pending cancellation separately from upload retry. Editor-bound post/comment
uploads stay with their owning editor; finished account files require the pending
dedicated deletion/review integration.

Local checks: 1,255 pass (250 workspace/offline shell, 306 attachment, 17 storage,
265 schema, 319 Things and 98 capability); 27 opt-in workspace browser tests are
skipped by the generic command. The separately enabled real Vite/replica browser
scenario passes cancellation before start, concurrent start/cancel, a lost start
reply followed by native offline cancellation, a lost cancellation reply, replay
refusal, legacy-cleanup receipt retention, finalized-file refusal, owner/guest
media 404 and canonical cleanup. Native controls fit 1440/390/320px. Evidence:
`tmp/account-file-cancel-ui/`; a read of only that fixture's database receipt also
confirms private zero-object accounting and no expiry. Client and Node/Nitro builds
pass; built discovery/docs/auth checks confirm abort 1.2.0 and anonymous 401.
TypeScript retains 91 baseline diagnostics, none in changed paths; focused lint
has zero errors and five pre-existing warnings. These are local results, not
current-head CI or deployed acceptance. Normal account picker/list/media, completed
file deletion/conflict review and the rest of the full coverage matrix remain
unfinished. No main merge, manual deploy or existing-account mutation is claimed.

Cancellation control fields reserve 1 KiB at file admission; final cancellation
releases bytes before updating its retained receipt in the same transaction. A
simulated IndexedDB capacity test fills its 64 MiB fixture budget and proves both never-started and
previously attempted cancellation can still complete.

Graph verification: the initial semantic refresh completed, but the follow-up
for the quota correction refused an unverified semantic node shrink. The guard
was preserved; the final structural refresh retains earlier documentation nodes.
Latest documentation semantic freshness is therefore unverified.

## Completed account file deletion — 2026-10-16

`accountFiles.ts` now removes an uploaded standalone file from the device Things
list atomically with durable deletion intent. Its bytes and removed snapshot stay
in the same private account/origin/data-plane partition for recovery. Metadata
sync pauses for that file; new writes cannot recreate its original identity.
Deletion, conflict recording and restoration fit at an exhausted browser capacity
using the upload record's reserved control space. Never-started/uncertain uploads
continue to use cancellation, and bound/editor media retains its owning adapter.

The worker compares current account details with the removed device snapshot and
freezes the conditional deletion before sending it. Changed account details or a
racing edit require native review: Keep device file restores the local copy;
Delete reviewed account file rechecks the account timestamp and local snapshot.
A lost reply retries the identical request, without reading a missing row as
success or uploading again. Only a `deleted:true` receipt releases recovery bytes.
The account worker now coalesces a wake received during a drain; otherwise a
quick restore/delete or reconnect could leave fresh work idle after the final
status read. Metadata and other queue operations keep their existing boundaries.

Attachment delete **1.3.0** accepts `{id, requestId, expectedUpdatedAt}` for this
full-user standalone-file mode. It validates the original upload identity, rejects
target binding and unfinished files, and uses the existing version-fenced cleanup.
The same private, quota-accounted cancellation receipt survives exact-version
object deletion. Missing rows also acquire this replay fence; stale live rows
still refuse. Original upload-start retries and legacy cleanup cannot resurrect
or purge it. An asynchronous moderation verdict is now restricted to ready files
so it cannot stamp a deleting row or its retained receipt. No new collection,
public content, credential, or permission bypass is introduced.

The normal account picker/list/media and existing-account file cache/alias wiring
remain unfinished. This checkpoint covers the scoped file adapter, facade
`attachments.deleteLocalFile({id})`, worker, and native conflict review. It does
not complete the full local-workspace matrix or authorize a main merge.

Local verification: **728 checks pass** (259 workspace/offline shell, 308
attachment, 98 capability and 63 moderation); the generic workspace command
skips 27 opt-in browser fixtures. The separately enabled real browser scenario
passes offline deletion and restore at full quota, stale native review refusal,
concurrent annotation/deletion with one winner, lost successful deletion reply,
identical retries, original upload replay refusal and owner/guest media gates.
Native review was inspected at 1440/390/320px; the browser reported no page errors.
The disposable database receipt has 134 accounted JSON bytes, zero object bytes,
owner-private ACL and no expiry. Evidence: `tmp/account-file-delete-ui/`,
`tmp/account-file-delete-receipt-check.json` and the `account-file-delete-*` logs.

Client and Node/Nitro builds pass. The client contains 248 verified offline
assets (21,613,315 bytes); both built manifests advertise delete 1.3.0, both
attachment delete/abort docs routes serve JSON, and anonymous mutations return
401. TypeScript retains 91 baseline diagnostics with none in changed paths;
focused lint has no errors or warnings beyond the tooling deprecation notice.
These are local results; current-head CI and deployed acceptance remain separate.
No main merge, manual deployment or existing-account mutation was performed.


## Normal account file UI and scoped previews — 2026-10-16

The ordinary Files picker now commits standalone bytes and upload intent through
`saveLocalFile` for account workspaces as well as anonymous workspaces. Folder
creation and local file moves use the existing facade. Local saves and list
refresh complete before account discovery or upload; account failures remain
visible and do not undo device content. The 16 MiB per-file device limit applies;
paired-device transfers keep their existing 32 MiB limit and approval gates.

Device file pages retain stable local IDs. Account lists replace owned uploaded
aliases with those IDs and suppress aliases of closed records. Explicit device
pagination includes standalone files; the file browser reads all bounded device
pages alongside authorized account discovery. Existing remote files remain
online reads until a dedicated retention adapter is implemented. This is not a
claim that the general cached-list membership/pagination work is complete.

Object URLs are scoped to account, origin, data plane and root generation;
unconfirmed offline accounts can still read their own bytes. Identity retirement
revokes URLs, and scope-only tab notifications recheck retained bytes with bounded,
coalesced reads. Shared-link/root contexts and URLs with authorization/scope
parameters never enter this reader. Cancellation retains private recovery bytes
while ordinary reads refuse them. MIME allowlists, checksums, quota and upload
permission checks are unchanged.

Local acceptance includes the real account picker, folder creation, Cut/Paste,
exact-byte download, native media at 1440/390/320px, shared-context refusal and
immediate deletion revocation. The real upload/deletion fixture also verifies
server-alias deduplication. Evidence is in `tmp/account-file-ui-browser/`,
`tmp/account-file-ui-lifecycle/` and `tmp/account-file-ui-*.log`.
Existing-account byte retention, managed file transfers and the wider account
post/editor/gallery/audio/video adapters remain unfinished. No main merge or
manual deployment is authorized by this checkpoint.


Verification for this checkpoint: **893 checks pass** (266 workspace/offline
shell, 319 Things, 308 attachment), plus the two enabled browser scenarios.
The generic workspace command skips 28 opt-in browser fixtures. Client and
Node/Nitro builds pass; the offline manifest verifies 248 assets / 21,617,351
bytes. Focused lint has no errors or warnings beyond the tooling deprecation.
Raw TypeScript retains 91 baseline diagnostics, with no changed-source errors.
These are local results; CI and deployed acceptance are separate.


## Existing saved-file deletion receipts — 2026-10-16

Existing account files do not retain the original client upload request ID.
`attachment-delete` 1.4.0 adds `retainReceipt:true` with the canonical file `id`
and freshly read `expectedUpdatedAt`, without `requestId` or `targetId`. It uses
the existing exact-version cleanup, private cancellation receipt and quota
settlement. Only a full user may delete their existing standalone stored file;
linked media, expiring imports, unfinished uploads and bound media are refused.

This mode never reserves a caller-chosen absent ID or interprets it as an upload
request ID. Missing/foreign IDs return 404. The deletion claim atomically checks
owner, standalone purpose, target absence and live version; cleanup retries
retain those scope restrictions. An existing receipt acknowledges a lost reply,
and delayed original uploads remain cancelled. A concurrent legacy cleanup that
leaves no receipt returns an unconfirmed error, never `deleted:true`.

Local verification: 312 attachment checks and 98 capability checks pass. The new
full-user browser-context integration fixture passes against the running app,
disposable MongoDB and loopback object storage; the existing offline file
lifecycle fixture also passes. The new fixture covers foreign owner/admin,
anonymous and cross-origin refusal, stale versions, concurrent annotation,
replay after discarding the first response and late-upload refusal. Unit coverage
also checks missing-ID, purpose/expiry, Watch and interrupted-claim boundaries.
Raw TypeScript retains 91 baseline diagnostics and none in changed source.
This is a server prerequisite for existing-file retention, not completed offline
retention or synchronization coverage. That adapter, managed transfers and the
remaining account/media acceptance matrix are still open.


## Retained account files — 2026-10-17

Opening an owned standalone stored file now retains its verified original bytes
and canonical display metadata in the active account/origin/data-plane workspace.
Attachment content 1.13.0 adds the same-origin, full-user `cache=retain&download=1`
descriptor. It refuses foreign/shared, linked, bound, expiring/import, unfinished
and blocked files; no signed URL, storage key or credentials enter device storage.
The existing content route still authorizes each online byte read.

The adapter checks the descriptor again after exact-length, version-bound bytes
arrive, then atomically commits bytes, metadata and the owned alias. It coalesces
repeated reads, permits at most three simultaneous retentions, uses the existing
20-second deadline and 16 MiB buffered-file limit, and rolls back on
quota, retirement or cancellation. An uploaded file that completes during the
read keeps its existing local identity. No original upload request ID is invented
for an existing account file, and retained files never enter the upload path.

The native Thing/media page can edit display filename, title and description
offline and download identical bytes. Clean remote details refresh; dirty local
edits remain pending and conflicting fields require the existing review.
Deletion uses the existing 1.4.0 receipt mode, including lost-response retries.
Failed retention leaves the online view usable with an explicit warning.
Shared/keyed contexts cannot use this path.

Local verification: **1,011 unit/offline-shell checks pass** (279 workspace,
314 attachment, 319 Things, 99 capability); the generic command skips 30 opt-in
browser scenarios. The enabled retention browser scenario passes both against
Vite and against the production client build. The latter disables networking,
cold reloads, edits, reloads again, downloads identical bytes and reconnects to
the original file without upload calls. Desktop 1440×1000 and phone 390×844 /
320×844 screenshots have no horizontal overflow. The development scenario also
discards a successful deletion reply and proves identical receipt retry.
Evidence: `tmp/retained-files-browser/`, `tmp/retained-files-cold-browser/` and
`tmp/retained-files-*.log`. Browser contexts and newly created files are cleaned up.

This covers explicitly opened standalone originals, not an offline copy of the
entire account. Parent-folder discovery, unvisited files, files above the local
limit, managed imports/exports, bound post/draft media, galleries, audio/video
and the remaining matrix still require acceptance. No main merge or manual
deployment was performed. CI and deployed verification remain separate.

Client and Node/Nitro builds pass; the offline manifest verifies 247 assets /
21,628,804 bytes. Both built capability manifests advertise content 1.13.0
and deletion 1.4.0, and anonymous retention/deletion remains refused. Focused
lint is clean aside from the existing tooling deprecation. Raw TypeScript has
91 baseline diagnostics and no changed-source errors. The existing native
Files-picker and private upload/deletion browser scenarios also pass.


## Account file transfer exports — 2026-10-17

Normal Download now collects new device files and retained owned account files
through the existing canonical transfer collector. It includes current local
annotations and exact validated bytes, resolves canonical account file aliases,
and rewrites media references to portable file IDs. Complete local folders and
cached ordinary definitions can include these files without waiting for upload
or metadata sync. Repeated exports after ordinary sync restore portable byte
bindings before recollecting; JSON that excludes bytes preserves original
account references. Standalone file downloads require ZIP with bytes.

Only live dedicated file records supply bytes. Old export snapshots cannot
resurrect cancelled/deleted files, damaged bytes fail without a partial plan,
and the in-process byte reader checks account retirement and cancellation.
An online fallback cannot silently omit affected pending file edits; unrelated
file uploads do not block that fallback. Existing folder-completeness checks,
scoped quotas, authentication and remote authorization remain in force.

Local evidence: 920 unit/offline-shell checks pass (287 workspace, 319 Things,
314 attachments). The generic workspace command skips 31 opt-in browser tests.
Two enabled production-client scenarios pass: (1) create an account folder/file
offline, cold reload, Download ZIP, import that actual ZIP through the normal
anonymous dialog, cold reload the imported native preview and download identical
bytes; (2) retain an existing owned file, edit/reload offline, reject standalone
JSON without bytes, export the edited ZIP, reconnect and sync metadata without
re-uploading. Download dialogs and native previews were checked at 1440/390/320
CSS pixels with no overflow or page errors. Offline mutations were zero.
Evidence: `tmp/account-file-export-browser/`, `tmp/account-retained-export-browser/`
and `tmp/account-file-export-*.log`. All test browser contexts close afterward;
existing-retention fixtures delete only their newly created server file.
Client build and focused lint pass. Raw TypeScript remains at 91 baseline errors
with none in changed sources. CI and deployed acceptance are separate.

Superseded for standalone account files by the import checkpoint below. Still open:
complete export caching of remote folders with files not already represented by
a complete device closure, linked galleries and managed account transfers,
bound post/draft media, and the rest of the full-suite matrix. This checkpoint
is not full offline account transfer acceptance and does not authorize merge.


## Account file transfer imports — 2026-10-17

The normal Import dialog now commits supported account ZIPs to the device in
one transaction: editable ordinary Things, standalone file metadata, validated
bytes and both durable queue intents. It does not wait for upload or draft saving.
The UI and facade share `accountImportSupported`; existing staged uploads keep
their normal remote importer. Anonymous imports remain device-only.

After verified reconnect, unrelated Things drain independently. Only Things
referencing a queued file wait for its real upload receipt. The shared canonical
media rewriter handles URLs, authored HTML, CSS, saved/instance arguments and
split templates without flattening editable content. Uncertain writes retain
their frozen body; newer edits follow separately. Removed file dependencies
surface a review error. File annotations and placement use their existing queue.
All uploads remain private and subject to ordinary approval and server policy.

Re-export now binds a shared byte entry to its included standalone file Thing
even when the collector visits an embedding Component first. This preserves the
normal importer contract regardless of generated UUID traversal order.

Local acceptance: the production client imports a folder, Component, page and
PNG while actually offline, cold reloads its native preview, then downloads and
validates a canonical ZIP with identical bytes. Reconnect uses the normal private
upload lifecycle and rewrites the Component to the real account file ID; guest
reads return 404. No offline mutation or bulk account import request occurs.
Import dialog/native preview pass 1440×1000, 390×844 and 320×844 layout checks.
Evidence is `tmp/account-file-import-browser/` and `tmp/account-file-import-*.log`.
The fixture closes all browser contexts and deletes its new account Things/files.
Seven focused regressions cover atomic queues, independent progress, immutable
retries, removal errors, invalid bytes/placement/cancellation/full-quota rollback,
unsupported dedicated kinds and editable template/media remapping. Existing
workspace, Things and attachment suites also pass; generic browser skips are
not browser acceptance. CI and deployed verification are separate.

The first browser run exposed a test origin mismatch: the local store emitted
absolute development-port URLs into a different production-preview origin. Use
root-relative stand-in URLs for multiple browser origins; keep normal CSP.
The rerun passes without changing CSP, upload authorization or rate limits.

Still unfinished: recordings, bound post/draft media, linked galleries and
managed account imports, complete remote-folder caches, wider media surfaces,
and the full-suite matrix above. These are acceptance work, not exemptions from
the requested end state. This checkpoint does not authorize a main merge.


## Local standalone recordings — 2026-10-17

The ordinary canonical ZIP importer now preserves standalone recording purpose
alongside files. Local original bytes, editable metadata and durable intents
commit together; playback and export do not wait for upload. Anonymous imports
remain in their device workspace. Verified account sync uses the existing private
recording upload lifecycle and real receipts. Bound post/draft media still needs
its parent writer and is not routed through a standalone upload.

Content 1.14.0 exposes immutable file/recording purpose on the owned retention
descriptor. It reuses the canonical attachment projection so saved title,
description and display filename survive retention; the previous minimal byte
projection omitted those fields and produced a false metadata baseline. The client requires it and rejects missing/foreign purposes instead
of silently converting recordings to files. Retention remains same-origin,
full-user and exact-owner, bounded to 16 MiB, with version-checked original bytes
and atomic device quota. Shared, linked, bound, expiring, managed and blocked
attachments cannot use this path. Deletion 1.5.0 extends both durable receipt
modes with exact-purpose, target/import/profile and version fences.

The native audio player waits for a usable source and clears stale source errors.
Device-local audio uses the workspace byte resolver and does not offer a second
legacy audio-cache copy. Shared/keyed playback cannot borrow that legacy cache.
The existing remote audio cache still needs broader identity-switch, revocation
and resource-bound acceptance; this checkpoint does not claim those complete.

Browser validation exposed a real edit/delete dependency: an unsynced local
rename was compared only with the old account name and incorrectly required
review. Deletion now recognizes either complete known metadata snapshot, while
unrelated account changes still require review and conditional server deletion
fences the current version. It does not need to upload an annotation first.
The native library Delete menu also uses the bulk API for a single item;
that path now routes files through their dedicated local queue and reports
partial mixed-batch failures. Regression cases cover both files and recordings,
with and without another account edit, repeated deletes and mixed selections. Existing exact-quota deletion tests retain their assertions.

Local validation: 1,034 unit/offline-shell checks pass (301 workspace/shell,
315 attachment, 319 Things and 99 capability checks); 33 opt-in browser tests
are skipped in the generic suite. Three enabled production-client browser
scenarios pass: the recording flow, existing file import and retained-file cold
offline playback/edit/export. Recording checks cover actual playback progress,
2-second duration, exact exported bytes, clean-context account retention, offline
rename/delete, an identical retry after a lost deletion response, and anonymous
offline reload/reconnect with zero remote writes. Layout checks cover 1440×1000,
390×844 and 320×844. Artifacts: `tmp/account-recording-browser/`, plus the two
`tmp/account-recording-file-*-regression/` directories. The native detail screen
still displays a remote-only secondary-read warning below the offline preview;
that broader reader acceptance remains open.

Client and Node/Nitro builds pass. Both built manifests advertise content 1.14.0
and deletion 1.5.0; anonymous retention/deletion stays refused. The client offline
manifest verifies 247 assets / 21,634,116 bytes. Focused lint has no errors and
one pre-existing useless-constructor warning. Raw TypeScript retains 91 baseline
diagnostics, with no errors in changed sources. These are local results;
current-head CI and deployed acceptance remain separate. The full
matrix remains open, including microphone capture, bound/linked/managed imports,
complete remote-folder discovery, protected-kind/account sync and real-device
checks. No main merge or manual deployment is authorized by this checkpoint.


## Anonymous imported file metadata — 2026-10-17

The native file detail editor now uses an explicit capability derived from the
active workspace's standalone attachment record. It no longer assumes that an
editable file has a `local-file-` ID: normal anonymous imports use `local-` IDs.
The derived flag is a read projection, absent from stored metadata and canonical
transfers. Current ownership, shared-link and bound/draft restrictions remain;
annotation still checks the current scoped record and lease at write time.

Local validation: 622 unit/offline-shell checks pass (298 workspace, 4 shell,
302 Things and 18 comment projection checks). The generic suite's 33 optional
browser skips are not acceptance evidence. The enabled production-client
`accountRecordingImport.browser.test.ts` passes: anonymous offline import,
native playback, editing all three annotation fields, cold reload, canonical
ZIP download with exact original bytes, and reconnect with zero remote writes.
It also reruns account import, upload, retention, offline annotation/deletion
and lost-deletion-response retry. Native screens were inspected at 1440×1000
and 320×844; measured overflow checks also cover 390×844. Artifacts are in
`tmp/anonymous-file-editor-browser/`, including the actual anonymous ZIP/JSON
exports and three screenshots. Client build passes; lint has zero errors and
one existing constructor warning. Raw TypeScript reports 91 existing diagnostics,
none in changed files. This is local evidence, not current-head CI or deployed
acceptance.

The account offline secondary-read warning remains open: `ThingComments` calls
Things GET/list with `commentProjection`/`target` options, which currently fall
through the account facade's remote guard. `AccountPostCache` currently accepts
post-shaped projections and has no complete discussion-page membership contract.
Implement and verify scoped offline discussion reads and writers together with
explicit partial coverage; hiding the warning or inventing an empty complete
conversation would not satisfy the local-first goal. The full acceptance matrix
above remains the merge gate.


## Account discussion reads and refusal cleanup — 2026-10-17

`AccountDiscussionCache` retains the canonical bounded discussion projection and
individual comment records in the existing account/origin/data-plane database.
It reuses the post display-field projection, preserves authors, and stores no
credentials, ownership grants or write intents. Home-plane, no-key discussion
requests use this adapter; hidden-link/shared-root and custom-plane requests
retain their normal remote boundaries. Owned unsynced Things use their actual
local record and sync state rather than issuing a premature server read.

The native reader reports that device conversations may be incomplete. Device
pagination is scoped to the account, target and filters; an absent retained
conversation fails explicitly. Cache retention failures also surface in the UI.
The file detail route no longer hides comments solely because the account is
offline. Schema-free owned Data previews no longer create an unnecessary shared
media runtime; foreign and unresolved-schema authority checks remain.

Real API verification found canonical comments with `thingtime: ['comment']`.
The post cache now accepts this exact discriminator without converting it to a
post. Generic Thing parents are excluded from the post-cache batch so they do
not invalidate retention of the actual comment. Parent relationships from the
canonical Thing envelope accompany retained comment projections.

`accountReadRevocation.ts` removes refused roots, known descendants and embedded
copies across both display caches in one transaction. Shared refusal watermarks
fence older root, page and individual-comment responses. Bodies are removed
before reserving watermarks; byte/record pressure can evict display snapshots,
never authored Things. Unit checks cover full byte and record quotas, account
and data-plane isolation, malformed/cross-target pages, cursor boundaries,
retired leases, newer-read preservation and cross-cache replay fencing.

Local validation: 709 unit/offline-shell checks pass (306 workspace, 4 shell,
320 Things and 79 feed). The generic workspace run skips 34 opt-in browser tests;
those skips are not acceptance. Three enabled production-client browser flows
pass: discussion/comment permalink cold offline reads followed by actual server
refusal and offline readback; recording import/play/edit/export/retention/delete
with offline comments and zero anonymous remote writes; and existing shared-post
Saved/reaction/identity regression. The discussion test proves the alternate
permalink and a native nested reply are available offline before proving refusal
removes the permalink. Undefined shared-access options retain the normal account
read path; defined shared-root and hidden-link requests remain remote-guarded. Screenshots
were inspected at 1440×1000 and 320×844, with measured overflow checks also at
390×844. Evidence: `tmp/account-discussion-browser/`,
`tmp/account-discussion-recording-browser/`, and
`tmp/account-discussion-post-regression/`. Client build passes; lint has zero
errors/warnings; raw TypeScript has 91 existing diagnostics, none in changed
files. CI/deployed verification of this checkpoint is not claimed.

This is read-side progress. Account comment/reply/post authoring, draft sync,
parent-thread recovery, complete discovery/page membership and broader media
retention remain open. Offline account discussion composers still require their
local writer/queue; their current login gate is not acceptance of the full goal.
The full matrix above remains the merge gate. No merge or manual deployment.


## Account post and reply authorship — 2026-10-17

The account facade now reuses `LocalThings.savePost` and `AccountThingSync` for
complete text/rich-text composer payloads. Content and durable intent commit in
one scoped transaction without a draft or network prerequisite. Stable submission
IDs survive acknowledged sync and retries. Replies use relational `targetId` and
inherit their target's audience; copied/imported plain post content also uses the
canonical local importer. Dependency ordering includes linked device Things.

Retained authorized discussions allow local reply storage, never a server write
grant. The account transport sends comment creates through the existing comment
endpoint, preserving its rate limit, ACL, inherited audience and receipt behavior.
The normal transport still pins actor, origin and data plane, retires changed
identity, negotiates capabilities and requires verified account binding. Unknown
fields, token grants, geo and bound media cannot enter this incomplete adapter
by being silently discarded. Bound post media still requires its dedicated local
binding/sync work; server refusals preserve local text with a visible queue error.

Native account comment/reply controls now use offline workspace content identity
for home-plane, unkeyed discussions. Device comment pagination merges authored rows with read
snapshots, remains bounded and explicitly incomplete. Known refusal removes
synced owned read-cache rows as well as discussion/post projections; unsynced
local authorship remains intact, and old reads cannot restore refused snapshots.
Author display retains captured identity or uses the honest offline workspace
label without a fabricated username/profile link.

Local evidence: 900 unit/offline-shell checks pass across workspace, Things,
feed, hooks, drafts and editor suites. Generic suites skip 35 browser tests and
one editor browser test; these skips are not acceptance. Three enabled production
client browser flows pass: native private rich-text post creation while offline,
cold reload and exact-ID canonical private sync; offline comment and nested reply
creation followed by one server copy each and refusal cleanup; and the existing
Saved/reaction/account-isolation regression. Screenshots at 1440×1000, 390×844 and
320×844 have no horizontal overflow; desktop/320px post renders were visually
inspected. Offline contexts issued zero mutation requests. Evidence lives in
`tmp/account-authoring-post-browser/`, `tmp/account-authoring-discussion-browser/`
and `tmp/account-authoring-post-regression/`. Client build passes. Lint has zero
errors and one existing constructor warning. Raw TypeScript retains 91 baseline
diagnostics with none in changed files. Current-head CI/deployment is unverified.

This advances account authorship, not the whole merge gate. Complete bound media,
linked-Thing UI coverage, native edit/privacy/delete/conflict flows, draft sync,
Timeline/protected kinds, Vault and the remaining matrix are still required.
No merge, manual deployment or existing-account mutation was performed.


## Account post file admission and binding — 2026-10-17

Normal post/comment file selection now saves bounded bytes in the active device
workspace, independently of upload approval and account draft saving. Unsubmitted
selections cannot start a remote upload. Post submission binds them atomically
with local content; verified-account sync then uploads each immutable file and
sends only receipt-confirmed IDs through the existing post/comment endpoints.
Discarding an unsubmitted selection uses the composer's real `attachments.remove`
method and cannot discard a bound or remotely started file.

The content queue preserves ordered file IDs across uncertain retries, validates
the actual post companion's binding receipt, and restores device media references
for offline rendering. Local ZIP export includes bound files and exact bytes.
Purpose mismatch, missing records and upload refusal preserve content and files;
account-only or mixed selections cannot be silently dropped. Refused/deleted
parents do not leave their file URLs readable. Anonymous storage never enters
these queues.

The normal PATCH attachment binding now runs in the same transaction as its
content/version write. `api.things-update` 1.11.0 advertises this contract on both
manifests. Stale versions, invalid content and failed bindings cannot partially
reorder or add attachments. Existing removal, authentication, same-origin,
moderation, quota and purpose checks remain authoritative.

Local validation: 1,054 checks pass across workspace/offline-shell (319),
attachments (316), Things (320) and capability (99) suites; 36 generic browser
cases are skipped and are not acceptance. The enabled production-client fixture
`accountBoundMedia.browser.test.ts` passes native offline post and rich-comment
submission, cold reload, decoded images, three exact-byte uploads/downloads,
private/inherited ACLs and anonymous read refusal. It verifies no offline mutations
or pre-submission uploads, one copy of the comment, and unchanged attachment order
on stale/invalid PATCH before a valid reorder. Viewports 1440×1000, 390×844 and
320×844 have no horizontal overflow; desktop/narrow post and narrow comment
screenshots were inspected. Evidence: `tmp/account-bound-media-browser/` and
`tmp/account-media-*.log`. Client build passes (247 offline assets); lint has zero
errors and three existing warnings. TypeScript retains 91 baseline diagnostics,
none in the changed files.

This is local verification, not current-head CI or deployed acceptance. Remaining
work includes bound-media removal/deletion, conflict reconciliation of account
media, existing bound-file retention and import, linked media and the rest of the
matrix. No main merge, manual deployment or existing-account mutation occurred.


## Account post and comment file removal — 2026-10-17

The normal editor can now remove device-authored post/comment files offline.
The local change commits independently of draft saving and hides the file on
reload. Repeated removal returns the retained result. Files that never started
uploading are cancelled locally; uncertain uploads resume the same request from
recovery bytes before deletion. A pending immutable parent write settles before
its file is deleted, while new content writes wait for that deletion to finish.

`api.attachment-delete` 1.6.0 adds target-scoped durable deletion using the original
upload request ID and observed file version. The existing cleanup claim fences
owner, target, purpose, version and stored-file eligibility. A private cancellation
receipt prevents a delayed upload from recreating deleted bytes. Lost replies
retry the same request; local recovery bytes are released only after durable
acknowledgement. Concurrent account metadata changes require review, and keeping
the file restores its local binding and exact bytes even at the device quota.
Authentication, same-origin, data-plane and rate-limit checks remain unchanged.

Local validation: 1,054 unit/offline-shell checks pass across workspace (323),
attachments (318), Things (320) and capability (93) suites. The 36 generic browser
skips do not count as acceptance. The enabled production-client browser fixture
creates private post/comment images offline, syncs exact bytes, removes one file
from each native editor offline and reloads successfully. Reconnection includes
a real deletion whose response is deliberately lost; the identical retry finishes,
removed bytes return 404, remaining post/comment text survives and replaying the
old upload request returns `upload_cancelled`. Offline mutation requests and
browser errors are both zero. Desktop/390/320px checks pass without horizontal
overflow; narrow removal screenshots are visually inspected. Evidence:
`tmp/account-bound-delete-browser/` and `tmp/account-bound-delete-*.log`.
The client build passes with 247 verified offline assets; focused lint is clean.
Raw TypeScript retains 91 baseline diagnostics, with none in changed files.

This covers removal of files authored in this device workspace. Existing remote
bound-file retention/import, binding reconciliation, parent deletion and the
remaining local-first matrix are still completion gates. Results are local;
current-head CI/deployed acceptance is separate. No merge, manual deployment,
public publishing or existing-account mutation was performed.


## Existing account post and comment originals — 2026-10-17

Opening an owned post/comment now retains its complete stored-file binding through
its verified account transport. The existing content endpoint (1.15.0) supplies
purpose, target, metadata and an immutable original-byte key; parent authorization
and binding are rechecked after all bytes arrive. One bounded batch admits parent,
metadata and exact bytes atomically. Partial downloads, quota failures, changed
bindings, concurrent local edits and known read refusals cannot admit partial or
stale editable content. Repeated unchanged reads do not advance content revisions.
Linked URLs, other owners, shared-root reads and managed/profile/import files stay
outside this path. Anonymous workspaces never use it.

The existing deletion endpoint (1.7.0) accepts an observed owned bound-file ID,
matching target and version with `retainReceipt:true`. It preserves the same
cleanup claims and durable cancellation receipts without fabricating an upload
request ID. The normal editor removes those files offline and releases recovery
bytes only after acknowledgement. Comment updates omit the inherited audience
snapshot from PATCH: the server continues to enforce the parent's audience.
Different audience requests are not silently discarded.

Local verification: workspace/offline-shell 327, attachment 320, Things 320 and
capability 99 checks pass (1,066 total); the 37 generic browser skips are not
acceptance. The separately enabled `accountBoundRetention.browser.test.ts` passes
against the production client with a newly registered disposable fixture account
and a second clean browser context. It decodes exact original PNG bytes, edits and
removes files offline through the native post/comment editors, cold reloads, and
checks desktop/390/320px rendering without horizontal overflow. Reconnect updates
the original private records, sends two existing-ID deletion receipts, never
uploads duplicates, and leaves deleted originals unavailable. Anonymous reads are
refused, with no offline mutation requests or browser errors. Narrow screenshots
were visually inspected. Evidence: `tmp/account-bound-retention-browser/` and
`tmp/account-bound-retention-*.log`. Focused lint and the client build pass;
TypeScript reports 91 existing baseline diagnostics, none in changed files.

This is local evidence. It does not establish complete normal offline Download
coverage for newly retained bound media: that still requires a complete export
snapshot and the remaining importer/reconciliation work. Parent context on the
comment permalink, parent deletion, linked/managed media, cross-device conflicts,
draft sync and the rest of the matrix remain open. No merge, manual deployment,
public publishing or existing-account mutation was performed.


## Offline conversation context — 2026-10-17

Anonymous and account comment permalinks now resolve parent and root navigation
from the same scoped device records used by their normal content read. Missing
or cyclic local ancestors cannot invent a root. Retained account responses keep
explicit authorized root references when intervening comments have not been
visited; a later direct discussion read does not erase that context. Generic
Thing parents remain display snapshots and never become owned post records.
Locally authored edits outrank stale snapshots, while other authors retain their
actual author projection.

The account context resolves in one read transaction. Known read refusals and
pending deletions suppress ancestor/descendant links, including a stored root
shortcut through unvisited intermediate comments. Refusal cleanup includes those
root references and still preserves unsynced authored content for recovery.
Background refresh announces a context change even when the comment body is
unchanged. Ordinary post reads do not scan comment ancestry. No remote fetch,
anonymous sync or new account authority is introduced by navigation.

Local verification: 332 workspace/offline-shell checks and 79 feed checks pass;
37 generic browser cases remain opt-in skips. Three enabled production-client
browser fixtures pass: anonymous component discussion with nested replies and
native parent/root navigation after cold offline reload; an account comment
returning to a generic Thing; and fresh-device private post/comment media edits
with offline parent navigation and successful reconnect. Desktop, 390px and
320px checks have no horizontal overflow; narrow thread screenshots were
visually inspected. Evidence: `tmp/thread-context-{anonymous,discussions,bound}/`
and `tmp/thread-context-*.log`. The client build verifies 247 offline assets;
focused lint passes and raw TypeScript remains at 91 baseline diagnostics, none
in changed files.

This closes the missing offline conversation links, not the entire deletion or
media transfer matrix. Bound import/export, parent deletion/reconciliation,
linked/managed media, draft sync and the other full-suite gates remain required.
This checkpoint is local evidence; CI and deployed acceptance are separate.

Deep-thread follow-up: the account browser regression also visits a depth-eight
comment permalink after cold offline reload, with intervening comments unvisited,
and follows its authorized generic-Thing root. Local traversal covers 70 levels
without a depth cap; cycle detection remains the terminator.


## Account post/comment ZIP imports — 2026-10-17

The normal Import dialog now accepts canonical post/comment file bindings in an
account workspace without waiting for a network connection or draft save. The
existing importer validates the full transfer, hashes every byte, remaps independent
content/file identities, and atomically commits content, bytes and both queue
intents. It preserves the transfer's attachment order and comment target.

Uploads use the existing post/comment purposes and approval gates. Content writes
wait for confirmed file receipts, preserve private roots/inherited replies, and use
canonical account IDs. Unrelated content can sync independently. No permission,
server ownership, upload receipt or moderation state is inferred from a ZIP.

`accountBoundImport.test.ts` checks ordered post/reply bindings, independent queue
progress, anonymous/account round trips, exact bytes, and atomic rejection of
missing targets, corrupt bytes, excess comment attachments and managed kinds.
The extended `accountFileImport.browser.test.ts` exercises the existing normal
Import and Download dialogs, cold offline native Component/reply rendering,
private reconnect, canonical byte readback and anonymous access refusal. It uses
the existing README loopback fixture setup; approval is granted only to the new
disposable test account.

This closes the bound post/comment import admission gap. It does not establish
complete exports for previously remote bound content, linked/managed transfers,
parent deletion/binding reconciliation, or the full matrix above.

Local verification: 335 workspace/offline-shell checks and 320 Things checks
pass; 37 opt-in browser skips are excluded. The separately enabled production-client
import fixture passes with four real uploads, private/inherited bindings, exact
original-byte readback, zero offline mutations and no browser errors. Native
Component/reply and dialog bounds pass at 1440×1000, 390×844 and 320×844.
Client build verifies 247 offline assets. Targeted lint has no errors and one
existing constructor warning; raw TypeScript has 91 baseline diagnostics and none
in changed files. Evidence is in `tmp/bound-import-*`, with the successful browser
run in `tmp/bound-import-browser-complete/`. CI and deployed acceptance are separate.


## Retained post export and shared Download menus — 2026-10-17

Opening an owned post/comment online already retains its complete file binding
and parent body atomically. The existing sync record now carries that completeness
proof, allowing normal offline Download without first calling the remote exporter.
Confirmed device-authored binding writes also establish the proof. It survives
pending local edits and reviewed keep-device conflict choices; keeping a different
account version requires its own complete retention. Incomplete legacy caches and
folder listings do not acquire this proof automatically.

The canonical collector includes retained originals in order, current device text,
and intentional file removals. Missing file records fail explicitly; unknown
parents retain the existing complete authorized remote path. No foreign parent
becomes an owned editable Thing. JSON/ZIP output excludes the internal proof,
account IDs used as authority, and all ownership/permission envelopes.

`PersistedThingMenu` now exposes the canonical Download action through the same
`ThingExportDialog` used by the library. Shared-link context and workspace/Thing
identity fences remain intact. The enabled `accountBoundRetention.browser.test.ts`
checks fresh-device retention, offline export, normal anonymous import with fresh
IDs, exact-byte re-export, pending edits/removals and private reconnect. It also
checks keyboard opening, touch selection and desktop/390/320px menu/dialog bounds.
Artifacts are under `tmp/retained-export-browser-final/` in the local task checkout.
This is local verification; broader managed/linked transfer, file-revocation and
local-first matrix requirements remain open.


## Retained file access and remote export lifetimes — 2026-10-17

Fresh Downloads of retained account originals now consult the same scoped
refusal watermarks as ordinary account content, even without an earlier export
snapshot. Canonical owned-file descriptor 403/404/410 responses invalidate access;
401, network failures and failed byte transfers do not. Unsynced metadata and
recovery bytes stay stored, while normal reads, media previews and exports refuse
unavailable retained content. Device-authored originals retain their independent
local ownership. Fresh validated descriptors can reauthorize unchanged scoped
bytes; the final transaction rejects a response started before a newer refusal.

Dedicated and bearer-link remote export plans now carry the existing in-process
identity, abort, deletion and read-refusal checks through bundle preparation and
final encoding. The bearer context remains uncached, and ordinary account edits
cannot silently be replaced by a dedicated remote plan. No credentials, callback
or authorization metadata enter portable JSON.

Local validation: 352 workspace tests plus 4 offline-shell tests pass (38 default
browser skips excluded). The enabled production-client file-retention fixture
passes cold offline edits, exact-byte Download/ZIP, conditional reconciliation,
and a real server deletion/404 followed by preview withdrawal and a visible
failed offline Download with no second file. It checks 1440/390/320px rendering,
zero offline mutations and zero replacement uploads. Evidence is in
`tmp/file-refusal-browser/` and `tmp/file-refusal-*.log`. Build verifies 247 offline
assets; focused lint is clean. TypeScript still reports 91 baseline diagnostics,
none in changed files. Remote plan lifetime races are service-tested; native
in-flight shared-key/account switching remains a separate acceptance gate.

The full coverage matrix remains open, including shared/managed/linked transfer,
parent binding reconciliation, draft and catalogue sync, encrypted local Vault,
native/integration coverage and broader identity/offline startup recovery. This
checkpoint is local evidence only and does not make the draft PR ready to merge.


## Account local draft queue foundation — 2026-10-17

The shared local draft implementation now offers transactional hooks for account
queue admission and file copies. The new `AccountDraftSync` service separates
local editor revisions from canonical server revisions, coalesces unsent saves,
freezes uncertain writes, respects retry delays, serializes cross-tab claims and
preserves newer edits while an older save completes. Local retirement does not
await remote cleanup; an already-started uncertain save is reconciled before its
delete. Explicit conflict review checks both local and remote revisions.

Account media hooks preserve independent template/working-copy bytes and upload
identities, wait for confirmed receipts before constructing canonical draft file
references, and retain existing private originals with their complete draft in
one transaction. Draft files stay hidden from the ordinary library. A canonical
read refusal arriving after preparation prevents a new copy; the original parent
access boundary survives local file release. Recovery bytes remain intact.

This is an **inactive service foundation**, not native account-draft completion:
`draftClient.ts`, the account worker and draft status UI are not routed through
it yet. Verified home-draft/data-plane transport, template-save capability,
bounded discovery/refresh, identity-scoped client callbacks, conflict UI, released
upload cleanup and submission/draft-media donation races remain required before
activation. Account posting continues independently of draft saves.

Local service validation: 367 workspace plus 4 offline-shell tests pass (38
opt-in browser skips excluded), and 33 existing draft tests pass. Focused lint
has no errors and the existing LocalDrafts constructor warning. Client build
verifies 247 assets. The new queue/media tests use controlled transports and are
not evidence of real account API synchronization. CI, preview and full native
account-draft acceptance remain separate gates; PR #1000 remains draft.

The enabled fresh-device post/comment retention browser regression also passes
against the rebuilt production client, including offline native export, anonymous
round-trip import, pending edits/removals, private reconnect and 1440/390/320px
bounds. Evidence: `tmp/account-draft-bound-browser/`. Raw TypeScript reports 91
baseline diagnostics, none in the changed files. This regression protects shared
file behavior; it does not exercise the unwired account draft queue in an editor.

The cold standalone-file browser regression also passes against this build,
including real canonical deletion/refusal and no output from the subsequent
offline Download (`tmp/account-draft-file-browser/`). Both enabled browser checks
use fresh disposable loopback accounts, never existing account data.

## Native account draft integration checkpoint — 2026-10-17

The account draft client, verified transport, independent worker pass, bounded
summary catalogue, picker and sync review panel now use the scoped local store.
This supersedes the earlier inactive-foundation description. The real loopback
API accepts template creation under `api.drafts` 1.1.0, preserves exact retries
and rejects replacing an existing template. Home-pinned private storage and
expected account/data-plane preconditions remain unchanged.

Enabled clean-browser evidence on the production client: native text drafts
survive cold offline reload; private sync resumes; posting completes with the
draft endpoint returning 503; cleanup later removes the completed draft and
preserves the template. Picker screenshots cover 1440x1000, 390x844 and 320x844.
`tmp/account-draft-native-browser/` contains the evidence. Native post/reply media
also retain exact bytes across offline reload, reconnect with private bindings,
and pass removal/lost-receipt replay (`tmp/account-draft-native-media-final/`).
The media harness now waits for composer closure after commit; its old button-label
check could reload during submission and mistake editor text for a posted reply.

A stale-summary deletion race is fenced against the revision of the body actually
retained. Reviewed account replacement checks both revisions and increments the
local revision so an older editor cannot overwrite it. Account-only/shared post
copies retain the canonical authorized template copy operation; complete local
posts and cached templates can be copied without network access.

Still open before this integration is complete: explicit recovery of earlier
unscoped/scoped device keys, released upload intent cleanup, concurrent
submission/draft-media binding, full native conflict/template/media acceptance,
and account/origin/plane changes during each native operation. Older recovery
keys are retained, but that alone does not prove a working recovery UI. The wider
matrix (including shared/managed/linked transfers, protected Timeline/Actions,
Vault, themes/algorithms, integrations/recording, notifications and startup/update)
is unchanged. These are local checks; current-head CI and deployed acceptance
remain separate. No merge or manual deployment is authorized before the full gate.

The draft queue has its own `syncPump` scheduler. A held draft request cannot
hold the content worker's next pass; upload completion wakes drafts when their
originals become ready. The native draft test holds the draft POST unresolved
and requires the private post to reach the real account within eight seconds,
before releasing that draft request. This tests normal completion independently
of the draft transport timeout, in addition to rejection/retirement handling.


## Legacy native editor tree isolation — 2026-10-17

`WorkspaceThingtimeProvider` binds the native tree and its tab channel to the
captured account, API origin, data plane and identity generation. `LocalEditorTree`
uses the existing workspace database: its canonical storage bytes and integrity
metadata commit atomically, count toward device quota, and abort on identity
retirement. The former 16 MiB buffered-tree limit was removed on 2026-10-23;
admission depends on actual browser storage capacity. Current regression checks
retain 17 MiB ASCII and 20 MiB UTF-8 trees, Dates/cycles, cold reopen and large
legacy adoption. Native editor acceptance beyond that former limit remains open.
Invalid or damaged storage stays intact with a visible error; it never hydrates
as a successful empty tree. This is internal editor storage, not transfer JSON.

The earlier anonymous device key migrates only into the anonymous partition,
without deleting the original. Account keys lacking data-plane provenance never
hydrate automatically. The generic editor offers a read-only review followed by
an explicit copy under a new name. It rejects changed previews and existing names,
keeps current settings/content and the original bytes, and completes its device
write independently of draft limits or network saving. It does not add an account
Thing endpoint or enable anonymous remote sync.

Local evidence: `editorTree.test.ts` covers scope separation, canonical Dates and
cycles, migration races, corruption, quota rollback/retry and mid-transaction
identity invalidation. `editorTree.browser.test.ts` uses clean browser contexts
and real disposable loopback registration, with offline native editing/recovery,
source preservation, changed-review/name-conflict rejection and a 600 KiB copy
that exceeds the separate draft snapshot limit. Desktop/390/320px checks include
screenshots and copy-button hit testing. Run with `TT_LOCAL_EDITOR_TREE_URL`,
`TT_SHARED_PLAYWRIGHT_PATH`, optional `TT_SHARED_CHROME_PATH` and
`TT_LOCAL_EDITOR_TREE_ARTIFACTS`; use a production client for cold offline reload.
Existing generic draft recovery and held-draft independent posting regressions
also pass. Evidence is local, not current-head CI or deployed acceptance.

Still required: native account/origin/data-plane transitions during tree reads,
copies and tab broadcasts; earlier comment/draft-key recovery; whole-tree remote
sync semantics; and the previously listed full-suite acceptance matrix. The
native tree rebuilds its root wrapper during hydration: arbitrary self-references
to that old root are not aliases of the newly constructed wrapper. Nested cyclic
values are preserved; broader root-reference semantics remain an explicit audit
item. No merge or manual deployment is performed by this checkpoint.


## Plain comment draft recovery — 2026-10-17

Plain comments and replies use the existing `useWorkspaceDraft` adapter, including
its account/origin/data-plane context hash. UI state, pending submissions and
recovery reads retain their captured identity and target. Keystrokes received
while the context is prepared are captured once it is available; a late restore
cannot replace those edits. The shared hook can explicitly disable account draft
work when the current surface has no eligible workspace actor.

Earlier plain localforage text, raw account recovery, former workspace-store and
older hashed-context recovery keys are discoverable through a reviewed device
copy. Nothing is automatically assigned to the current database or deleted on
submission. Review checks bounded plain-text snapshots, surface/context and all
pending draft variants; media or pending-submission fields are refused for the
original editor to handle. Copy re-reads the exact source, checks the captured
workspace and appends to the latest current text. It adopts no old draft ID or
write operation. Invalid, changed and oversized sources stay intact with errors.
Remote-only older account drafts and rich/media recovery remain separate work.

The native fields are compact multiline textareas: Shift+Enter preserves line
breaks, Enter sends, and IME confirmation does not send. A browser regression
exposed that the previous single-line inputs stripped recovered line breaks.
Comments/discussion checks now await actual input clearing after local completion;
optimistic text appearing alone is not proof that submission completed.

Local production-client evidence: `tmp/plain-comment-native-final/` covers review,
changed-source refusal, current-text preservation, cold offline reload, deliberate
IndexedDB draft-write failure with independent comment completion, source retention
after posting, invalid-source preservation and exactly-once account reconnect via
the normal Reconnect control. Screenshots and hit tests cover 1440/390/320px for
both recovery and the multiline composer. The anonymous discussion/nested-reply,
rename, search and thread-navigation regression also passes with zero remote writes
(`tmp/plain-comment-anonymous-final/`). These checks use disposable loopback
accounts and browser storage only, not existing account data.

Run `plainCommentDraft.test.ts`, `test:drafts`, `test:local-workspace` and
`test:feed`. Enable `plainCommentDraft.browser.test.ts` with
`TT_LOCAL_PLAIN_COMMENT_URL`, `TT_SHARED_PLAYWRIGHT_PATH`, optional
`TT_SHARED_CHROME_PATH` and `TT_LOCAL_PLAIN_COMMENT_ARTIFACTS`. Use the production
client for cold offline reload; test registration must use a disposable local API.
Native live account/origin/data-plane transitions, broader legacy rich-draft/media
reconciliation and the existing full-suite matrix remain open. No merge or manual
deployment is performed by this checkpoint.


## Native cross-tab draft isolation — 2026-10-17

`drafts/workspaceSwitch.browser.test.ts` now exercises the normal account switcher
in a second tab while native editor-tree and plain-comment recovery are mounted.
It delays delivery of real IndexedDB results during both review and copy, switches
to a second disposable account, then releases those results. Neither old modal
nor recovered content enters the new account. Switching back restores the original
current edits and leaves both recovery sources available.

The same browser test holds a real successful private-comment response after the
server has committed it. Local submission completes before that response arrives.
After a native account switch, the second account cannot read the private parent
and does not display the comment. Returning to the original account reconciles
its exact local sync record to `synced` with no pending operation, and a fresh
server list contains exactly one comment with the original author. Completed text
does not reappear in the composer. No application identity, authentication or
permission checks are stubbed; only delivery timing is controlled.

Enable with `TT_LOCAL_DRAFT_SWITCH_URL` pointing to a loopback production-client
server, `TT_SHARED_PLAYWRIGHT_PATH`, optional `TT_SHARED_CHROME_PATH`, and optional
`TT_LOCAL_DRAFT_SWITCH_ARTIFACTS`. The fixture registers two disposable accounts,
creates one private parent through the normal API, and cleans up that parent and
its sessions. Local evidence: `tmp/workspace-switch-native-settled/verification.json`.
The enabled browser fixture passes; root-data (39) and draft (46) checks pass with
three default opt-in skips excluded. Focused lint is clean. TypeScript reports
91 existing diagnostics, none in this test. Application assets are unchanged from
the preceding validated client build; this checkpoint adds regression coverage.

This proves live cross-tab account switching for these recovery and plain-comment
paths. Origin/data-plane transitions, rich/media drafts, remote-only legacy
recovery and the remaining full-suite matrix still require acceptance. CI and
current-head deployment are not established by this local fixture.


## Account-only older plain drafts — 2026-10-17

Plain comment/reply recovery now discovers older account drafts using their exact
unscoped `comment:plain:<target>` context after an explicit “Find earlier account
drafts” action. Discovery reads at most 30 summaries per page and exposes the
existing continuation cursor. It does not automatically restore content or assign
an older home-plane draft to the selected database.

`AccountDraftClient.reviewList` and `reviewRead` reuse the bound account transport
and canonical summary/body validators. These fresh, read-only requests bypass
retained bodies and never admit source IDs, media, catalogue records or sync
operations into the current workspace. The transport preserves authentication,
expected actor/data-plane checks, same-origin policy, response limits, rate limits
and cancellation; the review adds a 20-second signal and captured editor guards.
Anonymous workspaces never construct this account review facade. Offline account
review gives an explicit reconnect error without issuing a request.

The shared recovery dialog previews the original text. Copy re-reads the source
and rejects any changed revision/content, invalid editor/context, media, rich or
pending-submission snapshot. It appends only bounded plain text to the latest
current editor, whose existing scoped draft session owns the independent copy.
Original working drafts and templates keep their IDs, mode, contents and revision;
no instantiate/recover/delete operation is sent for them. Copied text remains
editable through a cold offline reload, and content completion still does not
wait on draft saving.

Local acceptance uses `remotePlainComment.browser.test.ts` with a real private
parent and account-only draft/template in a clean browser. It verifies no automatic
adoption, zero review/source writes, no retained source IDs, fresh changed-source
refusal, current text and template preservation, offline copy reload, explicit
offline review refusal, and screenshot/bounds/button-hit checks at 1440/390/320px.
Enable it with loopback `TT_LOCAL_REMOTE_PLAIN_URL`, `TT_SHARED_PLAYWRIGHT_PATH`,
optional `TT_SHARED_CHROME_PATH` and `TT_LOCAL_REMOTE_PLAIN_ARTIFACTS`.

The native account-switch fixture now also delays real account review/copy
responses across a switch and proves no cross-account adoption. Device recovery,
failed-draft independent posting and anonymous offline discussion regressions pass;
the latter records zero account-draft requests as well as zero remote writes.
Evidence: `tmp/remote-plain-native-final/verification.json`,
`tmp/remote-plain-switch-final/verification.json`,
`tmp/remote-plain-device/verification.json`, and
`tmp/remote-plain-anonymous/browser-verification.json`.

Validation: 431 workspace/draft plus 79 feed checks pass (45 default opt-in skips
excluded); all four relevant browser fixtures were separately enabled. The client
build verifies 247 offline assets (21,710,050 bytes). Focused lint is clean;
TypeScript retains 91 baseline diagnostics, none in changed files. This closes
remote-only recovery for old raw-context plain drafts. Rich/media reconciliation,
origin/data-plane transitions, the remaining local-first matrix, current-head CI
and deployed acceptance remain open. No merge or manual deployment is included.


## Rich composer workspace scope — 2026-10-17

Rich post/edit/comment drafts now use the same account/origin/data-plane context
as other workspace editors. Automatic resume and working-draft selection require
that exact context; changing workspace generation remounts the composer. Older
unscoped working drafts and pending submissions remain untouched and are not
assigned to a new database. Explicit legacy rich/media review remains a merge gate.

Template selection still works across editor contexts: the existing local
instantiate transaction copies validated content and independent bytes into the
chosen context, preserves the original, and keeps a stable copy ID for retries.
Concurrent reuse of that ID for another context fails. A template containing an
unfinished submission cannot be rebound and replayed as a new draft. Account sync
uses the ordinary canonical save queue; no endpoint or account permission changes.

The shared context helper now calculates the identical SHA-256 identity on first
render using pinned `@noble/hashes` (only the SHA-256 submodule). This removes the
asynchronous preparation window before recovery and typing. The asynchronous
helper remains compatible; tests compare both forms with Node's SHA-256. Install
with the normal locked pnpm workflow; there is no private configuration.

Run `test:drafts`, `test:local-workspace`, `test:feed`, and enable
`app/drafts/richWorkspace.browser.test.ts` with `TT_LOCAL_RICH_DRAFT_URL` pointing
to the loopback production-client server and `TT_LOCAL_RICH_DRAFT_ARTIFACTS` pointing
to an ignored output directory. Use the shared Playwright/Chrome environment setup
above. The fixture uses disposable API-created account drafts and clean browser
stores; it checks formatted scoped resume, foreign/legacy working-draft exclusion,
canonical template-copy context and source preservation, exact pending-operation
recovery without replay, cold offline reload, editing when WebCrypto digest stalls,
and anonymous offline draft/post completion without account draft requests.
Screenshots/bounds cover 1440/390/320px. Also run accountDraftSync and remotePlainComment
browser fixtures to verify independent posting and the shared recovery hook.

Current local evidence: `tmp/rich-scope-native-verified/verification.json`,
`tmp/rich-scope-native-verified/anonymous-verification.json`,
`tmp/rich-scope-account-regression/verification.json`, and
`tmp/rich-scope-plain-regression/verification.json`. Unit checks: 433 workspace/draft
and 79 feed checks pass; 47 default opt-in skips are not acceptance. The build
verifies 247 offline assets (21,716,177 bytes). Raw TypeScript has 91 baseline
diagnostics and no changed-file diagnostics; focused lint has one existing
`no-useless-constructor` warning in LocalDrafts. These are local results. Native
origin/data-plane transitions, rich/media legacy reconciliation and the complete
local-first acceptance matrix remain open; no main merge or manual deployment.


## Offline post templates and bound-parent deletion — 2026-10-17

The normal Post menu offers Save as template for an owned offline account post,
as it already does for anonymous device posts. It calls the canonical draft
adapter with a captured workspace lease. Duplicate clicks share one operation;
an uncertain retry keeps the copy ID. Account/origin/data-plane generation changes
and unmounts retire callbacks and suppress late notifications. Visible account
post copying online retains the existing authorized server path.

Deleting a post/comment now passes its bound files through the existing file
cleanup service in the same local transaction. Unsent bytes are cancelled locally;
started uploads and uncertain parent writes keep their durable replay identities.
The original checkpoint made account parent deletion wait for file cleanup.
The later parent-deletion conflict checkpoint below supersedes that ordering. A protected child rolls back the entire cascade. Restoring a
file during deletion requires review before the parent can be deleted remotely.
No account route, authentication, upload admission or same-origin rule changed.

`offlinePostTemplate.browser.test.ts` proves both clean-browser paths against the
production client: cold offline post creation, native template save, source
removal, independent scoped working copy, exact image bytes and reload. The account
case then verifies private post/template sync, guest refusal, offline deletion of
the synced post and preservation of template bytes. Anonymous execution makes no
account-draft request. Both record zero offline writes and 1440/390/320px bounds
and screenshots. Evidence: `tmp/offline-template-verified/account/verification.json`
and `tmp/offline-template-verified/anonymous/verification.json`.

Enable with loopback `TT_LOCAL_POST_TEMPLATE_URL`, optional
`TT_LOCAL_POST_TEMPLATE_ARTIFACTS`, shared Playwright/Chrome paths, and the existing
`TT_LOCAL_FILE_SYNC_ADMIN_FIXTURE` for the account case. Only the disposable account
created by the test receives upload approval; ordinary accounts are not modified.
See README for the isolated fixture setup. Unit coverage includes duplicate and
late callbacks, unsent nested deletion, protected-child rollback, and uncertain
parent/file deletion ordering. Workspace/offline-shell (392), drafts (50), and
feed (79) suites pass: 521 checks, with 49 default opt-in skips excluded; both new
native cases were enabled separately. The client build verifies 247 assets
(21,718,135 bytes). Focused lint is clean; raw TypeScript retains 91 baseline
diagnostics and none in changed files. These are local results. Full legacy
rich/media recovery, broader identity-transition and lifecycle acceptance, the
remaining matrix, current-head CI and deployed verification are still open.


## Native anonymous/offline History menu — 2026-10-17

`PersistedThingMenu` now uses scoped workspace ownership for History, as it already
does for Rename. An anonymous owned Thing and a retained offline account Thing can
open the existing History modal. Remote handoff still requires a real account;
private account History retains its existing authorization and cache boundaries.
The shared menu identity includes the workspace generation, and the History modal
captures that identity when opened. Pending identity or account/origin/data-plane
changes close the old view; returning to an account does not revive its old modal.

The anonymous detail fixture previously asserted History was hidden. It now proves
that a cold offline rename retains the original recorded Component data, opened
through the normal menu with no account-draft or mutation request. The new
`historyMenu.browser.test.ts` loads an authorized account version, disconnects and
cold-reloads, then opens its cached canonical data through the same menu. It reads
the version at 1440/390/320px, switches accounts through Settings in another tab,
verifies the old History closes and private access is refused, then returns to the
owner and explicitly reopens History. All browser contexts are disposable.

Local evidence: `tmp/local-history-menu-anonymous/browser-verification.json` and
`tmp/local-history-menu-account-verified-final/verification.json`. Workspace and
offline-shell (392), Things (322), Timeline (238), and navigation (17) checks pass:
969 total, excluding 42 opt-in skips. The two native cases were separately enabled.
Build: 247 verified assets, 21,718,258 bytes. Focused lint is clean. Raw TypeScript
retains 91 baseline diagnostics with no changed-file diagnostics. Native screenshot
inspection and recorded version interaction cover desktop and both phone widths.

This removes a menu gate; it does not complete account Timeline capture/sync.
Current `LocalThings.transaction` records authoritative device Timeline changes
only for the anonymous scope. Offline account History here is the existing
previously authorized version cache. Account-local mutation capture, durable
reconciliation, protected Action receipts and broader origin/data-plane transitions
remain explicit full-rollout gates. No parallel history format, anonymous-to-account
migration, endpoint, authentication or service permission was introduced.


## Parent deletion conflicts preserve media — 2026-10-17

A real disposable-account browser regression exposed an ordering defect: a queued
parent deletion removed its image before the parent version check rejected a newer
remote edit. `AccountFileSync` now holds bound-file cleanup while the parent is
pending, refused or conflicting. `AccountThingSync` replays uncertain content writes,
waits for active file claims, then uses the canonical version-checked parent DELETE.
Keeping the reviewed account version atomically restores its retained local files.
Files whose account binding changed remain recoverable and require review.

DELETE `/api/v1/things` adds optional `retainAttachmentReceipts:true` with
`expectedUpdatedAt`, negotiated as `api.things` 1.34.0. Only a same-origin full-user
owner can request it. The existing attachment cascade and accounted cancellation
receipts preserve post/comment upload identities after byte cleanup. This allows
fresh retained-file clients to reconcile without inventing request IDs or treating
404 as a durable receipt. Linked files and legacy callers keep their existing
cleanup contract. No new storage collection, credential borrowing or publishing
path is introduced. Both manifests derive the version from the canonical registry.

Local acceptance: three enabled native production-client cases cover anonymous
and account independent templates, normal deletion, and a remote edit before
reconnect. The conflict keeps the newer text and original image, then native
Compare versions → Keep account version restores both through a cold offline
reload. Normal deletion confirms an existing-file receipt without the upload
request ID. Invalid receipt options return 400; a foreign Origin returns 403;
private media remains readable only by its owner. All cases use disposable
accounts, record zero offline writes, and check 1440/390/320px. Evidence:
`tmp/parent-conflict-native-final/`; the failing pre-fix case is
`tmp/parent-delete-race/account/concurrent-parent.json` (parent 200, image 404).

Workspace/offline-shell, attachment, capability, draft and Things checks are rerun
for this checkpoint; prior History and Timeline evidence remains above. Client
build: 247 verified offline assets, 21,719,451 bytes. Focused lint is clean; raw
TypeScript retains 91 baseline diagnostics, none in changed files. This closes
the reproduced client ordering failure, not the full rollout. A remote mutation
*during* server cascade, deeper child conflicts, retained/shared binding changes,
quota and native identity races remain acceptance work. Current-head CI and
deployed acceptance are unverified. No main merge or manual deployment occurred.


## Account device History capture and sync — 2026-10-17

Ordinary account edits through `AccountThingSync.things`, local deletion, and
reviewed replacement with the account version now retain immutable device
versions in the same workspace transaction as their content and sync intent.
Intermediate edits survive content-queue coalescing. The recorder reuses canonical
`TimelineEventRecord`/`TimelineLink`, content snapshots and component captures;
there is no new database or alternate event format. Account/origin/data-plane
partitions and active workspace leases remain mandatory.

Device versions are client-authored private **draft** events. They do not claim
that the server executed a mutation. Existing Timeline discovery and sync upload
them only after matching identity confirmation; server revisions remain separate.
Remote cache reads and sync acknowledgements do not manufacture local edits.
Real receipts reach authoritative device records before the ordinary cache;
cache clearing cannot delete these versions. Receipt bookkeeping space is reserved
at admission, and existing workspace byte/record limits apply atomically.
Anonymous events never enter this account queue.

Local verification: 402 workspace/offline checks and 238 Timeline checks pass
(640 total; 43 opt-in browser cases excluded from that count). Two explicitly
run production-client browser cases pass: native offline account renames retain
both intermediate versions across cold reload, then sync exact canonical events
and receipts; an account switch closes private History and denies the other
account. Viewports 1440×1000, 390×844 and 320×844 fit; offline mutations and browser
errors are zero. Guest Thing/Timeline reads return 404/401. The built offline
shell contains 247 verified assets (21,725,025 bytes). TypeScript retains 91
baseline diagnostics, none in changed files; focused lint has no errors (two
existing constructor warnings).

Unit regressions also cover immutable component dependencies, parent-first retry
after a lost reply, transaction rollback, acknowledgement at full workspace quota,
concurrent tabs, retired leases, scope isolation, cache pruning and reviewed
conflict replacement. Evidence is local only: `tmp/account-history-native-verified/`
and `tmp/account-history-switch-verified/` contain screenshots/results.

Remaining: protected feature-specific History adapters, full account-offline
restore/export/branch/note controls, cross-origin/data-plane native transitions
and the broader local-first matrix. This checkpoint does not establish current
CI/deployed acceptance and does not close the merge gate.


## Offline account History export — 2026-10-17

The normal History Export button now reads retained account versions locally,
including unacknowledged client-authored drafts. It uses the existing shared
version materializer and archive validator; it neither syncs content nor reads
current Things to substitute for missing historical data. Matching account,
origin, data-plane and active workspace leases are required. A prepared download
is invalidated by cancellation or a workspace switch. Missing ancestry, missing
snapshot parts and oversized archives fail explicitly; an online fallback requires
verified account authority.

The format remains the History archive (`formatVersion: 1`), not a portable
`thingtime.transfer` bundle. Device drafts carry `receipt: null` until a real
receipt exists. Network exports still require an authority receipt. Device archives
mark notes/names as `context: { source: "device", complete: false }`; only retained
canonical notes and accepted naming effects are included. Full account note/name
retention and offline editing remain outstanding.

Local checks: 406 workspace/offline tests and 239 Timeline tests pass (645 total;
43 opt-in cases skipped). The enabled production-client account History browser
case passes: cold offline reload, native exports of a cached server revision and
an unsynced intermediate edit at 1440/390/320px, zero Timeline requests caused by
export, no offline writes or browser errors, and exact canonical receipts after
reconnect. Four downloaded archives and three screenshots are retained under
`tmp/account-history-export-native/`. Additional facade assertions verify wrong
owner/origin/plane refusal, abort after preparation and retired-download fencing.
The production client build contains 247 verified offline assets (21,728,677
bytes). TypeScript still has 91 baseline diagnostics and none in changed files.

Remaining gates include account-offline restore/undo, branches, notes and names,
protected History adapters and the broader local-first acceptance matrix. This
checkpoint establishes local evidence only; current-head CI/deployed acceptance
and the main merge gate remain open.


## Offline account History restore and undo — 2026-10-17

Ordinary retained account Things now use the same `LocalTimelineVersions` planner,
component comparison and atomic writer as anonymous History. A scoped authority
adapter supplies account records and the normal `AccountThingSync` writer. The
normal Restore/Undo controls no longer wait for a Timeline upload before a local
comparison or commit. Account results remain client/draft events with null
receipts until verified sync; network/anonymous authority contracts are unchanged.

The comparison retains only its bounded canonical source/basis/component closure.
Accepted cache entries keep their actual receipts in the existing account
partition. A previously unedited account Thing needs an exact retained revision
matching current content; missing history is never invented from live values.
Restore validates ordinary content, creates independent recorded component copies
when selected, and commits content, sync intent and History together. Undo uses
shared three-way comparison, preserving independent later edits and requiring
choices for overlaps. Stale heads/components, retired scopes and cancellation
still refuse. A committed retry returns the original result even after a later
deletion; it never restores that deleted Thing a second time.

Local verification: 411 workspace/offline checks and 239 Timeline checks pass
(650 total, excluding 44 opt-in skips). The enabled production-client browser
fixture `accountTimelineRestore.browser.test.ts` passes with no account session
borrowed: it creates one disposable private loopback account, makes two offline
native edits, cold reloads, restores and undoes through normal History controls,
and reloads again. Review fits at 1440/390/320px, offline writes/browser errors
are zero, and reconnect uploads four exact canonical device events with real
receipts. Guest reads remain 404/401. Evidence: `tmp/account-history-restore-native-final/`.

Focused regressions cover accepted server bases, independent component copies,
quota-failure rollback across content/queue/history, simultaneous retries,
operation identity reuse, stale previews, overlapping undo, retired writers,
no-network facade calls and retry after later deletion. The final build has 247
verified offline assets (21,734,476 bytes). TypeScript retains 91 baseline errors,
none in changed files; lint has no errors and three existing constructor warnings.

Remaining: deleted-account recovery through reconciliation, other editor-specific
pending draft sources and protected History adapters, complete account-offline
branch/note/name controls, full component/merge and native identity-transition
acceptance, plus the broader local-first matrix. Existing remote recovery remains
available only with verified authority. CI/deployed acceptance is unverified; this
checkpoint does not close the main merge gate.


## Offline recovery of ordinary account Things — 2026-10-17

The normal History recovery control now restores a retained deletion locally,
using the existing shared version planner, validators, component-copy logic and
atomic content/Timeline writer. It keeps the original ID, forces a private
audience and falls back to Things root when the original folder no longer exists.
A recorded latest deletion is required; a newer accepted revision refuses stale
recovery. Account events stay client/draft with no fabricated server receipt.

Recovery reconciles the existing account queue in the same transaction. A delete
that has not been sent becomes a conditional update; a completed delete becomes
a normal authenticated create. Frozen requests and claims remain immutable until
their outcomes resolve. The recovered revision exceeds earlier writes, so late
create/update replies cannot overwrite it. New linked content waits for the
recovered parent’s frozen delete to resolve before syncing. A late delete acknowledgement leaves
recovered content pending instead of incorrectly declaring it synced. Conditional
conflicts and ID collisions still require review and ownership checks.

Local verification: 422 workspace/offline checks and 239 Timeline checks pass
(661 total, excluding 45 opt-in skips). The enabled
`accountTimelineRecovery.browser.test.ts` also passes: a disposable private
loopback account deletes through Things, confirms server removal, cold reloads
History offline, recovers through the normal control at 320px, reloads the
editable content and reconnects. The real API recreates the same private ID;
guest reads return 404. Reviews fit 1440/390/320px with zero offline writes or
browser errors. Evidence: `tmp/account-history-recovery-native/`. Focused tests
cover delayed create/update/delete responses, lost-response reload, stale reads,
private recovery, missing folders, recorded component copies, transactional
rollback, immutable retry and account identity/collision/conditional-write fences.

Remaining: attachment-bound and protected recovery adapters, full mid-cascade
child/file concurrency, editor-specific pending History sources, branch/note/name
controls, the broader local-workspace matrix and exact-head CI/deployed
acceptance. Known attachment recoveries retain the existing verified remote
adapter; this increment does not silently recover only part of their content.
This is local acceptance of ordinary recovery, not completion of the full goal
or permission to merge ahead of its remaining acceptance gates.


## Offline account History names and notes — 2026-10-17

Saved account versions can be named, renamed and cleared while disconnected.
The Versions control persists canonical `name-version` commands in bounded,
scoped IndexedDB rows (128 pending commands). Accepted name records use a
separate bounded cache; pending labels are UI projections, never fabricated
account events or receipts. Database version 7 adds these stores without
changing existing note queues or canonical Timeline records.

An outgoing command freezes only after its predecessor resolves. Lost replies
replay the identical command after reload. Later local names wait, then use the
actual accepted revision from that predecessor. Definitive refusals preserve
local intent and allow unrelated names to sync; explicit Keep local names reads
the current account state before retrying, while Discard local names removes
only a refused local chain. Uncertain writes cannot be discarded. Late reads
cannot erase newer acknowledgements. Account History exports use retained
accepted metadata, omit pending name projections and keep the existing explicit
partial-context marker.

Account note Save, Remove and Retry now finish after durable local queueing;
the provider drains them separately. Going offline downgrades the connection,
suppresses discovery/push attempts and checks transport availability between
commands. Reconnect uses normal account/origin/data-plane discovery. Anonymous
History retains its local authority and never enters this remote name queue.

Local checks: 423 workspace/offline checks plus 249 Timeline checks pass (672,
excluding 46 opt-in skips). The enabled native History browser fixture verifies
name/rename/clear/name and notes across cold offline reloads at 1440/390/320px,
zero offline write attempts, private guest refusals and actual canonical API
acknowledgements after reconnect. Removing an acknowledged note also finishes
locally while offline and reaches the account independently on reconnect. Evidence is in
`tmp/account-history-names-native-verified/`. TypeScript retains the same 91
baseline diagnostics; focused lint has zero errors and seven existing warnings.
Client build verifies 247 offline assets. These are local results, not current
CI or deployed acceptance.

Remaining: broader branch
controls, protected/attachment-bound recovery and the full local-feature matrix.
This checkpoint preserves existing saved-version eligibility; it does not claim
that every History feature or the full local-first goal is finished.


## Pending History note removal — 2026-10-17

A note can now be removed while its add is still queued. Removal finishes on the
device immediately and survives reload; remote sync waits for the exact add
acknowledgement before sending the independent remove command. Ambiguous adds
keep their immutable retry identity. A definitive add refusal blocks only its
own removal; Retry/Dismiss target the failed add, and dismissing that refusal
also discards its never-sent dependent removal. Unrelated notes still progress.

Account removal replaces the protected note's payload with a small, metered
canonical `TimelineNoteRemoval` record under the same identity. The text and
source references are removed. Retries cannot recreate that identity or rerun
its explanation; a fresh note requires a fresh operation ID. Missing-note
removal also records this identity, covering a delete that arrives before add.
The marker has no event target, so existing indexed note reads and event caps
exclude it. Quota/refund changes and replacement remain one transaction.
Anonymous authority uses the same record in its existing removal marker store,
with compatibility for old boolean markers. There is no new collection or index.

The bounded account cache uses one persisted revision per scope (IndexedDB v8),
so a page read started before removal or a duplicate add acknowledgement cannot
restore a removed cached note. Existing v7 names and notes survive migration.
Remote note commands negotiate `api.timeline` 1.19.0; no fallback bypasses that
contract or account/origin/data-plane verification.

This is a History increment. Broader branch controls,
protected and attachment recovery, and the full local-feature matrix remain open.

Local validation: 424 workspace/offline checks, 255 Timeline checks and 100
capability checks pass (779; 46 opt-in skips excluded). The real replica HTTP
fixture passes three simultaneous add/remove races, delayed replay refusal,
privacy, slot limits and normal read projections. Lopu returns the expected
unverified-account refusal; no successful AI execution is claimed. The enabled
native fixture passes offline pending removal, cold reload at 1440/390/320px,
actual reconnect acknowledgements, three concurrent delayed retries, accepted
note removal and guest refusals, with zero offline write attempts or page errors.
Screenshots were inspected at all three widths; evidence is retained under
`tmp/pending-note-removal-native-ready/`. TypeScript retains the same 91 baseline
diagnostics; focused lint has zero errors and seven existing warnings. Client
build verifies 247 offline assets. These are local results, not CI or deployment
acceptance. Earlier native attempts failed before fixture creation while the
local Nitro runner restarted; those failures are not counted as passes.


## Device draft names and anonymous version export — 2026-10-17

Retained owner-authored client drafts now use the same canonical version-name
contract as saved revisions. The shared eligibility check requires retained
`after` content and the original client/owner provenance; effects, deleted
versions without after content and mismatched provenance remain ineligible.
The original event is immutable: naming never publishes it or changes its
`draft` mode, client source, owner, identity or receipt.

Account names finish in the existing scoped local queue, including before the
version upload. The queue replays an uncertain upload exactly and waits for its
real acknowledgement before sending the name. Remote naming negotiates
`api.timeline` 1.20.0. Anonymous drafts are named by their isolated local
Timeline authority, with the same rename/clear, revision, replay and transaction
rules; they never enter an account queue.

Anonymous History can also export retained client draft content using the normal
version reader and downloadable JSON. Local canonical names and local receipts
are included without inventing account authority. Unsupported/non-content
snapshots keep the normal explicit export errors. Account device exports retain
the existing partial-context marker and omit unacknowledged name projections;
that is distinct from an anonymous authority's accepted local metadata.

Remaining work includes the wider branch controls and editor-source matrix,
protected and attachment recovery, shared/managed/linked import/export and sync,
account/origin/data-plane transitions, encrypted local Vault and the other
unfinished items in the full feature matrix. This does not complete the rollout.


The full anonymous browser run also exposed an adapter regression: remote
capability predicates were replaced by async refusal functions. Explicit local
`canChangeLocally`/`canExportLocally` checks now return synchronous booleans,
validate the current local scope/lease, and return false after retirement or for
a foreign scope. Mutating remote operations remain blocked. This removes
unhandled promise errors from otherwise local History rendering.


Local validation: 784 automated checks pass (425 workspace/offline shell,
258 Timeline and 101 capability checks; 46 opt-in skips excluded), with focused
adapter/server reruns after the final fixes. The production-client account
fixture passes offline draft naming, cold reload at 1440/390/320px, canonical
exports, unchanged draft provenance and real name acceptance after reconnect,
with zero offline writes or page errors. The complete anonymous native fixture
passes Builder draft naming and actual JSON downloads at the same widths,
alongside its import, previews, branch editing/merge, restore, comments and
reload checks: zero account mutations, Timeline requests or browser errors.
Screenshots were inspected at all widths. Evidence: `tmp/device-version-names-account-verified/`
and `tmp/device-version-names-anonymous-accepted/` (including the downloaded
History JSON files). These archives use the existing History version format,
not `thingtime.transfer`.

The final build verifies 247 offline assets (21,751,558 bytes). TypeScript keeps
exactly the same 91 baseline diagnostics; focused lint has no errors and one
existing local Timeline constructor warning. Earlier native attempts exposed
and repaired the async capability predicate regression and ambiguous/late-read
fixture selectors; their failures are retained in the logs and are not counted
as passes. These are local results, not current-head CI or deployed acceptance.


## Latest-main integration — 2026-10-17

`main` at `ac0ab1c93` is integrated into this branch. Shared Settings cards remain
collapsed by default; local device storage stays available without login and
through a cold offline reload. Keyboard/pointer access, background editor-tree
saves, scoped byte accounting and unchanged authored records now have combined
branch browser coverage at 1440/390/320px. Anonymous and account History native
checks also pass after integration. 1,287 automated checks pass; TypeScript keeps
91 unchanged baseline diagnostics. See the [integration evidence and limits](../PRs/1000-codex-anonymous-local-first--support-anonymous-and-offline-local-workspaces.md#upstream-integration-and-offline-settings-acceptance--2026-10-17).
The wider completion matrix above is unchanged and remains the merge gate.


## Anonymous provider vault

Settings → Security → Secure Vault is available without login. Create its
independent device passphrase (at least 12 characters), then use the normal
forms to create environments, secrets and provider connections, move entries
or delete them. Metadata and values are encrypted together. A selected value
can be shown briefly after device unlock; blur, hiding the tab, page exit,
locking, or 30 seconds clears the reveal. Reload requires unlocking again.
A nonempty environment cannot be removed. Operation identities, revisions and
atomic namespace checks preserve concurrent work; quota refusal leaves both
content and intent unchanged. Save completion does not depend on a follow-up
list refresh. Notifications use generic text without saved entry names.

Anonymous records never enter a sync queue or become account content on login.
Saving provider configuration does not execute a provider request or Action.
The browser-safe shared validator checks authoring syntax; server-only host
and allowlist restrictions still apply when a server uses a connection.
`api.lopu-vault` 1.2.1 also rejects malformed supplied replacement tokens instead
of treating them as a request to retain the old token. Existing account
session, JSON, rate-limit, ownership and freshly verified reveal checks remain.

Use HTTPS or loopback for WebCrypto. Build/load the production client once to
install the normal offline shell; then disconnect. No server encryption key is
needed for anonymous storage. Run the actual browser fixture from `remix/`:

```sh
TT_LOCAL_PROVIDER_VAULT_URL=http://127.0.0.1:<local-port> \
TT_LOCAL_PROVIDER_VAULT_ARTIFACTS=<ignored-output-directory> \
TT_SHARED_PLAYWRIGHT_PATH=<playwright-module> \
TT_SHARED_CHROME_PATH=<chromium-executable> \
node --import tsx --test app/local-workspace/providerVault.browser.test.ts
```

The fixture creates only synthetic anonymous device data in a clean context,
checks initial `user: null`, then disconnects before authoring. It checks native
Settings at 1440/390/320px, encrypted storage, reload/unlock, selected reveals,
move/delete/nonempty-environment handling and zero account Vault requests or
mutations. Default test runs skip this fixture unless its inputs are supplied.

Account provider/environment local UI, ordered conditional account sync,
explicit fresh-reveal retention of existing server values and the remaining
full-feature matrix are still open. This anonymous authoring increment does
not complete that matrix or establish provider execution/native integration.

### Account Vault metadata and selected retention (implementation in progress)

`api.lopu-vault` 1.3.0 adds `POST /api/v1/lopu/vault` with
`{ "action": "sync-metadata", "expectedOwnerId": "<current account id>" }`.
The current full session, exact origin, expected actor and selected data-plane
fences still apply. It returns a complete metadata snapshot with opaque
`vault-state-v1` comparison versions, without decrypting credentials. More than
500 records, more than 32 MiB of source documents or malformed references fail
explicitly; a partial list is never treated as a complete account snapshot.
Versions include the actual stored Thing, so edits through the generic editor
are visible even when the embedded Vault timestamp does not change.

`api.vault-reveal` 1.2.0 optionally accepts `includeVersion: true` for one personal
selection. Existing password/passkey verification and fixed rate limits remain;
the value and version come from the same document. Normal reveal display remains
transient. Explicit offline retention belongs in the separately unlocked device
Vault and must match the selected item's local revision and server version.
There is no bulk plaintext read.

The device adapter now represents remote-only values explicitly, encrypts
metadata, preserves pending edits and needed environments during reconciliation,
and refuses stale reveals. `accountProviderMetadataTransport` negotiates the
new API and uses direct bounded requests with current actor/origin/plane leases.
The account Settings adapter, ordered conditional write transport and reviewed
conflict/retry lifecycle are **not wired yet**. These APIs and storage methods
are groundwork, not completed account offline support.

The reproducible API fixture only accepts loopback URLs and creates a disposable
account with synthetic values. It deletes its Vault entries through the normal
API; the synthetic account remains because there is no account-delete API.
Use the same local Vault key and disposable replica-set setup described above:

```sh
TT_PROVIDER_METADATA_API_URL=http://127.0.0.1:<local-port> \
TT_PROVIDER_METADATA_API_ARTIFACTS=<ignored-output-directory> \
TT_SHARED_PLAYWRIGHT_PATH=<playwright-module> \
node --import tsx --test app/local-workspace/providerMetadata.api.test.ts
```

Run from `remix/`. The fixture proves value-free complete metadata, exact selected
versions, generic-edit detection, anonymous/cross-origin/actor/plane refusals,
wrong-password rejection and empty readback after cleanup. It does not prove
account Settings integration or the unfinished write synchronization contract.

## Vault environment integrity before account synchronization

The shared ordinary Thing mutation recorder now checks Vault relationships inside
the same content transaction as the write, accounting and Timeline append. This
prevents generic edits/deletes from bypassing the dedicated Vault environment
checks: referenced environments must exist under the same owner, and a nonempty
environment cannot be removed or converted into another record type. Renames,
ungrouping, deletion of empty environments and repair/deletion of orphaned entries
remain available. The existing owner Timeline-folder write serializes competing
ordinary account mutations; there is no additional collection or index.

Local API verification reproduced a generic deletion leaving an orphan and a 422
metadata response before the fix. The checked-in `providerIntegrity.api.test.ts`
now verifies rollback of invalid generic creation, missing/self references,
nonempty deletion/conversion, unchanged versions after refusal, valid edits, late
creation after deletion, and four concurrent create/delete trials. All four
observed trials accepted creation and refused deletion. Synthetic fixture entries
are cleaned through the API and an empty Vault is verified. This does not establish
account write synchronization or every native/import/History interaction.

Run against the disposable loopback replica configured above:

```sh
cd remix
TT_PROVIDER_INTEGRITY_API_URL=http://127.0.0.1:22470 \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_PROVIDER_INTEGRITY_API_ARTIFACTS=/absolute/path/to/fixture-artifacts \
node --import tsx --test app/local-workspace/providerIntegrity.api.test.ts
```

`api.things` 1.34.1 and `api.lopu-vault` 1.3.1 describe these compatible integrity
corrections. Both capability generators still derive from the canonical registry.
Account Settings integration and conditional write synchronization remain pending.


## Conditional account provider writes — 2026-10-17

Account provider synchronization now has a closed `sync-write` request on the
existing Vault POST (`api.lopu-vault` 1.4.0). Commands bind explicit create/null
or an opaque full-Thing expected version, target ID and immutable write ID.
The current full session, owner, same origin and selected data plane are
rechecked before canonical mutations. Create/update/delete completion effects
use the existing protected Timeline and share the content transaction; retrying
an acknowledged write returns its original receipt even after ordinary target
deletion. Missing expected updates never become creates. Generic Thing ACLs,
quota, History, environment integrity and bounded deletion cleanup remain active.

The encrypted device queue freezes requests before transmission and claims them
across tabs in sequence order. Exact acknowledgments advance remote comparison
tokens without replacing newer local edits. Locking/cancellation preserves
uncertain work; anonymous vaults reject the sender. The direct transport
negotiates 1.4.0 and retains owner/origin/plane fences without diagnostic logging.

Account Settings integration, reviewed conflict resolution and explicitly
selected fresh-value retention still require completion. Queue mocks and local
API evidence are separate from native browser and deployed acceptance.

Run the real API fixture only on the disposable loopback stack:

```sh
TT_PROVIDER_WRITES_API_URL=http://127.0.0.1:<fixture-port> \
TT_SHARED_PLAYWRIGHT_PATH=<installed-playwright-module> \
TT_PROVIDER_WRITES_API_ARTIFACTS=<artifact-directory> \
node --import tsx --test app/local-workspace/providerWrites.api.test.ts
```

The fixture registers isolated accounts through the normal API and cleans up its
Vault entries through that API. It does not inspect or mutate existing accounts.
The endpoint needs the existing server Vault key documented in README; no new
key or environment variable is introduced.

Local verification: 55 API checks passed, including concurrent identical creates,
competing updates, normal generic-edit conflicts, unchanged completion receipts
after generic deletion, provider ciphertext retention, bounds, origin/owner/plane
refusals and verified fixture cleanup. The queue/receipt/transport/admission tests
pass (25 focused tests). Timeline 258; Things 304 + 18; Lopu 222 + 169;
capabilities 101; workspace 479 plus offline shell 4 pass (52 opt-in skips).
Counts overlap and must not be summed as independent coverage. Production client
build passes with 248 verified assets. Full TypeScript remains at the same 91
baseline diagnostics, with no added or resolved diagnostic signatures.

The rebuilt anonymous native Settings fixture also passes actual offline emulation
at 1440/390/320px: encrypted cold reload, wrong-passphrase refusal, create/move/
delete and reveal masking, with zero account records/commands, protected requests,
network mutations or page errors. All viewport widths avoid horizontal overflow;
the inspected 320px screenshot still shows the previously noted floating assistant
controls over the narrow right edge. This is anonymous acceptance, not account
Settings sync or deployment acceptance. Lint has no new findings; three existing
warnings in `things.ts` remain (one control-character regex and two mixed-operator
warnings on the untouched fallback condition).


## Account provider Settings workspace — 2026-10-17

Security → Secure Vault now uses encrypted device storage for anonymous and
account workspaces. An offline account retains its original owner/origin/plane
partition even though root data has `user:null`. Local saves finish independently
of the metadata and write workers; only a currently confirmed matching account
can synchronize. Anonymous work has no sender. The independent device passphrase
is not an account credential or a network authorization grant.

Account metadata remains value-free. The existing fresh password/passkey reveal
can explicitly retain one selected value, matching its exact remote version.
`api.vault-reveal` 1.3.0 adds optional `expectedOwnerId` with `includeVersion:true`
and `X-Thingtime-Expected-Data-Plane` for this workflow. It checks account and
plane before verification, decryption and disclosure and identifies both in the
scoped response; passkey tickets include the selected plane. The device commit
is cancelled when account confirmation, selection, local revision or lock state
changes. Ordinary transient reveal and its rate limits remain available.

A refused queue exposes a review of all dependent entries, including historical
environment moves. The review token authenticates the complete encrypted local
snapshot. Choosing account versions or independent device copies commits the
reviewed set atomically. Copies get fresh identities, remapped groups and ordered
create commands. Remote-only values cannot be copied without first retaining or
replacing them; deleted records are not recreated. Frozen requests remain intact
until their original outcome is established. No choice force-overwrites the
account original.

Run disposable API and browser fixtures from `remix/`:

```sh
TT_PROVIDER_WRITES_API_URL=http://127.0.0.1:<fixture-port> \
TT_SHARED_PLAYWRIGHT_PATH=<installed-playwright-module> \
TT_PROVIDER_WRITES_API_ARTIFACTS=<artifact-directory> \
node --import tsx --test app/local-workspace/providerReview.api.test.ts

TT_ACCOUNT_PROVIDERS_URL=http://127.0.0.1:<fixture-port> \
TT_SHARED_PLAYWRIGHT_PATH=<installed-playwright-module> \
TT_SHARED_CHROME_PATH=<installed-test-browser> \
TT_ACCOUNT_PROVIDERS_ARTIFACTS=<artifact-directory> \
node --import tsx --test app/local-workspace/accountProviders.browser.test.ts
```

The API fixture confirms a real conditional refusal, independent environment/
child copies, private canonical Things and account-version adoption. The browser
fixture exercises native Settings, explicit fresh retention, actual offline
network emulation, cold reload at 1440/390/320px and reviewed conflict copies.
Only disposable loopback accounts are used; fixture Vault entries are cleaned
through the ordinary API. Account creation itself has no deletion API.

These fixtures are local evidence, not proof of all account/origin/plane races,
History/native integration, CI or deployed delivery. The full feature matrix
above remains incomplete, including account themes/algorithms, mail, media,
protected History and native startup/update acceptance. No main merge yet.

Local verification for this increment: workspace 491 passing / 54 opt-in skips
and four offline-shell checks; sensitive reveal 25, capabilities 101 and Settings
39 passing. The focused provider adapter suites pass 41 tests. The integrated
API fixture passes 19 checks with cleanup verified. Its first attempt received
503 during fixture registration while the app was rebuilding; the healthy
runtime retry and browser fixtures passed without a server restart.

Native account Settings acceptance passes in a clean browser, with mobile fresh
retention, actual offline saves/cold reload at 1440/390/320px, review of dependent
environments and unchanged account originals. The 320px review is visible and
its action center is unobscured after ordinary scrolling. Anonymous acceptance
also passes with no account records/commands, protected requests, network writes
or page errors. Both runs have no horizontal overflow. Full-section captures
still include the existing floating shell controls; their broader placement is
not fixed by this increment. All disposable account Vault entries are cleaned.

Client build verifies 248 assets / 21,884,151 bytes. Focused lint has no findings;
full TypeScript retains the same 91 baseline diagnostics. Capability tests caught
and corrected one old expected reveal version. These are local results only;
current-head CI/deployment and the broader identity/native matrix remain open.
Artifacts: `tmp/provider-settings-verified/`, `tmp/provider-settings-anonymous/`,
`tmp/provider-review-integrated-retry/` and `tmp/provider-settings-*.log`.


## Conditional theme synchronization groundwork — 2026-10-17

`api.themes-sync` 1.0.0 exposes bounded complete snapshots and immutable
conditional writes through `/api/v1/themes/sync`. The new service calls the
canonical home-plane theme writer; it does not use generic protected-kind CRUD
or a second collection. Existing token sanitization, storage accounting,
Timeline content history and legacy migration rules remain authoritative.
New device IDs must be UUIDs and cannot occupy reserved system namespaces.
Complete stored BSON versions detect dedicated edits and generic library-title
changes. A protected Timeline effect acknowledges the exact normalized command;
replaying an old create after deletion cannot resurrect the theme. Selected
content-plane identity is checked even though theme storage remains at home.

The normal create path now counts both storage eras inside the same transaction.
The pre-change loopback test reproduced two successful requests for the final
slot; the repaired fixture admits one and refuses the other. Deletion clears the
matching active-theme pointer inside its content transaction before its receipt.

Local API verification covers concurrent exact retries, stale-write refusal,
cross-writer version invalidation, home storage under a custom selected plane,
private read boundaries, active-pointer cleanup and replay after deletion.
All theme fixtures are disposable and cleaned through normal APIs. The API test
requires `TT_THEME_SYNC_API_URL`, `TT_THEME_SYNC_API_ARTIFACTS` and the shared
Playwright runtime path; it additionally verifies the loopback Mongo fixture at
127.0.0.1:22463 / replica set `draftPreview` before registering an account.
`themeQuota.api.test.ts` is a separate opt-in concurrent-limit fixture. Run
`npm --prefix remix run test:theme-sync` for unit/contract regressions.

This is the server prerequisite. Account theme queues, active-selection sync,
conflict UI, account algorithm sync and protected local History remain unfinished;
the ordinary account theme UI is not yet an offline implementation. No merge or
deployed verification is claimed by these local checks.

### Account theme UI checkpoint — 2026-10-17

Theme Studio account saves, deletion and active selection now commit on-device
through the existing theme writer, with independent background sync workers.
Private content and selection replay use the existing same-origin/owner/plane
admission. Native offline save/apply/cold reload and reconnect passed locally
at 1440/390/320px. Account transfer, protected theme History, broader gallery
retention, conflict/identity browser acceptance and final deployment gates remain
open. See [account theme workspace](account-theme-workspace.md).

## Theme persistence and anonymous History — 2026-10-17

Native Theme Studio Save/Apply waits for the existing editor persistence flush,
so normal local completion survives an immediate offline reload. Content and
selection continue through independent account sync queues. Anonymous theme
create/edit/import/delete uses the existing relational Timeline and approved
`theme-content` snapshots. History names/filtering and version download use that
projection; export never grants generic protected-content restore authority.
Account-authored theme History and account theme import remain unfinished.

`api.timeline` 1.21.0 adds approved theme-content version export. The native
export control negotiates that version only for theme content; ordinary exports
retain the 1.18.0 requirement. Both use the same archive reader and validator.

Opt-in browser tests require a loopback app and the existing shared Playwright
and Chrome paths. Set `TT_ANONYMOUS_THEME_HISTORY_URL` and
`TT_ANONYMOUS_THEME_HISTORY_ARTIFACTS` for `anonymousThemeHistory.browser.test.ts`.
Set `TT_ACCOUNT_THEME_CONFLICT_URL` and `TT_ACCOUNT_THEME_CONFLICT_ARTIFACTS` for
`accountThemeConflict.browser.test.ts`; it checks the isolated local Mongo
fixture, creates a disposable account and cleans only that account's themes
through normal APIs. Neither test publishes content. The anonymous test returns
a downloaded History JSON and 1440/390/320 screenshots with no mutation requests.

## Account theme offline export — 2026-10-17

The normal account Theme Studio download now uses owned retained theme content,
including pending local edits, through the canonical transfer exporter. It also
supports theme children in a retained folder and rejects cross-plane folder
collisions. Complete catalogue snapshots negotiate `api.themes-sync` 1.2.0 for
explicit folder placement; older caches require a compatible refresh before
export instead of dropping that relationship. See
[account theme export](account-theme-workspace.md#offline-portable-export--2026-10-17)
for boundaries and regression entry points. Account import and authored History
remain separate unfinished integrations; this does not close the full matrix.

## Account theme import — 2026-10-17

Canonical account imports and duplicate/fork controls now admit owned theme copies
locally, sharing the existing remapping and atomic import transaction. Imported
folder dependencies delay only the independent background sender. The canonical
home writer negotiates api.themes-sync 1.3.0 for atomic token/placement writes;
normal auth, same-origin, storage and Timeline admission remain intact. See
[theme import boundaries](account-theme-workspace.md#local-import-and-private-duplication--2026-10-17).
General offline theme organization and authored account History are still open.


## Theme library organization — 2026-10-17

Owned account themes now participate in normal mixed library moves and deletes
through their dedicated adapter in the shared local transaction. Folder deletion
preserves children immediately; remote folder removal waits only in the background
for immutable theme placement/deletion receipts. Conflicts remain reviewable and
confirmed theme tombstones prevent stale reads from restoring deleted entries.
Custom-plane folders cannot adopt home theme placement. Anonymous folder deletion
also drains children by default and preserves file bytes; explicit recursive
deletion keeps its existing meaning. Active theme/algorithm deletion clears the
local selection atomically.

Native browser checks passed both disposable account and anonymous flows, including
cold offline reload, 1440/390/320px layout and no offline account writes. Remote
computer discovery now requires matching authenticated identity and pauses while
offline, preserving its cached snapshots. See the
[theme organization checkpoint](account-theme-workspace.md#device-library-organization--2026-10-17)
for checks and remaining limits. This increment does not close the full matrix.


## Offline theme display titles — 2026-10-18

The normal Rename dialog now completes locally for anonymous and retained account
themes, with independent account sync and lossless canonical transfer metadata.
Native offline reload/reconnect and the real API importer pass locally. See
[the title checkpoint](account-theme-workspace.md#offline-display-titles--2026-10-18)
for evidence and remaining boundaries. Other protected-kind titles and the full
rollout gate remain unfinished.

## Account local Action execution — 2026-10-18

`LocalActions` uses the canonical data/browser interpreters for retained owned
account definitions. `AccountThingSync.withLease` preserves the account queue,
Timeline capture and identity fence while adding each run/request deadline and
cancellation. Created, edited and deleted content syncs independently through
the existing conditional write queue; reconnect never invokes the Action again.
Anonymous runs still have no account adapter or remote queue.

Placement is checked before effects using a bounded retained dependency closure.
External lookups, public/system search, shared reads, unsupported endpoint
versions/fields and unretained programs keep their existing authenticated remote
path. Dynamic whole request bodies and dynamic nested HTTP Action references
still require further local adapter coverage. Once local execution starts, an
error never triggers remote replay; prior committed effects remain queued.

Device run details are bounded, labelled “This device”, excluded from portable
content/sync and deleted with their owning Action. They are not signed server
receipts. Ordinary content changes keep the existing canonical Timeline format.

Checks: `test:local-workspace`; opt-in native fixture
`TT_LOCAL_ACTIONS_URL=http://localhost:<preview-port>` and
`TT_LOCAL_ACTIONS_ARTIFACTS=<output-directory>` with the existing
`TT_SHARED_PLAYWRIGHT_PATH` / `TT_SHARED_CHROME_PATH` harness. The fixture refuses
registration unless Mongo status identifies the disposable loopback replica
`127.0.0.1:22463`; it imports normally, reloads offline, invokes the real UI,
exports the result and verifies reconnection sends content without Action replay.


## Conditional algorithm profile synchronization — 2026-10-18

The missing server contract for account algorithms now extends the existing
protected algorithm writer. `/api/v1/algorithms/sync` (`api.algorithms-sync`
1.0.0) returns a complete, bounded private home catalogue and accepts conditional
canonical profile saves/deletes. It copies validated weights and training
statistics instead of replaying engagement events. New profiles are private and
unlisted; updates cannot change sharing, listing, authority or existing lineage.
Legacy profiles require the existing migration before full-content replacement.

Every call rechecks the current full-account session, exact origin, owner and
selected data plane. Storage and immutable Timeline receipts remain home-pinned.
An identical retry resolves its receipt even after a newly verified plane change;
altered reuse and stale document versions fail without discarding device work.
Content, quota accounting, receipt and exact active-pointer cleanup commit in the
same transaction. The normal delete capability is patched to 1.0.1 for atomic
selection cleanup. Input, catalogue and request rates remain bounded; no new
collection or generic protected-kind access was added.

Local real-API acceptance uses disposable registered accounts on the isolated
loopback replica, never direct Mongo writes. It covers owner/anonymous/origin/plane
refusals, private projection, exact retries, concurrent divergent saves, stale
metadata conflicts, preserved training counts, home receipt replay, normal
canonical export/import with fresh IDs and exact profile content, and deletion
replay that preserves a newer active selection. The fixture also checks both live
capability manifests. Evidence: `tmp/algorithm-sync-api/` and
`tmp/algorithm-sync-api-final.log`.

This is the server prerequisite, not completed offline account algorithms. The
account local queue, editor/feed facade, selection synchronization, conflict
review and native offline/reconnect acceptance still need implementation.
Anonymous algorithms continue to use the existing device-only path and never
call this endpoint. Full local-first coverage, main reconciliation, CI and
deployed acceptance remain open; no merge or manual deployment is authorized by
this checkpoint alone.

Validation: 85 feed/algorithm tests passed (one opt-in API case skipped in the
ordinary suite); 105 capability tests passed; the separately enabled API fixture
passed. Focused lint is clean. Raw TypeScript remains at the same 91 normalized
baseline diagnostics with no new signatures. Structural Graphify still reports
two unrelated Swift parse warnings; document semantic freshness is tracked
separately and is not inferred from AST results. This checkpoint changes server
behavior and API fixtures, not a native UI surface.


## Account algorithm device queue — 2026-10-18

`LocalAlgorithms` now accepts an explicit workspace, clock, UUID source and
transactional mutation/selection hooks. Anonymous callers keep the original
scope and IDs. `AccountAlgorithmSync` reuses that canonical local writer and
stores bounded retry metadata beside home-scoped Things. Local create, edit,
training and deletion do not call a transport. A failed local queue write rolls
back its corresponding content change atomically; remote failures preserve the
already committed device work.

The queue freezes an immutable command per attempt, claims it across tabs,
checks exact acknowledgments, retries uncertain responses unchanged, and keeps
newer revisions pending independently. It never replays engagement events.
Complete validated catalogues and read epochs fence stale responses; confirmed
deletions keep tombstones. Reviewed conflicts support account/device choices and
independent private copies, with both sides rechecked before applying a choice.
A branch waits for its source's creation receipt, and source deletion waits for
an unsent branch. An unavailable unsent source retains the branch for explicit
independent-copy review. Base metadata omits full weight maps, keeping large
profiles within per-record storage bounds.

`algorithmTransport.client.ts` negotiates `api.algorithms-sync` 1.0.0 and the
selected-plane contract, then repeats current remote/local lease checks around
bounded same-origin requests. It preserves the current selected plane while
confirming home storage. Anonymous, offline-unconfirmed, changed-account/origin,
partial, oversized and mismatched responses cannot acknowledge device work.

This checkpoint supplies the queue and transport; **the account API facade,
native editor/feed integration, active-selection synchronization and conflict UI
are not wired yet**. Normal account transfer/library hooks and native offline,
reconnect and multi-tab acceptance remain required. No server, existing account,
public content, merge or manual deployment was changed during this checkpoint.

Validation: 575 local-workspace tests passed with 67 opt-in skips, plus all four
offline-shell checks. Fourteen focused algorithm/transport tests passed after
final acknowledgment hardening. Focused lint is clean; TypeScript reports the
same 91 normalized baseline diagnostics and no new signatures. The queue and
transport are tested independently; no native UI, deployed feature acceptance
or complete account algorithm flow is claimed by these results.

## Independent account algorithm selection — 2026-10-18

Account selection now has a bounded conditional protocol on `algorithms/sync`
(`api.algorithms-sync` 1.1.0). It extends the normal secure account writer and
owned-profile validation; selection plus its exact retry receipt commit in one
home transaction. Current owner, origin and selected-plane checks still apply.
Built-in choices and null clearing need no profile upload. Replay returns the
original receipt without replacing a later choice or reviving a deleted profile.

The home device queue records selection atomically with local apply, deletion
and conflict-copy remapping. It preserves newer choices during uncertain writes,
claims work across tabs, and requires fresh review for conflicting remote choices.
Pending selection references protect retained profiles from catalogue deletion.
The transport negotiates 1.1.0 before sending selection operations. Anonymous
selections never enter the account queue.

Local verification: 87 feed tests passed (one opt-in skip); 582 workspace tests
passed (67 opt-in skips), plus four offline-shell checks. After the final
retention guard, 84 focused queue/selection/transport/capability tests passed.
The real loopback API fixture passed 67 checks using newly registered disposable
accounts, including normal import/export, exact retries, private ownership,
concurrent choices and concurrent profile deletion. TypeScript retained the
same 91 baseline diagnostics; no new signatures. Focused lint passed.

This completes the selection prerequisite, not native account activation. The
account facade, editor/feed, normal transfer/library hooks, sharing controls and
conflict UI still need integration, followed by clean offline/reconnect/multitab
browser acceptance. Private feed observations must stay scoped to their selected
source plane while algorithm content stays at home. Full coverage, latest-main
reconciliation, current-head CI and deployed acceptance remain merge gates.

## Account algorithm library transfer — 2026-10-18

The normal local Thing importer/exporter and library organization hooks can now
use the dedicated account algorithm adapter. Import remaps IDs and folder
references atomically; export keeps the canonical portable profile and omits
ownership, sharing, lineage and queue metadata. Profiles remain private and
inactive. Generic content updates still cannot replace protected profiles.

Local import, move and delete finish without waiting for a folder upload or an
algorithm write. Only the background sender waits for a new folder receipt.
Uncertain writes replay the exact command before a later placement; folder
removal waits for the child's acknowledged move. Conflict copies retain their
device folder, and accepting device content records the reviewed remote folder
before queuing the chosen placement. Prepared exports are revoked on deletion
or identity changes.

`api.algorithms-sync` 1.2.0 adds optional `folderId` to saves: omission preserves
placement and explicit null moves to the root. The canonical writer locks the
owned home folder chain in the same transaction as content, version and receipt.
Foreign/missing folders cannot partially commit content or a receipt. Older
hosts refuse placement writes through capability negotiation.

Native account facade/editor/feed activation and conflict UI remain pending;
these adapter checks do not establish native offline browser acceptance.
Private feed observations still require selected-source-plane isolation before
activation. Full coverage, latest-main reconciliation, current-head CI and
deployed acceptance remain outstanding merge gates.

Local validation for this checkpoint: 588 workspace tests passed (67 opt-in
skips), plus four offline-shell checks; 88 feed tests passed (one opt-in skip).
The disposable loopback API fixture passed 83 checks, including ownership,
placement, canonical transfer, conditional selection and receipt retries.
The initial API attempt reached an unready dev runner before startup completed;
the healthy-server rerun passed. Focused lint passed. TypeScript retained all
91 normalized baseline diagnostics with no additions. No new native browser,
CI or deployed verification is claimed for this checkpoint.


## Native account algorithm integration — 2026-10-18

The normal settings manager and feed now use protected home algorithm content
through the account workspace facade. Create/edit/delete/apply/train and normal
canonical transfers complete in IndexedDB; independent profile and selection
pumps use the exact current selected account/origin/plane authority. A delayed
profile upload does not block a built-in choice. Selecting another database
does not authorize generic home content sync. Anonymous work never enters these
account pumps. Account sharing/listing and unknown shared-profile branching
remain explicit authorized online operations. Their requests carry captured
actor/database headers and abort on workspace invalidation, including while
waiting for capability negotiation. Older hosts must advertise the protected
algorithm protocol before those account requests can run.

Private feed features are partitioned by their selected source plane inside the
account's home partition, bounded separately from profile content. Old unscoped
account observations are ignored. Engagement sessions, queued events and
observed DOM nodes retire on full workspace identity changes, including plane
changes without a new root generation. The manager keeps cached first paint,
uses cross-tab invalidation, and offers fresh conflict review with device/account
choices and an independent copy. Offline cold startup still requires the native
Reconnect action to verify the account before any upload.

The new browser fixture is `accountAlgorithms.browser.test.ts`; set
`TT_ACCOUNT_ALGORITHMS_URL` to the disposable loopback Nitro origin,
`TT_ACCOUNT_ALGORITHMS_ARTIFACTS` to an ignored output directory and
`TT_SHARED_PLAYWRIGHT_PATH` to the installed Playwright module. Build the current
client and run `sync:nitro-template` before testing cold offline startup. The
Vite HMR origin deliberately has no offline manifest. The fixture creates only
a new disposable account, uses real APIs, exports/imports through the native
controls, verifies fresh IDs and private ownership, and cleans up its profiles.
It exercises 1440/390/320px layouts and immediate offline conflict-copy reload.

Local checks: 592 workspace tests and four offline-shell tests passed, with 68
opt-in browser/API skips; 88 feed tests passed with one opt-in skip. TypeScript
retains the same 91 baseline diagnostics and focused lint has no errors (one
existing Feed effect dependency warning). The production client build passed.
The clean-browser fixture passed all five functional checkpoints with zero
page errors: cold offline native create/apply, a second offline tab, canonical
native export/import with fresh IDs, authorized reconnect sync and conflict
review/keep-both surviving an immediate offline reload. Screenshots were checked
at 1440, 390 and 320px. An initial failed run found the unavailable Vercel
Analytics script on local Nitro; Analytics now follows existing server deployment
metadata instead of loading on every local/fork production build. This checkpoint does not claim
current-head CI, deployment verification or full feature-family acceptance.
Native feed training across account/plane switches, the wider library pathways,
latest-main reconciliation and the full coverage matrix remain merge gates.

## Algorithm library display titles — 2026-10-18

The normal library Rename action now uses `LocalThings.renameLibrary` for
anonymous and retained home-account algorithms. It changes only existing
`crystal.title` metadata and preserves profile names, weights, statistics,
placement and sharing. The dedicated account algorithm queue handles eventual
conditional synchronization independently of generic Things and drafts.

The shared algorithm transfer validator, normal importer/exporter and private
snapshot projection preserve optional title metadata, including explicit null.
Legacy writes that omit the field preserve the stored title. Shared preview
projections and normal profile branching do not copy private library aliases.
`api.algorithms-sync` 1.3.0 advertises this contract; catalogue reads and writes
carrying a title refuse older hosts before sending content.

Regression coverage includes anonymous rename/export/import, stale titles,
protected-writer refusal, native account facade rename/delete, exact retry after
a lost response and capability negotiation. The opt-in real API fixture covers
normal library rename versus conditional sync, omitted/null titles, immutable
replay and normal branching. The native browser fixture uses the actual Things
Rename menu before cold offline reload, canonical download/import and reconnect.
See the PR note for the execution results; this increment does not close the
remaining full-workspace acceptance matrix.

Normal remote algorithm title transfers also require `api.things-export` 1.17.0
and `api.things-import` 1.13.0. The shared client negotiates these before normal
remote transfer, and both live manifests are checked by the API fixture.

## Anonymous encrypted password files — 2026-10-18

Integrated main `0618f323e` (complete 1PUX/password files and Gmail consent/Actions)
while preserving local queues, attachment cancellation fences and private vault
boundaries. The existing archive writer and attachment UI now take an explicit
`PasswordStorage`; the anonymous adapter uses scoped IDB ciphertext chunks and
the canonical authenticated file frames. Names, keys and source paths remain
inside encrypted vault metadata. A file becomes visible atomically after all
parts are saved. Exact retries compare ciphertext as well as metadata, deletion
removes associated parts, and a locked vault cancels blocked input and denies
subsequent decryption. Incomplete upload generations expire after 24 hours on a
later upload; completed files are retained.

Local verification for this increment:
- Seven focused file tests: multi-frame and empty files, full backup/import data,
  52-entry pagination, concurrent replay, changed-byte refusal, partial cleanup,
  corruption/missing frames, file-removal replay fencing, parent deletion and vault locking. Fetch is forbidden
  by tests of anonymous archive creation.
- Clean browser: native offline attachment picker, cold reload/unlock, normal
  1PUX download, deletion/reimport with fresh identities and exact-byte download;
  1440/390/320px layout has no horizontal overflow. Zero password API requests,
  remote writes, account records, queue commands or page errors. Saved secret
  fields remain encrypted. The in-app browser also reaches the anonymous setup
  surface; all mutations use a separate disposable browser context.
- Workspace suite: 598 passed and 68 opt-in cases skipped before the final three
  focused tests were added; offline-shell suite 4 passed. Passwords 50, attachments
  314, mail 34, schemas 270 and capability registry 107 passed. Production client
  and Nitro template built. Raw TypeScript remains at 91 existing diagnostics,
  with no new signatures. Changed-file lint has no errors (two existing password
  editor effect-cleanup warnings); the new adapter/tests lint cleanly.

Evidence: `tmp/local-password-files-browser/verification.json`, its three PNGs,
`synthetic-passwords.1pux` and `restored-attachment.txt`; suite output is in
`tmp/local-password-files-*.log` and `tmp/local-first-main-*.log`.

Still incomplete: account password attachment retention, independent upload/delete
sync and conflict handling; large local password entry codec parity with the
expanded server importer; full unknown-member/category import matrix in the
native anonymous UI; remaining full-suite matrix and exact-head CI/deployed
verification. The existing device workspace storage limits also need review
against the updated power-user policy. This checkpoint does not claim those
features complete or authorize merging early. The PR API still advertises an
older head than the actual feature branch, so its checks/preview are stale.

## Account password file sync groundwork — 2026-10-18

`LocalPasswordVault.fileStorage()` now commits account file bytes and an encrypted
upload intent atomically. Anonymous writes still create no intent. Separate
`synchronizeFiles()` and `reconcileFiles()` methods share the canonical file
frames and transfer implementation; they are not yet connected to the account UI.
The account UI continues to use its existing remote file backend until conflict
review and deletion receipt handling are completed and browser-verified.

The file worker waits for parent entry acknowledgement only in the background.
It renews cross-tab claims during long transfers, records the actual server file
ID before sending bytes, preserves exact metadata/identity on uncertain retries,
and retains deferred deletions. Removing a file before its first dispatch cancels
the local intent. Removal during upload cannot restore the file from a late
receipt. Parent deletion keeps uncertain child intents until canonical parent
cleanup is acknowledged. An unknown start receipt is recovered through the same
idempotent `file-start` operation, with normal upload permission still required.

`passwordFileTransport.client.ts` now requires `api.passwords` 1.2.0 (see the replay checkpoint below) and current local
and remote leases across the whole transfer, including download consumption.
Object requests omit account credentials. Download retention reuses the local
encrypted chunk writer without adding upload commands. Incomplete traversals,
changed parents, pending local edits and invalid metadata preserve saved files;
only complete validated pages can remove unchanged clean retained generations.

Local checks: 620 workspace tests passed (68 opt-in cases skipped), plus four
offline-shell tests and 50 password tests. The focused file/transport tests cover
reopening, cross-tab renewal, lost receipts, lock/identity cancellation, parent
ordering, delete races and partial retention. No account UI, real API, CI or
deployment acceptance is claimed for these new worker methods. See ignored
`tmp/account-password-files-*.log` for local results.

Before enabling account file workers: preserve attachments/source links through
entry conflict-copy/discard; provide file retry/review status; handle remote parent
removal without losing pending file work; and fix the existing server delete
replay gap. Currently `file-delete` requires a matching attachment row before
calling the canonical cleanup service, so a lost success followed by a retry may
return 404 after the row was removed. Treating that response as successful cleanup
would not establish a replay fence. Native offline/reconnect/retention tests must
then use disposable accounts through the normal API. Large-entry codec parity,
workspace limits and the remaining full-suite matrix also remain open.


## Password file deletion replay and conflict preservation — 2026-10-18

The canonical attachment cleanup now retains an owner/parent-bound cancellation
receipt for password files. It contains no file key, real name, encrypted metadata,
object version or upload authority. The dedicated password API acknowledges a
replayed delete/abort only for that receipt and a currently owned live parent;
missing or foreign rows remain 404. A delayed original start remains refused.
Parent deletion preserves the same fences and cannot acknowledge deferred object
cleanup. Ordinary attachment request-ID cancellation also refuses password-purpose
rows, including retained receipts. Both discovery manifests advertise
`api.passwords` 1.2.0; the new account file transport requires that version.

Entry conflict review prepares independent encrypted copies of each live local
file and recursively copies retained source archive entries, remapping references
(including cycles). New keys, nonces and IDs are generated through the canonical
file writer. Staged file generations become visible only in the same transaction
as all new entries and intents. Changed attachments or source entries, unavailable
source archives, damaged bytes, lock and quota failures retain the original
conflict. Discarding local edits cancels undispatched work but preserves uncertain
file cleanup. A complete account refresh that loses a parent with pending file
work creates a reviewed conflict instead of orphaning those bytes. Child cleanup
waits for an explicit canonical parent-delete acknowledgement, never an inferred
404 or an empty queue.

Local verification: the real loopback API fixture completed encrypted multipart
upload, list, exact-byte download, repeated delete/abort, delayed-start refusal,
parent cascade and anonymous/wrong-owner/wrong-parent checks. Its successful run
cleaned up its entries through normal APIs; new fixture accounts and minimal
receipts remain. An earlier failed signed-URL setup attempt may retain a pending
multipart reservation until the normal settlement interval; it belongs only to
that synthetic account. No existing account or public content was modified.
Evidence: `tmp/password-file-replay-api/{verification,cleanup}.json` and
`tmp/password-file-replay-api/downloaded-fixture.bin`.

The account file UI still uses its existing remote backend. File status/review
controls, pump activation, complete remote-file availability reporting and native
offline/reconnect/retention acceptance remain open. This increment has local unit
and API proof only; current-head CI and deployed acceptance remain unverified.
Large local-entry/storage parity and the full-suite matrix are still completion
gates. No merge or deployment was performed.

## Native account password files — 2026-10-18

The normal password UI now uses the encrypted device file backend for both
anonymous and account workspaces. Local upload/removal completes independently
of remote work. Account entry push/pull and file push/pull have separate pumps;
each requires the current unlocked vault, account, origin and selected-plane
lease. Parent admission still orders uploads without delaying the local save.
File retry/review status is visible, and retry preserves immutable operation
identity, payload and cleanup provenance.

Remote file metadata is retained encrypted before downloading bytes. Failed
objects remain visible as unavailable while other files continue to retain.
Downloads are disabled for missing bytes. Unknown or incomplete file lists block
normal 1PUX backup and reviewed copies, including source archives, rather than
silently dropping files. CSV remains explicitly lossy. Remote-only files can be
removed offline through the canonical deletion queue. Per-parent traversal tokens
prevent an older tab from pruning files confirmed by a newer traversal. Pending
entry conflicts do not prevent retaining the files needed to resolve them.

The real browser fixture caught an additional error path: a file-availability 409
containing the word “account” was treated as identity loss and closed Export.
Device workspaces now clear only for the explicit identity code or a 401; ordinary
availability errors keep the dialog and saved editor state open.

Local production-client acceptance passed in clean contexts against the disposable
loopback replica and normal APIs: offline save, exact-byte download, cold reload,
1PUX export/import, independent reconnect, fresh-device retention, unavailable
objects, incomplete-export refusal and recovery. Layout bounds passed at
1440×1000, 390×844 and 320×844 with no horizontal overflow. The fixture deleted
its three created entries through normal APIs (no pending cleanup); synthetic
accounts and canonical minimal receipts remain. Both the existing anonymous-vault
and account-entry/conflict regressions also passed. Their fixtures have their own
cleanup scope; the account-entry fixture does not remove its first test account's
entry data. No existing user data or public content was changed.

Evidence: `tmp/account-password-files-native-final/{verification,cleanup}.json`,
`account-files-{1440,390,320}.png`, exact-byte download and both 1PUX exports;
`tmp/password-file-ui-{anonymous,entry}-browser.log` hold the regressions.
Workspace tests: 632 passed, 70 opt-in skips. Password tests: 53 passed.
Focused file tests: 45 passed (overlap with workspace coverage); offline policy:
four passed. Lint: no errors, two existing hook cleanup warnings. TypeScript:
the same 91 baseline diagnostics, no new signatures. Client build and Nitro
template synchronization passed with 249 verified offline assets.

These are local results. Following the updated connected-Chrome requirement,
additional Chrome inspection was attempted but its Page.enable attachment timed
out; reconnection was requested. Do not count that attempt as a successful check.
Current-head CI/deployment and the broader identity/plane/native/full-suite matrix
remain open. GitHub still reports the older PR head while the branch ref advances;
checks on that old head are not proof for this checkpoint. No merge, deployment
or public exposure was performed. The HTML progress view is
[anonymous-local-first.html](progress/anonymous-local-first.html).


## Large password value codec parity — 2026-10-18

The browser password codec no longer applies the provider vault's 64 KiB
value limit to password entries or file metadata. Both password adapters use
`passwords/capacity.ts` for the account writer's existing 16 MiB codec ceiling.
The local record layer admits the resulting base64 envelope and retry metadata
instead of rejecting it at the ordinary 1 MiB JSON budget. No envelope version,
authenticated context, encryption, KDF, permission or account API contract changes.
Actual server admission continues to check the complete encrypted BSON document.

New regression checks cover large Unicode values in both codec directions,
anonymous/account save, cold reopen, canonical export, account replay/pull and
reviewed conflict copies, plus large file metadata through push and catalogue
retention. Wrong owner/record, tampering and provider-default checks remain
negative cases. Source strings are compared exactly; no truncation is allowed.

This is a codec/storage-record correction, not completion of the capacity-policy
row. The 64 MiB aggregate workspace limit, 10,000-record budget and password
pull's 200-page guard still need replacement with actual browser quota handling,
pagination/backpressure and cancellation. Native connected-Chrome acceptance
also remains open: native inspection times out internally despite a 60-second
outer timeout; earlier extension retries failed too. No browser profiles,
permissions or user tabs were changed to work around the failure.


Local validation for this codec checkpoint: workspace suite **635 passed / 70
opt-in skipped**; password suite **54 passed**; focused file sync suite **20
passed** including the later large-metadata case. The 33 focused codec/entry
checks overlap those suites. Production client build and Nitro template sync
passed (249 offline assets); TypeScript remains at 91 baseline diagnostics with
no new signatures. These are local checks, not connected-Chrome, CI or deployed
acceptance. Logs: `tmp/password-capacity-{workspace,passwords,metadata,focused,
build,typecheck,lint}.log`.

A separate opt-in real loopback API check also passed: an independently encrypted
anonymous device value exported to the canonical account save/read path, an exact
write retry, re-encryption back to the device, and anonymous read refusal. The
single newly minted entry was deleted through the normal API; normal protected
receipts/session expiry remain. Device storage in this test is fake IndexedDB,
not browser acceptance. Evidence: `tmp/password-capacity-api-verification.json`.


## Browser-backed workspace capacity — 2026-10-18

Generic IndexedDB admission no longer rejects valid content at 10,000 records,
64 MiB total, 1 MiB ordinary JSON or 16 MiB raw byte records. Storage accounting
and identity fencing remain transactional. Actual `QuotaExceededError` reports
`LOCAL_QUOTA` (507) and rolls back the complete write before retry. Revocation
prefers a non-growing replacement by releasing only clean display caches before
refusal markers; authored work is retained. A physical browser quota failure
still aborts atomically and must not be described as infallible revocation.
Settings now displays accounted usage without an invented capacity percentage.

Local checks: **639 workspace tests passed, 71 opt-in tests skipped**; **four
offline-shell checks passed**. Production client build and Nitro template sync
passed with 249 verified offline assets. Changed-file lint has zero errors and
three existing warnings. Larger-data checks retain over 10,000 records and
64 MiB through cold reopen; a 66 MiB encrypted password file streams back
byte-for-byte with exact metadata. Synthetic quota errors cover rollback/retry,
optional export retention, home/selected transactions, account caches, refusal
cleanup and encrypted conflict copies. These tests use isolated fake IndexedDB;
they do not prove real Chrome storage exhaustion.

Evidence: `tmp/workspace-capacity-{workspace-final,offline,build,lint-final,
typecheck-final}.log`. Native Chrome acceptance is pending after both supported
control methods timed out in the assigned Thingtime window. At that checkpoint, buffered-file/tree adapters, import/preview buffers, password
traversal and catalogue/partition caps remained unfinished. Later Blob and
traversal checkpoints below supersede specific items; the current matrix remains
the completion gate.
No merge, deployment, public exposure or existing-account mutation occurred.

Graph refresh limitation: the local semantic proxy health request timed out
at both 5 and 15 seconds; a read-only PM2 listing also stalled. This checkpoint
uses the structural code refresh fallback. Changed documentation is not claimed
as newly semantically indexed. No shared service was restarted.


## Password and workspace traversal — 2026-10-18

Password reconciliation now follows the canonical 50-entry pages without a total
200-page cutoff. It rejects empty continuing pages, repeated cursors, duplicate
entry identities and invalid metadata. Per-request timeouts, cancellation,
account/origin/data-plane leases and device locking remain in force. Already
validated pages remain available after interruption; retry starts from the
beginning, and only a complete traversal can prune missing entries.

The old revision-pair check did not protect against a newer pull confirming an
unchanged entry: the older pull could still delete it. One account-scoped,
value-free pull token now fences both page retention and final cleanup across
separate database connections. The token persists after success or failure so an
interrupted newer pull cannot reauthorize old cleanup. Superseded pulls return a
normal handoff result so the UI does not schedule an error retry that could
repeatedly interrupt a long traversal in another tab. Local edits and pending
file operations keep their existing revision and review protections. The baseline
transaction is inside the operation cleanup block, preventing a listener leak on
storage failure.

Retained account partition discovery uses a key cursor with an identity check on
every cursor event. It no longer refuses more than 128 partitions. Only matching
account/origin keys are read; content and other identities remain inaccessible.

Local verification: **650 workspace tests passed, 71 opt-in tests skipped** and
**four offline-shell checks passed**. The new regression file covers 205 pages,
unchanged-revision cross-tab races (including failed newer pulls and final-cleanup
interleavings), partial retry, malformed pages, cancellation, locking, identity
retirement and listener cleanup. Partition tests cover 257 scopes, cold reopen,
mid-cursor retirement, full retry and unchanged saved items. Production client
build and Nitro template synchronization passed: **249 verified offline assets,
22,255,931 bytes**. Focused lint: zero errors, one existing storage-constructor
warning. TypeScript matches the previous 91 diagnostics with no new signatures.
Evidence: `tmp/local-traversal-{workspace-final,build-final,lint-final}.log`.

These unit checks use isolated IndexedDB/transport fixtures. The updated global
browser rule now permits task-owned isolated Chrome testing. A separate macOS
sandbox preflight allows the fixture loopback destination and refuses redirects
to an unpermitted canary, direct external IPs and mapped IPv6. The built test
backend has explicit synthetic auth keys, a loopback test database and an inherited
network policy; it refuses direct outbound connections before startup. No personal
profile, cookies or credentials are copied. The plan passed 1440/390/320px scrolling
and overflow checks in isolated Chrome; screenshots and traces are retained in
`tmp/traversal-browser-32d4b1ad-3f2a-487d-a902-74c70da735f0/`.
Remaining buffered adapters, catalogue caps and final native/agent-host checks
are still open. No main merge, deployment, publication or existing-account
mutation was performed. Graph refresh uses structural fallback because the local
semantic proxy health request timed out; changed Markdown is not newly
semantically indexed.


Updated isolated-browser checkpoint: the anonymous native password test passed
against the freshly built loopback server under the network policy. It covers
1440/390/320px layouts, fully offline editing/reload, independent tab unlock,
revision conflicts, normal CSV and 1PUX import/export and exact restored attachment
bytes. There were no account/password API requests, mutations or page errors.
Evidence: `tmp/local-traversal-anonymous-browser-final.log` and the claim's
`anonymous/verification.json`. The initial isolated-server attempt failed because
its shell template referenced old assets; running the canonical
`build:client` → `sync:nitro-template` → `build:server` sequence corrected the
fixture. Asset MIME/content checks now pass. The long-page and partition tests
remain unit-level evidence, not a 10,000-entry real-account acceptance claim.


Credential-source policy update: after the anonymous test completed, the new
global instruction required test authentication credentials to be provisioned or
retrieved through the device Thingtime password manager. The account browser test
was interrupted and is not counted as passed. No supported credential handle or
provisioning interface is currently verified in this task; no real-account
credential or private browser profile was used. The task's isolated browser and
backend are stopped, temporary profile/key material is removed, and account
acceptance remains open. See the claim's `credential-boundary.json` and
`cleanup.json`. Existing unrelated local services and test data are preserved.


## Native Blob file storage — 2026-10-18

Ordinary device attachments now persist immutable `Blob` values in the existing
scoped binary collection. `binary.ts` hashes at most 1 MiB per read, checking
cancellation and the captured workspace lease between chunks. Attachment Things,
portable metadata, ownership and account authorization contracts are unchanged.
Every new binary write has a storage-only revision; post/draft transactions compare
that revision and exact metadata after asynchronous hashing, preventing replacement
between preparation and commit without keeping IndexedDB open across Blob I/O.
Legacy byte-array records remain readable and retain exact comparison semantics.

The normal upload picker, Things file browser, download, local file copy, draft
copy and native media URLs use Blob handles. Local copy no longer inherits the
paired-device 32 MiB/128 MiB buffer limits. Media reads remain limited to three
concurrent jobs and abort on release, refresh or identity retirement, rather than
rejecting a 65th visible reference or more than 64 MiB in visible files. Unsafe
HTML/SVG stays an opaque download. Actual browser quota failures remain atomic;
this does not promise unlimited browser storage or decoding capacity.

The account worker slices the same Blob into the canonical signed multipart
upload plan and hashes each part in chunks. It accepts the service's existing
maximum of 10,000 parts rather than imposing a client-only 100-part cutoff.
Authenticated sync is independent of local completion; anonymous work creates no
account upload intent. Signed requests still omit credentials, refuse redirects
and enforce the current remote lease. This change adds no HTTP endpoint or remote
contract; `readLocalFile({id}, {format:'blob'})` is an in-process facade option.

Local evidence: **659 workspace tests passed, 72 opt-in tests skipped**, plus
**four offline-shell checks**. **17 focused tests** cover exact 70 MiB save/reopen/
retry, two 70 MiB native copies, quota rollback, cancellation, same-size replacement
races, independent template/post bytes, legacy records and 101 exact upload parts.
These totals overlap. Client build, Nitro template sync and Node server build
passed; 249 offline assets total 22,257,777 bytes. Changed-file lint has zero errors
and five existing warnings. TypeScript retains the same 91 baseline diagnostics.
Evidence: `tmp/local-blob-{workspace-final,regression-final,build-final,server-build-final,lint-complete}.log`
and `tmp/local-blob-typecheck-verification.json`.

Historical 18 October result (superseded for anonymous files by the
[19 October native checkpoint](#native-large-file-and-zip-checkpoint--2026-10-19)): native acceptance had not passed. `fileBlobs.browser.test.ts` exercises the real
anonymous UI, offline cold reload, exact download hash, normal file copy and image
preview at 1440/390/320px. The fresh browser/backend fixture passed its OS-level
allowed-loopback, denied redirect, direct-IP and mapped-IPv6 preflight. Chrome then
failed to initialize its renderer/network sandbox inside the inherited macOS
sandbox, in both headful and headless attempts, before reaching Thingtime. No
protections were disabled and no personal browser was used. This run produced no
native UI screenshots. Logs and preflight evidence remain under
`tmp/blob-browser-a4b1ddca-7d92-4f95-b054-a146f5fae903/` and
`tmp/local-blob-browser{,-retry}.log`; task-owned services and temporary database
were cleaned up. Account authentication tests separately require the device
Thingtime password manager's supported credential interface.

Remaining scope: bounded buffered ZIP/import/export adapters, retention of remote
originals, paired-device transfers, folder traversal/catalogue caps and final
native/agent-host acceptance. Existing render/export artifacts are historical
proof, not retested against this checkpoint. The full local-first goal and main
merge gate remain open.

## Blob ZIP import and download assembly — 2026-10-18

Normal transfer file selection now reads the ZIP in 256 KiB source blocks and
feeds the existing inflater in 4 KiB compressed chunks. Its two-pass manifest
and declared-entry validation is shared with the byte-array decoder. Decoded file
chunks become immutable Blobs without joining a whole file into a JavaScript
buffer. Size, SHA-256, missing/undeclared/unsafe paths, decompression expansion and
cancellation checks remain. Blob hashing reuses the same 1 MiB helper as local
storage. The canonical `thingtime.transfer` v1 schema and its existing input budgets
have not changed; this is not a streaming-format or unlimited-transfer claim.

The native Import dialog carries these Blobs through local/account selection and
normal File upload adapters. `LocalThings.import` no longer imposes its additional
16 MiB per-file / 64 MiB aggregate ceiling. Blob I/O and integrity checks finish
before the transaction; metadata, bytes and any account upload intent commit or
roll back together. Anonymous imports create no account queue. Byte-array callers
remain supported with a frozen copy. There are no new HTTP fields or routes.

Normal ZIP Download now assembles Blob output through the existing ZIP library's
streaming writer. It snapshots caller-owned arrays, map membership and metadata
before asynchronous work and checks the in-process availability fence before and
after assembly. The remaining export collector, local/account export readers and
clipboard serialization still buffer files; remote retention, paired-device and
broader traversal/capacity work remain open.

Local verification: 665 workspace checks and four offline-shell checks passed;
72 native opt-in checks skipped. Things suites passed 322 + 18 checks. Seven
focused Blob-transfer tests passed, including a 66 MiB two-file normal-reader
import/reopen with fresh IDs and independent SHA-256, cancellation, retired scope,
corruption, immutable download snapshots, and anonymous/account quota rollback.
Totals overlap; the account queue case was added after the broad suite. Both
byte-array and Blob decoders pass the archive attack regressions. Client build and
Nitro template sync passed (249 offline assets; 22,261,124 bytes). TypeScript
matches the existing 91 diagnostics exactly; targeted lint has no errors and two
existing warnings. Logs: `tmp/blob-transfer-{workspace,things,final-focused,build,lint-final}.log`
and `tmp/blob-transfer-typecheck-verification.json`.

Historical 18 October result: native acceptance of this new path was pending.
The [19 October native checkpoint](#native-large-file-and-zip-checkpoint--2026-10-19)
now verifies the anonymous ZIP flow. The earlier isolated Chrome
run failed to initialize its nested sandbox before reaching the app; no boundary
was broadened and no new browser run is claimed here. The native matrix must cover
normal ZIP selection, confirmation, cold offline reopen, exact download and
failure/cancel states at 1440/390/320px. CI and deployed verification are separate.

## Blob export collection — 2026-10-18

Native file handles now survive `LocalThings.export`, `exportAccountThings`, the
shared `collectTransfer` collector, `bundleFromPlan` and ZIP assembly. Saved
anonymous/account files use `readFileBlob`; authenticated content responses are
collected into immutable Blob parts instead of a joined whole-file byte array.
Metadata, reader identity and mutable input bytes are captured before asynchronous
checks. Anonymous prepared exports retain their workspace and cancellation fence,
including bundles with no files. Account deletion/refusal checks remain in place.
A cancelled stalled response releases its reader without waiting for more data.

The canonical `thingtime.transfer` v1 validator, serializer, dependency traversal,
checksums and wire budgets are unchanged. Normal selected ZIPs and clipboard ZIP
readers return Blob files. Clipboard text and explicitly byte-oriented archive
callers still materialize their final serialized value; native downloads use the
Blob encoder directly. Remote retention, paired-device transport, catalogue and
remaining traversal/capacity work are separate unfinished paths.

Local evidence: 39 focused export checks and 20 collector/stream checks passed
(overlapping coverage); the final anonymous-fence suite passed six checks. The
66 MiB two-file fixture now completes normal ZIP selection, local import, reopen,
export collection, ZIP download assembly and a second normal import with fresh
identities and independent SHA-256 comparisons. Instrumentation refuses Blob
`arrayBuffer` reads above 1 MiB throughout that native-data path. Account export
also keeps scoped Blob handles while its upload intents remain pending. These are
in-process IndexedDB fixtures, not native browser acceptance. Things suites passed
326 + 18 checks. Broader regression, build, lint and typecheck results are retained
in `tmp/blob-export-*.log`; the PR checkpoint records their final outcomes.

Historical 18 October result: the isolated Chrome sandbox-startup blocker was
open. The [19 October native checkpoint](#native-large-file-and-zip-checkpoint--2026-10-19)
now verifies anonymous file/ZIP UI acceptance. Account, clipboard and deployed
coverage in `TESTING.md` remains required.


## Owned originals stream into Blob storage — 2026-10-18

`api.attachment-content` 1.16.0 adds `cache=retain-bytes&download=1` on the
existing content route. It reuses the owned-file descriptor authorization,
including full-user/same-origin, exact owner, durable target, moderation, expiry
and storage-version checks. The server pipes the stored original with
backpressure, cancellation, exact length and the descriptor ETag; its response
is private/no-store. The general media-cache mode keeps its existing policy.
Both manifests and the client requirement change together.

Account retention now carries immutable Blobs through download, chunked SHA-256,
IndexedDB admission, reopen, fresh-descriptor reuse and export. The old 16 MiB
retention-file, 64 MiB draft/post preparation and 200-file client binding caps
are removed. Admission uses the browser's actual capacity and atomically rolls
back parent, metadata, aliases and bytes on quota refusal. Canonical descriptor
rechecks, known access refusals, original upload identities, three-file admission,
per-operation deadlines and post serialization remain. No upload or publication
intent is invented for retained account originals. Caller, local-scope and
remote-scope cancellation wake stalled reads and release the reader even when
producer cleanup stalls. Unsafe integer sizes and incomplete responses fail.

Local verification: **681 workspace tests passed, 72 opt-in tests skipped**, plus
**4 offline-shell checks**; **320 attachment** and **108 capability** checks passed.
A 70 MiB original retains/reopens/exports with independent SHA-256. Post and
private-draft fixtures each retain two 33 MiB originals without whole-file reads;
the post fixture first proves atomic browser-quota rollback. Hash reads are at
most 1 MiB. Production client/template/server builds passed (249 offline assets,
22,258,858 bytes). Changed-file lint has zero errors/warnings; TypeScript retains
the same 91 baseline diagnostics. Logs: `tmp/retention-blob-*.log`.

The built production server exposed both 1.16.0 manifests and rejected an
anonymous owned-original request with 401/no-store. Its one-shot process had no
account session or credentials; macOS sandbox policy denied non-fixture network
and dotenv reads. Redirect/direct-IP/mapped-IPv6 preflight passed. The initial
filesystem-pattern preflight failed before app launch, then was corrected; a
subsequent legacy-manifest request hit a network-blocked default fallback, then
the fixture pinned the existing fallback setting to its own loopback origin.
No production request succeeded. The final listener is closed. Evidence:
`tmp/retention-blob-built-verification.json` and the claim pointer in
`tmp/retention-blob-manifest-claim.json`. This smoke is not authenticated upload,
UI or deployed acceptance.

Native browser acceptance remains pending under the recorded Chrome sandbox
startup blocker. The opt-in truncated-byte fixture now targets the new streaming
mode. Paired-device transports, remaining catalogue/traversal/clipboard limits,
full local-feature acceptance and integration with current main remain open.


## Current-main integration and local password search — 2026-10-18

Integrated main `1756a8e53` (38 commits since the branch's previous base) into the
feature branch. No PR merge, manual deployment, publication or account mutation
was performed. Later main commits still require an explicit integration check.

The resolved PasswordManager refresh keeps its local-vault adapter, workspace
retirement and local-change subscription while adopting complete title search,
query cancellation and distinct empty/error states. Local encrypted titles are
matched before pagination, including matches beyond the first 50 records; a
search never falls back to the account API. Lock, cancellation or retirement
rejects an in-flight scan without returning partial results. The combined
`api.passwords` 1.3.0 contract covers title search and durable attachment
cancellation receipts; file workers and search clients refuse older/breaking
contracts before making dependent requests. No persisted schema changed.

Main's editable media-tools suite, media worker and downloads coexist with the
workspace-specific runtime keys, opaque frame origin/source checks, offline
srcdoc/hash and offline-asset verification. Suite installation negotiates 1.4.0
for media-tools while preserving anonymous local installation and account leases.
Local API configuration failures retain main's fail-closed behavior.

Local verification:

- 684 workspace tests passed, 72 opt-in skipped; four offline-shell checks pass.
  Eighteen focused search/retention transport checks overlap the broader suites.
- 56 password, 110 capability, 168 Web Platform (one opt-in skipped), 21 Vercel
  configuration, 40 root-data, 62 migration and five seed-fixture checks pass.
- Production client/template and Node server builds pass; the offline manifest
  contains 250 assets (22,756,936 bytes). TypeScript has the same 91 baseline
  diagnostics, with no added or removed signatures. Resolved TypeScript files
  have zero lint errors and two pre-existing PasswordManager cleanup warnings.
- The actual Nitro and Vite isolation smoke passes OS direct-IP/redirect denial,
  missing-configuration 503 responses, no cookies and no production access.
- A separate task-owned built-server fixture advertises attachment-content 1.16.0,
  passwords 1.3.0 and suites-install 1.4.0. Both discovery manifests agree;
  anonymous owned-original access returns 401/private/no-store. An ephemeral
  signing key remained only in process memory; no account credentials/session
  were used. Dotenv reads and non-fixture network were denied. The fixture on
  `http://localhost:22497` is stopped; no listener remains. Tailscale/Funnel is
  unavailable because the installed wrapper points to a missing executable.

The installed `~/Applications/Thingtime.app/Contents/Resources/agent-browser.mjs`
path is absent. No browser-manager claim or permissive fallback was launched.
The prior isolated Chrome sandbox startup failure and supported password-manager
credential interface remain separate acceptance blockers. Current native
search/media/layout, final renderer artifacts, importer and host connection checks
remain open; earlier PNGs are historical. Current CI/deployment evidence is
recorded on PR #1000, separately from these local checks.

## Anonymous and offline mail boundary — 2026-10-18

The incoming-mail audit found two unnecessary dependencies: the Mail and Email
settings screens rejected anonymous users, and opening the reader always loaded
cloud mail before local operations could finish. Both screens now select the
root-bound workspace. Anonymous settings, proxy views and retained messages use
the existing encrypted mail store with a distinct anonymous key. A local save
never upgrades that content to an account record. A verified account can refresh
cloud mail in the background without holding device edits; a stale background
refresh is discarded if local work has begun or committed.

Account mail remains home-plane data, scoped by the selected API origin and
owner. Ordinary same-origin account keys remain compatible. A desktop shell's
legacy origin-only cache is not automatically adopted under a different API
origin: there is no evidence identifying its original server. Revisit that
server with the normal authenticated sync path; do not guess or copy credentials.

All mail API clients, including Gmail controls, now require the matching,
remotely confirmed account before capability discovery or a cookie-bearing
request. Anonymous cloud/Gmail/relay choices are unavailable and refused by the
operation path. Explicit direct native sync and the fixed, paired loopback
connector remain separate provider connections; reading or saving local settings
does not contact a mailbox. Existing server authentication, origin checks,
provider TLS/DNS policy, sanitization and rate limits are unchanged.

Workspace leases fence encrypted reads and writes through crypto completion and
IndexedDB commit. Invalidation aborts the active transaction and request; older
work cannot return plaintext to a retired view or commit to a previous workspace.
Encryption/decryption runs in batches of sixteen records, without limiting the
number of records. The silent 2,000-message retention truncation and thirty-local-
draft ceiling were removed. Browser quota failures remain atomic. Provider page,
message-body and canonical form limits still need the separate streaming review.

Local evidence: `test:mail` **40 passed**, `test:settings` **39 passed**; real
synthetic TLS IMAP/POP3 and connector boundary suites passed. Tests cover 2,001
retained messages, anonymous/account/origin separation, stale writes, no network
before authority, and retirement during encryption, decryption, transaction and
remote completion. TypeScript still reports the same **91 baseline diagnostics**;
changed-file lint has no errors or warnings. See the ignored `tmp/mail-*.log`
files for raw evidence. This is code/storage/transport evidence, not native UI
acceptance or provider-account verification.

Native mail acceptance remains open: 1440/390/320px settings and reader, proxy
editing, cross-tab changes, cold offline reload, explicit connector/native sync,
and account/origin transitions. The installed browser-manager CLI is now present,
but app control timed out after inventory recovery and exact-path reacquisition;
its displayed private socket and registered task policy are still needed. No
claim was taken and no permissive browser was launched. Account cloud-settings
queues, broader mail lifecycle/capacity and actual Gmail/provider acceptance also
remain open. The target agent-host artifact connection remains a separate gate.

## Independent mail-settings saves — 2026-10-18

Cloud-backed mail accounts and proxy inboxes previously waited for the server
before committing device edits or removals. They now use the existing encrypted
mail store first, with separate per-record sync rows and remote comparison tokens.
Unsent edits can coalesce. Once sent, the exact request/writeId remains frozen
until acknowledgement, even while later local edits finish independently. Durable
claims prevent competing workers; lost responses, reloads and expired claims retry
that same request. Canonical response validation and conditional server writes are
unchanged. No new endpoint, schema envelope, Mongo collection or credential source.

Both normal Mail surfaces show pending/refused settings. Account refresh preserves
pending edits/deletions and rejects older snapshots after a receipt. Explicit
conflict adoption is bound to the reviewed local intent; an uncertain request
cannot be discarded. Gmail operations read the separate server revision and refuse
unresolved settings; the queue never runs mailbox actions or sends messages.
Anonymous workspaces never queue account writes or adopt account credentials.

Local validation: **52 mail tests passed** (12 new queue/race cases), **39 Settings
tests passed**, changed-file lint clean, client/offline build passed (250 verified
assets), and TypeScript matches the existing **91 baseline diagnostics**. Tests use
real WebCrypto and fake IndexedDB with a synthetic transport; they do not prove a
live authenticated API round trip. No production/provider account was modified.
Native 1440/390/320px editing, conflict controls, offline reopen/reconnect and real
API acceptance remain open with the installed browser-manager socket/policy gate.
The original target agent-host artifact connection remains separately unverified.

## Account theme device History — 2026-10-18

Dedicated account theme mutations now commit the approved `theme-content`
before/after projection with the content and its separate sync intent. They use
the existing normalized Timeline event/link/index rows, device branch and client
identity. Imports, folder moves, library titles and deletes pass through the same
writer. Deleting an unsent theme cancels content sync while retaining its History.
History stores private client drafts, never fabricated server receipts. Its
existing queue and canonical version exporter work independently of content sync.

Generic protected writes remain refused. Account refresh, selection and remote
acknowledgements do not author edits. Equivalent saves do not add a version.
Storage failure rolls back content, active selection, sync intent and History;
account/origin/data-plane partitions and retired workspace leases still apply.

Home History now includes authored home-workspace rows even while a custom
database is selected. The normal account facade exports those versions locally
under the current selected-account lease; switching identity, origin or database
retires existing readers and exports. This grants no remote-sync authority or
access to another account or an unselected custom partition. A regression test
failed before this wiring fix and now passes without making an HTTP request.

Local checks cover exact visibility/tokens/title/folder snapshots, deleted-version
export, reload, cache eviction, independent synthetic History acknowledgements,
remote refresh and failure rollback. The 19 October native checkpoint above now
verifies account edits, export and independent real sync in both directions. Native
import/move/title/delete and custom-plane acceptance, plus protected theme
restore/undo/merge, remain open. This
increment adds no HTTP endpoint or remote contract and does not change theme
catalogue capacity; the broader capacity audit remains outstanding.

Character coordination was checked read-only in the assigned Chrome profile on
18 October: the live production manifest lacks `api.auth-characters`; the existing
Thingtime Agents subspace is private. No Character or coordination post was
created. Native controls now read the installed Thingtime window after an earlier
`noWindowsAvailable` error. Its Settings and native menus do not expose the task
Browser controls needed to obtain the manager socket and saved task policy. The
shipped CLI is present and requires that socket. No account settings or network
protections were changed, and no permissive test fallback was launched.

Local verification: **690 workspace tests and 4 offline-shell checks passed**
(**72 opt-in browser/API checks skipped**); **258 Timeline tests passed**. Changed
TypeScript lint has zero errors and one existing constructor warning. The client,
platform, embed, draft and offline build passed with 250 verified assets
(22,769,952 bytes). TypeScript retains exactly the same 91 baseline diagnostics.
These automated checks do not establish native UI or real account-sync acceptance.


## Device theme and algorithm catalogue capacity — 2026-10-18

The dedicated local writers, canonical imports, account-cache hydration,
reviewed conflict copies and selected-plane theme migration no longer impose
100-theme or 50-algorithm device limits. Existing records and selection survive
reopening. These operations keep canonical validation, fresh import/copy IDs,
private defaults, protected-kind dispatch, account scopes and transaction fences.
A browser `QuotaExceededError` still returns `LOCAL_QUOTA` / 507 and rolls back
content, selection, queued intent and usage accounting atomically; a retry can
complete when storage becomes available.

This change concerns device admission. The existing remote catalogue parsers
and server capacity contracts remain unchanged. A server refusal is still a
separate sync result and does not revoke a completed local save. Remote
pagination/capacity, observation/training buffers, and native large-catalogue
acceptance remain open in the full capability matrix. No HTTP feature or
capability version changes in this increment.


## Character and main integration — 2026-10-18

Integrated main through `bf9ae4d7` into the feature work while retaining device
workspaces, independent post/draft completion and local suite installation.
The root-loader identity owns the local partition; a composer Character is
server-verified delegation. Delegated reads, writes and drafts capture the root
workspace lease before asynchronous work, refuse offline/unconfirmed authority,
and discard results after identity/database changes. They never queue content
as the root owner. Owner comments still save locally when the selector matches
the owner. Shared/delegated media cannot borrow a viewer’s local bytes.

The merged manifest retains the branch’s higher versions for local sync/export
contracts and the incoming Characters, browser-task, comment and device
contracts. No new endpoint or permission is introduced by this reconciliation.
Full delegated Character offline workspaces are still required before the broad
local-first goal can be considered complete.

Local verification: 698 workspace tests and four offline-shell checks pass
(72 opt-in native/API tests skipped); the capability/draft batch passes 158
tests with nine opt-in skips, and the Character suite passes 13 tests. The
new delegation regression covers offline owner replies, no root-queue pollution,
exact Character/actor/plane headers and stale-result cancellation. Changed-file
lint has no errors or warnings. The client/platform/library/embed/draft/offline
build passes with 253 verified assets (22,829,053 bytes). Typecheck has the same
91 normalized diagnostics as the preceding checkpoint; it is not clean.

Current-head native verification and individual nested Builder block editing
remain open. Browser control recovered, and the browser-setup task released its
claims. The installed window now contains another task’s OAuth flow; it is
preserved. The previously negotiated socket is currently unavailable. No test
claim or permissive fallback was launched. Private Character coordination is
initialized; no public publication or production deployment is claimed.


## Personal Lopu instructions on the device — 2026-10-19

Settings → Lopu now saves the personal checklist in the existing scoped workspace
transaction store without sign-in. Disabled rows and line breaks retain the
canonical `{id,text,enabled}` shape. Account preferences are pinned to the account's
home partition, while each operation remains bound to the current root identity.
A different account, origin or anonymous workspace cannot read those instructions.
Anonymous content never gains an account queue on login.

Local completion does not await a server request. A separate confirmed-account
worker reads the normal private endpoint and conditionally writes frozen attempts.
A lost reply is reconciled against canonical server content; a newer device edit
remains queued. Unseen non-empty account settings and conflicting revisions require
an explicit comparison and version choice. Cross-tab stale saves preserve the
unsaved editor text and offer a reload. Background reads cannot silently advance
the draft's base revision. No Actions or inference execute during settings sync.

The capability is now `api.settings-lopu-prompt` 1.1.0. Personal per-row, count and
aggregate text caps are removed from the shared validator and editor. The existing
96 KiB HTTP request boundary remains: a larger device checklist stays saved and
shows account sync failure, rather than being truncated. A resumable larger-account
transport remains unfinished; this is not an unlimited remote-save claim. Admin
base-prompt editing, authentication, same-origin checks and rate limiting retain
the existing API path.

Focused service tests cover anonymous reopen, independent saves during held writes,
concurrent claims, immutable retries, lost replies, account/origin separation,
stale choices and retired identities. Transport tests require a compatible origin
manifest and fresh root confirmation before every request. Native account-editor
reconnect and conflict-review acceptance remain open; disposable API acceptance
alone does not prove the signed-in UI path.

Native local acceptance passed on the production build in the task-owned full-app
container (image `03f26a42ac463de2a5b8d60072fa97e40e479a23fbb08fe384a3615e54dc39f5`).
A fresh Chrome context saved without a session, reloaded fully offline, retained
disabled rows and recovered a competing tab edit without overwriting unsaved text.
The normal disposable temporary-account API saved 35 rows, including a 2,100-char
entry; exact readback matched. Anonymous writes returned 401, stale revisions 409,
and non-admin base edits 403. No account-instruction requests occurred during the
anonymous UI checks. All three viewport widths stayed within bounds with zero
page errors. Browser and backend shared the verified `network=none` namespace,
with no host mounts or published ports. Evidence and PNGs are under ignored
`tmp/lopu-instructions-browser/artifacts/`. This is local verification, not CI or
deployed verification. The first browser run stalled while controlling a background
tab; explicit tab activation corrected the runner without changing app security.

Workspace regression: **707 passed, 73 opt-in skipped**, plus **4 offline-shell
checks**. Focused contract/settings checks: **122 passed**. Changed-file lint and
client/server builds pass; **91 TypeScript diagnostics** match the unchanged
baseline exactly. The client includes 253 verified assets (22,838,459 bytes).

Graph refresh note: the semantic pass requested 176 chunks across 66 stale files;
it was stopped after confirming that backlog. Prior semantic data is preserved,
and the structural graph and portable outputs are refreshed for this checkpoint.
Documentation semantic freshness is not claimed.


## Native anonymous Mail and initial instruction retries — 2026-10-19

The real Email settings and Mail pages now have opt-in acceptance checks in
`remix/app/mail/anonymous.browser.test.ts`. Two fresh anonymous browser contexts
exercise paused account creation, invalid-hostname feedback, offline edits and
reload, confirmed cache removal, 52 saved messages, pagination/search, exact body
text, missing-field and partial/attachment notices, and inert HTML. Proxy inboxes
are created, edited, reopened and removed through the UI. A competing-tab write
cannot replace unsaved editor text. No provider credential is entered; the reader
source is explicitly synthetic canonical data written through the existing
encrypted mail store. This proves saved-mail behavior, not provider delivery.

Both scenarios passed against the production build in task-owned Chromium,
including 1440×1000, 390×844 and 320×844 scrolling and bounds. There were zero page
errors, account-mail/temporary-account/connector/tracker requests, credentials or
account settings writes. The browser and backend share `network=none`, no host
mounts/ports, a read-only root and the unchanged 2 GiB limit. The immutable app
image is `98e4b7025e253bde5e4e23742ebb9420760d6e9e04f43dcab95cab1c584f373e`.
Evidence: `tmp/mail-native-browser/verified/verification-settings.json`,
`verification-reader.json`, PNGs and `resources.json`; the latter records zero
OOM/limit events. Earlier combined runs exhausted the test runtime; they are
failures, not acceptance evidence. Separate clean scenarios release browser
history between checks and preserve the real two-tab conflict test. The runner
also waits for local save completion before reload and opens disclosures after
mail readiness with native keyboard input.

The personal-instruction worker now retries an initial failed account read even
when there is no pending device edit, and retries a claim held by another tab.
Successful idle reads stop polling; explicit conflicts wait for review, and
anonymous settings never call transport. Three regressions exercise the real
service and timer pump. Workspace tests: 710 passed, 73 opt-in skipped, plus four
offline-shell checks. Mail tests: 52 passed, two native opt-ins skipped in the
ordinary suite and then run explicitly above. Client/template/server builds and
changed-file lint pass. All 91 TypeScript diagnostics match the existing baseline.

Provider/connector delivery, popup settings, workspace transitions and full-account
queue/reconnect acceptance remain open. The target ChatGPT host still lacks a
verified connected artifact tool; local stdio MCP proof remains distinct. These
results are local, not CI or deployed acceptance, and do not complete the broader
goal or authorize its main merge.

Graph maintenance: a 90-second semantic update reached only part of its 177-chunk
backlog. Existing semantic evidence is retained; the structural update and portable
outputs are refreshed. Current documentation semantic coverage is not claimed.


### Editable Builder checkpoint — 2026-10-19

Main's editable element/collection/condition blocks now retain offline-first saves. The local validator handles device writes; account transmission negotiates `api.things` 1.35 or newer before sending those definitions. The combined server contract is 1.36.0. An absent remote manifest cannot block the local commit. Anonymous API creation also defers Timeline database acquisition until an actual History operation, preserving native recovery when IndexedDB is unavailable.

A fresh isolated full-app browser verified individual nested title/button/icon/repeated-row edits, CSS, reorder, duplicate/delete, two offline reloads and dependency-complete canonical export. Actual inspector/page captures at 1440/390/320px, full scrolling, no overflow, zero page errors/account requests, and container cleanup are recorded in `tmp/builder-main-integration/verified/`. The opt-in `editableBlocks.browser.test.ts` requires its `TT_BLOCKS_TEST_*` origin/session/fixture/artifact settings and explicit Chromium/Puppeteer paths inside the verified isolated manager runtime; it checks runtime health and capability identity before use. Bundle its adjacent fixture for the browser and the test for Node. Do not point it at a personal account or permissive backend.

This completes a representative individual-block checkpoint. Global/site editors are verified in the next checkpoint; remaining dedicated consumers, account sync/reconnect and installed-app/agent-host acceptance remain open. The separate stateless draft-export surface still rejects Actions, external assets and interactive block types.


### Native global/site Builder and local media — 2026-10-19

Global/site canvases now expose the existing individual-block selector. Builder file uploads take their content owner from `useWorkspaceUser`, so anonymous/offline selections reach the existing device attachment adapter. Remote authentication remains unchanged. Selected text retains its native rendering while the rich-editor chunk loads. The border-style control fits at 320px and the site inspector reuses the existing toolbar clearance so Save/Reset can scroll above floating buttons.

The fresh full-app Chromium test passes offline global/site creation, normal file-picker upload, exact PNG-byte retention across cold reload, canonical page/file export, native route composition, another tab's saved update and resetting only the site override. Inspector and native page captures at 1440×1000, 390×844 and 320×844 include full scrolling; no horizontal overflow, page errors or account Things/drafts/attachments/temporary-account requests were recorded. Evidence: `tmp/site-builder-native/verified/`; immutable image `sha256:9ee77ac0ed2015c926604108b6ec28555cb7c52b39308c55aa5fb6fa63b4e0ea`.

The real browser-manager fixture keeps network=none, no host mounts/ports, read-only root, one CPU and a disposable backend. This two-browser harness exceeded its default 2 GiB memory allocation, invalidating those attempts. The test host now accepts an explicit bounded 512–4096 MiB optional sixth argument, retaining its 2048 MiB default. The passing run used 4096 MiB with normal Chromium settings, zero OOM events, and verified claim/container cleanup. This is local fixture acceptance, not installed-app or production acceptance.

Run the opt-in `siteBuilder.browser.test.ts` with its adjacent browser fixture, `TT_SITE_TEST_ORIGIN`, `TT_SITE_TEST_SESSION`, `TT_SITE_TEST_FIXTURE`, `TT_SITE_TEST_ARTIFACTS`, `TT_SITE_PUPPETEER` and `TT_SITE_CHROME` inside the verified isolated runtime. The test checks the runtime session and Things capability before work. Never point it at a personal account or permissive backend.

Validation: 710 workspace tests plus four offline-shell checks; 75 workspace opt-ins skipped in the ordinary suite and the new native test run explicitly. Webpage tests 166 pass/5 skip; attachment checks 321 plus 11 pass; browser-manager tests two pass. Client/template/server builds pass with 252 verified assets; changed-file lint has no errors. Typecheck retains its 91 baseline diagnostics. Remaining dedicated editors, account sync/reconnect, protected operations and the connected agent-host artifact path are still open.


### Offline Agent Tasks search — 2026-10-19

Agent Tasks can now read the tasks, todos and progress records it creates locally. Its saved browser Actions use the existing structured-search grammar with explicit `scope: "mine"`, rather than requiring `$viewer.username`. The closed Action host searches only its leased workspace snapshot, never performs HTTP, binds cursors to workspace/filter identity, and retains cancellation and response budgets. Public, other-author and ranked/free-text searches remain outside this adapter. Account reads explicitly report `incomplete: true`; editable template text explains that other records may be available online. Account partial-result notices have unit coverage; signed-in native acceptance remains open.

The same optional scope is available on GET/POST `/api/v1/things/search` under `api.things-search` 1.4.0. The server injects the authenticated actor's owner predicate alongside existing ACL, app, PAT and subspace fences. Anonymous `mine` requests return 401, invalid scopes return 400, and omitted/`visible` scope preserves existing behavior. Both generated manifests and the saved Actions negotiate the additive contract. No new route, persistence format or credentials are introduced.

Fresh full-app Chromium acceptance passes normal gallery installation while offline, task creation/listing, independent todo/progress records, completion, cold offline reload and canonical export at 1440×1000, 390×844 and 320×844. Top-to-bottom scrolling and native screenshots show no horizontal overflow; no page errors or account Things/drafts/Actions/temporary-account requests occur in the anonymous browser. Separate disposable temporary API identities inside the same isolated namespace prove GET/POST owner filtering, unchanged visible search, forced-anonymous refusal, invalid-scope refusal and the built server manifest. Evidence: `tmp/action-search-native/native/`; image `sha256:0e667455f16e3f5c72209267356c17e335438d89cd561a1bca6daf53a4bd7415`. Network=none, read-only root, no host mounts/ports, CPU=1, memory=4 GiB, zero OOM events and claim/container cleanup are verified. Earlier fixture failures are preserved: one used the wrong response ID field; two typed before installation navigation completed. They are not passing acceptance evidence.

The opt-in `actionSearch.browser.test.ts` uses its adjacent read-only browser fixture. Set `TT_ACTION_SEARCH_ORIGIN`, `TT_ACTION_SEARCH_SESSION`, `TT_ACTION_SEARCH_ARTIFACTS`, `TT_ACTION_SEARCH_FIXTURE`, `TT_ACTION_SEARCH_PUPPETEER` and `TT_ACTION_SEARCH_CHROME` only inside a verified isolated browser-manager runtime. It refuses a mismatched runtime health/session. Bundle the fixture as browser IIFE `actionSearchFixture` and the test as Node ESM. Do not use a personal profile or production backend.

Validation: 714 workspace tests pass, 76 opt-ins skipped in the ordinary run; four offline-shell tests pass. The new native scenario is run explicitly. Focused Action tests include 22-task pagination, child isolation, canonical exported Action re-import with fresh IDs, cross-account separation, unsupported meanings, cancellation and byte budgets. Capability checks, client/template/server builds and changed-file lint pass. TypeScript still reports the same 91 diagnostics outside changed files. This checkpoint does not establish full data-relationship transfer, signed-in reconnect/queue UI, installed-app acceptance, CI or current-head deployed behavior. The broader goal and target-host downloadable-artifact connection remain open.

## Retained Character callback isolation — 2026-10-19

The session-wide Character already selects its own root workspace. A composer's
**Post as** remains server-authorized delegation, with recovery kept apart from
the root-owner queue. That delegated offline workspace is still unfinished.

The audit found a separate stale-callback problem: a retained delegated API or
explicit-Character submit callback could resolve the currently active root when
invoked after an account switch. `characterApi` and `createCharacterRequest` now
capture the originating local lease at callback construction. They refuse before
HTTP after account, database or identity-generation changes; each invocation
still requires current remote confirmation, and an in-flight response retires
when that confirmation is lost. The synchronous Timeline capability predicates
remain false. No local Character partition, credential or server permission is
introduced by this correction.

Verification: 715 workspace tests and four offline-shell checks passed, plus the
new real `useAsyncFetcher` callback regression. Four focused checks passed on the
final source. Reintroducing dynamic request-time binding made the real-hook test
fail before restoring the fix. Changed-file lint is clean. TypeScript reports
91 diagnostics, identical normalized signatures to the prior checkpoint, none
in changed files. Client and packaged Node builds pass with 252 offline assets;
the canonical `sync:nitro-template` step is required between them. Native
Character delegation and full offline Character acceptance remain separate gates.

The packaged app also passes a clean, no-login native regression: save a draft,
save the local post and cold-reload its permalink offline at 1440×1000, 390×844
and 320×844. Full-page scrolling shows no horizontal overflow; no page errors or
mutation requests occur, and the server returns 404 for the local post. Evidence:
`tmp/character-callback-native/native/verification.json` and PNGs. The claimed
runtime uses network-none, a read-only root, no host mounts/ports, one CPU and
4 GiB; it reports no OOM and is released. This proves the anonymous path only,
not native Character delegation. Initial harness assertions were corrected to
follow canonical `auth/me` user-null, the observed **Save on this device** label
and automatic navigation to the local permalink; their evidence is retained.

## Character History partitions — 2026-10-19

`TimelineScope` now carries an optional device-only `delegatedBy` discriminator.
Direct-account keys retain their existing bytes; delegated event caches, branch
commands, notes and version-name queues use the principal as well as actor,
origin and data plane. Portable events, links, receipts and remote requests keep
the canonical schema. No credentials or remote permissions come from this key.

`accountTimelineScope` and the browser store use that discriminator; a foreign
principal/origin/plane or retired root lease is refused. A direct-account History
provider cannot reopen a delegated cached scope. Existing authored versions can
rekey inside their already-proven principal/actor workspace, preserving IDs,
content, ancestry and receipts. The shared cache has no provable old principal
and is deliberately not adopted. No account content or production data changed.

Four focused tests cover cold IndexedDB reopen, all command queues, direct-login
and two-principal separation, existing-version continuation and stale readers.
727 workspace tests plus four offline-shell checks and 258 Timeline tests pass;
78 native opt-ins remain skipped in the workspace command. Client/server builds
and lint pass; TypeScript retains 91 unchanged baseline diagnostics. Native
account History regression passes separately. Full delegated offline
posting/attachments and the Character History UI remain open; this is a storage
prerequisite, not completion of that feature.

Native ordinary-account History acceptance also passes at 1440/390/320px: names and notes save offline, cold reload, verified reconnect, canonical acknowledgements, separate note removal and three delayed retries refused with 409. No offline writes or page errors; the network-none runtime was released with zero OOM. Evidence: `tmp/character-history-native/native/verification.json` and PNGs. The fixture uses a separate normal browser sign-in for server audit while the editor is disconnected; no cookie/token extraction. Earlier APIRequestContext 401s and a full-Docker image build are retained as fixture/setup failures, not product failures.

Structural Graphify refresh and targeted Characters/auth-map semantic extraction (26 nodes, 28 edges) completed. Full documentation semantic freshness is not claimed.


## Character content workspace integration — 2026-10-19

Delegated `useApi` now reuses the canonical account worker with a principal,
Character, origin and data-plane partition. Drafts, files and authored Things
share that worker; their independent queues preserve normal post completion.
Local completion navigates to a reloadable Character permalink. The route
resolves only the current principal's retained roster, and guest/unknown actors
show an explicit unavailable state. No link or retained label grants a session.

History uses the same partition and can open device-authored versions before
remote folder discovery. Empty discovery metadata is not persisted as a folder
ID. Shared home/selected connections accept the later canonical folder while
refusing conflicting known folders. Late Action receipts retain their original
principal. Duplicate offline notices and repeated navigation-sized gaps in the
Character sync stack are removed.

Native validation exposed a connectivity race: profile requests checked account
confirmation but could send after capability discovery completed offline.
The shared remote-operation guard now checks connectivity as well as identity,
including immediately before transport. `profileConnectivity.test.ts` covers
both direct/delegated theme and algorithm requests, offline entry, loss during
discovery and normal resumption. This does not change server permissions or API
contracts.

Validation and remaining acceptance are recorded in the HTML progress plan.
Full Character library discovery, nested-link context, quick-comment actor
selection and the broader local-first matrix remain separate open work.

Validation: 730 workspace checks plus four offline-shell checks pass (79 opt-ins skipped); the new native Character post/file/History fixture ran explicitly and passes at 1440/390/320 CSS pixels. It independently verifies exact remote attachment bytes, private author/ACL, guest and principal-only denial, cold offline reload, zero offline writes and post completion during three forced draft-save 503 responses. The task runtime used network:none, no mounts or exposed ports, disposable credentials/data and a read-only root; it was released after capture. Client/server builds and changed-file lint pass. Timeline has 259 passes; TypeScript retains the same 91 baseline diagnostics. See `tmp/character-local-native/native/verification.json` through the HTML progress plan. These are local checks, not deployed acceptance.


## Linked galleries and direct URL drafts — 23 October 2026

Anonymous and account post/comment galleries now retain canonical URL metadata
without fetching or claiming the linked bytes. Mixed ZIP import/export preserves
annotations, gallery order and embedded media references; importing or copying
assigns independent local IDs. Gallery targets are posts/comments only, and an
embedded reference must include its owning post in the export. Generic protected
attachment writes remain refused.

The ordinary Attach-by-URL composer now commits an expiring local selection.
Working drafts, templates and recovery copies use the existing draft protocol;
URL copies receive fresh identities without Blob allocation. Only working drafts
can donate their media to posts. Anonymous operations make no account requests.
Account selections wait for a draft or post binding before registration. The
existing account-files journal negotiates link 1.1.0, validates the owner-derived
receipt ID and exact immutable URL metadata, and waits for receipts before writing
the parent. Lost replies replay the same request; removal uses delete 1.8.0 with
request identity, owning target and current version. Neither import nor sync
fetches the external URL. The normal visible media preview may render that URL.

Bound stored-file and URL annotations share the existing metadata queue with
owner, target and immutable-content validation plus conditional writes. Previously
registered URL posts and drafts can refresh through their retained identities
without a byte request. A first-seen server-only link has no device registration
identity, so its editable retention still uses the canonical online transfer
path rather than inventing a deletion receipt. Other managed media are separate.

[Focused evidence](../artifacts/anonymous-local-first-2026-10-23/linked-media/README.md)
records 85 import/file tests and 48 direct-draft/API tests, all passing with zero
skips; the runs overlap. It includes lost registration/deletion replies, reorder,
newer metadata edits, refusal, quota rollback, expired selections and identity/
abort races. Four native mixed-import and direct-composer scenarios are prepared
in linkedGallery.browser.test.ts; final-package native evidence remains pending.

### 25 October capacity and cleanup acceptance

The normal instruction editor preserves a 119,104-byte paragraph locally across an offline cold reload, keeps account content unchanged, sends no repeated request during a measured 65,008 ms interval, and resumes synchronization after a shorter edit. The existing 96 KiB account transport limit is unchanged. The first 390 px capture clipped one line behind the fixed header; the corrected all-lines-visible test still needs its final run. An earlier 12,000-line textarea case became unresponsive and remains an unverified performance limit. See the current [evidence boundaries](../artifacts/anonymous-local-first-2026-10-25/README.md).

The real CLI agent retrieved native JSON/PNG artifacts. Its abrupt shutdown exposed missing Docker cleanup; a detached, ownership-checked guardian and independent runtime timeout now pass five focused regressions. Actual lifecycle acceptance is pending recovery of the dedicated Docker data disk (20 GiB, zero free bytes). No unrelated resources were pruned.

### 26 October — hard-line Settings and normal Action Run acceptance

Normal Settings now preserves 12,002 hard lines (120,068 UTF-8 bytes after editing), including native clipboard paste, undo/redo, subsequent typing, local save and exact offline cold reload. The local run measured paste at 1,549 ms and save at 368 ms; no repeated account instruction request occurred over 64,213 ms. Repeated saves now update that editor's active success toast instead of stacking notifications over mobile guidance. All nine guidance hit-points pass at 1440/390/320px. The earlier 12,000-line failure was reproduced in Chromium's CDP insertion path; actual paste succeeds. The existing 96 KiB account transport boundary still needs larger transport.

The saved profile Action now runs through the normal Action page's **Run action** button offline, with zero API requests during execution and retained theme/algorithm changes and history after reload. The fixture performs setup/readback only. Cold shell reloads still emit read-only request events, separately recorded; no offline mutation request occurs. Shared Copy retains its independent 17,825,795-byte original, fresh dependencies and individually editable heading. [Current native evidence and retained failure boundaries](../artifacts/anonymous-local-first-2026-10-26-followup-final/README.md).


## Account instruction transport audit — 26 October 2026

The 96 KiB preflight remains an explicit incomplete remote capability; the
12,002-line native save/reload test proves local retention only. Simply raising
the request limit would move the failure into other canonical boundaries:

- `api/utils/auth/users.ts` reads and atomically replaces the complete private
  checklist inside user secure metadata. The BSON document constraint remains.
- `timeline/accountContent.ts` bounds an account snapshot to 1 MiB and 6,000
  nodes. Moving live content requires an accompanying backup/history adapter.
- `api/utils/timeline/snapshotParts.ts` and `backups/portableBackup.ts` offer
  verified immutable-part patterns, but their current contracts are snapshot
  transports, not a live resumable account-instruction store.
- The existing settings rate limit must remain effective. Upload progress must
  resume across bounded passes instead of sending an unbounded burst.

Next implementation gates (not delivered by this audit):

1. Reuse the frozen local attempt identity for resumable, owner-scoped part
   admission, status and integrity checking, with bounded per-request work.
2. Commit a protected manifest using canonical accounted-Thing transactions and
   revision CAS; meter retained bytes and clean abandoned staging transactionally.
3. Preserve legacy inline reads, lost-response reconciliation, newer local edits,
   reviewed conflicts, origin/data-plane identity and private projections.
4. Add paged canonical backup/restore inventory and update inference consumers
   before enabling the new storage contract. Respect real provider context limits.
5. Register/version the complete API and client requirements; prove resume,
   corruption, cancellation, revocation, quota rollback and exact large-content
   readback in an isolated synthetic account through the normal Settings UI.

No transport/storage/API change was made during this audit. No capability is
advertised early, and the existing safe local retention behavior remains intact.

## Resumable account instructions — 26 October 2026

The implementation now replaces the transport-only audit gates above with a
versioned, owner-fenced account instruction store. The selected origin negotiates
`api.settings-lopu-prompt` 2.0.0 before synchronization. A frozen attempt and
content hash resume immutable 48 KiB parts through bounded batches of at most 64;
the request remains capped at 96 KiB. The server keeps only a compact account
revision/reference in the user record, stores private content as accounted exact
BinData, and commits through transactional compare-and-swap. Staging expires
after seven inactive days and cleanup processes at most 64 parts per pass;
committed generations remain available for recovery. Each pass rechecks origin,
owner, Character and data-plane identity. Retries are immutable, cross-tab claims
renew, and a lost commit acknowledgement reconciles against the committed hash.
Terminal abort retires only its matching attempt, preserving newer edits and
requiring snapshot conflict review.

Canonical account-content backup now emits sealed, version-2 instruction refs
and exact parts alongside editable recovery content, including source removal
when the input exceeds the prior 1 MiB snapshot boundary; version 1 remains
readable. No aggregate product-size cap was added. Existing ordinary-reference
inference uses a bounded 96 KiB compatibility working set. Larger enabled
inference is explicitly unsupported until actual provider capacity and tokenizer
limits are verified. Offline recovery now shares one sealed inventory traversal
and reads each selected instruction payload once. Metadata scales with actual
instruction inventory and decoded content with the selected generation, rather
than an untrusted declared part count. Object integrity, owner checks and complete
chain validation remain mandatory. This does not add a live-account restore API:
restore remains offline-only.

Focused core, manifest, inference-surface, retention/inference, canonical-storage,
and sanitized client/Nitro checks are recorded in the [instruction-transfer
artifact](../artifacts/anonymous-local-first-2026-10-26-instruction-transfer/README.md).
The inference metering correction counts canonical row metadata once across
fragments and handles escaped UTF-8 text and split surrogate pairs; its boundary
suite passes 9/9 and the final server rebuild passes. Raw typecheck reports 91
diagnostics against an 89-diagnostic ratchet baseline and is not clean.

The isolated packaged-app acceptance attempt is a failure, not installed macOS
acceptance: normal Settings offline save/cold reload, real multipart lost-ack
reconciliation, and both explicit device/account conflict choices passed, then
the 12,000-line paste/undo step timed out after five seconds waiting for the
`Instruction 1` textarea during `Control+V`. The attempt recorded no browser
errors or offline writes, but captured no screenshot and could not read the page
body. See the retained [failure record](../artifacts/anonymous-local-first-2026-10-26-instruction-transfer/instructions/failure.json).
The same-page diagnostic recheck completed the exact 12,002-line paste in 9,114 ms, exceeding the strict under-five-second requirement. The renderer responded afterward, with no OOM, JavaScript errors or offline writes; cleanup was verified. High host contention was observed during subsequent diagnosis, so the performance cause remains unresolved. The final packaged app predates the separately tested 15-second newer-edit scheduling correction. No installed macOS acceptance is established. Keep the native gate
unchecked; this failure does not establish installed macOS acceptance. No
production, new-head CI, or desktop namespace acceptance is claimed here.


The final matched-control diagnostic produced no timing result; terminal cleanup was verified. Its severe host-contention snapshot does not identify an editor root cause. The 14-pass scheduling regression is a local source test only; the final built package predates that change and full acceptance remains open.

### Native instruction follow-up — 26 October 2026

A fresh sanitized client/Nitro rebuild includes the newer-edit scheduling fix.
The isolated packaged-app run again passed offline save/cold reload, multipart
lost-reply reconciliation and both reviewed conflict choices. Exact native paste
preserved 12,002 lines but took 6,665 ms, failing the unchanged five-second gate.
Renderer task time was 6.687 s, with 0.625 s layout and 0.0425 s JavaScript.
Network isolation, no-OOM checks and owned-runtime cleanup passed.
[Evidence](../artifacts/anonymous-local-first-2026-10-26-instruction-followup/README.md).
The prior paragraph's older-build limitation is superseded by this fresh build;
the performance failure, larger enabled inference and installed-app acceptance
remain open. Added event/frame diagnostics are awaiting native execution.


## Streamed account catalogues — 26 October 2026

The normal theme and algorithm transports now negotiate `api.themes-sync`
1.7.0 and `api.algorithms-sync` 1.5.0 before requesting `operation: catalogue`
on their existing same-origin authenticated POST routes. Anonymous workspaces
never call them. Character and selected-database checks, rate limits and private
response headers remain in place. Home storage is explicit even when themes
are observed from a selected custom database.

The response uses version-1 NDJSON start/entry/end frames. Each entry is split
into 24 KiB chunks; the frame ceiling is 40 KiB. These are processing bounds,
not total catalogue limits. The producer merges modern and legacy rows in
ID order with modern precedence, using 64-entry pages from one pinned Mongo
snapshot. Identity, count, byte total, SHA-256 transcript and clean EOF must all
validate. Snapshot expiry, revocation, stalled consumption or any malformed
frame fails the observation; no newer snapshot is spliced into it.

The client stages one validated entry at a time in the exact account/origin/
selected-database/delegated-actor workspace. Cursor pages avoid full-library
`getAll` reads during streamed admission. The last complete catalogue stays
visible until one native IndexedDB transaction checks the read ticket, local
mutation epoch, current identity lease and cancellation signal, then admits
the new catalogue. Pending changes and dependent Things retain their existing
conflict rules. Conflict review retains only its requested entry from the
complete stream.

Staging is provisional and never joins an upload queue. Successful admission
clears it atomically; failures clean their own rows while the original identity
lease remains valid. A retired lease leaves cleanup to the next authorized
read. Metadata expires after 24 hours of inactivity; expired or superseded
staging is reclaimed on that read. There is no background cleanup service or
public artifact store. A platform quota failure rolls back admission and keeps
the previous catalogue.

Verification is recorded in the [catalogue checkpoint](../artifacts/anonymous-local-first-2026-10-26-catalogue/README.md).
This checkpoint removes the total-count/8 MiB restriction from the new read
path. Remote creation limits, larger individual write/transfer contracts,
live concurrent snapshot/legacy checks and the full native product journey
remain separate work; this is not a claim that all capacity limits are removed.


## Owned profile creation and paged lists — 26 October 2026

`api.themes` 1.3.0 and `api.algorithms` 1.2.0 add `GET ?page=1` with
an optional opaque `cursor`. Responses keep their existing arrays and add
`nextCursor`, null only at live exhaustion. Algorithms retain `activeAlgorithmId`.
Each request inspects bounded windows of 64 records with cancellation and
five-second database query deadlines. Modern records supersede legacy twins.
A page can be empty while its cursor advances; continue until null. Theme order
is `updatedAt` descending then ID ascending; algorithm order is `createdAt`
ascending then ID ascending. These are live observations, not a complete
snapshot for deletion reconciliation. The existing catalogue stream remains
that complete-copy path. Unpaged GET retains its legacy 100/50 response window.

Canonical creation, including branching, imports and conditional sync, no
longer rejects an account because it has 100 themes or 50 algorithms. Real byte
quota admission, transaction rollback, permissions, canonical validation and
exact retry receipts remain intact. New saves negotiate themes-sync 1.8.0 or
algorithms-sync 1.6.0; protected profile imports negotiate things-import 1.14.0.
Ordinary clients drain pages and reject partial tails, repeated cursors, changed
active selection or account/database changes. Account and anonymous retained
catalogue adapters keep their existing paths.

Theme pagination deliberately uses 1.3.0 because `main` already shipped focus
tokens in 1.2.0. This branch carries that canonical token codec and introduces
`theme-content` v2 only when those fields are present; historical v1 payloads
keep their exact projection. Timeline 1.23.0 negotiates the new history format.

See [capacity evidence](../artifacts/anonymous-local-first-2026-10-26-capacity/README.md).
Larger individual write/transfer envelopes, live concurrent snapshot/legacy
acceptance, full native product journeys and deployed gateway support remain
separate work. Existing security and transport limits are not removed.

The capacity follow-up also preserves historical frozen write commands. Parsing
retains absence of the five new focus fields, so an unchanged pre-upgrade
command keeps its exact receipt digest through client and server. Explicit
focus additions still change the digest. No receipt is rewritten and no
alternate-digest fallback is accepted.


### Local Blob archive capacity — 27 October 2026

Portable transfer metadata now validates safe integer file sizes and aggregate
arithmetic separately from a consumer's byte budget. Normal local Blob collection,
export plans and selected-file ZIP decoding no longer reject a valid transfer
solely for exceeding 512 MiB. Processing buffers and manifest, entry-count, path,
exact-size and checksum validation remain bounded. The encoder checks each real
ZIP32 size and offset before reading files; exports requiring ZIP64 are refused
explicitly until an encoder supporting that format is available.

Buffered byte/clipboard paths and existing account import/export contracts retain
their explicit budgets. Account storage admission, atomic import, permissions and
upload verification are unchanged. The anonymous native renderer retains its
separate 256 KiB / 32-Thing limits and refuses files, external assets and Actions.
This is a local archive codec improvement, not a larger remote import contract.

See [transfer capacity evidence](../artifacts/anonymous-local-first-2026-10-27-transfer-capacity/README.md)
for real-byte, memory-retention, negative-path and current verification results.
Normal Builder/device/account acceptance and other traversal/transport envelopes
remain separate checklist items.
