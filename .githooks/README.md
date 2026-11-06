# Committed git hooks

Hooks in this directory are opt-in per checkout:

```sh
npm run install-git-hooks
# or: git config core.hooksPath .githooks
```

The active `post-checkout` and `post-commit` hooks ask `scripts/graphify` to
select or build the current content-addressed Graphify snapshot in the
background and prune superseded portable snapshots after successful activation.
They never commit or push. Logs go to the repository Git directory as
`graphify-cas.log`.

`post-checkout` also bootstraps a freshly created *linked* worktree once: when
`remix/node_modules/.pnpm` is missing it runs
`node remix/scripts/worktree-bootstrap.cjs --quiet` in the background (relink
dependencies from the pnpm store, copy missing ignored env files from the main
checkout, write the derived-port `.claude/launch.json`, and point this
worktree's `core.hooksPath` at `.githooks`). Run `npm run worktree-bootstrap`
to repeat it on demand; its log is `worktree-bootstrap.log` in the Git
directory.

Use the relative `core.hooksPath .githooks` (what `npm run install-git-hooks`
sets) rather than an absolute path: an absolute path copied into a worktree
makes every checkout run *that* checkout's hook files, including stale ones.

The former hook that auto-committed `remix/.env.auto` remains removed: local
checkouts generate `.env.auto` via `remix/scripts/pre-dev.sh`, and Vercel reads
the branch from `VERCEL_GIT_COMMIT_REF`.
