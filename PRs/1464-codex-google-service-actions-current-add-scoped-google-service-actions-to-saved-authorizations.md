# PR 1464 — scoped Google service actions

Branch: `codex/google-service-actions-current`; PR:
https://github.com/lopugit/thingtime/pull/1464

Fresh task base: `0d8cf373344434d8341882db9a681ded3807c81e`.
Provider-error release #1456 integrated from actual main merge
`9ebe2be328f6cf76b502f1c6c047c353ccc14f80`.
Last tested implementation revision: `071dd519cdd2d7b2350a0119f363696297b77abd`.
Current source and contract details: [service guide](../docs/google-service-actions.md).

Six fixed Google read operations extend named grants, with exact provider/scope
admission, selected-token refresh, post-read reconnect/removal fencing, complete
credential-redacted JSON, resource IDs and opaque pagination. The editable
Builder template adds fields/next-page controls and preserves authored layouts.
Long scope strings and result JSON stay within mobile width. Old clients retain
the original operation-ID projection; current clients explicitly negotiate and
request service metadata. No new grants, provider secrets, real account writes
or arbitrary URL dispatch are included.

Evidence: 261 Connections/component/capability tests passed before the final
compatibility addition; the current named-service/capability batch passed 103
with zero skips. Updated service/block suites passed eight before the extra
projection case; block migration also separately passed. Changed-source lint
passed. The real Connections UI fixture passed desktop 1440×900 and phone
390×844, including Docs IDs, full JSON, exact Drive next-page token, selection
clearing, saved Builder edits, scrolling and overflow. These are synthetic
route-backed identities in fresh isolated browser contexts, not live Google
provider acceptance. Test fixture processes and contexts closed.

Release remains open: integrate #1460 after its actual normal merge, preserve
its reconnect/prefill/validation changes, run required exact-head checks, then
normal PR merge. The shared GitHub installation rate limit interrupted CodeQL
upload/status; parent owns bounded recovery. Preview alias was HTTP200 “No build
found” with manifest404, so no deployed preview is accepted. Graph hook refresh
did not produce a current snapshot on the overloaded host; source/docs semantic
freshness is not claimed. Parent owns real Google consent/action acceptance and
private lifecycle reporting because the gateway cannot adopt the legacy task
binding without duplicates.


Compatibility correction: the actual immutable Vercel preview now exists, but its
modern and gateway-routed API manifests disagree. It is not accepted as a
working service backend. The client now requires the actual same-origin API
contract as well as the modern manifest. The fixed active-API checker refuses
the real named 1.1/frontend versus named 1.0/API mismatch. Connections service
projection requires 2.3, distinct from PR #1470's Facebook metadata 2.2. Unit/manifest
batch: 110 passing; desktop/phone mismatch/coherent fixture passed. Required
checks and final integration still apply to the new pushed source.
