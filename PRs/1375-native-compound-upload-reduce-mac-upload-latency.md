# PR 1375: guarded compound Mac upload transport

## Delivered boundary

`fileSingleUploadVersion` 1.0.0 negotiates a bounded byte transport beneath the
existing single-file executor. It returns an exact stored attachment proof and
never calls `/files/batches`, changes reservations/concurrency, or publishes a
file itself. Fresh native entry/exit identity checks and the existing admission
limiter remain unchanged. Strong local reads surround emission, PUT and stored
proof; current grant, account, configuration, frame and endpoint authority remain
required. The existing guarded Files commit and publication hook remain final.
Larger/empty/multipart sources, symbolic links, unsupported native capabilities
and custom mutation hooks retain their existing paths.

The host reuses the shared hash/transfer governor. A separate monitor's in-flight
account/configuration HTTP is cancelled when its PUT finishes; only that monitor's
own cancellation is ignored. Real authority failures still abort the operation.
A configuration without connection limits inherits the existing device limits.
Unknown PUT traffic remains unknown, and retries retain immutable operation IDs.

## Matched warm comparison — 6 November 2026

One successful full two-way run per revision used the canonical installed-host
factories, real Swift reader, built middleware, real TLS worker and disposable
API/database. Both runs performed 17 fresh identity HTTP attempts before transfer
t0 in the same shared admission actor; neither reset that actor or used the
upload-only diagnostic mode. Timing/provenance from PR 1373 is reused; the new
same-process fixture mailbox carries compound callbacks without another reader,
native process or admission budget.

| Observation | Prior | Compound |
| --- | ---: | ---: |
| Local READY | 7.703 s | 7.697 s |
| Local claim | 13.670 s | 13.668 s |
| First server-received native PUT | 19.024 s | 16.814 s |
| Claim to first PUT | 5.354 s | 3.146 s |
| Canonical upload receipt | 22.454 s | 17.514 s |

The claim-to-PUT interval fell by 2.208 s (41.2%); the original queue behind the
download remains about 5.97 s. This single warm comparison establishes neither
cold-start latency nor a statistical/sustained-throughput result. Compound
requests span PUT, so their entire duration must not be counted as pre-PUT work.

Both exact 65,537/65,539-byte hashes passed before index sealing; both directions
shared the same capture, strict resume passed, no transfer replay occurred, one
cloud history revision remained, and observed native active peak stayed 1.
Global scan/transfer ceilings stayed 5,000,000 B/s and CPU 15%; the existing Rust
share was 2,500,000 B/s.

Successful source-content fingerprint:
`9d97c2fada7e999b7af7187954bb8633af024298d7aedaeeb93df3236803ea95`.
Compiled fixture SHA-256:
`0b931aed7feef57267334f5ad730049310ba5a38eae2a1f5a59e07fcc0d1fdef`.
Built middleware SHA-256:
`ca3cfbf390f91ded1fe722834542b2200fcc535f970b6a719fdc6617f1f67492`.

## Verification and limits

- Full `test:file-sync`, focused compound host/client/native/duplex regressions,
  raw TypeScript and canonical Vercel output verification passed. Native tests
  cover replacement, truncation and growth at every callback boundary, ready
  attachments, exact fresh entry/exit identity and grant loss. Host tests cover
  revocation during PUT, explicit cancellation, lost replies, held monitor HTTP,
  inherited global limits, malformed proof and compatible/missing capabilities.
- Final native changed targets passed 3 tests. The broader native folder suite
  passed its behavior checks; its expected context capability dictionary was
  updated and passed the focused rerun. An optional unchanged admission-test
  batch did not progress and was stopped; limiter code was not altered.
- `NITRO_PRESET=node_middleware pnpm --dir remix run build:server`, the real
  fixture build and `test:files:mac-paged -- --two-way-early
  --normal-early-budget` passed. An earlier fixture attempt stopped on first
  context before warm-up/t0 because the test adapter supplied a batch callback
  to ordinary requests. Conditional dispatch and an actual context self-test
  fixed that test-only wiring error; it was not a latency sample.
- Structural Graphify snapshot and portable HTML were refreshed. One scoped
  semantic attempt was bounded at 180 seconds and timed out; prior semantic data
  was preserved and changed-document semantics remain incomplete.
- Signed bundle installation, installed native acceptance, final required PR
  checks/merge and deployment evidence remain separate delivery gates. No
  personal sync configuration, Home grant or user files were changed by the
  synthetic acceptance run.

## Main integration

Integrated main `9515d781` after the comparison. Incoming filename validation,
shared-content API versions and authored controls remain intact. Only appended
feature-map/changelog text required a source resolution; both entries were kept.
Immutable graph variants from both sides were restored byte-for-byte before a
current structural refresh with bounded retention. The compound/cloud-file and
custom-policy/client regressions passed again against the integrated tree.
The added custom-policy fixture is explicitly typed as `ForegroundSyncInput` so
its optional mutation hook is checked by the raw TypeScript run.

## Release-entry correction

Canonical signed staging exposed an existing package-wide Release build of the
private `@testable` fixture. The bundle entry now explicitly builds only its
three shipped Swift products and reuses that set for executable checks/copying;
all existing signing identifiers, entitlements and fail-closed behavior remain.
The fixture and private identity admission actor remain test-only/internal.
The new regression executes the canonical shell entry with isolated commands:
a required product failure and a missing executable both stop before staging.
The final signed build/install remain subject to ordinary validation and PR gates.
