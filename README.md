# 🌈 Welcome 👋 to Thingtime 🦄 🧠

https://thingtime.com

Thingtime is a powerful platform for storing and sharing information of all kinds. Whether you want to keep track of your personal notes, collaborate on a project with your team, or build a new app that relies on rich data, Thingtime has you covered.

With Thingtime, you can create and share any abstract data structure you want, or store any practical piece of information and share it for people and machines to use equally. Thingtime is not only a platform, but also an ecosystem that empowers developers and users alike to build, share, and utilize all kinds of data and knowledge.

At Thingtime, we believe that data and knowledge should be open, accessible, and empowering. We are building Thingtime to make this vision a reality. Join us and start exploring the limitless possibilities of data!

## Embed Thingtime on any website

Thingtime now builds as a single minified browser file with shared state,
Shadow DOM mounts, an injected popup, and a first-party secure editor/save
window:

```html
<div data-thingtime-mount></div>
<script src="https://thingtime.com/embed/thingtime.min.js"></script>
```

See [the Thingtime Embed SDK guide](docs/THINGTIME_EMBED.md) for declarative and
JavaScript APIs, public persistence, conflict handling, security boundaries,
local development, and build verification.

## AI agent instructions

Repository-wide AI guidance lives in the single canonical `AI_ALL.md`.
`AGENTS.md` and `CLAUDE.md` are relative symlinks to that file so Codex,
Claude, and other compatible tools read the same instructions. Update
`AI_ALL.md` only; keep both symlinks intact.

## Thingtime MCP

The [`MCP/`](MCP/) package contains Thingtime's consent-first AI conversation
normalizers. As a standalone MCP server it supports explicit current-chat
handoff, private local staging, ChatGPT/Claude exports, and a portable connector
manifest. The Electron app also bundles its read-only desktop connector: it can
discover local ChatGPT Work/Codex history plus Claude sessions from the main and
Thingtime desktop profiles, then import projects, chats, and visible messages
through the authenticated Messenger API. See [`MCP/README.md`](MCP/README.md)
for both workflows and their privacy boundaries.

## Conflict-free Graphify snapshots

Thingtime does not ask every branch to modify the same generated Graphify JSON
files. `scripts/graphify` stores portable output under the immutable,
content-addressed `graphify-out/snapshots/v1/` tree and exposes the selected
snapshot through ignored compatibility aliases at the conventional root
paths. Independent branches therefore add different files instead of
line-merging `graph.json`, `manifest.json`, and `GRAPH_REPORT.md`. After a
successful activation, the wrapper keeps one current portable snapshot by
default and removes superseded snapshots from the checked-out tree, so merged
branch artifacts cannot grow `develop` without bound.

Use `scripts/graphify query`, `scripts/graphify update .`, or
`scripts/graphify extract . --backend openai`; the wrapper serializes local
writers, validates each atomic output set, deduplicates identical artifacts,
regenerates the report/HTML, and converts Graphify's mutable semantic cache into
coexisting immutable variants. `scripts/graphify prune` applies the bounded
retention policy without rebuilding; set `GRAPHIFY_SNAPSHOT_RETENTION` to a
positive integer only when a local workflow deliberately needs more than one
portable snapshot. See
[`docs/graphify-content-addressed-snapshots.md`](docs/graphify-content-addressed-snapshots.md)
for the rationale, layout, migration path, and retention model.

## GitHub Actions control plane

Thingtime keeps executable CI/CD behavior on the long-lived, protected
`github-actions` branch. Product branches (`main`, `develop`, feature branches,
and promotion branches) retain only a small set of thin event listeners in
`.github/workflows/`: GitHub must be able to discover a workflow file on the
ref/default branch that receives a native `push`, `pull_request_target`,
`schedule`, `repository_dispatch`, or `workflow_dispatch` event. Each listener
contains triggers, caller permissions, and typed inputs only; its sole job calls
the matching reusable workflow at
`lopugit/thingtime/.github/workflows/<name>.yml@github-actions`.

All runner selection, shell commands, third-party actions, AI/model routing,
Git operations, Graphify refreshes, and workflow scripts live only on
`github-actions`. The product branches intentionally contain no `.github/actions`
or `.github/scripts` behavior. `remix/scripts/workflow-caller-contract.mjs`
fails if executable behavior leaks back into a listener or one stops pinning the
control-plane ref.

Protect `github-actions` with a ruleset: require pull-request review for changes,
block force pushes and deletion, and restrict direct updates. A push to that
branch runs its own control-plane contract CI. Updating the implementation no
longer requires separately merging the same behavior into `develop` and `main`;
the thin listeners on both branches call the same reviewed revision immediately.

### CodeQL coverage for every PR target and branch

Thingtime uses CodeQL advanced setup so analysis is not limited to GitHub's
default-setup branch scope. The thin `.github/workflows/codeql-analysis.yml`
listener has an unfiltered `pull_request` trigger and a `push` trigger for
`"**"`; therefore every PR whose target carries the listener and every direct
branch push receives analysis. A default-branch `pull_request_target` listener
also covers PRs whose target branch predates the listener. That privileged run
calls a dedicated protected metadata-only handoff, checks out no code, and
receives no AI credential. The handoff forwards only the PR number and immutable
event head SHA into a separate
`workflow_dispatch` run, which revalidates live state and analyzes the exact PR
merge ref—or the head ref while a conflict prevents GitHub from creating one.
Lopu validates both merge parents against the live base and head before using
that ref, because GitHub can retain an obsolete merge ref after a conflict.
`main` and `develop` carry the normal listener, and new feature and stack
branches inherit it from their base, while the protected implementation
directly handles PRs targeting and pushes to `github-actions`; the central
handoff closes the remaining arbitrary-target gap. A PR whose target already
carries the listener keeps its normal `pull_request` run as owner, preserving
branch-protection check contexts; when that PR already owns a branch head, the
matching push run stands down. When the selected ref already has both language
snapshots, Lopu exits before CodeQL initialization instead of paying for a
duplicate scan.

