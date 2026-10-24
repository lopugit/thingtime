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

CI concurrency is scoped to the PR number or pushed/dispatched ref. A newer
run may supersede the same subject, but unrelated PRs never share a cancellation
slot. Event-admission and preview-comment regression tests run in the required
`verify` job, independently of the broader advisory contracts.

Automated comments must begin with their canonical `<!-- thingtime-... -->`
marker. The owner PAT is deliberately retained where GitHub's integration token
lacks permission; its `User` identity is not treated as proof of human authorship.
Bot and marker-prefixed comments stop before a runner starts. Other user comments
pass a read-only protected classifier that recognizes legacy standalone markers,
preserves quoted replies and fenced code examples, and suppresses unchanged edits.
Queued comment review workers fetch and reclassify the exact live comment before
creating PR worktrees or invoking a model. Missing comments stop cleanly; failed
metadata reads fail closed. Both preview publishers edit their owned comment only
when its content changes and never adopt a human's quoted status as their own.

Preview eligibility also requires a real `remix/package.json` file at the exact
authorized head SHA. A controller-only head follows the existing skip/cleanup
path instead of entering dependency installation. Only a contents 404 means the
file is missing; authentication, rate-limit, and server errors remain errors.
See [.github/TESTING.md](.github/TESTING.md) for regression and rollout checks.

### Discoverable preview status and recovery

Both publishers post expected persistent URLs and a ready-time estimate before
releasing the secretless build, then update the same marked comment with the
immutable snapshot URL. GitHub leaves edited comments in their original place
in the timeline; check the PR sidebar when an older comment is hard to find.

Successful publication adds `last preview built DD/MM HH:MM AEST #<PR>` (AEDT
during daylight saving). The timestamp is Vercel's actual READY time in
`Australia/Melbourne`, not the time a workflow reused or repaired that preview.
Admin-selected environments have separate `last preview dev` and `last preview
prod` labels. The PR suffix makes each history label safe to rename without
changing another PR's date. A separate `preview: <lane> queued/building/ready/
failed/removed` label describes current state; failure and cleanup preserve the
last successful timestamp. Only controller-owned labels are changed.

The existing six-hour default-branch preview schedule now inspects open PRs as
well as previously created deployments. It restores comments, labels and aliases
for verified current-SHA READY deployments without rebuilding them. Missing
previews enter the normal secretless build through a bot-authenticated dispatch,
after the same author, repository, exact-head and application-bundle checks.
Active native worker/handoff queues and active Vercel builds are left alone.
Each exact-SHA GitHub deployment keeps a durable recovery receipt: at least
30 minutes between requests and at most three automatic attempts. A failed PR
does not stop the rest of the inventory. After the limit, inspect the workflow
and manually rerun it after correcting the error; a new head has a fresh budget.

Fork setup: retain caller `contents: write`, `issues: write` and
`pull-requests: write`, and the protected `vercel-develop-pr-control` environment.
The recovery dispatch specifically uses the workflow's `github.token`; optional
`CONFLICT_RESOLVER_PAT` is only the existing fallback for comments/receipts. No new
secret is needed, and no deployment credential reaches a product build. The
sweep repairs the ordinary develop lane only: it never infers or enables admin
environment selections from an old deployment/comment. Those remain authorized
by the existing backend GitHub App dispatch.

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

Queue recovery (2026-09-05): review handoffs inspect GitHub's native `lopu-review-<scope>` concurrency
group instead of only the most recent 100 workflow dispatches. They verify the
trusted run's actual review job is unstarted before reusing that waiter; an
active review still permits one follow-up for newer changes. Human comment
events retain their own comment-id-bearing handoffs. Controller status comments
carry the hidden `thingtime-` marker and do not trigger another model review,
even when a PAT makes their author look like a human. Control-plane CI uses
separate concurrency groups per PR/ref so unrelated PRs cannot cancel each
other's validation.

Queue regression checks: `node --test .github/scripts/lopu-review-queue.test.mjs`.
After deployment, inspect the native concurrency groups and job states: a
pending Lopu fleet member is waiting for serialized mutation access, not
necessarily consuming a runner or blocking the separate preview pipeline.
Confirm that an old unstarted review coalesces a new automated signal, a running
review allows a follow-up, and ordinary human comments still reach Lopu.
The helper needs only Actions read access (the handoff already needs Actions
write for dispatch) and fails closed on unavailable or incomplete queue data.

Batch reviews also support cooperative handover. After a five-minute useful-work
quantum, other jobs waiting in the native fleet queue request wrap-up. Claude
receives that request between tool calls through trusted hooks; Codex receives
the same checkpoint protocol and checks before each PR. The request is latched
and polling is limited to once per minute. The reviewer finishes and validates
its current PR, writes its completed report, then ends normally. The existing
exact-head publisher pushes only completed reviews, and a metadata-only artifact
records the remaining PR numbers before one continuation is queued behind other
work. Continuations re-read live eligibility and heads, and have a distinct run
title so a partial continuation cannot suppress a new full-scope signal.

This is cooperative, not a hard deadline: it never kills a process or cancels a
run. Unfinished changes, an active Git operation, and zero-progress loops block
handover. Atomic conflict repairs, feature-stack merges, and deployments retain
their existing non-interruptible boundary. Already-running old controller jobs
cannot acquire the hooks retroactively. If continuation dispatch fails, the run
fails visibly and its seven-day `lopu-review-handoff` artifact preserves the
remaining inventory for a controlled retry; no raw source patches or secrets
are put in that artifact. No new secret or backend setting is required.

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

Store each secret directly in the deployment environment. Also add the same
`THINGTIME_CI_ROUTER_SECRET` as a GitHub Actions repository secret and set the
repository variable `THINGTIME_CI_ROUTER_URL` to the stable route above. The
router secret is deliberately independent of both webhook secrets. Vercel's
system-provided OIDC identity authenticates Sandbox creation in deployed
functions; local/non-Vercel execution may instead provide `VERCEL_TOKEN`,
`VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID`. Set
`WORKFLOW_SEQUENTIAL_REPLAYS=1` in Vercel for deterministic durable-workflow
replay. The Admin API reports only whether an integration is configured; it
never returns credentials. Admin reports **Vercel runner ready** only when the
GitHub App credentials, provider-router secret, and Vercel runtime identity are
all available; its API refuses to select Vercel before that complete capability
is ready. An already-saved Vercel policy still fails over safely to GitHub if a
dependency later disappears.

After deployment and App installation, create both provider webhooks and click
**Admin → CI Control → Reconcile** once. Reconcile imports existing branches,
open PRs, Actions runs, deployments, and previews; subsequent webhooks keep the
projection current. Until that first successful reconcile, an empty dashboard
with zero counts is expected.

# 💹 Donate on Indiegogo to save humanity 🩷

### You can get Merch 🌈 + other benefits 🦄💯

https://www.indiegogo.com/projects/thingtime-a-gui-for-the-internet/coming_soon

## Or Donate on GoFundMe 💖

https://www.gofundme.com/f/thingtime

### Force Push ? 👉👈

Thingtime has two deliberately separate conflict workflows:

- **Lopu PR resolver** merges a PR's base branch into its head branch.
- **Rebase PRs and stacks (AI)** rebases the PR head and, when the PR is part
  of a stack, continues from the stack root toward its leaves.

Both workflows cover every same-repository PR regardless of its base branch.
The merge workflow listens to pushes on `"**"` and checks open PRs both
targeting and originating from the pushed branch. A staggered twice-hourly
all-PR sweep catches conflicts whose original event was missed or ran from an
older branch without the latest workflow. Their ownership is intentionally
disjoint: standalone merge conflicts go to the merge workflow; standalone PRs
that merge cleanly but cannot rebase, plus stack members whose current history
needs a merge or rebase update, go to the rebase workflow. Adding
`no-ai-rebase` opts a merge-conflicting stack member back into the merge-based
resolver instead.

The rebase workflow covers the case GitHub reports as `mergeable: true` but
`rebaseable: false`: a plain merge needs no help, yet replaying the branch's
commits onto its base stops at a conflict. It automatically scans same-repo
PRs after branch pushes and PR `opened`/`reopened` events, with a scheduled
all-PR scan as a backstop because GitHub emits no dedicated event when its
**Rebase stack** button fails. A standalone PR is replayed onto its base; a
detected stack is rebased root-to-leaf, so each child is replayed onto the
rewritten parent rather than onto the parent's old SHA.

To run it directly, open **Actions → Rebase PRs and stacks (AI) → Run
workflow** on the default branch, enter the PR number, and leave cascading
enabled when the PR has children. Leaving the number blank scans all open
same-repository PRs. Manual dispatch is also the recovery path after reviewing
a paused run.

**Lopu PR resolver** is the canonical all-in-one resolver. Enter a PR number
to inspect one PR, enter a branch to inspect PRs based on or from that branch,
or leave both blank to scan all open same-repository PRs. PR events inspect
only the affected PR; the twice-hourly sweep is a quiet backstop. The detector
does not run from arbitrary pushed branch workflow content. Detection never
checks out PR code and runs with read-only repository access plus the narrow
permission required to dispatch the default-branch worker. Each eligible
conflict is handed to one
bot-authenticated `workflow_dispatch` job on the default branch, which repeats
all live PR, label, ownership, protection, and SHA checks before it writes.

Lopu is the durable Thingtime identity; the workflow separately records the
actual backend in its run and PR attestation. The initial backend is the
repository's configured **Claude Code** OAuth integration, so it can be
replaced later without turning PR history into a mix of assistant names.
Lopu reads the repository direction and affected code, but has only
read/search/edit/write tools: no shell, Git, or network. The workflow derives
its allowed edit set from `git diff --diff-filter=U`, rejects every unstaged or
out-of-scope change, treats `graphify-out/` as base-derived data rather than a
Lopu merge target, and rejects remaining conflict markers. Immediately before
publication it re-reads both refs and pushes only with an exact head lease. If
either branch moves while Lopu is working, the merge is discarded and the next
detector pass uses a fresh snapshot. The PR receives an attestation with the
base/head snapshots, verified merge SHA, backend, and resolver-run link.

Add `no-ai-merge` for a permanent opt-out or `ai-merge-paused` for a temporary
human hold. Fork PRs, drafts, protected heads, the default branch as a head,
and PRs currently owned by the rebase agent are intentionally skipped.

Detection is patient and audible: GitHub computes a PR's mergeability lazily
after its base moves and verdicts can take minutes to settle, so the merge
detector re-queries until every scanned PR has a verdict (time-budgeted via
`MERGEABLE_POLL_SECONDS`, default 500 seconds — a little over eight minutes)
instead of sampling once at push time. When it must leave a conflicted-looking PR alone — a fork PR it
cannot push to, or a verdict that never settled — it upserts one status
comment on the PR saying exactly that, so a silent PR means "nothing needed
doing", never "nobody looked". Conflicts that are handed off announce
themselves through the resolve job's "Auto-resolve running" comment.

**Rebase PRs and stacks (AI)** rewrites PR history, so its force push has
stricter boundaries:

- It operates only on branches in this repository. Fork PRs, the repository's
  default branch, and protected branches are refused.
- Claude receives only regular copies of the exact files stopped in conflict,
  inside a repo-less scratch directory. It never sees the real checkout, Git
  metadata, action implementation, or push credentials, and it has only
  read/edit/write file tools—no shell, Git, search, or network tools. Code
  loaded from the exact trusted default-branch commit
  independently validates the scratch files, conflict set, index, and completed
  rebase before any push.
- Nothing is pushed until the complete rebase succeeds. The final update uses
  an exact `--force-with-lease` against the head SHA inspected at the start, so
  a concurrent human or bot push makes the run fail instead of being erased.
- Add `no-ai-rebase` to opt a PR out of automatic rebasing. A failed automatic
  run adds `ai-rebase-paused` for that exact owner/ref/SHA/topology snapshot,
  preventing a retry loop while the failure is reviewed. A changed snapshot or
  resolver owner invalidates the hold automatically; retry the unchanged
  snapshot with a deliberate manual PR-number run.
  `ai-rebase-in-progress` is the only cross-workflow mutex. Pause labels do not
  decide ownership: a queued retry re-proves the exact refs and owner before
  clearing its specific stale pause. Publication requires pauses to be absent,
  and post-push cleanup preserves any fresh hold created for the new snapshot.
  An orphaned `ai-rebase-in-progress` lock is recovered after 90 minutes, while
  paused, active, or not-yet-computed parents—and protected or opted-out
  parents that still need a rewrite—keep stacked children from running ahead.
- A rewrite authenticated by `GITHUB_TOKEN` explicitly dispatches **Web CI**
  against the new branch SHA when the final PR diff touches `remix/` or its CI
  workflow, because token-authored pushes do not create ordinary Actions runs.

For a fork of Thingtime, enable **Settings → Actions → General → Workflow
permissions → Read and write permissions**, then add one of these repository
Actions secrets:

- `ANTHROPIC_API_KEY`, or
- `CLAUDE_CODE_OAUTH_TOKEN` (created by the Claude CLI GitHub App setup).

`CONFLICT_RESOLVER_PAT` is optional. Add it only if the resolver must rewrite a
branch whose rebase changes files under `.github/workflows/`; the token needs
repository contents access plus permission to update workflows. Keep all
tokens in Actions secrets, scope them to the fork, and never put them in an
environment file or commit. Automatic runs still skip PRs originating from
another repository; the contributor's fork must run its own trusted workflow
if it wants equivalent automation.

# Setup for Forks

Thingtime can run with mostly public configuration, but a few integrations need
private environment variables in local development or on Vercel.

## Nitro + React Router app

The web app lives in `remix/` for historical path compatibility, but it now
runs as a React Router non-framework Vite client with Nitro API/server routes.
Vite serves the browser app on port `9999` and proxies `/api` to the Nitro dev
server on port `10000` when local backend env is configured. If the local
MongoDB/auth env is absent, the dev proxy sends `/api` requests to
`https://thingtime.com` instead so a fresh clone can still log in, create
service-account tokens, and use the production-backed API without copying any
private `.env` files.

Local development URLs on Lopu's Mac:

- Local: `http://localhost:9999`
- Tailnet/Funnel: `https://lopus-macbook-pro-2.tail9606f9.ts.net:9999`

The Tailnet/Funnel mapping for Thingtime should proxy
`lopus-macbook-pro-2.tail9606f9.ts.net:9999` to `127.0.0.1:9999`. Vite's
`server.allowedHosts` includes `lopus-macbook-pro-2.tail9606f9.ts.net` so this
host does not trip Vite's blocked-host protection.

Install and run from the app directory:

```sh
cd remix
corepack pnpm install
corepack pnpm run dev
```

For a fresh clone or linked worktree, the equivalent repository-root bootstrap
is:

```sh
npm run worktree-setup
```

The Remix `dev`, `build`, and lint entry points run the same dependency check
automatically. It validates every direct dependency link and uses pnpm's shared
store to repair missing or stale links, so `node_modules` never needs to be
copied from another checkout.

From the repository root, `npm run web-pms` starts or restarts the PM2-managed
dev app `tt-nitro-react-router-9999`. The older `npm run remix-pms` command is
kept as a compatibility alias.

Local branch metadata is managed automatically by `remix/scripts/pre-dev.sh`.
That script writes the untracked, generated `remix/.env.auto`; do not edit that
generated block by hand. On Vercel no file is involved: the branch comes from
the `VERCEL_GIT_COMMIT_REF` system env var at build and runtime.
The local dev launcher loads `remix/.env`, `remix/.env.local`, and
`remix/.env.auto` before spawning Nitro and Vite, so ignored private values like
MongoDB credentials are available to local API status checks without committing
secrets. These files are optional for normal app usage; set them only when you
want to override the default production-backed API fallback or run the backend
self-sufficiently against your own services.

Build and verify the repository-root Vercel output with:

```sh
npm run build:vercel
```

The root `vercel.json` deliberately installs only `remix/`; it never runs the
legacy repository-level `postinstall`. The build runs the existing Remix Vite +
Nitro pipeline, validates `remix/.vercel/output`, then stages and revalidates it
at the repository-root `.vercel/output` expected by Vercel's Build Output API.

In the Vercel project, set **Root Directory** to the repository root (clear the
old `remix` value), use the **Other** framework preset, and clear dashboard
overrides for Build Command, Install Command, Output Directory, and Ignored
Build Step so the tracked root config is authoritative. The root config also
sets `outputDirectory: null`: the build emits `.vercel/output` itself. The
product config disables Git deployments for the exact `github-actions` branch;
the thin control-plane branch carries its own root config with all Git
deployments disabled, so branches created from it never try to build an absent
app.

## Electron desktop app

The desktop shell lives in `electron/` and packages the same `remix/` web app
with Electron. It builds the Vite client and Nitro server with
`NITRO_PRESET=node_server`, stages the output in `electron/dist/web`, then
launches the bundled Nitro server on `127.0.0.1` inside the Electron app.

Build the unpacked desktop app from the repository root with:

```sh
pnpm --dir electron install
npm run build-electron
```

For local desktop smoke testing:

```sh
pnpm --dir electron dev
```

The local Electron shell reads `remix/.env`, `remix/.env.local`, and
`remix/.env.auto` before starting Nitro. Keep real MongoDB, auth, Vercel, and AI
tokens in ignored env files or the launch environment only; commit placeholder
examples in docs, not secrets.

## API self-documentation

Every registered Thingtime API endpoint exposes a JSON documentation endpoint
by appending `-docs` to the API path. The docs endpoint accepts both GET and
POST so sandboxed tools can discover the contract without caring which method
the real endpoint uses:

```sh
curl http://localhost:9999/api/v1/auth/service-account-docs
curl -X POST http://localhost:9999/api/v1/auth/service-account-docs -d '{}'
```

Each response includes the original endpoint, accepted methods, auth notes,
step-by-step usage, payload and response examples, and generated curl, wget,
Node.js, Python, and Ruby snippets. The browser reference lives at
`/docs/api`, and the docs smoke tests live in the `/tests` page under the
`Docs` group.

## Extensible data — `extended` + schema-less crystals

Schemas are optional scaffolding, not a cage. Two open surfaces on every thing:

