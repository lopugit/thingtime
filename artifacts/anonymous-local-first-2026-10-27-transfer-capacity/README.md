# Local portable Blob archive capacity — 27 October 2026

## Delivered scope

Local Blob collection, local export plans and selected ZIP decoding no longer
reject valid transfers solely for exceeding 512 MiB. Canonical transfer v1 stays
unchanged. Validation separates safe integer file/aggregate sizes from explicit
consumer budgets. The ZIP encoder checks its actual 32-bit file sizes, offsets,
central-directory location and length before reading content; ZIP64 export is
not implemented.

The anonymous renderer still accepts only bounded caller-supplied editable
content (256 KiB, 32 Things, no files/external assets or Actions). Account import,
chat-archive import, remote export plans, byte-array and clipboard budgets remain
explicit and unchanged. Quota admission, ownership and atomic import are not
bypassed. No remote API contract version is changed by this local codec slice.

## Review and verification

Review reproduced an important pre-existing dependency behavior: fflate retained
8 MiB of skipped stored input across 2,049 chunks during manifest discovery.
Simply increasing the accepted archive size would therefore have retained whole
archives in JavaScript buffers. The corrected pass starts a filename-aware sink
for skipped entries without retaining or inflating their content. Four regression
cases cover stored/deflated input and manifest first/last; the dependency retains
zero skipped bytes between pushes. Remaining decoding still enforces declared
sizes, exact checksums, safe paths, bounded processing and cancellation.

- [Ordinary transfer tests](transfer-unit.txt): 93 passed; one heavy opt-in test
  skipped. [Final archive regressions](archive-discard.txt): 24 passed, overlapping.
- [Server and anonymous draft tests](server-draft.log): 36 passed, including
  explicit account-budget refusal before file inspection/writes/transactions and
  unchanged no-login renderer restrictions.
- [First real-byte run](large-blob.log): 513 MiB in two files passed collection,
  ZIP export and selected-file decoding with independent streamed SHA-256 checks.
  That run preceded the skipped-input retention fix; the final run is separate.
- [Final real-byte run](large-blob-final.log): passed after the retention fix,
  513 MiB across two real files, in 43.1 seconds.
- [Final typecheck](typecheck-final.log): 91 diagnostics, exactly matching the
  previous checkpoint after normalizing source locations. No added or removed
  diagnostic signatures; this is not a clean typecheck. See
  [structured comparison](typecheck-comparison.json).
- [Transfer lint](lint.txt), [server lint](server-lint.log), [sanitized client/server
  build](build.log), and [isolated HTML tracker check](plan/verification.json)
  passed. Transfer lint retains one existing unsafe-URL test-fixture warning.
  The tracker passed 1440/390/320px full scroll, filters and search without
  document overflow; its isolated browser/backend network boundary and cleanup
  were verified. This is tracker verification, not product UI acceptance.

The large-byte test exercises the real Blob archive codecs and file reader in
Node; it does not claim browser UI, IndexedDB persistence, installed macOS or
remote account acceptance for 513 MiB imports. No large binary fixture is stored
in Git. The prior normal importer/Builder and MCP evidence retain their original
package boundaries.

## Evidence boundaries and remaining work

Capacity commit `07a4db71a6f9864e03fe330c47e0d095deda484b` passed Web CI and
CodeQL. Its immutable preview and alias advertise the new frontend contracts,
but the configured preview gateway lacks theme/algorithm sync. See
[preview verification](preview-prior-head.json). These results do not establish
CI or deployed acceptance for this subsequent archive change.

Larger remote write/import contracts, ZIP64 encoding, remaining traversal and
clipboard envelopes, the inconsistent five-second native paste gate and broader
native/device/account transitions remain open. The paste trace's dominant delay
occurs before the React input handler; host contention prevents confident
attribution, so no speculative editor fix was made. The shared LLM proxy service
and credential were left unchanged as explicitly requested.

No PR merge, manual deployment, public test publishing or existing real-account
mutation was performed. Graphify uses the structural fallback; fresh semantic
indexing of these docs is not claimed.
