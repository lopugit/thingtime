# PR #928 — Reusable TypedArray and iterator intrinsic examples

The catalogue gains 67 interactive recipes: 40 TypedArray intrinsic entries and
27 iterator, generator, symbol and internal enumeration entries. Coverage is
2,859 of 18,798 indexed entries: 227 HTML, 1,059 CSS, 804 JavaScript and 769 Web
API. JavaScript has 638 built-in, 77 language and 89 specification recipes;
208 language and 850 specification entries still need worked examples. The
full standards goal remains unfinished.

## Implementation

TypedArray recipes invoke the actual shared intrinsic with one of twelve native
constructors. Editable values expose native signed wrapping, clamping, widths,
byte windows, BigInt precision, callback thisArg/visitation, mutation and shared
versus copied storage. Known unavailable constructors and methods report that
fact; invalid names, bounds and input types retain errors.

Iterator and generator programs run real language/protocol operations, including
lazy helpers, suspended finally cleanup, recovery/rethrow, wrapper fallback,
Unicode iteration and UTF-16 segment containment. Hidden async-from-sync and
for-in objects are observed through actual language constructs and explicitly
identified as such. The missing-throw example preserves the engine's trace and
compares cleanup/rejection with ECMA-262 2026. Node 22's older native behavior
reports a mismatch; it is never replaced with simulated compliance.

Every example is complete reusable Component program data using existing nodes.
No compiler/runtime/CSP changes, raw-source escape or catalogue-ID execution
dispatch is introduced. The catalogue contract is api.actions-run 1.17.0 in both
manifests and client negotiation. Main's #925 menu controls are integrated.

## Validation — 2026-09-27

- Real in-app browser: 93 cases (67 defaults and 26 edited variants), all passed.
- Nine semantic tests passed on Node 22.23.2 and the current runtime: all twelve
  typed-array constructor choices, exact BigInts, native errors, callbacks,
  byte sharing, iterator state, generator cleanup and edited saved drafts.
  Missing-throw behavior is checked against an independent native oracle.
- Platform suite: 68 passed and one opt-in API skip. The real local API test
  passed separately against an explicitly verified disposable database:
  idempotent suite install, full program write/read/update, ownership and
  anonymous 404, including TypedArray, generator and hidden-adapter programs.
- Local UI edited cleanup and return values, saved a private Component and
  reopened it with both defaults intact. Reload/run acceptance is recorded in
  the final delivery receipt.
- Capability tests: 83 passed. Changed-source lint passed. Typecheck ratchet
  remains at its existing 89-error baseline. Full Vercel-parity build and output
  verifier passed.

Graph freshness, hosted preview and production acceptance are recorded in the
PR receipt against exact commits. A structural graph does not establish semantic
extraction success, and a preview does not establish production delivery.