- **`extended`** — every `things` doc carries a schema-free `extended`
  property that accepts **any JSON structure** (512KB/doc cap). Thingtime wraps
  it in the platform envelope (share ids, `tt:` ACLs, timestamps) but never
  validates, structure-indexes, or interprets it. Replace-on-write semantics:
  send `extended` to swap the whole value, `null` to clear it, omit it to leave
  it untouched (deep-merging arbitrary JSON is ambiguous, so we never do).
  It is not structured-searchable — `/search` field conditions can't target it
  — though its string content is indexed by the collection's wildcard text
  index like any field (so keep secrets out of it). One reserved key:
  `tt:textLanguage` (the text index's language override).
- **Schema-less crystals** — `thingtime` is optional on create: a bare
  `POST /api/v1/things { crystal: { any: 'shape' } }` defaults to
  `thingtime: ["data"]`, the bounded free-form crystal, so external apps can
  store structured data without declaring a schema first — and it stays
  searchable by real datatypes on `/search`.

Together they make Thingtime an open datastore: schema'd crystals get
validation and typed search, `extended` carries whatever else your app needs
on the same document. Docs: `/docs/api` → things.

## MongoDB

MongoDB powers the app status checks and database-backed API routes. Local
development does not require MongoDB env by default: when
`MONGODB_CONNECTION_STRING` is missing, Vite and Nitro forward same-origin API
requests to `https://thingtime.com` with the same method, path, query, headers,
cookies, and payload. Upstream auth cookies are rewritten for local HTTP so
zero-env localhost login can persist through the proxy.

Set these variables only when you want this checkout or deployment to serve API
requests from its own MongoDB instead of falling back to Thingtime production:

```sh
MONGODB_CONNECTION_STRING="mongodb+srv://<user>:<db_password>@<cluster>/<database>?retryWrites=true&w=majority"
MONGO_PASS="<password>"
```

`MONGO_PASS` is only required when `MONGODB_CONNECTION_STRING` contains the
literal `<db_password>` placeholder. The app substitutes `MONGO_PASS` into that
placeholder using URL encoding so special characters in the password are safe.

For a local MongoDB instance you can instead use a complete URI with no password
placeholder:

```sh
MONGODB_CONNECTION_STRING="mongodb://localhost:27017/thingtime"
```

## Email Delivery

Thingtime stores outbound email attempts in MongoDB and sends through a
pluggable provider. Local development defaults to `console`, which logs the
message and records it in `email_messages` without delivering mail. Production
should use Amazon SES through the SES API.

Set these variables in `remix/.env` for local SES testing and in Vercel project
environment variables for deployed previews/production:

```sh
THINGTIME_EMAIL_PROVIDER="ses"
AWS_SES_REGION="ap-southeast-2"
AWS_SES_ACCESS_KEY_ID="<iam-access-key-id>"
AWS_SES_SECRET_ACCESS_KEY="<iam-secret-access-key>"
THINGTIME_EMAIL_TRANSACTIONAL_FROM="Thingtime <no-reply@thingtime.com>"
THINGTIME_EMAIL_NEWSLETTER_FROM="Thingtime Updates <community@thingtime.com>"
THINGTIME_EMAIL_REPLY_TO="support@thingtime.com"
AWS_SES_CONFIGURATION_SET="thingtime"
THINGTIME_EMAIL_FAIL_CLOSED="false"
SES_SANDBOX="1"
THINGTIME_EMAIL_TEST_RECIPIENT="support@thingtime.com"
```

`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` also work; the
`AWS_SES_*` names are preferred when the deployment has other AWS integrations.
Do not create SES SMTP credentials for the app path. The server uses the SES API
and needs an IAM access key with permission to call `ses:SendEmail` for the
verified identities it sends from.

`SES_SANDBOX=1` tells the `/tests` page to wait at least one second before each
email-sending check so local sandbox tests respect the SES one-message-per-second
limit. `THINGTIME_EMAIL_TEST_RECIPIENT` is the base inbox used by the email tests;
the test harness generates plus aliases such as
`support+signup-<timestamp>@thingtime.com`.

Recommended DNS and SES setup:

- Keep Google Workspace as the MX provider for human inboxes such as
  `hello@thingtime.com` and `support@thingtime.com`.
- Verify separate SES domain identities for transactional and newsletter mail,
  for example `auth.thingtime.com` and `news.thingtime.com`.
- Publish the SES DKIM records, a custom MAIL FROM/SPF record if configured,
  and a DMARC policy for the sending domains.
- Put signup verification, email OTP, password reset, and product
  notifications on the transactional domain.
- Put bulk/newsletter mail on the newsletter domain to isolate sender
  reputation.

MongoDB collections created by the app:

- `email_messages` records every send attempt and its final status.
- `email_events` stores provider delivery/bounce/complaint events when event
  ingestion is wired.
- `email_templates` is reserved for editable template metadata.
- `email_subscriptions`, `email_suppression_list`, and `email_unsubscribes`
  drive newsletter consent and suppression.
- `email_identities` is reserved for verified sender/domain metadata.

Current auth signup and service-account verification emails use this pipeline
through `sendVerificationEmail`. Use `sendEmailOtp` for future email code
flows, and `sendNewsletterEmail` for newsletter sends.

The long-term provider-independent roadmap lives in
[`docs/email-owned-architecture.md`](docs/email-owned-architecture.md). Keep
future SES, queue, inbound, self-hosted SMTP, and sender-reputation work aligned
with that architecture so Thingtime can move delivery providers without changing
feature callers.

## Auth and Lopu AI

JWT-backed browser sessions prefer ES256 asymmetric signing so other platforms
can verify Thingtime-issued user tokens without knowing the private signing key.
Configured asymmetric deployments publish the verification key at:

```sh
/api/v1/auth/jwks
```

Use a P-256 private key in PKCS#8 PEM format and a public key in SPKI PEM
format. The env vars accept either full PEM text with escaped `\n` newlines or
base64-encoded PEM, which is easier to paste into Vercel:

```sh
JWT_PRIVATE_KEY="<base64-pkcs8-private-pem>"
JWT_PUBLIC_KEY="<base64-spki-public-pem>"
JWT_KEY_ID="thingtime-es256-1"
JWT_ISSUER="https://thingtime.com"
```

Generate a fresh key pair with:

```sh
node <<'NODE'
const { generateKeyPairSync } = require('node:crypto');

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const encode = (key) => Buffer.from(key).toString('base64');

console.log('JWT_PRIVATE_KEY=' + encode(privateKey.export({ type: 'pkcs8', format: 'pem' })));
console.log('JWT_PUBLIC_KEY=' + encode(publicKey.export({ type: 'spki', format: 'pem' })));
console.log('JWT_KEY_ID=thingtime-es256-1');
console.log('JWT_ISSUER=https://thingtime.com');
NODE
```

The app also exposes a local helper UI at `/crypto`, backed by
`/api/v1/crypto`, for generating ES256 pairs, switching key encodings, checking
private/public key matches, verifying JWTs, and verifying signed messages
before pasting env vars into Vercel.

`JWT_PUBLIC_KEY` is recommended for clarity, but the server can derive it from
`JWT_PRIVATE_KEY` if only the private key is configured. Keep `JWT_SECRET`
temporarily as a legacy HS256 verifier while older browser cookies expire:

```sh
JWT_SECRET="<legacy-long-random-secret>"
```

If neither asymmetric key material nor `JWT_SECRET` is set, preview and
production auth fail closed. Local development can still run without keys using
an insecure dev-only fallback.

The JWKS endpoint supports offline signature, issuer, and expiry verification.
It does not tell external platforms whether the backing Mongo session has been
revoked; add a server-side introspection endpoint before relying on live
revocation checks outside Thingtime.

### Password reset + email 2FA

`POST /api/v1/auth/password-reset` ({ email }) always answers `{ ok: true }` so
account existence can't be probed; when the email matches an account it sends a
single-use one-hour reset link to `/reset-password?token=…`. The confirm step
(`POST /api/v1/auth/password-reset/confirm`) burns the token atomically, sets
the new bcrypt hash, and revokes every live session. Requests are rate-limited
per IP (`auth.passwordReset`). Local dev + Vercel previews surface `resetLink`
in the JSON, mirroring the register route's dev verification link.

Email 2FA is opt-in per account (`GET/POST /api/v1/auth/two-factor`, requires a
verified email — toggle lives in Settings → Security). With it on,
`POST /api/v1/login` stops minting sessions from a password alone: it returns
`{ requiresOtp: true, challenge, expiresAt }` and emails a 6-digit code (only a
sha256 hash is stored, 10-minute TTL, atomically attempt-capped at 5); a second
`POST /api/v1/login { challenge, code }` completes login with a constant-time
comparison. Login attempts are rate-limited per IP (`auth.login`).

### Email delivery (owned email layer)

All outbound email flows through `remix/app/api/utils/email/` — every send
writes an outbox row to `email_messages` first, checks the suppression /
unsubscribe lists, then delivers via AWS SES (or logs to the console in dev).
Auth wrappers in `api/utils/auth/email.ts` (`sendVerificationEmail`,
`sendPasswordResetEmail`, `sendEmailOtp`, `sendNewsletterEmail`) carry dotted
`templateKey`s (`auth.verify_email`, `auth.password_reset`, `auth.email_otp`,
`newsletter.generic`) and purpose metadata.

```sh
THINGTIME_EMAIL_PROVIDER="ses"          # 'console' (default) or 'ses'
AWS_SES_REGION="us-east-1"              # or AWS_REGION
AWS_SES_ACCESS_KEY_ID="<key id>"        # or AWS_ACCESS_KEY_ID
AWS_SES_SECRET_ACCESS_KEY="<secret>"    # or AWS_SECRET_ACCESS_KEY
THINGTIME_EMAIL_TRANSACTIONAL_FROM="Thingtime <no-reply@thingtime.com>"
THINGTIME_EMAIL_NEWSLETTER_FROM="Thingtime Updates <updates@thingtime.com>"
THINGTIME_EMAIL_REPLY_TO="support@thingtime.com"
AWS_SES_CONFIGURATION_SET=""            # or THINGTIME_EMAIL_CONFIGURATION_SET
THINGTIME_EMAIL_FAIL_CLOSED="false"     # fail-open unless "true"
SES_SANDBOX="1"                         # test throttle (1 msg/sec) for /tests
THINGTIME_EMAIL_TEST_RECIPIENT="support@thingtime.com"
THINGTIME_ADMIN_NOTIFICATION_EMAIL="admin@thingtime.com"  # "new user" ops mail
```

`THINGTIME_ADMIN_NOTIFICATION_EMAIL` is where the internal **new user**
notification lands when a freshly registered account finishes email
verification (`templateKey` `admin.new_user`). It defaults to
`admin@thingtime.com`; point a fork or a preview/staging stack at its own inbox
so real admin mail is never generated by test signups. That mail is the cue to
grant the account public file and media uploads, which new signups do **not**
receive automatically — see
[Public upload approval](#public-upload-approval) below.

### Public upload approval

New accounts start **without** permission to upload files or media, and
verifying the email address does not grant it. The permission has two
independent scopes, so an administrator can approve the **public**, **private**,
or **all** variation per user:

| Scope | Covers | Flag |
| --- | --- | --- |
| `public` | post, comment, and custom-emoji attachments | `meta.publicUploads` |
| `private` | message attachments + the user's own profile avatar/banner | `meta.privateUploads` |
| `all` | both of the above in one write | both flags |

The account carries `meta.publicUploads: false` and `meta.privateUploads:
false` from registration; `POST /api/v1/attachments/uploads` answers
`403 public_uploads_not_approved` or `403 private_uploads_not_approved`
(depending on the requested purpose) until an administrator approves that
scope from the **/admin → Users** tab's per-row **Approve** menu
(`POST /api/v1/admin/users/public-uploads { userId, enabled, scope }`; scope
defaults to `public` for pre-scope callers).

Each flag is deliberately tri-state, so nothing here needs a data migration:

| flag value | Meaning |
| --- | --- |
| absent | account predates the change — uploads stay enabled |
| `false` | withheld, awaiting admin approval (every new signup) |
| `true` | granted by an administrator |

Administrators bypass the flags entirely, so the account that grants the
permission can never be locked out of the surface that grants it.

Use the SES **API** with an IAM key scoped to `ses:SendEmail` — do not create
SES SMTP credentials for the app path. `GET /api/v1/email/config` returns the
sanitized resolved config (never credentials); `POST /api/v1/email/test-otp` is
a dev/preview-only helper for the `/tests` page restricted to the configured
test recipient (or a plus alias of it).

### Private S3 media and attachments

Uploaded images are moderated asynchronously after upload: attachment
completion atomically stamps protected `moderation.status: pending` before the
upload can be projected or served publicly. Pending media stays available only
to its owner and admins as evidence; other callers receive not found until a
provider-pluggable NSFW/TOS analysis releases it. NSFW media then renders
heavily blurred behind a "Show Anyway" click; TOS/illegal verdicts remain
quarantined and log a protected `moderationFlag` for the `/admin` → Moderation
review queue. Provider failures leave the item pending rather than fabricating
a clear verdict, and the bounded retry sweep recovers both missed analysis and
missed flag writes.

The recommended production provider is the tiered `openai+claude` pipeline:
OpenAI's **free** `omni-moderation-latest` endpoint screens every image first,
clean images stamp `clear` at $0, and only flagged/borderline images escalate
to a paid Claude vision call for the policy-nuanced verdict (see
`docs/ai-api-cost-analysis.md`). Note the free screen cannot detect CSAM in
images (OpenAI's `sexual/minors` category is text-only) and cannot apply
Thingtime's "artistic nudity still blurs" rule — that is exactly why flagged
and borderline images always escalate, and why omni alone never stamps
`blocked`. If Claude is unreachable, omni-flagged images fail safe to `nsfw`
(blurred + flagged for admin review); if OpenAI is unreachable, every image
goes straight to Claude.

```sh
THINGTIME_MODERATION_PROVIDER="openai+claude"  # 'openai+claude' (alias 'tiered') | 'claude' | 'openai' | 'test' | 'off'
                                               # unset default by keys: both → openai+claude; ANTHROPIC only → claude;
                                               # OPENAI only → openai; neither → off
ANTHROPIC_API_KEY="<key>"                # Claude API key (escalation / claude provider)
OPENAI_API_KEY="<key>"                   # OpenAI key for the free omni-moderation screen
TT_MODERATION_MODEL="claude-opus-5"      # optional Claude model override
TT_MODERATION_ESCALATION_SCORE="0.2"     # optional; escalate unflagged images whose max
                                         # image-category score meets this 0..1 threshold
```

Note: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are shared with the Lopu musing
feature — their presence alone activates image moderation when
`THINGTIME_MODERATION_PROVIDER` is unset. Set it to `off` explicitly in
environments that carry the keys for musing but must not moderate. An
unrecognized provider value warns and falls back to the key-based default
rather than silently disabling moderation.

Admins control which AI runs each moderation surface from `/admin` →
Moderation → "AI moderation settings": media uploads (default / tiered
openai+claude / free openai-only / claude / off) and post/comment text
(default / free openai / off). Admin choices are stored in the settings
collection and override the env default; "default" delegates back to the
env/key logic above. Post and comment text is screened by the free
omni-moderation endpoint whenever an OpenAI key exists: block-worthy
categories (sexual/minors, threatening harassment/hate, violent-illicit,
self-harm instructions) quarantine the post/comment — it vanishes from every
feed, thread, and search for everyone — while other flagged categories queue
an advisory `moderationFlag` (with a bounded text excerpt as evidence) for
the admin review queue without hiding the content. Edited text is re-screened;
admin review verdicts are final until an admin changes them.

Post creation is FAIL-CLOSED while text moderation is on: the free omni
screen races a bounded time budget (`TT_TEXT_SCREEN_BUDGET_MS`, default
600ms) BEFORE the insert, and a verdict in time means the post is born
stamped — blocked content never renders anywhere. When no verdict can be
obtained (omni outage, circuit breaker open, or `TT_TEXT_SCREEN_BUDGET_MS=0`
async-release mode) the post is born **pending: visible only to its owner**
until the async queue or the hourly cron screens and releases it — its
creation notifications fire at release, when followers can actually see it.
No post-family content ever goes public unscreened while the surface is on;
turning the surface off publishes normally (and the sweep releases any
stranded pending docs so an off flip can't orphan them). The budget is
measured entirely server→OpenAI (client speed is irrelevant), and the
per-instance breaker (3 failures → open 60s) skips the omni call during
confirmed outages so posting stays fast — posts just arrive born-pending.
Edits stay async.

Text screening covers every omni-judgeable public surface of a post-family
thing in one free combined request: prose (`crystal.text`), marketplace
listing text (title/location/category/condition), tags, and the legacy
external image URLs (`crystal.images`, capped at 8/post — omni fetches the
URLs itself, so the multi-URL photos flow is moderated too; URL images follow
the same image-blind `sexual/minors` limitation as omni-only media, so they
flag/advisory rather than auto-block). Known coverage gaps, deliberate for
now: video and non-image file CONTENTS (needs frame-extraction/AV infra) and
profile bio/display-name (different write path).

A scheduled safety net (`GET /api/v1/moderation/sweep`, Vercel Cron at minute
29 each hour, `CRON_SECRET` bearer — same contract as the attachments cleanup
cron) retries moderation the fire-and-forget kickoffs lost: post-family things
with real text and no moderation stamp (process death between the post write
and the verdict stamp, provider outages), pending attachments, and verdicts
whose protected moderation flag still needs to be written. Because the omni
screen is free, the same job also gradually drains any
backlog from periods when text moderation was off; it no-ops while the text
surface is off. The `/admin` → Moderation "Run analysis sweep" button drains
the same batches on demand and shows the text backlog count.

Posts, comments and replies, Messenger messages and thread replies, custom
reaction emoji, and profile avatar/banner images use direct, checksummed
multipart uploads to a private S3 bucket. The browser receives short-lived part
URLs, not AWS credentials; product records reference stable attachment ids,
never expiring S3 URLs. Attachment bytes are reserved against the account's
Thingtime storage tier before upload and remain charged until exact-version S3
deletion is confirmed. A stable client request id is hashed with the
authenticated owner into an opaque owner-scoped attachment id, making lost
start responses safely retryable without cross-account id squatting or
existence disclosure.

Every surface binds only its own server-validated attachment purpose. Comment
and reply files inherit the root post visibility through the complete parent
chain. Message and thread files require current chat membership. Personal and
community custom emoji bind one safe raster image to their exact owner/scope;
community images require membership, while an emoji already used in a shared
conversation remains renderable to its authenticated participants. Deleting an
owning post/comment/message/emoji removes the exact S3 versions before Mongo
rows and quota reservations are released. Custom Mongo data planes cannot bind
or authorize these home-storage objects.

Profile media is limited to JPEG, PNG, GIF, WebP, or AVIF and 64 MiB per image.
The server binds a ready upload only to its exact owner and requested avatar or
banner slot in the same home-Mongo transaction as the profile update. Public
profile rendering uses the stable same-origin content route; the bucket stays
private. Replacing or removing managed profile media releases the old reference
transactionally, but its bytes remain billed until the cleanup path permanently
deletes the exact S3 version and removes the attachment Thing. External http(s)
image URLs remain a separate, quota-saving alternative and are never fetched by
the Thingtime server.

Configure only these server-side Vercel variables. Scope the production bucket
and role to **Production** only. Thingtime's `develop` Custom Environment and
standard feature Preview deployments use the separate development bucket,
role, data plane, and cleanup secret; never expose the production values to
either environment.

```sh
THINGTIME_PRIVATE_S3_ROLE_ARN="arn:aws:iam::<12-digit-account-id>:role/<production-attachment-role>"
THINGTIME_PRIVATE_S3_BUCKET="<private-bucket-name>"
THINGTIME_PRIVATE_S3_REGION="<aws-region>"
CRON_SECRET="<long-random-vercel-cron-secret>"
```

The bucket name must be DNS-compatible **without dots**; dotted names are
rejected so every signed URL uses the unambiguous virtual-hosted S3 form. The
bucket must also belong to the same 12-digit AWS account named by the role ARN.
The runtime derives `ExpectedBucketOwner` from that ARN and fails closed when
the bucket owner differs.

In Vercel, mark all four values **Sensitive**. Give Production its values only
in the built-in Production environment. Give `develop` a distinct set only in
the branch-tracked Custom Environment named `develop`; never select the generic
Preview environment. `CRON_SECRET` authenticates only
`/api/v1/attachments/cleanup`; it is not a Thingtime user, PAT, app, or
service-account credential, and must never use a `THINGTIME_*` browser-visible
name. Use different secrets for Production and develop.

The `develop` Custom Environment must use an exact `develop` branch matcher and
own `https://dev.thingtime.com`. Its Vercel OIDC subject is
`owner:<vercel-team-slug>:project:<vercel-project-name>:environment:develop`.
This is intentionally different from ordinary PR deployments, whose subject
ends in `environment:preview`. Branch-scoped Preview variables alone are not an
AWS boundary because Vercel's Preview OIDC subject contains no Git branch; do
not trust `environment:preview` for the develop role.

The role must use Vercel OIDC temporary credentials and an exact production
subject for this project. Do not create an S3 IAM user, reuse the SES IAM user,
or set generic `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_REGION`
variables for attachments. Restrict its object policy to the app's `objects/*`
prefix. With Vercel's recommended team issuer mode, use this placeholder-only
trust policy (replace every angle-bracket value):

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Principal": {
				"Federated": "arn:aws:iam::<12-digit-account-id>:oidc-provider/oidc.vercel.com/<vercel-team-slug>"
			},
			"Action": "sts:AssumeRoleWithWebIdentity",
			"Condition": {
				"StringEquals": {
					"oidc.vercel.com/<vercel-team-slug>:aud": "https://vercel.com/<vercel-team-slug>",
					"oidc.vercel.com/<vercel-team-slug>:sub": "owner:<vercel-team-slug>:project:<vercel-project-name>:environment:<production-or-develop>"
				}
			}
		}
	]
}
```

Create one role per environment. Substitute `production` for the Production
role and `develop` for the develop role; never wildcard the environment portion
of `sub` and never let one role trust both subjects.

Attach this placeholder-only permissions policy to the role. Keep generic
`s3:DeleteObject` out: in a versioned bucket it can create a delete marker
without permanently removing the billed object version.

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "ThingtimePrivateAttachments",
			"Effect": "Allow",
			"Action": [
				"s3:AbortMultipartUpload",
				"s3:DeleteObjectVersion",
				"s3:GetObject",
				"s3:GetObjectVersion",
				"s3:ListMultipartUploadParts",
				"s3:PutObject",
				"s3:PutObjectTagging",
				"s3:PutObjectVersionTagging"
			],
			"Resource": "arn:aws:s3:::<private-bucket-name>/objects/*"
		}
	]
}
```

