# Paired File Sync transfer admissions

An installed device can finish a positive-size private multipart upload without
retaining the owner's web session. Negotiate `api.file-sync-transfer-admissions`
1.0.0 for staging, 1.1.0 for exact Photos publication, 1.2.0 for a creation-only Photos run, 1.3.0 for guarded native Photos updates, or 1.5.0 for canonical background file transport on the selected account origin. The exact request envelopes are in
`/api/v1/files/sync-transfer-admissions-docs`.

The owner first uses the ordinary attachment API to reserve the original request
ID with File Sync provenance. Admission then checks the live browser account,
its private-upload permission, the selected pairing, the exact active saved
configuration and the private destination ancestry. The native source and grant
revisions are immutable descriptors; the device must check its actual local
grant and source before each transfer. Editable Things cannot grant a native
permission. The server retains authorization metadata in its existing protected
session store and retains no browser token in that record. An admission ID does
not authenticate anyone. General account resolution refuses its purpose.

The paired node sends its existing credential only to the selected API origin.
It uses signed part URLs in memory with the checksum and length of each part;
no cookie, credential or URL belongs in the queue. The device may complete only
that reservation. The server verifies the storage provider's ordered SHA-256
part digest before completion and the exact-version digest after completion.
Existing reservation quota, verification, provider recovery and idempotency apply.
Completion leaves an unbound owner-private attachment. A staging-only admission
can still be reconciled and published by the owning foreground session. For a
flat Photos backup original, the owning browser can also admit an immutable
`publication: { expectedRevision }` descriptor. The device must recheck the
current Photos grant, source version, network and power before posting
`{ action: 'publish', admissionId }`. The server uses the original operation ID,
private destination, expected file revision and verified attachment. The same
canonical Files transaction binds the attachment, accounts for content and
writes the Timeline receipt. A matching foreground commit and repeated device
publication return that receipt. An older staging-only handle cannot acquire
publication authority through retry or replacement. The transaction serializes
publication with changes to the issuing session, paired device, owner upload
permission and saved configuration. Its internal fence fields leave the saved
settings, modification time, public projections and customer payload byte
measurement alone.

An exact retry returns the same live admission and expiry. Explicit revoke, a
changed configuration revision, loss of private destination access, or original
owner or pairing revocation stops new URLs and receipts. Already issued URLs are
valid for up to two minutes (up to ten minutes for an explicitly requested
1.5 background-file grant, always bounded by admission and reservation expiry);
a provider operation already started may leave the
same private attachment staged for the owner to reconcile. While the same
reservation is pending, the owner can explicitly replace a revoked or expired
admission by its exact ID under the current configuration revision. Replacement
retains the request and fingerprint but issues a distinct handle; old handles
never become valid again. If the reservation itself is gone, the foreground
must reconcile the original operation receipt before reserving it again.

## iPhone Photos automation

An enabled Photos backup on a compatible iPhone checks its existing grant and
saved account policy on launch. Foreground discovery retries about every five
minutes and can wake early when the app becomes active or connectivity or
charging changes. Pause persists locally even before the first upload. Older
compatible settings keep their saved network, charging, source and destination.

The 1.1.0 path finishes already-admitted originals. With a compatible app and
1.2.0, the owning browser opens a run bound to the live owner session, iOS
pairing, grant, saved revision and private destination. During iOS background
execution the paired phone can check that run before reading PhotoKit and
reserve further exact originals. The API derives their destination and
operation IDs, reuses matching verified cloud bytes, and leaves differing
occupied paths for foreground review. Pausing, changing the configuration,
revoking the run or losing the issuing session disables new child requests.
An unbound reservation created during a revoke race remains private and
expires through normal attachment cleanup. iOS chooses when background work
and notifications can run. A fresh session or a changed configuration needs
a newly opened run.

A compatible app uses one durable native Photos engine both when the app is
open and when iOS grants background execution. The WebView authorizes saved
settings, requests Pause or Resume, and renders scoped native progress. The
1.3.0 protocol can update a managed original only when the current attached
file has protected provenance for the same native grant, device, configuration,
private root and path. The canonical Files revision guard retains the prior
version in Timeline. Unrelated occupied paths and older attachments whose
grant cannot be established need review.

