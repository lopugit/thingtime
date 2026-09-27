# PR #940 — Add reusable CSS function comparisons

2026-09-27. Branch `codex/web-standards-css-functions`, base `main`.

## Behavior

106 distinct CSS functions cover 180 function/published-value entries, adding
137 interactive entries and upgrading 43 previous examples. Total coverage is
4,058/18,798 (HTML 302, CSS 1,196, JavaScript 890, Web APIs 1,670); 14,740 entries
still lack worked interactive examples. Same-name paged-media element() remains
unimplemented instead of receiving the unrelated image-function recipe.

Every example is ordinary Component document/style/parameter data saved through
the canonical catalogue and authored Action. Comparison contexts include named
anchors, nested counters, pseudo-elements, paused easing animations, perspective,
grid tracks, colour schemes and typed attribute values. The generic CSS probe
observes a scoped target and control, distinguishes syntax acceptance from
computed values, and labels originating-element rectangles explicitly. Both
stored and substituted probe fields are bounded. No network/account/CSP scope
expansion. Both manifests and client negotiation advertise actions-run 1.26.0.

## Validation

128 platform tests pass, one opt-in skip; 83 capability tests pass. Targeted lint
and full Vercel build/output verification pass. The installed TypeScript
configuration reports 91 diagnostics on both base and branch, with zero
introduced diagnostics (the tracked ratchet baseline is 89).

962 local opaque-runtime browser checks: 932 pass, 30 explicit unsupported,
zero failures. This includes default/edited runs for all 180 entries, eleven CSS
probe regressions and 591 prior SVG/filter/Canvas/DOM/form checks. Every supported
edited pair changes native computed output. Five CSS functions are unsupported
in tested Chromium: cross-fade(), device-cmyk(), image element(), image filter()
and symbols(); their published aliases and prior SVG limitations account for
the unsupported test count. A deliberately rejected CSS declaration is a passed
boundary test, not counted as a missing browser feature.

All edited programs pass private catalogue/Thing readback and anonymous 404
checks. An immediate save-draft test after the long mutation batch encountered
the normal API rate limit and exceeded its Action deadline; its delayed local
fixture was identified through the API for cleanup. The separate real Builder
save succeeds after the rate window, with hypot(120px, 160px) computing to 200px.
Desktop/390px checks show no page overflow (390px page/scroll width, 350px frame);
Stop removes the frame and fresh Run restores the correct edited result.

Final saved-Component reload, graph and exact hosted receipts are recorded in
the PR body before delivery. The full goal remains active.

The saved Component was fully reloaded and returned its preserved 200px width.
Nine local suite/UI/delayed-Action records were removed; the API round-trip
fixture had already been removed. All mutations were confined to the disposable
127.0.0.1:18733 Mongo endpoint through the application API.

Semantic Graphify extraction was attempted through the configured local Codex
proxy. All six chunks returned 502 codex_execution_failed; documentation semantic
freshness is therefore unverified. The structural graph is refreshed separately.

CSS probes call the native Element geometry method so a form control named
getBoundingClientRect cannot shadow the observation. A native regression covers
this case alongside the existing form-clobbering boundaries.
