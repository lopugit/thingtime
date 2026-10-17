# PR #1000 — Anonymous and offline local workspaces

Branch: `codex/anonymous-local-first`. PR: https://github.com/lopugit/thingtime/pull/1000

## Delivery boundary

This is an active implementation checkpoint, not completion of the full local-first
goal. Do not merge until the [coverage matrix](../docs/local-workspaces.md) is
complete. It builds on main and includes the separate posting independence fix
in [PR #999](https://github.com/lopugit/thingtime/pull/999).

## Implemented behavior

Anonymous editors use an isolated browser workspace instead of automatically
creating a temporary account. Owned account Things save atomically with their
sync queue, retain immutable ambiguous retries, and require reviewed conflict
resolution. Offline account startup restores only content identity; remote
requests require a fresh real account/data-plane confirmation. Login does not
adopt anonymous data. Existing authentication and media authorization remain.

Builder resolves native local pages/components, retains unsaved editor state
across reconnect, lists saved device content even without a cached server page,
and refreshes that partial library after account confirmation. Cached rows remain
visible during background refresh. The offline shell contains verified static
assets only, never API responses or private media.

## Local verification — 2026-10-16

- Workspace/offline-shell, root-data, webpage, autosave and draft suites:
  297 passed, four opt-in skips. Additional Things suites: 315 passed;
  media-cache suite: six passed.
- Final client build passed with 230 verified offline assets (10,774,315 bytes).
- Raw TypeScript: 91 diagnostics, exactly matching an independent check of the
  unchanged parent branch. The non-blocking ratchet warns against its stored
  baseline of 89. No baseline was relaxed.
- Real production-build browser acceptance used an isolated local origin and
  disposable replica fixture. Verified anonymous create/edit/reload, account
  outage recovery and conflict review, fully offline account cold startup,
  native edit/save/reload, no mutation while root confirmation was blocked,
  reconnect sync, unsaved state preservation, and offline library layout at
  1440×1000 and 390×844. Earlier sync/conflict checks also covered 320px.
  Browser network/viewport overrides were restored and the fixture logged out.
- Local screenshots: `tmp/draft-qa/account-offline-library-desktop.png`,
  `account-offline-library-390.png`, and `account-library-reconnected.png`.
  These ignored artifacts are local evidence, not a deployed verification.

Graphify structural and semantic refresh completed using the local proxy:
436,858 input / 16,443 output tokens, with 30 files re-extracted. It reported
legacy semantic-cache provenance, duplicate-node and dropped-hyperedge warnings;
the graph remains usable but is not warning-free. The new workspace document
and implementation files were confirmed in both graph and manifest.
The subsequent refresh for this PR note and changelog link was refused by the
semantic shrink guard (changelog 22 to 20 nodes). The existing semantic graph
was preserved and a structural update was run; the latest documentation's
semantic freshness is therefore unverified.

CI and preview verification are separate from these local results. No production
merge, deployment or existing-account content mutation was performed.

## Remaining work

The matrix remains authoritative: local attachment lifecycle, Actions and app
suites, canonical Timeline integration, schema/component catalogs, local social
authoring, themes/algorithms, encrypted vault support, locally capable native
and automation surfaces, account delete/move/import and dedicated adapters,
online cache refresh/pagination, and cross-tab/account-switch acceptance.
The current transfer adapter also needs explicit handling of referenced media
before its export can be considered complete for attachment-bearing content.


## Anonymous themes and retirement recovery checkpoint — 2026-10-16

- Anonymous Theme Studio has dedicated local save/apply/delete and canonical
  import/export, reusing the account token sanitizer and protected-kind boundary.
  Imports receive fresh IDs, remain local and do not change the active selection.
- Production-build browser acceptance passed no-login save/reload, offline cold
  startup/edit/save/reload, normal JSON download/import, apply/delete and responsive
  1440/390/320px checks. Save/delete network observations contained no mutations.
  JSON was independently checked by `validateTransfer`; local evidence is in
  `tmp/draft-qa/anonymous-theme-export.json` and the anonymous-themes-offline PNGs.
- Authoritative root rejection retires existing local/remote leases; repeated
  rejection does not broadcast another invalidation while already pending.
  IndexedDB blocked/error/timeout/close failures permit retry and discard late
  upgrade/success callbacks.
- Incorporated the repository review bot's public profile/waitlist fix. Public
  profile/activity/search and theme gallery reads use the credential-free public
  reader, and callbacks from a retired anonymous facade fail before networking.
- Account theme synchronization, local history and algorithms remain incomplete;
  this checkpoint does not change the full rollout's merge boundary.

The checkpoint's workspace/offline-shell, root, Things and theme tests passed
408 checks. The client build passed with 230 verified offline assets; raw
TypeScript exactly matched the 91-diagnostic parent baseline. Graphify structural
and semantic extraction completed for 31 changed files (439,374 input / 21,826
output tokens), retaining warnings about legacy cache provenance and duplicate
nodes. Public gallery empty-state wording now distinguishes device saves from
account publishing.

Web CI build/unit and API suites passed on prior pushed revision `2e6ea34db`.
The PR preview root and Nitro health now return the real application and ready
API; that read-only check is not acceptance of the unpushed theme changes.

## Anonymous algorithms checkpoint — 2026-10-16

- Reused canonical profile parsing, name/emoji normalization, training and ranking
  for device-only algorithms. Dedicated writers enforce the 50-profile limit,
  stale-update conflicts and atomic quota rollback. Exports omit authority and
  lineage; imports preserve profile content with fresh IDs and unchanged active
  selection. Remote shared-profile branching continues to require an account.
- Normal Settings and feed UI now expose local creation, selection, branching,
  renaming and transfer. The feed states that ranking is per available public
  page; no global ranking or account algorithm sync is claimed.
- All engagement flushes use the workspace facade, replacing direct beacons.
  Identity invalidation clears pending/session events and suppresses stale
  completion notifications. Built-in sorts do not train; failures are visible.
- Local production-build browser: logged-out create/select, offline cold reload,
  rename/branch/download/import/re-export/delete, and 1440/390/320px checks passed.
  A synthetic browser public-feed response exercised the native card observer
  and local training without publishing content. Observed operations sent no
  server mutations. Export validation passed, learned profile content matched
  exactly after UI round-trip, and the imported Thing had a fresh ID.
- Evidence: `tmp/draft-qa/anonymous-algorithm-trained-export.json`,
  `anonymous-algorithm-roundtrip.json`, and `anonymous-algorithms-offline-*.png`.
  All four disposable profiles were deleted; browser overrides restored/tab closed.
- Focused suites: 48 workspace/offline-shell, 78 feed and 315 Things checks
  passed. Raw TypeScript retained the exact 91-diagnostic independent parent
  baseline. The client build passed with 230 verified offline assets.

Full cross-tab/account-switch browser coverage, account algorithms sync and
remaining matrix rows are still required before rollout merge. CI/deployment
verification must be tied to the eventual pushed commit, not these local checks.

## Anonymous attachment transfer checkpoint — 2026-10-16

- Added scoped binary storage sharing one atomic transaction and quota ledger
  with JSON metadata: 16 MiB/file, 1 MiB/JSON record, 64 MiB/workspace.
- Reused canonical file/recording metadata, archive validation/checksums,
  dependency collection and composition-media remapping. Normal Things ZIP
  import/export/copy/delete now works locally without an upload stage or HTTP
  byte fallback. Account import rejects local byte maps before networking.
- Missing/corrupt bytes and quota failures cannot produce partial imports or
  exports. Copies retain independent bytes after original deletion. Generic
  mutations cannot write protected attachments. Non-recursive folder deletion
  still refuses standalone child files; target-bound attachments cascade.
- Local production-build browser: no account, disabled network, normal ZIP
  import/export, offline cold reload, actual-download reimport, original deletion
  and independent-copy re-export passed. Canonical decoding/serialization and
  SHA-256 verified exact 82-byte content and fresh IDs in both browser downloads.
  Import at 390px and export at 320px fit without horizontal overflow. Disposable
  files and browser overrides were cleaned up; task tab closed.
- Evidence: `tmp/local-attachments/browser-export.zip`, `browser-roundtrip.zip`,
  corresponding JSON manifests and `offline-import-390.png`.
- Local validation: 54 workspace/offline-shell and 315 Things checks passed;
  client build passed with 231 verified assets (11,022,887 bytes). Raw TypeScript
  exactly matched the independent parent baseline of 91 diagnostics.

This is the file-transfer/storage checkpoint, not complete attachment support.
Normal uploads, media URL rendering, draft copies, linked galleries and account
sync remain required, alongside the broader coverage matrix, before merge.
CI and deployed verification must be tied to the eventual pushed commit.

Review integration retains the bot's orphaned-sync quarantine and non-negative
usage cleanup in the shared JSON/binary deletion helper. Focused workspace tests,
typecheck baseline comparison and client build are rerun on the integrated tree;
the graph's structural snapshot is refreshed after the merge.


## Anonymous normal file UI checkpoint — 2026-10-16

Normal file-picker save/download, folders, copy/cut/paste and native image previews
now use the scoped browser bytes. Atomic checksum/idempotency checks, empty files,
bounded object URLs, cancellation and identity retirement preserve isolation.
Local media pages reuse the native Thing renderer; unsupported device-only comments
report a clear error. Stable workspace API callback identities also fix the
repeated-fetch/React update-depth failure found by native preview acceptance.

Local production-build browser, logged out and network disabled: saved PNG/text/
empty files, downloaded exact text and PNG bytes, copied and moved an independent
file, and cold-reloaded its native preview. 1440/390/320px layouts had no horizontal
overflow. Removed only the disposable files/folders and restored browser overrides.
Evidence: `tmp/local-file-ui/` (downloads and native-preview PNGs).

Validation: 62 workspace/offline, 295 attachment, 315 Things and 48 component tests
passed; webpages/shared media passed 152 with four existing skips. Client build:
231 verified assets, 11,032,140 bytes. Raw TypeScript: the same 91 parent-baseline
diagnostics, no added signatures. CI/preview status must be checked against the
pushed revision. Composer uploads, local comments/annotations, draft/gallery
copies, account byte sync and the complete coverage matrix still block merge.


## Anonymous native composer checkpoint — 2026-10-16

Native post/file selection, create/edit, comments/replies and template reuse now
work in the anonymous scoped workspace. Post commit remains independent of draft
save. Media binding/copies/quota are atomic; draft retirement cannot remove
committed post bytes. Templates retain independent media after original deletion.
Restored edit tiles now use local object URLs, and local post reads restore saved
relational comments. Local labels never link to an unrelated account profile.

No-session production-build browser with networking disabled verified upload,
autosave, post edit/cold reload, comment/reply reload, template copy independence
and cleanup at 1440/390/320px. Evidence: `tmp/local-composer-ui/`. Checks: 68 local
workspace/offline, 26 drafts, 78 feed, 56 hooks, 295 attachments; client build
231 assets/11,047,709 bytes. Raw tsc matches 91 baseline diagnostics with no added
signatures. Canonical post/file round-trip remaps IDs and preserves exact bytes.

Still not merge-ready: linked media/annotations, local saves/reactions/polls,
account byte/post synchronization and the full feature matrix remain. Local
verification is not CI or deployed acceptance; report those against the exact SHA.

The normal offline import/export dialogs also passed an image-post ZIP with the
actual 14,451-byte PNG. Its browser download validated canonically and round-tripped
through the isolated normal importer with fresh IDs and identical bytes. The
validator receives verified attachment context; imported comment files retain
comment purpose. Evidence: `tmp/local-composer-ui/browser-image-post.zip`,
`browser-image-post.json` and `roundtrip-verification.json`.


## Anonymous native interactions checkpoint — 2026-10-16

Native emoji reactions, Saved and polls now work on local content through scoped
relational child Things and shared validators/tallies. Up/down votes use the same
adapter. Generic writes/imports cannot forge these managed slots; content export
omits them and deleting the target cascades them. Saved is in the logged-out
navigation, uses full workspace cache keys and retires old-scope reads. Account
and remote-post authority remain unchanged; account interaction sync is pending.

Local no-session/offline browser verified poll creation, cast/change/removal,
reaction addition/removal, bookmarking, Saved navigation, cold reload, unsave and
fixture deletion. 1440/390/320px layouts have no horizontal overflow. The complete
recorded interaction interval had no mutation requests (background public-read
attempts remained). Screenshots and metadata: `tmp/local-interactions-ui/`.

Validation: 73 workspace/offline, 78 feed, 56 hooks, 17 navigation and 315 Things
checks pass (539 total). Targeted lint has no errors and six warnings. Client build
passes with 231 verified assets / 11,053,377 bytes. Raw tsc matches the existing
91-diagnostic baseline exactly, with no added signatures. This is local evidence,
not a deployed/full-suite completion claim. The coverage matrix still gates merge.


## Anonymous Actions checkpoint — 2026-10-16

- Extracted the existing data interpreter behind storage/service ports. Server
  ACL, Vault, Timeline and notification wrappers remain in place; the anonymous
  host has only local storage, shared pure packs and bounded interpreter access.
- Native Action create/edit/run, cold offline reload, input/JSON validation,
  execution errors, protected run details and canonical export/import work
  without an account. Full workspace identity scopes the list and inspector.
  Shared definition editing uses local drafts without requiring account History.
- Local schema-scoped CRUD, nested/each budgets, deterministic keys, missing-input
  equality predicates, history retention/cascade, identity retirement, concurrency
  and zero-network facade behavior are covered by automated tests. Details-save
  failure preserves the completed result and never reruns its effects.
- Local verification: 678 passing automated checks plus the live disposable
  server Action suite 100/100; one opt-in integration skip. Raw TypeScript remains
  the exact 91-diagnostic baseline. Lint has zero errors and two existing warnings.
- Native browser evidence: `tmp/local-actions-ui/verification.json`,
  `action.transfer.json`, `offline-action-1440.png`, `offline-action-390.png`,
  `offline-action-320.png` and `offline-action-error-320.png`. Normal import remapped
  the Action ID and preserved behavior; both disposable copies were removed.
  Initial create/run capture is complete with zero mutation requests; the longer
  edit/import capture was truncated, although the browser was offline throughout.
- Still required: browser request adapters, local suite installation, automatic
  component/collection sources, canonical local Timeline and account execution/
  sync. Generic Thing-page local Action comments/owner menus also remain incomplete.
  This checkpoint does not satisfy the full-suite merge gate.


## Anonymous page sources checkpoint — 2026-10-16

The native page runtime now allows local workspace sources without asserting a
signed-in viewer. Components and Collections reuse the local Action API, refresh
after controls and preserve inert preview behavior. Source caches and local forms
are isolated by complete workspace scope; shared-root runs remain separately
server-authorized and uncached.

Normal Transfer import, native page render, offline control update, Component +
Collection refresh and cold offline reload passed locally with no account session.
1440/390/320px checks found no horizontal overflow; the complete captured interval
had zero mutation requests. Evidence lives in `tmp/local-sources-ui/`.
445 automated checks plus the real-browser source lifecycle regression passed;
changed-file lint is clean, raw tsc remains exactly 91 baseline diagnostics and
the client build contains 237 verified assets. Dedicated Component surfaces,
browser request adapters, local suite installation, Timeline and account execution/
sync still require work; the full-suite merge gate remains unmet.


## Bundled suites and browser requests checkpoint — 2026-10-16

The existing server installation plan is now shared with a transactional local
adapter. All bundled suites install without login; repeat/concurrent installs,
canonical normalization, sample preservation and only-missing edit preservation
are covered. Existing server authority remains in its adapter. Account install
requests are pinned to actor/data plane and cancelled on identity retirement.

The browser interpreter has a closed local request host for supported Things
CRUD and data-Action execution. It never fetches or forwards unknown operations;
normal validators, quotas, cancellation and byte/runtime budgets remain. Protected
kind deletion is refused alongside protected create/update.

Clean offline browser acceptance installed Web Standards, edited/saved a native
button Component and cold-reloaded its exact input, with no network mutations.
Normal Transfer exported eight Things; isolated canonical import remapped every
ID, ran the catalogue Action and preserved the saved input. Page-only re-export
collected its six referenced records. 1440/390/320px checks show no overflow.
Evidence is retained locally under `tmp/local-suites-ui/`; eight disposable
manual fixture Things were deleted while preserving the pre-existing page.

Local checks: 456 passing ordinary tests, two explicit browser tests, seven
opt-in skips; the real server app-suite regression passes 53/53. Changed-file lint
has no errors and one existing constructor warning. Raw TypeScript remains the
91-diagnostic baseline; production build has 243 verified offline assets.

At this checkpoint, the isolated Web Platform iframe could not cold-load offline
through the app service worker (resolved in the following checkpoint). The browser check asserts its explicit failure while editing and
saving succeed; the real runtime renders correctly after reconnection. Existing
sandbox/CSP were retained, and Vite preview now serves the canonical isolated
headers. Local Component comments, remaining request adapters and account suite
sync are still unfinished. The full matrix in `docs/local-workspaces.md` remains
the merge gate. No merge, manual deployment or production account mutation.


## Offline native Web Platform checkpoint — 2026-10-16

The same compiled Web Platform interpreter now reaches an opaque sandbox as a
build-produced srcdoc. The application and child CSP authorize only its exact
script hash; caller programs remain validated data in the existing message
protocol. Existing network/resource/worker/form restrictions and iframe sandbox
remain. Full workspace identity retires the frame. Embed and inert draft bundles
retain their standalone URL. Missing build output reports the recovery command,
and deployment verification checks runtime/CSP hash agreement.

Clean production-CSP browser acceptance passes install/edit/run/save/cold offline
reload, with a real HTMLButtonElement result and zero network mutations. Offline
workers, native form events, authored failure reporting and Stop pass. After
reconnection, parent/cookie/storage reads, arbitrary inline scripts and same-origin
fetch remain blocked; no probe request escapes. Manual desktop/390/320 views have
no horizontal overflow. Normal JSON download validates and round-trips through
normal isolated import with a new ID and exact editable input. Disposable manual
fixtures were removed, preserving the pre-existing page. Evidence is retained in
`tmp/offline-platform-ui/`, including native PNGs and canonical transfer JSON.

Component comments, remaining browser adapters, account execution/sync and the
full local-first matrix remain open. No merge, manual deployment or production
account mutation was performed for this checkpoint.

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


## Generic Thing discussion checkpoint — 2026-10-16

Fixed the anonymous Component/Action/Data comments-read error by supplying the
normal discussion companion through the existing local API adapter. Replies
remain paginated relational Things. Anonymous public discussion reads preserve
projection/key/cursor without credentials. Owner rename works through local
workspace ownership, without a remote capability lookup; cloud History and
recording handoff keep real-account authentication.

Local checks: 536 automated passes, two opt-in skips, and one separately enabled
clean production-browser pass. Native import, comment/reply, rename, cold offline
reload and search completed with zero mutations sent to the network. Desktop,
390px and 320px screenshots/bounds are in `tmp/local-details-ui/`. Changed-file
lint has no errors, the client build passed, and raw TypeScript matches the same
91 pre-existing diagnostics. No merge or manual deployment. The full matrix,
including account discussion sync and local Timeline, remains the merge gate.


## Library search checkpoint — 2026-10-16

- Anonymous library search now covers authored content across local folders with
  bounded literal matching, kind filters and 50-row cursor pages. Account search
  returns scoped cached content first, refreshes only its owner and retains
  independent server/pending continuations. Errors preserve rows with Retry;
  abort, account and data-plane changes retire old responses.
- Corrected the earlier checkbox diagnosis: visible label clicks select normally;
  the earlier automation targeted Chakra's hidden input. Added descriptive labels
  and real mouse regression in grid/list at desktop, 390px and 320px.
- Preserved review commit `5edad32ca` (local-file annotation) and repaired its
  missing typed remote test stub. No cloud or anonymous account authority changed.
- Local validation: 463 workspace/offline-shell, Things and hooks passes, four
  opt-in skips, plus two explicit clean production-browser passes. Anonymous import,
  61-row search, kind filter, rename, cold reload and error handling made zero
  mutation/search requests. Account synthetic private search survived 503 and cold
  offline reload; final fixture content was removed through normal API cleanup.
- An earlier failed cleanup run left two synthetic records in its own disposable
  local fixture account; no existing account/public content was changed. The
  existing offline remote-computer refresh toast remains outside this search scope.
- Client build: 245 verified offline assets / 21,148,320 bytes. Changed-file lint
  has no errors; raw TypeScript retains 91 baseline diagnostics. Evidence is in
  `tmp/local-search-ui/`. Advanced/public search, dedicated account adapters,
  Timeline, native tools and other matrix rows still prevent merge. These checks
  are local; they do not establish deployed behavior or full rollout completion.


## Canonical anonymous Timeline checkpoint — 2026-10-16

- Ordinary local content and canonical event/link history commit atomically.
  Shared snapshot projection and recorded component definitions are reused;
  captures survive live edits and page deletion. Bounded header-first paging
  checks stored metadata against canonical events. Local receipts never sync.
- The normal History browser and inert native page preview work logged out and
  offline. Transports retain their creating API facade across identity changes;
  unsupported local commands fail explicitly rather than falling into account
  routes. Local status labels never claim account synchronization.
- Local evidence: 652 unit/contract passes, five opt-in skips, and one explicit
  clean production-browser pass. Import, rename, cold reload and recorded preview
  make zero mutation/Timeline requests, with zero page errors. 1440/390/320px
  layouts have no horizontal overflow. In-app Browser manually confirmed native
  History and its phone drawer. Artifacts: `tmp/local-timeline-ui/`.
- Changed-file lint: zero errors, three constructor warnings. Raw TypeScript: the
  same 91 diagnostic identities. Production client build passes. CI/deployment
  evidence is separate. No merge or manual deployment was performed.
- Timeline remains partial: real protected folder/storage controls, branches,
  notes/names, restore/merge, version export, related history, protected-kind
  adapters, all editor draft lifecycles and account local-first synchronization
  are still required. The full acceptance matrix is unchanged as the merge gate.


## Canonical local History owner notes — 2026-10-16

The Message tab now uses the anonymous local Timeline adapter for canonical
owner notes. Saves/removals remain device-only. Separate relational records,
shared validation, atomic eight-note limits, scoped leases and content-free
removal markers protect concurrent tabs and uncertain retries. Page budgets
include multibyte note text. Definitive refusals retain Retry/Dismiss controls
without turning healthy History into a connection failure. No account adapter,
authentication requirement or Lopu provider credential is bypassed.

Verification: 105 workspace/offline-shell + 238 shared Timeline tests passed;
five opt-in skips, with the affected browser test explicitly enabled and passing.
The clean anonymous production-browser fixture verifies offline note save,
reload, removal, ninth-note refusal/dismissal and native recorded page previews
at 1440/390/320px. Zero mutation requests, account Timeline calls and page errors.
Manual in-app Browser confirmation also passed. Evidence:
`tmp/local-timeline-notes-ui/`. Build: 245 verified assets / 21,159,536 bytes.
Changed-file lint: zero errors / one constructor warning. Raw TypeScript:
91 pre-existing diagnostics, identical diagnostic identities to the prior check.
This is local verification; CI and deployed behavior are separate. Version names,
branches, restore/merge, protected histories, account sync and the full remaining
coverage matrix still block completion and merge.


## Canonical local version names — 2026-10-16

The normal Versions tab now names, renames and clears anonymous saved versions
offline. The server and browser share `timeline/versionNameMutation.ts`;
canonical records, stable command hashes, exact retry receipts, monotonic
revisions across clears and immutable effect events stay consistent. Local
name/effect/link/metadata writes are atomic and scoped. The mounted editor keeps
an uncertain command identity for retry. This does not yet provide durable
account offline name synchronization or process-loss recovery.

Verification: 110 workspace/offline-shell + 238 shared Timeline tests passed,
five opt-in skips, plus the explicitly enabled clean offline browser test and
the real local server version integration. Offline naming/rename/reload/clear,
notes, native preview and 1440/390/320px checks observed no mutation requests,
account Timeline calls or page errors. Manual in-app Browser verification passed.
Artifacts: `tmp/local-version-names-ui/`; server log:
`tmp/local-version-names-server.log`. The integration harness previously sent
one operation ID and validated against another; it now uses one command and
cleans its created Things in `finally`. The initial failed attempt predating
that cleanup left two synthetic private Things in the disposable fixture DB.
The final passing attempt cleaned its Things; no existing account data changed.

Build: 245 verified assets / 21,163,888 bytes. Application lint: zero errors,
one constructor warning. The `.mts` integration script lint uses the explicit
TypeScript parser. TypeScript: the same 91 pre-existing diagnostic identities.
Local evidence is separate from CI/deployed verification. Branches, restore,
historical export, protected history, account sync and the full matrix remain
unfinished; this checkpoint does not authorize merge.


## Canonical local variations — 2026-10-16

History and the native Builder now create, checkout and edit anonymous named
variations offline. Shared branch planning and ancestry/materialization helpers
retain account semantics; protected server writers and authorization remain.
Canonical branch/head records, immutable effects and stable creation indices
commit atomically in the anonymous namespace. Exact retry receipts, stale-head
CAS, divergence refusal, quota rollback and retired/foreign scope checks pass.
Checkout uses recorded content/components, with live data and Actions paused.
The current Thing remains unchanged. UI copy accurately describes device saves.

Verification: 116 workspace/offline-shell + 238 shared Timeline tests, three
focused Builder tests, five ordinary opt-in skips. Explicit production browser
acceptance passes offline creation, field edits, native Builder save/reload,
recorded component preview and 1440/390/320px without HTTP mutations, account
Timeline calls, page errors or document overflow. Manual in-app Browser checks
confirm saved/reopened edits. Evidence: `tmp/local-branches-ui/`.
The new real API branch integration passed create/replay/CAS/ancestry/checkout,
stale-head refusal and anonymous 401s against the disposable loopback replica.
It cleans its own Thing in `finally`; the new test account and immutable audit
history remain only in that fixture DB. Existing account data was untouched.

Build: 245 verified assets / 21,173,785 bytes. Application lint: zero errors,
one existing constructor warning; integration script lint uses the TypeScript
parser. Raw TypeScript retains 91 baseline diagnostics. CI/deployed validation
is separate. Restore, merge, historical export, protected histories, account
sync and the rest of the full coverage matrix remain unfinished; do not merge.


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


### 2026-10-16: historical version archive export

`LocalTimeline.exportVersion` now binds the existing archive contract to one
readonly anonymous transaction. The account resolver moved to shared
`timeline/exportVersion.ts`; server auth, scope, rate limits and response format
remain in place. Compact ancestry and deleted before-images resolve from recorded
history, never the live Thing. Names and notes are read consistently; invalid,
missing, unsupported, cancelled and oversized exports fail without mutation.
The version editor aborts export on unmount and checks before starting download.

History archives have dependency references and are distinct from portable
`thingtime.transfer` bundles. A meaningful normal-writer round-trip restores the
old page with independent recorded component copies, exports it with normal Thing
transfer and imports into a separate test workspace with remapped IDs. Original
component text survives and the shared live component stays unchanged.

Validation: six local export tests; 378 workspace/Timeline passes total (five
opt-in browser cases skipped in the ordinary suite; the History browser case was
run explicitly and passed). Clean logged-out production-shell browser downloaded
and parsed the real archive offline, then passed the existing native History
restore/merge/reload checks at 1440/390/320px with no account Timeline HTTP,
mutations, page errors or overflow. Manual in-app Browser export downloaded a
2,874-byte fixture archive with the expected old name, note and content. Evidence:
`tmp/local-history-export-ui/`. The guarded real API version suite passed on the
disposable replica, including export privacy and burst rate limits; only synthetic
fixture accounts/Things were used, with created Things cleaned up.

Build: 245 verified assets / 21,200,676 bytes. TypeScript retains exactly the same
91 baseline errors. Targeted lint: zero errors, one existing constructor warning.
These are local results; CI and deployed behavior need separate evidence.
Related/protected History, Timeline folder/storage controls, account sync and the
full local-first matrix remain incomplete. The audit also found that restored
component IDs use `restored-` while several local detail/discussion/Action routing
adapters still check only `local-`; follow up before claiming complete restored
component editing across every surface. Do not merge this checkpoint.


## 2026-10-16 — restored component detail/discussion/Action routing

Fixed the previously recorded `restored-` gap. Anonymous Thing and discussion
reads resolve scoped local records or retained local History heads before public
fallback. Deleted local copies stay local-not-found; unknown public restored IDs
retain credential-free reads. The read lease is checked after asynchronous
routing so an account switch retires the original operation.

Generic detail pages and the shared Thing menu use workspace content identity
and compare the resolved author before owner actions. Post/comment controls use
a matching local author projection rather than the ID prefix. Local browser
Actions and interactions accept the canonical restored identity only after
resolving its target through scoped storage; supported-kind checks, private
account partitions and no-network operation remain intact.

Four new regression tests perform a normal recorded restore, cover local read,
comment, reaction, save, rename, delete and Action GET/PATCH/DELETE, preserve the
original shared component, reject account-only targets, keep public reads public,
and reject identity changes during routing. Workspace/offline-shell: 144 passed
(five opt-in skips); Timeline: 238; feed: 78. The clean production-shell History
browser additionally passed in 30.1 seconds, including restored detail/comments/
nested reply/rename/cold reload at 1440/390/320px, zero overflow, account Timeline
requests, HTTP mutations, restored-ID public reads or page errors. The ordinary
local-detail offline browser regression also passed. Evidence is in
`tmp/local-restored-routing-ui/` and `tmp/local-restored-routing-details/`.

Manual in-app Browser verification used only an existing disposable local test
copy: native text, comment/reply, Rename and reload passed, with 390px bounds and
screenshot evidence. Browser overrides were reset and both task tabs closed.
An earlier browser run hit the boot recovery screen during offline navigation;
it did not reproduce on the completed-build runs. Subsequent runs exposed the
actual PostCard and shared-menu prefix gates, which are fixed and covered by the
passing final flow. The startup failure's cause is not established.

Final build: 245 verified offline assets / 21,201,007 bytes. TypeScript retains
the same 91 baseline diagnostics. Targeted lint has no errors and two existing
constructor warnings. These are local results, separate from CI or deployment.
Related/protected History, Timeline folder/storage controls, account sync and the
full local-first matrix remain incomplete. Do not merge this checkpoint.

## 2026-10-16 — anonymous Page + related History

The local Timeline adapter now resolves related page composition from the
anonymous partition using canonical reference traversal and component selection.
Stored defaults/args and each authored instance are included; Action/data/schema
references are inspected without executing Actions or fetching remote content.
Account partitions and public catalog caches grant no local membership.

Request checks and sorted SHA-256 membership identity are shared with the account
reader. Local hashing occurs between readonly transactions, with membership and
workspace-lease checks before the final event read. A concurrent membership
change returns an explicit refresh error; a changed revision on either paging
cursor resets the stream so older newly linked events are not skipped. The
existing 128-Thing, 512-context/reference and page-byte bounds remain in force.
The real account API fixture now supports explicitly configured disposable
replicas and removes only its own created Things in `finally`.

Validation: seven new local tests and two account-reader unit tests pass;
workspace/offline-shell plus Timeline suites pass 390 tests (five opt-in browser
skips in the ordinary suite). Real related-history API integration and cleanup
pass on the disposable loopback replica. TypeScript retains the same 91 baseline
diagnostics; targeted lint has zero errors and one existing constructor warning.
Production client build verifies 245 assets / 21,203,554 bytes.


The full native History browser flow passes with requests blocked after the
verified offline shell is ready. It checks the related filter/URL before reload,
page/component events, restored membership replacement, and 1440/390/320px bounds
with zero mutation/Timeline/public-restored reads or page errors. Manual in-app
Browser related History and reload also passed at 1440/390px. Task tabs were
closed and viewport overrides reset. Evidence: `tmp/local-related-ui/` and
`tmp/local-related-network-blocked-ui/`.

Two browser-test races are corrected: wait for the optimistic filter's URL
transition before reload, and wait for the responsive detail host before opening
restore. The separate startup problem is still unresolved. Chromium's offline
emulation intermittently cancelled cached modules (independent repetitions
failed at navigation 48 and 52), with the complete cache and module bytes still
readable. The original app passed 80 navigations when actual requests were
blocked instead. Preload removal and response-buffering experiments were
reverted; there is no claimed startup fix. The History regression now defaults
to request blocking, explicitly asserts root API reads fail, and retains
`TT_LOCAL_TIMELINE_NETWORK_MODE=offline-emulation` for diagnosis. The browser's
`navigator.onLine` remains true in the default mode. Real-device startup and
emulation reliability remain acceptance gaps.

Protected History, Timeline folder/storage controls, account sync and the full
local-first matrix remain unfinished. Do not merge this checkpoint.


The combined branch preserves review-bot commit `82eae71f6`: unreachable or
damaged CacheStorage falls back to the real network for build assets; a failed
navigation retains its original network error. Its four offline-shell tests and
the rebuilt native History regression pass. This cache-error fallback does not
establish a fix for the separately observed module cancellations.


## 2026-10-16 — managed anonymous Timeline folder and cold offline rename

The ordinary library and literal search now expose a managed Timeline folder,
computed from saved local history. Stable first-receipt metadata preserves list
paging. The existing folder route renders native History; current-content
snapshots, account scopes and portable export never receive this container.
Ordinary update/move/delete/export, placement and import into it fail without
partial writes. Exact reserved-identity reads remain local even before history
exists. Unit regressions cover pagination, search, reopen, deletion retention,
account isolation and adapter routing without network access.

The new cold-navigation regression caught library rename's unconditional remote
capability check. Anonymous rename now uses the existing local validation and
workspace lease; account negotiation stays intact. The full History browser
flow passes with actual offline emulation, including folder/rename cold reload
and all previous notes/names/branches/merge/export/restore/related checks. Zero
account Timeline calls, HTTP mutations, restored-ID public reads, page errors or
recovered module errors in the final run; viewport/scroll widths match at
1440/390/320. Manual IAB folder navigation also passes at desktop/390, with task
tab cleanup. Evidence is in `tmp/local-timeline-folder-ui-checkpoint/` and the
manual folder screenshots in `tmp/local-timeline-folder-ui/`.

149 workspace + 4 offline-shell + 238 Timeline tests pass (five ordinary opt-in
browser skips). Explicit native browser case passes in 35.5 seconds. Build:
245 assets / 21,205,081 bytes. TypeScript: unchanged 91 baseline diagnostics.
Targeted lint: zero errors, six existing warnings.

Network diagnostics remain explicit: request-blocking failed its root-read
failure assertion, so `offline-emulation` is now the default. Both modes keep
that assertion; module errors remain fatal. Two earlier emulated runs completed
functional work but failed on recovered entry-module errors. A later clean pass
does not establish reliable startup. Storage controls, protected History,
account sync and the full remaining matrix are still merge gates. No main merge
or manual deployment was performed. CI and preview state are reported separately.


## 2026-10-16 — scoped device storage controls

Settings → Things now exposes device-workspace bytes/record limits and the
browser's explicit persistence request without requiring login. Usage reads the
existing quota ledger and key-only record count in one readonly transaction,
scoped to anonymous or the exact account/origin/data plane. It never reads other
partitions or origin-wide usage estimates. Invalid/missing accounting is an
error, preserving last-known values and all saved content. Identity changes
retire the old panel and in-flight work; offline account copies do not need
remote confirmation to read local usage.

Protection checks are passive; only clicking Protect requests eviction
protection. Granted/denied/unsupported/failed/timed-out states are explicit,
with late completions fenced, including protection requests after timeout. The screen explains origin-wide scope and that
this is not a backup, and links ordinary Things export/management and History.
No history purge, parallel export format, remote sync or auth change is added.

Five new boundary tests plus the full workspace/offline-shell suites pass:
159 checks, six opt-in browser skips. The enabled storage browser regression
passes with actual offline emulation, cold reload, a second tab's writes,
missing-ledger injection and repair, preserved Things, accurate browser denial,
and no HTTP mutations or page/module errors. 1440/390/320px viewport and scroll
widths match. Manual IAB desktop/390 layout also passes; tab/viewport cleanup
completed. Evidence: `tmp/local-storage-controls-ui-late/` and manual captures
in `tmp/local-storage-controls-ui/`.

Build: 245 assets / 21,211,055 bytes. TypeScript: unchanged 91 diagnostics.
Targeted lint: zero errors, one pre-existing constructor warning. These are local
checks, separate from CI and deployment. Broader account UI sync, cross-account
acceptance, reliable offline startup and the remaining feature matrix still gate
merge. No main merge or manual deployment was performed.

The branch review fix for a damaged Timeline view cache is included. Its library
regression and the storage timeout boundary pass together (13 targeted checks).


## 2026-10-16 — account moves and cold folder recovery

Ordinary account bulk moves now use the canonical local placement transaction
and existing durable account write queue. Placement and intent roll back together;
new destinations sync first, frozen uncertain requests remain immutable, later
moves follow acknowledgement, and server conflicts retain explicit review.
Missing offline content/ancestors fail clearly. Mixed batches cannot remotely
move pending local content; dedicated managed-kind behavior remains separate.
Both fresh and cached account folder pages apply pending local placement.

Native acceptance found and fixed a cold folder crash: the optional remote
attachment-manifest request expected `.catch()`, but the offline guard threw
synchronously. Account remote guards now reject promises with unchanged
permission checks. The valid account pointer and local folder remain available.
Three earlier browser failures retain this evidence; they are not counted as
passes or as the separate intermittent module-startup defect.

164 workspace/offline-shell checks pass (seven ordinary opt-in browser skips).
The enabled disposable-account browser case passes in 6.2 seconds through the
normal multi-select Move dialog, actual offline navigation/reload, server-state
checks, verified reconnect and two actor/data-plane/timestamp-fenced PATCHes.
Fixture Things are cleaned up. 1440/390/320px viewport and scroll widths match;
no page/module/caught-router errors remain in the final run. Evidence:
`tmp/local-account-move-ui-final/`. One ancillary success-notification history
request was attempted offline; notification local storage/sync remains open.

Build: 245 verified assets / 21,212,773 bytes. TypeScript retains the same 91
baseline diagnostics; targeted lint has no errors and one existing constructor
warning. Local checks are distinct from CI/deployed verification. Account deletes,
coordinated imports, protected/dedicated adapters, complete list pagination,
Timeline sync and the full remaining matrix still gate merge. No main merge or
manual deployment was performed.


## Device notification history — 2026-10-16

Lopu messages no longer depend on an authenticated recording request to be
retained. The normal toast/stream helper saves a redacted local record and queue
atomically. Anonymous messages stay in their own namespace; account messages
retry the existing idempotent home-pinned endpoint only after verified login.
The normal notifications page exposes an On this device view with the same
rows, search, filters and pagination, including no-login nav discovery. Existing
account history remains its authenticated default. Failed sync keeps local text
and reports a failed count; no action or toast waits for history completion.

Local proof covers anonymous actual-offline import/history/cold reload/search
with zero mutations; desktop/390/320px no-overflow screenshots; and disposable
account offline moves whose messages appear once after reconnect in both device
and server history. Canonical redaction, byte bounds, immutable event IDs,
concurrent claims, refusal/retry exhaustion and identity retirement have focused
tests. Redaction-expanded text is bounded after sanitizing so the queued body
still passes the server contract. Shared redaction tests still pass. Raw TypeScript diagnostics remain at
the existing 91, with no new normalized diagnostics.

Artifacts/logs: `tmp/local-notifications-*`. Initial browser testing caught and
fixed the parent nav login gate. This checkpoint does not complete remote social
notification caching, manual retry controls, cross-tab live refresh or the full
local-first matrix. No main merge or manual deployment was performed.


## Structured device search — 2026-10-16

The native `/search` now exposes This device and Online search. Device field
filters reuse the canonical grammar; anonymous searches run only over their
leased workspace snapshot. Account device results are explicitly limited to
saved local content. Anonymous online discovery uses the existing read-only
endpoint without credentials, bounded by body size and deadline. Workspace,
filter and source binding prevent cross-scope cursor/cache reuse. Invalid
filters retain prior results; prototype datatype names now reject explicitly.

Local evidence: 173 workspace tests passed (ten opt-in browser skips); the two
enabled structured-search browser flows cover anonymous offline import/paging/
filtering/cold reload/source isolation and 25 real server/device predicate
comparisons in a disposable private account. The separate anonymous view sees
no private fixture content. Desktop 1440px, mobile 390px and narrow 320px views
have no horizontal overflow. Artifacts: `tmp/local-structured-search-ui-final/`.
Lint and the client build pass (242 offline assets, 21,512,349 bytes). Raw
TypeScript retains the same 91 normalized baseline diagnostics; it is not clean.

This checkpoint provides the search dependency needed by schema forms. Schema
creation/recovery, schema dependency copies, advanced local shortcut filters,
account discovery caching and the rest of the coverage matrix remain open.
It is not authorization to merge or deploy the incomplete rollout.


## Schema catalogue, authoring and independent drafts — 2026-10-16

- Device schema catalogue, Mine/Library, literal filtering before pagination,
  relational usage/reaction projections and separate online discovery.
- Anonymous/offline schema creation, canonical schema-driven data forms and
  independent copies. No protected native write powers are delegated.
- Schema and data creation no longer await draft flush/retirement. Draft
  contexts and leases isolate accounts/origins/data planes; legacy recovery is
  an explicit copy. Invalid device recovery stays intact with a visible message.
- New account data waits for its unsynced schema dependency. A failed schema
  sync preserves both local records and prevents an invalid early data write.
- Local validation: drafts 31/31; schemas 265/265; workspace 175 passed with
  13 opt-in skips, plus offline shell 4/4. All three enabled native browser
  regressions passed, including actual offline root-read failure, cold reload,
  1440/390/320px layout, zero anonymous mutation requests, three deliberately
  stalled account draft requests and malformed-recovery byte preservation.
- Production client build: 242 verified offline assets, 21,519,402 bytes. Raw
  TypeScript still has the same 91 normalized baseline diagnostics; no new
  diagnostics and no relaxed baseline. Focused lint passes.
- Evidence: `tmp/local-schema-workflow-ui-final/`,
  `tmp/local-schema-browser-tests-final.log`, and the scoped test/build logs.
  These are local checks. CI/deployed status must be assessed for the pushed
  revision separately. Full local-first merge gates remain in the coverage matrix.

Preserved automated review commits `45b42c597` and `d1381d936`; the final local
browser/workspace run includes their shared search constants and public-read
error wording.

## Component catalogue, arguments and independent versions — 2026-10-16

The normal component catalogue now defaults to this device, combining existing
bundled suite projections with saved workspace Things. Mine/Library exclude
unowned bundled definitions. The online catalogue remains a separate explicit
source. Shared filtering/family grouping runs before pagination; account device
results are labelled as partial. Native detail/card argument editors recover
arguments, version name and audience through the existing scoped draft session.
Canonical version creation and account sync complete independently of stalled
draft writes. Saved device copies open by exact ID, preserving separate versions
with the same component key. A failed refresh retains a usable cached preview
with Retry. Trust checks, source confirmation and sanitizing renderers remain.

Local verification: components 48/48, drafts 32/32, workspace 176 passing with
15 opt-in skips, offline-shell 4/4. Both enabled clean-browser flows pass:
fully offline anonymous catalogue/detail/card editing, draft recovery, independent
copies and library membership; and disposable-account creation/sync with two
stalled draft requests, failed-refresh cache retention/retry, and offline reload.
All three local surfaces fit 1440/390/320px. Anonymous mutation requests: zero.
The client build contains 247 verified offline assets (21,528,619 bytes). Focused
lint passes; raw TypeScript retains the identical 91 normalized diagnostics.
Evidence: `tmp/local-component-workflow-ui-final/` and
`tmp/local-component-browser-tests-final.log`. The live in-app browser also
confirmed the seeded Action prompt remains explicit and Cancel executes nothing.

Pending: wider account catalogue caching, cross-tab refresh, source-control
editor recovery, bundled-only bookmarks, remaining Builder global/site block
surfaces, and the rest of the local-first acceptance matrix. This checkpoint
is local verification, not deployed verification or readiness to merge.


## 2026-10-16 — Global and site composition checkpoint

Builder exposes canonical site-page editing alongside global blocks for anonymous
and offline workspaces. Both reuse native sections, the canonical writer and
shared draft recovery. Global/site caches are bounded and identity-scoped, retain
paint on failures, and refresh across tabs using scope-only invalidation. Global
and route compositions use separate existing source runtimes. Save/reset finish
independently of account draft requests, and discard/reset retire unfinished recovery.

Local verification: 156 webpage, 33 draft, 178 workspace and 4 offline-shell tests
pass; 5 webpage and 18 workspace tests require explicit integration opt-in.
Three enabled clean-browser scenarios cover offline edits/recovery/reset, two-tab
updates, 1440/390/320px native layout, account isolation and direct server readback
while drafts stall, plus normal-imported source bundles and offline reload.
Client build: 247 verified assets, 21,535,609 bytes. Raw TypeScript: the same 91
normalized baseline diagnostics. Focused lint: no errors, six pre-existing
useWebpage warnings. Evidence: `tmp/local-site-blocks-ui/` and the corresponding
`tmp/local-site-blocks-*-tests.log` files. Live in-app browser confirms the site
picker opens the actual native page in Builder with anonymous draft recovery.

This is local validation, not CI/deployed proof. Control-editing recovery,
account reset/delete sync, cross-device conflicts, and the rest of the acceptance
matrix remain outstanding. No main merge or manual deployment in this checkpoint.


## 2026-10-16 — Account deletion and reset checkpoint

Ordinary owned Things now delete locally with durable conditional sync intent.
Builder global/site reset uses that same adapter. Uncertain create/update outcomes
settle before deletion, never-sent creates cancel without network work, folder
children drain first, and linked child conflicts hold parent deletion. Explicitly
keeping a linked account version blocks the parent cascade until reviewed again.
Pending before-images share workspace quota and release after acknowledgment;
minimal tombstones prevent stale read resurrection.

The normal conflict UI restores the reviewed account version or deletes that
version with its server timestamp. Server list membership and visible-folder
refresh preserve immediate restoration. Offline reset also respects unverified
workspace identity when the browser incorrectly reports online. Dedicated
protected-kind adapters and server authentication remain unchanged.

Local browser evidence covers normal Things delete, Builder global reset, cold
reload, no offline mutations, actual server readback, folder child preservation,
and both conflict choices at 1440/390/320px. Account move and all three site
composition regressions pass too. Logs/artifacts: `tmp/local-account-delete-ui/`,
`tmp/local-account-delete-browser-tests.log`. This remains an implementation
checkpoint, not a complete local-first rollout or deployed verification.

Final local checks: 192 workspace tests and four offline-shell tests pass (19
opt-in workspace/browser tests skipped in the default command). Five enabled
browser scenarios pass; the deletion scenario was rerun after the final safety
change. Client build: 247 verified static assets / 21,541,680 bytes. Raw
TypeScript retains the same 91 normalized baseline diagnostics. Focused lint:
zero errors and four existing ThingsPage hook warnings. No baseline was relaxed.


## 2026-10-16 — Ordinary account import checkpoint

The normal Things import dialog now commits ordinary account copies and their
sync intent locally in one transaction. Canonical account import helpers are
shared with the server: structural ordering, private-copy definition keys/schema
names, remapped references and removal of source site placement. Definitions never
execute during import. Caller content is snapshotted before async work; cancellation
and invalid content roll back. Exact queued retries preserve newly allocated IDs.

Local checks: 197 workspace + four offline-shell + 315 Things tests pass; 20
workspace/browser cases are opt-in. Four enabled browser cases pass, including
normal account import, native preview, offline edit/cold reload, zero offline
mutations, 1440/390/320px bounds and actual private server readback after reconnect.
The fixture also exports through the normal server API, validates portable JSON,
and imports it through the normal server importer with independent IDs and full
component/schema references. Existing anonymous/account site checks pass unchanged.
Client build: 247 assets / 21,543,863 bytes. Raw TypeScript retains the same 91
normalized baseline diagnostics. Lint: zero errors, one existing constructor warning.
Artifacts: `tmp/local-account-import-ui/`; logs: `tmp/local-account-import-*.log`.

Account file/managed imports, account export UI/cache completeness and the wider
acceptance matrix remain open. Anonymous site/suite import semantics are unchanged;
complete local/remote import parity is not claimed. No main merge or manual deployment.


## 2026-10-16 — Ordinary account export checkpoint

Normal Download now uses device content before network or sync, including
pending edits and complete dependency closure. `accountExport.ts` keeps scoped,
option-bound content-only snapshots prepared by the canonical server exporter;
a partial library page never qualifies as a complete folder export. Missing
coverage refuses offline; canonical collection/serialization and exact dependency
remapping remain shared. Shared/export-only definitions cannot capture owned
component aliases or become owned editable/syncable Things. Snapshots are bounded
to 16 entries and normal device quota; cache-retention failure does not block the
download. Preparation retains the existing deadline, cancellation, expected-actor,
data-plane, identity and capability boundaries.

Verification: 206 workspace + four offline-shell + 315 Things tests pass, with
20 general-suite opt-in skips. The enabled account import browser scenario now
also downloads real canonical JSON offline through the normal dialog, imports
that exact file through the normal server importer, then repeats the offline
download after sync/cold reload. All five Things, pending text, references and
private copy remapping survive. Native preview fits 1440/390/320px; the 320px
Download dialog has no horizontal overflow. Offline mutations and browser errors
are zero. Evidence: `tmp/local-account-export-ui/`. Build: 247 verified assets /
21,549,320 bytes. Lint: zero errors, one existing constructor warning. TypeScript:
the unchanged 91 normalized baseline diagnostics.

Ordinary no-file/no-link exports are covered. Dedicated media/managed exports
with unsynced edits, broader account cache membership and cross-device refresh
remain open; the full [matrix](../docs/local-workspaces.md) still gates merging.
Local evidence is separate from CI and deployment.

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
Uncached/foreign account targets still use the existing guarded online adapter,
so this is partial account coverage, not completion of the full matrix.

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
real IndexedDB quota test fills all 64 MiB and proves both never-started and
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
Deletion, conflict recording and restoration fit at the full 64 MiB device quota
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


## Account file UI checkpoint — 2026-10-16

The normal Files picker now finishes on device persistence, independently of
account discovery/upload. Offline folder creation, local file Cut/Paste, exact
byte download and native image rendering pass in the real browser at desktop,
390px and 320px. The lifecycle fixture verifies stable local IDs and owned server
alias deduplication. Scoped preview registries revoke retired/deleted content,
coalesce cross-tab refreshes, refuse cancelled recovery bytes and keep shared
contexts on the normal authorization path. No authentication or upload permission
check was removed. See the dated [workspace checkpoint](../docs/local-workspaces.md#normal-account-file-ui-and-scoped-previews--2026-10-16).

Existing-account byte retention, managed transfers, wider account media/editors
and the remaining full-suite matrix still block merge. Local verification and
current-head CI/deployed verification must continue to be reported separately.


Local checks: 893 unit/offline-shell checks plus both real browser scenarios;
client and Node/Nitro builds pass (248 offline assets / 21,617,351 bytes).
Focused lint is clean; TypeScript has 91 baseline diagnostics and none in changed
source paths. Browser evidence and the full boundaries are in the linked checkpoint.


## Existing saved-file deletion receipts — 2026-10-16

Added attachment-delete 1.4.0 `retainReceipt:true` for a canonical existing owned
standalone file and its observed version. Existing files do not retain the
original upload request ID; this mode reuses exact-version cleanup and durable
cancellation receipts without inventing one. Unlike request-ID cancellation, it
never reserves missing IDs. Live version/purpose/target fences remain atomic;
missing/foreign IDs, shared/bound/linked media and expiring imports are refused.
Full-user auth, same-origin protection, rate limits and quota settlement remain.

Verified locally with 312 attachment and 98 capability checks, the new disposable
browser-context/storage integration scenario and the existing offline file
lifecycle scenario. Both lost-response replay and delayed-start fencing pass.
Node/Nitro build and focused lint pass; TypeScript has 91 baseline diagnostics,
none in changed sources. Evidence: `tmp/owned-file-deletion-*.log`,
`tmp/owned-file-deletion-browser/existing-file-deletion.json` and
`tmp/owned-file-deletion-existing-lifecycle/verification.json`.
Existing-account byte retention remains unfinished; this server prerequisite
must not be described as end-to-end offline retention. No main merge or manual
deployment was performed; CI/deployed verification remain separate.


## Retained account files — 2026-10-17

Existing owned standalone files can now retain bounded, version-checked original
bytes through content 1.13.0 and render/edit/download through the native media
page offline. Metadata sync and receipt-based deletion reuse existing workers;
retained originals never upload again. Atomic storage, scope retirement, dirty
edits, conflicting updates, exact quota and in-flight upload completion are
covered. Failed retention reports a warning while preserving the online view.

Local evidence: 1,011 unit/offline-shell checks and two enabled browser modes
pass, including production-build cold offline reload, edit/reload/download,
verified reconnect, no duplicate uploads and lost deletion acknowledgement.
Screenshots cover 1440/390/320 CSS pixels. See the detailed
[checkpoint and remaining boundaries](../docs/local-workspaces.md#retained-account-files--2026-10-17).
The full-suite matrix still blocks merge; current-head CI and deployed acceptance
are separate from these local results.

Client and Node/Nitro builds pass; the offline manifest verifies 247 assets /
21,628,804 bytes. Both built capability manifests advertise content 1.13.0
and deletion 1.4.0, and anonymous retention/deletion remains refused. Focused
lint is clean aside from the existing tooling deprecation. Raw TypeScript has
91 baseline diagnostics and no changed-source errors. The existing native
Files-picker and private upload/deletion browser scenarios also pass.


## Account file ZIP export — 2026-10-17

The normal Download dialog now exports new or retained account file bytes and
local annotations through the canonical collector, including local folder and
ordinary component/page media closure. It does not wait for upload or metadata
sync. Deleted/cancelled files cannot return from old snapshots; repeated exports,
original references when excluding bytes, and scope/byte failures are covered.
920 unit/offline-shell checks and two production-client browser flows pass,
including actual ZIP import in a clean anonymous workspace and cold offline
native preview/download. Raw TypeScript has 91 baseline errors and no changed
source errors. Client build and focused lint pass. See the
[checkpoint, artifacts and remaining scope](../docs/local-workspaces.md#account-file-transfer-exports--2026-10-17).
Account file import, complete remote-folder file snapshots, bound/managed media
and the remaining full-suite matrix still block merge. No manual deployment.


## Account file ZIP import — 2026-10-17

The normal account dialog now saves supported standalone-file ZIPs locally,
including bytes and both durable queues in one transaction. Independent Things
sync without waiting for media; referenced files require a confirmed private
upload receipt before the canonical rewriter maps IDs. Ambiguous retries stay
immutable. The shared exporter also fixes byte-target selection when a Component
is visited before its standalone file. Anonymous content remains device-only.

The enabled production-client browser fixture passes normal offline import,
cold native preview, canonical re-export/exact bytes, verified private upload,
real account media IDs, metadata placement and guest refusal. Dialog/preview
checks cover 1440/390/320px. The original failure was the local store's absolute
development origin conflicting with preview CSP; root-relative local URLs fix
that setup without weakening policy. See `tmp/account-file-import-browser/`.
Seven focused regression cases pass; existing workspace/Things/attachment suites
pass. Raw typecheck, lint/build evidence and graph status are recorded in the
checkpoint verification file. Bound/recording/linked/managed imports and the
broader matrix remain open; no main merge or manual deployment.


## Standalone recordings and independent deletion — 2026-10-17

Canonical recording ZIPs now use the same atomic device import, byte storage,
export and private sync path as files. Owned recording retention negotiates
content 1.14.0 and durable deletion 1.5.0 with exact-purpose fences. Retention now
preserves canonical annotations instead of using a minimal byte projection.
Native device audio waits for a usable source and avoids a redundant legacy
cache copy. Shared/keyed playback cannot borrow that cache.

Real browser checks exposed two deletion dependencies: unsynced local metadata
was incorrectly treated as a remote conflict, and the native library's bulk
Delete menu bypassed the file queue. Both are fixed, with complete-snapshot
comparison, conditional account deletion, durable replay and explicit mixed-batch
results. Unknown account edits still require review.

The production recording browser scenario passes import/play/edit/export,
clean-context retention, offline rename/delete, lost-response retry and anonymous
offline playback/reconnect with zero remote writes. Existing file import and
retention scenarios also pass. 1,034 unit/offline-shell checks pass; 33 generic
browser skips are not acceptance evidence. See the [recording checkpoint and
remaining work](../docs/local-workspaces.md#local-standalone-recordings--2026-10-17).
No main merge or manual deployment. Full-suite acceptance, microphone capture,
bound media, secondary offline readers and current-head deployed verification
remain open.


## Anonymous imported file metadata — 2026-10-17

Imported local recordings exposed a native editor gate that depended on the
upload-only ID prefix. The shared projection now derives standalone annotation
eligibility from the stored workspace record. The UI retains current ownership,
link and binding checks, and writes still recheck the scoped record. Canonical
exports contain no capability fields.

622 unit/offline-shell checks and the enabled production-client recording browser
scenario pass. That browser now edits all three anonymous metadata fields offline,
reloads, exports exact bytes/annotations, checks 1440/390/320px bounds and reconnects
with zero remote writes. Account recording lifecycle checks remain passing in the
same run. Client build and lint pass (one existing warning); raw TypeScript has
91 baseline diagnostics, none in changed files. Evidence and the account
remote-only discussion-read gap are recorded in the [checkpoint](../docs/local-workspaces.md#anonymous-imported-file-metadata--2026-10-17).
The complete local-first acceptance matrix remains open. No merge or manual deploy.


## Account discussion reads and cross-cache refusal — 2026-10-17

Authorized generic discussions and individual comments now retain scoped read
snapshots. Offline readers show explicit partial coverage and paginate device
records; unsynced owned Things use local identity/state. Retained file details
no longer require reconnection merely to show comments, and schema-free owned
Data avoids an unnecessary shared-media capability check.

Live validation found canonical comment-only kinds and generic-parent cache
batch failures. Both are handled without changing persisted kinds or ownership.
Refusal cleanup now shares one atomic transaction across post and discussion
projections, with descendant/embedded-copy removal, late-response fencing and
quota-safe shared watermarks. Read-cache eviction never touches authored Things.

709 unit/offline-shell checks and three enabled production-client browser flows
pass: discussions with native nested replies and positive alternate-permalink
retention before refusal;
recording lifecycle with native offline comments; and shared-post Saved/reaction
regression. Client build/lint pass; 91 baseline TypeScript diagnostics remain,
none in changed files. [Detailed evidence and limits](../docs/local-workspaces.md#account-discussion-reads-and-refusal-cleanup--2026-10-17).
Account comment/post/reply writers, draft sync, complete membership and the rest
of the full local-first matrix remain open. No merge or manual deployment.


## Account post/comment/reply authorship — 2026-10-17

Native text/rich-text posts and discussion replies now commit content plus intent
locally through the existing canonical writer and account queue. Draft saving and
network completion are independent. Stable IDs, linked dependency ordering,
inherited comment audiences and the normal comment endpoint preserve retry and
authorization semantics. Known read refusal also prunes synced owned caches;
pending authorship stays available for recovery. Unsupported bound media/authority
fields remain explicit rather than partially saved.

900 unit/offline-shell checks and three enabled browser flows pass: native private
post create/reload/sync, offline comments and nested replies plus refusal cleanup,
and existing Saved/reaction isolation. Client build/lint pass with one existing
lint warning; 91 baseline TypeScript diagnostics remain, none in changed files.
Desktop/390/320px checks and zero offline mutation requests are recorded in the
[checkpoint](../docs/local-workspaces.md#account-post-and-reply-authorship--2026-10-17).
Bound media, full native mutation coverage, draft sync and the broader matrix stay
open. CI/deployed acceptance is separate. No main merge or manual deployment.


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


## Existing bound originals checkpoint — 2026-10-17

Fresh-device owned post/comment retention now admits complete original bytes and
parent content atomically, preserving concurrent editing and read refusals. It
reuses content 1.15.0 and deletion 1.7.0 with exact owner/target/purpose/version
checks and durable receipts. Native offline edits/removals do not invent upload
identities or depend on draft saving. A real reconnect failure exposed comment
PATCH resending `tt:inherit`; transport now omits this saved audience snapshot and
retains server enforcement and different audience requests.

Local: 1,066 unit/offline-shell checks pass across workspace (327), attachments
(320), Things (320), capabilities (99). The 37 generic browser skips are excluded.
The enabled fresh-device production-client browser passes decoded byte equality,
cold offline edit/removal, original-record reconnect, no duplicate uploads,
anonymous refusal, no offline mutations/browser errors, and desktop/390/320px
bounds. Narrow screenshots were inspected. Client build verifies 247 offline
assets; focused lint passes. TypeScript reports 91 existing baseline diagnostics, none in changed files.
Evidence: `tmp/account-bound-retention-browser/` and related logs. CI and deployed
verification remain separate from this local result.

Normal complete bound import/export, parent context/deletion, linked/managed
media, cross-device reconciliation, account draft sync and the remaining matrix
are still merge gates. No merge or manual deployment at this checkpoint.


## Offline conversation links checkpoint — 2026-10-17

Comment permalinks now resolve parent/root links from their scoped local content
and read snapshots. Anonymous nested replies and account generic/private post
comments can return to retained parents offline. Canonical root references cover
unvisited intermediate ancestors; direct discussion refresh cannot erase them.
Generic parents and foreign authors never gain local ownership. Pending edits
outrank stale snapshots; refusal/deletion fences suppress descendant links while
preserving recoverable authored content. No network or anonymous sync is added.

Local evidence: workspace/offline-shell 332 and feed 79 checks pass; 37 generic
browser skips are excluded. Three enabled production-client fixtures pass native
cold-offline parent/root navigation, anonymous no-write checks and account
edit/removal/reconnect. Desktop/390/320px bounds pass; narrow screenshots were
inspected. Client build verifies 247 assets, focused lint passes, and TypeScript
has 91 baseline diagnostics with none in changed files. Evidence lives in
`tmp/thread-context-*`. CI/deployed verification remains separate.

The next open media gate is the normal bound-file importer/exporter. Audit found
that `LocalThings.import` already has canonical binding/remapping and atomic file
queue admission, but its account gate and `accountImportSupported` still exclude
all bound files. Existing-file normal export also routes media plans online and
requires a complete snapshot: retaining bytes alone must not weaken that check.
Finish these paths with actual normal-dialog round-trips, then continue the full
matrix. Parent deletion/reconciliation and other feature families remain open.

Deep-thread follow-up: the account browser regression also visits a depth-eight
comment permalink after cold offline reload, with intervening comments unvisited,
and follows its authorized generic-Thing root. Local traversal covers 70 levels
without a depth cap; cycle detection remains the terminator.


## Bound post/comment ZIP import checkpoint — 2026-10-17

The normal account importer now admits validated post/comment files through its
existing atomic content/byte transaction and upload/content queues. It creates
independent private IDs, preserves attachment order and reply targets, and leaves
remote completion dependent on verified identity and confirmed upload receipts.
No draft save or upload completion gates local import. Generic component-bound,
linked and managed transfers retain their dedicated paths pending implementation.

Validation: 335 workspace/offline-shell and 320 Things tests pass (37 default
browser skips excluded). Three new bound-import tests cover ordered receipts,
independent content progress, anonymous/account exact-byte round trips and atomic
refusals. The enabled production-client `accountFileImport.browser.test.ts` passes
normal offline Import/Download, cold native Component/reply rendering, private
reconnect with four real uploads, inherited replies, exact originals and anonymous
refusal. Dialog/page/reply bounds pass at 1440/390/320px. The mixed fixture needs
both existing standalone-file and post-media upload approvals on its new disposable
account; initial runs confirmed either missing approval is refused.

Client build passes with 247 verified offline assets. Lint has no errors and the
existing LocalThings constructor warning; TypeScript retains 91 baseline errors,
none in changed files. Successful browser evidence: `tmp/bound-import-browser-complete/`;
unit/build/type logs: `tmp/bound-import-*.log`. This is local verification only.

The full goal remains open: complete export manifests for previously remote bound
content, parent deletion/binding reconciliation, linked/managed transfers and the
remaining matrix still need implementation/acceptance. Do not merge from this checkpoint.


## Retained export refusal checkpoint — 2026-10-17

Reproduced a known read refusal removing an owned cached Thing while leaving its
export snapshot readable. The shared refusal transaction now removes affected
export closures, including export-only dependencies and canonical file aliases.
Prepared plans/bundles recheck refusal watermarks and live file metadata through
canonical JSON/clipboard/ZIP/download helpers. Refusals during remote preparation
or ZIP encoding cannot produce a successful retained download. These callbacks
are in-process only and never part of portable JSON. Pending authored edits remain
recoverable. Ordinary cached Components now record definitive background-read
403/404/410 failures; 401/session and transient errors preserve offline content.

Local validation: 337 workspace tests plus 4 offline-shell tests, 322 Things tests
and 11 focused transfer browser-helper tests pass (38 default browser skips are
not acceptance). The explicitly enabled production-client
`accountExportRefusal.browser.test.ts` passes normal Download, a real cross-tab
404, offline redownload refusal, visible error and 1440/390/320px bounds with no
second download, page errors or offline mutations. Evidence:
`tmp/export-refusal-browser-final/`; logs: `tmp/export-refusal-*.log`.
Client build verifies 247 offline assets. Focused lint has no errors or warnings;
raw TypeScript reports 91 existing diagnostics, none in changed files.

This closes retained/prepared export reuse after an observed refusal; it does
not claim universal file-cache revocation or complete retained bound-media
export. Fresh exports of retained standalone originals, dedicated remote export
plans and the remaining local-first acceptance matrix still need their broader
lifecycle checks. No merge, production deployment or public fixture is authorized
by this checkpoint; the PR remains draft.


## Retained post/reply portable Downloads — 2026-10-17

Reproduced normal offline export rejecting a fully retained account post even
though direct internal export worked. The existing sync record now records the
original file IDs when atomic full retention or a verified local binding write
completes, including a changed binding with an unchanged parent body version. The normal exporter recognizes this evidence without accepting partial
folder/library caches. Pending edits, explicit removals and keep-device conflict
choices remain exportable; missing file records fail, and an unknown parent keeps
the complete authorized remote path. Internal proofs never enter portable JSON.

The browser check also found post menus only exposed file archives. The canonical
Download verb now opens the existing `ThingExportDialog` in persisted Thing menus,
with shared-link context and identity cancellation. No second exporter was added.

Local verification: 341 workspace tests plus 4 offline-shell tests, 322 Things
and 79 feed tests pass; 38 opt-in browser skips are excluded. Eight retained-binding tests
cover complete/incomplete caches, edits/removals, independent anonymous/account
round trips, keep-device conflict review and unknown-parent fallback. The enabled
production-client fixture exports three originals from a fresh account context,
imports normally into an offline anonymous context with new IDs, then re-exports
identical bytes. A later account export contains current edited text and only the
one remaining file before sync. Private reconnect and anonymous refusal remain
verified. Keyboard/touch and 1440/390/320px menu/dialog checks are included.
Evidence: `tmp/retained-export-browser-final/`, `tmp/retained-export-*.log`.
Client build verifies 247 offline assets; focused lint is clean; raw TypeScript
retains 91 baseline diagnostics and none in changed files.

This closes native offline export for completely retained owned post/comment
bindings. Fresh-file refusal lifecycles, shared/managed/linked transfer cases,
parent binding reconciliation and the broader acceptance matrix remain open.
The PR stays draft; this checkpoint does not authorize merging or deployment.


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


## 2026-10-17: generic editor draft scope and cold recovery

The generic Thing adapter now uses captured workspace leases, shared scoped
recovery keys and validated canonical snapshots. Closing the same workspace can
finish its last local save; changing identity prevents late completion from
writing recovery, restoring a value or changing the next editor's UI.

A real anonymous/offline browser check exposed a second issue: the generic draft
could finish saving before the whole-tree debounce, so an immediate reload showed
older text. Native route views and non-embedded editor windows now resume their
current scoped recovery once after hydration. This does not adopt legacy keys,
replay authored edits, or restore into embedded foreign previews. Invalid recovery
is retained with an explicit paused-saving error instead of becoming blank data.

Local verification: `tmp/thing-draft-workspace-browser-verified/` holds the native
1440/390/320px screenshots, cold offline create/edit/picker/reload evidence and
corrupt-copy preservation check. The held-draft private-post regression passed
again (`tmp/thing-draft-workspace-account-regression/`). The client build passes;
raw TypeScript still reports the 91 baseline diagnostics, with none in changed
files. Scope services and codec tests pass; current-head CI/deployment remain
separate. All previously listed full-suite and legacy-recovery gates stay open.


## Legacy native editor tree isolation — 2026-10-17

`WorkspaceThingtimeProvider` binds the native tree and its tab channel to the
captured account, API origin, data plane and identity generation. `LocalEditorTree`
uses the existing workspace database: its canonical storage bytes and integrity
metadata commit atomically, count toward device quota, and abort on identity
retirement. The tree has a 16 MiB limit within the existing 64 MiB workspace quota.
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

`remix/app/drafts/offlinePostTemplate.browser.test.ts` proves both clean-browser paths against the
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

Account notes can be removed before their first add acknowledgement; both
commands finish locally and sync independently in dependency order. Refused
adds retain review intent without blocking unrelated work. Scoped IndexedDB v8
read revisions prevent stale read pages and duplicate add replies from restoring
deleted cache entries. Existing v7 names/notes survive the additive migration.

The shared canonical removal record replaces the protected account note under
its existing identity, erasing text/source references and retaining metered
private metadata. Late add/explanation retries return 409 instead of recreating
content. Delete-before-add is fenced too. Existing anonymous removal markers
upgrade to the identical record. No new collection/index or weaker auth path.
Remote note writes negotiate `api.timeline` 1.19.0.

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

Remaining: broader branch controls, protected and
attachment recovery, and the full local-feature acceptance matrix. This remains
a draft PR; no merge, deployment or public publishing was performed.


## Device draft names and anonymous version export — 2026-10-17

The existing name queue, shared mutation planner and local/account authorities
now accept retained owner-authored client drafts without changing their events.
Names finish locally before account upload; synchronization waits for the exact
draft acknowledgement (`api.timeline` 1.20.0). Anonymous drafts also export
through the normal version reader with their accepted local names and receipts.
No new format, collection, authentication shortcut or remote anonymous path.

Full anonymous browser validation exposed and fixed synchronous capability
predicates being wrapped as rejected promises; local scope checks now return
actual booleans and fail closed on foreign or retired scopes. Startup body reads
and rendered-comment selectors were tightened in the native fixture. See
[the current coverage and remaining matrix](../docs/local-workspaces.md#device-draft-names-and-anonymous-version-export--2026-10-17).


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

The broader local-feature goal remains active. Branch/editor-source breadth,
protected and attachment recovery, shared/managed/linked transfer and sync,
identity transitions, encrypted Vault and other matrix items remain incomplete.
No merge, manual deployment or public publishing was performed.


## Upstream integration and offline Settings acceptance — 2026-10-17

Integrated `main` at `ac0ab1c93` (17 upstream-only commits) into this feature
branch. Preserved model discovery/admission controls, Astra transport fixes,
Lopu task/popover fixes and the shared collapsible Settings cards alongside the
local workspace adapters. Source merges were clean; documentation conflicts
were independent additions and both sets were retained. Generated graph rename
conflicts use one complete feature-branch snapshot before regeneration.

Local validation on the combined source:

- 1,287 automated checks pass: local workspace/offline shell 425, Timeline 258,
  capabilities 101, Settings 39, Lopu UI 234, AI/model/runtime 127, actual SDK
  streaming fixtures 64, admin integrations 25, Vercel packaging/configuration 14.
  The 46 opt-in workspace skips are not counted as passes.
- Three enabled production-client browser fixtures pass: anonymous offline
  storage (33.1s), anonymous offline History (74.1s), and disposable-account
  History/reconnect (49.5s). Storage checks cover collapsed defaults, Enter/Space
  and pointer access, cold reload, other-tab writes, retained usage on an invalid
  ledger, recovery and actual 1440/390/320px screenshots. History checks retain
  native draft naming/export, immutable provenance, private guest refusals and
  zero anonymous/account-offline mutation traffic or page errors.
- The real SettingsSection/SettingRow browser fixture passes at 1440/390/320px:
  retained field state, nested deep links, unrelated cards remaining collapsed,
  readable labels and no horizontal overflow. No authenticated settings or
  provider configuration was changed.
- Client build verifies 247 offline assets (21,761,155 bytes). TypeScript retains
  the same 91 baseline diagnostics; focused fixture lint has no errors/warnings.

The storage fixture previously assumed the complete workspace byte count stayed
constant through Settings initialization. Record-level diagnostics show only the
native editor tree/header growing; authored Things, History and notifications
remain identical. It now checks those unchanged records and the refreshed exact
byte total. The History fixture now awaits the cancelled note row detaching after
its status message; an immediate count raced the queued projection refresh.
Failed attempts are retained and are not counted as acceptance.

Evidence: `tmp/upstream-integration-*.log`,
`tmp/upstream-integration-storage-verified/`,
`tmp/upstream-integration-anonymous-verified/`, `tmp/upstream-integration-account/`
and `tmp/upstream-integration-settings-browser/`. These are local results;
current-head CI and deployed acceptance remain unverified. The full coverage
matrix remains open, including protected/media recovery, broader branch controls,
shared/managed/linked transfer, identity transitions and local encrypted Vault.
This integration updates only the feature branch, not remote `main`.


## Encrypted anonymous password manager — 2026-10-17

Anonymous `/passwords` and Settings → Security → Device passwords now expose the
normal editable credential UI behind a separate device passphrase. The local
adapter reuses the exact server envelope/KDF contract, shared scope/lease/quota
storage, normal entry validator and CSV/1PUX transfer. Titles and field metadata
are encrypted with values; retries use keyed digests. Manual/idle/teardown locks,
independent tab unlock, transactional cancellation, revision conflicts and damaged
key refusal preserve encrypted content. No server authentication or authorization
changed. Anonymous writes never queue account sync. Account encrypted intent
primitives are preparatory only; no account offline UI or sync worker is enabled.

Local evidence:

- 471 automated checks pass: password suite 39; workspace/offline shell 432.
  The 47 opt-in skips are excluded; focused crypto/storage tests are subsets.
- The enabled clean-browser fixture passes in 26.96s using actual offline mode:
  setup, normal field editing, wrong phrase, lock/reload/unlock at 1440/390/320px,
  two-tab stale-edit preservation, normal acknowledged CSV download/delete/import.
  It detects no plaintext synthetic credentials in serialized/decoded storage,
  no account records/commands, no password API or mutation traffic and no page
  errors. Screenshots show masked fields and no horizontal overflow; the existing
  global floating controls can overlay right-edge controls until scrolled.
- Client build verifies 247 offline assets (21,782,506 bytes). TypeScript retains
  exactly 91 baseline diagnostics; focused lint has no errors and two existing
  PasswordManager effect-cleanup ref warnings.

Artifacts: `tmp/local-passwords-native-accepted/`,
`tmp/local-passwords-workspace-final.log`, `tmp/local-passwords-suite.log`,
`tmp/local-passwords-typecheck-checked.log`, `tmp/local-passwords-build-checked.log`.
Earlier fixture selector attempts remain in local logs and are excluded from
acceptance. The fixture uses disposable synthetic secrets only; plaintext CSV
artifacts remain untracked. No existing account data was changed.

Account vault caching/unlock/sync/conflict recovery, Settings provider/environment
credentials, native credential integration and the rest of the local-feature
matrix remain open. Current-head CI and deployed verification remain unproven.
This checkpoint is not the full goal's completion or permission to merge.


## Account encrypted device passwords and independent sync — 2026-10-17

Account password editing now uses the existing encrypted device adapter and
normal editor/transfer UI. A separate local passphrase permits cold offline
unlock; local saves/deletes commit encrypted queue intent atomically. Independent
pull/upload loops use verified account/origin/data-plane leases and the existing
private password endpoint. Frozen retries, per-entry claims, validated receipts
and explicit conflict-copy/account choices preserve newer edits. Background sync
does not renew idle unlock, and cancellation/lock cannot adopt a late response.
Review reproduced a separate timer renewal through automatic title/list reads.
Those reads now preserve the deadline; anonymous/account regressions also prove
that explicit user activity still renews unlock.
The account API, server encryption format and authorization remain unchanged.

The password adapter now delegates key lifetime to `deviceVaultSession.ts`.
A fixed synthetic pre-extraction encrypted fixture proves compatibility; seven
focused tests cover domain/identity separation, idle expiry, retirement, late
storage adoption and missing-key damage. The shared session prepares independent
provider credentials without reusing password entry schemas. Provider authoring
and sync are not yet wired into the UI.

Local validation: 491 automated checks pass (39 password suite; 452 workspace/
offline-shell), excluding 48 opt-in skips. The actual account browser fixture
passes in 36.61s: offline edit and acknowledged CSV export, cold unlock at
1440/390/320px, competing real server edit, reviewed independent copy and second-
account isolation. The anonymous regression passes in 32.05s with zero password
API/mutation requests. Both inspect serialized/native-tree storage for synthetic
plaintext leaks. No existing account data was changed; all accounts are disposable
fixtures on the task's loopback replica. The fixture-only server encryption key
is ignored and was installed through the managed PM2 lifecycle.

Build: 247 verified offline assets (21,795,907 bytes). Focused lint has no errors
and two existing PasswordManager ref-cleanup warnings. TypeScript remains at its
91 baseline diagnostics. Evidence: `tmp/shared-vault-account-native/`,
`tmp/shared-vault-anonymous-native/`, `tmp/shared-vault-*.log`,
`tmp/account-passwords-idle-*.log`,
`tmp/account-passwords-*-final.log`
and `tmp/account-passwords-password-suite.log`. The initial transport test hung
because its mock cloned an oversized Response and retained an unread tee branch;
using the single response fixed the harness. It is not counted as a passing run.

Provider/environment credential storage, broader native identity/plane transitions,
signed offline provider integration and the remaining full local-feature matrix
are still open. This is local acceptance only; current-head CI/deployed verification
and full-goal completion remain unproven. No main merge or deployment occurred.


## Anonymous provider and environment authoring — 2026-10-17

Settings → Security → Secure Vault now works anonymously through the normal
forms and independent encrypted device key lifecycle. The shared browser-safe
validator keeps canonical provider catalog/metadata/value rules; server-only
private-host restrictions remain in `userVaultCore.ts`. Local names and values
are encrypted together. Revision checks, immutable retry identities, quota and
scope leases, and an atomic group-membership fence protect create/move/delete.
Anonymous records have no account commands. Account encrypted intent is prepared
in the adapter, but account UI/sync and explicit retention of freshly revealed
server values remain unfinished. Existing account Vault authorization remains.

The shared unlock gate serves provider and password domains without sharing
keys. Brief selected-device reveal clears on expiry/blur/lifecycle/lock; account
reveal still requires the existing fresh password/passkey proof. Local save
completion updates metadata immediately, independently of refresh. A browser
storage assertion caught entry names escaping through deletion notifications;
the notification now uses generic text. Malformed supplied provider tokens are
rejected before server record access (`api.lopu-vault` 1.2.1, both manifests).

Local validation: 530 automated checks pass (460 workspace/offline shell, 70
provider/manifest contracts); 49 opt-in skips excluded. The actual anonymous
provider browser test passes in 44.89s with create/move/delete, nonempty group
refusal, wrong passphrase, cold offline unlock at 1440/390/320px, exact selected
values, blur and 30-second expiry. Storage has no plaintext credential/name or
account intent, and network records zero protected Vault requests or mutations;
there are no page errors. The shared-gate password browser regression passes in
22.07s including its normal import/export and two-tab conflict checks. Evidence:
`tmp/provider-vault-native/`, `tmp/provider-vault-password-regression/`,
`tmp/provider-vault-{workspace,contract-tests,native,password-regression}.log`.
Desktop/mobile screenshots were inspected; no horizontal overflow was measured.
Existing floating assistant controls overlap part of the mobile right edge.

The production client build verifies 247 assets (21,815,004 bytes); focused lint
has no errors or warnings, and TypeScript retains exactly 91 baseline errors.
The actual local Nitro manifest advertises Vault 1.2.1. Initial runs caught the
notification-name leak and a local API 502 before feature execution; neither is
counted as passing. The worktree's Nitro listener had stopped; one canonical
managed restart restored it after startup compilation. One intended PM2 entry,
zero restarts and disabled auto-restart were verified. No existing account data
was modified, and no remote deployment or merge occurred.

This checkpoint provides anonymous device authoring. Ordered conditional
account provider sync, retained account offline authoring/reveal, native provider
integration and all other unfinished items in the full local-feature matrix
remain the merge gate. Current-head CI/deployed acceptance is still unproven.

### Account provider metadata and selected retention groundwork — 2026-10-17

The anonymous-provider checkpoint's final semantic snapshot is verified against
its frozen source fingerprint, all 14 changed code hashes and all six document
hashes/membership. It was pushed in `385e13e9f`; this confirms that checkpoint's
index coverage, not subsequent account work or full-feature completion.

Current account work adds complete, bounded metadata reads (`api.lopu-vault`
1.3.0), opaque versions over actual stored BSON Things, and optional same-record
versions on freshly verified personal reveals (`api.vault-reveal` 1.2.0). The
existing generic Thing editor remains usable; its edits must invalidate sync
versions even when the embedded Vault timestamp stays unchanged. Neither API
returns bulk plaintext or ciphertext. The device adapter encrypts remote-only
metadata, requires explicit exact-version value retention, preserves pending
edits/dependent environments and fences stale replies. Its direct metadata
transport uses current actor/origin/selected-plane confirmation.

Local verification so far: 108 focused contracts, 471 workspace/offline-shell
checks (50 opt-in skips excluded), 101 capability checks and 21 sensitive-reveal
checks pass. Counts overlap and must not be summed. TypeScript matches all 91
previous baseline diagnostics with no additions; focused lint passes. The built
client verifies 247 assets (21,821,166 bytes). Actual disposable-account API
checks verify metadata redaction, generic-edit versions, exact selected reveal,
wrong-password/origin/account/actor/plane refusals and cleanup. Evidence lives in
`tmp/provider-account-*.log` and `tmp/provider-account-metadata-api.json`.

The API fixture is now reproducible as `providerMetadata.api.test.ts`; its
loopback-only setup is in the local-workspaces guide. Account Settings wiring,
conditional write synchronization, immutable retry receipts surviving generic
physical deletion, and conflict review remain unfinished. Do not route retained
accounts through anonymous storage or describe this groundwork as full account
support. Current source still needs final validation/indexing as that integration
continues; CI/deployed acceptance and the broad completion matrix remain open.

The rebuilt anonymous native regression also passes (46.86s) at 1440/390/320px:
no horizontal overflow, plaintext storage, account records/commands, protected
requests or browser errors. Screenshots were inspected; existing floating
assistant controls still overlap the narrow right edge. The checked-in API
fixture passes in 12.63s. Evidence: `tmp/provider-account-anonymous-regression/`
and `tmp/provider-account-api-repro/`. These checks cover anonymous UI and the
new account API boundary, not account UI synchronization.

## Shared Vault environment integrity and latest-main integration — 2026-10-17

Integrated main through `85af4382f` into the feature branch, preserving both test
script inventories (including iOS release checks). Incoming-mail local/offline
behavior is now explicitly included in the remaining acceptance matrix; its
remote credential/transport boundaries are unchanged. This was a branch update,
not a merge of this PR into main or a deployment.

A real loopback API fixture reproduced a generic Things deletion bypassing the
Vault's nonempty-environment check and leaving metadata sync unable to produce a
complete snapshot. The shared mutation recorder now validates environment
relationships in the accounted content transaction before the existing owner
Timeline-folder write. Generic creation/update/deletion and ordinary dedicated
writers share that invariant. No new ledger, index, collection or account-data
migration is introduced. Existing orphaned entries can be ungrouped or deleted.

The regression now passes through the real API, including invalid-create rollback,
nonempty deletion/conversion, stale/missing group references, valid edits, late
creation after deletion, and four concurrent trials (creation won all four).
Six focused invariant tests, 258 Timeline tests, Things suites (304 and 18 tests),
17 storage tests and 101 capability checks pass; these suite counts may overlap.
The ordinary original Timeline creation receipt also remained unchanged as a canonical entry
 after generic target deletion in a separate disposable API audit;
anonymous reads and uploaded API provenance were refused. This is evidence for
the future retry design, not a completed write-sync service.

Account provider write synchronization, fresh retention UI, the broader local
workspace matrix, exact-head CI and deployed acceptance remain unfinished.

Final local checks for this increment: production client build passes (248
verified offline-shell assets); the existing 91 TypeScript diagnostics are
unchanged, with no additions. Focused lint has no findings. The clean anonymous
Settings browser fixture passes on that build at 1440/390/320px with encrypted
storage, cold reload and zero account commands, protected requests, mutations or
page errors. Screenshots were inspected; no horizontal overflow, while existing
floating assistant controls still overlap the narrow right edge. This is not
account-provider sync or deployed acceptance.

The workspace/offline-shell suite also passes; opt-in integration skips are not
counted as acceptance. The explicit API/browser fixtures above were run separately.


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

Live API assertions recorded: 36. Evidence: `tmp/theme-sync-api/verification.json`, `tmp/theme-sync-quota/quota-verification.json`.

### 2026-10-17 — Native account themes and independent selection

Added a conditional selected-theme contract to the existing theme-sync route
and canonical secure writer, with transactional immutable Timeline receipts.
Wired device saves/deletes/apply into normal Theme Studio and separate worker
loops; exact conflict controls preserve copies privately. The native browser
fixture passed offline save/apply/cold reload, private content and selection
convergence, deletion, and desktop/390/320px layout. No offline mutation requests
or page errors. Focused tests: 38 passing; TypeScript: unchanged 91 signatures.

Remaining: protected theme History/account transfer and expanded browser
conflict/identity acceptance; latest-main reconciliation and current-head CI /
deployed verification. The earlier semantic graph run completed but failed its
historical source-hash check; do not use it as current semantic evidence.

### 2026-10-17 — Theme completion and anonymous History

Reproduced and fixed native Save returning before the current look had flushed
to device persistence. Anonymous theme writes now retain canonical protected
History and export earlier snapshots, including deletion before-images. Both
API manifests advertise the shared 1.21.0 export capability. Historical labels
and filtering recognize themes; the phone detail sheet keeps Export above the
default DevKit launcher.

Local validation: 509 local-workspace tests plus 4 offline-shell tests passed
(57 opt-in tests skipped in that broad run); 258 Timeline tests passed. Later
focused history/presentation/control checks passed 17/17 and capability checks
102/102. Clean-browser anonymous offline save/reload and actual History download
passed with zero mutation requests and zero page errors, at 1440/390/320px. The
account fixture passed immediate offline reload, concurrent conflict review and
private copy/selection remapping. TypeScript retains the same 91 baseline
diagnostics; lint and client build passed. These are local results, not CI or
deployed verification.

Semantic graph refresh for the prior f97e663d5 source was refused by its shrink
guard after incomplete semantic extraction; no partial graph was accepted.
The full feature matrix, account theme imports/exports and authored History,
latest-main reconciliation and current-head CI/deployment remain outstanding.
The branch remains unmerged.

### 2026-10-17 — Account theme portable export

The existing Theme Studio Transfer download now composes dedicated owned theme
snapshots with the canonical account exporter. New themes and pending edits
export offline; folder closures preserve home placement and reject cross-plane
collisions. The additive catalogue contract is api.themes-sync 1.2.0. Legacy
placement metadata requires a compatible refresh without overwriting local edits.
Prepared downloads refuse deletion and changed workspace identity; generic
protected writes remain unchanged.

Local validation: 139 focused checks pass; the server theme suite passes 26
checks with three opt-in skips. The real theme sync API test was run explicitly
and passed its private fixture, managed folder placement, version conflicts,
home/custom-plane and cleanup checks. The native browser test downloaded valid
JSON at 1440/390/320px while offline, with zero mutation requests or page errors,
then verified independent content/selection synchronization and deletion. The
canonical importer test remaps theme and folder IDs without losing tokens.
Client build and focused lint pass. TypeScript has the same 91 baseline
diagnostic signatures, not a clean check.

Evidence: tmp/account-theme-export-browser-final/verification.json and actual
theme-1440.json/theme-390.json/theme-320.json downloads;
tmp/account-theme-export-api/verification.json. The first new API fixture used
the wrong response envelope and failed cleanup; the corrected isolated fixture
passed. A subsequent attempt encountered a stopped local Nitro process after a
Node/V8 abort; the managed worktree stack was restored and the check rerun.

PR metadata still reports head 14f1e765d6 despite the verified remote branch
advancing; displayed checks cannot establish current-head CI. The reserved
preview responds with No build found. Current semantic graph coverage remains
unverified after the prior shrink-guard refusal. Account theme import, authored
History, the wider feature matrix, latest-main integration and exact-head CI /
deployed acceptance remain open. No merge or deployment is claimed.


### 2026-10-17 — Offline account theme import and duplication

Normal import/copy/fork now reuse canonical transfer validation and the existing
local transaction, with a dedicated theme queue hook. Fresh identities, normalized
tokens, home-folder placement and private intent commit together; active selection
is unchanged. Only the background sender waits for newly imported folder receipts.
Conflict copies retain existing folder placement without waiting for an absent
local create. Generic protected writers remain restricted.

api.themes-sync 1.3.0 adds optional placement to conditional saves, reusing the
canonical folder lock and managed placement validator inside the theme storage,
History and immutable-receipt transaction. Omitted placement preserves its value;
a selected custom plane cannot mutate home placement or attach a home theme to
its own folder. Standalone custom-plane theme imports remain available.

Local evidence: 104 focused tests; 518 full workspace passes and 60 opt-in skips;
four shell checks; explicitly run API fixture with 26 checks and cleanup; clean
browser import/reload/download/reconnect at 1440/390/320px, zero offline mutation
requests and zero page errors. Build passes. TypeScript retains 91 identical
baseline signatures; lint has no errors and one unchanged constructor warning.
The first API attempt encountered the stale 1.2.0 process, refused the new field
and cleaned up; the PM2 lifecycle refreshed it and the 1.3.0 rerun passed.

Evidence: tmp/account-theme-import-api-final/verification.json,
tmp/account-theme-import-browser/verification.json, its imported-folder.json and
imported-theme-{1440,390,320}.png. Prior export-source semantic extraction has now
completed; the import-source graph refresh is separate. General managed theme
moves/deletion, account-authored History, algorithms, the remaining matrix,
latest-main reconciliation and current-head CI/deployed acceptance remain open.
The PR stays draft and unmerged.


## Theme library organization — 2026-10-17

Normal mixed moves/deletes now include retained account themes through the existing
dedicated theme adapter. Local folder deletion drains children immediately, while
the remote folder queue waits for theme receipts, including lost-response replay.
Scoped deletion tombstones suppress stale reads. Home placement cannot follow
custom-plane folder collisions. Anonymous folder deletion now preserves contents
and standalone bytes; explicit recursive deletion remains available, and deleting
the active theme/algorithm clears its local selection.

A native browser run also found an unwanted computer-refresh warning while
offline. Device discovery now requires matching authenticated identity and pauses
remote polling offline while preserving cached snapshots. The rerun checks zero
offline device reads and no warning overlay.

Validation: 525 workspace checks plus four shell checks; 62 opt-in skips. Both
organization browser tests ran explicitly and passed against the built client
and isolated real API using disposable private fixtures. Account mixed moves,
folder drain, deletion, cold offline reload and independent reconnect sync pass;
anonymous folder drain/deletion make zero account mutations. Responsive evidence
covers 1440/390/320px; no page errors. Device suites: 80 passing. Client build
passes; TypeScript matches the same 91 normalized prior errors. Focused lint has
no errors and five pre-existing warnings. Evidence:
`tmp/account-theme-organization-browser-reviewed/`.

Account theme History, library title editing, home-partition integration, shared
gallery retention, broader identity/cache boundaries and the full acceptance
matrix remain unfinished. These are local results only; no merge or deployment.


## 2026-10-18 — offline theme display titles

Normal library Rename now commits theme display metadata locally for anonymous
and retained account content. Source names, tokens, selection, ownership and
visibility stay intact. Account writes use the existing dedicated conditional
sync command and immutable receipts; later renames cannot replace a frozen retry.
Older caches require title coverage before complete export. Canonical transfer
v1 preserves optional crystal.title through local and normal API import/export,
with fresh private copy IDs. Contracts: themes-sync 1.4.0, things-import 1.12.0,
things-export 1.16.0. Remote clients negotiate those versions.

A real offline account check found the Rename UI still requiring a network
manifest before calling its local adapter. Negotiation now belongs to the
selected adapter; the remote adapter keeps its check. The rebuilt client passes
both anonymous and account title/move/drain/delete workflows, cold reload and
reconnect at 1440/390/320px, with zero offline account mutations and no page
errors. The isolated API test proves normal remapped import/export, metadata
preservation/clearing, replay identity and atomic refusal. Fixtures use normal
API writes and cleanup. Evidence: tmp/theme-title-live-api/ and
tmp/theme-title-live-browser/.

Validation: 529 workspace passes plus four shell checks; 62 opt-in skips. The
browser and API fixtures ran explicitly. Client build passes; raw TypeScript
retains 91 baseline diagnostics with no new normalized signatures. Focused lint
has zero errors and six existing warnings. Title/transport/transfer and
capability checks pass. The previous organization semantic graph refresh
completed; the title source/docs refresh is recorded separately below.

Account theme History, home-partition integration, other protected-kind titles,
algorithm sync, wider identity/cache boundaries, latest-main reconciliation and
the full acceptance matrix remain open. No merge or deployment is claimed.


## Home receipt compatibility — 2026-10-18

Theme and active-selection retry identity now survives a selected-plane change.
New frozen device commands use home receipt context; old frozen commands retain
their original plane. The additive themes-sync 1.5.0 contract declares the home
destination separately from the mandatory current selected-plane/session fence.
Canonical home ownership, folder validation, quota, History receipts, auth,
same-origin admission and rate limits remain in force. Context is not database
selection or remote authority. Legacy callers retain their previous semantics.

Local edits still finish independently while an older command awaits a receipt.
The isolated real API fixture passes 58 checks, including owned home metadata
from a custom selection, exact retries from another selected plane, legacy
receipt preservation, altered context/body refusal, private transfer round-trip,
and selection replay without reapplying an obsolete choice. Cleanup uses normal
APIs. Evidence: `tmp/home-theme-context-live-api/verification.json`.

Applied-source validation: 532 workspace tests plus four shell checks pass;
62 opt-in skips remain distinct. The 104 capability checks and 72 focused
route/parser/manifest checks pass. Both native account and anonymous browser
fixtures run explicitly at 1440/390/320px: offline rename, move, folder drain,
theme deletion, cold reload and reconnect pass with zero offline account writes
and no page errors. Evidence: `tmp/home-theme-context-live-browser/`. Client
build passes (248 verified assets); focused lint has no errors or warnings.
Raw TypeScript retains the same 91 baseline errors / 47 normalized signatures.

The prior title semantic graph refresh exited unsuccessfully because its
completeness guard detected a shrink in account-theme documentation. It preserved
the existing graph; no partial override was used. The subsequent graph query
completed. Structural refresh evidence is recorded in
`tmp/home-theme-context-graph.log`; semantic freshness remains unproven.

This increment does not enable cache migration. The atomic same-account
home/selected transaction candidate remains isolated in ignored scratch space
with four dedicated tests passing. Home-cache consolidation must preserve all
pending conflicts and original receipt contexts, then integrate mixed imports,
selection, cross-tab invalidation and protected account History. Other local-only
feature families, latest-main reconciliation and full acceptance remain open.
No merge, production deployment or existing-account mutation was performed.


## Local home API and preserved migration foundation — 2026-10-18

The normal local account facade now accepts an explicit home destination while
retaining the selected-account lease. Mixed folder/theme/data imports stay
whole and are immediately editable, browsable and exportable with the canonical
transfer path. Generic home transport cannot run while a custom plane is selected;
the dedicated theme sender has its own existing selected-plane admission.
Mutable caller options cannot redirect an already-created facade.

Atomic home/selected storage transactions, bounded same-account partition
lookup, lossless legacy theme/selection consolidation and explicit home
cross-tab invalidation are now in the source tree. Active claims, uncertain
commands, conflicting versions, malformed state, deletion intent and local
relationships remain preserved. Filed themes never silently attach to an
unrelated same-ID home folder. Default screens have not switched to the new
home destination; migration activation still requires native destination
navigation and visible review of every retained variant.

Local validation: 557 workspace tests passed, 62 opt-in fixtures skipped, and
all four offline-shell checks passed. The focused migration/facade checks pass;
TypeScript retains 91 baseline errors with no new normalized signatures. Client
build passes (248 verified offline assets); focused lint has zero errors and
one existing constructor warning. The disposable-account native browser fixture
passes offline save/apply/reload/export at 1440/390/320px with zero offline
writes or browser errors, followed by independent private sync and cleanup.
Screenshots wait for the transfer menu to close before capture.

Evidence: `tmp/home-theme-integrated-workspace.log`,
`tmp/home-theme-facade-reviewed.log`, `tmp/home-theme-facade-authority.log`,
`tmp/home-theme-integrated-typecheck.log`, `tmp/home-theme-integrated-build.log`,
`tmp/home-theme-integrated-lint.log`, and `tmp/home-theme-integrated-browser/`.
These prove local regressions and programmatic home integration, not a finished
native cross-plane workflow, full feature coverage, CI or deployed acceptance.
Account theme History, the remaining feature matrix and latest-main acceptance
remain required before the requested merge.


## Native retained theme recovery — 2026-10-18

Theme Studio can review older local account variants without an account request.
It uses the existing visual preview, expandable exact data and the shared private
copy writer. Recovery verifies the reviewed source atomically, retains original
content/intent/placement/selection and records a local replay receipt so repeated
or concurrent recovery returns one private home copy. The existing Download
dialog exports it through the normal explicit-home API before synchronization.

Local checks: 560 workspace passes, 63 opt-in skips, four shell passes; focused
recovery/conflict tests pass. TypeScript retains the 91-error baseline without
new signatures. Build passes with 248 verified offline assets. Native browser
acceptance covers home-selected review of a retained custom-plane variant,
offline recovery and canonical exports at 1440/390/320px, source preservation,
reload/retry and zero offline mutation requests/server themes. Browser fixture
accounts are disposable; only that fresh browser's own legacy IDB is seeded.

Evidence: `tmp/retained-theme-workspace.log`, `tmp/retained-theme-final-unit.log`,
`tmp/retained-theme-final-typecheck.log`, `tmp/retained-theme-build.log`,
`tmp/retained-theme-final-lint.log`, `tmp/retained-theme-browser/`.
Full selected-custom native navigation, general home library routing, automatic
consolidation, account theme History and the broader coverage matrix remain open.
These are local results; current-head CI and deployed acceptance are unverified.


The additional native account-conflict regression exposed a harness defect:
it polled snapshot plus selection every 500ms against a 60/min endpoint and
assumed every response contained a selection. Its polling now checks one
operation at a time, reports HTTP refusals and allows the existing 60s claim
window. Production rate limits and claims were not changed. Rerun evidence is
recorded in `tmp/retained-theme-conflict-browser.log`.

The paced account-conflict rerun passes at all three viewports, preserving both
versions and the remapped selection through reload. The final retained-edit
browser rerun also explicitly checks the unchanged active theme and exactly one
recovered identity after reload/retry. Focused lint is clean apart from the
shared configuration deprecation notice.


## Local home library checkpoint — 2026-10-18

Home library is now an explicit account-bound native Things destination. Existing
folder/import/export/rename dialogs inherit the local API view, and normal account
workers retain their original root authority. Home links survive folder navigation;
foreign/malformed destinations fail closed. Home content and selected content use
separate optimistic caches and cut intents. Portable copy/paste still works, while
same-ID cut moves cannot cross destinations. Detail/inspect links qualify account
and data plane; their existing matching-plane guard is preserved.

The native offline fixture imports a mixed folder/theme/data bundle, renames it,
reloads and downloads canonical content at 1440/390/320px. It also restores a
custom local pointer in its disposable browser, creates separate selected content
and revisits home. This proves local routing, not live remote custom selection.
General cross-plane detail/editor navigation, account theme History, automatic
consolidation and the full rollout remain incomplete. New post/data links state
when they open the selected library. No merge or manual deployment occurred.

The full suite initially exposed a pre-existing 10ms timing assumption in the
late account-theme snapshot test. It now waits for its snapshot callback before
retiring identity; the real stale-response assertion is unchanged.