The runtime role needs only those object actions:

- `s3:PutObject` and `s3:PutObjectTagging` (the MPU starts with a pending tag)
- `s3:GetObject` and `s3:GetObjectVersion`
- `s3:DeleteObjectVersion`
- `s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts`
- `s3:PutObjectVersionTagging`

Do not grant `s3:ListBucket`, `s3:ListBucketMultipartUploads`, ACL,
public-read, or bucket-administration actions. Completed attachments persist
the opaque S3 `VersionId`; sniffing, tagging, download, and deletion all target
that exact verified version. Exact-version deletion happens before the Thingtime
storage reservation is refunded, so bucket versioning cannot hide unmetered
noncurrent bytes.

Keep both account- and bucket-level S3 Block Public Access enabled, Bucket Owner
Enforced object ownership on, and bucket versioning enabled. Bucket policy
should explicitly deny non-TLS requests and TLS below 1.2. The
`aws:PrincipalIsAWSService` condition avoids accidentally blocking AWS service
principals whose network context AWS redacts:

```json
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "DenyInsecureTransport",
			"Effect": "Deny",
			"Principal": "*",
			"Action": "s3:*",
			"Resource": ["arn:aws:s3:::<private-bucket-name>", "arn:aws:s3:::<private-bucket-name>/*"],
			"Condition": {
				"Bool": {
					"aws:SecureTransport": "false",
					"aws:PrincipalIsAWSService": "false"
				}
			}
		},
		{
			"Sid": "DenyTLSBelow12",
			"Effect": "Deny",
			"Principal": "*",
			"Action": "s3:*",
			"Resource": ["arn:aws:s3:::<private-bucket-name>", "arn:aws:s3:::<private-bucket-name>/*"],
			"Condition": {
				"NumericLessThan": {
					"s3:TlsVersion": "1.2"
				},
				"Bool": {
					"aws:PrincipalIsAWSService": "false"
				}
			}
		}
	]
}
```

Configure CORS with one exact origin per bucket, `PUT`, and the one
application-authored request header: the production Thingtime origin for the
production bucket, and `https://dev.thingtime.com` for the develop bucket. The
uploader deliberately sends a Blob with no `Content-Type`, and completion
obtains ETags/checksums server-side with ListParts, so no S3 response headers
need to be exposed:

```json
[
	{
		"AllowedHeaders": ["x-amz-checksum-sha256"],
		"AllowedMethods": ["PUT"],
		"AllowedOrigins": ["https://<environment-origin>"],
		"ExposeHeaders": [],
		"MaxAgeSeconds": 300
	}
]
```

Lifecycle must abort incomplete multipart uploads after seven days and remove
noncurrent versions after 30 days. This AWS CLI/API-shaped placeholder applies
both actions only to Thingtime's object prefix (the S3 console asks for the same
rule fields):

```json
{
	"Rules": [
		{
			"ID": "thingtime-private-attachment-cleanup",
			"Status": "Enabled",
			"Filter": { "Prefix": "objects/" },
			"NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
			"AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
		}
	]
}
```

Presigned URLs work with a private bucket; public access must stay off.
Production uses the app's hourly Vercel Cron at minute 17. Vercel Cron runs
Production deployments only, so the `develop` Custom Environment instead needs
an external hourly scheduler that sends the same exact bearer header to
`https://dev.thingtime.com/api/v1/attachments/cleanup`. Thingtime uses a
dedicated AWS EventBridge API Destination for that call; keep its connection
secret distinct, its invocation role limited to that one destination, and its
rate at one request/second. Configure the Connection as API-key auth with
header name `Authorization` and value `Bearer <develop-cron-secret>`. Restrict
the role trust to `events.amazonaws.com` plus the exact rule `aws:SourceArn`
and account, and grant only `events:InvokeApiDestination` on the exact API
Destination ARN. Schedule `cron(17 * * * ? *)`; never put the connection secret
in the rule payload, repository, or logs. Both paths process at most 1,000 rows with a
25-second wall-clock budget per pass. Pending cancellations
that issued a presigned part URL stay conservatively billed through an eight-day,
lifecycle-backed settlement window. Cleanup then requires two empty
Abort/ListParts checks at least one hour apart before HEAD verification,
exact-version deletion, and transactional refund. This prevents a signed part
PUT that finishes late from escaping tier accounting; the seven-day S3
incomplete-MPU lifecycle remains a required independent guard.
An MPU that never issued a part URL has no possible late browser PUT and can be
refunded promptly after Abort/ListParts/HEAD proves it empty.

### Notification emails (SES notification stream)

Activity notifications (friend requests, new followers, comments, replies,
reactions, shares — plus an optional weekly summary digest) can also email the
recipient. They ride the same emit calls as the in-app bell, are always
fire-and-forget, only go to verified addresses, and honor the per-user channel
matrix from Settings → Notifications (`/api/v1/notifications/settings`: per
type × channel switches plus a master switch per channel; the two high-volume
post types are email-opt-in). Sends are capped per recipient per hour, and
every email footer carries a manage link plus a one-click unsubscribe link
(`GET /api/v1/notifications/email/unsubscribe?uid=…&token=…`, an HMAC token —
no session needed).

```sh
THINGTIME_EMAIL_NOTIFICATIONS_FROM="Thingtime <no-reply@thingtime.com>"
                                        # optional; falls back to the
                                        # transactional from-address
THINGTIME_EMAIL_UNSUB_SECRET=""         # optional HMAC secret for unsubscribe
                                        # links; falls back to JWT_SECRET /
                                        # JWT_PRIVATE_KEY
CRON_SECRET="<random string>"           # lets the Vercel cron trigger the
                                        # weekly digest run
APP_URL="https://your-deployment.com"   # absolute links in emails
```

The weekly digest is scheduled in `remix/vercel.json` (`crons`) against
`GET /api/v1/notifications/email/weekly-summary`; Vercel attaches
`Authorization: Bearer <CRON_SECRET>` automatically when that env var exists.
Signed-in admins can run the same endpoint manually (`?dryRun=1` or
`POST { dryRun: true }` previews without sending), and the run is idempotent —
a six-day per-recipient lookback in the `email_messages` outbox prevents
double-sends.

### Service account provisioning

Apps and backend services can create service-owned Thingtime accounts through:

```sh
POST /api/v1/auth/service-account
```

The endpoint is self-service: it does not require a server provisioning secret,
but it does require a unique, valid email address. The account must verify that
email within seven days. Until verification, the bearer token works only during
that grace window; after the deadline, authenticated requests for the service
account are rejected until the email is verified.

```sh
curl -X POST "https://thingtime.com/api/v1/auth/service-account" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceName": "CodexTime",
    "username": "codextime",
    "email": "codextime-service@example.com",
    "displayName": "CodexTime"
  }'
```

The response includes an `accessToken` that the service can use as a normal
Thingtime bearer token:

```sh
Authorization: Bearer <accessToken>
```

Service account tokens are intentionally non-expiring JWTs with revocable Mongo
session records. The session `expiresAt` value is `null`, the JWT has no `exp`
claim, and the account starts with a `storageAllowanceBytes` value of
`5368709120` (5 GiB). The email-verification deadline is returned as
`verificationRequiredBy`. Revoke the token by revoking or deleting its backing
session document.

See `docs/api/service-accounts.md` for the complete request and response shape.

Lopu musings can optionally use Claude and/or OpenAI. Without these keys, the
endpoint serves the built-in fallback library.

```sh
ANTHROPIC_API_KEY="<anthropic-api-key>"
OPENAI_API_KEY="<openai-api-key>"
LOPU_PROVIDER="claude"
```

Every Claude-backed musing reads the current Admin → AI workflow model order
from `Thingtime.PRConflictAutoResolverModelWaterfall`; a named preference wins
over `LOPU_CLAUDE_MODEL`. When the Admin primary is `default`,
`LOPU_CLAUDE_MODEL` remains the Anthropic-valid provider default. OpenAI is a
separate provider and continues to use `LOPU_OPENAI_MODEL` (or its documented
built-in default), including when it is selected first with `LOPU_PROVIDER`.

When an AI key is configured, the musing endpoint uses MongoDB to allow 10
AI-backed musings per detected IP address per rolling hour. Requests over the
limit, or requests made while the rate-limit collection is unavailable, stream
the preset fallback responses instead of calling an AI provider.

## Branch automation: develop → main promotion

`develop` is the integration branch; `main` is the release branch. Four
workflows keep them flowing without manual branch surgery, giving two
complementary ways to ship:

- **Promote features to main** (`.github/workflows/promote-features-to-main.yml`)
  scans PRs merged into `develop` and opens one promotion PR per feature
  against `main` (cherry-picked `promote/pr-<n>-<slug>` branches), so every
  change can get a second, release-focused review on its own. PRs that share a
  feature group (a `Promotion-Group: <key>` body line, a `stack:<key>`/
  `group:<key>`/`feature:<key>` label, a `feature/<key>/...` branch, or a
  `feat(<key>): ...` title) are opened as a stacked chain in merge order —
  review and merge bottom-up, deleting each branch on merge. Label a develop
  PR `no-promote` to keep it out of the train; close a promotion PR to reject
  that change for `main` permanently.
- **Promote develop to main** (`.github/workflows/promote-develop-to-main.yml`)
  keeps one standing all-or-nothing PR open (head `develop`, base `main`).
  When everything on `develop` is deemed mergeable, merge it instead of
  merging every feature individually. The two trains never fight: after an
  omnibus merge the per-feature workflow sees the content already on `main`,
  skips it, and automatically closes any open promotion PRs whose diff has
  become empty.
- **Sync main into develop** back-merges `main` after promotions land.
- The AI conflict/rebase workflows keep promotion PRs and stacks mergeable.

Fork setup: everything runs with the default `GITHUB_TOKEN`, but promotion
PRs it creates will not trigger CI, and promotion branches touching
`.github/workflows/**` cannot be pushed. Optionally add a `PROMOTION_PAT`
repository secret (fine-grained token with Contents + Pull requests +
Workflows read/write, placeholder value `github_pat_...`) to lift both limits;
`SYNC_BRANCHES_PAT` / `CONFLICT_RESOLVER_PAT` are honoured as fallbacks.

## Branch automation: the `all` wildcard branch

`all` is a generated everything-branch: `develop` + `main` + every open PR
(stacked branch → branch PRs included) merged together, so all in-progress
work can be tried in one place. **Build all branch**
(`.github/workflows/all-branch.yml`) rebuilds it from scratch and force-pushes
the result on every push to `develop`/`main`, on every open-PR change, and
hourly:

- Rebuilds start from `develop`, merge `main`, then merge open PR heads in
  stack order (parents before children, ascending PR number within a layer)
  with `-X theirs` plus a matching theirs-biased fallback for modify/delete
  conflicts — later PRs win contested hunks, and a conflict never stops the
  train. A PR whose merge cannot complete at all is skipped, not fatal.
- `ALL_BRANCH.md` at the branch root records exactly what went in (base tips,
  every merged PR and how it merged, every skipped PR with its reason). The
  rebuild is deterministic, so the branch is only force-pushed when the
  resulting tree actually changed.
- Never base work on `all`, never open PRs from it, and expect
  `git reset --hard origin/all` when tracking it locally — history is
  rewritten on every rebuild.
- Fork PRs are excluded (their unreviewed code would otherwise reach this
  repo's Vercel builds without the usual fork-authorization step). Label any
  PR `no-all` to keep it out of the union.
- Semantic collisions — two PRs adding the same helper merge textually clean,
  so no git conflict ever exists, yet the union build breaks — are handled by
  the AI **build doctor**: after each input-changed rebuild the union build
  runs (install, then the full Vercel-parity remix build, with a mechanical
  lockfile repair first), and on failure up to three guarded, edit-files-only Claude
  rounds (the conflict resolver's action pin, model waterfall, and security
  posture) repair the tree. Out-of-scope edits are reverted, commits are
  credential-scanned, and the build is re-verified mechanically. Doctor
  fixups ride on `all` and are cherry-pick-replayed onto the next rebuild,
  dropping silently once the source PRs heal for real; an exhausted doctor
  leaves a marker commit and retries once before waiting for input movement.
  Needs the resolver's `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`
  secret; without it the union is pushed unhealed.
- `.github` on `all` is pinned to `develop`'s copy (workflows never execute on
  `all`, and this keeps force-pushes within the default `GITHUB_TOKEN`'s
  powers). If a rebuild still trips GitHub's workflow-file push restriction,
  the builder re-pins `.github` to the previous `all` state and retries.
- Vercel builds `all` like any other product branch, so it doubles as a living
  everything-preview.

## Vercel deployment status

The footer can show live Vercel deployment/build status. It works in a limited
tokenless mode on Vercel, but full status, dashboard links, build state, last
ready time, and active polling need a Vercel REST API token.

Local development, preview deployments, and production deployments expose
`/vercel`, backed by `/api/v1/vercel/deployments`, to scan recent Vercel pages
for the latest deployment per unique branch with timestamps, preview links,
deployment-detail links, current Vercel states, total branches counted, and an
optional display cap using the same server-only token configuration.

Add this as a sensitive Vercel project environment variable:

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
PREVIEW_EXPECTED_BUILD_MINUTES="5"
ADMIN_PREVIEW_DISPATCHER_LOGIN="your-ci-control-app[bot]"
DEVELOP_PREVIEW_TRUSTED_ACTORS="<comma-separated-github-logins>"
THINGTIME_DEVELOP_S3_CORS_PROBE_URL="https://<bucket>.s3.<region>.amazonaws.com/<unsigned-probe-path>"
```

Create this token from Vercel account/team token settings, not from the OAuth
App / "Sign in with Vercel" setup page. The token needs access to the Vercel
team and project that own the deployment. A persistent `403` from
`/api/v1/vercel/status` or `/api/v1/vercel/deployments` usually means the token
was created for the wrong account/team, has expired, or lacks project access.

These Vercel variables are optional because the hosted Vercel runtime normally
provides enough deployment metadata automatically, and token-backed deployment
pages read the project name/slug from the Vercel API:

```sh
VERCEL_PROJECT_ID="<project-id>"
VERCEL_TEAM_ID="<team-id>"
VERCEL_DASHBOARD_TEAM_SLUG="<team-or-scope-slug>"
```

Use `VERCEL_DASHBOARD_TEAM_SLUG` when tokenless dashboard links need to point to
a Vercel team slug that differs from the GitHub repository owner.

Deployment status can additionally be fed by a Vercel webhook instead of polling
the Vercel REST API. This is optional and off by default:

```sh
VERCEL_WEBHOOK_SECRET="<signing-secret-shown-once-when-the-webhook-is-created>"
```

Create a project-scoped Vercel webhook for deployment created/succeeded/
promoted/error/canceled events pointing at:

```text
https://<your-thingtime-origin>/api/v1/vercel/webhook
```

Forks: the helper script `remix/scripts/vercel/create-webhook.mjs` registers
that webhook against `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` (documented above).
It falls back to this repository's own upstream project and team when those are
unset, so set both to your own values before running it — otherwise the call is
aimed at an account your token does not own. Creating the webhook by hand in the
Vercel dashboard needs neither variable.

While `VERCEL_WEBHOOK_SECRET` is unset the endpoint answers `404` and
`/api/v1/vercel/status` behaves exactly as before (live API polling). Once it is
set, the latest event per git branch is persisted server-side and a `ready`
state is served from that record with no Vercel API calls; mid-build states
still poll for phase and progress.

A recorded `error`/`canceled` is only served when the record demonstrably
belongs to the deployment answering the request (matched on `VERCEL_URL`, or on
`VERCEL_GIT_COMMIT_SHA` when no URL is available). One branch can have several
concurrent deployments sharing that single record — Thingtime builds one head
SHA into both generic Preview and the `develop` Custom Environment — and a
sibling's failure must not mark a healthy deployment as failed, since this also
backs `/api/v1/health/vercel`. Unattributable failures fall back to polling.

This is a **separate** webhook from the CI Control receiver at
`/api/v1/integrations/vercel/webhook` (`THINGTIME_VERCEL_WEBHOOK_SECRET`)
documented above, which ingests the same Vercel deployment events into the CI
Control event log for a different purpose. Configuring one does not configure
the other, and the two secrets are independent. If you only want deployment
status in the footer, you only need this one.

Vercel automatically provides variables such as `VERCEL`, `VERCEL_ENV`,
`VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_GIT_COMMIT_REF`, and
`VERCEL_GIT_COMMIT_SHA` during deployments.

### Trusted `develop`-target PR deployments

A pull request's base branch does not select its Vercel environment, and it
does not gate the preview either: every same-repository PR — whether it targets
`develop`, `main`, `github-actions` or another feature branch — gets its exact
head SHA deployed by the trusted controller in
`.github/workflows/develop-pr-preview.yml` into the `develop` Custom
Environment by default, and published at
`https://pr-<number>.previews.dev.thingtime.com` until the PR closes. The only
base-independent requirements are the trust gates below and a head that
carries `remix/` (controller-only branches have nothing to build and take the
skip/reconcile path). Thingtime also assigns the current `develop` runtime
variables to generic Preview, so an ordinary newly built Preview shares the
development data/services even without the controller. The controller remains
responsible for the stable alias, identity/SHA gates, status comment, and
marker-scoped cleanup. A `production`-environment preview of a PR is an
explicit admin choice made through the admin preview lane
(`deploy-admin-pr-previews.mjs`, published under
`pr-<number>.previews.thingtime.com`); it never happens by default.

