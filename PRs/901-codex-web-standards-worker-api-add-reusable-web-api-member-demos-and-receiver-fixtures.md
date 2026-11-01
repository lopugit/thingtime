# PR #901 — Add reusable Web API member demos and receiver fixtures

## Behavior and scope

Web API members previously exposed availability probes without worked receiver
examples. `webApiFixtures.ts` adds 248 authored programs for URL/query/header/form
members, blobs/files, request/response metadata and body decoding, text encoding,
DOM exceptions and geometry. The catalogue now has 272 interactive Web API
entries and 2,134 interactive entries overall (HTML 227, CSS 1,059, JavaScript
576, Web APIs 272) within the unchanged 18,798-entry inventory.

These are complete editable Component programs. Existing bounded compiler and
opaque iframe/worker primitives execute them; the runtime has no catalogue ID
switch, account bridge or new permission. Mutating methods return observed
receiver state. Native objects are projected into bytes, entries, body text or
coordinates. Only parameters referenced by the program appear in its controls.
Static operations and constants do not construct an unrelated receiver first,
so invalid URL.canParse input returns false and URL.parse returns null. Native
invalid-input errors remain errors. Missing members remain unsupported, and
Window-only matrix string parsing remains context-dependent.

This increment does not implement the full web platform. DOM/document contexts,
permissions, devices, media, network lifecycles, remaining language constructs,
deeper CSS/HTML recipes and persistent saving of workbench drafts remain work.

## Validation

- Actual Chrome 153.0.8010.53 audit of the built opaque iframe and worker:
  272 Web API examples passed; zero unsupported, program or frame-load failures.
  Report: `/tmp/tt-worker-api-browser-audit.json`.
- Hosted preview: URL.canParse, TextEncoder.encodeInto,
  DOMMatrixReadOnly.transformPoint, Blob.slice and Body.formData all passed.
  Report: `/tmp/tt-pr901-hosted-audit.json`.
- Web Platform suites: 18 passed and the separate opt-in install test skipped.
  Worker-source assertions cover changed collections, byte capacity, body
  decoding, constants, invalid URLs/JSON, missing features and retained
  context-dependent labels. The skip is not counted as API acceptance.
- Separate real API check on the existing disposable local account passed:
  idempotent reinstall preserved all six IDs; a newly saved geometry Component
  retained its whole program through read/update; anonymous reads returned 404;
  the exact test Thing was deleted through the API.
- Local built-client browser checks passed invalid URL parsing, changed query
  collection values, UTF-8 destination capacity, geometry arguments and mobile
  width. Screenshots at desktop/390px were inspected through the footer.
  The long geometry title wraps; existing floating global controls can cover
  part of it at one scroll position. No layout or global-control change is
  included in this recipe-only increment. Report: `/tmp/tt-worker-api-page.log`.
- Targeted lint passed. The local production build and Vercel artifact/CSP
  verifier passed. Final source is also built by the exact-head remote checks.
- Initial local and CI typechecks reported 93 errors against baseline 89;
  the four additions were two Object.hasOwn library-target errors and two
  inferred expression-map type errors in the new helper. The helper now uses
  the compatible own-property check and an explicit expression-value map.
  The baseline is not raised; final diagnostics and CI are checked before merge.

Graphify is refreshed after source/docs are finished. The graph/manifest pair
and new source/document presence are verified against the source fingerprint.
The local semantic proxy health request timed out; document semantic coverage
is not asserted, while the structural snapshot remains usable.

## Delivery

Branch: `origin/codex/web-standards-worker-api`.
PR: https://github.com/lopugit/thingtime/pull/901.

Initial head `8d2c0829dedc887baac7d1cab2db2bdf6e9d562c` passed build/unit, API,
CodeQL and security checks, with the typecheck warning above inspected and
corrected. Its ready preview was https://pr-901.previews.dev.thingtime.com,
immutable https://thingtime-brpzfytyr-lopugits-projects.vercel.app, provider
https://vercel.com/lopugits-projects/thingtime/dpl_CqpH1et8cy1ZN2m4c6nBxdcfaoJR.
Final-head results and preview provenance are recorded on the PR.

The existing private @lopu page remains https://thingtime.com/p/web-standards,
Thing `a5e106e6-b880-4b97-b42b-ab2bea541122`. Its definitions are not overwritten.
PR #900's production merge `7fef393ddbd4a058780049c4293beb985f1881d4` and runtime
SHA-256 `19b94d2699baca4418a8c68f564be89fc7cfcb1e49a6ad45a3ba45e6d02b63a1`
were verified on the live page. Intl.Collator returned -1 and HTML navigation
restored the selected filter with 386 entries. One cold Intl run hit the
execution deadline before a minimal program and the restored Intl example
succeeded; that cold-load limitation is retained rather than claiming every
production attempt passed.
