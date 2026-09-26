# PR #934 — Reusable live HTML event programs and native handler bindings

The Web Standards Builder gains 107 interactive entries (52 HTML, 55 Web API).
Coverage is 3,184 of 18,798 indexed entries: 279 HTML, 1,059 CSS, 890 JavaScript
and 956 Web API. This is incremental coverage; the full catalogue is unfinished.

## Implementation

Complete saved programs author documents, CSS, parameters and event bindings.
They exercise editing/keyboard/pointer interaction, forms, dialogs, popovers,
scrolling, drag/drop, local image load/error, custom commands and CSS animation
and transition events. No catalogue-ID runtime lookup or source-code Component
is added. Existing Builder, Action, Component and Thing save contracts are used.
The catalogue/client contract advances to actions-run 1.21.0.

The generic DOM binding primitive supports native listener capture/once/passive
options and native IDL handler properties with replacement and return-false
semantics. Boolean controls accept explicit named boolean inputs, never implicit
truthiness. Propagation/default controls execute against the real native Event.
The recent 20 receipts retain dispatch-time phase/targets plus cancellation in a
later task: a microtask can precede native return-value processing. Fixed native
scalar projections cap text at 256 characters and avoid arbitrary object graphs.

Missing native methods/handlers report unsupported. Failed setup and exhausted
200-operation budgets clean up prior program listeners; an outer method cannot
overwrite a nested terminal result. Worker settlement wins over a queued earlier
DOM trace. The opaque frame, no-eval policy, same-origin isolation, local image
restrictions and form-navigation cancellation remain unchanged. File/clipboard
payloads, Window-specific handler conventions and media lifecycles are not added.

## Validation — 2026-09-27

- Platform tests: 110 passed, one opt-in skip. A separate real API audit exercised
  all 107 edited programs, idempotent seven-Thing suite install, exact private
  Component round-trip, the authored save-draft browser Action and anonymous 404.
  The audit respected local 429 Retry-After responses; its interrupted fixture
  and all final temporary records were cleaned from the verified local database.
- Eleven focused tests passed on Node 22 and current Node. Capability tests:
  83 passed. Changed-source lint passed; typecheck remains at 89 existing errors.
  The full production build and Vercel output verifier passed.
- Local browser audit: 164 checks (107 renders and 57 native/contract cases),
  163 passed plus one deliberately unsupported-method terminal result; no failures.
  Checked listener order, once, passive/default cancellation, propagation,
  IDL replacement, setup failure and one terminal event-budget error.
- Real pointer clicks verified a false-returning handler is uncanceled during its
  callback and canceled after dispatch. Actual typing exposed trusted key/code
  and beforeinput data/inputType. Dialog requestClose stayed open when canceled;
  real CSS transition cancellation exposed opacity and elapsedTime.
- Local Builder saved edited text and returnFalse, reopened/reloaded the private
  Component and ran it successfully. Owner API confirmed saved defaults; anonymous
  API returned 404. All eight exact UI fixture records were cleaned.
- Live preview bounds: desktop width/scrollWidth 918/918, mobile 356/356 inside a
  390px viewport. Controls remained inside the frame. Native drag automation did
  not emit dragstart; drag recipes rendered but that gesture is unverified.
- Runtime SHA-256: 22e4c90f3f0d0ec65fa2ed700e00439bd06bad0d55012a47468596b0b3ef4e37.

Graph freshness and exact-head hosted preview/production acceptance are recorded
in the final PR receipt. Structural freshness is separate from semantic extraction
success. These checks do not establish complete web-standards conformance.
