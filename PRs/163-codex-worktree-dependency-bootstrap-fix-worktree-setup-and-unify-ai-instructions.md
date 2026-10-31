# PR #163 — Fix worktree setup and unify AI instructions

## Scope

This PR fixes fresh-worktree dependency bootstrapping and makes repository AI
instructions single-source-of-truth.

## Worktree dependency bootstrap

- Stops copying `node_modules` trees through `.worktreeinclude`; pnpm symlink
  graphs are checkout-specific and can become incomplete after copying.
- Adds `npm run worktree-setup` and a shared dependency check used by Remix
  development, build, and lint entry points.
- Repairs missing links through pnpm's shared store and retries one forced
  relink when pnpm reports success but the links remain stale.

## Canonical AI instructions

- Merges every unique root rule from `AGENTS.md`, `CLAUDE.md`, and `CODEX.md`
  into `AI_ALL.md`.
- Stores root `AGENTS.md` and `CLAUDE.md` as relative symlinks to `AI_ALL.md`.
- Removes the redundant root `CODEX.md`.
- Updates active runbooks, prompts, handoffs, README guidance, tests, and the
  changelog to point at the canonical file.

## Validation

- Verify the dependency bootstrap checklist in `TESTING.md`.
- Verify both instruction links resolve to `AI_ALL.md`, compare byte-for-byte,
  and retain Git mode `120000` in a fresh checkout.
- Run Git whitespace/integrity checks and refresh the repository Graphify
  artifacts after the documentation changes.