The analysis and metadata handoff use separate protected reusable workflows.
That split is required by GitHub's permission model: ordinary `pull_request`
tokens are capped at `actions: read`, while only the metadata-only
`pull_request_target` bridge needs `actions: write` to dispatch the exact PR
scan. The split preserves normal PR check contexts without granting analysis a
write-capable Actions token.

The first rollout has one ordered repository-administration step. Do not turn
off default setup until this listener has reached the default branch, because
GitHub rejects advanced-workflow result uploads while default setup remains
configured and disabling it early would create a coverage gap. Once the
listener is present on the default branch, an administrator with repository
Administration write access should run:

```sh
gh variable set CODEQL_CENTRAL_PR_ENABLED --repo OWNER/REPOSITORY --body true
gh api --method PATCH repos/OWNER/REPOSITORY/code-scanning/default-setup \
  -f state=not-configured
gh variable set CODEQL_ADVANCED_ENABLED --repo OWNER/REPOSITORY --body true
```

The absent/false variable deliberately makes the staged advanced jobs skip
cleanly instead of failing every PR while default setup still owns uploads.
After setting them, manually run **Lopu CodeQL all branches**, confirm both
language jobs upload results, and verify the repository reports default setup
as `not-configured`. Then update a PR targeting an older feature/stack branch
that does not contain the listener and confirm its metadata-only target event
creates a separate exact-head scan.

After activation, an empty Lopu CodeQL snapshot means no current matching
head-or-merge findings (or a failed/unavailable analysis), not merely that the
PR targets `develop` or `github-actions`.

The Admin → CI Control dashboard adds the external observation/operation layer:
signed GitHub and Vercel webhooks project repositories, features/stacks,
branches, pull requests, Actions runs, deployments, previews, audited dispatches,
and append-only status history into protected Things. The GitHub App is also
used for explicit reconciliation, allowlisted workflow dispatch, and ephemeral
self-hosted runner registration. Native listeners remain the automatic trigger
path, so a webhook outage cannot silently turn off conflict resolution or CI;
the dashboard makes drift and stale delivery state visible. Administrator
dispatches always enter the reviewed `github-actions` implementation; neither
the UI nor API can load workflow YAML from an arbitrary feature branch.
The existing CI Control operation keys remain stable, but rebase, feature
promotion, standing promotion, and main/develop synchronization are translated
to typed **Lopu PR manager** inputs instead of dispatching retired workflow
files.

CI Control also supports **Feature Stacks**. An admin checks one or more open feature
PRs in the exact order they should be combined, chooses one or two live target
branches (for example `develop` and `main`), confirms the batch, and dispatches
it once. The server snapshots every selected same-repository PR head SHA. The
protected controller builds an isolated integration history for each target,
lets Lopu resolve only Git-reported conflict paths, mechanically verifies every
merge parent and clean-merge byte, then opens a target-specific PR with
auto-merge enabled. Required checks and branch protection remain the final gate;
the batch never pushes directly to a target branch.

The same page owns Lopu’s **Claude credential waterfall**. Admins add a named
Claude Code OAuth token once, enable or disable it, rotate it, and reorder up to
eight accounts. Only redacted labels and timestamps return to the browser. The
values are AES-256-GCM encrypted in Thingtime with
`THINGTIME_ADMIN_VAULT_KEY`. A protected workflow fetches the ordered enabled
bundle just in time through `/api/v1/integrations/ci/credentials`, using the
same stable `THINGTIME_CI_ROUTER_SECRET` HMAC boundary and a fresh single-use
nonce. It masks the values immediately, keeps the bundle at mode `0600` for the
current run only, and advances accounts only for classified capacity or
credential failures. The first controller run can import the old OAuth slots
into an empty vault; after that proof, delete the account-specific GitHub
secrets and retain only `THINGTIME_CI_ROUTER_SECRET`.

For supported automations, an administrator can choose **GitHub Actions** or
**Vercel Sandbox** independently. The native listener first runs a tiny provider
router on GitHub. A GitHub selection continues normally. A Vercel selection
starts a durable Vercel Workflow, creates an ephemeral Vercel Sandbox, registers
that Sandbox as a uniquely labelled GitHub self-hosted runner, and dispatches the
same protected reusable workflow back onto that runner. GitHub therefore remains
the workflow/event control plane while the expensive compute runs on Vercel. If
the signed router, App, Workflow, or Sandbox is unavailable, the trigger records
the fallback and continues on GitHub-hosted compute instead of dropping the
automation. Web CI remains GitHub-only while its API test job requires a Docker
MongoDB service; Electron release remains GitHub-only because it needs native
platform runners.

Configure the server-side integration with private environment variables only
(never `PUBLIC_*`):

```sh
THINGTIME_GITHUB_REPOSITORY="owner/repository"
THINGTIME_GITHUB_APP_ID="123456"
THINGTIME_GITHUB_APP_INSTALLATION_ID="12345678"
THINGTIME_GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
THINGTIME_GITHUB_WEBHOOK_SECRET="replace-with-a-long-random-secret"
THINGTIME_VERCEL_WEBHOOK_SECRET="secret-returned-when-the-webhook-is-created"
THINGTIME_CI_ROUTER_SECRET="another-independent-long-random-secret"
```

