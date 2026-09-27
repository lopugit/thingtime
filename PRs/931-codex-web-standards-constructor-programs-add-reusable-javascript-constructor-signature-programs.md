# PR #931 — Reusable JavaScript constructor signature programs

The catalogue gains 66 interactive constructor-signature entries, including
source aliases, bringing coverage to 2,925 of 18,798 entries: 227 HTML, 1,059 CSS,
870 JavaScript and 769 Web API. JavaScript has 638 built-in, 77 language and 155
specification examples; 208 language and 784 specification entries still need
worked examples. This is progress toward the full standards goal.

## Implementation

Complete editable Component programs invoke actual native constructors through
Reflect.construct or Reflect.apply. Inputs cover primitive wrappers, omitted
arguments, sparse arrays, twelve concrete typed-array constructors and five
storage overloads, buffers/views, Date, errors and descriptors, collections,
weak identity, FinalizationRegistry, Promise settlement, Proxy invariants,
RegExp identity/state and Iterator subclasses. Specification family placeholders
select an actual native constructor from a bounded list.

The Promise example uses a data-defined executor and thenable, retaining native
synchronous execution, job ordering and first-settlement behavior. Proxy traps
and Iterator classes use existing reusable language nodes. Programs preserve
native values and errors; demo allocation limits are explicitly identified.
DataView backing inputs cannot evade those limits with numeric strings or
array-like lengths, while null still reaches native conversion. Worker input cloning prevents test-only mutation leakage.

No runtime/compiler/CSP changes, source-string execution or catalogue-ID dispatch
is introduced. Saved programs retain full steps and edited defaults. The API
catalogue contract and client negotiation advance to api.actions-run 1.18.0.
Main's #929 collection-source work is integrated without changing its behavior.

## Validation — 2026-09-27

- Ten focused semantic tests passed on Node 22.23.2 and the current runtime.
- Browser audit: 141 cases, 139 passed, 2 SharedArrayBuffer entries correctly
  unsupported in the isolated context, no failures. Includes all 66 defaults,
  every typed-array constructor with copied/shared storage, native error paths,
  exact BigInts, callback order, identity and allocation limits.
- Platform suite: 78 passed, one opt-in API skip. The actual local API test
  passed separately: idempotent seven-Thing installation, complete program
  round-trips, private ownership, anonymous 404 and saved-Action execution.
- Local Builder: edited Promise to resolve through a thenable, throw after
  resolution and use a custom value. Saved private Component, reopened,
  reloaded and ran it with all inputs and native order preserved. Owner API
  readback matched; anonymous read returned 404. All eight exact local fixtures
  were removed from the verified disposable database afterward.
- Capability tests: 83 passed. Changed-source lint passed. Typecheck ratchet
  remains at its existing 89-error baseline.

Full build, graph freshness and hosted preview/production acceptance are
recorded in the final PR receipt against exact commits. Structural graph
freshness does not establish semantic extraction success. The browser audit
is targeted validation, not a claim of complete standards conformance.
