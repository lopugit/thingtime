# Unified Timeline

Implementation continues from the foundation merged to `main` in PR #956.
This is the accepted 2026-09-27 product contract; the acceptance ledger below
tracks the full scope beyond that delivered foundation.

The server retains the complete account timeline, including mutations made
through APIs, Actions and AI. Clients persist their own changes before sending
them and cache only history they are using. Opening a Thing loads recent history
and subscribes to refresh; older history is paged on demand. Remote changes do
not require the originating client to have been open.

## One record format

One browser-safe TypeScript contract validates the local and remote records.
`TimelineEventRecord` and `TimelineLink` in `app/timeline/records.ts` are stored
verbatim in both IndexedDB and Mongo's private binary envelope. Each event and
each relationship is its own record. A receipt adds server ordering and proof of acceptance without changing
the authored event or using client clocks to resolve conflicts. Queue state,
cache access times and paging cursors are local bookkeeping, never event fields.

Each history event is an atomic, protected Thing beneath the account's private
**Timeline** folder; `targetId` identifies the affected Thing. Accumulating
events are never embedded on that Thing or the folder. The database's ordinary
Thing envelope wraps the same canonical record that the client stores. Separate
`timeline-link` Things join events to affected Things, branches, operations,
parent revisions and exact dependency revisions. Many events can reference the
same dependency, and a version can have many children, without rewriting any
earlier document. Branch membership and heads must follow this relational rule;
never add accumulating revision/head/dependency lists to a branch or Thing.

Stored event records have immutable scalar parent/dependency counts so missing
links fail closed. They contain no `parentIds` or `dependencies` arrays. The
bounded API/view aggregate assembles those lists on read for compatibility;
transport batches are not document storage. The shared split/join validator
checks exact link identity, owner, ordering and completeness. Snapshots
use explicit adapter ids/versions; no executable serialization or runtime object
capture is permitted. Existing persisted rich values use the canonical codec.

Account, API origin and data-plane scope isolate every cache and pending queue.
Pending events are never evicted as cache. Acknowledged events may be evicted and
fetched again. Losing a reply after a commit must retry the same operation id and
payload; changed-payload reuse is refused. Guest drafts cannot be uploaded into
an account implicitly.

## Writes and concurrency

Canonical server mutations append their event in the same transaction as their
content and storage accounting. Recording only in a React editor or HTTP route
is insufficient: dedicated writers and internal Action/AI calls must participate.
Failed mutations create no successful-change event. Protected operational kinds
use bounded outcome adapters, never credential snapshots. Timeline's own storage
bookkeeping does not recursively generate timeline events.

Local draft events and committed Thing revisions share the graph but remain
explicitly distinguishable. Uploading a draft event does not silently apply it
to the live Thing. Remote refresh cannot overwrite a dirty draft. Divergence
preserves both branches; merging uses a common ancestor and presents overlapping
changes for resolution. Restoration creates a new change rather than deleting
later history. External effects are described but never replayed during restore.

The same History entry opens from Things, Builder, Component definitions and
instances, prop editors and rich text. The default view uses readable change
labels, preview, compare and restore. Branch, merge, push and pull controls expose
the same graph when needed. Component/Schema/Action dependencies must retain
exact revision references for a historical page preview.

## Delivery and acceptance ledger

- [x] Shared strict event/receipt schemas and immutable identities.
- [x] Durable pending queue and bounded cache with on-demand paging.
- [ ] Private Timeline folder, protected event Things, authorization, storage
      accounting and transactional server recording.
- [ ] Canonical Thing CRUD and dedicated mutation coverage audit; API-only
      changes appear without a client-side recorder.
- [ ] Sync endpoints, capability negotiation, retries, live refresh and
      identity/data-plane fencing.
- [ ] Builder, Component/props and rich-text adapters; draft recovery; AI edits.
- [ ] Shared History UI, previews, compare, restore and dependency revisions.
- [ ] Branch, version, merge, push and pull workflows with conflict handling.
- [ ] Timeline folder browsing and meaningful cache/history controls.
- [ ] Regression coverage for offline/reload, lost replies, concurrent tabs and
      clients, API writes, partial caches, pagination, quota and access changes.
- [ ] Real API replica-set checks, desktop/mobile browser checks, complete
      build/type/lint checks, Graphify refresh and reviewable PR.

Related but separately scoped: [experience checkpoints](../TODO/claude-todo/20-versioned-experience-history.md)
retain feed/search membership and viewport state. They should adopt the shared
contract rather than create another synchronization system.

## Implementation evidence — 2026-09-27 (in progress)

Server Action and Lopu tool executors now establish trusted, account-scoped
provenance for canonical Thing mutations. Each invocation has one operation id;
every committed step has its own event and relational operation link. Nested
Actions retain the initiating source, so an AI-invoked Action is attributed to
AI. Server-hosted browser Actions keep that context through their ordinary API
dispatcher. Concurrent invocations and unrelated actors cannot inherit it;
headers, tool input and authored program fields cannot establish it. Existing
local/remote schemas are unchanged. A partial Action failure retains history
for its committed steps, without inventing events for refused steps. This
operation id groups writes; it is not an execution retry or replay token.

Preparing a browser Action does not claim execution. Requests made later by an
ordinary browser client remain API-originated until a verified execution
receipt protocol is implemented. Complete Action outcome history, including
read-only runs and external effects, remains open; the bounded legacy Action
run log is not the full Timeline. No protected inputs, credentials, traces or
provider results are added to generic content snapshots.

This increment passed 62 Timeline tests, the Action and Lopu suites, both
capability manifests and the disposable HTTP replica-set regression. Browser
History showed API and Action origins together and compared a nested Action's
exact field change. The full Vite/Nitro/Vercel build passed. The warning-only
typecheck ratchet remains at the existing 91 diagnostics versus its 89 baseline,
with none in this increment's changed files; this is not a clean typecheck claim.

