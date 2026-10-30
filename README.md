# `github-actions` — the CI control plane

This branch is **not** the application. It carries the repository's executable
CI and nothing else:

```
.github/workflows/   the real workflow implementations
.github/scripts/     the automation they run (promoter, contracts, changelog)
.github/actions/     composite actions they call
vercel.json          the Vercel Git-deployment kill-switch
```

The [protected unsigned native compile lane](.github/NATIVE_COMPILE.md) accepts
an explicit owner PR/head SHA after independent controller/listener admission.
Candidate files remain opaque data until kernel network denial and a fresh
unprivileged build identity are active; it has no signing or release path.

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


Lock ownership is published as a populated directory in one atomic rename.
Each attempt has a unique owner filename; cleanup removes only that record
and uses non-recursive directory removal, so a delayed cleanup cannot delete
a replacement writer. Queries hold the same lock through the Graphify child
process, including any cache-miss refresh, to keep their snapshot and aliases
available until the read finishes. Concurrent requests wait rather than
rebuilding or pruning each other's selected snapshots.

Finish already-running Graphify commands before updating the wrapper in a
checkout: older router processes use an incompatible recursive cleanup path.
The new router waits for live legacy owners, recovers exited legacy owners,
and refuses to guess when an owner record is malformed. The default wait is
two hours; `GRAPHIFY_CAS_LOCK_TIMEOUT_MS` accepts finite non-negative
milliseconds (`0` performs one acquisition attempt).

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

## Environment gateways for future product builds

The protected publishers select the backend bootstrap; product builds contain no
Vercel token, Mongo credential or gateway signing secret. `environment-gateway-policy.mjs`
maps production to `https://thingtime.com`, custom develop to
`https://dev.thingtime.com`, and standard preview to
`https://master.previews.thingtime.com`. The preview master is a separate
preview-target build of the trusted current `main` source, never whichever PR
published last. Its Vercel preview scope uses the existing development Mongo and
auth/signing configuration; production retains production scope. Develop keeps
its existing custom environment and source branch. Ordinary protected PR previews
retain the custom `develop` credential and build target while using the controlled
standard Preview gateway; their existing
`pr-N.previews.dev.thingtime.com` URLs remain compatibility names rather than
indicating the runtime environment. Older custom-develop deployments are not
reused or mass-deleted during this migration.

Bootstrap setup requires one encrypted `THINGTIME_GATEWAY_SECRET` (at least 32
characters) in each selected Vercel scope: production, preview, and custom develop.
Keep it in the authorized Vercel secret store or the canonical server vault;
never put values in workflow inputs, GitHub artifacts, command arguments or docs.
The secret is irreducible bootstrap authority for authenticating the relay before
Mongo/vault access. Environment and canonical origin are protected publisher
constants, passed by environment-variable key name through the child environment.
Missing encrypted secret metadata refuses publication before upload. The protected
workflow accepts `build_only: true` to create exact-source artifacts without
uploading or changing aliases; production builds also emit the separate preview
master artifact. This supports deployment-scoped owner bootstrap before scoped
project settings are activated. The project
remains Git-disconnected and prebuilt-only; no native branch-variable feature is
assumed.

New product bundles default to proxy mode and can explicitly opt into their own
backend through their documented bundled policy or
`THINGTIME_MONGODB_CONNECTION_MODE=dedicated`. Ordinary branch publications do
not override that choice. The three canonical gateway owners are explicitly
forced to proxy mode, preventing an inherited dedicated override from converting
a shared gateway into a branch backend. An unknown environment mapping fails
closed. Existing immutable deployments are allowed to age out naturally; this
policy does not revoke their credentials or claim their background pools stopped.

The stable publisher records gateway provenance and rejects old READY deployment
reuse. Production uses `--skip-domain`; the pinned CLI does not support that flag
for custom targets. All applicable alias bindings are therefore snapshotted
before every upload, then verified after publication. Exact canonical manifest
identity and ordinary API/static reads allow up to 90 seconds for edge propagation,
with bounded backoff and an abort deadline. Safe mismatch diagnostics include only
public owner identity, HTTP status and allowlisted cache indicators; secrets,
cookies and raw response bodies are excluded. Failure restores bindings
still owned by that attempt, without overwriting a concurrent operator. The PR
preview controller never promotes `dev.thingtime.com`; only the stable publisher
owns that canonical alias. Source must support the gateway capability before an
owner can pass the exact manifest and API checks. Keep the old production/develop
bindings until bootstrap has passed review and each environment can be activated
and verified independently.

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