CI control-plane rows (every `ci-*` Thing, including the append-only
`ci-event` history) live in their own `ciControl` satellite collection, never
in `things`, and are TTL-reaped by a root `expiresAt` stamp. The retention
windows are optional, in days; `0` keeps that class forever, and unset means
the default:

```sh
# append-only ci-event history (default 14)
THINGTIME_CI_EVENT_RETENTION_DAYS="14"
# per-job workflow rows — ci-workflow-run with a job: external id (default 30)
THINGTIME_CI_JOB_RETENTION_DAYS="30"
# top-level workflow runs, deployments, and previews (default 90)
THINGTIME_CI_ACTIVITY_RETENTION_DAYS="90"
```

Repository, feature, branch, pull-request, policy, dispatch, and feature-stack
projections never expire. A GitHub delivery that changes nothing on the
repository row records no `ci-event` for it. Deployments that predate the
satellite still hold their CI rows in `things`: run the admin migration
`relocate-ci-control-telemetry` (repeat until it reports nothing left) and then
`rebuild-things-indexes` from **/migrations** — see the MongoDB section.

Create a repository-installed GitHub App with repository metadata read,
Actions read/write (workflow dispatch and run/job observation), Administration
read/write (short-lived self-hosted runner registration and deletion), Contents
read (branches), Pull requests read, and Deployments read. Install it only on
the intended repository. Subscribe its webhook to `push`, branch create/delete,
pull request, workflow run, workflow job, deployment, and deployment status
events, using:

```text
https://<your-thingtime-origin>/api/v1/integrations/github/webhook
```

Create a project-scoped Vercel webhook for deployment created/ready/error/
canceled/deleted events at:

```text
https://<your-thingtime-origin>/api/v1/integrations/vercel/webhook
```

The signed compute-provider route is:

```text
https://<your-thingtime-origin>/api/v1/integrations/ci/route
```

The signed Lopu credential delivery route is:

```text
https://<your-thingtime-origin>/api/v1/integrations/ci/credentials
```

The signed Feature Stack progress route is:

```text
https://<your-thingtime-origin>/api/v1/integrations/ci/progress
```

The protected controller posts an initial snapshot, phase changes, a heartbeat
every ten minutes, and one terminal snapshot. The route uses the same
`THINGTIME_CI_ROUTER_SECRET`, attaches each immutable event only to its exact
stored stack/run identity, and never accepts browser sessions or arbitrary
workflow log text.

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

The selected-PR detail panel also has independent, durable **Develop** and
**Production / main** preview switches. Enabling either switch deploys the
exact current same-repository PR SHA through Vercel; later `synchronize`,
reopen, and ready-for-review deliveries rebuild every enabled environment.
Production access requires an explicit admin acknowledgement and uses the
project's Production environment values, but `autoAssignCustomDomains` remains
false. Before starting the provider builds, the builder publishes one GitHub
App-owned PR comment with every enabled environment's expected PR-scoped
persistent URL and a five-minute expected-ready time. It updates the same
comment with each immutable `*.vercel.app` snapshot URL as Vercel accepts the
build. A READY webhook moves only that persistent alias to the verified current
snapshot; it never replaces or aliases `thingtime.com` or `dev.thingtime.com`.
Closing the PR removes only aliases and deployments carrying Thingtime's
PR/environment ownership markers. Configure these server-only deployment values
in every origin that hosts CI Control (placeholders only):

```sh
VERCEL_API_TOKEN="<Vercel-API-token>"
VERCEL_TEAM_ID="<Vercel-team-id>"
VERCEL_PROJECT_ID="<Vercel-project-id>"
VERCEL_PROJECT_NAME="<Vercel-project-name>"
VERCEL_GITHUB_REPO_ID="<Vercel-linked-GitHub-repository-id>"
VERCEL_CUSTOM_ENVIRONMENT_ID="<develop-Custom-Environment-id>"
PREVIEW_ALIAS_SUFFIX="previews.dev.example.com"
PRODUCTION_PREVIEW_ALIAS_SUFFIX="previews.example.com"
```

Never expose these as `PUBLIC_*`. `VERCEL_CUSTOM_ENVIRONMENT_ID` is required
only for the Develop switch; the other five provider values are required for
both. The alias suffixes default to Thingtime's two preview namespaces, so forks
must set both to verified wildcard domains owned by their own Vercel project.
The GitHub App needs Issues or Pull requests write permission to create and
update its marker comment.

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

Thingtime has one public **Lopu PR manager** Action. It owns repository review,
failed-check and CodeQL repair, stale-branch merges, conflict resolution,
rebases and stack cascades for every same-repository PR regardless of its
target branch, promotions, main/develop synchronization, release analysis,
wildcard `all`-branch repair, and post-merge Graphify refresh. Deterministic
implementations remain protected reusable components; they have no competing
push, schedule, or manual triggers of their own, so a branch push never starts
a second standalone rebase, promotion, or branch-synchronization workflow.

Lopu listens to pushes on `"**"`, every PR-head lifecycle update, PR and inline
review comments, failed check completions, and bounded maintenance schedules.
It checks open PRs both targeting and originating from the changed branch. All
signals revalidate immutable PR snapshots and enter one repository-wide
model-worker queue with `cancel-in-progress: false`, so a burst can neither
spawn parallel Lopu sessions nor discard in-flight work.

Inside Lopu, merge and rebase ownership remains deliberately disjoint.
Standalone merge conflicts and clean-but-behind branches go to the base-merge
lane. Genuine stack members whose history needs replay go to the rebase lane;
adding `no-ai-rebase` opts a merge-conflicting stack member back into the
merge-based lane. The protected rebase engine still accepts the manager's
exact `repository_dispatch` worker handoff through **Lopu PR manager**, but it
has no public listener of its own. It is a `workflow_call`-only implementation;
no product branch contains or exposes a second rebase workflow.