The branch currently records ordinary owned Thing creates, updates and deletes
in their content transaction. The account's Timeline folder contains separate
protected event Things. API-only mutations were exercised against a disposable
Mongo replica set, including stale concurrent writes, exact retry receipts and
private-history isolation. Protected operational families still need explicit
safe outcome adapters; folder reparenting and dedicated writers remain in the
coverage audit. History retention/quota behavior is not yet complete.

Builder block/prop changes and definition source changes now enqueue the shared
event format through IndexedDB before a network save. The account sync provider
drains this queue independently of the History modal. The browser test added a
text block, edited it, reloaded without saving, recovered the exact text, then
saved successfully. This is local test evidence, not a production claim.

An atomically maintained small IndexedDB index supports quota checks, targeted
reads and pruning without loading every snapshot. Pending events and the latest
unsaved draft per editor branch survive cache eviction. A save releases only the
draft it actually published; later edits remain recoverable. API page reads first
select small headers, then fetch only enough immutable payloads for the response
byte budget. The complete remote timeline is never downloaded eagerly. Active
editors subscribe to recent history for their Thing, with in-flight page reads
shared with an open History panel.

Envelope v3 normalizes relationships into their own protected Things; v1/v2
envelopes remain readable without rewriting immutable history. IndexedDB v4
upgrades earlier cached/pending events into identical event/link records in one
transaction, preserving current draft pins and released-draft state. Event,
links and metadata commit or roll back together; cache pruning deletes only the
evicted event's local links. Missing links preserve the pending row and surface
an error instead of inventing an empty ancestry. Link documents use the existing
`targetId/thingtime/createdAt/shareId` forward index and
`crystal.targetId/crystal.linkKind` reverse index; no new index was added.
Ancestry fetches exact deterministic parent-link ids through the shared unique
`shareId` index, without scanning dependency memberships or snapshot payloads. Page selection also
budgets link-record bytes, so small snapshots with many dependencies do not
produce an unexpectedly large relational join.

On the disposable HTTP fixture, account history examined 12 keys/documents for
12 rows, per-Thing history examined 10 for 10, forward links 3 for 3 and reverse
links 10 for 10. All four used the existing indexes with no collection scan or
blocking sort (0-1ms in this small local fixture; not a production-load benchmark).

Envelope v2/v3 meters retained customer snapshot content separately from platform
event metadata; v1 records keep their prior accounting definition. A deletion
moves the exact logical payload bytes into history in the same transaction,
including when the account is already over its allowance. Unknown ledgers stay
fenced for reconciliation. Retention therefore does not free space merely by
deleting the live Thing. The opt-in `test:timeline:quota` now verifies exact
ceiling behavior through the real API on the disposable replica: growth,
retained shrinking edits and restore application refuse atomically, while reads,
previews, folder moves, folder deletion drains and Thing deletion still work.
Deleted content's exact bytes remain charged and retry adds no event or charge.
The ordinary subscription API refuses an allowance below current usage with
409; this test verifies that refusal without changing its guard. The storage
error explains retained history instead of advising deletion as a way to free
its bytes. Above-limit legacy-ledger acceptance and retention controls remain
open; no direct database seed or production mutation was used for this proof.

Relational regression coverage includes shared dependency versions, forked
ancestry, missing/foreign/substituted links, IndexedDB upgrade and atomic cache
pruning. The real HTTP restore/merge suite also passed with v3 storage. These
checks validate the current foundation; automatic dependency capture and full
branch editing/merge workflows remain in the delivery ledger.

Run `npm --prefix remix run test:timeline`. The opt-in integration command is
`TIMELINE_TEST_BASE=http://127.0.0.1:<isolated-api-port> npm --prefix remix run
test:timeline:integration`; it refuses to create fixtures unless the API reports
the disposable `timeline-rs` replica set at `127.0.0.1:20337`. It never seeds app
data through direct database writes. Do not point it at a shared database.

Version preview/apply now uses `api.timeline` 1.1.0. Restores and three-way merges
pass through the normal Thing validation and quota transaction. They compare the
exact live head, reuse an immutable request identity after uncertain responses,
and append a revision instead of erasing history. Independent object fields
merge; overlapping edits, delete-vs-edit and arrays require explicit choices.
Small graph headers bound ancestor traversal without loading every snapshot.
Missing/foreign ancestors and multiple merge bases refuse safely. Ordinary
Thing content, webpage drafts and valid definition source are supported; deleted
Thing resurrection and applying merges to a named branch remain open.

Named branch create/push/pull and private exact-version reads use `api.timeline`
1.2.0. `TimelineBranch` and `TimelineBranchHead` in `app/timeline/branches.ts`
are identical local/remote records: metadata lives once per branch, and each
branch/Thing membership has its own head document. Neither contains a growing
membership or revision array. Server transactions append an immutable audit
event, account for retained data, and compare-and-swap one head. Push accepts
only descendants of that head; divergence is retained for explicit resolution.
Commands never change the live published Thing.

IndexedDB v5 adds separate branch, head and pending-command stores. Commands are
durable before transmission, and uncertain replies retry the original request
and id. A late reply cannot rewind a newer cached head. A definitively refused
command stays actionable while unrelated branch commands continue; only that
refused command can be dismissed. Its selected version remains in History.
Commands queued during an upload wait for the next pass so their new source
versions upload first. The UI checks actual acknowledgment before saying a
branch was saved to the account. Per-branch refusal does not claim History
reads are broken.