On supported iPhones, the explicit Run in Background button can request an
iOS continued-processing window for the same queue. It works on real queued
originals and finishes when eligible work is exhausted. Automatic checks use
the ordinary iOS background scheduler. iOS can decline or expire a continued
request. System interruption retains the automatic retry; explicit Pause remains
paused until the user resumes it. A clean pass that durably defers unavailable
originals is distinct from a failed task and from a fully backed-up library.

## Persistent background file transport

After negotiating 1.5.0, the paired device can include
`transport: "background-file-v1"` on an admitted Photos `parts` request. Only
the canonical direct regional S3 signer can return `parts[].transport` with
`kind`, exact HTTPS `origin` and `path`, `method: "PUT"`,
`redirects: "provider-managed"`, and the signed URL's `expiresAt`. The signer
checks the configured bucket/region, object path, multipart identity, checksum,
signed Content-Length, bucket owner and expiry. The client compares the
descriptor to that exact signed request before choosing its background lane.
Local storage, custom adapters and legacy requests omit this descriptor and
retain the foreground sender. Callers cannot add it to generic attachment
requests or non-Photos admissions.

iOS background URLSession transfers files in a system process and always follows
redirects. The descriptor deliberately trusts the canonical S3 provider for
that behavior; it does not turn arbitrary upload URLs into trusted destinations.
No account credential or cookie is attached to the object PUT. The app's private
durable journal retains reservation, source and policy identity, not signed URLs
or account credentials. System-managed requests hold only their bounded signed
byte grants. Publication still requires current authorization and the canonical
verified receipt. An expired scheduled URL is retryable under the original
admission and part identity; scheduling never guarantees that iOS starts before
expiry. Force-quitting the app cancels its system transfers until a normal reopen.

BGTaskScheduler and background URLSession are separate APIs. Apple's simulator
does not support background-processing task grants. Controlled lifecycle tests
can verify cancellation, duplicate callbacks and recovery logic; they cannot
prove continued-task delivery on a phone. A background transfer test must
independently observe bytes/receipts while the app is inactive and after recovery.
See Apple's [background sessions](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background)
and [scheduler unavailable](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler/error/unavailable)
contracts.

The default managed-upload average is 5 Mbps (625,000 bytes per second).
Background file transfers use aggregate admission scheduling; individual
transfers can be faster because iOS does not expose a stream-rate controller
for its daemon. The foreground fallback retains byte-paced delivery. An
optional hourly allowance applies to measured app-managed upload payload; it
does not count Photos/iCloud download traffic. Governed connections on a device
share the persisted usage ledger and their own configured allowance is checked
against that ledger. A multipart file can continue in a later hour if each
provider part fits. If even one part exceeds the allowance, the app shows the
minimum needed for that part. Progress summaries default to 30 minutes, can be
turned off, and count newly verified assets and observed Wi-Fi, mobile or
unclassified payload traffic.

Run from the repository root with `mongod` and `mongosh` available:

```sh
NITRO_PRESET=node-server npm --prefix remix run build:server
npm --prefix remix run test:files:transfer-admissions
```

The fixture starts a new loopback Mongo replica and built Nitro runtime with
synthetic accounts and local attachment storage. It verifies two queued files,
including multipart checksum mismatch and retry, wrong origin/device/account,
private placement, v4 policy readback, staged-only refusal, matching
foreground/device publication, six paired-only original refills across the initial
batch boundary, a guarded native update retaining its prior version, wrong-grant and unproven path refusals, pause and run rotation, expiry, logout, disconnect and replacement. The fixture removes a separate browser
session for the same owner between Photos reservation and part signing. It
verifies that the still-authorized exact admission can publish and replay.
Ordinary session draft cleanup excludes protected file-sync provenance.
Explicit cancellation and expiry still clean those reservations. Physical iPhone scheduling and automatic PhotoKit discovery need
separate acceptance.
