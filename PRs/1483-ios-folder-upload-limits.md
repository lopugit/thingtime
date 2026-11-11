# PR 1483 — iOS folder Backup upload limits

Branch: `codex/ios-folder-upload-limits`. This bounded follow-up adds ordinary
Backup/keep-deleted upload controls; it does not add strict watching, two-way,
download or general CPU/scan enforcement. See the canonical
[upload-policy contract](../docs/ios-folder-upload-policy.md).

Device, granted-folder and saved v5 configuration limits share persistent
aggregate usage with Photos. The existing Photos 625,000 B/s default, ordinary
unset-rate behavior, explicit Pause, original operation identity and uncertain
consumption remain. Controls use MB/s by default with optional Mbps and hourly
MB/GB, through independently editable Builder fields.

Acceptance caught and corrected a stale draft save: editing another field or
unit could restore the old saved ceiling. The complete current draft now wins.
Policy recovery considers only runnable/scheduled work; completed/attention jobs
sharing the device remain stopped. A real task/journal regression cleared a
separate cadence suspicion: the existing admission fallback already preserves
automatic intervals through migration, completion and reload.

Hourly testing exposed multipart starvation: retry restarted at part one even
when the provider had accepted it. Native upload 1.7 / upload-policy 1.1 clients
now require parts API 1.3 and transfer-admissions 1.7, explicitly opt into exact
provider reconciliation, and skip only matching part number/length/checksum.
Fresh owner, reservation, expiry, source and admission checks surround awaits;
final composite and file fingerprints remain mandatory. Verified skips add zero
new network usage without refunding past or uncertain bytes. Legacy requests
keep normal full-sized grants without a new lookup dependency.

The real local-storage regression reopens the host between three allowances,
uploads an 8 MiB + 8 MiB + 71-byte file once per part, and verifies the downloaded
full hash. Other coverage includes malformed/unavailable proof, changed/expired
authority, legacy signing and delayed owner/session changes. Provider permission
is a separate live deployment prerequisite; local success does not prove S3 IAM.

Initial installed Simulator acceptance at the prior frozen implementation passed
device/folder/config ceilings with full 8,388,679-byte hashes. The upgraded installed runtime recovered the original 16,777,287-byte pending
upload under the same operation/job: it transferred only the missing 8 MiB
second part and 71-byte tail, reused provider-confirmed part one, and the
independently downloaded full hash matched. Fresh device-hourly acceptance and
final-head CI remain parent-owned release gates. The existing `no-ai-merge` label disables the conflict resolver
only; GitHub auto-merge stays off. No physical-phone acceptance is claimed.

Graph output is structurally refreshed; changed-document semantic indexing
remains unverified when the bounded semantic backend is unavailable.
