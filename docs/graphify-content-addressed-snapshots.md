# Content-addressed Graphify snapshots

Thingtime stores Graphify output as immutable snapshots rather than asking
every branch to edit the same `graphify-out/graph.json`, `manifest.json`, and
`GRAPH_REPORT.md` paths.

## Why

Graphify's upstream merge driver is useful on machines where it is installed,
but Git custom merge drivers live in local Git configuration. GitHub cannot run
an arbitrary repository-provided driver while calculating PR mergeability.
Git's built-in `union` driver is also unsuitable for Graphify's atomic JSON
pair: Git warns that union output can have lines in random order, and combining
two manifests can mark discarded graph data as already analyzed.

The design follows the same content-addressed pattern already used by Git and
build caches:

- [Git stores objects by content-derived keys](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects.html).
- [Bazel separates an action-key map from a content-addressable output store](https://bazel.build/remote/caching).
- [Git attributes document that custom merge drivers are configured locally and that `union` requires semantic review](https://git-scm.com/docs/gitattributes).
- [Graphify's upstream multi-developer support union-merges `graph.json`](https://github.com/Graphify-Labs/graphify/discussions/689), but does not make the manifest/report pair atomic on GitHub.

## Layout

```text
graphify-out/
  snapshots/v1/<source-fingerprint>/<artifact-hash>/
    graph.json
    manifest.json
    GRAPH_REPORT.md
    cost.json
    snapshot.json
  cache/semantic-cas/v1/<input-key>/<content-hash>.json
  .work/.../cache/semantic/<input-key>.json    # ignored private hydration
  graph.json -> snapshots/.../graph.json        # ignored compatibility alias
  manifest.json -> snapshots/.../manifest.json  # ignored compatibility alias
  GRAPH_REPORT.md -> snapshots/.../GRAPH_REPORT.md
```

`source-fingerprint` is SHA-256 over a temporary Git tree containing the actual
tracked and non-ignored worktree, excluding all of `graphify-out/`. It is stable
before and after committing Graphify output, unlike a commit SHA that includes
its own generated files.

`artifact-hash` covers Graphify's version plus every portable output byte. If
two builders produce identical output, they converge on the same path. If LLM
or tool-version differences produce distinct valid outputs for identical
source, both variants coexist without a merge conflict; the router
deterministically prefers the valid variant with the most nodes and edges.

Graphify's upstream semantic cache is keyed by an input/chunk fingerprint, but
real semantic runs proved that a later model response can replace the bytes at
that same filename. The wrapper therefore ingests each result into a second,
immutable namespace keyed by both the upstream input key and the exact response
bytes. Before a run it hydrates a private mutable cache with the richest valid
variant; after a successful run it ingests new variants. A failed extraction
cannot modify committed cache state.

## Commands

Use the repository wrapper for mutations and queries:

```sh
scripts/graphify update .
scripts/graphify extract . --backend openai
scripts/graphify query "conflict resolver Graphify refresh"
scripts/graphify ensure
scripts/graphify fingerprint
scripts/graphify snapshot
scripts/graphify prune
scripts/graphify cache-migrate
```

The wrapper sets Graphify's supported `GRAPHIFY_OUT` override, hydrates a
private semantic cache from immutable variants, validates the graph/manifest pair, generates
the report and HTML, finalizes an immutable snapshot, and refreshes ignored
root aliases. Plain `graphify query` continues to work after activation because
those aliases expose the selected snapshot at Graphify's conventional paths.

Every successful mutation or `ensure` also applies bounded retention. The
default is one active portable snapshot in the checked-out tree. Set
`GRAPHIFY_SNAPSHOT_RETENTION` to a positive integer to retain a larger bounded
set for an explicit local workflow. Invalid, zero, and unbounded values fail
closed. `scripts/graphify prune` applies the same policy without rebuilding.

`extract --no-cluster` is rejected because Graphify has historically been able
to replace a large graph with only the newly extracted nodes in that mode.

## Merge behavior

Snapshot paths are additive while independent branches are in flight. Distinct
source or output hashes never touch the same path, and a matching path must
contain identical bytes. `.gitattributes` uses `-merge` as a fail-closed
hash-invariant check rather than attempting a line merge. After a branch is
activated, bounded retention removes superseded snapshot paths from that
branch's current tree.

After a successful source merge, Lopu runs the trusted snapshot router against
the merged tree and publishes the new snapshot separately. Old pre-migration
branches may conflict once on the deleted legacy root files; Lopu discards the
legacy generated directory and regenerates it under the immutable layout.

## Retention

Snapshots are portable build outputs, not source authority. The current tree
keeps the active source fingerprint and, by default, no superseded portable
snapshots. Deleted snapshot paths remain recoverable from Git history, and an
open PR or another branch retains its own snapshot until that ref adopts the
new policy. This makes pruning branch-local and safe without querying or
rewriting another ref.

The semantic CAS is intentionally not pruned with portable snapshots. It is
small relative to full graphs, makes fresh-clone semantic rebuilds LLM-free,
and may be shared by future source fingerprints. A separate CAS collector would
need a real reachability proof before removing those variants.
