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

Graphify output is stored as immutable content-addressed snapshots. Use
`.github/scripts/graphify`; it fingerprints the source tree without generated
output, serializes writers, validates each atomic graph set, converts mutable
semantic responses into immutable input-key/content-hash variants, and keeps
mutable root aliases out of Git. The same trusted router is copied into Lopu
workspaces, so post-merge Graphify publication never executes a PR-head script
with repository credentials.

The router keeps one active portable snapshot by default and prunes superseded
snapshots after successful updates. Run `.github/scripts/graphify prune` to
enforce retention without rebuilding, or set `GRAPHIFY_SNAPSHOT_RETENTION` to a
positive integer when this branch deliberately needs more than one snapshot.

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

When advanced CodeQL is first activated, an older open PR may predate the
normal listener now present on its target branch. Backfill that immutable live
snapshot without touching the PR branch by dispatching the protected analyzer:

```bash
gh workflow run codeql-analysis.yml --ref github-actions \
  -f pr_number=<PR_NUMBER> \
  -f expected_head_sha=<LIVE_HEAD_SHA> \
  -f backfill_listener_owned=true
```

The worker revalidates the open PR and exact head/base/merge snapshot, skips
already-complete CodeQL categories, and has no AI credential or repository
write permission. Analyzer concurrency is fenced by language, event owner, and
immutable snapshot; queued scans are preserved and never cancel an in-flight
CodeQL upload into a red PR check.

Lopu is also the one public repository-maintenance entrypoint. A `develop`
push starts the standing and per-feature promotion components as jobs inside
the same **Lopu PR manager** run; a `main` push starts the main→develop sync;
PR lifecycle changes and the hourly backstop maintain the wildcard `all`
branch. Qualifying pushes are converted to a bot-authored manager dispatch so
the model-backed doctor never receives unsupported push provenance. The four
deterministic implementations remain protected reusable components with no
push, schedule, repository-dispatch, or manual trigger of their own. Manual
recovery uses **Actions → Lopu PR manager → Run workflow** and its
`maintenance_operation` choice, including `build-all`. Their queues never
cancel an active promotion, synchronization, or union repair.

When `main` cannot be pushed cleanly into `develop`, Lopu publishes the fenced
candidate to the automation-owned `sync/main-into-develop` branch and opens or
refreshes a PR from that branch. It never uses protected `main` as the writable
PR head. The ordinary Lopu conflict lane can therefore merge `develop` into
the safe head, resolve it, rebuild Graphify, and publish without rewriting
either primary branch. That exact automation-owned branch uses an independent
serialized resolver lane, so an older ordinary-conflict backlog cannot delay
repository synchronization. As soon as GitHub reports that exact published
head as mergeable, the sync lane merges the PR explicitly; it does not rely on
native auto-merge, which GitHub refuses to arm when `develop` has no
protected-branch rule. The merger revalidates the PR repository, head/base
names, all three branch SHAs, and that the head contains live `main`, then
submits an exact-head merge and confirms the resulting `develop` still contains
that `main` commit.
It polls through GitHub PR-object hydration lag while checking the live sync
ref directly, and treats an ambiguous transient merge response as successful
only after the merged PR and resulting `develop` ancestry prove the commit
landed. Any moving ref, unresolved conflict, or stale candidate defers safely
to the next Lopu pass.

The public manager coalesces event storms by semantic PR or branch key: GitHub
keeps the active run plus the newest pending run, and
`cancel-in-progress: false` prevents that newest signal from interrupting work
already running. The survivor re-derives the complete live PR, comment, check,
and branch state. Before a conflict detector publishes another repository
batch, it also cancels only older batch runs that are still pending/queued and
waits for their GitHub capacity to release; an in-progress worker is always
preserved. Only the shared model fleet uses durable `queue: max`, so admitted
work remains serialized while event storms cannot fill the pending-job limit
with obsolete immutable snapshots.

The stack rebase/cascade implementation is internal in the same way. Existing
`rebase-pr-stack-ai` exact-worker events enter through **Lopu PR manager**, keep
their `rebase-stack` provider policy and immutable snapshot payload, and are
then handed to the reusable rebase engine. No product branch exposes a second
rebase workflow.

Conflict and stale-branch workers retain the complete commit graph needed to
merge the exact snapshotted base, but use Git partial-clone blob filtering so
Lopu does not download the repository's multi-gigabyte historical file corpus
for every PR. Required working-tree and merge blobs are fetched lazily.

Every non-deleted target-branch push is also an update signal for eligible
same-repository PRs whose base is that exact branch. Lopu snapshots the live
head and base refs and merges the target into the PR head under an exact-head
lease, even when GitHub has not yet recomputed its `BEHIND`/mergeability fields.
This is a merge, not a rebase: it preserves contributor history. Forks,
protected/default heads, and `no-ai-merge` or `ai-merge-paused` PRs remain
excluded; a worker that finds its exact base already present exits successfully
without creating a graph-only commit or pushing the branch.

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

Lopu also supports one ordered secondary Claude account:

```text
Primary Actions secret:   ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
Fallback Actions secret:  ANTHROPIC_API_KEY_FALLBACK or CLAUDE_CODE_OAUTH_TOKEN_FALLBACK
```

The protected Lopu action retries the same task with the fallback slot only
when the primary result reports a plan/weekly limit, API rate or credit limit,
or rejected credential. It does not treat `error_max_turns` as failover: that
continues the exact session with whichever slot started it. Both slots are
included in every generated-output credential scan.

Use `CLAUDE_CODE_OAUTH_TOKEN_FALLBACK` for another Claude subscription's
included Claude Code allowance (generate it with `claude setup-token` while
signed into that account). `ANTHROPIC_API_KEY_FALLBACK` instead uses the Claude
Platform organization's separate pay-as-you-go API credits; a Claude Pro/Max
subscription does not include Console API usage.

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

PR-event handoffs and deployment workers use separate, non-cancelling per-PR
queues. A repository dispatch therefore cannot cancel the metadata-only run
that created it, and a newer synchronize/edited event waits instead of
interrupting an active deployment. Every queued worker revalidates the live PR
head and lifecycle before changing Vercel state, so superseded requests exit
without publishing stale code.

The worker builds the exact authorized PR SHA on GitHub without repository or
environment secrets, packages `.vercel/output`, and passes that artifact to a
separate protected publisher. The publisher validates archive paths, links,
size, Vite shell, and Build Output routes before a pinned Vercel CLI uploads it
with `--prebuilt`; feature-branch build scripts never receive the Vercel token
or the develop S3 probe URL. Keep build-time public values derivable from the
GitHub event. Secrets used by server functions remain runtime values in the
selected Vercel Custom Environment and must not be copied into the build job.

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
THINGTIME_DEVELOP_S3_CORS_PROBE_URL="https://<bucket>.s3.<region>.amazonaws.com/<unsigned-probe-path>"
```

### Stable develop domain

For a hosted `develop` URL, create a Vercel Custom Environment with an exact
`develop` branch matcher, but leave its domain list empty. Bind the stable
domain itself to the `develop` Git branch. This gives Vercel a deterministic
fallback for the hostname, while the controller separately promotes only an
exact, verified native `develop` deployment.

If trusted PR automation creates prebuilt deployments in that same Custom
Environment, it must use `--skip-domain` and assign only a separate PR alias
after validating the exact repository, branch, commit metadata, and READY
state. Bind the development PR wildcard to the `develop` Git branch.
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
