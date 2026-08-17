# `github-actions` — the CI control plane

This branch is **not** the application. It carries the repository's executable
CI and nothing else:

```
.github/workflows/   the real workflow implementations
.github/scripts/     the automation they run (promoter, contracts, changelog)
.github/actions/     composite actions they call
vercel.json          the Vercel Git-deployment kill-switch
```

Plus the repository's canonical AI instruction files (`AI_ALL.md`, with
`AGENTS.md` and `CLAUDE.md` as symlinks to it), because agents work on this
branch too.

The root `vercel.json` is the one deliberate non-CI runtime file. Vercel now
uses the repository root for product deployments, so this branch must keep a
config at that same location. It sets `git.deploymentEnabled` to `false` for
every branch inheriting this thin tree and keeps `ignoreCommand: "exit 0"` as a
second fail-safe. It has no install, build, or output command because there is
no product here to deploy.

## Why it is bare

`main` and `develop` carry only **thin listeners** — one `uses:` of a workflow
on this branch, pinned by ref, with no `runs-on:`, `steps:` or `run:` of their
own (enforced by `remix/scripts/workflow-caller-contract.mjs`, which runs in the
product branches' CI). Every trigger they receive is executed by the
implementation here.

Two consequences follow, and they are the reason this branch holds no app code:

- **A change here is live everywhere the moment it lands.** Nothing promotes it,
  nothing merges this branch into a product branch. The listeners resolve
  `@github-actions` at run time.
- **The app code under test always comes from the PR, never from here.** The
  implementation's checkout steps take the caller's `github.sha`, so a Web CI run
  for a PR targeting `develop` tests that PR's tree. A copy of `remix/` on this
  branch would be read by nothing — it was 38 commits stale when it was removed.

So this branch and the product branches are permanently diverged **by design**.
They share history but are never merged again in either direction.

## Working on it

Branch from `github-actions` in this repository and open a PR back into it:

```bash
git checkout -b codex/my-ci-change origin/github-actions
```

Do **not** use a fork. Fork PRs receive no secrets, and the conflict resolver
refuses them outright because it cannot push to a fork's branches.

`.github/workflows/control-plane-ci.yml` runs on every push and PR here: it
syntax-checks every script, runs each `--self-test`, and asserts this branch's
shape (see below). Web CI does not run — its path filters are `remix/**`, which
cannot exist here.

## The bare-tree invariant

`.github/scripts/workflow-control-plane-contract.mjs` asserts that no path
outside the allow-list above reappears at the branch root. Without it the tree
regrows silently: someone merges a product branch in "just to fix a path", and
the drift this branch was stripped to eliminate comes straight back.

If you genuinely need a new root path here, add it to `CONTROL_PLANE_ROOTS` in
that script in the same commit that introduces it, so the addition is reviewed
rather than discovered later. The contract also validates the exact no-deploy
posture of `vercel.json`; merely keeping a file with that name is insufficient.

## Known trade-off

A CI change that depends on the product tree's layout (a script path under
`remix/`, a config file location) cannot be validated here — there is nothing to
validate it against, and it will only be exercised when it runs against a
product branch. The cross-branch contracts cover the invariants that matter
most: the caller contract runs on the product branches and asserts their shape,
and the routing contracts here assert this branch's.

CI changes are recorded in [`CHANGELOG.md`](CHANGELOG.md) on this branch, not in
the app changelog — nothing carries an entry from here to a product branch.
