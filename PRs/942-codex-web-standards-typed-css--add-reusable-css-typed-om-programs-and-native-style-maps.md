# PR #942: reusable CSS Typed OM programs and native style maps

The 249 indexed CSS Typed OM entries now have editable Component programs
using the canonical Web standards catalogue, Builder renderer and save Action.
Coverage increases from 4,058 to 4,307 of 18,798 indexed entries. The remaining
14,491 entries still need worked programs; the full user goal remains active.

## Runtime and composition

The existing opaque DOM bridge adds registered `static` factories/parsers,
constructors, native value members, style maps and constructed rule maps.
`typedCSSPolicy.ts` and `typedCSSSupport.ts` contain generic native contracts and
bounds; `typedCSSFixtures.ts` contains only reusable authored program data.
The fixtures observe native serialization, selected fields, dimensions and
computed transforms. `parseAll` uses a multi-value declaration. Matrix examples
compute their matrix once before projecting its fields.

Input text is limited to 2,048 characters, sequences to 32 items, numeric
magnitudes to 32,768, expression complexity to 256 per value and 8,192 per run.
The existing request/handle/result/input-work budgets still apply. Native unit
conversion and readonly computed maps remain native semantics. CSSNumericType
results have a fixed public-field projection. Detached constructed sheets
accept bounded style rules; stylesheet imports, escapes and adoption are not
exposed. No native account authority, origins or CSP allowances are added.
Both capability manifests and client negotiation use actions-run 1.27.0.

## Validation

- 132 platform tests pass, one opt-in test skips. All 249 default and edited
  programs compile and survive complete Component serialization.
- 83 capability tests pass; targeted lint and the full Vercel build/output
  verification pass. TypeScript base and branch each report 91 diagnostics,
  with zero introduced diagnostics (the tracked ratchet baseline is 89).
- 1,480 native-browser checks pass or explicitly report unsupported features:
  1,344 passed, 136 unsupported, zero failures. This includes 498 Typed OM
  default/edited runs, 19 native boundary cases and 963 earlier regressions.
  The draft colour object APIs account for 106 unsupported default/edited runs;
  the other 30 were already documented CSS/SVG browser limitations.
- 24 representative edited programs pass the real catalogue Action and private
  Thing API readback. Anonymous reads return 404.
- The real Builder save preserves a 48px CSSTranslate edit through full reload.
  The same saved Component renders through a reference on a separate private
  Builder page and computes `translate3d(48px, 12px, 8px)`. Stop removes the
  iframe; fresh Run works. At 390px the page has no horizontal overflow and
  the iframe is 358px wide.

A native audit exposed and resolved a missing px factory, overly conservative
transform composition charging, and computed-map iteration exceeding the
existing request cap. The iterator recipe uses real declared-map entries.
A literal-token regression keeps slash-containing CSS text separate from arithmetic cost estimates.
A second input set also caught an unchanged max() result; it now crosses the
comparison boundary, so the edited native output is distinct.

## Delivery evidence

Structural graph refresh and exact preview/main/production verification are pending at
this checkpoint. Semantic extraction was attempted through the configured local
Codex proxy, but all six chunks failed with 502 codex_execution_failed; semantic
documentation freshness remains unverified. Live deployment and saved production receipts belong in the
PR body after verification; do not infer production delivery from these local
results.