The disposable HTTP suite covers named branch creation, exact replay,
simultaneous pushes with one winner, forward-only updates, two independent Thing
memberships in one branch, pagination, private exact-version reads, generic
branch CRUD refusal and foreign-account refusal. The client suite covers
concurrent IndexedDB tabs, reload, cache eviction, stale acknowledgments,
uncertain replies, rejected-command resolution and in-flight event ordering.
Per-Thing History exposes named alternatives through **Branches**, with pull,
view, and push controls. The named-branch merge increment below extends these
controls. Branch checkout/edit mode and historical dependency rendering are
still required.

Browser checks created and pushed a named branch, reloaded it, retried and
retained a refused backward push, then cancelled only that refused command and
viewed the accepted head. Desktop and 375×812 controls were reachable; the mobile
dialog measured 351px client/scroll width with no horizontal overflow. A clean
reload retained the earlier drafts and branch state after the IndexedDB upgrade.

The HTTP replica-set test passed restore/retry, stale previews, non-overlapping
merge, unresolved-conflict refusal and explicit resolution. Browser checks
restored the test page to its original empty state, then restored the later text
again; both new revisions remained in History and the clean editor refreshed.
The controls were exercised at desktop and 375×812. These are disposable local
checks, not production evidence.

Edits arriving before Timeline discovery retain canonical ids and snapshots in
the recorder until it can write them. A capture failure blocks a later false
successful flush. Initial discovery no longer resets an already-open editor;
actual account/data-source changes still fence it. Edits made during a save stay
dirty; background reads preserve the original dirty draft's version fence.
Late AI saves follow the same rule: only a clean editor or exact dirty-content
acknowledgment adopts their saved blocks. Newer typing, deletion to an empty
page, metadata-only replies and earlier timestamps cannot clear a divergent
draft. Accepted saves carry the correct Timeline head; new Thing identities
cannot inherit a previous Thing's head. This guard has focused regression
coverage; an actual concurrent AI-provider/browser run remains unverified.

Lopu's omitted page context now retains readiness/dirty/base-version metadata.
Known-clean saved pages load their authorized stored blocks; missing dirty or
unready drafts cannot be treated as an empty tree or persisted. Focused actual
route/tool tests and the Lopu suites cover continuation and explicit empty pages.

Still required before delivery: full mutation coverage, first-paint/offline and
scope-switch acceptance, standalone rich text and new unsaved Thing capture,
dependency revision references, deleted-Thing recovery, branch editing/merge,
history/cache and retention/quota controls, full validation and the reviewable
PR. The acceptance ledger above stays open until these behaviors are verified.

## Validation checkpoint — 2026-09-27

The complete Vite/Nitro/Vercel build and output verification passed after the
branch queue and late-AI-save fixes. Lint across all 77 changed JavaScript and
TypeScript files found no errors (28 warnings, including existing warnings in
shared files). Raw TypeScript reports 91 diagnostics against its configured baseline of 89.
The existing warning-only ratchet passes; the baseline was not increased. Full unit-suite
validation is still being audited separately from the focused Timeline and
real HTTP integration checks above.

The local semantic proxy health check timed out. Structural code graph refresh
continues, but changed Markdown is not claimed to have fresh semantic coverage.

## Large version retention

A pre-merge regression check found that a valid Thing can grow beyond the
bounded Timeline event size through ordinary patches. Requiring its complete
before/after data inside one event stranded later edits and deletion. Large
snapshots now use the shared `TimelineSnapshotPart` format: each bounded fragment
is a separate protected `timeline-snapshot-part` Thing linked to its event by
parentId/targetId, side and ordinal. The event keeps only scalar reference,
completeness and integrity metadata. Parts and event commit in the content
transaction; no growing arrays are stored on either record.

The parent event meters the original retained content exactly once. Missing,
foreign or altered parts fail closed on reconstruction. Client uploads cannot
forge server snapshot references. Small snapshots remain inline; history pages
do not eagerly fetch large payloads. Browser caches retain the same canonical
reference in the event, and the shared part schema is available for on-demand
payload caching rather than a second client representation.

The real HTTP fixture grew a Thing beyond 2 MiB through bounded API patches,
shrunk it, restored every original field from retained parts, and deleted it.
Generic reads/deletes refused the protected parts. Full large-version UI preview
and streamed restoration beyond the existing 4 MiB version-content budget remain
in the active goal; History labels the retained data honestly rather than showing
internal part metadata as a content diff.

## Folder placement increment — 2026-09-27

Folder deletion now moves direct children in bounded transactions before the
root is removed. Each child and its event commit together; one operation links
all moved children and the final folder deletion. Subfolder descendants retain
their placement. A partial drain keeps the physical root and returns a retry;
retrying does not invent events for children already moved. Canonical creates,
moves, managed library placement and archive imports write the same private
ancestor fences, without changing ancestor content or its visible edit time.
Those writes make concurrent deletion and four-folder cycle races conflict.

The shared `folder-placement` version-1 adapter stores only a folder id after
an ordinary Thing already has a saved content ancestor. The first legacy move
still captures a full baseline. Restore and merge follow exact saved ancestry;
they never use the current Thing as historical content. Explicit restore/merge
retains a full result and its existing retry contract. The protected library
families use `managed-folder-placement`, containing only folder ids. Their full
content history and dedicated restore adapters remain open. Placement metadata
is unmetered platform bookkeeping; client-authored drafts remain metered.
These are identical local/remote snapshot formats within the existing relational
event/link storage. No growing list is added to a Thing or folder.

`api.timeline` 1.3.0 advertises compact placement restoration and comparison;
`api.things` 1.33.1 advertises the corrected placement transaction behavior.
History labels moves explicitly, calls the root “My Things,” and the open Thing
page refetches after restore/merge while retaining its last projection.

