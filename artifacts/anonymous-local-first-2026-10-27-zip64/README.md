# ZIP64 export and runtime refusal — 27 October 2026

The canonical Blob exporter now writes known-length ZIP32/ZIP64 entries around
verified immutable payloads. Safe integer size planning, SHA-256, CRC32,
consumer budgets, cancellation and source availability fences remain enforced.
ZIP signatures inside payloads cannot terminate a known-length stored entry.
Portable Thingtime JSON v1 and anonymous renderer limits are unchanged.

## Verification

- [Focused tests](unit-final.log): **35 passed**, zero failures; one unsupported
  Node heavy fixture skipped. Sentinel arithmetic, ZIP64 records, embedded
  signatures, small ZIP64 decoder compatibility, early budget/runtime refusal
  and cancellation are covered. The skip is not acceptance.
- [Genuine Chromium export](browser/report.json): a file selected through the
  native File input contains **4,294,967,297 bytes**. Reading at offset
  4,294,967,296 returns its nonzero final marker. The actual canonical encoder
  produced **4,294,968,525 bytes**, including a trailing file whose header begins
  at **4,294,968,140**. The browser streamed the full archive in 1 MiB chunks to
  a temporary host file. [Python verification](browser/verification.json)
  independently read every payload byte, verified ZIP CRC32 and SHA-256,
  canonical manifest fields, the trailing file and ZIP64 directory/locator/footer.
  Payload SHA-256: `2796b8078bc15b6f263639d77b54b01ebfcf9ea9610c20bc6b976931946d57ce`.
- [Browser provenance](browser/provenance.json): Chromium 156.0.8078.4; all four
  runtime source hashes match the final source. This is codec acceptance using
  native File/Blob APIs, not the full Builder/import UI journey.
- [Isolation](browser/boundary.json), [egress denial](browser/network.json),
  [resource results](browser/resources.json) and [cleanup](browser/cleanup.json):
  fresh task-owned claim, sandbox enabled, network none, read-only root, no host
  mounts or ports, 1 CPU and the unchanged 4 GiB memory ceiling. No OOM/max events;
  zero remaining session containers, and the large host/source files were removed.
- [Scoped lint](lint-final.log) and [sanitized client/Nitro build](build-final.log)
  pass. [Typecheck comparison](typecheck-comparison.json) exactly matches the
  existing 91 normalized diagnostics; this is not a clean typecheck. An initial
  test-only BigInt literal incompatibility was corrected.
- [Review](review.md) found and closed a compressed-input/oversized-output gap:
  Node checks declared file sizes before the inflation pass.
- [Progress plan](plan/verification.json): all 88 row counts, filters/search and
  full scrolling pass at 1440/390/320px. Counts remain 63 done, 14 partial, 11 todo;
  those are historical checkpoints, not a percentage estimate of remaining work.

## Node limitation and retained failures

Node 24.18.0 exposed a genuine 4 GiB + 1 file as a 1-byte `openAsBlob` value;
[the first trial](real-4gib.log) correctly failed exact-size validation. Composing
smaller genuine file-backed parts exposed a native `ToSlice` assertion at the
uint32 boundary in [the second trial](real-4gib-r2.log). The crash skipped its
finally block; [parent cleanup](node-crash-cleanup.json) verified the exact
creation interval and five synthetic files before removing that directory.

The actual Node Blob backend now refuses files/archives at or above 4 GiB before
reads, composition or inflation, with a clear error. Backend identity preserves
Chromium/Electron native Blob support even when Node globals exist. No Node
multi-gigabyte success is claimed, and the runtime limit must be revalidated
before that conservative guard is changed.

## Scope and reproduction

The copied browser harness files preserve the executed sources. To repeat on
this configured test host, place the three `browser/zip64-browser-*` files in
`tmp/continuation/`, then run `node tmp/continuation/zip64-browser-run.cjs`.
They require the installed Thingtime manager, pinned isolated image, Docker
socket, existing MCP dependencies and Python. This creates only synthetic files
and a fresh claim; it does not need an account, network access or private data.
The archive stream has a ten-minute deadline. Do not commit the large fixtures.

This checkpoint does not prove full multi-gigabyte decoding/import, normal
large-file Builder journeys, installed macOS or deployed provider acceptance.
The separate [native paste performance gate](../anonymous-local-first-2026-10-27-paste-comparison-r3/README.md)
remains open. Prior `b5ed654c` Web CI and CodeQL passed; its preview frontend has
the new transfer versions, while the shared gateway remains behind. No manual
deployment, merge, existing-account mutation or shared LLM proxy change occurred.
Graph refresh uses structural extraction; fresh semantic indexing is not claimed.
