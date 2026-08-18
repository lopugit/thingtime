# PR #229 — Keep develop Web CI required contexts reportable

## Purpose

Remove the pull-request path filter from `develop`'s thin Web CI listener so
the protected reusable workflow can always report the two existing ruleset
contexts.

## Develop behavior

- The listener remains executable-free and pinned to the protected
  `github-actions` implementation.
- The protected implementation chooses the full Remix suites or lightweight
  required-context companions based on the changed paths.
- The established `control-plane / Build + typecheck ratchet + unit tests` and
  `control-plane / API suite (headless /tests runner)` names do not change.

## Base-branch compatibility repair

The latest `main → develop` merge introduced the approved develop-preview
controller script while the product-branch contract still rejected all local
workflow scripts. The contract now requires exactly that one reviewed script
and continues to reject any additional local Actions behavior.

## Validation

- Path-free Web CI required-context contract
- Seven-listener protected workflow contract
- Targeted ESLint and dependency probes
- `actionlint`
- Graphify refresh and multigraph diagnostics
