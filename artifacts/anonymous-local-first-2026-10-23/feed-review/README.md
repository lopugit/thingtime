# Final feed review regression evidence

A captured owned-only feed projection could survive deletion during asynchronous ranking because the final read fence only inspected retained read-cache refusal watermarks. Ordinary local deletion creates no such watermark when there are no retained projections. The fence now checks current local content and sync state for every owned workspace projection before returning it.

Two regressions cover pending local creation and previously synced owned content. Both capture a readable post before deletion, delete it through the ordinary account writer, assert no read-cache watermark exists, and require the final fence to remove the captured projection.

- `regression-before.log`: both new regressions fail with the previous fence body (exit 1). The corrected source was restored in a `finally` block immediately after this run.
- `focused-tests.log`: accountPosts, feed, feedFacade, and accountSync suites pass 38/38, zero skips, with the correction.
- `lint.log`: ESLint for accountPosts.ts and accountPosts.test.ts exits 0; only the existing Remix ESLint package deprecation notice is emitted.
- `isolated-assets-preflight.log`: packaged application/preflight unit tests pass 3/3, zero skips. These cover stale shell, HTML substituted for JavaScript, database readiness, and missing isolated renderer bundle behavior.

Commands ran on 2026-10-23 in the shared worktree after canonical dependency repair, using direct Node/npm tooling. These are focused unit and facade results; they do not independently establish native browser acceptance or installed desktop behavior.

```sh
cd remix
node --import tsx --test app/local-workspace/accountPosts.test.ts app/local-workspace/feed.test.ts app/local-workspace/feedFacade.test.ts app/local-workspace/accountSync.test.ts
node node_modules/eslint/bin/eslint.js app/local-workspace/accountPosts.ts app/local-workspace/accountPosts.test.ts
cd ..
node --test electron/test/agent-browser-application.test.cjs
```