Lopu's rebase/stack lane covers the case GitHub reports as `mergeable: true` but
`rebaseable: false`: a plain merge needs no help, yet replaying the branch's
commits onto its base stops at a conflict. A detected stack is rebased
root-to-leaf, so each child is replayed onto the rewritten parent rather than
onto the parent's old SHA.

For manual recovery, open **Actions → Lopu PR manager → Run workflow** on the
default branch. Enter an exact PR number, a base/head branch selector, or leave
both blank to scan every open eligible PR. The same entry point deliberately
retries a reviewed paused merge/rebase snapshot, so failed immutable snapshots
stay auditable without reviving a separate public Action; the internal rebase
handoff is not a second user-facing workflow. The `maintenance_operation`
choice also exposes the standing develop promotion, per-feature promotion
(including dry-run and reverse-lane options), main→develop synchronization, the
wildcard `all`-branch rebuild, and bounded CodeQL backfill without restoring
separate Actions entries.

Broad scans are API-only detectors; they hand off one trusted default-branch
run per conflicted base, so unrelated bases do not share one AI job. A failed
merge run reports itself but never auto-pauses: `ai-merge-paused` is a
user-controlled stop signal that automation never adds or removes, so add it
yourself to keep the scheduled sweep from spending more AI budget on the same
PR. The rebase lane's automatic `ai-rebase-paused` hold is bound instead to the
exact owner, refs, SHAs, and topology recorded in a bot-only hidden marker: a
changed snapshot is eligible again automatically, while the same snapshot
requires review and a named-base manual retry.

Lopu's merge lane also snapshots the exact live head and base SHAs, repeats
its PR/ref/label/stack/protection checks immediately before publication, and
uses an exact head lease. If either branch moves while Claude is working, the
resolved merge is discarded rather than overwriting the newer work.

Detection is patient and audible: GitHub computes a PR's mergeability lazily
after its base moves and verdicts can take minutes to settle, so the merge
detector re-queries until every scanned PR has a verdict (time-budgeted via
`MERGEABLE_POLL_SECONDS`, default 500 seconds — a little over eight minutes)
instead of sampling once at push time. When it must leave a conflicted-looking PR alone — a fork PR it
cannot push to, or a verdict that never settled — it upserts one status
comment on the PR saying exactly that, so a silent PR means "nothing needed
doing", never "nobody looked". Conflicts that are handed off announce
themselves through the resolve job's "Auto-resolve running" comment.

Lopu's rebase/stack lane rewrites PR history, so its force push has
stricter boundaries:

- It operates only on branches in this repository. Fork PRs, the repository's
  default branch, and protected branches are refused.
- Lopu receives the repository context and its configured development tools so
  it can act as the principal codebase manager. Publication credentials are
  injected only into the final fenced push step; deterministic trusted code
  independently validates the conflict set, index, completed operation, and
  exact branch lease before anything is published.
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

To prefer a separate Claude Max/Pro account for all Lopu agent work without
replacing either existing slot, run `claude setup-token` while signed into that
account and save the result as the repository Actions secret
`CLAUDE_CODE_OAUTH_TOKEN_THINGTIME`. Lopu tries this preferred OAuth account
first, then the existing primary credentials above, then the existing fallback
credentials below. Never paste the token into a file, command argument, log, or
commit; pipe it directly into the GitHub secret prompt or API.

Optional ordered fallback credentials are `ANTHROPIC_API_KEY_FALLBACK` or
`CLAUDE_CODE_OAUTH_TOKEN_FALLBACK`. Lopu changes slots only for provider
capacity, quota, credit, or authentication failures; a max-turn continuation
stays on the selected account and session.

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

### Connect desktop AI history to Messenger

In the signed-in Thingtime desktop app, open `/messages`, choose either Spaces
or Chats, and select **✦ AI**. The connector presents three independent sources
when present on the Mac: ChatGPT, the main Claude profile, and Claude Thingtime.

- **Sync local chats** reads only visible local Work/Codex or Cowork/Claude Code
  conversation records. It never reads provider cookies, passwords, hidden
  reasoning, tool traffic, or browser storage, and raw local paths are not sent
  to Thingtime.
- **Import full export…** opens a native file chooser for an official ChatGPT
  or Claude JSON/ZIP export. Cloud-only history is unavailable to the local
  reader, so use the provider's official export when a conversation is not
  stored on the Mac.
- Projects/workspaces become Messenger Spaces, conversations become chats or
  channels, and provider messages are read-only. Reactions, threads, and new
  Thingtime replies remain local to Thingtime; they are not posted back to the
  provider.
- Sync runs in bounded batches and is idempotent. Repeating the same import
  updates the same owner-scoped records without duplicating chats, messages, or
  quota usage.

Imported history is user-owned content and consumes the signed-in account's
storage allowance just like posts and native Messenger rows. Message JSON is
metered on the Messenger row; any Thingtime-hosted attachment object remains
separately metered by its protected attachment record. A quota failure rolls
back the current transactional unit and returns a storage error rather than
silently importing unaccounted data.

No connector-specific environment variable is required in the packaged app.
For a fork/local build, keep the normal authenticated Thingtime origin and
database configuration in ignored Electron/Remix env files; do not grant the
web browser filesystem access. The browser version intentionally shows the
desktop-app requirement instead of attempting local discovery.

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

## ChatGPT / Codex plugin

