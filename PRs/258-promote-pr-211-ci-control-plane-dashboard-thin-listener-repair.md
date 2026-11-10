# PR #258: Thin-listener promotion repair

## Why the historical promotion failed

PR #258 correctly replaces product-branch workflows with thin reusable
listeners, but its replay also retained
`.github/scripts/deploy-develop-pr-preview.mjs`. The current product-branch
topology allows no executable Actions behavior outside the protected
`github-actions` branch, so the historical caller contract reported that file
and the required build job failed.

## Repair

- Remove the stale develop-preview controller script from the product branch.
- Keep the workflow-caller and required-context scripts available for manual
  and protected advisory use, but remove both from the blocking `test:unit`
  aggregate.
- Grant the thin Web CI caller `pull-requests: write` so the protected
  no-checkout advisory job can update a warning comment. The reusable build,
  API, and checkout jobs retain their own read-only permissions.

The promotion still contains only trigger/input/permission listeners under
`.github/workflows/`; executable controller behavior remains centralized on
`github-actions`.
