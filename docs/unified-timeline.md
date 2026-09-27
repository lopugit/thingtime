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
deleting the live Thing. Size equality and ordinary HTTP deletion are covered;
an explicit live quota-ceiling/downgrade test remains in acceptance.

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
view, and push controls. Branch checkout/edit mode, named-branch merge targets,
and historical dependency rendering are still required.

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
Quota-ceiling/downgrade tests and further protected writer coverage remain open.
