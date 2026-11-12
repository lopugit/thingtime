# Graphify query-cache recognition repair

Upstream queries create `cache/last_query_stamp` inside the selected snapshot.
The wrapper previously rejected every snapshot entry outside its artifact file
allowlist, so a query made that snapshot unavailable for reuse and pruning.
The repair accepts the exact `cache` name only when it is a real directory;
cache files, symlinks, and unrelated entries remain invalid. Query caches stay
outside portable copying and artifact hashing. Snapshot HTML is now explicitly
ignored, matching the repository's existing derived-visualization policy.

- [Before](before.log): the routed-query regression fails on the previous
  validator immediately after a stubbed upstream query creates its cache.
- [After](after.log): `node --test scripts/graphify-cas.test.mjs` passes all
  25 tests with zero failures or skips. Coverage includes reuse without an
  upstream rebuild, byte-identical deduplication, exclusion from portable
  copies, pruning queried snapshots, invalid-entry rejection, and the ignore
  policy. Both scripts also pass `node --check`; `git diff --check` is clean.
- Independent review found no actionable issues. Tests use disposable fixture
  repositories and a stub upstream command; they do not mutate the repository's
  generated graph.

This changes only the Graphify wrapper, its tests, and `.gitignore`. Application
source/configuration and the final native acceptance package are unchanged;
no application rebuild or additional application acceptance is claimed.