The workflow deliberately separates authorization, compilation, and
publication. Product branches retain only a
thin event listener pinned to the reusable implementation on the protected
`github-actions` branch. Its `pull_request_target` job has no environment or
Vercel secret, checks out no code, and emits only a bounded
`repository_dispatch` payload. The protected authorizer checks out only
`github-actions`, proves the source workflow path/run, repository,
same-repository PR, head SHA, action, and triggering actor through GitHub's API,
then re-reads the live PR. Both the PR author and triggering actor must be
explicitly allowlisted and currently hold write/admin permission, and the PR
must be non-draft. Its base branch is not part of the gate: `develop`, `main`
and feature-branch targets all preview into the `develop` environment.

A separate environment-free GitHub job checks out exactly that authorized SHA,
installs locked dependencies, and generates `.vercel/output` without any
repository or Environment secrets. The protected publisher never executes the
product checkout: it validates the short-lived archive's paths, links, size,
routes, and Vite shell, then uses a pinned Vercel CLI with `--prebuilt` and
`--target=develop`. Only that controller process receives the Vercel token and S3
CORS probe URL. Root `vercel.json` disables automatic Git deployments for
every branch except exact `main` and `develop`, so feature pushes cannot create
a second native Vercel build for the same SHA.

The reusable implementation and controller script must first merge to the
protected `github-actions` branch. The thin listener must then reach the
repository's default `main` branch through the normal `develop` promotion path.
`pull_request_target` loads the listener from the default branch, so merely
adding it to a feature branch does not activate the controller. Thingtime's
active `main` `Basic Protection` ruleset
has no bypass: it requires a pull request, resolved review threads, strict Web
CI and CodeQL status checks, and blocks branch deletion and force-pushes. The
tracked CODEOWNERS file requests owner review, but independent CODEOWNER
approval is optional future hardening once a second trusted collaborator can
review controller changes. The controller Environment intentionally has no
required reviewer because that would pause event cleanup and every six-hour
scheduled reconciliation instead of letting them run automatically.

Thingtime's protected GitHub Environment `vercel-develop-pr-control` allows only
the `main` deployment branch. It contains the nine controller variables and a
dedicated 90-day Vercel token scoped to the owning team. Vercel does not offer
a project-scoped PAT for this API surface, so the protected Environment and the
controller's exact project/team checks are the project boundary. The masked
unsigned S3 CORS probe secret is also installed. The secret-free
`pull_request_target` stage hands off to a `repository_dispatch` run in the
default-branch context; scheduled runs also use the default branch, and the
workflow refuses a manual dispatch from any other ref. Forks must use values
from their own Vercel project; the examples are placeholders and must not be
committed with live credentials or identifiers:

```sh
# GitHub Environment secrets
VERCEL_DEVELOP_DEPLOY_TOKEN="<dedicated-Vercel-deployment-token>"
THINGTIME_DEVELOP_S3_CORS_PROBE_URL="https://<exact-develop-bucket>.s3.<region>.amazonaws.com/<probe-object>"

# GitHub Environment variables
VERCEL_PROJECT_ID="<Vercel-project-id>"
VERCEL_PROJECT_NAME="<Vercel-project-name>"
VERCEL_TEAM_ID="<Vercel-team-id>"
VERCEL_TEAM_SLUG="<Vercel-team-slug>"
VERCEL_GITHUB_REPO_ID="<Vercel-linked-GitHub-repository-id>"
VERCEL_CUSTOM_ENVIRONMENT_ID="<Vercel-develop-custom-environment-id>"
DEVELOP_PREVIEW_TRUSTED_ACTORS="<trusted-GitHub-login>[,<trusted-GitHub-login>]"
PREVIEW_ALIAS_SUFFIX="<preview-alias-suffix>"
STABLE_DEVELOP_DOMAIN="<stable-develop-domain>"
```

`VERCEL_CUSTOM_ENVIRONMENT_ID` must contain the exact immutable ID returned for
the `develop` Custom Environment, not the display slug `develop`. The author and
triggering actor must both appear in `DEVELOP_PREVIEW_TRUSTED_ACTORS` and
still hold current write/admin repository permission. Keep the Vercel
environment's branch matcher on the literal `develop` branch. Bind
`dev.thingtime.com` to that Git branch (`gitBranch: develop` and no
`customEnvironmentId` on the domain), not to the entire Custom Environment,
and keep the Custom Environment's own domain list empty. The controller assigns
only the verified PR wildcard alias explicitly. This leaves the stable
development hostname on the real `develop` branch while PRs receive only
`https://pr-<number>.previews.dev.thingtime.com`.

Generic Preview retains the development runtime variables required by manual
or prebuilt preview publication, but ordinary feature pushes no longer trigger
automatic Vercel builds. Production MongoDB, JWT, and S3 settings remain
separate and are not assigned to Preview.

For Thingtime, set `PREVIEW_ALIAS_SUFFIX=previews.dev.thingtime.com` and
`STABLE_DEVELOP_DOMAIN=dev.thingtime.com`. Forks should replace both with
domains they control. The masked Environment secret
`THINGTIME_DEVELOP_S3_CORS_PROBE_URL` is required and must be a credential-free
HTTPS object URL on the exact develop bucket, with no query string or presigned
parameters. The controller sends only an unauthenticated CORS `OPTIONS` probe
and fail-closes alias publication if it is not accepted.

