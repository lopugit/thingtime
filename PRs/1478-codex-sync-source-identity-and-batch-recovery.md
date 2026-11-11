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

## Verification and live boundary

The focused journal and complete-backup consumer regressions cover a mixed
batch, legacy missing dispatch evidence, reopened journal, lost reply,
post-staging source change, fresh sealed scan and exactly one replacement
publication. They use synthetic native, authorization and storage fixtures.
Typecheck and required PR checks are separate gates. The installed Downloads
job has not yet demonstrated a new confirmed transfer, independent byte hash,
or completed checkpoint. Thingtime's saved automatic setup is also pending
its exact idle enrollment condition; neither is claimed complete here.
