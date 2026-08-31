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

The former hook that auto-committed `remix/.env.auto` remains removed: local
checkouts generate `.env.auto` via `remix/scripts/pre-dev.sh`, and Vercel reads
the branch from `VERCEL_GIT_COMMIT_REF`.
