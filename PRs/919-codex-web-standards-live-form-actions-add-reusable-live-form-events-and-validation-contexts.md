# PR #919 — Reusable live form events and validation contexts

Nine data-authored recipes cover native reset, requestSubmit, SubmitEvent and
submitter, form check/reportValidity and user-edited badInput/tooLong/tooShort.
Seven fill missing contexts; two replace detached form-validation examples with
editable live controls. The catalogue now has 2,656 interactive entries out of
18,798 indexed (227 HTML, 1,059 CSS, 601 JavaScript, 769 Web APIs).

## Framework contract

Saved Component programs opt into `allowFormEvents`. Native form validation and
submit events require both iframe and response-header `allow-forms`; without it
Chromium returns from requestSubmit without validation or submit events. The
origin stays opaque, requests remain denied, `form-action 'none'` blocks form
navigation, and an early capture listener cancels submissions. No account grant,
new storage model, custom native app block or feature-ID runtime dispatch exists.

The generic live DOM binding supports observations (event with no method) and
local `{op: 'element', selector}` arguments. Native prototype method lookup and
captured listener registration resist form named-property shadowing. Receipts
project native event targets/submitters and validity flags; at most ten receipts,
256 characters per string and 200 event operations are retained. Immediate calls
run after listener registration, and their errors cannot be overwritten by an
initial rendered-success response or a later worker success. Both manifests and
client negotiation require
`api.actions-run` 1.15.0 for the additive recipe contract.

## Evidence — 2026-09-27

- Real in-app browser: reset restored edited input, textarea, checkbox and
  select defaults despite a reset-named button. Empty requestSubmit emitted
  invalid/valueMissing; after typing, canceled submit identified the referenced
  send button. Clicking the other submit button identified publish.
- Real user typing produced badInput (`-`), tooShort (`ab`), and tooLong after
  typing Rainbow and applying maxlength 3. Correct-length input cleared flags. An edited maximum of five rejected Rainbow
  and accepted Blue. reportValidity returned false for empty required input and
  true after actual typing.
- Adversarial live programs: immediate missing-method failure stayed an error;
  body could not be used as an out-of-surface element argument; submit observers
  declared after an immediate call still received its event. Named id and
  addEventListener controls did not change native form identity/listening.
- Ten-receipt retention and the 200-operation event limit passed in the browser.
  A program without form context retained sandbox=allow-scripts only.
- Real private local API: suite install idempotency, catalogue selection,
  complete program writes/readback and anonymous 404 passed, including reset,
  requestSubmit and tooShort. Existing isolated account reused because fresh
  account admission was limited; normal API/ownership/quota checks retained.
- A separate saved private reset Component preserved its edited default after
  reopening/reload and ran in another Builder page. Exact temporary fixtures
  were removed through the canonical API after owner/database checks.
- Platform: 51 pass, one opt-in API skip in the ordinary command (real API ran
  separately). Capabilities: 83 pass. Vercel config/policy: 14 pass. Changed-file
  lint passed. Typecheck: 89 baseline errors, no increase. Full Vercel-parity
  build/output verifier passed after integrating current main and after the
  final error-propagation fix. Component tests passed on the integrated tree.

The source includes main's media-form PR #918 (`261c4fcc`) and preserves both
changelog/checklist sections. Hosted/production acceptance is recorded in the PR
receipt when the exact deployment is ready. Mixed immediate-DOM/worker failure masking was
reproduced in the browser and fixed by stopping before worker startup.
Graphify semantic extraction was attempted through the healthy local Codex proxy,
but all six chunks returned HTTP 502 `codex_execution_failed`. No partial
semantic result was published; the source graph is refreshed structurally.
Full standards coverage remains unfinished; direct submit/navigation, pickers,
constructors and pattern validation still need their respective contexts.
