# Paired File Sync transfer admissions

An installed device can finish a positive-size private multipart upload without
retaining the owner's web session. Negotiate `api.file-sync-transfer-admissions`
1.0.0 for staging, 1.1.0 for exact Photos publication, or 1.2.0 for an owner-authorized Photos run on the selected account origin. The exact request envelopes are in
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
valid for up to two minutes; a provider operation already started may leave the
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

The default managed-upload rate is 5 Mbps (625,000 bytes per second). An
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
batch boundary, pause and run rotation, expiry, logout, disconnect and replacement. Physical iPhone scheduling and automatic PhotoKit discovery need
separate acceptance.
