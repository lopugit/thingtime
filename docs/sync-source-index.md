# Incremental sync source index

Photos discovery persists metadata in Thingtime before originals are opened.
The canonical transfer-admissions capability is **1.8.0**, negotiated on the
exact selected origin. Native clients requiring this feature explicitly refuse
older origins and retain their local outbox; they never silently omit the index.

`observe-photo-index` accepts a live runId, epoch, passId, monotonically increasing
sequence, immutable requestId, resource entries and explicit discovery progress.
Requests contain at most32 observations /64KiB as a processing page, never a
library limit. Resources include opaque asset key, resource index, original name,
resource revision, nullable prepared source version, capture/modification dates, asset kind and companion count. State
is pending, unavailable with a closed reason, or legacy-unverified for an older
local completion receipt that cannot prove the current cloud source version. No PhotoKit local identifiers,
credentials or byte grants are persisted. All records remain owner-private.

One protected `sync-source-index` Thing per exact owner/origin/device/root/config
revision/grant/epoch owns relational `sync-source-observation` Things. Writes
reuse canonical home transactions, storage accounting and existing indexes.
The same transaction fences live run, browser owner, pairing, device,
private-upload permission, configuration and private destination. Duplicate exact
latest-page delivery returns its original receipt without another charge. Changed
payloads and out-of-order sequences fail closed. A native sender persists each
page before sending, acknowledges only its exact returned sequence/requestId,
and retains an uncertain request byte-for-byte across restart. It never sends a
later page until that receipt is durable. Source observations cannot grant Files,
attachment, folder, public audience or generic Things mutation authority.

The native queue discovers the first newest asset before opening any original.
It batches date-ordered metadata into32-entry pages, yields completed-prefix
discovery after four pending pages, and resumes only after cloud acknowledgement.
The outbox uses durable head/tail counters rather than rescanning its directory
per asset. A resource group can spill into the next processing page without
truncating companions. It stages metadata during bounded lookahead while current uploads
continue. Original preparation then records the canonical prepared entry version (which
binds resource revision, size and digest) and unavailable reasons in the same
outbox. A first-upgrade metadata backfill reuses original receipts and does not
reupload their bytes. A library-token change begins a new pass; it never treats a
partial scan as proof of removal. Every discovered resource must be durably
represented before a complete source scan can seal. Remaining undiscovered
resources are null while incomplete, zero only when sealed. Source discovery,
cloud acknowledgement and verified byte publication are distinct evidence.

`read-source-index` is a full-owner operation with indexId or configurationId and
optional after cursor. No secret run handle is needed; Pause and expiry preserve
metadata. Configuration selection reads the newest saved epoch. A page returns
at most32 entries. Its discovery watermark remains stable during append/status
updates, so a growing library does not invalidate every cursor. Values and
publication proofs are current within each transaction, rather than an immutable
cross-request snapshot; `consistency=current-with-discovery-watermark`,
`observedThroughSequence` and the current sequence expose that distinction. A
pass change requires restarting pagination. Do not infer absence from a partial
page or use a moving page as proof of whole-library coverage.

Publication is derived from the current private File, ready exact-version
attachment, native provenance, grant and source-version stamp. An observation
cannot assert it. New completion receipts retain canonical prepared versions, allowing metadata
epoch rotation to relink the same current cloud publication without source reads
or uploads. Legacy completion receipts lacking prepared versions remain explicitly
legacy-unverified (and counted separately), with null publication; a full source
scan is not a claim that these older copies were freshly verified. Old unstamped
copies initially return unknown publication. An
exact already-backed native check can backfill source proof only after comparing
the current verified fingerprint and native provenance under the same live
transactional fences. It creates no bytes, file revision or Timeline event.

`list-source-indexes` pages retained epochs for one configuration so the owner
can inspect or discard older metadata without retaining a secret run handle.

Owner `discard-source-index` tombstones an epoch, removes at most32 children per
request and returns hasMore for bounded continuation. The small private billed
tombstone refuses late writes with source_index_discarded and remains readable.
The native client rotates only its metadata epoch and reindexes, preserving the
original byte queue epoch, accepted transfers and exact completed receipts. Configuration deletion uses
the canonical target cascade: configuration → index → observations, refunding
ordinary content bytes. Existing epochs are retained until explicit discard or
configuration/account deletion; no hidden retention count is imposed.

Run the source-index parser/capability tests, Swift outbox and ordered discovery
tests, and `remix/scripts/test-file-sync-transfer-admissions.mts` against a built
Nitro server. The HTTP runner provisions a disposable replica set and creates
state through canonical APIs only. These checks are separate from installed
physical iPhone background acceptance.
