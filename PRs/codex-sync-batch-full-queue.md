# Keep upload batches running through a full preparation queue

A continuously indexing producer can refill every released operation slot. The
old batch selector refused new batches whenever 512 operations were pending,
forcing scalar execution indefinitely despite eligible prepared files. The
selector now treats capacity as a reason to free one scalar slot only when a
proven unprepared priority needs that slot. Prepared priorities and their
ancestors still select first, and the priority handoff uses the caller's actual
128/512 preparation capacity.

Reserved operations, forced individual recovery, immutable operation IDs,
per-path revisions, receipt validation, root serialization and contiguous
source watermarks retain their existing authority. No native IO, API contract,
authentication cache, rate limit or schema changes are introduced.

The existing private rotated Electron timing log additionally records seven
optional closed numeric batch counters after final host validation. Counts
separate native-verified results, earlier canonical receipts and member failures;
acknowledged and unknown payload counts overlap these statuses. Native verified
is not canonical committed. Legacy rows remain valid; counters are absent on
failed, cancelled or unvalidated outcomes. No paths, URLs, identity fields or
raw errors are added.

## Verification and acceptance

The old code fails both the full-queue/refill regression and the 512-capacity
priority-slot regression. Tests exercise three 256-member batches under refill,
restart mid-reservation, exact 128/512 ancestry execution with a lost response,
missing priorities, original uncertain/recovery IDs and changed preferences.
The focused Electron counter suites pass 47 tests.

The prior installed window had only three batch calls, all before a subsequent
restart, and lacked member/recovery/pending-at-claim measurements. The scheduling
defect is source-proven; attribution to that live window and practical installed
throughput remain open. Preserve the same Home job and use the next bounded
acceptance window to compare acknowledged results, actual canonical receipt
progress and an independently recovered priority file.
