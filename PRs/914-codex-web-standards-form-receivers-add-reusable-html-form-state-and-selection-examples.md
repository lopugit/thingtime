# PR #914 — Add reusable HTML form state and selection examples

Branch: `codex/web-standards-form-receivers`
PR: https://github.com/lopugit/thingtime/pull/914
Base: `main` at `e887f769a66ba8da6203eede2c0bfcde94212467`.

## Behavior

Form API entries previously lacked the native receiver context needed for an
interactive example. This adds 212 complete editable programs for input,
textarea, select/option/optgroup, button, form, fieldset/legend/label, datalist,
output, meter/progress, ValidityState and live form/option/radio collections.
The catalogue now has 2,649 interactive entries among 18,798 indexed entries:
HTML 227, CSS 1,059, JavaScript 601, Web APIs 762. These counts describe authored
recipes, not browser availability or complete standards coverage.

The definitions use the existing `tt-web-platform` program grammar and save
Action. No feature-ID dispatch, native app block or new persistence model is
added. Native booleans, bounded integers, fractional values and nullable-node
setters preserve their types. Native selection offsets and control state are
returned explicitly because serialized HTML does not capture dirty state. The
snapshot includes native validity flags/messages, so setCustomValidity changes
remain observable even on controls barred from constraint validation.

The bridge resolves registered members from the most specific captured native
prototype, preserving both select removal overloads. Returned collections keep
their owning node; indirect mutations on detached options still spend the
cumulative allocation budget. Length writes are bounded before native allocation.
The existing opaque iframe, worker deadline, account/network boundaries and
captured inspection accessors remain in force.

`api.actions-run` advances to 1.14.0 in the documentation-derived manifests,
frontend requirement and exact-version checks. Storage, suite-install and
browser Action execution versions do not change.

## Native-context limitation

An actual-browser comparison found `form.reset()` restores the default in an
active document but returns without changing the value in a detached document.
Chromium's implementation explicitly returns when the document has no frame.
Reset is excluded from the detached policy and remains requires-context; the
regression requires refusal so that a no-op is never counted as a worked demo.
Pickers, submissions, constructors, pattern validation and validation flags that
require real user editing also need dedicated contexts. Native validity results
are demonstrated here; active browser validation UI is a separate context.

Sources checked 27 September 2026:
[HTML form infrastructure](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html),
[form elements](https://html.spec.whatwg.org/multipage/form-elements.html),
[Chromium form reset implementation](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/forms/html_form_element.cc).
The HTML Living Standard page reports an update on 25 September 2026.

## Validation

- Real opaque browser runtime: 209 of 212 form programs executed successfully;
  alpha, capture and colorSpace explicitly reported unavailable browser members.
  All 158 existing DOM programs still executed successfully.
- Sixteen browser boundary/semantic cases passed: typed false/fractions,
  both remove overloads, insertion before an option node, selection direction,
  range replacement, live validity/radio state, detached allocation accounting,
  preallocation limits, reset refusal and the prior named-control boundaries.
- Workbench inputs changed to `Reusable rainbow 🌈`, offsets 2 through 8 and
  backward direction. Saved as a private Component; exact authenticated API
  readback retained every parameter/default, anonymous GET returned 404, and
  reopening/reloading/running reproduced native selection state.
- Focused tests: 46 passed; the opt-in live test is skipped in the default run.
  The real API test separately passed using the existing disposable local
  session after temporary-account creation returned 429. Local MongoDB host was
  verified before requests; the suite was absent before installation; a guard
  required seven new Things before recording cleanup IDs. Form and DOM program
  round trips, private reads and fixture cleanup passed. No rate limit was
  changed or bypassed.
- All 83 API capability checks and changed-file lint passed. The typecheck
  ratchet remains at 89 pre-existing errors. Full Vercel-parity build and output
  verification passed.
- Graphify structural snapshot refreshed atomically. This is not a claim of
  fresh semantic documentation extraction while that local backend is offline.

Hosted preview, exact-head checks, merge and production verification are the
remaining delivery gates for this PR. The broader all-standards goal remains
unfinished.
