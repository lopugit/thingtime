# PR 1363 — Canonical native two-way fixture proof

The disposable Mac fixture now composes the production desktop host, independent
native polling lane, native operation guards, real composite authorization and
canonical transfer worker. Request-ID multiplexing preserves one native manager,
atomic writes, cancellation acknowledgement and session identity. Safe diagnostics
separate queue/service time, identity admission/HTTP and source/digest work.

## HTTPS test boundary

The local attachment provider serves exact-version HMAC ranges on a task-owned
HTTPS byte listener (28313). API/native identity remain HTTP loopback (28311),
with disposable Mongo (28312). An ephemeral private one-day CA is trusted only by
setup byte requests and the exact canonical transfer-worker child through a
fixture-only preload. Shipping launch code/environment filtering, normal TLS
verification, approvals, cancellation and resource policies remain unchanged.
Wrong/no CA fails normal verification; unrelated children gain no extra trust.
All task keys, certificates and listeners are removed after the run.

## Verification — 6 November 2026

- 16 focused fixture/transport/host/observer/TLS tests pass; 6 merged argv tests pass.
- Actual Swift fixture builds; Vite/Vercel verification builds; explicit
  `NITRO_PRESET=node_middleware pnpm --dir remix run build:server` builds the fixture backend.
- One original **two-way-before-seal** proof passes at 5,000,000 B/s scan/transfer
  and 15% CPU, with the canonical worker and 512 MiB late indexing blocker.
- Local change 3.980s; first admission 5.053s (`remote.bin` admitted first);
  upload read 15.438s; upload creation 16.655s; native read-range 17.363s;
  part signing 18.470s; first server-received native PUT **19.030s**;
  completion request 21.008s.
- Exact uploaded 65,537-byte and downloaded 65,539-byte hashes/receipts pass while
  the same capture is running, scanning and indexed=0. Fresh native feed pages
  observed after each receipt, independent SQLite unsealed state, strict same
  capture resume, no transfer/PUT replay and one cloud history revision pass.
- Cooldown count is zero. Identity durations are overlapping sums, not serial
  first-PUT delay; first upload followed a completed native download. This is
  synthetic fixture evidence, not installed UI acceptance or a runtime speedup
  comparison with earlier fallback/polling fixtures.

Safe local evidence: `/tmp/tt-native-fixture-lanes/canonical-tls-two-way-summary.json`
and `canonical-tls-two-way-evidence.json`. Source content fingerprint:
`7fe5896084c9042a5c4a551bd6719a4e8dbbc96db3d7ff1af11eafbd6441c652`.
Compiled fixture SHA256: `31761d08e11443e568740e5b2aceed7462a4dc9858f9d10cbc0335fd8fb191f5`.
Backend SHA256: `2c73045224ca05c41e7f31343b005a983d1d64684605f0b9b3a5ce2becd8ecb0`.

Graph refresh uses the bounded structural fallback. Changed-document semantic
coverage remains incomplete; prior semantic cache is preserved. Required remote
checks and normal protected merge remain delivery gates; no check bypass.

## Instrumented follow-up

A separate fixture-only follow-up from merged main `82b3c9ad` removes the
proof-only await from the transfer consumer. Fresh page observers retain the
same receipt timestamp, capture/generation and independent SQLite unsealed
checks; every observer is drained/asserted before resume and success. Their
errors participate in the proof race. This is no shipping concurrency or
identity policy change.

The one full canonical two-way run passes with both hashes, same running
unsealed capture, strict resume, zero PUT/publish replay and one history revision
at unchanged 5,000,000 B/s scan/transfer and 15% CPU. Native active-request peak
is measured as 1, matching `MacFolderSync.swift:506–508`.

| Local upload phase | Seconds after transfer start |
| --- | ---: |
| Initial local event | 4.004 |
| Durable append / READY | 7.703 |
| Durable claim | 13.670 |
| First server-received native PUT | 19.024 |
| Durable receipt | 22.454 |
| Fresh proof observation | 41.009 |

READY-to-claim is **5.967s** behind the earlier download; claim-to-PUT is
**5.354s**. Remote receipt commits at 13.668s and its proof arrives at 14.669s,
after the local claim, proving that observation no longer holds the consumer.
Join phase events by immutable operation ID, never by the last event for a path:
the later nonbinding local append at 22.539s is separate. Per-phase source
revision/generation values are not independently logged; `appendStream` validates
and pins them and `claimNext` returns the same immutable journal operation.

The six completed native calls between local claim and PUT total **4.898s**:
**4.522s identity admission**, **0.301s identity HTTP**, **0.075s other native
service**. These disjoint service intervals exclude overlapping poll/global sums.
Other native service is not CPU time. The separately observed digest worker is
107ms including IPC/admission/scheduling. All 133 identity samples retain original
request/session provenance; incomplete samples retain unknown durations.

Admission clocks bracket only `await identityAdmission.acquire` in
`ThingtimeAPIClient.swift:177–179`. `FileSyncIdentityAdmission` enqueues a FIFO
continuation, retains one active permit through credential revalidation/HTTP,
and schedules token/window/cooldown eligibility with real `Task.sleep` (burst12,
refill3/s,180 attempts/60s). The installed API client and fixture use the same
`.shared` scheduler. No process IPC or hashing is inside that bracket. No
cooldown occurred. Seventeen fresh identity attempts during synthetic pre-timing
setup consume this same bucket, so 19.024s is a warm synthetic result, not a cold
installed-app baseline or a runtime improvement versus earlier fixtures. No
safe production rate/authorization change was established; compound-operation
reuse needs a separate fence/eligibility proof.

Validation: 20 focused tests, actual Swift fixture build and native clock
self-test pass. A targeted `.mts` typecheck comparison retains 12 baseline
diagnostics and introduces zero. Raw safe evidence/phase arrays remain in
`/tmp/tt-native-fixture-lanes/instrumented-two-way-summary.json`,
`instrumented-two-way-evidence.json` and `instrumented-attribution.json`.
Source fingerprint: `828508ed1210adba7195b2d735fd7a819660706c3dc4b9944a2f315320f0e9c5`.
Compiled fixture SHA256: `25bb4297aa768075de9a1ba7991105874b56c906bb82f84352934658afb9c10a`.
Backend SHA256: `2c73045224ca05c41e7f31343b005a983d1d64684605f0b9b3a5ce2becd8ecb0`.
Temporary TLS material and task listeners are removed. Changed-document semantic
coverage remains incomplete under the bounded structural Graphify fallback.
