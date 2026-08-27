# PR #436 — Make Graphify output conflict-free

## Problem

Every branch previously edited the same large generated paths:
`graphify-out/graph.json`, `manifest.json`, `GRAPH_REPORT.md`, and `cost.json`.
GitHub cannot execute a repository-local custom merge driver while calculating
PR mergeability, and line/union merging cannot preserve Graphify's atomic
graph-manifest relationship. A normal source merge could therefore stop on
generated files even when the source itself was compatible.

## Design

Thingtime now publishes immutable snapshots at:

```text
graphify-out/snapshots/v1/<source-fingerprint>/<artifact-hash>/
```

The source fingerprint is derived from a temporary Git tree containing the
actual tracked and non-ignored worktree while excluding all Graphify output.
It is stable before a commit; a commit SHA would be circular because adding the
generated snapshot changes that SHA. The artifact hash covers the Graphify
version and portable output bytes. Identical builds deduplicate, while distinct
valid outputs coexist and are selected deterministically.

The repository router uses Graphify's supported `GRAPHIFY_OUT` override,
serializes local writers, hydrates a private semantic cache from immutable
variants, validates the atomic portable files, rejects violated hashes and unexplained 50% node collapse, and
maintains ignored root symlinks for ordinary query compatibility. The trusted
controller half is PR #435; Lopu never executes a PR-head wrapper with write
credentials.

A real semantic rebuild exposed a second upstream mutability edge: the same
input-key cache filename can receive different valid model-response bytes.
Thingtime now commits those results under
`cache/semantic-cas/v1/<input-key>/<content-hash>.json`, hydrates the richest
variant into a private work cache, and ingests only after a successful run.
Concurrent semantic results therefore coexist too.

## Validation

- nine deterministic CAS tests cover source/output separation, staged-index
  preservation, deduplication, valid variants, collapse rejection, corruption
  rejection, semantic-cache variants, writer serialization, and a clean
  two-branch Git merge without a custom driver;
- the real repository completed incremental semantic extraction through the
  local Codex proxy and then a final structural update;
- ordinary `graphify query` succeeds through the selected root aliases;
- post-checkout and post-commit hooks are syntax-checked and never commit or
  push;
- `.gitattributes` fails closed if a matching content-addressed path ever has
  different bytes.

## Rollout

1. Merge protected controller PR #435.
2. Merge this product PR into `main`.
3. Let Lopu regenerate the post-merge snapshot and synchronize `main` into
   `develop` through the automation-owned branch.
4. Legacy branches may conflict once on deletion of old root artifacts; Lopu
   takes one legacy side and publishes a new immutable snapshot afterward.

The full research rationale and operational runbook live in
`docs/graphify-content-addressed-snapshots.md`.
