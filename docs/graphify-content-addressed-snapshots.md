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
  cache/semantic/<content-hash>.json
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

## Commands

Use the repository wrapper for mutations and queries:

```sh
scripts/graphify update .
scripts/graphify extract . --backend openai
scripts/graphify query "conflict resolver Graphify refresh"
scripts/graphify ensure
scripts/graphify fingerprint
scripts/graphify snapshot
```

The wrapper sets Graphify's supported `GRAPHIFY_OUT` override, shares the
content-addressed semantic cache, validates the graph/manifest pair, generates
the report and HTML, finalizes an immutable snapshot, and refreshes ignored
root aliases. Plain `graphify query` continues to work after activation because
those aliases expose the selected snapshot at Graphify's conventional paths.

`extract --no-cluster` is rejected because Graphify has historically been able
to replace a large graph with only the newly extracted nodes in that mode.

## Merge behavior

Snapshot paths are additive. Distinct source or output hashes never touch the
same path, and a matching path must contain identical bytes. `.gitattributes`
uses `-merge` as a fail-closed hash-invariant check rather than attempting a
line merge.

After a successful source merge, Lopu runs the trusted snapshot router against
the merged tree and publishes the new snapshot separately. Old pre-migration
branches may conflict once on the deleted legacy root files; Lopu discards the
legacy generated directory and regenerates it under the immutable layout.

## Retention

Snapshots are portable build outputs, not source authority. A future garbage
collector may remove snapshots that are unreachable from open PR heads and the
protected branch tips while retaining the shared semantic cache. Garbage
collection must run only after that reachability proof; normal branch work is
append-only.
