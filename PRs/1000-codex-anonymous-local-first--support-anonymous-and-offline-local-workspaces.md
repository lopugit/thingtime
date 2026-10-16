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
