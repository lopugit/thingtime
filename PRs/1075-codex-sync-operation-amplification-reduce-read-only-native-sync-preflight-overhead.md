# Reduce read-only native sync preflight overhead

PR1074 improved index publication but installed same-job acceptance still confirmed only three files / 1.1 KiB in 85 seconds. The transfer queue remained full. A native PID-scoped log read found successful conditions/read/list RPCs taking 11.4–14.4 seconds. Samples did not establish actor/journal contention. The bounded production runtime stream omitted status/duration fields, so neither server latency nor identity429 was established as the live cause.

The source-proven amplification includes the planner: a file under an existing parent repeats native authorization while preparing only provisional journal bindings and authenticated cloud observations. Preparation makes no cloud/native mutation; native inspection already independently authenticates its account/device/grant. Updated trusted Mac adapters now retain scope/abort checks for those reads and freshly authorize every actual mutation.

Mac file-access1.12.0 returns conditions alongside current roots in one authenticated context response. Generic/old hosts retain separate context/list/conditions calls. Public API capability negotiation is reused only within the exact live window/generation/origins/owner/device binding; all actual native requests retain fresh account and paired-device checks. Changed bindings/invalidation renegotiate; this is not an authorization TTL.

Updated Mac part sources omit duplicate client wrapper checks that the pinned native range and pre/post-PUT EOF checks already enforce. Initial expected-source verification, pre-complete verification, independently checked stored fingerprint and strongest final verification after content lookup before canonical commit remain. Native source construction performs no IO and retains scope/abort checks. Operation IDs, receipts, leases, root serialization, source revisions, exclusions and Git policy remain.

## Measured controlled path

A production-code streaming regression covers preparation and execution of `Parent/file.bin`, including ancestor lookup, renderer/native-source parsing, the real Electron host/part uploader and journal completion. HTTP/native boundaries are synthetic; setup/feed/other-job traffic is excluded equally.

| Path | Native RPCs | Account HTTP | Configuration HTTP | Cloud JSON | Sign / PUT | Native identity HTTP | Total HTTP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Compatible old-host fallback | 40 | 84 | 9 | 9 | 2 | 80 | 184 |
| Updated Mac | 13 | 30 | 5 | 9 | 2 | 26 | 72 |

Two identity requests per successful native RPC are expanded from the unchanged native pre/post authorization contract; failures/retries can add calls. No repeated public manifest requests occur inside either measured run after setup. Before the final planner correction, the updated path measured 16 RPC / 87 HTTP. These are call counts, not a speed claim.

## Verification and acceptance

- New source-drift tests reject changes at initial, part, pre-complete and final fences. Accepted commit reply loss recovers the original receipt without another source/part/publication.
- Changes after preparation to configuration/root/account/scope/network/cancellation prevent upload-start/PUT. Configuration changes after start, accepted PUT and content lookup block the next part/completion/canonical commit respectively.
- Capability binding/invalidation, old-host fallback, composite condition parsing and lazy-source scope/abort checks are covered. Native identity diagnostics contain only bounded status/duration/attempt/cooldown fields; fast successful checks remain quiet.
- Full shared fileSync: 511/511 plus the structural contract test pass. Electron host/part: 48/48; native folder/API: 62/62. Focused ESLint has zero errors (six existing warnings). Raw TypeScript has 92 existing diagnostics, zero in owned files; the repository ratchet passes with a warning against baseline89. Incremental structural graph accompanies publication; Markdown semantic freshness remains unverified.

Same-job signed installed throughput and independent downloaded-byte acceptance remain required. No backup reset, new permission, authorization cache, rate-limit increase, journal concurrency, whole-file advert or duplex protocol is introduced. Priority scheduling still cannot promote unplanned index entries; that preparation gap remains open separately.
