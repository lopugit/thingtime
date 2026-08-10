# PR #228 — Preserve required Web CI contexts in the control plane

## Purpose

Keep the protected `github-actions` Web CI implementation reportable for every
pull request while avoiding the expensive Remix build and API suite for changes
outside `remix/`.

## Required-context routing

- The pull-request listener has no path filter, because a required workflow
  skipped at trigger time never reports its context.
- A read-only scope job sends `remix/**` and Web CI workflow changes through the
  real build and API jobs.
- All other pull requests receive lightweight companion jobs under the same
  stable build and API context names.
- Incomplete file lists and GitHub changed-file API errors run the full suite,
  preserving correctness during transient diff-generation failures.

Product-branch listeners remain thin reusable-workflow callers. On `develop`,
GitHub continues to prefix the two inner names with `control-plane /`, matching
the existing ruleset identifiers.

## Validation

- Protected workflow control-plane suite
- Static Web CI required-context contract
- Full Remix Node unit suite
- Targeted ESLint and Prettier dependency probes
- `actionlint`
- Graphify refresh and multigraph diagnostics
