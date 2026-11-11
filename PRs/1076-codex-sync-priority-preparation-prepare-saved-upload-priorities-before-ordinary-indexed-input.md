# PR 1076 — Prepare saved upload priorities before ordinary indexed input

The existing scheduler prioritized only prepared operations. A full queue of 128
ordinary operations prevented selected folders late in the durable Home index
from reaching preparation, even after the native producer had indexed them.
The original red regression selected `ordinary-0` instead of ancestor `Z`.

## Durable scheduling and migration

- Journal v13 adds one scoped normalized-path index. Existing
  operations, immutable event IDs, receipts and source captures remain retained.
- Trusted native local streams opt in. One independent ordinary-code task backfills
  normalized input keys in 128-row transactions through a fixed legacy cutoff,
  checks scope/abort and yields. New input is already normalized. Migration never
  runs inside consumer claiming; an absent priority cannot chase a growing source.
- Until normalization proves the earliest path revision, selection falls back to
  FIFO. Once proven, a free slot prepares priority ancestry before its child.
  Exactly one ordinary operation may free a full queue; an eligible pending priority
  binding then holds the available slot. Reserved/uncertain IDs always win.
- Processed-ahead observations use retained per-sequence event records and an
  additive `preparedAhead` count. Only contiguous validated markers advance the
  planning watermark, at most 128 per transaction. Source indexing cursors remain
  independent; terminal completion requires every gap and receipt. No baseline is
  published by a partial stream. Generic/remote preparation remains FIFO.

## Verification

16 focused regressions pass, including actual executor ordering through outside-
prefix ancestors and a file, lost accepted publication/reopen, the exactly-128
planner race with changed priorities, v12 rows/NFC/casefold, forged index primary keys,
more than 128 ahead markers, corruption/refused seal, A→B→A byte retention,
configuration/network/scope drift, bounded preference/ancestor scans and fallback.
A suspended migration integration observes two ordinary effects before releasing
migration, keeps its cutoff at385 while source grows to485, then executes priority
before the ordinary backlog. Cancellation preserves committed migration/source cursors.
Full shared fileSync: 527/527 plus one structural transport-contract test pass.
Raw TypeScript reports 92 existing diagnostics and zero in owned files; it is not
a clean raw typecheck. The canonical ratchet passes with its non-blocking warning
against baseline89. Focused ESLint has zero errors and three existing warnings.
Structural graph output accompanies publication; Markdown semantic freshness is
unverified.

## Acceptance boundaries

No native/auth/upload protocol, transfer concurrency or speed telemetry changes.
The native indexer must first discover a file. Retained legacy aliases require local
backfill proof before ahead admission; uploads continue meanwhile. Installed same-job
priority execution and independent exported-byte proof remain required. Native live
upload speed and useful end-to-end throughput are separate open acceptance work.
