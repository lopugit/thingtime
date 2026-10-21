# Batch guarded folder metadata before dependent uploads

A full upload preparation queue can contain many unconfirmed folder operations.
Each parent constrains child file eligibility, even while file payload batches
are healthy. This change batches absent-target folder metadata across the
existing durable journal, native source adapter and canonical folder writer.
It does not claim all remaining installed latency has this cause.

- Negotiate optional native folder1.0/fileAccess1.14 and server batch1.1; file1.0 remains compatible. Descriptors stay at256 members/320KiB and control at512KiB.
- Probe original receipts before source IO. One bounded native operation validates exact per-directory stamps under fresh identity/config/grant/conditions checks; current canonical parent placement gates child dispatch.
- Commit parent-first canonical waves of at most8 folders in one Mongo transaction, preserving inner placement locks, quota and per-operation Timeline receipts. Whole-wave rollback applies after any write failure.
- Refresh indexed immediate parent stamps on child create/remove/rename, including excluded children without excluded subtree scans.
- Retain original uncertain operations, typed batch reservations, priorities, source cursor and root serialization across restart/feature loss. A proven-unpublished superseded parent can cause a separately recorded new child target intent; original IDs/history are never silently rewritten.

## Verification

- Shared parser/digest vectors cover ASCII, Unicode, V1/no-ignore and existing parents; the same vectors pass Swift and Electron.
- Shared journal/client and actual-consumer tests cover the512 frontier, ancestry, stale targets, receipt-first replay, unknown writes, parent supersession, unchanged descendants, restart, capability loss, configuration and deadline fences.
- Native owner: Rust51, Apple111, Electron293 passed; native236 executed,2 explicit hardware-only skips,0 failures. Actual Commander→native→host→shared-parser128-folder proof:1.411s,1 native launch,2 identity HTTP and2 account HTTP; loopback authority synthetic, no canonical commit claim.
- Server owner:127 focused tests plus3 distinct between-wave tests passed. Real isolated Mongo verifies8 canonical creates in one transaction, dependency order, replay/quota, whole-wave rollback, lost replies, moved/trashed parents and wrong IDs. Those portions alone do not prove whole-pipeline speed.
- Whole512 actual canonical Mongo comparison FAILED the publication speed gate: exact84c3 baseline46.102s versus candidate34.513s (74.86%,25.14% reduction; required≤50%). Both completed117folders+395files and the first file before full index. Synthetic native5ms/provider2ms were identical; adding the conservative measured1.411s/folder-call cost cannot satisfy the gate. Candidate phase counts were not flushed before assertion and remain unknown. The original release gate failed; this result is preserved. The parent subsequently superseded that arbitrary local numeric gate and authorized a partial performance release, with practical speed acceptance still open.
- Final full shared suite592/592 plus1 module-mock test pass. Native/server frozen suites remain unchanged. Raw TypeScript has92 pre-existing errors, identical to the actual base; zero new/owned diagnostics. Ratchet/scoped pipeline checks and lint are recorded with the final release proof. Installed acceptance remains pending.

No installed Home job, grant, account settings or local source data is changed by
these tests. Practical same-job throughput and byte-identical new-version
recovery remain required installed acceptance after production rollout.

## Instrumented repeat and release decision

The one instrumented repeat measured44.280s baseline versus32.750s candidate
(73.96%, still failing the original≤50% threshold). Applying the measured
1.411s full128-folder validation cost conservatively to each of four candidate
folder calls gives38.374s (86.66%), also failing. The original46.102/34.513s
result is retained separately; neither result is rewritten as a speed success.

The complete candidate confirmed117folders+395files, with the first file before
full index. Native requests fell362→15; client control requests831→23. Folder
batches were1/1/18/97 and file batches1/256/138. Candidate control-request union
was27.091s; file commit phase12.003s included395 real canonical transactions
(9.720s union), verify5.524s, prepare3.798s and folder commit5.620s. Journal
method union8.904s overlaps requests; these phases must not be added as exclusive
wall time. Only183ms lay outside observed native/control/journal intervals.

These measurements explain the local canonical Mongo floor and prove the large
round-trip reduction, while native5ms/provider2ms remain synthetic. Existing
installed native-identity HTTP200 logs measured55–300ms/median84ms, but fast200s
are suppressed and that route is not a measured file-API RTT. No modeled remote
latency is presented as an installed gain. The parent explicitly authorized a
partial performance release rather than expanding scope to file transaction
waves; actual same-Home speed acceptance remains **OPEN**.
