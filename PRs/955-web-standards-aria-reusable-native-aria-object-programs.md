# PR #955 — Reusable native ARIA object programs

Branch: `codex/web-standards-aria`. Target: `main`.

## Behavior

All 53 ARIAMixin catalogue entries now contain editable native programs. A saved
Component carries nullable properties, roles, selectors, content attributes,
relationship assignments and result projections. Examples compare native property
assignment with attribute reflection and support null clearing. They demonstrate
reflection rather than claiming to be complete accessible widgets.

The generic Element policy accepts bounded nullable strings and owned element
references. FrozenArray transport preserves immutability, cached array identity,
element identity and old snapshots after relationship changes. Ordinary arrays
remain mutable. There is no dedicated ARIA Component renderer.

Explicit relationships require an active owned surface: copying a detached DOM
would discard relationships in the visible projection. Lists are capped at 64
owned Element handles, strings at 4096 characters, frozen arrays at 128 per run.
The original DOM ownership, request/handle limits, terminable worker and opaque
network-denying runtime CSP remain. Missing native properties report unsupported.

Catalogue Actions and both origin manifests negotiate `api.actions-run` 1.33.0.
The existing canonical suite installation, Action/Component persistence and page
reference contracts are unchanged. The animation stage uses content-driven height
so wrapped tile labels fit; previously saved definitions are not silently changed.

## Validation

- Full native regression: 2,453 pass, 202 explicit unsupported cases, zero
  failures across 2,655 cases. Focused local and hosted preview audits each passed
  119 cases with two unsupported ariaOwnsElements variants and zero failures.
- Platform tests: 154 pass, one opt-in integration skip. Capabilities: 88 pass.
  Schemas: 236 pass. Actions: 156 pass, one skip. Components: 46 pass.
  Pages: 138 pass, three skips. Focused lint passed.
- TypeScript comparison: 91 baseline / 91 current diagnostics, none introduced.
- Nine edited programs round-tripped through canonical catalogue Actions and the
  real Component API, including private anonymous 404 checks. Reinstall was
  idempotent. Disposable fixture IDs and cleanup receipts stay outside git.
- In a disposable account, the Builder saved an edited relationship to #second.
  A full reload retained that input and native frozen-list result. A second
  private page reused the same Component; Stop removed the frame and a fresh Run
  restored the edited result. Anonymous reads of both saved Things returned 404.
- Desktop and 390px browser checks cover inputs, results and both animation tiles.
  Resize screenshots wait for layout; the mobile document remains 390px wide.
  A fresh animation run produced the expected 0.625 opacity / 60px translation.
- Production build and Vercel output verification passed. Required CI passed at
  the initial reviewed head. The preview at pr-955.previews.dev.thingtime.com
  served both 1.33.0 manifests, the expected runtime hash and opaque CSP.
- IAB and native Chrome control timed out during local validation, so the
  workspace-authorized standalone Playwright fallback used a fresh isolated
  Chrome profile. The PM2-managed local stack briefly became unavailable, then
  recovered; the loopback database was reverified before further mutations.
  One interactive animation run hit the unchanged two-second deadline during
  local load; its fresh rerun and full native regression passed.
- Final-head CI, exact preview/deployment identity, production verification and
  cleanup receipts are recorded in the PR body. Native browser support and
  deployment status are not inferred from catalogue coverage.

The overall Web Standards goal remains incomplete: 4,843 interactive entries,
2,189 inspection entries and 11,766 entries requiring additional context, out of
18,798. Native availability is independent of catalogue coverage.

## Standards

[ARIA IDL interfaces](https://w3c.github.io/aria/#idl-interface) and
[HTML reflection](https://html.spec.whatwg.org/multipage/common-dom-interfaces.html#reflecting-content-attributes-in-idl-attributes)
were checked on 2026-09-27. Draft/status metadata stays in the inventory.
