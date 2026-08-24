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

## Fork setup: Vercel develop previews

`.github/scripts/deploy-develop-pr-preview.mjs` runs from this branch and needs
Vercel project settings it cannot infer. Supply them from your own Vercel
account — every value below is a placeholder:

```sh
VERCEL_API_TOKEN="<vercel-rest-api-token>"
VERCEL_PROJECT_ID="prj_<project-id>"
VERCEL_PROJECT_NAME="<project-name>"
VERCEL_TEAM_ID="team_<team-id>"
VERCEL_TEAM_SLUG="<team-or-scope-slug>"
VERCEL_GITHUB_REPO_ID="<vercel-git-repository-id>"
VERCEL_CUSTOM_ENVIRONMENT_ID="env_<custom-environment-id>"
STABLE_DEVELOP_DOMAIN="dev.example.com"
PREVIEW_ALIAS_SUFFIX="preview.example.com"
PRODUCTION_PREVIEW_ALIAS_SUFFIX="production-preview.example.com"
DEVELOP_PREVIEW_TRUSTED_ACTORS="<comma-separated-github-logins>"
```

### Stable develop domain

For a hosted `develop` URL, create a Vercel Custom Environment with an exact
`develop` branch matcher, but leave its domain list empty. Bind the stable
domain itself to the `develop` Git branch. This gives Vercel a deterministic
fallback for the hostname, while the controller separately promotes only an
exact, verified native `develop` deployment.

If trusted PR automation creates deployments in that same Custom Environment,
its deployment payload must set `autoAssignCustomDomains: false` and assign
only a separate PR alias after validating the exact repository, branch, commit,
and READY state. Bind the development PR wildcard to the `develop` Git branch.
Vercel does not permit binding a project domain to the production branch as a
Preview domain, so the production preview wildcard must remain detached (the
documented Vercel production fallback) and may not attach to a Custom
Environment. Exact controller-owned aliases override the wildcard fallback.
The controller checks both Vercel bindings, DNS, and a live `/api/root-data`
fallback probe before it can publish, so a detached production wildcard is only
accepted when it actually resolves to `main`.

Stacked PRs are supported only when each parent is an open same-repository PR
from an allowlisted author and the bounded chain terminates at `develop`.
The chain is resolved from the protected controller; a missing, ambiguous,
untrusted, cyclic, draft, or overlong parent chain receives no credentialed
preview. Use domains and environment ids from your own Vercel project; never
copy another project's account-specific identifiers or verification records.
