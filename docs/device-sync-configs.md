# Device folders and sync configs

The folder is the entry point for file synchronization. A native folder grant
and its sync configs appear together; the grant's current name and path identify
the source even when an older config has a different display name. Each config
keeps its own cloud destination, direction, exclusions, pause state and activity.
Adding a folder prepares its first config. Additional configs can independently
back up the same source or synchronize it with another destination.

New folder configs default to backup: upload changes and retain the cloud copy
after a local deletion. Two-way sync remains an explicit choice and requires
the native write approval. **Save & sync** saves and enrolls the selected config
in the durable runner; existing paused configs are not silently enabled.
Source identity, account, API origin, destination and saved revision are checked
before enrollment and again before effects. If the app leaves the editor after
the save, root discovery recovers the same confirmed config and cadence from
its scoped setup intent. Recovery queues without replaying the cloud write or
opening a permission dialog; it respects a saved Pause.
When a matching saved job needs attention, queued recovery keeps that job's ID
and requires the worker's fresh config, grant and write-approval checks. A
different policy, a paused job or an unfinished strict scanner is not silently
replaced. Streaming operations keep their original receipt ID across restarts;
the journal records a publication fence immediately before the actual native
or cloud publication, after staging and source checks have passed.

## Background recovery and activity

An exact saved local setup with an unscheduled attention job and retained
strict capture waits for the current transfer when the same device lane is
occupied. The editor shows that waiting state only after an exact private
saved-config readback matches the retained intent and job policy; the journal
and current account, origin, device, Activity settings and Pause must agree.
The ordinary Retry action is omitted only for a typed incomplete-indexing
recovery, while its previous failure detail stays visible. An exact pending
intent with an unknown or actionable failure can explain that the device lane
is occupied, while retaining attention, failure details and recovery controls.
Missing or stale saved data and Pause retain their ordinary attention or paused
states.
The idle worker still performs all grant, authority, scanner cleanup and
receipt checks before any transfer; this message grants no admission.

iOS native device pairing contract **1.2.0** queues device-status checks behind
an active request for the same owner and API origin. Each queued check performs
fresh identity and pairing verification when its turn starts; it does not reuse
the earlier request's result. Cancelling one queued or active caller preserves
independent waiting checks. Navigation and backgrounding invalidate the whole
lane. Pairing and presence commands retain their existing busy refusal. Older
native hosts retain the original status refusal; the web client does not replay
those requests with a guessed delay.

For isolated fixture diagnosis, build the client with
`VITE_THINGTIME_SYNC_DIAGNOSTICS=1`. The read-only
`window.__thingtimeSyncEnrollmentDiagnostics.read(scope, connectionId)` hook
accepts the exact editor scope and returns closed phase/failure categories,
generation, elapsed time, active/abort state, safe binding Booleans and a target
match Boolean. It exposes no cancellation, claim release or data mutation.
Ordinary builds do not install the hook. A reload begins a new renderer history
and cannot identify a historical claim holder. The native queue and a successful
status check do not override saved-config, grant, receipt or migration guards.

Offline and typed transient transport failures defer with backoff. An interrupted
strict inventory gets one fresh verification attempt; repeated incomplete scans
need attention and cannot publish deletions. Missing folder access, revoked
authorization, conflicts and an explicit pause remain distinct states. Hiding a
Retry button does not repair those conditions.

Mac file access 1.22.0 adds an exact-path, metadata-only `inspect-stamp` action
for a captured local upload source. If the bounded early `observe-path` hash
expires, that path waits for the sealed inventory; its transfer then compares
the saved capture with a fresh authorized native path, inode, version, kind and
size check. This avoids hashing the same large file again before upload. The
saved fingerprint remains provisional: each uploaded part or whole-file result
must match it, and a reused ready attachment must return the same verified
content fingerprint before the original file publication. Older hosts, links,
targets, downloads and deletion checks keep full inspection. A changed stamp,
lost grant, explicit Stop or mismatched bytes cannot publish from that capture.

Activity records belong to an exact device/config/account/origin/root scope.
They retain measured start/end times and bytes sent and received in the existing
device sync history store. Unknown measurements stay unknown. Payload bytes,
logical file size and uniquely stored cloud bytes are different quantities: a
deduplicated upload can create a new logical file while sending no payload.

## Shared file content

Deduplication is within an owning account. Eligible identical file content uses
one protected content-blob record and one exact stored object generation, with
separate logical attachment references. The server verifies the content digest
and length using the existing canonical checksum contract. A client claim alone
does not establish a reusable stored object.

Each logical reference preserves its identity, filename, destination, access
checks and version history. Content reuse does not grant access to another file
or account. Quota reserves a new payload once, transfers that charge to the
verified content blob, and charges subsequent references for their metadata.
Reuse requires a live, readable attachment owned by the same account. When
all prior references are blocked or otherwise unreadable, the caller must
upload and verify the bytes again under the normal payload charge.
Deletion releases one reference; physical bytes are reclaimed only after the
final reference and the relevant retained versions are released. Concurrent
upload, completion, cancellation and deletion must maintain those invariants.

The explicit `consolidate-sync-attachment-blobs` administrator migration handles
eligible historical sync files. It preserves logical version identities, verifies
both physical generations. A later pass observes the committed reference switch
and starts the signed URL drain. Duplicate versions remain billed until the
drain expires and their exact object versions are deleted. Before activation, validate compatible readers
and deleters for every deployment sharing the affected data plane. Migration
registration, source tests and a saved receipt do not prove live consolidation.

See the [acceptance checklist](../TESTING.md#unified-folder-sync-configs-and-deduplication)
and [mobile sync contracts](mobile-file-sync.md). Release evidence must distinguish
local tests, deployed API behavior, signed Mac acceptance and physical mobile
acceptance.
- A stopped local run's expanded Progress panel includes read-only Recovery details for its reserved operation: original operation ID, file binding ID when applicable, direction, kind, and saved dispatch/receipt flags. The journal read is scoped to the selected owner, device, root, and run; it never clears or advances a reservation and omits local paths and bytes. A missing receipt is not proof that an older request cannot still commit.
