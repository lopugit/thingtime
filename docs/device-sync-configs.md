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

## Background recovery and activity

Offline and typed transient transport failures defer with backoff. An interrupted
strict inventory gets one fresh verification attempt; repeated incomplete scans
need attention and cannot publish deletions. Missing folder access, revoked
authorization, conflicts and an explicit pause remain distinct states. Hiding a
Retry button does not repair those conditions.

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
Deletion releases one reference; physical bytes are reclaimed only after the
final reference and the relevant retained versions are released. Concurrent
upload, completion, cancellation and deletion must maintain those invariants.

The explicit `consolidate-sync-attachment-blobs` administrator migration handles
eligible historical sync files. It preserves logical version identities, verifies
both physical generations and drains old signed URLs before deleting duplicate
bytes and refunding their charge. Before activation, validate compatible readers
and deleters for every deployment sharing the affected data plane. Migration
registration, source tests and a saved receipt do not prove live consolidation.

See the [acceptance checklist](../TESTING.md#unified-folder-sync-configs-and-deduplication)
and [mobile sync contracts](mobile-file-sync.md). Release evidence must distinguish
local tests, deployed API behavior, signed Mac acceptance and physical mobile
acceptance.