`*.previews.dev.thingtime.com` is registered, verified, and detached from
both Git branches and Custom Environments in Vercel. Its remaining Thingtime
DNS setup keeps Cloudflare authoritative for the apex. The **DNS only**
(grey-cloud) CNAME from `*.previews.dev` to `cname.vercel-dns.com` routes wildcard
traffic, while wildcard TLS issuance and renewal require two narrow NS
delegations from `_acme-challenge.previews.dev` to `ns1.vercel-dns.com` and
`ns2.vercel-dns.com`. Do not move the `thingtime.com` apex to Vercel nameservers
or delegate a broader subtree. Dedicate `_acme-challenge.previews.dev` to this
preview wildcard, because that delegation gives Vercel control of certificate
validation for the subtree and can prevent another provider from issuing there.
When verifying the delegation, query either authoritative Cloudflare nameserver
with `+norecurse +authority`: delegation NS records are returned in the DNS
referral's authority section, so a recursive `dig +short NS` can misleadingly
print no answer even while the delegation is healthy.
Vercel may still label this externally managed arrangement `DNS Change
Recommended` or return `misconfigured: true`; that advisory asks to move the
apex nameservers and is not the publication gate. The controller instead
requires the live probe hostname to resolve to Vercel's currently recommended
CNAME target, then verifies HTTPS on the exact alias after assigning it.
Making Vercel authoritative for the domain would normally remove the advisory,
but Thingtime intentionally keeps Cloudflare authoritative and delegates only
the two narrow ACME validation subtrees.
See Vercel's official
[wildcard-without-Vercel-nameservers guide](https://vercel.com/kb/guide/wildcard-domain-without-vercel-nameservers).
Forks should first add their own wildcard to Vercel and copy every CNAME or
verification record Vercel currently displays for that domain; do not copy
another project's account-specific targets.

The develop S3 bucket permits browser upload CORS from the stable development
origin, the controller-managed PR aliases, and Thingtime's generated Vercel
Preview hostnames. Downloads remain same-origin through Thingtime and the
bucket stays private:

```json
[
	{
		"AllowedHeaders": ["x-amz-checksum-sha256"],
		"AllowedMethods": ["PUT"],
		"AllowedOrigins": ["https://dev.thingtime.com", "https://*.previews.dev.thingtime.com", "https://thingtime-*-lopugits-projects.vercel.app"],
		"ExposeHeaders": [],
		"MaxAgeSeconds": 300
	}
]
```

Activation status as of 2026-08-12: the no-bypass `main` ruleset, protected
Environment, nine controller variables, dedicated 90-day Vercel token, masked
`THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret, shared develop/Preview runtime
scope, generic-Preview OIDC trust, develop bucket CORS, detached Vercel
wildcard, DNS-only wildcard CNAME, narrow ACME NS delegation, and wildcard TLS
are complete for `*.previews.dev.thingtime.com`. The protected controller from
#239 is now on `github-actions`, and the thin listener from #233 is on
`develop`.

Live Vercel inspection on 2026-08-12 confirms the intended stable-domain
invariant: `dev.thingtime.com` is verified with `gitBranch: develop` and
`customEnvironmentId: null`; the `develop` Custom Environment retains its
literal branch matcher and has an empty domain list. This resolves the earlier
stable-domain configuration-gate failure.

Because `pull_request_target` loads its workflow from the default branch, the
thin listener had to reach `main` before a live run could exercise the
protected implementation. **That promotion has since landed** (#188 merged
2026-08-17): `.github/workflows/develop-pr-preview.yml` on `main` is now the
thin listener delegating to
`lopugit/thingtime/.github/workflows/develop-pr-preview.yml@github-actions`, so
`main`'s previous direct controller — whose obsolete requirement for a literal
`misconfigured: false` could reject healthy externally managed wildcard DNS
before deployment — is no longer in the path. The remaining step is a fresh
eligible develop-target PR run as final live proof, exercising the protected
#239 implementation's exact-SHA deployment, alias publication, CORS probe, and
attachment upload/removal checks.

CORS is not authorization. The bucket remains private, while the development
AWS role explicitly trusts both Thingtime's `environment:develop` and
`environment:preview` OIDC subjects. Every new ordinary Preview can therefore
read or mutate the same development MongoDB/S3/data plane and use the same
private integration values as `dev.thingtime.com`. Treat all branches Vercel is
allowed to build as trusted development code, use disposable data, and keep
production MongoDB/JWT/S3 credentials out of Preview.

`*.previews.thingtime.com` remains detached from the production branch and
primary domains. Admin CI Control may assign only the exact
`pr-<number>.previews.thingtime.com` alias to an owned, marker-verified READY
production-environment preview. Its immutable `*.vercel.app` snapshot remains
available beside that persistent URL. Do not point the develop controller at
the production suffix, copy the production S3 role into generic Preview, or let
ordinary Vercel feature/fork previews assume the production AWS role. The
production-preview wildcard, exact production OIDC trust, cleanup, and bucket
CORS rules must remain independently protected.

Every generic Preview and eligible controller deployment intentionally shares
the same development MongoDB, S3 bucket, quotas, and other runtime state as
`dev.thingtime.com`. It is a trusted integration surface, not an isolated
sandbox: use disposable test accounts/data and do not allow Vercel to build
untrusted code in this project. The controller updates one marker comment with
deploying/ready/failure state, moves
the PR alias only after the exact SHA is ready and revalidated, and deletes only
its marker-tagged superseded resources. Close/retarget/draft handling removes
the alias, inactivates the transient GitHub Deployment, and deletes its tagged
Vercel deployments. A six-hour scheduled reconciliation repeats marker-scoped
cleanup after an interrupted or missed event without touching the stable
`develop` deployment; manual dispatch safely revalidates one supplied PR.
See `VERCEL_DEPLOYMENTS.md` and the Develop-target checklist in `TESTING.md` for
the operator runbook.

The footer environment selector can compare public origins for this tab, local,
development, staging, and production. These values are browser-visible
`THINGTIME_` values, so use public origins only and never include tokens,
passwords, or other secrets:

```sh
THINGTIME_PRODUCTION_STATUS_ORIGIN="https://thingtime.com"
THINGTIME_DEV_STATUS_ORIGIN="https://dev.thingtime.com"
THINGTIME_STAGING_STATUS_ORIGIN="https://staging.thingtime.com"
THINGTIME_LOCAL_STATUS_ORIGIN="http://localhost:9999"
```

Unset values fall back to `https://thingtime.com`, `https://dev.thingtime.com`,
`https://staging.thingtime.com`, and `http://localhost:9999`.

## Public env exposure rule

Browser-visible loader data uses an explicit allowlist. It includes only the
public local/development/staging/production status origins plus derived branch,
Vercel deployment, and status-display labels. Every other environment variable
remains server-only — including all `THINGTIME_*` webhook, router, email,
credential, token, password, and private-key values. Never add a new public
value by prefix convention; add and review its exact key in
`remix/app/root-data.server.ts`.

Naming still matters for reviewability even though it no longer decides
exposure: use the `THINGTIME_PRIVATE_` namespace for server-only Thingtime
integrations such as S3, and keep secrets such as MongoDB passwords and Vercel
API tokens unprefixed and server-only.

## Native iOS TestFlight web URL

Lopu voice requires build 27 or later; build 25's general native bridge did not
include its recorder or Live Activity widget. Voice support is negotiated with
`lopuVoiceVersion`, separately from the shell version. For a fork's signed build,
register the app, its `.watchkitapp` companion, and its `.lopu-widget` extension
under your own bundle prefix. The Fastlane build syncs a distribution profile
for each target and includes all three in manual export. Override
`LOPU_WIDGET_BUNDLE_IDENTIFIER` and `LOPU_WIDGET_PROVISIONING_PROFILE_SPECIFIER`
only when your fork's Xcode bundle settings match those values; keep signing
credentials in the ignored iOS env/Keychain. Audio recovery files stay on-device
in Files → On My iPhone → Thingtime → Lopu Recordings. Build 28 also uploads
new recordings as owner-private audio Things under `/things`. This requires
private-upload approval, available account storage, and the selected origin
advertising `api.attachment-uploads` and `api.attachment-upload-complete` 1.2.0
in `/.well-known/thingtime-capabilities.json`. Forks use the existing private
S3 attachment setup; no new credential is needed. Failed uploads remain local
and retry when Lopu reopens or regains connectivity in the same account. See [voice recovery](iOS/README.md#lopu-voice-recovery).


The native iOS app lives in `iOS/` and defaults its embedded `WKWebView` to
`https://thingtime.com`. TestFlight builds can target a Vercel branch or preview
deployment by setting a non-secret build-time URL:

```sh
export THINGTIME_WEB_URL="https://<vercel-branch-preview-host>"
```

For repeatable local uploads, copy `iOS/.env.example` to `iOS/.env`, fill in the
TestFlight values, and run:

```sh
iOS/scripts/testflight-beta.sh
```

`iOS/.env` is ignored by git. The value is baked into that uploaded app build;
future web changes on the same Vercel branch URL do not require a new iOS
binary.

### Recovery release catalogue and cloud publishing

Recovery reads all published GitHub release pages (including prereleases) in one
refresh, then selects desktop and companion Recovery ZIPs for the current Mac.
Its sidebar reports GitHub's published count separately from compatible archives;
Actions runs and source commits are not downloadable releases. The legacy build 4
archive has no resource seal and must not be installed or re-signed by the client.
A failed download, verification, or refresh preserves the installed app and caches.
Publishers can withdraw a damaged component without removing release history by
placing `<!-- thingtime-recovery-unavailable:v1:desktop:missing-resource-seal -->`
on its own line in that GitHub release's notes (`recovery` replaces `desktop` for
the companion app). Recovery labels that component unavailable and disables its
download before transferring the archive. Other components remain available.
Installing a valid replacement can repair a damaged current app: when the old app
cannot enter the verified cache, Recovery preserves it separately and reports its
backup path. Installer failures reopen Recovery with a persistent explanation.

Main and approved PR release builds use the protected `github-actions` pipeline.
The main listener requires `contents: write` and `pull-requests: read` so its nested
worker can run; product changes reach it through the normal main promotion process.
The macOS signing inputs are `MAC_CSC_LINK` (base64 encrypted Developer ID P12),
`MAC_CSC_KEY_PASSWORD`, and `APPLE_TEAM_ID`, stored in GitHub Actions secrets.
Notarization uses `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER`, or the already configured `ASC_KEY_CONTENT`, `ASC_KEY_ID`,
and `ASC_ISSUER_ID` equivalents. API-key content is base64 encoded. The ASC
fallback is considered only after macOS signing is explicitly configured, so an
unrelated iOS setup does not change the unsigned lane. An entirely absent macOS
secret set produces clearly marked `.unsigned` prereleases containing both
apps; partial configuration fails closed. Unsigned archives never become the latest trusted release. Forks
must configure their own release origin and signing setup rather than reusing
Thingtime's account credentials.

### Rich text controls development

The isolated `thingtime-editor-rich-text` worktree uses the deterministic Vite
port **14870**, HMR **14871**, and Nitro **14872**. The ephemeral verification
page is `http://localhost:14870/tests/editor-rich-text.html`; it mounts the real
Editor.js and builder components without saving account data. Run
`npm run web-ports` in other checkouts to resolve their own ports.

The full colour/size panel is available from the inline palette button and
**More text styles…** in block settings. Sizes support px, em, rem, pt and %;
relative units retain CSS semantics. Existing numeric sizes remain px.
Live changes preview in the document; **Save** keeps them and **Cancel** restores
the starting style. An unstyled picker begins at 50% lightness. Drag its title to
move it, or use the corner handle (pointer/arrow keys) to resize it. Block settings
and the advanced rich editor are resizable too.

**Undo**, **Redo** and **Changes** belong to the current editing session.
Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z navigate complete draft snapshots, including empty
blocks. The Changes timeline retains alternate futures and supports restoring a
point or selectively reverting/reapplying an event's fields. If a later edit
changed the same field, selective restoration reports a conflict instead of
silently overwriting it. Whole inline HTML fields and list/table arrays are
atomic for selective restoration. Histories remain in memory while their editor
owner is mounted; they are not persisted across page reloads. Builder inline
and advanced editors each retain their own session history across close/reopen.
The carry-style checkboxes in Changes control which whole-block properties
survive native block conversions; all are enabled initially.

Integrations can listen for the bubbling `tt-editor-update` DOM event on the
editor session. Its detail contains the current `event` (id, parentId, timestamp,
label, changes and document snapshot) and `cursor`; treat the payload as read-only.
This is a local DOM event and creates no remote API or account records.
No additional configuration or credentials are required.

Tailscale/Funnel could not be configured on 2026-09-05: the local CLI shim points
to an absent `/Applications/Tailscale.app/Contents/MacOS/tailscale` binary. No
public Funnel URL or allowed-host entry was added for this worktree.

Recovery's app selector switches between Thingtime Electron and Commander, with
separate cache roots and fixed bundle identifiers. The shared Recovery launcher
can update itself from either view. Commander archives use
`Commander-App-Release-<version>-macos-<arch>.zip` (or the explicit
`Commander-App-UNSIGNED-Release-` prefix and `.unsigned` tag). A Commander view
with no published compatible archive says so; **Save installed build** verifies
and caches `~/Applications/Commander.app` for offline recovery.

GitHub cards show component, channel, date, architecture, size and release/build
identity. **This Mac** cards read build numbers from cache metadata and bundled
`Info.plist`, with embedded Electron commit metadata as a fallback for old apps.
Unknown IDs remain explicitly unknown. The cloud workflow passes its numeric
build number to both apps, and Electron writes it to `CFBundleVersion`.

### Passkey deployment and Apple app setup

Passkeys use the `thingtime.com` relying-party ID on its subdomains, but the
credential record belongs to the selected **account environment**. Production,
development and custom databases can contain different accounts/passkeys. A
shared domain does not replicate credentials. Localhost and custom domains have
their own RP ID. If a saved passkey is unavailable, sign in with the password for
that environment and check Settings → Security before creating another.

The web client requires `api.auth-passkeys-register-options`,
`api.auth-passkeys-register`, `api.auth-passkeys-login-options` and
`api.auth-passkeys-login` version **1.1.0** for its respective ceremony. Deploy the
server and client together. Challenges are independent, signed, origin-bound
httpOnly cookies, capped at three pending per ceremony kind and expiring after
ten minutes. Verified challenges are spent atomically in the existing `authOtps`
TTL satellite; never disable its unique `challenge` index or verification checks.
In-flight legacy cookies have a narrowly scoped compatibility read path.

For the native iOS app, enable **Associated Domains** on your Apple App ID and
regenerate the provisioning profile. `iOS/project.yml` declares
`webcredentials:thingtime.com`; forks must change that to their actual RP domain.
Set the server environment variable `THINGTIME_APPLE_APP_IDS` to the public
application identifier from the app’s signed `application-identifier` entitlement
(for example `ABCDEFGHIJ.com.example.app`; comma-separate additional intended app
IDs). This is public association metadata, **not** a certificate or private key.
The matching RP origin must serve `/.well-known/apple-app-site-association` over
HTTPS without redirects or login. Missing or invalid configuration publishes an
empty app list and deliberately grants no app access. Rebuild/distribute the
signed app with its updated profile, then verify on a physical iPhone. Existing
installed builds without the entitlement cannot be repaired by a web deploy alone.

Passkey repair worktree validation: local web port **19040**, HMR **19041**, Nitro
**19042**. Local URL: `http://localhost:19040`. Tailscale/Funnel was unavailable on
2026-09-05 because its CLI points to a missing `/Applications/Tailscale.app`;
no public Funnel mapping was changed.


### Commander signed GitHub releases

Commander main releases use the protected GitHub Actions controller and the same
approved Developer ID / notarization secrets as Electron. See
[Commander release setup](Commander/README.md#github-releases) for the complete
fork-safe secret names, supported Apple silicon platform, checks, and Recovery
installation flow. Neither the source checkout nor PR builds receive a persisted
publication token. No unsigned release is substituted when credentials are missing.

## Dependency configuration recovery

[configurations/](configurations/README.md) holds non-secret service customizations
and environment-specific restoration instructions. AWS S3 snapshots distinguish
development and production; SES documents verified domain settings and clearly
labelled deployment templates. Forks must substitute their own bucket/domain
names and provision credentials through their secret store.

### Persistent media and responsive images

Media settings let users disable persistence, clear downloaded bytes, or disable
low-resolution previews. A service worker stores binary files in IndexedDB, then
Cache Storage or memory when unavailable (128 MiB per backend, 256 entries, seven
days, at most 16 MiB per file). Browser eviction remains possible. Large files,
opaque third-party responses and unsupported environments use native HTTP
loading; HTML and general API responses are never captured by this worker.
Managed private media requires an online access check before every worker cache
read, including ranges, so cached content cannot bypass revoked access.

The protected attachment-content feature is version 1.1.0. Image variants use
Sharp at widths 64/320/640/1280/1920 with bounded decoding and concurrency. GIFs,
animated/unsupported images and oversized sources fall back to the original.
No resizing infrastructure or extra secret is required. New upload and signed
download Cache-Control metadata permits private storage/revalidation; signed
redirects and authorization receipts retain no-store.

Local validation in the `thingtime-persistent-media-cache` worktree uses
http://localhost:13540 (Vite), 13541 (HMR), 13542 (Nitro). The browser fixture
at http://localhost:13543/tests/media-cache.html is served by
`node remix/scripts/serve-media-cache-qa.mjs`; it uses real UI/worker code with
synthetic media and access revocation, without writing application data.
Tailscale/Funnel could not be verified: the installed CLI wrapper points to a
missing Tailscale.app executable. No public mapping was created or changed.

Thingtime Desktop checks Node privacy access directly from the running helper. The Things setup card refreshes every five seconds while visible and on return from System Settings; **Check access** retries immediately. A failed check preserves and labels the last known result. If macOS shows access enabled but the helper reports denial after moving from a development build to Developer ID signing, switch **Thingtime Node** off and on once for each affected permission, restart the node in Desktop settings, and check again. Desktop never resets privacy grants automatically.
## Thing index audit

The staged consolidation audit and production/develop rollout gates live in
[Thing index consolidation](docs/architecture/thing-index-consolidation.md).
Run `cd remix && node --import tsx scripts/audit-things-indexes.mts` for the
exact source-plan inventory. It does not connect to a database or need secrets;
live index counts must be checked separately through the admin workbench.

The combined relationship/legacy increment targets 47 home indexes, but keeps
60 during compatibility rollout (unknown extra indexes are preserved). Run
`consolidate-relationship-lookup-indexes` and `retire-legacy-thing-indexes`
on that home database. Deploy the
compatible code to every origin sharing it first, dry-run, then run with
`confirm: true` under the migration lease. Duplicate keys block activation;
no relationship documents are deleted. Custom endpoints are not migrated.
Each migration first activates readers without dropping indexes; run it again
after at least one minute to finish retirement. Repeated early runs do not
reset the drain deadline. Legacy rows block retirement except canonical embeds,
whose redundant `kind` metadata can be safely removed after readers drain.
Readiness uses the existing home settings/key index and a 30-second cache;
normal requests never backfill data. No additional secret or provider setup is
required. Follow the linked rollout guide and verify native query plans and
the live index set before retiring any supporting index.

For isolated native regression checks, start a **fresh disposable** MongoDB
replica set named `ttindex` on loopback port `27192` (never your normal local
database). Then run `cd remix` and
`TT_INDEX_TEST_ALLOW_LOCAL=1 MONGODB_CONNECTION_STRING='mongodb://127.0.0.1:27192/thingtime?replicaSet=ttindex' npm run verify:relationship-indexes`.
The script creates fixture accounts/content through the real API utilities,
runs the leased migration, checks behavior and emits identity-free native
explain counts. It refuses any other URI. Stop the disposable server afterward;
it is not a persistent development service.

## Verified vault viewing

Saved CI credentials, admin integration secrets and personal Secure Vault values remain encrypted and masked by default. Their **Show** control requires the current account password or a fresh user-verified passkey for each selected entry. Admin/CI credentials require a current admin role; personal entries remain owner-only. Displayed values are transient and hide after 30 seconds, closing the dialog or leaving the tab.

Local validation worktree `thingtime-vault-verified-reveal` uses Vite 17340, HMR 17341 and Nitro 17342 through the canonical PM2 ecosystem. Local URL: http://localhost:17340/admin/ci-control. Public Tailscale/Funnel URL is unavailable: the installed launcher points to a missing `/Applications/Tailscale.app` executable; no public mapping was changed.

Fork setup: configure a unique 32-byte base64url `THINGTIME_ADMIN_VAULT_KEY` as a server-only secret for each deployment environment. Personal vaults use `THINGTIME_USER_VAULT_KEY` when configured, otherwise the admin key. Preserve existing keys to retain decryptability; never copy ciphertext between environments with different keys. Password verification needs the account's current password hash; passkeys must be registered in the selected environment and require HTTPS (or localhost). Normal authentication signing keys and the existing auth challenge TTL collection support two-minute, single-use, session/origin/item-bound passkey verification. No additional database index or migration is required. The same-origin `api.vault-reveal` 1.0.0 capability is negotiated before use, and fixed security attempt limits apply to every subscription tier.

Desktop permission recovery includes **Open App Locations** in Things and Desktop settings. It opens a private folder of symlinks to the current Desktop and bundled Node, plus installed Thingtime Recovery, Commander, ThingDisk, and ThingDock apps from the standard Applications folders. Duplicate older installations are omitted. You may need to remove the affected app from a macOS permission list and re-add it using these shortcuts. Grant only the permissions you intend. macOS decides whether to display Quit & Reopen; Thingtime offers Later / Restart Node Now when you return from the recovery flow. Restart other affected apps separately. No permission is changed automatically.

### Settings navigation and Mac connection panel

Settings uses one shared component in the drawer popup and full page. Direct links are `/settings/profile` (the default), `/settings/things`, `/settings/appearance`, `/settings/notifications`, `/settings/security`, `/settings/connections`, `/settings/lopu`, and `/settings/admin` (administrators only). Existing Secure Vault and Lopu hash bookmarks remain supported. A popup category is bookmarkable with `?settings=<category>` on the current page; Open settings page carries that category to its dedicated URL.

A healthy Mac connection panel can be hidden from Things using “Don’t show again unless there’s a problem”. This preference is local to the browser and account; Desktop saves it per account and API endpoint so it survives app restarts and changing loopback ports. It persists across reloads, and does not change node operation or privacy access. Live service, pairing, connection, and permission failures reveal the panel again. Settings → Things always retains the panel and a switch to restore it.

Shared-settings validation worktree: `http://localhost:13040` (HMR 13041, Nitro 13042), managed by the repository PM2 lifecycle. Funnel was unavailable during validation because the installed Tailscale CLI points to a missing application executable; no public Funnel URL was verified. No new environment variables or external setup are required for these settings changes.

### Apple widgets and Control Centre

The iOS app and native Mac widget companion share a configurable WidgetKit suite.
See [Apple widget setup](apple/README.md) for gallery choices, content privacy,
App Group provisioning, local signing, and fork-safe build settings. App Group
capabilities must be enabled on both the iOS app and its widget extension before
installing a signed build; no credentials belong in project files.

The Mac companion now uses a native interface and browser OAuth. Open
**Connection** to select production or your local server and approve widget
permissions. No client secret or manual app registration is required; fork
callback identifiers and capability requirements are documented in
[Apple widget setup](apple/README.md#oauth-setup-for-forks-and-local-servers).

### Automatic import and native push recovery (10 September 2026)

The iPhone app automatically imports older `Lopu-*.caf` recordings from its
`Documents/Lopu Recordings` folder when Lopu opens with a signed-in account.
Voice settings → **Import older recordings** is enabled by default and can be
turned off. Import uses the canonical `api.things` 1.7.0 and private attachment
contracts. Local originals stay on the iPhone. A local account/origin-bound
receipt prevents repeated imports; files already uploaded by build 29 are
reconciled against the account's existing audio Things before uploading.
Files created during the current app session use the normal recording outbox.
Offline or failed imports retry when Lopu reconnects.

For native alerts, open **Settings → Notifications → iPhone and Watch push**
in the iPhone app and tap **Enable / reconnect iPhone push**. If iOS permission
was denied, the adjacent button opens the iPhone notification settings. The
page reports eligible account registrations; notification tests report whether
Apple accepted the push, rejected it, or no device is connected. Apple acceptance
is transport confirmation; verify a banner on a physical iPhone (including its
Focus and notification presentation settings).

Forks need an APNs-enabled Apple App ID, signed iOS entitlements, and the APNs
variables documented above on each intended server deployment. Use a P-256 APNs
`.p8` signing key; App Store Connect API keys are a different credential. The
server selects sandbox versus production from the device registration. TestFlight
uses production APNs. Never expose keys or device tokens in public diagnostics.
`api.notifications-devices` 1.2.0 adds authenticated, non-cacheable GET status and
an optional owner guard on registration. `api.notifications-test` 1.1.0 adds the
sanitized delivery report. Single and bulk native delivery remain attached to
the Vercel request lifetime through `waitUntil`.

### Stack AI endpoint selection

Stack merges can save an ordered AI model/endpoint waterfall. Configure
`ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` on the Thingtime deployment for
built-in HTTP endpoints. For personal endpoints, use Settings → Secure Vault;
custom hosts retain the existing `THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS`
allowlist and public HTTPS restrictions. The controller and app must share
`THINGTIME_CI_ROUTER_SECRET` (secret-store values only). API keys stay on the app;
never put them into workflow inputs. Roll out the protected controller's v4 plan
support before using custom orders. Inherited orders keep the existing CLI
workflow. See [the reusable selector contract](docs/ai-waterfall-selector.md).

This feature's local validation worktree uses `http://localhost:13310`
(Vite), 13311 (HMR), and 13312 (Nitro), derived by `npm run web-ports`.
Tailscale/Funnel is not available on the validation host: its configured CLI
wrapper points at a missing Tailscale application. No public dev mapping was
created or changed.

## Inherited Thing actions

Persisted entity menus use `ThingContextMenu` and `buildThingEntityMenu`;
`schemas/thingActions.ts` owns the base verbs. Post privacy/moderation and
Drive selection/clipboard operations extend this model. `PersistedThingMenu`
resolves only an opened Thing through `/api/v1/things` and guards recording
handoff against account changes. Do not add a new per-kind dropdown renderer.
Navigation actions carry an explicit `href` and render real anchors; they never
reuse mutation callbacks. Drawer navigation also preserves native modified and
middle clicks. Actions without a destination remain buttons.

The Things browser stores `q`, `kind`, `view`, `display`, `sort`, and `group` in
the URL alongside folder/device/preview state. Preference defaults are written
explicitly so Back and shared links do not depend on later local-cache changes.
Search typing replaces the current history entry; filter changes create entries.

CRUD remains `/api/v1/things`. Semantic operations use
`POST /api/v1/things/actions` with `{ "id": "your-thing-id", "action": "send-to-lopu" }`.
Negotiate origin-scoped `api.things-actions` 1.0.0 before dispatch. The first
operation delegates to the protected recording writer; old recording clients
retain their compatibility operation. Shared schema/UI does not mean arbitrary
protected-state mutation: attachment lifecycle, chat membership, moderation,
consent and quota checks remain enforced by their domain writers. A schema's
menu hints never grant authority. No storage migration or new secret is required.
Handoff requires the home data source; a custom source returns 409 so an ID
from another database cannot accidentally select a home recording.

For forks, configure normal account/storage setup and explicitly enable a
recording processor before testing handoff. Personal processing uses a paired
device; API processing uses the account's configured provider connections.
Never embed credentials in a menu, action request, source fixture or public docs.

Local menu QA uses this worktree's deterministic port (currently
`http://localhost:16250`). Tailscale/Funnel was unavailable during verification:
the local launcher points to a missing Tailscale app; no public mapping was changed.

### Saved AI waterfalls

Settings → AI waterfalls stores private named model/endpoint orders using the existing Things database and authenticated API. No extra collection, migration, or secret is required. Configure provider keys or personal Secure Vault connections as described in [the waterfall setup](docs/ai-waterfall-selector.md). Forks must deploy the registered `api.ai-waterfalls` 1.0.0 contract before clients can save a library.

## Portable transfer real-storage acceptance

The optional `remix` command `test:transfer-binary` exercises real multipart
uploads and image ZIP import/export through the application API. It is disabled
unless `TT_TRANSFER_BINARY_TEST=1` is explicitly set. Use a local fixture server
(`TT_TRANSFER_TEST_URL=http://127.0.0.1:<your-worktree-port>`) backed by a
disposable test account and the private storage setup documented above. That
account must already have public-upload approval and a ready storage ledger.
Provide its session cookie through `TT_TRANSFER_TEST_COOKIE` in the process
environment using your local secret tooling; never put it in a command literal,
tracked file, screenshot or test report. Do not use a production account.

Run `corepack pnpm --dir remix run test:transfer-binary` with those environment
values. The test checks API capability versions, uploads tiny PNG fixtures,
compares bytes and annotations after ZIP/reimport, checks anonymous denial and
concurrent emoji import claims, then deletes its own returned IDs and verifies
cleanup. It does not connect directly to MongoDB, enable uploads, reconcile
storage or run migrations. A failed approval/storage precondition is a blocker,
not a passed test. Investigate any reported cleanup IDs before another run.

For isolated archive UI checks, run `node --import tsx scripts/archive-ui-smoke.mts`
from `remix` with `TT_TRANSFER_UI_ORIGIN=http://localhost:<worktree-port>`.
Install Playwright and Chrome locally, or point `TT_PLAYWRIGHT_MODULE` at an
existing Playwright module. The test accepts loopback HTTP only, starts a fresh
browser context, supplies fictional history, blocks API mutations, and writes
screenshots to a temporary directory. It never copies browser credentials or
imports real account data. This does not replace live media/clipboard acceptance.

`corepack pnpm --dir remix run test:transfer-archives` adds a metadata-only
archive import/read/delete lifecycle check. Enable it with
`TT_TRANSFER_ARCHIVE_TEST=1` and the same origin/cookie variables, plus
`TT_TRANSFER_TEST_USERNAME` for the expected disposable fixture identity.
Remote dev origins require `TT_TRANSFER_REMOTE_DEV_TEST=1`; only
`https://dev.thingtime.com` or an exact `https://pr-N.previews.dev.thingtime.com`
origin is accepted. Production, lookalikes and implicit remote writes are
refused. The selected origin must advertise import 1.9.0 and Things 1.13.0
before any archive is created. The test uses fictional participants, verifies
full history and private reads, rejects individual-row mutation/deletion and
stale preview deletion, then removes only its returned archive root. No real
user, live-message, invitation, notification or upload APIs are called. This
test does not yet cover avatars, custom emoji, export or UI rendering; a skipped
or capability-blocked run is not live acceptance.

## Thingtime Widgets automatic releases

`.github/workflows/widgets-release.yml` publishes an Apple-silicon Widgets ZIP and
a matching Recovery ZIP after relevant changes reach `main`. Owner-only manual
dispatch is also restricted to `main`; PR code cannot reach its signing or publish
steps. This dedicated job pins the exact main SHA, runs native/Recovery tests before
importing signing material, and leaves the Electron repository-wide latest release
unchanged. The version comes from `macos/ThingtimeWidgets/project.yml`, with a
workflow build number and source SHA appended to the release tag.

Fork setup: enable Actions and configure `MAC_CSC_LINK` (base64 Developer ID P12),
`MAC_CSC_KEY_PASSWORD`, `APPLE_TEAM_ID`, and `APPLE_API_KEY_BASE64`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER` for notarization. The existing `ASC_KEY_CONTENT`,
`ASC_KEY_ID`, `ASC_ISSUER_ID` aliases are accepted. Store actual values only in
GitHub Actions secrets. A fork must also deliberately update the repository-owner
guard and Recovery's release-catalog origin. No Apple Development/ad-hoc fallback
is allowed for published production builds.

The workflow imports credentials into a temporary Keychain, signs nested widget
code before the app, notarizes and staples, then verifies both final ZIPs after
extraction. It publishes `SHA256SUMS.txt` and removes temporary signing material.
The `Thingtime-Widgets-App-Release-<version>-macos-arm64.zip` asset is recognized by
Recovery's **App → Thingtime Widgets** selector; its cache and install target are
isolated from Desktop, Commander and Recovery. Local bundle construction is not
proof of a successful cloud release: the first main run and download/install via
Recovery remain release acceptance checks.

## Gifted signup invitations

Signed-in personal accounts can create single-use invites in **Settings → Account →
Invite someone with a gift**. Choose a username, display name, optional avatar and
0–10,000 credits (six decimal places). The gift is deducted immediately and held
until signup. Cancelling an unused invite returns it; new links default to Never expire, with 1, 7, 30 or 90 day options. Pending links can be shown/copied later. Older hash-only invites offer an explicit replacement that invalidates the previous link while preserving the gift and expiry.
Up to 20 unused invites are allowed per account. Tokens are indexed by hash; a
recoverable copy lives in protected binary invite state and is returned only by
the owner-authenticated link action, never by list or preview. Closing an invite
deletes this state.

The `/invite#<token>` page lets the recipient keep or replace every suggested
profile field and choose their own password. Email is optional; supplying one
enables the existing email verification and password recovery flow. An invited
account receives its gift without another promotional starter grant. Invitations
do not grant admin status, Lopu verification or general upload permissions.

Fork setup uses the existing home MongoDB transaction support (a replica set),
canonical account/credit collections, rate limiter and configured moderation
provider. No new provider key is required. Set the existing `CRON_SECRET` in the
deployment secret store so Vercel's hourly `/api/v1/auth/invites/expire` job can
refund expired gifts, up to 50 per run; account visits also settle their expired
invites. Do not add a TTL index that deletes invitation records before refund.
The advertised contracts are `api.auth-invites@2.1.0`,
`api.auth-invites-expire@1.0.0` and `api.auth-register@1.3.0`.

Avatar upload is a narrowly scoped signup thumbnail: the browser crops an image
under 10 MB, then the server decodes, strips metadata, moderates and re-encodes a
128px lossless PNG of at most 80 KiB. The private control record holds this bounded
thumbnail until redemption, cancellation or expiry. It becomes the new user's
canonical profile avatar on signup; it never enables general attachment uploads
or accepts an arbitrary remote URL or another user's attachment ID.

Local validation for `codex/gift-credit-invites`: `http://localhost:11000`
(Vite), API `11002`, HMR `11001`, managed through `npm run web-pms`. The local
Tailscale CLI wrapper currently targets a missing Tailscale application, so no
Funnel URL could be configured or verified for this worktree.

### Mobile authentication and moderation recovery

Foreign previews use the authority published by `dataEnvironment` for same-tab sign-in. Deploy the `/authorize?self=1&redirect=1` frontend to that authority as well as the preview. Keep the existing SSO signing/issuer configuration consistent within each environment; never share production sessions with an unrelated development database. Return codes are single-use, origin-bound and carried in fragments.

Image review uses the Admin moderation selection and server-only `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` configuration. A short OpenAI throttle is retried once; persistent provider quota/auth failures require repairing that provider account or selecting another configured moderation provider in Admin. Logs expose only allowlisted status/code diagnostics. Never disable review to work around a provider outage. Invite drafts remain editable so the sender can explicitly remove the optional photo.

Recovery worktree QA uses Vite `http://localhost:13210`, Nitro 13212 and HMR 13211 through the canonical PM2 worktree-port resolver. Tailscale Funnel could not be verified on 2026-09-13: the installed CLI wrapper points to an absent `/Applications/Tailscale.app` executable.

### Recovery app sections and build dates

In Thingtime Recovery, use the App picker to choose Thingtime Electron, Commander,
Thingtime Widgets or Thingtime Recovery itself. Each section shows only that app's
cached builds and GitHub releases, even when a GitHub release includes several apps.

Build dates use the signed bundle's `ThingtimeBuildDate` ISO-8601 value (native)
or `Contents/Resources/web/metadata.json` `builtAt` (Electron). Native packaging
records the UTC timestamp before signing. Older builds use GitHub's publication
date, labelled **Released**, which is retained in the local cache for offline use.
A **Cached** date is separate and never presented as a build date. Builds without
recorded build/release metadata show **Build date unavailable**.

### Admin error logs

Current admins can open **Things → Error logs** (`/things?logs=1`) and search redacted failures by message, source, provider, route, code or request ID. Each record is a protected `error-log` Thing in the deployment's home database. Generic Things reads, writes, search, feeds and exports cannot expose or alter it. The admin endpoint rechecks current privileges on every request and disables caching.

No new provider credentials or external logging service are required. Forks need the normal home MongoDB setup and an admin account (see existing `ADMIN_USERNAMES` setup). Boot-time index convergence adds the shared home-only `things_ephemeral_expires_at` in place of the former diagnostic TTL; error-log reads reuse `{ thingtime, createdAt, shareId }`; give the existing MongoDB application role index-creation permission. Logs expire after seven days and do not consume account storage. No content migration is needed.

Captures cover shared `safeErrorText`, registered API unhandled exceptions/5xx responses, and OpenAI/Anthropic moderation failures. Records contain a closed, redacted error snapshot plus server-generated correlation metadata, never request bodies, cookies, authorization headers, images, or full SDK objects. Upstream request IDs and error types help distinguish throttling from account restrictions. Persistence is best effort: one-second deadline, five captures/request, five concurrent writes and 60 writes/minute per server instance. Console metadata remains when persistence is unavailable or capped; this is a diagnostic trail, not a complete audit ledger. Background paths should await `recordErrorLog` before returning. Do not pass user content as authored context fields.


### Background AI replies

Signed-in web clients negotiate `api.lopu-background-tasks` plus each operation's
capability before starting chat replies, voice transcript replies, musings or AI
completions. A same-origin SharedWorker submits and observes while tabs remain;
unsupported or failed workers use the same idempotent page transport. Nitro owns
inference from admission onward. Vercel `waitUntil` drains the canonical handler
after the last tab closes. Reconnection never makes a second provider call and
workers never receive provider credentials.

The Lopu drawer's **Background tasks** page shows running, interrupted and recent
operations, saved output, Stop and conversation links. Static rings show stages,
not estimated percentages. **Retry / Continue** submits a new explicit chat turn
asking Lopu to inspect saved tool receipts and current state first. It never
resubmits approval tokens. Closing a page detaches its observer; Stop requests
cancellation. A tool already committing may finish, with its receipt preserved.

Fork setup uses the normal MongoDB/auth/provider settings; no new secret or queue
service is required. Keep the canonical web build and Vercel output verification:
the generated server function needs 300 seconds. Replies stop at 240 seconds and
task collection at 260 seconds, leaving time for persistence/accounting. A killed
runtime becomes interrupted after its deadline; tools are never replayed
implicitly. This is bounded execution. Existing scheduled/recording workers keep
their lifecycle; live microphone capture and direct realtime audio still need an
open capture surface.

Task output is owner-private, origin/data-source-scoped secure BinData (2 MiB
maximum). Access expires after seven days; the next task read clears expired
bytes. The small immutable operation marker remains for deduplication. Normal
chat transcripts retain their existing lifecycle; lost/deleted conversation
access also prevents reading task output.

This branch's disposable local QA uses the normal worktree PM2 stack at
`http://127.0.0.1:14700` (HMR 14701, Nitro 14702). Never point
`LOPU_CHAT_PROVIDER=test` at real account data: its scripted tools make real
writes. `LOPU_TEST_PROVIDER_PACE_MS=150` slows disposable fixtures for tab-close,
Stop and recovery checks.

Funnel status for this QA worktree is unavailable: the installed `tailscale`
wrapper targets a missing Tailscale.app executable; no mapping was changed.
### Feed algorithms and geographic Things

The feed offers Hot, New, Top, Rising, Controversial, Local, Global and Political.
`/algorithms` searches the explicitly published directory and creates private learning profiles.
Sharing a link and publishing are separate choices; neither exposes the stored Thing or raw weights.
Branching copies the learned interests and always starts private.

Things accept optional `geo: { "lat": -37.81, "lng": 144.96 }` on POST/PUT/PATCH;
`null` removes location. Only finite latitude -90..90 and longitude -180..180 are accepted.
The server derives an indexed GeoJSON Point; normal ACLs govern its lat/lng projection.
POST `/api/v1/things/search` accepts `near: {lat,lng}` and `radiusKm` (default 50, max 1000).
Local uses browser location only after an explicit button press, without adding it to posts;
a location tag works without granting permission. No geocoding provider or secret is required.
The normal MongoDB index bootstrap creates `things_geo` on first use.

Algorithm development worktree: localhost port 13480 (HMR 13481 / Nitro 13482).
Tailscale/Funnel is unavailable on the validation machine: its CLI points to an absent Tailscale.app.

### Lopu uploads, attachment contents and HTTP SDK

Interactive owned components can render the native upload control with HTML
`{"tag":"tt-upload","props":{"name":"photo","imageOnly":true}}` or Chakra
`{"chakra":"Upload","props":{"name":"photo","imageOnly":true}}`.
`imageOnly` is optional; omit it for general files. After selecting a file,
**Use file** saves a private attachment through the standard attachment APIs and
writes the form fields `photo` (an authenticated content URL) and
`photoAttachmentId`. **Use URL instead** exposes the linked-media option.
Clearing a field does not delete its saved file. Shared/read-only component runs
cannot upload. Existing upload approval, account storage quota, moderation and
attachment ACL checks apply; a form value never grants public access.

Lopu forwards actual supported image, PDF and UTF-8 text contents to the selected
AI provider, including recent chat attachments and explicitly selected attachment
Things. It rechecks access before disclosure. Limits: ten files, 5 MiB per binary
file, 128 KiB total text, and 12 MiB total per turn. Linked media, unsupported
formats (including audio/video), oversized and unavailable files are explicitly
reported as unread. The selected provider/model must support the supplied media;
Lopu does not silently switch providers or put signed storage URLs into history.

First-party browser code can import the capability-negotiated SDK:

```ts
import { lopu } from '~/sdk/lopu.client';
const page = await lopu.fetch('https://example.com'); // status, contentType, body
const data = await lopu.json('https://example.com/data.json');
const result = await lopu.request({
  url: 'https://example.com/records', method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Example' })
});
```

The SDK uses same-origin `POST /api/v1/lopu/network` (`api.lopu-network@1.0.0`)
on Nitro/Vercel. It requires a full signed-in account with Lopu access (or the
`lopu.chat` scope), enforces the Lopu rate limit, and does not forward Thingtime
cookies. External requests use public HTTPS on port 443, a 15-second deadline,
DNS-pinned public addresses, a 32 KiB request body and a 256 KiB text/JSON response.
Redirects, compressed/binary responses, private networks and automatic retries
are refused. Only explicitly supplied supported headers are sent. Keep provider
secrets in server-side vault code, never in component JSON or browser bundles.

Lopu itself has `fetch_url` for public reads and `http_request` for an exact
method/URL/headers/body request that requires its Confirm card. Authored JSON
components remain scriptless; the SDK is for first-party application code.
Fork setup uses the existing attachment storage, moderation and Lopu account
configuration documented above. No new gateway key is required. Configure any
external API credentials in the fork's own vault, using placeholders in docs.

Validation checkout `lopu-attachments-sdk-mobile` uses local web/HMR/API ports
15420/15421/15422: http://localhost:15420/lopu. Its Tailscale/Funnel URL is
unavailable: the installed `tailscale` launcher points to a missing
`/Applications/Tailscale.app` binary. No existing Funnel mapping was changed.

### Legal documents

Public directory: `/legal`. Current documents: `/pages/privacy-policy`,
`/pages/apple-tv-privacy-policy`, `/pages/terms-of-service`. Append the version
(e.g. `/1.0.0`) for a permanent edition. `/privacy` and `/terms` redirect to
the current documents. The registry is `remix/app/legal/documents.ts`; preserve
published entries and add a new version when changing policy text, marking the
previous edition archived. Do not rewrite a published version. Legacy website
and merchandise text is retained as explicitly historical material.

Copy text and Download .txt use the same registry as the reader. Copy public URL
always exports `https://thingtime.com`, including on previews. Fork operators
must replace operator/contact details, verify their actual data practices and
change that canonical origin before publishing their own policies. No private
configuration or credentials are needed for these pages. App Store Connect
requires separate App Privacy disclosures in addition to policy URL/text.

Legal-page development worktree: local `http://localhost:18460` (Nitro 18462,
HMR 18461). Public preview is delivered through the branch Vercel deployment;
check the PR deployment status for its current URL.

### Upload admission and local regression checks

Attachment starts use the shared admin rate-limit policy (default: 60 per minute
per account). The exact persisted legacy 30/hour default is upgraded on read;
custom/disabled rules are retained. A subsequent admin save records the policy
version, so explicitly setting 30/hour again remains possible. The browser honors
`Retry-After` for at most two retries of at most 60 seconds each, keeping the same
request identity; longer/persistent limits retain the selection and show the wait.
Upload approval, storage accounting and moderation still apply independently.
Run `pnpm --dir remix test:attachments`, `test:rate-limit`, and
`test:api-capabilities` after changes to upload admission.

The upload-regression worktree uses `http://localhost:19800` (HMR 19801, Nitro
19802), derived by `npm run web-ports`. Tailscale/Funnel could not be configured
on 2026-09-16: the installed launcher points to a missing Tailscale app.


### Lopu continuation development

Lopu has no fixed tool-count, step-count, continuation-count, or task-duration cap.
On Vercel, completed tool batches checkpoint between hosting windows; large
streams also checkpoint before continuing with a fresh request ID. The browser
continues persisted checkpoints while the app is open, retaining chat/model and
completed-work receipts. Background jobs renew a worker lease instead of stopping
a healthy job on a timer. An uncertain provider/write failure remains a manual
recovery boundary. Closing every app tab can leave a saved checkpoint awaiting
return to the conversation; this is not a durable cross-window workflow runner.
Provider transport, context, platform billing and authorization constraints still
apply. No new private configuration or credentials are required.

Regression fixture: `http://localhost:16650/scripts/lopu-continuation.browser.html`
(worktree `thingtime-lopu-auto-continue`; HMR 16651, Nitro 16652). It runs the
production store/composer with synthetic responses, including 17 continuations
and Stop. The Tailscale/Funnel URL could not be configured: the installed wrapper
references a missing `/Applications/Tailscale.app/Contents/MacOS/tailscale`.
## Social previews and search metadata

The Nitro shell automatically serves Open Graph/Twitter metadata, canonical
URLs and safe Schema.org JSON-LD from anonymous public projections. See
[the metadata runbook](docs/seo-social-metadata.md) for validation, crawler
cache diagnosis, fork setup and the broader SEO/rich-results TODO.


### Lopu message queue

While Lopu replies, **Queue** (or desktop Enter) adds another message without
stopping the current task. Hold a queue handle to drag, or use the up/down arrows.
**Send together** is checked by default: consecutive checked messages with the
same model, page and media context become one prompt in order, with one reply.
Unchecked messages wait for their own reply. The 8,000-character request limit
also creates a batch boundary. Pause/Resume controls automatic delivery.

**Send now** saves a text note immediately. The active task reads it after its
current provider response/tool batch, without interrupting or replaying tools.
A note arriving after the last boundary remains in history for the next reply.
Attachments and selected Things use Queue or a normal send; notes never grant
extra tool permissions.

Queues are private to this browser tab and account, survive reload in session
storage, and restore paused for review. Keep the tab open for automatic queued
sends; already accepted background tasks continue independently. Retries preserve
operation IDs and frozen payloads. Stop pauses queued delivery too.

Queue development: `npm run web-pms` in the `thingtime-message-queue` worktree
uses `http://localhost:18900` (HMR 18901, Nitro 18902). Public Tailscale/Funnel
verification is unavailable on the development host because its installed CLI
launcher points to a missing Tailscale app; no public mapping was changed.


### Builder component SDK

Start at `/docs/builder` (also reachable from `/builder/docs`) for forms, Data
Things, uploads, source bindings, external lookups and troubleshooting. The same
reference feeds Lopu's builder instructions. Native `tt-upload` / Chakra `Upload`
controls require an interactive owned page, sign-in, upload approval, storage
quota and the attachment service configuration described above. Use file commits
a private attachment; the form action must save both its URL and attachment id.

Google Maps address lookup is opt-in. Enable the Geocoding API and billing in your
own Google Cloud project, restrict the key for your server usage, and save the key
as a **secret in your own Vault**. An owned action references only the Vault entry
id with `lookup`, provider `google-geocoding`, and an explicit provider capability.
Never place the actual key in a component, action, frontend environment variable,
source control or prompt. The server needs the existing Vault encryption setup;
Google needs no shared project-wide API key. See `/docs/builder/lookups` for the
complete example, attribution, limits and storage-policy links. Other providers
require a registered server adapter; authored arbitrary fetch URLs are unsupported.

Local regression fixture: `/scripts/builder-sdk-regression.html` on a Vite dev server.
It uses production renderers with synthetic file/API transport, makes no external
provider requests and persists no user data. Run `node remix/scripts/verify-actions.mjs
http://127.0.0.1:<nitro-port>` only against a disposable database: it creates test
accounts and data. Provider-positive unit tests use synthetic Google responses;
a real credential and configured object storage are required for live integration
acceptance.

Builder SDK QA worktree mapping: web `http://localhost:14870`, HMR `14871`, API
`14872`; docs `http://localhost:14870/docs/builder`. Tailscale/Funnel was unavailable
on 2026-09-18 because the installed CLI shim referenced a missing application
binary. Other worktrees derive their own ports via `npm run web-ports`.

The reusable record controls and browser Action protocol are documented at
`/docs/builder/record-controls` and `/docs/builder/browser-flows`. `tt-map`
accepts a **browser** Maps JavaScript API key restricted to the exact website
origins and API in your Google project. This public browser key is distinct
from the server-only Vault credential used by `lookup`; never substitute the
server credential. Maps are optional and missing setup is shown explicitly.

An opt-in local composition fixture exercises ordinary saved Components and
Actions through the real API. It does not migrate existing pages. Start a
disposable local replica-set database and the PM2 worktree stack first; register
a fixture user through `/api/v1/auth/register`. Save its API session response
as a private, untracked JSON file containing `cookie` and `user.id` (mode 0600).
Then, from `remix/`, run:

```sh
TT_BUILDER_QA_ORIGIN=http://127.0.0.1:<web-port> \
TT_BUILDER_QA_SESSION=/private/path/to/local-fixture-session.json \
node --import tsx scripts/test-builder-app-local.ts
```

The script refuses non-loopback origins and uses stable `qa-*` fixture IDs.
Open `/p/qa-editable-builder-page` for records and
`/p/qa-reference-page` for 181 searchable reference choices. For real file QA,
use the local attachment storage setup above and enable fixture uploads through
the normal local admin flow. Only use this fixture against disposable data.
The 2026-09-23 editable-app checkout uses `http://localhost:17120`, HMR 17121,
Nitro 17122, and its disposable Mongo replica set on 17123. Tailscale/Funnel
remains unavailable: the installed shim points to a missing Tailscale app.


### Chat continuity and iOS activity (2026-09-21)

Lopu's send menu and chat settings choose browser-managed or server-managed
continuation. Browser management requires an open page to start the next safe
checkpoint; server management uses the existing Workflow SDK 4.8 integration
and requires Vercel Workflow enabled for the selected Vercel project. It uses
the normal account database and a live full-user session. Selected custom
MongoDB connections use browser management; their credentials are never copied
into workflow state. Session revocation stops a server chain. Recoverable
errors back off, with five consecutive retries before requesting attention;
manual Stop, incomplete tools, pending confirmations and unsaved page edits
never automatically resume. Continuations retain the current conversation
without displaying synthetic user prompts.

The iOS app displays one aggregate chat Live Activity with counts and generic
status. A Live Activity does not prevent iOS suspension: server-managed work
continues independently. Existing private APNs setup uses `APNS_KEY_ID`,
`APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and optional `APNS_IOS_BUNDLE_ID`; its topic
is `<bundle-id>.push-type.liveactivity`. Keep values in the existing private
deployment configuration. Native clients negotiate `api.lopu-live-activity`
1.0.0; protected tokens are bound to a live session, origin and data source.
See [iOS setup and device checklist](iOS/README.md). No additional signing
credentials are introduced by this feature.

The continuity worktree validation server uses
`http://localhost:19940` (Vite), 19941 (HMR), and 19942 (Nitro), with the local
PM2 ecosystem override `remix/tmp/continuity-ecosystem.config.cjs`. Its unique
`tt-wt-continuity-19940` identity avoids the existing worktree basename
collision. No Funnel URL was verified: the installed Tailscale wrapper points
to a missing app executable on the validation machine. Production/deployment
URLs remain recorded in the project's deployment documentation.


### Functional component and webpage demos

The demo catalog uses native inputs and owner-scoped Actions. Newsletter/contact
forms, site requests, and component records save private Things. They do not
send email, charge cards, book services, or control devices. To add an external
effect, create an integration Action in your account, configure its credentials
through the normal connection settings, and bind the copied component to that
Action. Never put credentials in component arguments or template JSON.

`site-forms` and `catalog-records` are installed through
`POST /api/v1/webpages/suites/install`; clients require
`api.webpages-suites-install >= 1.1.0` from the selected origin's manifest.
Copying a site demo installs missing form dependencies first without replacing customized Actions. Installed pages bind their owner’s concrete component ids. Existing installations
can be refreshed with the suite's Install button; saved records remain intact.
A fork needs the ordinary database/session setup described above. No external
service key is needed for private demo records. Admins refresh system demos via
`POST /api/v1/admin/webpages/seed-demos` after deploying the updated catalog.

The declarative `$ui` binding changes bounded scalar state only in its current
component instance (`set`, `toggle`, `increment`, `cycle`, `reset`), copies text,
or opens Thingtime search. It cannot call arbitrary JavaScript or replace the
runtime's viewer, query, source result, or account authority. `$ui` fields remain
controlled so Reset and adjacent buttons also update visible inputs. Ordinary
Action fields retain native editing and validation; Enter submits their group.

Local regression fixture: `/tests/functional-demos.html` on a Vite development
server. Verify two-instance isolation, parent renders, typed values, checkboxes,
range/counter synchronization, reset, native disclosures, and mobile overflow.
Native `tt-dialog` controls use browser-managed modal focus and Escape dismissal;
`tt-countdown` accepts a bounded seconds value and provides Start/Pause/Reset.
They run only on interactive surfaces and never execute authored JavaScript.
## Remote integration runtime

Curated integration examples use `remix/app/library/catalog.ts` and the fixed
provider request registry in `apis.ts`. The runtime is delivered before the
catalogue; an empty registry intentionally offers no executable examples.
Only registry IDs and JSON inputs can enter the `IntegrationExample` component.
Arbitrary persisted JavaScript, package URLs, and credentials are not accepted.

`corepack pnpm --dir remix run build:client` builds the application, the isolated
`/library/runner.js`, and the embed bundle. The normal dev command builds and
watches the isolated runner too. Custom deployments must serve
`/library/sandbox.html` with `librarySandboxCsp` from `remix/scripts/csp.mjs`;
the Vercel build and Vite middleware apply it automatically. Do not apply the
sandbox policy to the main application shell.

Remote packages load from pinned esm.sh URLs only on Run. Pure transformations
run in terminable workers; visual packages run in an opaque-origin sandbox.
The frames cannot access Thingtime cookies or storage. Keyless APIs must allow
browser CORS; provider outages and rate limits remain visible errors.

Credentialed examples require the fork's normal account/session and MongoDB
rate-limit setup. No shared provider secret or new deployment environment
variable is required: each visitor enters their own key in the open component.
Keys remain in component memory, travel over HTTPS to the authenticated
`POST /api/v1/library/request`, and are forwarded only to a registered provider
using a read-only GET with redirects disabled. Keys and live results are never
saved in copied Things. Account changes and unmounting discard key state; the
Clear button removes it immediately. Use provider-scoped keys; Stripe examples
accept test-mode keys only. Fork operators must preserve request-body privacy
in their own reverse proxies and observability tools.

Clients negotiate `api.library-request` 1.0.0 against the selected origin before
credentialed requests. The endpoint is bounded to 20 requests/minute/account,
24 KiB request bodies, 16 KiB inputs, 256 KiB upstream responses and a 12-second
upstream timeout. Run `corepack pnpm --dir remix run test:library` for boundaries,
credential redaction, reusable Thing validation and capability coverage.

### The integration library

Browse `/library` for 540 executable recipes across 51 libraries/services: 380
transformation actions, 59 visual components and 101 API Things. There are 468
credential-free examples and 72 examples with provider-specific credential entry.
Search, category/provider/type/access filters and pagination keep the catalogue
small on screen; selecting a card shows editable inputs, live output, source and
links to official docs. Browsing performs no integration-provider requests.

Save a private copy to create sample data, an input-preparation Action Thing and
a runnable Component Thing. Add `IntegrationExample` to builder markup with a
curated `exampleId` and optional `inputJson`; it never accepts code or keys in
markup. Preparation actions return inputs; remote execution occurs when Run is
pressed in the component. Keys are entered separately for each open demo.

API capability `api.library-request` 1.2.0 adds the curated credentialed provider
registry. Each provider's account link explains its key and access requirements.
Credentialed server examples use read-only GETs and fixed Google Places POST searches; Stripe is test-mode only. Real
account authorization/quota behavior requires the visitor's own valid key.

For browser acceptance, open `/scripts/library-browser-check.html` on the Vite
dev server and press **Run all public examples**. The harness executes only
credential-free catalogue defaults, four at a time, through the actual isolated
runner. `?ids=example-id,another-id` limits a rerun. This development-only harness
is not copied into production static assets. Provider outages can change results.


## Remote device files and brightness

Open **Things → Browse files**, or expand **Files** in a paired device's drawer.
The shared Things grid/list, type/name filters and action menu work in a full
page, narrow dock and expanded pop-up. Copy or Cut, select **Your Thingtime** or
another paired device and destination folder, then Paste. Keyboard shortcuts
work while the file browser is focused; text inputs keep normal text editing.

Update the Mac's Thingtime Node as well as the web server. An updated heartbeat
refreshes the existing device's capabilities; re-pairing is unnecessary. The
native brightness adapter supports DisplayServices and falls back to a matched
IOKit display, reporting unavailable when macOS exposes no usable control.

Remote files stay inside the paired Mac's home folder and obey its existing
permission mode and locked-session policy. Files are bounded to 32 MiB each;
a recursive browser transfer supports 500 entries, 32 levels and 128 MiB total.
Symlinks, special files and overwrite are refused. Moves across locations copy
and verify first, then remove originals; remote removals use recoverable Trash.
Thingtime uploads require existing private-upload access and storage allowance,
and use the normal protected attachment pipeline. Empty remote files can be
read/copied on devices; Thingtime's upload pipeline requires non-empty content.
No new secrets or environment variables are required. Forks need their existing
MongoDB, S3 attachment setup and pairing configuration, plus the API capability
versions documented in [the remote file contract](docs/remote-files.md).

Local acceptance for `codex/remote-device-files` uses `http://localhost:22420`
(HMR 22421, Nitro 22422), with a unique PM2 entry
`tt-wt-remote-device-files-22420` using the canonical `pm2AppConfig` and
`autorestart: false`. These overrides avoid another Codex checkout with the same
`thingtime` directory basename. Tailscale/Funnel was unavailable on 2026-09-21:
the configured launcher points to the missing Tailscale app; no public mapping
was changed or verified.

### Integration builder library

The integration catalogue also has real builder pages: `/builder?page=webpage-integrations&mode=view` links to a page per provider, and each example has its own page and reusable component. The pages derive from `remix/app/library/builderPages.ts`, so adding a catalogue example updates the hierarchy without hand-maintained copies. Opening a page does not run its third-party requests. Saving edits creates an owner-private page; keys and live results stay in the open demo and are never saved.

On a new deployment, configure your normal database and an admin account (see the admin setup above), then sign in as that admin and select **Prepare builder pages** on `/library`. The button negotiates `api.admin-webpages-seed-demos` 1.2.0 and calls `POST /api/v1/admin/webpages/seed-demos?catalog=integrations` with `{}`. This idempotently seeds only the integration components and pages, leaving other demo suites untouched. Re-run after catalogue updates; investigate any nonzero `skipped` count before linking to the pages. No third-party credentials are needed for setup. Viewers supply their own credentials when running keyed examples.

### Map and platform examples

Mapbox includes five GL JS components plus forward/reverse geocoding and driving/walking directions. Google Maps includes maps, advanced markers, info windows, polylines and radius circles. Google Places includes text/nearby search, place details and autocomplete with first-result selection in the JavaScript SDK, plus three Places API (New) REST examples. YouTube, Spotify, Microsoft Graph, GitLab, Cloudflare and Contentful add focused platform reads. Their new components and builder pages are included by **Prepare builder pages**.

Use two distinct credential types:

- Browser demos accept a Mapbox **public** `pk…` token or a Google Maps browser API key. Restrict the key to your actual website origin (include your preview host or localhost when testing) and the necessary APIs. Enable Maps JavaScript API, Places API (New) when applicable, and billing. Google advanced markers use `DEMO_MAP_ID`; use your own map ID in an application. Mapbox GL JS loads a pinned official CDN release; Google uses its supported quarterly channel. Browser keys go directly to the selected provider inside an opaque-origin frame. The SDK document has its own CSP; Google SDK compatibility does not loosen the app shell or ordinary package sandbox policy.
- REST examples use dedicated server keys or short-lived OAuth **access tokens**, entered in the example's password field. Website-referrer restrictions do not apply to server requests. Use provider/API restrictions and least-privilege scopes: Spotify catalog access; Microsoft Graph `User.Read`, `Files.Read` or `Calendars.ReadBasic`; GitLab `read_api`; Cloudflare Zone/DNS Read; Contentful delivery (not management) access. Use the example's account/docs links for acquisition and provider-specific setup. No OAuth client secret, automatic token exchange, or refresh token is needed or accepted by these examples.

No keys are bundled or stored with copied Things. **Clear**, reset, account changes and leaving the demo discard credentials; Clear/reset also remove running SDK frames. Provider keys, billing, quotas, development-mode access and third-party availability determine whether a live request succeeds. The tests use provider contract fixtures; they do not claim authenticated access to a visitor's account.

The maps-library development worktree uses Vite `http://localhost:18860` (HMR 18861, Nitro 18862) through its local PM2 ecosystem entry `tt-wt-library-maps-platforms-18860`, with autorestart disabled. Tailscale/Funnel is not available on this machine because the Tailscale application is missing; production and Vercel previews remain available.

### Discussion pagination on forks

Private comment pagination uses the deployment’s existing `JWT_PRIVATE_KEY` or
`JWT_SECRET` (with `THINGTIME_ADMIN_VAULT_KEY` as a fallback) to derive a separate
encryption key for opaque cursors. Configure one of these existing secrets in
both preview and production deployments; never use a public JWT key. No new
secret variable is required. Production fails closed with HTTP 503 when none is
configured. Local development without a configured secret uses an ephemeral
key, so refreshing comments after a server restart starts a new cursor chain.


### Reusable local video tools

Install **Local video tools** (`media-tools`) from Builder's app suites on an
origin advertising `api.webpages-suites-install >= 1.4.0`. The normal installation
creates private, owned Page, Component and Action Things. Its `tt-web-platform`
program stores the document, CSS, selectors and editable encoding settings;
**Save edited component** persists the edited program and current defaults for
reuse. Neither the selected file nor the output bytes are saved by this Action.
See `/docs/builder#local-media` for the declarative contract and capability
inspection guidance shared with Lopu.

Encoding runs on the selected device through WebCodecs and the pinned
[Mediabunny 1.61.6 source](https://github.com/Vanilagy/mediabunny/tree/v1.61.6).
Its unmodified source is MPL-2.0; the shipped notice is at
`/platform/mediabunny-LICENSE.txt`. No FFmpeg service, provider key, upload,
external request or additional secret is required. Existing account/database
configuration is only needed to install or save reusable Things. HTTPS (or
localhost) and browser codec support are required. MP4 uses H.264/AAC; WebM uses
VP9/Opus. Unsupported sources or codecs produce an error, including unsupported
audio rather than silently dropping it. Only primary video/audio are retained;
extra tracks, subtitles and metadata are omitted. Output can be larger than input;
the receipt reports actual byte counts. Large files depend on available memory.

The fixed encoding worker runs on the secure host because opaque iframes cannot
access WebCodecs. The editable document remains in its opaque sandbox. The host
validates file messages against that frame and run, resolves settings from its
validated saved program, and terminates work on cancel, replacement or unmount.
Custom hosts must serve `/assets/mediaWorker-*.js` with `mediaWorkerCsp` from
`remix/scripts/csp.mjs` (no network or child workers). Vite and Vercel configure
this automatically; `verify:vercel-output` asserts the worker and scoped header.

Browser regression on macOS: install FFmpeg/ffprobe, a task-owned Chrome for
Testing binary and Playwright outside the repository. Set `PLAYWRIGHT_MODULE`
to its module and `CHROME_FOR_TESTING_PATH` to that binary, then run:

```sh
cd remix
npm run build:platform
node scripts/media-acceptance/build.mjs
env -i HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" PLAYWRIGHT_MODULE="$PLAYWRIGHT_MODULE" CHROME_FOR_TESTING_PATH="$CHROME_FOR_TESTING_PATH" /usr/bin/sandbox-exec -f scripts/media-acceptance/network.sb node scripts/media-acceptance/check.mjs
```

The test owns loopback port 18641 only for its duration and closes its server and
fresh browser afterward. It has no API backend, account or database. OS egress
is denied except that loopback port; direct-IP, redirect and browser probes
must demonstrate the boundary before acceptance proceeds. There is no permissive
fallback. Screenshots, trace and independently probed media stay in ignored
`remix/tmp/media-acceptance/`. Other operating systems need an equivalent verified
OS/container egress boundary before running this acceptance test.

### Web standards Builder app

The worker-compatible Web API recipes include URL members, headers/query/form
collections, blobs/files, response bodies, encoding, DOM exceptions, geometry,
events/abort signals, streams and their controllers. Stream examples include
backpressure, BYOB reads, text encoding across chunk boundaries and compression.
These are editable Component program definitions using in-memory receivers.
Audit that family with `TT_STANDARDS_AUDIT_LANGUAGES=webapi` and the runtime audit
setup below; it needs no account, permissions or external request.

The reusable `web-standards` suite is installed for the signed-in account using
`POST /api/v1/webpages/suites/install` with
`{"key":"web-standards","onlyMissing":true}`. Open the returned `entryPageId`
in Builder, or visit `/p/web-standards`. Normal database/auth configuration is
required; no new external credentials are needed. Installation creates private
Things and does not change another account. Use a first-party account session;
never place session cookies or tokens in a saved page, Component or repository.
Explicit reinstall without `onlyMissing` refreshes suite definitions.

The inventory is a checked-in standards snapshot, so running the app does not
fetch specification sites. To refresh it, install the pinned extraction tools
outside the repository and run:

```sh
npm install --prefix /tmp/tt-standards-tools --ignore-scripts @webref/css@8.7.5 @webref/elements@2.9.0 @webref/idl@3.84.0
node remix/scripts/sync-web-standards.mjs --tools=/tmp/tt-standards-tools/node_modules
corepack pnpm --dir remix run test:web-platform
```

Review source/status and coverage changes before committing the generated
inventory and manifest together. The snapshot includes drafts and internal
specification clauses; many entries still need interactive recipes. It does
not claim completed coverage of every standard or API. See
[the app's data model and runtime](docs/web-standards-builder.md). The ordinary
client build and PM2 dev lifecycle build the isolated runtime automatically. Both
`/platform/runtime.html` and `/platform/runtime.js` must retain `no-store` on
custom hosting/CDNs. The built HTML uses the runtime's content digest in its
script URL; publish that generated HTML and matching JS together. Do not replace
it with the unbuilt public template or strip its query version.

Language examples also contain editable class/function definitions, generators,
private/static fields, accessors, inheritance, template literals/tags and
control-flow nodes. All use the same reusable program primitive. Interface
inspection reports accessor presence without invoking it; paths crossing an
accessor require a receiver-specific demo. No new credentials or permissions
are needed for these in-memory examples.

To audit default JavaScript example execution, start the managed local stack
and use an installed Google Chrome plus Playwright (it may be installed outside
the repository). No account or database is used by this read-only audit:

```sh
TT_STANDARDS_TEST_URL=http://127.0.0.1:<web-port> \
TT_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
TT_STANDARDS_AUDIT_OUTPUT=/tmp/standards-audit.json \
corepack pnpm --dir remix run audit:web-platform
```

The report separates unavailable browser/context features from program errors.
An empty selection, program error or exhausted frame-load retry fails the audit.

For runtime-only verification after `corepack pnpm --dir remix run build`, use
`TT_STANDARDS_AUDIT_BUILT=1` in place of the test URL. This ephemeral test fixture
serves the built HTML and JavaScript with their canonical CSP, needs no running
app server and closes after the audit. Use an explicit HTTPS preview URL for a
hosted runtime audit.

The opt-in `HtmlTemplateField.browser.test.ts` regression needs only
`TT_PLAYWRIGHT_MODULE`; it bundles the real field component into an intercepted
Chrome fixture without account data. For the complete browser/API flow, use
`remix/scripts/check-web-standards-browser.mjs` with an explicit local
`TT_STANDARDS_TEST_URL` and `TT_STANDARDS_TEST_DATABASE_HOST` pointing to a
disposable database. Set `TT_STANDARDS_TEST_BUILT_CLIENT=1` after a full build to
serve public built client files inside the browser test while keeping API calls
on that local stack. An optional `TT_STANDARDS_TEST_SESSION_FILE` must be an
ignored, private file belonging to that same local origin; never use production
credentials for these fixture writes.

### macOS voice input setup

The desktop app's Lopu microphone uses Apple's Speech framework through the
bundled signed helper; no cloud API key or private dashboard configuration is
needed for standard device transcription. Build and install using the
[Electron workflow](electron/README.md), then press the microphone and allow
Microphone and Speech Recognition when macOS asks. Re-enable denied access in
System Settings → Privacy & Security. On-device recognition is preferred where
the language supports it; Apple's service may be used otherwise.

### Account drafts and templates

Signed-in post, comment, Thing, definition and schema editors save private
working drafts to the account. The post composer has **Load drafts & templates**;
post menus offer **Save as template**. Loading a template creates an editable copy
and keeps the template. The picker includes an automatic account-resume preference;
local device recovery stays enabled. Offline changes sync when connectivity returns.
The 512 KiB editing-snapshot limit is separate from attachment byte quotas.

No new secret or deployment variable is needed. Forks need the normal authenticated
MongoDB setup **with transactions/a replica set** and the existing private attachment
storage configuration for uploaded files and independent template media copies.
The development-only `THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR` stand-in and fixture
upload approval flow above support local verification; never configure the local
stand-in on Vercel. Use placeholder values in shared setup files.

Create a disposable fixture with `seed-fixture.mjs`, then run
`node remix/scripts/verify-account-drafts.mjs remix/.fixtures/<name>.json --media`.
Fixture JSON contains test credentials and stays ignored. The verifier exercises
only the real local API. Existing device Thing data/preferences are retained and
copied once to the first opening account; later accounts use separate device
workspaces and draft caches. Hydration alone does not upload that legacy data.


### Lopu Action access QA

Lopu's per-chat Ask/Full modes require no new deployment secret. Existing
first-party sessions, Mongo transactions and the Lopu provider setup still
apply. For an isolated verification without model billing:

1. Start a disposable loopback Mongo replica at port `22563`, replica set
   `lopuActions`, with a new empty dbpath. Do not point this check at shared data.
2. Use the canonical PM2 app definition with an isolated process name and
   `TT_WEB_PORT=22560`, `TT_HMR_PORT=22561`, `TT_API_PORT=22562`.
   Set `MONGODB_CONNECTION_STRING=mongodb://127.0.0.1:22563/?replicaSet=lopuActions`
   and a fresh local-only `JWT_SECRET` on both the app and script; unset
   `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` for this disposable stack. No production
   credentials or provider keys are required.
3. From `remix/`, run `TT_LOPU_ACTIONS_LOCAL=1 node --import tsx
   scripts/verify-lopu-actions.mts` with the same Mongo/JWT environment.
   The script refuses any other Mongo URI, creates synthetic accounts and data,
   and revokes its login at completion. Stop the named QA PM2 processes afterward.
4. Open `/scripts/lopu-actions.browser.html` on the QA Vite origin for the
   production composer's isolated desktop/phone fixture.

This checks runtime and storage behavior, not live provider reasoning or
production gear migration. See [Lopu Action access](docs/lopu-action-access.md).

### No-login native draft preview and export

Use **Builder → No-login draft preview** (`/draft-preview/index.html`) for
in-memory editable JSON previews and canonical downloads. The local stdio MCP
server exposes `thingtime_render_and_export`, returning desktop/mobile/card
PNGs and JSON as inline resources without an account or HTTP access from the
agent host. No private environment variables are needed. See the
[fork-safe setup, actual tool connection, bounds and disposable importer QA](docs/no-login-draft-preview.md).


### Automatic AI model catalogue sync

Thingtime refreshes the server Anthropic and OpenAI model inventories daily at
03:23 UTC (`/api/v1/ai/models/sync` in the root `vercel.json`). Set a random
`CRON_SECRET=<random-secret>` in the deployment environment; Vercel sends it as
`Authorization: Bearer <random-secret>`. Outside Vercel, schedule that authenticated
GET once daily. A missing secret refuses the job. MongoDB must support transactions
(replica set / Atlas), as with other home control-plane mutations.

OpenAI discovery uses `OPENAI_API_KEY` (and optional `OPENAI_ORG_ID`,
`OPENAI_PROJECT_ID`, `OPENAI_BASE_URL`). For Anthropic model discovery, configure
`ANTHROPIC_MODELS_API_KEY=<models-api-key>` in the server deployment environment.
If absent, an existing `ANTHROPIC_API_KEY` is used for catalogue reads only. These
keys are never passed to Claude inference, which continues using the isolated
Claude Code runtime and its admin-vault OAuth credential.

Without either discovery key, or when the Models API denies catalogue access
(401/403), Thingtime reads Anthropic's public [model lifecycle table](https://platform.claude.com/docs/en/about-claude/model-deprecations).
This works without an API key or paid Claude subscription, even when inference
is not configured. Public records carry `catalogSource: "public-docs"`,
`catalogCheckedAt`, and `publicCatalogAvailable`; they do not set or overwrite
credential-scoped `providerAvailable` / `lastSyncedAt`. Only an explicit Retired
row hides a public model; omission from a documentation page never retires it.
The admin UI labels public metadata as account-access unverified. A free Claude
account does not gain inference access merely because a model is listed.

Malformed, empty, redirected, oversized or timed-out documentation responses
preserve the prior catalogue. API network/server failures also preserve it.
Claude Code's initialization list is not authoritative discovery.
Personal Secure Vault endpoints have their own configuration and do not alter
the shared catalogue.

Admin → AI Providers → **Sync model catalog** runs a manual refresh. Provider
model-not-available errors also request a refresh, without replaying the failed
turn or silently changing its model. A shared five-minute cooldown and two-minute
lease prevent concurrent requests from hammering providers. Inspect the per-provider
sync report/status to distinguish success, failure and skipped/cooling-down jobs.

**Allow all current models** changes the existing compatible model toggles for that
provider. **Auto-allow new models** defaults off and controls newly discovered
compatible chat models; it preserves individual disable choices on subsequent
syncs. Unsupported model types remain recorded but are not offered for chat.
New model versions use conservative provider-default reasoning/standard speed;
pricing and context limits remain unknown until explicitly supported. Unknown
pricing remains `priced: false` in usage accounting; it is never presented as a
provider price of zero. Admins should consider this before enabling auto-allow.

A complete authenticated provider snapshot atomically marks absent models unavailable, retaining
their records and admin choices. The public catalogue and shared model selectors
only offer enabled, available models. Admin retains all compatible rows for audit.
The workflow order selector uses those live models, including discovered versions.
From AI workflow model order, **Save & apply** saves the named waterfall and then
persists the shared model order before closing. If either save fails, the dialog
stays open with an error; retry updates an already-created waterfall rather than
creating another copy. **Apply waterfall** still stages the order for the separate
**Save model order** button; **Save waterfall** only saves the personal template.

### Incoming mail (Gmail, IMAP, POP3 and offline inboxes)

Open `/settings/email` to connect email accounts, then `/mail` (`/email` is an
alias). Each account can independently enable **Cloud** and **Local** sync.
IMAP discovers selectable folders; POP3 exposes its single inbox. **All inboxes**
combines inbox folders. A proxy inbox is a saved selection of folders from any
connected accounts: it changes only the view and never copies, moves or deletes
provider messages. Both protocols can be enabled, so the same provider message
may appear once per protocol/folder; independent source identities are preserved.

Cloud sync uses the existing account vault bootstrap key
(`THINGTIME_USER_VAULT_KEY`, or the already configured admin vault key), the home
Mongo data plane, and the normal transactional storage allowance. Configure the
vault using the existing Secure Vault setup; no mail-specific encryption key is
needed. Missing encryption fails closed. Credentials and message content are
account-bound encrypted protected Things; generic search/sharing cannot expose
them. Use an app password where your provider requires one. Providers that have
disabled password authentication require OAuth: Gmail supports **Connect Gmail
with Google** below; other OAuth-only providers need an adapter. Do not enter a
normal account password when the provider requires OAuth. These are incoming
mail readers; the existing transactional email outbox remains separate.

Ordinary browser pages cannot open raw TCP/TLS connections to POP3 or IMAP.
**Local** means the browser stores and renders mail offline and talks to a paired
loopback connector for network sync. The connector runs the same read-only
protocol adapter as the cloud; local-only credentials never go to Thingtime's
cloud. To run it from a clone with Node 24 and the Remix dependencies installed:

```sh
export THINGTIME_MAIL_ORIGIN=https://your-thingtime-origin.example
# Generate a random token privately and paste the same token into Email settings.
# Never commit or share the resulting token.
export THINGTIME_MAIL_TOKEN="$(openssl rand -hex 32)"
npm --prefix remix run mail:connector
```

`THINGTIME_MAIL_ORIGIN` must be the exact browser origin without a trailing slash
(for this development worktree, `http://127.0.0.1:13760`). The connector binds
only `127.0.0.1:17879`, checks Host, Origin and a bearer pairing token, accepts no
cookies, and allows at most two concurrent syncs. Close its terminal process to
stop it. Your browser may require local-network permission. Pair each browser
separately; do not expose the connector through a public proxy or Funnel.

TLS ports are IMAP 993 / POP3 995; mandatory STARTTLS uses 143 / 110. Certificate
verification is always enabled. The adapters reject private/reserved addresses
and pin the validated DNS address to prevent rebinding. Plaintext, custom ports,
internal mail servers and OAuth for the raw IMAP/POP3 adapters are not supported. No mail
server deletion/mark-read/move commands are issued.

Sync is explicit through **Sync inbox** / **Sync folders**, with **Load older
mail** for bounded ten-message provider pages. It is not a background cron or
push service. A device caches up to 2,000 messages, with up to 12,000 text
characters per message, and marks truncated/oversized messages. HTML is rendered
as text; remote images and scripts are never loaded. Attachments remain at the
provider and are counted, not downloaded by this version. Cloud-only proxy
inboxes sync across your devices; views including device-only accounts stay on
that device. Browser records are individually AES-GCM encrypted with a
non-exportable device key; stale-tab writes are refused. This protects stored
bytes from accidental disclosure, not an attacker running scripts in the same
origin or an unlocked operating-system account.

#### Gmail with Google authorization

Email settings → **Connect Gmail with Google** starts a ten-minute connection.
Open **Continue with Google** in a new browser tab (Safari/system browser in
native apps), choose the Google account and grant Gmail read and write access. Return to
Thingtime, press **I’ve finished with Google** if needed, and confirm the shown
address. This connects a mailbox to the current Thingtime account; it does not
change the Thingtime sign-in identity. No app password or local connector is
needed, including with Google two-step verification.

The default stores message copies on the device. The refresh authorization is
always stored encrypted in the existing Thingtime account vault, allowing
Thingtime’s API to read and manage Gmail on request. Enable cloud message storage separately
in Edit. Pausing sync keeps the authorization; removing the account removes its
saved authorization and Thingtime cache without changing Gmail. You can also
revoke access in your Google Account’s third-party connections settings. If
Google revokes/expires the grant, remove the old connection and connect again.
Messages use the same encrypted records and proxy inboxes as other providers.
Gmail pages contain at most 20 messages; large messages show a partial notice.
Google-connected accounts also support mark read/unread, archive, move to Trash,
restore from Trash, create/rename labels and add/remove message labels. The Mail
composer saves edits encrypted on the device immediately; **Save draft to Gmail**
creates or updates a Google draft. **Review and send** shows the sender and all
To/Cc/Bcc recipients before the explicit **Send email** action. No permanent
mail deletion is exposed. IMAP/POP3 adapters remain read-only.

The composer supports plain-text drafts up to 30,000 characters and 50 addresses
per recipient field. Existing rich-text/attachment drafts open in Gmail to avoid
silently losing their formatting or files. Device drafts stay separate from the
Google draft until saved. Sending uses the confirmed fields; a changed Google
draft message ID refuses the write. Google does not provide a transactional
compare-and-swap against edits made simultaneously in another Gmail client.

Provider mutations require a stable writeId and create an encrypted accounted
`mail-operation` child before network I/O. Completed retries return the saved
result. An interrupted/uncertain send is never automatically replayed: check
Gmail Sent before deliberately creating another message. Receipts remain after
account removal to retain duplicate protection; they contain no mail body or
Google grant. A short account lease serializes Thingtime mutations and fences
stale sync cache writes. This is at-most-once admission, not guaranteed delivery
or automatic recovery after a lost provider response.

Fork/deployment setup (admin only):

1. Create a Google Cloud **Web application** OAuth client, enable **Gmail API**,
   and configure the consent screen with `openid`, `email`, and
   `https://www.googleapis.com/auth/gmail.modify`. Add test users while the
   Google app is in Testing. Register each exact callback URL, for example
   `https://your-thingtime.example/api/v1/mail/google/callback`.
2. In the existing Admin System Secure Vault, save a secret with the fixed label
   `google-mail-oauth`. Its JSON selects credentials by exact origin:

   ```json
   {
     "origins": {
       "https://your-thingtime.example": {
         "clientId": "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com",
         "clientSecret": "YOUR_WEB_CLIENT_SECRET",
         "redirectUri": "https://your-thingtime.example/api/v1/mail/google/callback"
       }
     }
   }
   ```

   Use separate development/production clients and explicit origin entries.
   Unlisted preview origins fail closed; no environment borrows credentials.
   Local testing may register `http://127.0.0.1:<port>` or `http://localhost:<port>`
   with the same callback path. Use the existing admin/user vault bootstrap;
   no additional Vercel environment variables are needed. Never commit real
   client secrets or tokens. Rotation of the Google client ID requires users to
   reconnect; changing a secret for the same client preserves existing grants.
3. For public launch, complete Google’s consent verification for restricted
   Gmail scopes and the applicable security assessment for server-transmitted
   data. Testing-mode refresh authorization may expire after seven days.
   See [Google scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes)
   and [OAuth production requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
4. Verify a real consent/refresh/revoke flow on that origin before claiming it
   active. Unit/synthetic tests do not prove Google app verification or account
   consent. Provider tokens never enter browser/native storage, callback HTML,
   public account projections or generic Thing APIs.

Validation commands:

```sh
npm --prefix remix run test:mail
npm --prefix remix run test:mail:transport
npm --prefix remix run test:mail:connector
# Opt-in HTTP checks refuse any DB except 127.0.0.1:20437 / mail-qa-rs.
MAIL_TEST_BASE=http://127.0.0.1:13760 npm --prefix remix run test:mail:integration
# Requires the same disposable DB/vault/JWT settings in remix/.env.local.
MAIL_TEST_BASE=http://127.0.0.1:13760 npm --prefix remix run test:mail:storage
```

The transport test uses temporary self-signed fixture certificates trusted only
by its child Node process and synthetic TLS servers. It does not weaken the
production connector's certificate or destination checks. HTTP tests create
fixture users through the real API, never by inserting Mongo records. The local
web app uses the normal PM2 worktree lifecycle (`npm run web-pms`). No public
Tailscale/Funnel endpoint is configured for the disposable mail QA database.

The storage integration uses the production HTTP route and real authenticated
replica transactions with a synthetic provider boundary to force a sync/delete
race. The connector integration can run with `--serve` for synthetic browser QA;
never use its published fixture token for real mail. The production connector
requires your own random token. Browser offline checks cover cached reading and
search in an already loaded app; offline cold-launch of the whole app is separate.

### Automatic iOS TestFlight publishing

Native changes merged to `main` can publish tested, signed TestFlight builds with
matching phone/Watch/widget versions. The existing GitHub credentials remain the
initial source; an explicit one-time migration can move them into the encrypted
admin Secure Vault, after which short-lived GitHub OIDC identities fetch only the
Apple release bundle. See [setup, fork configuration, migration and release
verification](docs/ios-automatic-testflight.md). No additional Vercel environment
variables or permanent GitHub-to-vault password are required.


### Native mail and browser API relay

Email settings separates cloud storage from the encrypted device copy. For new
accounts, the desktop app defaults to **Directly from this app**; browsers and
iOS default to **Thingtime API relay — no installation**. Existing accounts keep
their paired-connector choice until changed explicitly.

- **Directly from this app** uses Electron IPC and the same bounded read-only
  IMAP/POP3 implementation as the API. No loopback listener or pairing token is
  needed. Credentials and message content stay on the device unless cloud sync
  is also enabled. Navigation, cancellation and app exit abort active work.
- **Thingtime API relay** sends credentials to the currently selected Thingtime
  server for each request. `POST /api/v1/mail/sync` returns the shared version 1
  batch without saving credentials, accounts or messages. It requires a full
  Thingtime session, `expectedOwnerId` in query and body, and explicit
  `account.sync.transport: "relay"` with `sync.local: true`. It needs working auth
  and rate-limit storage but no mail vault encryption key. The host must allow
  outbound TCP to public mail servers on 993/143/995/110 with verified TLS.
- Cloud sync remains the separate option for encrypted server storage. The
  desktop app forwards private mail API requests only to its explicitly selected
  HTTPS account endpoint, through the existing trusted loopback proxy. Ordinary
  incomplete web deployments refuse fallback, and native failures never fall
  back to a cloud transport.

The iOS drawer has a **Mail** shortcut to the selected site's `/mail`; its relay
uses the WebView's current session and the same encrypted device store. iOS does
not advertise direct IMAP/POP3 support. Other web-based native hosts can use the
same relay endpoint; standalone Watch/Widget companions do not sync mail.

Desktop builds stage `electron/dist/mail/provider.cjs` from the canonical web
provider using the existing MCP esbuild toolchain. `electron build:web` installs
that toolchain and builds/verifies the artifact; no global Node connector is
required by an installed app. Use the normal Electron `dev:parallel`, signed
`build` and `install:local` commands. No additional secrets or deployment
variables are needed. Do not enable request-body logging for private mail routes.

For relay HTTP regression checks, use the disposable mail replica and fixture
created by `test:mail:integration`, then run
`MAIL_TEST_BASE=http://127.0.0.1:<worktree-port> npm --prefix remix run test:mail:relay`.
It checks the real session, endpoint, explicit mode and absence of cloud writes
using DNS-only POP3 discovery; it never attempts a provider login.

### Import an existing OpenAI deployment key

An admin can use **AI Providers → AI platform credentials → Import configured OpenAI key** to copy the current server’s `OPENAI_API_KEY` into the encrypted shared vault as `OPENAI_THINGTIME_API_KEY` (platform `OpenAI`). The value never travels through the browser. The operation requires capability `api.admin-ci-credentials` 3.1.0, a same-origin admin session and an already configured vault. Repeating it preserves existing entries, including disabled entries. Configure your own provider key on your own deployment; no account-specific value is bundled. The environment variable remains available to existing chat consumers; this import does not remove or rotate it.

### Paired Mac menu bar and reusable scripts

Install **Mac menu bar** or **Device scripts** from the Builder app catalogue.
Installation creates private, editable Components, Actions and a page. Pair the
Mac with the same account and API origin in the installed Thingtime app.
No extra server secret or collection is required; forks use the ordinary device
pairing setup and their own API origin.

Menu inventory needs node-state capability 1.11.0 and a current macOS node. It
refreshes in the background every 30 seconds. Accessibility improves coverage;
the page distinguishes partial, collecting, locked, offline and unavailable data.
Some macOS items are not exposed by public APIs. Memory and cumulative CPU time
are whole-process readings, not individual-icon usage. Locked snapshots contain
no inventory. Application paths are private device data.

Device scripts reuse the paired-device command queue (`script.run`), negotiated
with command capability 1.10.0 and native `script.bash.v1`. Each execution needs
fresh approval of the exact Bash source, even under an always-allow policy.
Scripts run as the Mac user, without a shell profile or inherited credentials;
they are **not sandboxed** and can access that user's files and network. The
source limit is 16 KiB, timeout 1–30 seconds, and combined output limit 16 KiB.
Ordinary child processes are terminated with the run; intentionally detached
daemons are outside this contract. Use a fresh Run ID for each intentional run;
retry an uncertain submission with the same ID and identical input.

The receipt is not execution success: read stdout, stderr, exit code, signal,
timeout and truncation after approval. Exact command results are owner-only and
expire after ten minutes. **Save result as a private Thing** explicitly retains
the full output in `extended.result`, with searchable metadata in `crystal`.
**Save reusable Action** creates an editable recipe with literal source in its
JSON string input default (up to the device’s 16 KiB limit); bind the result
Action as a component source to reuse the data in other Builder pages. Never
place secrets directly in saved script source or output.

Synthetic UI acceptance: run `node remix/scripts/run-mac-menu-bar-browser.mjs`
with `TT_PLAYWRIGHT_MODULE` pointing to the installed Playwright module. On macOS
it applies a process-tree OS network boundary allowing only loopback port 13820,
uses no real credentials/backend, and writes screenshots/traces to
`remix/tmp/menu-bar-qa/`. It fails closed if the boundary cannot be established.
