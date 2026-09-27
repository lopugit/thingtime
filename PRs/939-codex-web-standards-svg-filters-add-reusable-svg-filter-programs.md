# PR #939 — Add reusable SVG filter programs

2026-09-27. Branch `codex/web-standards-svg-filters`, base `main`.
The user requested ongoing main merges and production @lopu delivery.

## Behavior

192 reusable programs cover Filter Effects DOM interfaces/members and animated
Boolean/Integer values. Interactive coverage becomes 3,921/18,798: HTML 302,
CSS 1,059, JavaScript 890, Web APIs 1,670. Every example is ordinary Component
program data: editable document graph, typed inputs and native DOM steps, saved
through the existing catalogue, Thing storage and authored Action contracts.
Original/filtered drawings make blur, shadows, colour matrices, channel transfer,
convolution, blend/compositing, lighting, displacement, morphology, merge, offset,
images, tiling and turbulence visible. Transfer examples select the operation mode
that uses their demonstrated property; alpha transfer visibly changes opacity.

The generic native bridge owns filter receivers and preserves native outputs and
exceptions. Limits: four filters, 32 filter nodes, explicit user-space regions
up to 512, blur 16, radius eight, four octaves, convolution order five, 32 list
entries and bounded numeric values. These are input budgets, not guarantees of
exact GPU allocation. Relative/object-box contexts remain unfinished. PNG images
are embedded, at most 128px per edge and 24,000 URI characters; animated or
unregistered chunks and external sources are refused. Both initial data and
nested setters/list insertion enforce budgets before native work. Literal SVG
Boolean attributes serialize true/false rather than HTML presence semantics.
Element checks do not invoke SVG/Element accessors on Document/text receivers.

No network/account/device permission or CSP expansion. Both capability manifests
and client negotiation use actions-run 1.25.0. Published Filter Effects Level 1
is a 2018 Working Draft, and the inventory retains its editor-draft status.
This incremental update does not claim complete standards coverage.

## Validation

- 126 platform tests pass, one opt-in integration skip; 83 capability tests pass.
  Typecheck retains the existing 89-error baseline; targeted lint is clean.
- 590 local opaque-runtime browser checks: 578 pass, 12 explicit unsupported,
  zero failures. Includes 23 filter native/boundary fixtures plus prior SVG,
  Canvas, DOM and form regressions. Six new unavailable entries: Gaussian
  edgeMode/four constants and feImage.crossOrigin; prior six SVG limitations
  remain unchanged.
- All 192 edited programs round-trip through the private API. Canonical suite
  install creates seven records then zero on retry. Authored browser save-draft
  works; anonymous reads return 404. A dev rebuild interrupted an initial read;
  its disposable fixture was cleaned and the complete run subsequently passed.
- Each of 25 filter element families rendered in a visual gallery. Desktop and
  390px checked: page width/scroll width 390, runtime frame 350. Edited colour
  #0ea5e9 and blur X=6/Y=3 return matching native values. Stop removes the frame;
  rerun starts a fresh result and completed drawings remain visible.

Full build, saved-Component reload, graph refresh and exact hosted deployment
receipts are completed in the PR body before delivery. The full goal remains active.
