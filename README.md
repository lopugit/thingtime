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

## Lopu principal repository manager

Lopu is the repository-facing identity for every model-backed automation in
this control plane. PR review and failing-check repair, CodeQL triage, merge
conflict resolution, promotion replay, stale-branch updates, rebases and stack
cascades, release analysis, and the wildcard `all`-branch build doctor all call
the same protected `.github/actions/lopu-agent` interface. Post-merge Graphify
refreshes follow the same configured provider when a matching semantic
credential is available.

The default backend is Claude. To use Codex through the OpenAI Platform API,
configure these repository settings (all names and values are examples; never
commit a real key):

```text
Repository variable: LOPU_AGENT_BACKEND=codex
Repository variable: LOPU_CODEX_MODEL=gpt-5.6-terra
Repository variable: LOPU_CODEX_REASONING_EFFORT=xhigh
Actions secret:      OPENAI_API_KEY=<OpenAI-Platform-project-key>
```

`LOPU_CODEX_MODEL` accepts `gpt-5.6-terra` or `gpt-5.6-sol`, and reasoning
effort accepts `medium`, `high`, `xhigh`, or `max`. Runs are visibly attributed
as Lopu and report a label such as `OpenAI API GPT-5.6 Terra Extra High`.
`LOPU_REVIEW_BACKEND` remains a compatibility fallback, but
`LOPU_AGENT_BACKEND` is the canonical single selector for the whole agent.

For Claude instead, set `LOPU_AGENT_BACKEND=claude` (or omit it) and configure
`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. GitHub-hosted automation does
not accept an OpenAI account username/password or browser session. A Codex run
uses the OpenAI Platform project associated with `OPENAI_API_KEY`; it does not
consume a ChatGPT Pro weekly allowance.

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

## Signed desktop PR releases

`.github/workflows/electron-pr-release.yml` is the reusable, privileged builder
for approved Desktop prereleases. Product branches carry only its trigger
listener; the listener calls `@github-actions`, and this workflow then resolves
the live PR record, revalidates its immutable head SHA, checks out that SHA with
no persisted GitHub credential, and runs unsigned checks before it imports any
signing material.

Automatic publication is deliberately narrow: the PR must be from this
repository, authored by the repository owner, and currently carry the
`desktop-release` label. An owner may also run the thin listener manually with
a numeric PR number. Forks and ordinary contributors never reach a macOS
runner with signing secrets.

Direct manual dispatch of the worker itself is accepted only while it executes
on the protected `github-actions` ref. Reusable calls are accepted only from a
`develop` or `main` listener, so a feature branch cannot turn a modified copy
of this workflow into a signing authority.

The canonical repository must configure these GitHub Actions secrets (use your
own values; never commit them):

```text
MAC_CSC_LINK=<base64-developer-id-p12>
MAC_CSC_KEY_PASSWORD=<p12-password>
APPLE_API_KEY_BASE64=<base64-app-store-connect-p8>
APPLE_API_KEY_ID=<app-store-connect-key-id>
APPLE_API_ISSUER=<app-store-connect-issuer-id>
APPLE_TEAM_ID=<apple-developer-team-id>
```

The worker publishes a SemVer PR prerelease tagged with the PR number, branch,
and source SHA. Its macOS ZIP and separately notarized Thingtime Recovery ZIP
are verified by the Desktop/Recovery updater before either can be cached or
installed.

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
