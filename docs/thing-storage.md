# Thing storage choices

Storage controls live beside a Thing's metadata and in its context menu. The
controls are editable Builder blocks. A saved preference describes the desired
placement; the adjacent device status reports whether the copy actually exists.
Saving a preference alone never means bytes were downloaded, uploaded or removed.

| Choice | Cloud and device behavior |
| --- | --- |
| Sync with cloud | Enable automatic cloud synchronization and the normal local-copy behavior. |
| Keep on this device | Keep a verified copy here and pause automatic uploads. Existing cloud content is retained. |
| Cloud only | Enable cloud synchronization, verify the committed version, then release this device's managed copy. |
| Cloud and this device | Enable cloud synchronization and keep a copy here. Other devices can browse the catalog and open content explicitly without automatically downloading originals. |

Absent policies inherit existing behavior. No existing file is automatically
removed or enrolled by installing the update. Preferences are private to the
owner and selected origin/data plane. Device choices use a verified paired
device or a server-issued browser installation identity. Other accounts and
browser profiles have independent copies. Preferences are separate from the
Thing's content hash and do not change its content or Timeline revision.

`api.things-storage-policy` 1.0.0 registers
`GET/POST /api/v1/things/storage-policy`. Source, owner policy and device policy
revisions are checked independently. Browser registration uses a private
HttpOnly credential. A policy is not an access grant: every read, update and
attachment manifest reauthorizes its source. Metadata is sufficient to discover
a Thing; attachment originals are downloaded only by the appropriate device
operation. Attachment manifest pages include protected exact versions and
multipart fingerprints, with unavailable values left explicit.

The browser stores managed JSON snapshots and attachment chunks in IndexedDB.
Downloads verify exact range responses and the canonical multipart fingerprint
before publishing a copy. Interrupted stages can resume; the previous complete
copy stays available until the replacement commits. Browser storage capacity
and persistence remain subject to the browser's storage service. Quota failures
are errors, not successful saves or zero-byte copies. Export uses a streaming
Save File destination when the browser supports it.

Foreground and online events reconcile this installation's already-enrolled
copies one at a time. They do not discover or download every cloud Thing.
Per-Thing locks and IndexedDB generation checks coordinate concurrent tabs.

For explicitly enrolled JSON copies with automatic cloud synchronization
paused, generic Thing content edits retain the original cloud revision in a
local pending mutation. Re-enabling synchronization uses the ordinary API and
its revision check, followed by exact readback. Unknown completion retains the
same mutation for reconciliation. Conflicting cloud edits preserve the local
copy. Storage choices do not revoke permission to run an explicit cloud Action
or another dedicated cloud command.

iOS advertises `fileReplicaVersion` 1.0.0 for its scoped `file-replica` bridge.
File bytes stay in app-owned storage and can be opened through the system share
sheet. A known LiDAR source can be enrolled only through its exact upload
receipt. Cloud-only removal rechecks the cloud File, paired device, policy and
local fingerprint. Unuploaded recovery originals are retained and reported.
Photos Library assets, folder-picker files and user Save As exports are never
implicitly removed. Hosts without the native capability use their browser
storage support and report native availability accurately.

Local eviction is separate from folder synchronization deletion. It must never
be interpreted as permission to Trash a cloud Thing. Pending edits, changed
bytes, unavailable cloud proof or a changed account/policy keep the local copy.

See the [manual acceptance checklist](../TESTING.md#thing-storage-and-device-copies).
The implementation's automated tests and generic simulator builds are separate
from a physical iPhone upload, local opening and storage-release acceptance.
