# Paired File Sync transfer admissions

An installed device can finish a positive-size private multipart upload without
retaining the owner's web session. Negotiate `api.file-sync-transfer-admissions`
1.0.0 on the selected account origin. The exact request envelopes are in
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
This leaves an unbound owner-private attachment. Only the canonical Files write
under the foreground owner session can publish it or create a Timeline receipt.

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

Run from the repository root with `mongod` and `mongosh` available:

```sh
NITRO_PRESET=node-server npm --prefix remix run build:server
npm --prefix remix run test:files:transfer-admissions
```

The fixture starts a new loopback Mongo replica and built Nitro runtime with
synthetic accounts and local attachment storage. It verifies two queued files,
including multipart checksum mismatch and retry, wrong origin/device/account,
private placement, saved revision changes, expiry, logout, disconnect and
replacement. Physical iPhone scheduling and automatic PhotoKit discovery need
separate acceptance.