The disposable HTTP checks cover creation/deletion races, competing ancestor
moves, protected theme metadata, preserved subtrees, missing-destination refusal,
105 children across drain batches, exact replay, and reconstruction through four
consecutive moves. Run `TIMELINE_TEST_BASE=http://127.0.0.1:<isolated-api-port>
npm --prefix remix run test:timeline:folders`; both scripts require the same
strict disposable replica-set guard as the main integration suite. Fixtures are
created through ordinary account APIs, including supported bulk-copy requests.
Exact-ceiling coverage is described above; already-over-limit legacy-ledger cases and further protected writer coverage remain open.

## Protected library display names — 2026-09-27

Advertised by `api.timeline` 1.4.0 and the compatible `api.things` 1.33.2 fix.
The dedicated Things display-title writer now records theme, feed algorithm,
custom emoji and chat-archive renames in the same transaction as their content
and storage accounting. Each event uses the shared `library-title` version-1
snapshot (`{title: string | null}`) in both local caches and remote storage. A
missing historical display title is null; the source name and protected payload
are never captured by this adapter. History presents **Renamed theme/algorithm/
emoji/chat archive**, the before/after titles and the exact previous saved head.
Unchanged titles add no content event. Refused writes add no successful event,
and a history/head failure rolls the rename back. Retained title content counts
against the existing history storage allowance.

This covers the existing home-account, first-party display-metadata operation;
its user/account/origin/data-plane restrictions remain unchanged. It does not
provide generic protected-content restore or claim that theme/algorithm/emoji/
archive creation, payload updates and deletion are all covered. Those dedicated
writers and restoration adapters remain in the open coverage audit above.

The opt-in `test:timeline:library` script uses the same disposable replica-set
guard as the other Timeline HTTP checks. It verifies title-only events, stale
and forged-input refusals, exact parent chains, independent API operation ids,
unchanged-title suppression and the original identity's preservation. Unit tests
cover all four supported kinds and rollback on recording failure.

Browser validation also caught a stale title on the Thing permalink after a
successful menu rename. It now updates its matching in-memory projection and
refetches through the existing identity-fenced loader. The shared optimistic
rename helper preserves managed source names and attachment names, matching the
dedicated writers instead of briefly inventing a change to protected identity.

Temporary read failures after a mutation or cached reload preserve the matching
Thing projection and expose Try again. Explicit authorization, identity and
missing-record refusals still clear it; private diagnostics remain live-only.

## Saved theme content — 2026-09-27

`api.timeline` 1.5.0 and `api.themes` / `api.themes-delete` 1.1.0 add approved
modern saved-theme create, update and delete revisions to the same relational
Timeline folder. `theme-content` version 1 is shared by client and server. It
whitelists name, optional display title, versioned theme tokens, tags, visibility
and folder placement; private root/crystal extensions are not copied. Historical
partial token documents stay partial: current defaults are never substituted.
The strict decoder rejects extra fields, unsupported versions and invalid token
types. Future theme fields require an explicit versioned history contract.

The dedicated writer captures server provenance once outside transaction retries,
then commits content, the history event/links and its saved head in the same home
transaction. That head can follow an existing display-title or protected folder
placement event. A no-op adds no content event; a failed append/accounting/head
write rolls content back. The home accounting choice is explicit even while a
custom endpoint is active. History remains private when a theme becomes public.

Validated server snapshots meter the approved crystal/tags through the ordinary
logical payload definition; bounded organization metadata remains overhead.
Client drafts retain their full existing metering. Deletion transfers the
approved retained payload after the live refund, without new growth admission.
It cannot retain more customer bytes than the removed theme and leaves unknown
ledgers fenced. For normal dedicated-writer rows, retained and deleted bytes are
identical. Unsupported private extensions are intentionally not history content.

The guarded HTTP scripts use normal synthetic account APIs on the disposable
replica. `test:timeline:themes` covers creation with a custom selection, exact
home accounting, normalized tokens, trusted provenance, identical saves,
rename/move/content ancestry, visibility, refused saves, history privacy and
exact deletion/retry. `test:timeline:quota` also exercises the dedicated writer
at the exact allowance ceiling. No production fixture mutation is required.

Dedicated theme restore/merge, active-theme selection and legacy-theme storage
coverage remain open. Generic protected-content restore stays refused; the
existing migration-only conversion and legacy/readiness fences are unchanged.
These events do not imply coverage for every protected Thing family or external
Action outcome. Home-history discovery is addressed by the scoped sessions below;
this does not establish universal operation coverage.

## Home and selected database history — 2026-09-28

Timeline 1.6.0 adds explicit `storage=home`; omitted/selected storage follows the
current data plane. Expected `ownerId` and `dataPlane` remain independent fences.
The request-local home context spans authorization, exact reads, draft uploads,
branch operations and version preview/apply. It restores the surrounding custom
context, including concurrent async requests, without modifying the cookie.
Selecting the actual home URI also identifies as home, matching collection routing.

The account provider keeps home and selected sessions, sharing one pooled
connection when their canonical origin/owner/data-plane keys match. Closing or
switching one session releases its lease; the other continues draining pending
edits. Each distinct database keeps its existing IndexedDB event/link/branch
schema and queue. Discovery metadata is separate; no event is moved or translated.
Full account refusal redacts both active sessions' downloaded caches while
preserving authored pending data. Temporary network failure keeps the matching
cached history visible, and cached sessions cannot push until verified.

Saved themes expose History directly. Managed personal-library Things choose
home history from their known kind; ordinary Things and Builder use the selected
scope. The complete History panel, including branches and version actions, uses
one session. Open Timeline retains that location and closes the modal. The folder
view offers Home account and Selected database without changing the browser's
database selection. Cross-source Open Thing was initially disabled; the next
increment below provides an explicit home handoff. Remaining managed-family
coverage still needs further work.

