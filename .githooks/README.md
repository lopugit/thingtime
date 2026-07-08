# Committed git hooks

Hooks in this directory are opt-in per checkout:

```sh
npm run install-git-hooks
# or: git config core.hooksPath .githooks
```

There are currently no active hooks. The former `post-commit` hook that
auto-committed `remix/.env.auto` was removed when that file became untracked:
local checkouts generate `.env.auto` via `remix/scripts/pre-dev.sh`, and
Vercel deployments read the branch from the `VERCEL_GIT_COMMIT_REF` system
env var instead.