### Missing-build wildcard page

Preview wildcards must not impersonate the live application when an exact PR
alias is absent. The control plane can stage a fixed-HTML missing-build page
and assign only `*.previews.dev.<domain>` and `*.previews.<domain>` to it.
It returns `x-thingtime-preview: missing` with `Cache-Control: no-store`,
links to the matching PR, and reloads only when the user clicks
**Try again**. Real PR aliases remain more specific and continue to point at
their exact READY deployments. The public root domains are never changed.

Fork-safe rollout (all identifiers below come from your own Vercel project):

1. Set `GITHUB_REPOSITORY`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`,
   `VERCEL_TEAM_SLUG`, `PREVIEW_ALIAS_SUFFIX`, and
   `PRODUCTION_PREVIEW_ALIAS_SUFFIX` in the operator environment. Supply
   `VERCEL_API_TOKEN` through your approved secret store, never a command-line
   argument, checked-in file or PR message.
2. Run `node .github/scripts/provision-preview-fallback.mjs --stage`. The pinned
   publisher uploads only generated static output to a Preview deployment.
   Staging never assigns either wildcard; inspect the returned URL in a browser
   and verify root, nested paths and the manual retry control.
3. Once the updated controller is merged and older preview publishers have
   finished, run `--install <STAGED_DEPLOYMENT_ID>` with the same environment.
   Both exact project/wildcard identities and the staged content digest are
   checked before any mutation. Ambiguous writes are reconciled by read-back.
4. Set the protected `vercel-develop-pr-control` environment variable
   `PREVIEW_MISSING_BUILD_PAGE=true`. Future publishing and scheduled checks now
   require the marked missing-build page instead of the legacy live-site fallback.
5. Verify an unused PR hostname in both namespaces, root and nested paths, plus
   existing exact PR aliases and both live root domains. Rerun a real preview.

Both wildcard domain records are bound to the non-product `github-actions`
branch, whose checked-in Vercel kill-switch prevents automatic Git deployments.
The static deployment is explicitly assigned; future main/develop releases
cannot silently move those wildcard domains back to the live application.
Leave this branch's kill-switch enabled. To update the page, stage the new
digest and reinstall the verified deployment. The fallback has no application
code, functions, API endpoints, environment reads or automatic polling.

Vercel's existing project-wide directory-listing setting replaces any 404 at
`/`, even a function response, with a file list. To leave that setting and the
live app unchanged, the default root is an explicitly marked HTTP 200
"soft 404"; all other paths return HTTP 404. The publisher checks the missing
marker before accepting any HTTP status, so neither response can count as a
valid preview. Projects without directory listings can stage with
`PREVIEW_FALLBACK_ROOT_STATUS=404` for a true root 404. This tool never changes
the project-wide directory-listing setting.

### Orphan deployment cleanup (2026-10-30)

The existing protected preview controller now scans the complete project deployment
inventory before each six-hour recovery sweep and on PR close. It removes actual
Vercel deployments (including their immutable URLs), rather than only removing
PR aliases. Legacy source-build previews and ordinary prebuilt branch previews
are included when exact source/project/repository ownership is established and
no open same-repository PR uses the branch. Open drafts still protect their
branch from this orphan sweep; the existing current-policy draft cleanup remains
separate. Closed PR events also inspect branch previews without PR metadata.

Production targets, untagged main/develop/staging/controller/fallback branches,
gateway owners, production/custom stable target pointers, all bound project domains, arbitrary
custom aliases, foreign identities and unknown metadata are preserved. Explicit PR-tagged snapshots of closed promotions may be cleaned
even when their source branch is `develop`; current owners and bindings remain
protected. The controller paginates before deletion and rechecks deployment, alias and PR state
before canceling or deleting; the generic `targets.preview` last-deployment
pointer does not protect an orphan; a reopened/new PR or changed alias stops the action.
A still-canceling upload is left for the next sweep. Provider errors preserve
unknown resources and fail the run. Separate API checks are not an atomic
provider transaction: a subsequent sweep reconciles a concurrent late upload.

Ordinary prebuilt feature previews now require an open same-repository PR before
build planning, upload, immutable acceptance and alias publication. A PR closed
during upload causes guarded removal of that exact deployment. Stable gateway
publication is exempt. All three preview publishers additionally read the exact
immutable source SHA and require Mongo's connect fence, gateway middleware,
authority and explicit connection policy. Old source fails admission even if
publisher metadata claims gateway support. This is a compatibility gate, not
proof against hostile source or a measurement of live Mongo connections. The
existing explicit `dedicated` branch opt-in remains supported; missing/old
source never falls back to it. The PR publisher retains its exact-head fences.

The saved admin policy is the only retention configuration. Protected jobs
negotiate `api.integration-ci-preview-retention` 1.0.0 and its POST operation at
`THINGTIME_PREVIEW_POLICY_ORIGIN` (default `https://thingtime.com`), then read
`/api/v1/integrations/ci/preview-retention`. Requests use the existing
`THINGTIME_CI_ROUTER_SECRET` and the CI HMAC header, with repository,
`ref: "github-actions"` and a fresh ISO timestamp. That secret is supplied only
to protected controller steps; untrusted builds receive none. No separate
controller retention defaults or public settings fallback exist.

