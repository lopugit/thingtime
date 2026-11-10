# PR #924 — Reusable ECMAScript receivers and prototypes

The catalogue had 136 built-in entries without a worked receiver example. This
change authors those and improves 22 existing prototype recipes, using 158
complete data programs. Coverage is now 2,792 interactive entries out of 18,798
indexed: 227 HTML, 1,059 CSS, 737 JavaScript and 769 Web API entries. All 638
indexed ECMAScript built-in entries have worked recipes; 209 language and 916
internal specification entries remain without them. Full standards coverage
remains unfinished.

## Implementation

DataView programs expose actual backing bytes, view offsets, numeric truncation,
endianness and decimal-string BigInt precision. Iterator helpers show native
lazy callback receipts and the remaining original iterator. Weak collections
compare object identity; computed insertion shows callback counts. WeakRef and
FinalizationRegistry retain strong targets and never promise collection timing.
Function apply/call/bind, Promise then/catch/finally, errors, symbols and global
conversion functions return native results from editable inputs.

Prototype programs use ordinary Object/Reflect operations to inspect descriptors,
then extend a fresh receiver with an editable inherited label. Intrinsic
prototypes stay unchanged. Async/generator functions are compiled from existing
structured language nodes and actually invoked. Source-string constructors are
never invoked. No runtime/worker/CSP change, new compiler operation, feature-ID
dispatch or parallel storage architecture was introduced. Saved Components retain
all steps and defaults. The additive catalogue contract is api.actions-run 1.16.0
in both manifests and client negotiation.

## Validation — 2026-09-27

- Real in-app browser: 165 cases (158 defaults and seven edited variants), 163
  passed, two explicitly unsupported SharedArrayBuffer cases, zero failures.
  Modern native WeakMap insertion methods passed, including computed callback
  count zero for an existing key and one for a missing key.
- Eight focused semantic tests exercise byte windows/order/truncation, exact
  BigInt, invalid bounds, iterator laziness and short-circuiting, weak identity,
  deterministic unregister, promise settlement/cleanup errors, binding, editable
  error names, function-family constructors, native prototype accessors and
  saved program snapshots. All 158 defaults run or report native unavailability.
- Platform suite: 59 passed, one opt-in API skip. Real local API ran separately
  against the explicitly checked disposable database using its existing isolated
  account: install idempotency, complete Component write/read/update and anonymous
  404 passed, including DataView, iterator, Promise and prototype programs.
- Changed-source lint passed. Final integrated capability, typecheck and full
  Vercel-parity build results are recorded in the PR delivery receipt.

The branch integrates main's #922 form/pending/page context changes and preserves
both sets of release/checklist notes. Hosted preview and production acceptance
will be recorded against the exact deployed commits in the PR receipt.
