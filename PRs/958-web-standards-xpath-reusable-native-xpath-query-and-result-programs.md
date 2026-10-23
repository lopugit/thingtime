# PR #958 — Reusable native XPath query and result programs

Branch: `codex/web-standards-xpath`. Target: `main`.

## Behavior

Thirty XPath entries now contain editable database program definitions. A saved
Component owns its document, query, context, namespace map, native result type,
operations and projections. Programs use Document or constructed evaluators,
compile expressions and compose live result objects. They retain native scalar,
iterator, snapshot, node identity and exception behavior. There is no separate
XPath Component renderer or storage path.

Synchronous queries require an owned detached document: returned-node checks
alone cannot stop scalar queries from reading outside a surface. Expressions,
actual tree/text size and accumulated native work are bounded before execution.
Compiled expressions share those evaluation budgets. Native Node namespace
resolvers retain identity; saved prefix maps provide bounded synchronous callback
values. Asynchronous worker callbacks are rejected as synchronous resolvers.
Live native handles remain run-local; complete reusable definitions persist.

The DOM Living Standard XPath interfaces were checked on 2026-09-27. Its
algorithms remain incompletely specified; the bridge preserves native behavior.
The tested Chromium maps unknown unsigned-short result types to ANY_TYPE. Runtime
syntax/tree/work limits are documented separately from standard semantics.

Both origin manifests and client Actions negotiate actions-run 1.34.0.
Current main Timeline changes are integrated; unrelated Timeline contracts and
capabilities remain intact.

## Validation

- All 85 focused native cases pass: exact default/edited results for 30 entries
  and 25 native lifecycle, ownership, callback and resource-boundary cases.
- Broad browser regression: 2,537 pass, 202 explicit unsupported cases, one
  CSSMathClamp startup timeout during concurrent build work. Both default and
  edited variants passed on retry. The two-second execution limit was unchanged.
- Platform: 157 pass, one opt-in skip. Capabilities: 89 pass. Actions: 156 pass,
  one skip. Components: 46 pass. Schemas: 236 pass. Pages: 138 pass, three skips.
  Focused lint passes; TypeScript remains 91 baseline / 91 current diagnostics
  with none introduced. Production build and Vercel output checks pass.
- Nine edited programs round-trip through actual catalogue Actions and private
  Component API writes. Anonymous reads return 404; installation is idempotent.
- In the local disposable account, save/full reload retains an edited namespaced
  compiled query selecting Beta. A second private page reuses the same Component.
  Stop removes the frame; fresh Run retains the result. Desktop and 390px layouts
  fit their viewport. Browser screenshots and exact fixture IDs remain outside git.
- IAB validated the local Builder flow. Broad/focused native audit uses the
  previously authorized fresh-profile Chrome fallback for cross-origin harness
  execution. No user browser profile or credential storage was inspected.
- Source graph/manifest refreshes are atomic. Final reviewed-head CI, preview,
  production deployment and private saved-example receipts are in the PR body.

Overall coverage is still incomplete: 4,873 interactive, 2,189 inspection and
11,736 requiring context, out of 18,798 entries. Native browser support is
independent of that inventory coverage.