The guarded HTTP acceptance uses ordinary synthetic accounts and two databases
on the disposable replica. It verifies identical event ids with different
payloads, private home theme history, exact-version reads, home branch creation
and restoration under a custom selection, stale/wrong-account refusals and
concurrent request isolation. Connection tests exercise one shared in-flight
upload, lease release, persistent queues and separate caches for matching ids.

Local acceptance passed with the real two-database API script and desktop/390px
browser checks. Home and selected cached pages survived blocked Timeline
requests independently; simulated 403 responses cleared both visible caches,
and removing the refusal restored server history. Theme History opened home
under a custom selection and Open Timeline dismissed the modal. The new mobile
button row and history views had no horizontal overflow. The test browser's
selection and network/viewport overrides were restored after acceptance.

Validation: 74 Timeline tests, 92 capability tests, 4,218 passing full unit tests
(8 skips), complete production build and targeted lint with zero errors. Raw
typecheck retains the existing 91 diagnostics, with none in the changed/new
modules. These checks establish this increment, not the remaining universal
operation and version-control coverage listed above.

## History-to-Thing database identity — 2026-09-28

**Open Thing in home** explains that it changes the selected database, uses the
existing endpoint reset, and navigates to a link pinned to the event's account
and database. All ordinary History links carry those same public identities.
A mismatched link shows an account/database recovery action before mounting the
Thing view. Custom Thing pages explain the existing home-only comments limit.

The canonical database key is shared with Timeline without changing any event,
link, branch, outbox or IndexedDB scope format. Root data exposes that key;
Thing caches include it and never seed from ambiguous legacy cache entries.
Endpoint changes reuse root identity invalidation across tabs, and selected
Timeline discovery caches must match the root database identity. This increment
does not claim that every unrelated application cache is database-qualified.

`api.mongodb-endpoint` 1.1.0 negotiates the optional expected-data-plane header.
Shared fetcher mutations, Thing reads and Timeline discovery capture the source
before awaiting capability discovery. The dispatcher refuses a stale source
before reading or writing a same-id Thing. Explicit home Timeline routing still
checks the browser's selected source first. Endpoint reset remains available
for recovery. Legacy clients can omit the header; it grants no authorization
and never changes routing. Ordinary source-fenced requests use the same fallback
as root identity, preserving the selection and header for upstream enforcement.
The existing actor-fenced and vault fallback refusals remain in place.

The two-database HTTP suite now creates matching live Thing ids, verifies stale
GET/PATCH/DELETE refusal and unchanged history, and confirms accepted edits stay
in the selected database. Browser acceptance covered two tabs, blocked reads,
each database's cached view, explicit home handoff, pinned-source and pinned-
account guards, and a home rename with independent API confirmation that custom
content/history stayed unchanged. Desktop and 390px views had no horizontal
overflow. The test's network/viewport overrides were removed and home restored.

Validation: complete production build; 4,224 passing unit tests (8 skips);
final 74 Timeline and 36 root-data tests; 315 Things, 60 collection and 92
capability tests; changed-source and integration-script lint with zero errors.
Raw typecheck still reports 91 existing diagnostics, none in changed/new
modules. The root-data suite also exercises the real dispatcher/proxy with a
mocked upstream: forwarded root identity, cookies, selection, GET/PATCH bodies,
matching success, stale-source refusal and unchanged actor/vault restrictions.
The complete universal-history and version-control ledger remains open.


## Signed-out connection guard — 2026-09-28

The History-to-Thing identity check could compare two absent owner ids as equal
and then read a null connection while rendering the home Timeline session.
`timelineConnectionForViewer` now requires both the viewer and connection before
checking account and database identity. Signed-out pages render normally; a
cached connection for the same signed-in viewer still paints immediately during
discovery, and a stale account/database connection remains hidden.

The focused regression covers missing connection, absent viewer, sign-out,
account change, data-plane change and valid cached reuse. This correction changes
no local/remote event schema, queue, API contract or storage behavior.


Browser acceptance reproduced the original null-scope exception after logging
out. The corrected local app then passed login → private Timeline → logout →
reload, with working forms on desktop and a 390px viewport (375px content width,
375px scroll width). Screenshots: [desktop login](../PRs/assets/timeline-signed-out-guard/login-desktop.png),
[mobile login](../PRs/assets/timeline-signed-out-guard/login-mobile.png),
[private History](../PRs/assets/timeline-signed-out-guard/history-desktop.png).


## Named-branch merge review — 2026-09-28

**Merge selected version…** compares the selected History version with one
exact named branch head and their unique shared ancestor. Independent edits
combine automatically; overlaps reuse the same field choices and comparison
component as ordinary Thing restore/merge. The review names its target and
selected version, remains bound to that account/database/head, and never
publishes the live Thing. Cancel/reopen and development effect replay create a
fresh request lifetime instead of reusing an aborted signal.

`api.timeline` 1.7.0 adds only a read-only `preview-branch-merge` command. Applying
uses existing schemas: first persist a canonical client draft `merge` event
with two independent parent links, then persist an ordinary `advance-branch`
command. Existing synchronization uploads the event first, retries immutable
identities, and commits the branch compare-and-swap plus its effect receipt.
Local and remote event, link, branch and head records are unchanged. No new
collection, index, setting or IndexedDB migration is required.

A failed local command enqueue leaves the captured version in History and
allows retry with the same proposal. Offline/reload preserves both queued
records. A lost server reply retries the same command; a stale branch revision
refuses its push and keeps the merged event. The account's full history remains
remote, with bounded local caching and the existing private Timeline folder.

