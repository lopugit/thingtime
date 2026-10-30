# PR 190 — Per-feature develop to main promotion PRs with stacks

Branch: `claude/github-action-pr-promotion-c65173` · PR:
[#190](https://github.com/lopugit/thingtime/pull/190)

## Why this repair was needed

PR #190 conflicted after newer features landed on `develop`. Its generated
Graphify files had diverged on both sides, and `remix/CHANGELOG.md` carried
independent entries from the promotion feature and the integration branch.
The exact Git conflict inventory was `graphify-out/GRAPH_REPORT.md`,
`graphify-out/manifest.json`, and `remix/CHANGELOG.md`; the Graphify merge
driver had also combined `graph.json`, so the repository's whole-directory
reset/regenerate rule still applied to every generated Graphify artifact.

The resolver had two distinct routing gaps:

1. A detector could hand work to `repository_dispatch`, but GitHub loads that
   event's workflow from the repository default branch (`main`). Resolver fixes
   already merged to `develop` therefore did not govern a PR targeting
   `develop` until those fixes were also promoted to `main`.
2. The manual `branch` field selected PR bases only. Running it with PR #190's
   head branch matched zero PRs, completed the detector successfully, and left
   the model/resolve jobs skipped without an actionable message. That was a
   selection miss, not an AI-model failure.

## Conflict repair

- Merged the exact current `develop` tip into the exact PR #190 head while
  preserving the per-feature promotion workflow and changelog generator.
- Resolved the ordinary changelog conflict semantically, retaining both the
  integration fixes and PR #190's promotion entry.
- Took one coherent side for all `graphify-out/` conflicts, then regenerated
  the graph, manifest, report, HTML export, and semantic cache from the merged
  source tree per the repository rule; generated graph files were never mixed
  by hand.

## Resolver control-plane hardening

- `develop` is now the repo-designated integration control plane for resolver
  workers. Detector handoffs and direct stacked-child cascades call the Actions
  workflow-dispatch endpoint with a fixed `ref: develop` and one exact PR
  number; the worker re-queries and snapshots the live PR refs on arrival.
- All human/external workflow-dispatch runs remain API-only detectors. The
  secret-bearing model and resolve jobs require a bot-originated internal
  handoff on `develop`, a positive PR number, an empty branch selector, and a
  valid capped cascade depth. The bot actor is routing-provenance
  defense-in-depth; the fixed workflow ref plus live repository/PR/ref/SHA and
  ownership revalidation are the substantive publication controls.
- Human selectors accept an exact PR number or any PR base/head branch. A
  selector matching no open PR now fails with guidance and a step summary; a
  selector whose matches need no merge worker emits a visible warning/summary.
- Human explicit selection carries `manual_retry` through the internal handoff
  so a deliberately retried paused snapshot is distinguishable from ordinary
  machine detection. Internal handoffs never hand themselves off again.
- External detector and internal worker concurrency namespaces are separate:
  disposable detector runs may be superseded, while per-PR internal workers
  are never canceled by the detector that spawned them.
- Stacked-child dispatch runs after every successful resolution, including
  PAT-backed pushes whose push event also detects the child. Duplicate
  discovery is safe because internal workers serialize per PR without
  cancellation and re-detect live state before resolving.
- Legacy `repository_dispatch` remains detector-only for bootstrap/backward
  compatibility and immediately hands selected PR numbers onward to the fixed
  `develop` control plane. Until this revision is promoted to `main`, an old
  default-branch workflow can still be the first bootstrap hop; it cannot be
  retroactively changed by code present only on `develop`.

## Remaining hardening

- `rebase-pr-stacks.yml` still hands rebase work through default-`main`
  `repository_dispatch`. It needs an analogous detector/worker control-plane
  split in a focused follow-up; this repair deliberately does not broaden into
  a second large workflow rewrite.
- `develop` is currently unprotected. Repository administration should add a
  branch ruleset for the integration control-plane ref and ideally place the
  resolver credentials in a GitHub Environment whose deployment rules permit
  only `develop`/`main`. No branch, ruleset, Environment, or secret setting was
  changed as part of this code-only repair.

## Verification

- Deterministic routing contract fixtures cover blank/base/head/PR human
  selectors; valid internal workers; wrong ref, actor, branch, PR and depth;
  forbidden human retry metadata; and legacy `repository_dispatch`.
- Every workflow YAML file parses, every embedded Bash `run` block passes
  `bash -n`, and the resolver routing/promotion scripts pass Node syntax and
  self-tests.
- Graphify JSON/manifest integrity, graph diagnostics, generated portable
  outputs, `git diff --check`, and merge index writeability are checked after
  the final source refresh.
