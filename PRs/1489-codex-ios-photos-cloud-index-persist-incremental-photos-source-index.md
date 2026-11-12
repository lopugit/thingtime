# PR 1489: Incremental Photos source index

Branch: `codex/ios-photos-cloud-index`. Assigned worktree:
`/Users/lopu/.codex-2/worktrees/ios-photos-cloud-index/thingtime`.
Fresh fetched main base: `00c3d455ab801a9dfdca96c2b6d00329bec46545`.
Imported prerequisite: `600ece62050c225d4912f9cfa21d1d4e8704ba04` (PR1483).
Owned source checkpoint: `dcb5ea4d5fe01f89ddddc26ad02fb00c329a121a`.
[PR](https://github.com/lopugit/thingtime/pull/1489). Merge/deployment held for
parent review and acceptance; the prerequisite is not this task's authored work.

## Result and decisions

Source metadata reaches private atomic Things through the existing approved
Photos sync-run authority. Transfer-admissions1.8.0 adds ordered immutable
observation receipts, full-owner reads/catalog/discard and explicit partial
counts. Existing home transactions/accounting/indexes and owner, pairing,
configuration, approval and private destination fences remain authoritative.

Native discovery stages its outbox before opening originals. Pages contain32
resources; completed-prefix discovery yields after four pending pages, with
companion groups preserved. Durable head/tail allocation avoids a directory
scan per asset. Same-process counter-write failure, restart, rotation intent and
acknowledgement journal boundaries preserve immutable identities and byte receipts.
Resource revision and byte-bound prepared version are distinct. New completion
receipts retain prepared versions; older receipts without them remain explicitly
legacy-unverified, never fabricated pending or backed-up proof. Owner discard
rotates only metadata after a durable backfill intent; a stale run journal can
recover from the durable metadata epoch without changing the byte queue epoch.

## Verification and limits

- TypeScript clean; focused lint clean;64 parser/capability tests passed.
- Focused Swift cases cover5,000 already-acknowledged assets, pre-preparation
  metadata, unavailable reasons, immutable retry, same-process counter failure,
  metadata rotation, rotation fault injection and prepared/legacy receipts.
- Built canonical HTTP fixture covers index arrival before publication,
  concurrent exact replay with one quota charge, explicit incomplete/full scans,
  append-safe watermark pages, wrong caller/origin refusals, Pause/read retention,
  verified and legacy publication proof, quota refusal/retry and discard/cascade
  refunds. Fixtures create state through APIs only, using a disposable replica.
- Own Simulator: `EDAB1F98-F6C4-4197-8146-41344DF8FE9B`, iOS27.0, named
  **Thingtime Source Index Isolated**. Own loopback API: `http://127.0.0.1:51074`.
  No personal phone or another task's retained fixture was touched.
- Initial installed PhotoKit run proved cloud metadata before first File
  publication, then exposed a missing native activity callback. Discovery now
  forwards the canonical enumeration/indexed activity, with regression coverage.
  That failed result is retained, not counted as a passing full run.
- The same retained fixture subsequently reached12 Files /12 source publication
  proofs. The latest source was rebuilt/installed there and passed the existing
  upgrade/reopen check:11 photos +1 video,12 originals,60,185,117 bytes, actual
  downloaded/original hash equality, all12 cloud revisions unchanged, no native
  reupload. Canonical storage readiness remained ready/pending0.
- A bounded additional new-photo test used normal automatic discovery, without
  Retry/rearm or checkpoint mutation. Its one new PhotoKit original uploaded in
  43.7 seconds; pending cloud metadata, exact File/prepared proof/hash and the
  prior12 IDs/revisions passed. The live activity predicate failed (it required
  the13-asset scan's latestFound date to equal the new original). The scanner may
  have advanced to older already-backed resources; this is not reclassified as
  accepted behavior. The failed result is retained and the first-publication
  activity predicate was not counted as a passing test. The retained native trace
  proves13/13 discovery items were recorded before publication, with latest
  discovery advancing to older already-backed items. It also proved that a later
  terminal nil progress cleared latestFound. The minimal fix retains the last
  actual item on nonempty same-pass nil progress, clears empty/new-pass state,
  and restores matching same-run history. Controlled regressions and an installed
  same-fixture read/reopen consistency check passed with13/13 counts and the
  actual last indexed PhotoKit item. No second photo was added.
- Metadata-only rotation was covered by local native regressions and canonical
  HTTP tests, not end-to-end through the installed native pipeline. The immutable
  runtime manifest is
  `~/Library/Caches/Thingtime/agent-evidence/ios-photos-cloud-index/runtime-manifest-dcb5ea4.json`;
  installed/built main executable and debug dylib SHA256 values match.
- Physical iPhone background scheduling and production acceptance remain
  separate. Simulator BGTaskScheduler refusals are not treated as physical
  background success. The live production origin has not been upgraded here.

Private local evidence (contains no committed credentials):
`~/Library/Caches/Thingtime/agent-evidence/ios-photos-cloud-index/` and
`~/Library/Caches/Thingtime/ios-photos-cloud-index-installed/`.
Transient account/xctestrun credentials remain private and are never committed.
The failed originals result and successful latest-source reopen result are
separate xcresult bundles in the installed evidence directory.

The structural Graphify snapshot is current. Broad semantic extraction of the
very large TESTING/changelog corpus was stopped after a bounded attempt during
active edits; those semantic entries are not claimed refreshed. A subsequent bounded scoped attempt was stopped at the parent handoff; the
contract/maps/PR note are not claimed semantically refreshed. Existing
upstream AST/semantic validation warnings remain recorded by the wrapper.

## Final followup verification

The CI exact-version assertion in `app/docs/apiCapabilities.test.ts` now expects
1.8.0, while older compatible-minimum client tests stay intact. The combined
parser and both capability suites pass163 tests. The new-photo failed result,
its native event trace and the subsequent positive last-discovery reopen result
remain separate evidence; no failed run is renamed or counted as success.
