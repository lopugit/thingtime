# PR 1464 — provider and password release

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

Consolidated release (11 November): this PR incorporates the reviewed source
from #1460 (`f6c57c70cdfa3641f212a0af9bd006463885b242`), #1468
(`a94f42aeb91a9787a5373996f8804d418ec6475c`, original reviewed
`bfd898e01b643b1aa45ada80f08a622c570031dd`), #1470
(`25b6f1778908a9090fd9ff1b96585fcaa58372ce`, original reviewed
`97e60361144c2f64dc649a353cc0fee7517fef22`), and #1472
(`7208b50f2d4f1b3f286b26fc578d335541b6195a`). Their independent
PR history remains intact; competing auto-merges are disabled. This one normal
PR pipeline validates the combined tree, preserving reconnect migration and
validation, editable private password fields, metadata-only named Facebook
diagnostics, and model-resolved personal Claude effort normalization.

Connections is 2.3.0, named actions 1.1.0, OAuth begin/callback 2.2.0,
diagnostics 1.0.0 and chat reply 1.23.1. Personal/inherited reply clients now
require both modern and active same-origin API 1.23.1 before POST; explicit
credits, device and plan paths retain their existing minima. Newer frontend /
older active API regression reproduces the refusal and coherent recovery.
Shared registry assertions reflect the published patch while compatibility
fixtures remain unchanged.

Combined validation: 288 Connections/capability tests passed with no skips;
password suites 165 passed with one existing skip; five actual reply-client
tests passed with a red reproduction. Reconnect plus service controls passed
actual isolated Chromium desktop/phone fixtures. Canonical typecheck, ratchet,
full lint, built-handler smoke and narrow conflict review are in progress at
publication. Graph refresh is tracked separately; no stale snapshot is claimed
current. Parent owns real provider and production password acceptance and
private lifecycle reporting; no duplicate task binding is created.


Compatibility correction: the actual immutable Vercel preview now exists, but its
modern and gateway-routed API manifests disagree. It is not accepted as a
working service backend. The client now requires the actual same-origin API
contract as well as the modern manifest. The fixed active-API checker refuses
the real named 1.1/frontend versus named 1.0/API mismatch. Connections service
projection requires 2.3, distinct from PR #1470's Facebook metadata 2.2. Unit/manifest
batch: 110 passing; desktop/phone mismatch/coherent fixture passed. Required
checks and final integration still apply to the new pushed source.