The shared materializer also fixes compact draft ancestry: a folder move before
a definition/page draft must survive reconstruction. It loads only the latest
replacement of each compact field plus the nearest full snapshot, in a bounded
batch, rather than every obsolete draft payload. Missing, foreign, cyclic or
ambiguous ancestry fails explicitly. The folder integration test now counts
managed placement events in addition to the already-recorded theme creation.

Validation includes canonical schema/link round trips, fenced comparison and
conflict choices, IndexedDB reload/lost-reply/stale-push retention, response size
limits, and real disposable replica-set HTTP integration. Browser acceptance
reviewed a colour conflict, saved with Timeline requests blocked, reloaded the
pending merge, reconnected and synced once. API readback found one merge and
branch revision 2 while published colour/layout remained Original. Mobile at
390px measured 375px client/scroll width; both conflict choices and the existing
live restore review remained usable. Temporary network/viewport overrides were
removed. These are local acceptance results until this increment is deployed.

Still open: named-branch checkout/editing, exact historical dependency rendering,
protected-family restore adapters, remaining mutation/outcome coverage, rich-text
and unsaved Thing drafts, deleted-Thing recovery, large streamed version
operations, retention/cache controls and the broader acceptance ledger above.


Screenshots: [desktop conflict review](../PRs/assets/timeline-branch-merge/conflict-desktop.png),
[mobile conflict review](../PRs/assets/timeline-branch-merge/conflict-mobile.png),
[pending merge after offline reload](../PRs/assets/timeline-branch-merge/offline-reload-mobile.png).


### Named branch field checkout — 2026-09-28

History → Branches → **Edit branch** opens that exact version in the shared
Component/Action/Data field editor. Each field edit records an ordinary full
`thing-content` client draft before the branch can be pushed. **Save to branch**
enqueues the existing revision-fenced `advance-branch` command; published Thing
content is untouched. Close and reopen to continue editing a saved branch.

`api.timeline` 1.8.0 adds the read-only `checkout-branch` command. It requires the
branch id, Thing id, exact head id and revision, and returns the original canonical
entry alongside a transient materialized snapshot. It uses the same bounded
historical content reader as restore/merge and preserves folder ancestry. No
collection, index, persistent schema, IndexedDB version, setting or environment
variable is added. Responses are private/no-store and limited to 4 MiB.

Cached full heads appear immediately while checkout refreshes. A refresh never
replaces edited fields. Field drafts use the existing relational event records
and pin, survive reload, and can be resumed explicitly even offline. The complete
remote Timeline remains authoritative; a stale or divergent push preserves the
version and requires an explicit merge. Concurrent edits cannot silently advance
over a different head. A corrected bounded edit can recover after an oversized
capture; an uncorrected failed capture still refuses a successful flush.

This increment provides field editing for supported `thing-content` versions.
Visual Builder branch switching, rich-text source editing, exact historical
component dependency rendering, managed/protected content adapters, deleted Thing
recovery and versions above the current preview limit remain open.


### Direct named branch lookup — 2026-09-28

`api.timeline` 1.9.0 adds `GET /api/v1/timeline` with `ownerId`, `dataPlane`,
`branchId` and `thingId`, plus optional `storage=home|selected`. The response is
`{ok,branch,head}` using the existing canonical branch and per-Thing head records.
This supplies a cold editor with a named branch pointer without downloading the
branch directory or relying on a bounded local cache. It reads two owner-scoped,
exact record identities through the existing collection/index paths. Missing
membership returns 404; duplicate or mixed lookup/page/version selectors return
400. Account and data-plane preconditions remain enforced before storage reads.

The client negotiates 1.9.0 and checks the returned account, branch and Thing.
`TimelineSync.branchHead` accepts the pointer into the existing bounded cache
without acknowledging any queued command or changing version content. A delayed
reply cannot rewind a newer cached revision, and stopped account/source sessions
cannot adopt their in-flight reply. Checkout still requires the returned exact
head and revision: a concurrent push between lookup and checkout returns 409.

This is a prerequisite for visual Builder branch loading. It adds no Builder
branch switcher or runtime behavior, persistent schema, collection, index,
IndexedDB migration, configuration or environment variable. Named branch field
editing continues through the existing History interface. The broader remaining
scope above stays open.


## Visual named-branch editing — 2026-09-28

History → Branches → **Open in Builder** opens the exact named branch in the
existing visual canvas, toolbar and inspector. Text, component-instance args,
layout, name and audience changes adapt the same full content snapshot into
`TimelineDraftRecorder`; no published Thing writer or AI save bridge is mounted.
Toolbar and inspector saves finish inline editing before reading the snapshot;
the first inline edit enables Save and pointer focus stays stable through its
click. The shared `TimelineBranchWorkingCopy` also powers the field editor. Successful
saves advance its parent/revision for the next edit. An uncertain push freezes
its immutable command; stale pushes preserve the version and direct the user
to History. Discard serializes with edits/saves and releases only its draft pin.

Account/source-qualified links, cached heads and canonical events support warm
loads and offline recovery. A cold server response may refresh an untouched
cached checkout but cannot replace an edit or queued command. Reopening from
History deliberately starts a fresh checkout. Queued pushes recovered after
reload remain read-only until reviewed/synced in History and reopened. React
StrictMode cleanup cancels only the old load and permits its replacement.

`api.webpages-resolve` 1.5.0 adds a private read-only POST with exactly `{blocks}`
and `ownerId`/`dataPlane` query fields. It sanitizes the normal bounded block
format, resolves all referenced components with the authenticated viewer in
one batch, and never accepts a stored page/root audience grant. Request bodies
are capped at 192 KiB, sanitized blocks at their existing limits, and responses
at 4 MiB. Anonymous, mismatched-scope and rate-limited requests refuse before
resolution. Current component responses have an optional account/origin/source/
branch/Thing cache, bounded to four entries of 256 KiB each. This rendering
cache does not change canonical history schemas.

