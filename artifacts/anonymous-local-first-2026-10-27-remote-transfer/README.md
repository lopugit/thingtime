# Negotiated remote transfer capacity — 27 October 2026

## Delivered behavior

Account export 1.18.0 and import 1.15.0 accept safe-integer aggregate file
metadata above 512 MiB. Actual uploads still use the canonical multipart,
approval, ownership, purpose, size and quota checks; import still binds fresh
ready uploads transactionally. Normal clients negotiate before downloads,
uploads and imports. Older origins leave local content intact.

Larger downloads use content 1.18.0 pinned original streams: live receipts,
exact `If-Match`, content length, identity encoding, no redirects and post-read
and pre-use rechecks. Small network frames coalesce into immutable 1 MiB Blob
segments. Unpinned/buffered consumers retain their previous budgets. Portable
transfer v1, manifest/count/depth limits, ZIP32 representability and anonymous
renderer restrictions remain unchanged.

## Verification

- [Focused tests](unit.log): 236 passed, zero skipped. Includes metadata above
  the former budget, unsafe integer sums, origin negotiation, quota/permission
  and cancellation rollback, stream integrity and Blob segment coalescing.
- [Archive/buffered regressions](codec.log): 48 passed, zero skipped.
- [Scoped lint](lint.log): zero errors and four existing warnings.
- [Sanitized client/Nitro build](build.log): passed.
- [Final typecheck](typecheck-final.log): 91 diagnostics, exactly the prior
  normalized baseline; this is not a clean typecheck. The initial run found one
  new test-fixture type error, which was fixed. See [comparison](typecheck-comparison.json).
- [Real built API acceptance](api-acceptance.log): **538,968,064 bytes (514 MiB)**
  across two 257 MiB text files passed multipart upload/completion/replay,
  private import, pinned export, independent streamed SHA-256 comparison, the
  shipping Blob ZIP encoder/decoder, second upload/import with fresh identities,
  source deletion and surviving-copy export. A deliberate 2 MiB allowance
  refused the upload with `quota_exceeded`; the supported admin subscription
  API then granted only the disposable account 4 GiB. No global tier or quota
  check was changed. Anonymous private reads and cross-site writes were refused.
- [Native shared-copy browser acceptance](shared/verification.json): the normal
  button copied editable dependencies and a 17,825,795-byte original into the
  anonymous workspace; exact independent bytes and cold offline reload passed.
  Normal saved profile Action controls also passed their existing regression.
  Desktop 1440px, mobile 390px and narrow 320px top/bottom checks had no document
  overflow or page errors. This browser case is **not** the 514 MiB API case.
  [Desktop](shared/shared-copy-1440.png), [mobile](shared/shared-copy-390.png),
  [narrow](shared/shared-copy-320.png), [browser log](shared-browser.log).
- [Progress-plan verification](plan/verification.json): all 88 rows, displayed
  totals, filters/search and complete page scrolling passed at 1440/390/320px.
  The 63 completed / 14 partial / 11 planned totals remain historical checklist
  counts, not a percentage estimate of the remaining goal.

The browser used the current sanitized package
`7f314229d131e6448b0e59953e3b8052e9423fc7c5fc7d816cd88f4e0677aea1`
in an owned network-none container. [Boundary](shared/boundary.json),
[direct-IP/redirect denial](shared/network-proof.json), [resource checks](shared/resources.json)
and [cleanup](shared/cleanup.json) are retained. The API fixture used a disposable
Mongo replica and actual disk objects behind the built Nitro API, with an OS
network allowlist limited to its two loopback ports. It verified outbound denial,
stopped all owned children, closed both ports and removed its temporary data.
Neither fixture used production storage, accounts or credentials.
The API runner and built server entry hashes are recorded in
[source provenance](source-provenance.json).

Read-only review found no actionable production-code issue. It caught an invalid
file path in the initial acceptance fixture; paths now validate before uploading.
The [first setup failure](api-first-attempt.log) and
[explicitly diagnosed quota refusal](api-quota-refusal.log) remain recorded;
both cleaned up. A normal account quota was not mistaken for a transfer limit.

## Scope and remaining work

This is local source, built API and isolated browser evidence. It does not prove
deployed S3 transfer capacity, installed macOS acceptance or the full
device/account/plane matrix. ZIP64 encoding, other traversal/transport envelopes
and the native paste performance gate remain open. The actual desktop MCP
affirmation artifacts retain their [earlier package boundary](../anonymous-local-first-2026-10-26-desktop-mcp/).

The prior pushed head `b75ede29` passed Web CI and CodeQL. Its frontend preview
advertises export 1.17/import 1.14/content 1.18, while the configured shared gateway
advertises export 1.15/import 1.11/content 1.17 and lacks theme/algorithm sync.
Those are distinct origins; a reachable frontend does not establish backend
acceptance. This update's CI/deployment state is reported on PR #1000 separately.

No merge, manual deployment, public test publishing or existing-account mutation
was performed. The shared LLM proxy was left unchanged. Graphify uses structural
refresh only; fresh semantic indexing of these docs is not claimed.
