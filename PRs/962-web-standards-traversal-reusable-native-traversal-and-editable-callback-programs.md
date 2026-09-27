# PR #962 — Reusable native traversal and editable callback programs

Branch: `codex/web-standards-traversal`. Target: `main`.

## Behavior

Forty-one TreeWalker, NodeIterator, NodeFilter and Document factory entries now
have complete saved Component programs. Users can edit the tree, masks, starting
positions, filter function instructions, captured bindings and result projections.
The generic synchronous callback object/function primitive also serves XPath
namespace resolution. Definitions persist through canonical catalogue/save Actions
and ordinary Component Things; live browser receivers are recreated per run.

Native DOM execution supplies filter identity, skip/reject behavior, pointer
reversal/removal and recursive-filter InvalidStateError. Strict regular callbacks
preserve native this; arrow definitions retain lexical undefined this. Native
candidate-reference adjustment remains observable when filtering mutates a tree.
The bounded interpreter uses the existing program vocabulary without source eval,
global access or asynchronous substitutions. Existing owned receiver policy and
request budgets apply recursively. Definitions, execution, copies, collections,
strings, calls and tree size are bounded; cyclic/expanded returned data is refused
before the worker decoder. Thrown falsy data and nested handle identity survive
the existing protocol. NodeFilter constants use captured static descriptors.

Both manifests and the Actions client negotiate 1.35.0. Current main's Schema,
Lopu prompt and dictation changes are integrated without changing their contracts.
Runtime boundaries are documented separately from DOM/Web IDL semantics. No new
Component renderer, Thing kind, storage endpoint or sandbox permission is added.

## Validation

- Native focused audit: 115/115 passed, covering 82 default/edited recipe runs and
  33 lifecycle, mutation, callback identity/receiver, thrown-data and boundary cases.
- Broad audit: 2,652 passed, 202 explicit unsupported cases and one oklab startup
  timeout during build activity. Its default and edited variants passed on retry.
  The final cyclic-return guard then passed the focused native and unit suites.
- Platform tests: 163 passed, one opt-in skip. Integrated capability tests: 91.
  Components: 48. Actions: 156 passed, one skip. Focused lint and production build
  including Vercel output checks pass. TypeScript is 91 baseline / 91 current,
  with no introduced diagnostics against current main a857d3a44.
- Nine edited programs round-trip through real catalogue Actions and private
  Component writes; anonymous reads are 404, suite installation is idempotent.
- Local Builder: replace the filter AST with a nodeName-based span selector;
  save/full reload and Run returns only first/second. The same Component works
  on a second private page. Stop removes its iframe and fresh Run succeeds.
  Desktop and 390px screenshots/bounds show no horizontal overflow.
- IAB validated the UI. Native audit uses the previously established fresh-profile
  Chrome fallback for the cross-origin harness. No user browser profile inspected.
- Source review covers ownership, native callback semantics, synchronous work,
  worker transport and persistence. Review is by the implementing agent; it is
  not described as an independent review. Graph/manifest refreshes are atomic.
  Exact reviewed-head CI, preview and production receipts are recorded in the PR.

Coverage remains incomplete: 4,914 interactive, 2,189 inspection, and 11,695
requiring context, out of 18,798 entries. Browser support is separately reported.