The branch preview explicitly uses **current** visible components. Page source
runtimes, native sections, suite installation and live Actions are disabled,
including authored `mode=run` links. Publish/Visit/transfer controls are hidden
or disabled in this editor. Exact historical dependencies, AI branch editing,
and broader managed adapters remain in the open acceptance ledger.


## Recorded component definitions — 2026-09-28

Page mutation transactions now append a `component-binding` capture per distinct
authored ref. Its approved snapshot is `{ref,component:{id,crystal}|null}`; each
binding is an ordinary immutable Timeline event linked by the existing atomic
relationship records. There is no growing refs/history array on the page and no
new persistence format. Unchanged bindings from the preceding page version are
reused. Server captures use the live page's existing batched component resolver,
including author-local keys, with component reads inside the content transaction.
The owner-private history retains only readable definitions, never a source
owner's private event graph, ACL/grants, hidden keys or database envelope.
Previously readable shared definitions remain a private point-in-time copy if
the original changes or sharing is revoked. New captures reevaluate access.

Builder device drafts capture the components actually rendered by the editor.
Individual capture events enter the same durable outbox before the page event;
uploads already order dependencies before their consumers. Branch working copies
carry those exact links through saves, field edits, recovery and discard. The
bounded canonical event cache replaces the earlier branch-only current-component
render cache. It may evict acknowledged definitions; older/missing records load
on demand. Pending events remain protected. Offline previews therefore depend
on the relevant definitions still being cached, rather than downloading every
component version to every device.

`api.timeline` 1.10.0 adds `GET components=1&eventId=...` with owner/dataPlane and
optional storage scope. It resolves only that event's direct component links in
one bounded batch (maximum 120), preflights server byte metadata before decoding
payloads, and caps the response at 4 MiB. The client validates every owner, event
and linked target before caching. The same existing collection/index/ACL and
quota rules apply. Run `test:timeline:components` against the guarded disposable
local replica set for API-only capture, unchanged-definition reuse, source
changes/revocation, private reference refusal and identity fences.

History **Preview page** and visual branch checkout use recorded definitions by
default. Current definitions require an explicit preview choice. Incomplete old
versions never silently claim current definitions as historical. Preview Actions
and live sources stay inert; media bytes and theme appearance may change
independently. The branch banner leaves room for the inspector, and its History
preview has a distinct React key so refresh cannot accumulate duplicate controls.

This increment captures direct component definitions and instance args (the
latter already belong to the page snapshot). Exact nested Schema/Action graphs,
external runtime outputs, immutable media copies, theme selection, component-aware
restore/merge and streaming over-limit previews remain open. A page-content
restore/merge still goes through the ordinary live writer and records the
components resolved at that new commit; it does not rewrite component Things.


## Recorded components in named-branch merges — 2026-09-28

Named-branch merge review now includes direct recorded component definitions.
The shared `timeline/componentMerge.ts` compares definitions atomically by
content, so equivalent captures with different event IDs agree. Independent
changes combine; overlapping definitions require **Keep current** or **Use this
version**. Missing capture history is distinct from a captured unavailable ref
and is never treated as a deletion or replaced with current live definitions.
Removed page refs drop their links; new refs take the version that references
them. Folder-only revisions inherit the nearest content revision's captures.

`api.timeline` 1.11.0 extends the existing `preview-branch-merge` command with
optional `componentChoices`. Updated clients send an empty map to opt in.
A legacy caller may compare versions without dependencies; retained dependencies
return 409 requiring an updated client. Unknown dependency families refuse
explicitly until their merge rules exist. The transient response carries bounded
base/current/incoming maps and deduplicated canonical capture entries, never a
new durable format or an embedded growing history list. The server validates
owner/target identity, preflights retained byte metadata, and reads at most 360
unique captures in batches of 128, within the aggregate 4 MiB/200,000-node
preview budget. Current/incoming page contents and choices are checked again by
the client before review.

The review resolves page conflicts before component conflicts, then renders
**Preview current branch**, **Preview this version**, and **Preview merge result**
with the recorded definitions. Actions and live source runtimes remain inert.
Saving caches selected canonical entries before enqueuing the existing two-parent
merge event and revision-fenced branch command. IndexedDB and the remote retain
identical event/link schemas in the private Timeline folder; cache eviction,
retry identity and stale-push recovery use the existing synchronization path.
The published page and referenced component Things are unchanged.

Acceptance: the guarded real HTTP suite combines independent definitions,
requires overlap choices, checks exact uploads/lost-reply retries and stale
heads, and proves later live edits do not rewrite captured definitions. Browser
checks cover current/incoming/result previews, no Action execution, offline save
and reload with selected definitions, reconnect to exactly revision 2, unchanged
published content, and sign-out. Mobile labels/controls wrap without overflow.
Screenshots: [saved desktop preview](../PRs/assets/timeline-component-merge/saved-preview-desktop.png)
and [offline mobile preview](../PRs/assets/timeline-component-merge/offline-preview-mobile.png).

Still open: dependency-aware published restore/merge; nested Schema, Action,
theme and media versions; generic folder-version preview inheritance; streamed
comparisons above the current limits; and the remaining acceptance-ledger items.


## Published component restore and merge — 2026-09-29

History → Restore/Merge now reviews direct component definitions alongside page
content. Recorded components are the default. Applying creates ordinary private
Component Things with new shareIds and componentKeys and rewrites only actual
page references. Other pages retain their shared components. Component copies,
the page write, storage accounting, and their canonical Timeline records commit
in one transaction; failed or stale operations leave no partial copies. These
are the existing event/link formats in the private Timeline folder on both
local and remote stores, not an embedded version list or a second history store.