The product admin settings own `enabled`, `noOpenPrGraceHours`,
`pruneSupersededOpenPr`, `supersededGraceHours` and optional
`inactivePullRequestDays`. No-open grace uses the later deployment creation or
known PR close time; untagged branch snapshots use creation age. Superseded
pruning waits for the replacement's grace and keeps the newest READY live-head
preview plus active builds. Opt-in inactivity expiry uses fresh GitHub
`updated_at` (including GitHub's normal automation activity), deletes previews
without closing the PR, and prevents recovery/publication until new activity.
Expired-open cleanup avoids comments/labels that would reset that clock.

Disabled cleanup, grace-retained objects and protected owners are not marked
removed or inactive. Missing/invalid/unreachable policy preserves resources and
fails the run; there is no destructive fallback. Each cancel/delete fence reads
fresh policy, so disabling it stops the next mutation. Stable
production/develop/staging publication does not depend on policy API availability.
Explicit admin removal of a selected environment remains a separately requested
operation; retention policy does not grant permission to delete stable services.

Rollout order: deploy the product settings endpoint/capability first and verify
its signed read in CI, then merge this controller into `github-actions`. The
existing default-branch listener already supplies close events and the six-hour
schedule, so no new main listener or cron is needed. Existing old runs may still
hold their earlier source snapshot. No live acceptance is established by local
fixtures.

For immediate acceptance, an allowlisted maintainer with current repository
write/admin permission can use the existing listener's zero-PR reconciliation
mode. It authorizes the triggering actor, builds no PR code, fetches saved policy
and runs only retention reconciliation:

```sh
gh workflow run develop-pr-preview.yml --repo lopugit/thingtime --ref main -f pr_number=0
```

Inspect the resulting workflow's sanitized counts and exact provider readback;
repeat for idempotence and verify unchanged production/develop/staging/master
aliases. This dispatch uses GitHub's existing protected secret; do not retrieve
CI secrets locally or bypass capability/actor checks to run acceptance.

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

### Use the saved admin model waterfall

GitHub Lopu reads the complete `Thingtime.PRConflictAutoResolverModelWaterfall`
from the configured Thingtime origin at each invocation. Provider, model and
reasoning effort come from that setting. The native Claude and OpenAI adapters
run in the saved order; no Astra-specific model or fallback order is built in.
For example, append **GPT-6 Astra · Medium** in Admin → AI Providers and save to
use it after Claude, or move it first to make it primary.

Store enabled named credentials under the matching **Anthropic** or **OpenAI**
platform in the shared encrypted vault. `OPENAI_THINGTIME_API_KEY` is a suitable
OpenAI credential name; the value must be an OpenAI Platform API key. GitHub only
needs `THINGTIME_CI_ROUTER_SECRET` and the trusted vault origin. It does not need
a separate OpenAI repository secret. Accounts are attempted in their saved vault
priority within each configured model entry. Missing account credentials advance
to the next configured entry; malformed settings, unsupported providers/speeds,
invalid manifests and ambiguous errors stop without inventing another model.

Only explicit credential or capacity failures advance the waterfall. Ordinary
task failures remain failed runs. OpenAI calls use the native Codex action and
Responses API with the configured effort. Actual provider outputs guard Claude
session continuation. Keys are masked and cached privately for raw/base64
publication scans; generated action helpers and the plan are verified before
each operation. Legacy model selector inputs are accepted for caller compatibility
but do not override the admin setting. Custom Feature Stack endpoint waterfalls
remain independently configured.

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
selected Vercel runtime environment and must not be copied into the build job.

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

### Stable develop domain

For a hosted `develop` URL, keep the Vercel Custom Environment's exact
`develop` branch matcher and leave its domain list empty. Bind the stable domain
to the `develop` branch; only the protected stable publisher may promote the
verified prebuilt gateway owner. The ordinary PR controller never promotes it.

Ordinary PRs continue to build and deploy in the custom `develop` Vercel target,
with its existing credential scope. The protected publisher injects the one
unbranched standard Preview signing secret only into the upload child process,
and sets the logical gateway to `master.previews.thingtime.com`. Their existing development
PR hostnames remain compatibility URLs. The pinned CLI supports `--skip-domain`
only for production, so do not add that flag to preview/custom uploads. The
publisher must preserve unrelated canonical and branch aliases when uploading
and assign only the exact verified PR alias. Legacy custom-develop deployments
are excluded from the new provenance policy and cleanup selection.

Keep the development PR wildcard's existing branch binding. The production
preview wildcard stays detached rather than attaching to a Custom Environment;
exact controller-owned aliases override these fallback names. The controller
checks its project bindings and verifies the current trusted-main preview
master manifest and real API before publishing a new PR follower.

Every open, ready, same-repository PR from an allowlisted author is eligible,
regardless of whether its base is `develop`, `main`, or another feature branch.
The controller revalidates the exact live ref and SHA before publishing, while
the deployment itself keeps the custom Vercel `develop` environment and its
existing credentials. A closed former parent PR therefore cannot strand a child PR, and
forks, drafts, stale dispatches, or users without current write access still
receive no credentialed preview. As soon as authorization succeeds, the
controller posts the expected persistent URL and a clearly labelled UTC ready
estimate before product checkout, dependency installation, or build. The
publisher preserves that original estimate when it adds the immutable URL and
terminal status. Both secretless build paths retry only the pinned pnpm
bootstrap after transient package-registry transport failures.

The admin CI page can additionally store a bounded Develop/Production preview
policy and send it through the `thingtime-ci-control[bot]` GitHub App. The
product backend has no Vercel publishing path: `.github/scripts/deploy-admin-pr-previews.mjs`
owns deployment creation, marker-scoped cleanup, exact-SHA READY aliasing, and
the single PR comment. It writes the expected persistent URLs and estimated
ready time before contacting Vercel, then adds each immutable snapshot URL as
soon as Vercel returns it. Production selection targets the Vercel production
runtime but never auto-assigns a production domain; it uses only the separate
PR-scoped production-preview wildcard. Set `ADMIN_PREVIEW_DISPATCHER_LOGIN` to
the exact installed GitHub App bot login. Use domains and environment ids from
your own Vercel project; never copy another project's account-specific
identifiers or verification records.

## Desktop and Recovery release pipeline

`electron-release.yml` delegates main publication to the same protected worker
as `electron-pr-release.yml`. Only a main push or owner dispatch can select main;
PR callers retain the owner/same-repository/desktop-release label gate. Reusable
workflows retain the original caller event, as documented in
[GitHub's context rules](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).
Both lanes test and package desktop plus Recovery ZIPs before publication.

Keep the product main-release listener's permissions at `contents: write` and
`pull-requests: read` to permit the nested worker. Roll out that listener through
the regular product promotion. Do not merge this control-plane branch into the
application. Manual owner dispatch from `github-actions` can verify an approved
product PR independently of main promotion.

Signing still requires all six existing repository secrets: `MAC_CSC_LINK`,
`MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`, and `APPLE_TEAM_ID`. Use your own account's credentials;
configure none to produce the explicit unsigned lane, or all six for Developer
ID plus notarization. Partial configuration fails. Unsigned builds are marked
in tags, filenames and notes, are prereleases, and never become latest.

### macOS signing and build identity

The Electron/Recovery worker passes `GITHUB_RUN_NUMBER` as
`THINGTIME_ELECTRON_BUILD_NUMBER`, so native bundle and embedded web metadata
retain the cloud build identity. Configure `MAC_CSC_LINK` (base64 encrypted
Developer ID P12), `MAC_CSC_KEY_PASSWORD`, and `APPLE_TEAM_ID` as Actions secrets.
Notarization accepts explicit `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER`, falling back to the approved iOS CI `ASC_KEY_CONTENT`,
`ASC_KEY_ID`, and `ASC_ISSUER_ID` only after macOS signing is configured. Both
key-content forms are base64 encoded. An iOS-only setup retains the explicit
unsigned fallback; partial macOS signing still fails closed. No credential
material belongs in this branch. Regression coverage executes the actual
selection and version shell in `.github/scripts/electron-release-gates.test.mjs`.


## Commander signed releases

`commander-release.yml` admits main pushes and owner dispatches on main or
`github-actions`, resolves the immutable main commit, and builds Commander plus
Thingtime Recovery for Apple silicon. Source TypeScript/Rust/Swift tests run
before credential import. ZIPs use Recovery-compatible `Commander-App-Release-`
and `Thingtime-Recovery-App-Release-` names and include `SHA256SUMS.txt`.
Each archive is notarized, stapled, extracted and verified before one publication;
Commander uses `--latest=false` to preserve Electron's latest release.

Configure encrypted `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_TEAM_ID`, and
`APPLE_API_KEY_BASE64` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`. The notarization
key also accepts the existing `ASC_KEY_CONTENT` / `ASC_KEY_ID` / `ASC_ISSUER_ID`
secrets. Missing credentials fail closed; no unsigned fallback is published.
Fork maintainers must deliberately configure their own repository guard, protected
controller reference and signing secrets. Private material is imported into a
temporary Keychain and deleted by the always-run cleanup step.

Run `node --test .github/scripts/commander-release.test.mjs` for caller admission,
main-SHA selection, API-error handling, credential timing and asset publication
regressions. The product source owns Commander packaging and Recovery behavior.

## PR delivery regression checks

The preview publisher maintains a marked summary at the top of each product PR
description as well as its detailed comment and labels. It refreshes building,
failed and ready states for the current head, preserves author prose, and refuses
ambiguous markers. A preview being ready does not mean CI or mergeability is green.

The conversation filter is intentionally skipped for non-comment events. Every
routing descendant needs an explicit status predicate plus successful direct
dependency guards, or Actions can silently skip conflict detection after a
successful route. The event tests traverse the actual job graph to enforce this.

After publication the resolver checks the live target ref, rather than GitHub's
cached PR base SHA. A moved target reuses the existing three-retry detector queue;
it preserves pause and ownership rules and cannot overwrite a newer head.

Manual acceptance: verify a push and a scheduled non-comment run execute
conflict detection, a repaired PR reports live mergeability, and its current-SHA
preview is visible without expanding comments. A moving target must leave a
requeue notice rather than overwrite it with a resolved claim.
# Prebuilt-only Vercel deployments

`.github/workflows/deploy-vercel-prebuilt.yml` builds product commits on
standard GitHub-hosted Ubuntu runners and uploads only validated Build Output
API artifacts. Its build job receives no deployment credentials. Prepare and
publish use the protected `vercel-prebuilt-control` environment, with secret
`VERCEL_DEPLOY_TOKEN` and variables `VERCEL_PROJECT_ID`, `VERCEL_PROJECT_NAME`,
`VERCEL_TEAM_ID`, `VERCEL_TEAM_SLUG`. Configure those for your own Vercel project
when forking; never copy another account's values or credentials. Its deployment
branch policy must admit the exact canonical `github-actions` branch for direct
build-only dispatches, alongside the existing default-branch listeners. Preserve
all other environment protections.

The product default branch carries a thin push/manual/workflow-run listener.
Current default-branch source maps to production, Vercel custom branch matchers
select custom environments, and other product branches select Preview.
Requested push runs of Web CI and Lopu CodeQL also wake the default-branch
listener for older product branches. Same-SHA READY deployments skip rebuilds;
stale events skip; production source must equal the current default branch.
Existing PR-specific preview controllers remain GitHub-built and continue
their private development-storage checks and exact-SHA alias management, with
ordinary PR followers using the controlled Preview gateway through custom `develop`.

Vercel's native Git integration and source deploy hooks are disconnected at
cutover. An absent native Git link is valid; a present mismatched link still
fails preview project validation. Vercel runtime configuration remains on its
selected environment and in the vault. The publisher independently fetches
immutable source configuration for region/Fluid/production-cron settings and
never executes product source. See the product README and VERCEL_DEPLOYMENTS.md
for deployment receipts and the manual entry point.
