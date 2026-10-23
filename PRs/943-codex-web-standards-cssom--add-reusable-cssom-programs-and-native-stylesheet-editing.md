# PR #943: reusable CSSOM programs and native stylesheet editing

All 102 indexed CSS Object Model Level 1 entries now have editable Component
programs. Worked coverage advances from 4,307 to 4,409 of 18,798 entries;
14,389 remain unfinished. This batch does not complete the full-platform goal.

## Implementation

The existing DOM bridge registers native declarations, stylesheet/rule/list
interfaces, media lists, CSS.escape and getComputedStyle. Program-owned open
shadow roots can adopt owned sheets. Detached style elements expose real native
sheet/rule associations. Program data contains all example and observation
logic, with no native catalogue dispatch or new app surface.

CSS input is limited to 4,096 characters, 32 nested/cumulative rules, eight
levels and eight adopted sheets. Existing request/handle/input-work budgets
apply. Native asynchronous replacement shares the worker deadline; cancellation
fences late replies. Runtime Document/Window escape, foreign receivers and
unregistered methods remain unavailable. CSP and account authority are unchanged.
Both capability manifests and the client require actions-run 1.28.0.

The browser's CSSRule.cssText no-op, read-only computed declaration exceptions,
and cross-origin imported-sheet errors are observed rather than simulated.
Unimplemented page descriptors and ignored baseURL options report unsupported.

## Validation

- 136 platform tests pass, one opt-in test skips; 84 capability tests pass.
- The opt-in live integration assertions pass against the disposable local
  database using its existing test session. All created fixtures are cleaned.
- 1,704 native browser checks: 1,562 passed, 142 explicitly unsupported, zero
  failures. Includes 204 default/edited CSSOM examples, 20 CSSOM boundaries,
  and 1,480 prior checks. Six new unsupported runs cover bleed, marks and baseURL.
- 24 edited programs round-trip exactly through the real catalogue and private
  Things APIs. Anonymous access returns 404. The Builder save preserves an
  edited 180px adopted stylesheet through full reload; the same Component
  computes 180px on a second page through a normal Component reference.
- Stop removes the iframe; fresh Run works. The 390px screen has no page overflow
  and its iframe is 358px wide. Desktop rendering checked live.
- The full Vercel build/output verification and targeted lint pass. Fresh base
  and branch TypeScript comparison: 91 diagnostics each, zero introduced (the
  tracked ratchet baseline remains 89).

The complete authored adoption recipe initially inherited an outer sample width
that masked its shadow stylesheet. The sample now leaves width/color to adopted
styles; native default/edited regression cases require 120px/180px results.

## Delivery

Runtime SHA-256: `443ef2c819dda107fb661b7908b52e10f58b64c2f153a8deb8a5e73a59e9bfa4`.
Exact preview/production verification and production @lopu receipt are recorded
in the PR body after deployment. Structural graph refresh
passed. Semantic extraction was attempted through the configured local Codex
proxy; all six chunks failed with 502 codex_execution_failed, so semantic
documentation freshness remains unverified.