The comparison uses current rendered definitions, including standalone API
component edits, against the recorded base and incoming versions. A fingerprint
is checked again inside the content transaction. Stable page-block identities
keep incoming changes visible after restoration changed component reference IDs.
If one shared result ref would need several distinct definitions, separate the
page refs before merging. Page conflicts are reviewed before component choices.
An exact apply retry returns its original receipt and cannot change intent.

Known historical unavailability becomes an inactive ordinary placeholder
Component, so future live resolution cannot fill the historical gap. Unrecorded
legacy definitions remain explicitly incomplete and require another version or
the explicit Current shared components choice. Non-webpage Things keep arbitrary
fields named blocks as data. Existing large-part restoration remains supported;
published previews have a separate 16 MiB/800,000-node aggregate limit for the
three independently bounded snapshots. Canonical event limits stay unchanged.

`api.timeline` 1.12.0 adds componentMode, componentChoices and expectedComponents
to the existing version commands. Opted-in previews include thingtime plus
bounded component comparison maps; these maps are transient. The client validates
the whole response and receipt identities. Older clients cannot silently drop
recorded page components. The shared inert preview pauses Actions and live data.

Validation uses `test:timeline:published-components` on the guarded disposable
replica. It covers independent copies, key isolation, exact retries, stale
standalone component edits, recorded absence, missing history, copying a copy,
merging a later branch into copies, concurrent applies with one winner, and a
second-copy failure rolling back the first copy, page, events and storage bytes.
Desktop/mobile browser acceptance applies a restore and a reviewed merge and
checks the actual page plus the unaffected shared source.

Still open: nested Schema/Action/theme/media versions and binary copying;
full dependency graphs and branch ref-rebinding ergonomics; generic folder
preview inheritance; durable offline restore-command recovery; deleted-Thing
recovery; previews beyond the bounded content limits; retention controls; and
the remaining original acceptance ledger. This increment does not complete the
universal Timeline goal.


### Fable 5.1 browser integration (2026-09-29)

The `/history` route, Timeline folder and contextual History now share the
Scope/Look browser based on PR #947. The implementation uses existing canonical
records, receipt states, scoped cache/remote paging and version commands.
See [the design integration ledger](timeline-design-integration.md) for the
implemented behavior and explicit remaining work; a matching look does not
mean the concept's simulated retention, notes or selective undo have shipped.

## Page and related history — 2026-09-30

Timeline 1.13.0 adds `GET /api/v1/timeline?ownerId=…&dataPlane=…&thingId=…&related=1`.
The root must be an owned saved webpage. The existing shared-composition resolver
rechecks its bounded current graph; only owned source Things enter the merged
history query. Foreign readable definitions contribute only an excluded count.
Canonical event/link/receipt records, protected Timeline folder, transactional
writers and local/remote formats are unchanged. No new index or collection.

The response adds a validated `related` projection (root ID, at most 128 owned
Thing IDs, membership revision and shared count; at most 32 KiB). Events retain the
existing page byte budget and 40-entry limit. `before`/`after` require the previous
`relatedRevision`; changed membership returns the latest page with `reset: true`.
This prevents an older event on a newly linked Thing being skipped by a newer
cursor. The client checks scope, reset semantics, receipt ordering and continuation
before caching canonical entries. An eight-entry account/origin/database-scoped
membership cache seeds the bounded IndexedDB query on reopen. Polling is active
only while History is visible. A refused root clears the displayed related cache;
removed members disappear from the view without deleting their own history.

This is current-composition browsing, not temporal graph reconstruction or a
subscription to runtime-calculated references. The real HTTP acceptance script
`test:timeline:related` covers five Thing types, shared author privacy, exact
canonical records, paging, API edits, added/removed membership, account/database
fences and strict query validation on the disposable replica.

## Deleted Thing recovery — 2026-09-30

`api.timeline` 1.14.0 adds explicit `recover:true` support to restore preview/apply.
A missing ordinary Thing requires its latest trusted Published revision to be a
recorded deletion, and its physical ID must be unoccupied. Client drafts cannot
establish ownership or deletion. Recovery uses the original ID and trusted deleted
kinds, but a private audience. The preview keeps a surviving owned folder or shows
Things root. `expectedHeadId`, `expectedRecovery` and `expectedComponents` fence
changes to the deletion head, reviewed placement and component definitions.

Recovery commits through canonical Thing create validation, authorization, quota
and moderation. The new event is `operation:create`, `before:null`, with the deletion
and selected version as parents; no earlier record changes. Content, private
component copies, canonical events/links, Published pointers and storage accounting
share one transaction. Retrying the exact operation UUID returns its original
receipt. Concurrent recoveries and ID collisions refuse without orphan writes.

Published uses the existing `TimelineBranch` (`main`, `Published`) and one
`TimelineBranchHead` per Thing beneath Timeline. It retains no growing lists and
uses the same shared schemas/IndexedDB representation as named variations. Trusted
committed main revisions advance it atomically; browser drafts, branch effects,
captures and old idempotent retries cannot move it. Named-branch command grammars
still exclude `main`, and the variations list excludes Published. Legacy histories
without a pointer scan at most 2048 events / 16 MiB before refusing safely.

Deletion reuses existing saved component-capture links without generating fresh
captures or charging extra content, including at quota. Legacy deletion versions
can inherit their recorded crystal provider. Missing bindings remain explicitly
missing. A recovery preview cannot borrow an unrecorded current definition unless
the user explicitly chooses current shared components.

This increment covers ordinary standalone Things and direct page components.
Protected kinds, target-attached interactions, folder children, external blobs and
side effects require dedicated recovery flows. Existing large-preview/restore
budgets still apply. It does not complete the broader acceptance ledger above.
