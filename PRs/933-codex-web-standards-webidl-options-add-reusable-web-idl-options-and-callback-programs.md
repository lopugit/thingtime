# PR #933 — Reusable Web IDL options and callback programs

The Web Standards Builder gains 132 interactive catalogue entries: 22
option dictionaries, 87 fields, nine enums, one typedef, one callback interface
and 12 callbacks. Coverage is now 3,077 of 18,798 indexed entries: 227 HTML,
1,059 CSS, 890 JavaScript and 901 Web API. This is incremental coverage, not a
claim that every published standard is implemented.

## Implementation

Complete saved structured programs exercise native event flags, listener
callback objects/lifetimes, Blob/File property bags, Request/Response metadata,
HeadersInit, streaming decoding, geometry dictionaries and stream callbacks.
Users can edit dictionaries and inputs, then save full private Components with
existing Builder, Action, Data and Thing contracts. No catalogue-ID runtime
lookup, raw source Component, new endpoint or sandbox grant is introduced.
The actions-run catalogue/client contract advances to 1.20.0.

Stream examples include queue accounting, pipe close/error/abort propagation,
BYOB reader mode/minimum and transferred views, source auto-allocation, ordered
sink writes, transform backpressure, flush and cancellation. Byte allocations
are bounded to 4096 and chunk lists to 32; numeric strings cannot bypass the
allocation guard. Reserved stream type properties expose real native errors.
Request/Response examples construct objects only and never fetch.

## Validation — 2026-09-27

- Twelve focused tests passed on Node 22 and current Node. Platform suite:
  104 passed and one opt-in skip. Capability suite: 83 passed. Changed-source
  lint passed; typecheck ratchet remains at 89 existing errors.
- Separate actual-API round-trip passed: seven-Thing idempotent installation,
  complete edited programs for eleven new families, literal JSON preservation,
  child Action execution, private ownership and anonymous 404. Fixtures cleaned.
- Local browser: 213 cases (132 defaults and 81 edits), 209 passed, two
  unsupported Transformer.cancel entries, two recorded engine differences,
  zero unexplained failures. Every geometry field was edited in the browser.
- Local Builder edited StreamPipeOptions with preventClose and a custom chunk,
  saved, reopened, fully reloaded and ran the private Component. Owner API
  readback retained inputs; anonymous API returned 404. All eight exact local
  fixtures were removed from the verified disposable database.
- Full production build and Vercel output verifier passed. Both local manifests
  advertise actions-run 1.20.0. Runtime SHA-256 remains
  fd4f12f656faeccddfde118c135cf81926e52690212bed9989dcae28a4a30fbd;
  the opaque sandbox retains no eval, same-origin access or form egress.

Native differences stay visible. Browser workers can ignore RequestInit.window;
invalid UnderlyingSource.type throws RangeError in the browser versus TypeError
in Node. Node can retain fractional File timestamps and differs in passive
listener behavior. Transformer.cancel reports unsupported if the native callback
is absent. The runtime does not normalize these into simulated results.

Graph freshness and exact-commit preview/production acceptance are recorded in
the final PR receipt. Structural graph freshness does not establish semantic
extraction success. Focused checks do not establish complete standards conformance.