Thingtime exposes a public HTTPS, OAuth 2.1 + S256 PKCE MCP endpoint at
`/api/v1/integrations/chatgpt/mcp`. It is packaged at
[`integrations/ChatGPT/plugin/thingtime-chatgpt`](integrations/ChatGPT/plugin/thingtime-chatgpt)
for ChatGPT/Codex distribution. The plugin connection page can securely attach
several named Thingtime accounts and explicitly allowlisted Thingtime API
origins. It accepts only scoped Personal Access Tokens (PATs), validates them
with `/api/v1/tokens/self`, encrypts them before server-side persistence, and
gives ChatGPT only a revocable MCP-only bridge token. When ChatGPT requests the
optional `offline_access` scope, the 30-day bridge access token is renewed with
a rotating refresh credential; every credential refers to one encrypted
connection record, so account selection and disconnects take effect across the
entire connection. Do not paste a PAT into a chat. The public `tools/list`
response exposes only tool metadata and its per-tool OAuth requirements; all
account data and tool calls require the bridge token and are origin-bound to
this MCP URL.

The MCP publishes 31 bounded tools plus prompts, account-scoped resources, and
an embedded review UI. Exact batch reads preserve requested IDs and report
missing Things independently; schema discovery/validation, relationship and
thread traversal, and ACL-aware change polling cover richer read workflows.
For writes, composed operations produce a signed before/after preview first,
then apply with scope checks and optimistic `updatedAt` preconditions only
after the call explicitly supplies `confirmed: true`. Encrypted MCP history records partial outcomes and can
produce a fresh undo preview. Reusable `Thingtime Capability` data Things may
compose only the same registered create/update/delete grammar: arbitrary URLs,
database queries, API routes, and executable payloads are rejected.

Set these sensitive server-side deployment variables (for example in Vercel)
before enabling the connector. Values below are placeholders only:

```sh
# Exactly 32 random bytes, base64 encoded. Generate/store as a deployment secret.
THINGTIME_CHATGPT_CREDENTIAL_KEY="<base64-encoded-32-byte-key>"

# Optional. Exact comma-separated HTTPS origins only; no wildcard or paths.
# Defaults to https://thingtime.com when unset.
THINGTIME_CHATGPT_ALLOWED_ENDPOINTS="https://thingtime.com,https://dev.thingtime.com"

# Optional. Defaults to ChatGPT's stable Client ID Metadata Document plus the
# legacy https://chatgpt.com identifier. Set only if the connection page gives
# you an additional exact OAuth client id.
THINGTIME_CHATGPT_OAUTH_CLIENT_IDS="https://chatgpt.com/oauth/client.json,https://chatgpt.com"
```

The MCP protected-resource and authorization-server discovery documents are at
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`; its origin-scoped feature manifest
is `/.well-known/thingtime-chatgpt-capabilities.json`.

For the supported ChatGPT workspace path, use ChatGPT **on the web** with a
Business or Enterprise/Edu workspace. An admin or owner enables Developer Mode
from Workspace Settings → Apps → Create, supplies this remote MCP URL, selects
OAuth, and uses **Scan Tools**. ChatGPT then opens Thingtime’s first-party
account form; its advertised `offline_access` scope allows the rotating refresh
flow. Create the draft, test it from the tools menu or by @mentioning it in a
new chat, then have an admin/owner publish it from Workspace Settings → Apps.
Full write/modify MCP access is currently a Business/Enterprise/Edu beta;
Pro-only connections are limited to read/fetch. ChatGPT custom MCP apps are
currently web-only, so iOS ChatGPT chats cannot invoke this connector. After
approval, tool definitions are a frozen snapshot. Enterprise/Edu admins must
review and enable a refresh before action changes are available; Business
workspaces currently need to recreate and republish the app to change its
tools or metadata. Public Plugins Directory
distribution remains a separate process requiring a fixed production origin,
verified publisher identity, legal URLs, test cases, and OpenAI review; see
the package's `SUBMISSION.md`.

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

### Public data-environment identity

Every deployed API must publish a safe identifier for its **database and
authentication authority**. It is not a MongoDB host, database name, or
credential; it lets browser bundles, Electron, account federation, and peer
discovery distinguish deployments that share data from deployments that only
look similar by URL. Set one public value for each Vercel target:

```sh
# Production target
THINGTIME_DATA_ENV="production"

# Preview + development targets that share the development database
THINGTIME_DATA_ENV="development"

