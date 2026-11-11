# PR 1478 — source identity diagnosis and bounded batch recovery

## Installed evidence

The signed Downloads backup resumed its saved journal automatically. In a
bounded 20-minute observation, its known-work count changed but it confirmed
no new file or payload bytes. Closed native batch diagnostics then classified
the first inspection of several historical members as a changed device
component of the file identity. Rust capture and Swift read use the same
descriptor-relative, security-scoped root and `dev:ino` identity format. The
diagnostic does not reveal paths or identity values and cannot establish why
the underlying device identity changed.

## Scoped recovery

The upload batch records an individual canonical-dispatch marker before the
canonical Files commit. After an exact native source-change result, the journal
can retire only that failed ordinal when both its operation and batch marker
are explicitly false, no receipt exists, and the original batch, scope,
instance, operation and immutable cloud write still match. The bounded write
archives that unpublished operation and updates counters atomically. A repeated
reply verifies its exact history before doing nothing. Confirmed, marked,
ambiguous and unrelated members retain their original IDs for receipt-first
recovery. A staged but unbound attachment follows the existing 24-hour draft
expiry and cleanup lifecycle; this change never deletes it or treats it as a
canonical file revision.

The signed a48 build exposed two later terminal-run errors on the same saved
Downloads journal: completion evidence still had pending receipts, and its
following retry attempted priority preparation after the old local producer
was sealed. The consumer now recognizes that terminal producer and does not
reopen priority preparation. When bulk admission yields no member but the
journal still has pending operations, it makes one ordinary claim through the
existing original-ID, receipt and ancestor guards. A second unavailable claim
refuses sealing. It does not treat an interrupted prefix as complete inventory.

## Verification and live boundary

The focused journal and complete-backup consumer regressions cover a mixed
batch, legacy missing dispatch evidence, reopened journal, lost reply,
post-staging source change, fresh sealed scan and exactly one replacement
publication. Separate terminal-run fixtures cover a reopened producer, missed
batch admission, unavailable claims, a superseded parent retaining its child
without publication, and completion after an in-memory count becomes stale.
They use synthetic native, authorization and storage fixtures.
The changed Markdown was refreshed structurally in the portable Graphify
snapshot. Its semantic chunks were not re-extracted: the earlier bounded
local-proxy attempt on these large docs did not complete, and no backend
prerequisite changed for another full attempt.
Typecheck and required PR checks are separate gates. The installed Downloads
job has not yet demonstrated a new confirmed transfer, independent byte hash,
or completed checkpoint. Thingtime's saved automatic setup is also pending
its exact idle enrollment condition; neither is claimed complete here.
