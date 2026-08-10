# PR #222 — Typecheck ratchet warning-only CI

## Purpose

Keep typecheck growth visible without failing Web CI, while preserving the
historical required-check identifier configured in the `main` ruleset.

## Required-context repair

The warning-only implementation originally renamed the build job from
`Build + typecheck ratchet + unit tests` to
`Build + typecheck warning + unit tests`. GitHub branch protection matches the
literal check name, so the successful renamed job could not satisfy the old
required context and PR #222 remained blocked.

The job now retains the historical label as a stable ruleset identifier. Its
typecheck step remains explicitly warning-only.

## Path-filter repair

GitHub leaves required checks pending when an entire workflow is skipped by a
path filter. Web CI now starts for every pull request and classifies changed
files with the read-only pull-request API:

- `remix/**` or `.github/workflows/web-ci.yml` changes run the real build and
  API jobs under the exact required names.
- Other changes run lightweight companion jobs under those same exact names;
  the expensive jobs use distinct skipped names.
- An incomplete changed-file response runs the full suite. A classifier
  failure emits neither required name, so protection fails closed.

## Validation

- Static Web CI required-context contract
- Action workflow syntax validation
- Typecheck-ratchet unit tests
- Targeted lint for the new Node contract
- `git diff --check`