# A separate named database/authentication authority
THINGTIME_DATA_ENV="custom:demo"
THINGTIME_DATA_AUTHORITY_ORIGIN="https://demo.thingtime.com"
# Optional when multiple ids deliberately share one authority/database
THINGTIME_FEDERATION_ID="demo"
```

`/api/v1/capabilities` (feature `api.capabilities` `1.1.0`) and root data
publish only `{ id, kind, federationId, authorityOrigin }`. Clients must use
that identity for sign-in and federation; `VERCEL_ENV`, branch names, URLs, and
commit SHAs are diagnostics, never the data-authority contract.

### Deployment peer discovery

First-party production, preview, and development deployments can converge on a
small mesh of live peers through `/api/v1/peers`. Configure the same discovery
secret and a distinct persistent signing key on every participating deployment
(never `PUBLIC_*`, never a browser variable):

```sh
THINGTIME_PEER_DISCOVERY_SECRET="replace-with-a-random-32-plus-character-secret"
# Base64url PKCS#8 Ed25519 private key; create and store it in the deployment's secret manager.
THINGTIME_PEER_SIGNING_PRIVATE_KEY="replace-with-base64url-ed25519-pkcs8-private-key"
THINGTIME_PUBLIC_ORIGIN="https://this-deployment.example.thingtime.com"
# Required public data/authentication authority: production, development, or custom:<id>
THINGTIME_DATA_ENV="development"
# Optional; defaults to the authority origin for THINGTIME_DATA_ENV
THINGTIME_PEER_BOOTSTRAP_ORIGIN="https://dev.thingtime.com"
# Optional comma-separated first-party host suffixes; defaults to thingtime.com,vercel.app
THINGTIME_PEER_ALLOWED_HOST_SUFFIXES="thingtime.com,vercel.app"
```

Peers sign exact request method, path, timestamp, raw body, and federation id using HMAC, then
also add an Ed25519 signature derived from that deployment's private key. The
receiver verifies the public signature and pins the public key to the canonical
origin after first HMAC-authenticated contact; a later key change fails closed.
Every NDJSON peer event is independently Ed25519-signed too. The protocol
rejects anonymous requests, expired or tampered signatures, non-first-party
origins, credentials in URLs, and arbitrary outbound targets. Each origin is a
separate `deploymentPeers` control-plane row with a ten-minute TTL lease. Only
deployments with the same public federation id may discover one another. A
signed `POST {"op":"sync"}` first announces to that data environment's authority,
then probes a bounded breadth-first set of known peers; `GET` is capped,
cursor-paginated NDJSON rather than an all-peers array. Run self-sync from a
trusted deployment scheduler or deploy hook at a modest cadence (for example
every five minutes). The checked-in Vercel cron advances the production
bootstrap every five minutes using its existing `CRON_SECRET`; preview and
non-Vercel deployments need the equivalent trusted deploy hook or scheduler.
Do not expose either peer credential to clients or forks.

Administrators can inspect the locally known lease projection at **Dev →
Deployment peers** (`/peers`). The page calls a separate private,
cursor-paginated admin endpoint—not the mesh protocol—and can filter every
displayed public lease property in grid, card, or list form. It never returns
HMAC material, private keys, signed request envelopes, or the persisted gossip
cursor to a browser.

For a local MongoDB instance you can instead use a complete URI with no password
placeholder:

```sh
MONGODB_CONNECTION_STRING="mongodb://localhost:27017/thingtime"
```

### Index and storage hygiene

The boot-time `ensureIndexes` converges every collection to the index plan in
`remix/app/api/utils/mongodb/collections.ts` and prunes the names listed in
`RETIRED_THINGS_INDEXES`. Index files never shrink on their own: after a mass
delete (for example relocating CI telemetry out of `things`), each index keeps
its old on-disk size until it is dropped and recreated. The admin migrations
page (**/migrations**) shows a storage census per physical collection —
document bytes, on-disk bytes, index bytes, and index count — and flags a
generation whose index total is far above its document bytes. Reclaim it with
the `rebuild-things-indexes` migration (unique constraints stay enforced by a
twin index throughout). The audit that produced this runbook, with the
production measurements, is in `docs/architecture/mongodb-index-storage-audit.md`.

Vercel functions and the Atlas cluster are both pinned to Sydney (`syd1` in the
root `vercel.json`). For how that becomes region-local latency worldwide without
splitting the database or the URL, see
`docs/architecture/geo-distribution.md` — a proposal, not shipped behaviour.

### Hosted `develop` and Preview data plane

`https://dev.thingtime.com` and generic Vercel Preview deployments deliberately
share one development data/auth plane. Assign the current development MongoDB,
JWT, `APP_URL`, cron, and private-S3 values to both the `develop` Custom
Environment and generic Preview. Keep Production MongoDB, JWT, and S3 values
separately scoped; never reuse or document their secrets. Treat every branch
that Vercel may build for this project as trusted development code with access
to shared, disposable development data.

For Atlas, the username inside `MONGODB_CONNECTION_STRING` is authoritative.
The runtime reads `MONGO_PASS` only when replacing the literal
`<db_password>` placeholder; `MONGO_USER` may remain operator metadata but is
not read by the application. The home API explicitly selects the canonical
`thingtime` database, so the hosted URI may leave its database path empty.

After changing the hosted database configuration, redeploy `develop` and check
`GET https://dev.thingtime.com/api/v1/health/mongodb`. It must return HTTP 200,
`connected: true`, the expected development Atlas host, `dbName: "thingtime"`,
and no `x-thingtime-api-fallback` response header. Compare the same endpoint on
`https://thingtime.com` and confirm that Production reports a different Atlas
host. The current Thingtime hostnames and deployment state are recorded in
`VERCEL_DEPLOYMENTS.md`; forks should substitute infrastructure they control.

## Components library (`/components` + the external catalog)
## Components library (`/components` + `components-db/`)

`/components` is the UI-first sibling of `/schemas`: component things
(thingtime `["component"]`) carry an arg-templated render tree (drawn only
through the sanitising allowlist renderers) plus arg descriptors the page
turns into a live tester. "Save version" stores the current tester state as a
user-owned component thing in your Things.

The platform component catalog (styled after Ant Design, Bootstrap, MUI,
shadcn/ui, Untitled UI, daisyUI, React Flow, and the Thingtime house style)
lives in its own public repository —
[lopugit/thingtime-components](https://github.com/lopugit/thingtime-components)
— as a folder database (one JSON per component + manifest) alongside the
deterministic generator/validator/seeder pipeline. This app repo ships only
the component runtime and the Thingtime-required components; catalog
components live in MongoDB as system `component` things and the frontend
fetches them from there (`GET /api/v1/components/browse`).

Fork-safe seeding into your own dev DB (real API only — no direct Mongo):

```sh
# 1. Start the dev stack and register a throwaway user, then restart with
#    that user on the admin allowlist:
ADMIN_USERNAMES="<your-seed-user>" npm run web-pms

# 2. Clone the catalog repo and put credentials where the seeder finds them:
git clone https://github.com/lopugit/thingtime-components.git
cd thingtime-components
cat > scripts/components-db/.seed-env <<'ENV'
TT_SEED_BASE=http://127.0.0.1:<nitro-port>
TT_SEED_ADMIN_USER=<your-seed-user>
TT_SEED_ADMIN_PASS=<your-seed-password>
ENV

# 3. Validate the catalog, then seed (idempotent, batched):
node scripts/components-db/generate.mjs --check
node scripts/components-db/seed.mjs
```

The seed endpoint (`POST /api/v1/admin/components/seed`) upserts system-owned
public things with deterministic `component-<slug>` shareIds (the prefix is
reserved against squatters), refreshes drifted crystals in place, and never
touches foreign docs. `GET` on the same path returns the census.
Verification: `node remix/scripts/verify-components.mjs http://127.0.0.1:<nitro-port>`.

## Admin access

Schema-version migrations (`/api/v1/admin/migrations*`), the migrations panel on
`/schemas`, the admin panel, and raw database diagnostics are admin-gated. A
user is an admin when their user doc has `meta.admin: true` (promote/demote via
the admin panel or `POST /api/v1/admin/set-admin`) or their username is in the
bootstrap env allowlist:

```sh
ADMIN_USERNAMES="your-username,another-admin"
```

Env-allowlisted usernames are a permanent override (they can't be demoted from
the UI, so there's always a way back in) and are reserved at registration so
nobody can squat an admin username before you register it.

Admins get the `/admin` dashboard (also under the drawer's Account section):
Users, Apps, Tiers, CI Control, and System management. CI Control presents the
feature/branch/PR/Actions/deployment topology and signed status history, with
allowlisted reconciliation and retry controls. The Tiers tab manages protected,
versioned `subscription-tier` Things in separate Live, Draft / not live, and
Archived sections. Admins can create a tier or draft a new revision, edit its
name, tagline, banner, currency, daily/weekly/monthly/yearly prices, six
computed-or-custom percentage-saved comparisons, Editor.js inclusions, and
quota defaults, then publish or archive without deleting history. User and app
assignments pin the exact immutable revision and quota snapshot, so later tier
changes never silently rewrite an existing customer's plan. The dashboard also
supports per-field quota overrides (`null` = unlimited), platform-level app
suspension, and many-to-many ownership links (assign accounts to an owner so
one login can switch into its service accounts without credentials, and assign
apps to co-managers).

App owners and linked co-managers use `/apps/manage` to see the app's measured
aggregate usage and choose among the current live tier cards (the bootstrapped
catalog starts with Free 5 GiB, Plus 25 GiB, Pro 100 GiB, and metered PAYG).
Cards show the configured banner, renewal prices, savings, and Editor.js
inclusions; selection sends both the stable tier id and exact live revision id.
Managers can also change the inherited per-app-user cap (50 MiB by default) and
assign or reset custom caps for one or many app users. The app Thing is the
aggregate ledger; protected relational `app-storage` Things hold per-user usage
and optional sub-tiers, so neither generic app editing nor an end user can
rewrite the accounting rows.

The live verification suites need a disposable local database. The app-storage
suite is deliberately local-URL-only; the admin suite needs an env-admin's
credentials (placeholders — use your own throwaway admin):

```sh
node remix/scripts/verify-app-storage.mjs http://127.0.0.1:10000
```

```sh
TT_VERIFY_ADMIN_USER="your-admin-username" \
TT_VERIFY_ADMIN_PASS="your-admin-password" \
node remix/scripts/verify-admin-subscriptions.mjs http://127.0.0.1:10000
```

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

### Admin integration vault and policy proxy

The **/admin → External integrations** tab stores a write-only external
credential and binds it to a saved endpoint policy. The browser never receives
the credential again—not masked, decrypted, or through an audit record.
Provision this distinct server-only value before creating any secret:

```sh
# Generate once with a secure secret manager / CSPRNG. It must decode to exactly 32 bytes.
THINGTIME_ADMIN_VAULT_KEY="<base64url-32-byte-aes-256-gcm-key>"
# Optional: exact comma-separated hosts allowed for Generic endpoint policies.
# Vercel is built in as https://api.vercel.com; localhost/private/IP hosts are always refused.
THINGTIME_ADMIN_PROXY_ALLOWED_HOSTS="api.example.com"
```

This key also encrypts the dedicated Lopu credential collection. Keep the key
stable across deploys: rotating the environment value without re-encrypting
stored entries intentionally makes them undecryptable. For a fork, create a
new random 32-byte base64url key and add Claude accounts through Admin → CI
Control; never copy Thingtime’s encrypted rows or production tokens.

Do not reuse the JWT, session, peer-discovery, or cron secret. The policy proxy
accepts a saved endpoint id rather than arbitrary URLs; it enforces HTTPS
origins, closed path prefixes, byte bounds, no redirects, and selected read /
create-only / write permissions. The initial Vercel adapter checks for an
existing environment variable before a create-only POST; it never PATCHes or
simulates generic upstream conditional writes.

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

**Set `APP_URL` on every deployment that sends email.** Verification and
password-reset links carry single-use auth tokens, so their origin is never
taken from the request `Host` header. `resolveTrustedOrigin`
(`remix/app/api/utils/auth/appOrigin.ts`) resolves, in order: `APP_URL`; then
the hostname the platform reports for this deployment (`VERCEL_BRANCH_URL` /
`VERCEL_URL`, or `VERCEL_PROJECT_PRODUCTION_URL` on a production target — all
server-injected, never caller-supplied); then, only off-platform, a narrow Host
allowlist for local development (`localhost`, `127.0.0.1`, `[::1]`,
`*.thingtime.com`, `*.ts.net`); otherwise the canonical production origin.
Forks should point `APP_URL` and the canonical origin at their own domain.

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

## Email Delivery And Owned SMTP

Thingtime's long-term email plan lives in
`docs/email-owned-architecture.md`. It covers the migration from provider-backed
sending toward an owned SMTP stack, including Mongo-backed queues/events,
transactional versus newsletter stream separation, inbound/reply handling,
DNS/authentication records, sender reputation warm-up, bounce/complaint
processing, one-click unsubscribe, abuse contacts, and compliance requirements.

Do not send production email directly from feature code. App routes and auth
flows should enqueue mail through the Thingtime email service boundary —
`sendEmail()` in `remix/app/api/utils/email/service.ts`, backed by the
`email_messages` outbox and its deliverability satellites in `FUNDAMENTALS.md`
§3 — so SES, other bridge providers, and the future owned MTA can share the same
templates, events, suppression list, and audit trail. That boundary and its
collections already exist; the plan extends them rather than introducing a
second email path.

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

`develop` is the integration branch; `main` is the release branch. The one
public **Lopu PR manager** workflow owns the branch events and invokes these
protected, non-cancelling maintenance components, giving two complementary ways
to ship:

- **Lopu's per-feature promotion component** (protected implementation
  `github-actions:.github/workflows/promote-features-to-main.yml`)
  scans PRs merged into `develop` and opens one promotion PR per feature
  against `main` (cherry-picked `promote/pr-<n>-<slug>` branches), so every
  change can get a second, release-focused review on its own. PRs that share a
  feature group (a `Promotion-Group: <key>` body line, a `stack:<key>`/
  `group:<key>`/`feature:<key>` label, a `feature/<key>/...` branch, or a
  `feat(<key>): ...` title) are opened as a stacked chain in merge order —
  review and merge bottom-up, deleting each branch on merge. Label a develop
  PR `no-promote` to keep it out of the train; close a promotion PR to reject
  that change for `main` permanently.
- **Lopu's standing develop promotion component** (protected implementation
  `github-actions:.github/workflows/promote-develop-to-main.yml`)
  keeps one standing all-or-nothing PR open (head `develop`, base `main`).
  When everything on `develop` is deemed mergeable, merge it instead of
  merging every feature individually. The two trains never fight: after an
  omnibus merge the per-feature workflow sees the content already on `main`,
  skips it, and automatically closes any open promotion PRs whose diff has
  become empty.
- **Lopu's main→develop synchronization component** back-merges `main` after
  promotions land. Any conflicted candidate is published through the
  automation-owned `sync/main-into-develop` head; Lopu resolves that branch and
  never mutates protected `main` as a PR head.
- Lopu's conflict/rebase lanes keep promotion PRs and stacks mergeable.

A `develop` push starts both promotion components inside its single Lopu run;
a `main` push starts synchronization there; and the six-hour maintenance
schedule enters through Lopu too. The old product-branch promotion/sync
workflow files are removed, so none can compete with or cancel Lopu. Use the
manager's `maintenance_operation` input for explicit recovery.

Lopu's wildcard `all`-branch rebuild lane is likewise concurrency-free at the
listener. Its protected implementation owns the durable `queue: max` namespace;
putting `cancel-in-progress` on the thin caller would cancel the entire
reusable call before that worker queue can retain it.

Fork setup: everything runs with the default `GITHUB_TOKEN`, but promotion
PRs it creates will not trigger CI, and promotion branches touching
`.github/workflows/**` cannot be pushed. Optionally add a `PROMOTION_PAT`
repository secret (fine-grained token with Contents + Pull requests +
Workflows read/write, placeholder value `github_pat_...`) to lift both limits;
`SYNC_BRANCHES_PAT` / `CONFLICT_RESOLVER_PAT` are honoured as fallbacks.

## Branch automation: the `all` wildcard branch

`all` is a generated everything-branch: `develop` + `main` + every open PR
(stacked branch → branch PRs included) merged together, so all in-progress
work can be tried in one place. The one public **Lopu PR manager** calls its
protected internal all-branch implementation to rebuild it from scratch and
force-push the result after pushes to `develop`/`main`, every open-PR lifecycle
change, and the hourly backstop. There is no second product-branch workflow:

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
- Vercel no longer auto-builds `all`; use an explicitly requested
  GitHub-built preview when the aggregate needs browser validation.

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

```sh
VERCEL_API_TOKEN="<vercel-rest-api-token>"
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

A pull request's base branch does not select its Vercel environment. A feature
branch targeting `develop` is therefore still an ordinary Preview unless the
trusted controller in `.github/workflows/develop-pr-preview.yml` explicitly
deploys its exact head SHA to the `develop` Custom Environment. Thingtime now
also assigns the current `develop` runtime variables to generic Preview, so an
ordinary newly built Preview shares the development data/services even without
the controller. The controller remains responsible for the stable
`pr-<number>.previews.dev.thingtime.com` alias, identity/SHA gates, status
comment, and marker-scoped cleanup.

The workflow deliberately separates authorization, compilation, and
publication. Product branches retain only a
thin event listener pinned to the reusable implementation on the protected
`github-actions` branch. Its `pull_request_target` job has no environment or
Vercel secret, checks out no code, and emits only a bounded
`repository_dispatch` payload. The protected authorizer checks out only
`github-actions`, proves the source workflow path/run, repository,
same-repository PR, head SHA, action, and triggering actor through GitHub's API,
then re-reads the live PR. Both the PR author and triggering actor must be
explicitly allowlisted, currently hold write/admin permission, and the
non-draft PR must still target `develop`.

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
