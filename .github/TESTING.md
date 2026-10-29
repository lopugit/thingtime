# Control-plane regression checklist

## PR lifecycle settlement (2026-09-16)

- Run `node --test .github/scripts/lopu-pr-lifecycle.test.mjs`.
- A managed promotion/Feature Stack with only Graphify artifacts closes after
  two complete file inventories and fresh ref checks. Ordinary graph work,
  renames from source files, partial listings, drafts and pause labels survive.
- Merge only a finished PR with an exact-head/base Lopu APPROVE review, no
  requested changes or unresolved threads, current successful build/API/CodeQL
  checks, and two complete readiness snapshots. Never bypass protection or
  enable auto-merge on an unchecked head. Changed refs defer to another sweep.
- Inspect a dry run before rollout, then the actual scheduled/manual lifecycle
  job. A failed API read must defer that PR while allowing the rest to proceed.
- This repairs the backlog where already-landed promotions were repeatedly
  resolved and reviewed solely for generated snapshot differences. Lopu now
  records a durable approval when review is finished; a separate metadata-only
  job owns closure/merge. No PR code executes in that writer.

This branch contains no application. Its rollout target is `github-actions`;
do not merge it into the permanently separate product branches to test it.

## Cooperative review handover

- Run `node --test .github/scripts/lopu-cooperative-review.test.mjs`.
- Verify a real pending fleet member signals only the active reviewer, after
  five minutes; API errors, malformed inventories and unrelated jobs do not.
- Verify parallel hook calls serialize, requests latch, and polling is bounded.
- Verify Claude hook delivery in a harmless local fixture; preserve settings on
  exact-session continuation and the same protocol in the Codex prompt.
- Finish at least one PR before yielding. Completed reports permit the existing
  publisher; dirty/unreported work and active Git operations block handover.
- Only completed records feed publication, comments, and CodeQL dispositions.
  Untouched PRs must not receive a successful-review comment.
- Preserve only PR-number metadata in the artifact, and queue the remainder
  after successful publication. Resume against fresh eligibility and heads.
- Never cancel an active worker or publish an incomplete PR to test handover.
- Preview recovery: an initial comment-write 403 must be retried through the
  corrected protected controller, not by editing product code or loosening the
  secretless build boundary. Verify the final exact-SHA comment and both URLs.

## Missing-build wildcard fallback

- Run `node --test .github/scripts/preview-fallback.test.mjs`. Verify root
  soft-404/nested 404 and no-store routing, marked HTML, hashed CSP, exact-host PR links,
  no automatic polling, target scoping and accepted-but-lost write recovery.
- Stage before assigning: check both `/` and a nested route on the immutable
  URL. A Vercel directory listing or app shell is a failure, even if the API
  calls say READY. Root HTTP 200 requires the missing-build header, no-store and
  the exact marked page; nested paths remain HTTP 404.
- In a live browser, check desktop/mobile layout, scroll to the bottom, activate
  Try again and Open pull request, and check the page/URL afterwards. No reload
  loop, overflow, clipped controls, CSP errors or unexpected redirects.
- Only the two verified preview wildcards may change. Production deployment
  targets, foreign marker/content metadata and unexpected domain bindings fail
  before mutation. Keep exact PR aliases and main/develop root domains intact.
- After rollout enable the protected mode variable, test unused hostnames in
  both environments (including nested/API paths), and verify exact existing
  preview aliases still serve their recorded SHA. Missing pages and arbitrary
  HTTP 404 responses must never count as a successful preview publication.

## Preview labels and missed-build recovery

- Run `node --test .github/scripts/preview-*.test.mjs` and both preview
  publisher self-tests. Test DST/midnight, multi-environment labels, stale heads,
  shared/foreign label ownership, accepted-but-lost writes, and failed phases.
- A repeated READY receipt must preserve the actual Vercel completion timestamp
  and the same comment ID. Building/failed/removed status keeps the last success;
  cleanup must not put labels on an unrelated PR that never had a preview.
- The scheduled open-PR inventory must include eligible PRs with no Vercel
  objects. Existing READY exact-head deployments repair status without a build.
  Active native queues/builds, forks, drafts and controller-only heads do not
  dispatch. Bad metadata fails closed and does not block other PRs' inspection.
- Recovery receipts must precede dispatch, survive an uncertain response, impose
  a cooldown and stop after three attempts per commit. Recovery provenance must
  bind the fixed scheduled default-branch workflow and Actions bot sender.
- After merging to `github-actions`, rerun an eligible preview and inspect the
  exact head, immutable/persistent URLs, actual READY time, same comment ID and
  sidebar labels. Run the scheduled sweep and record its outcome; report any
  unverified environment or exhausted build instead of claiming universal health.

## Event feedback and CI cancellation

- Run `node --test .github/scripts/control-plane-events.test.mjs .github/scripts/preview-comments.test.mjs`.
- Verify owner-PAT and bot status comments stop before provider routing or model
  work; human questions, quote replies, and fenced examples still pass.
- Verify standalone trailing markers, marker removal, no-op edits, deleted
  queued comments, wrong-PR comment IDs, and metadata failures cannot start a
  model. Other PR, push, schedule, and failed-check signals must retain routing
  when the conversation job is skipped.
- Verify every rebase comment-producing step has an unconditional marker.
- Verify both preview writers preserve human comments, update the same owned
  ID, skip identical bodies, paginate, and refuse incomplete/failed scans.
- Run `node .github/scripts/deploy-develop-pr-preview.mjs --self-test` and
  `node .github/scripts/deploy-admin-pr-previews.mjs --self-test`; controller-only
  heads must skip builds, while non-404 contents failures remain visible.
- Run both `resolve-pr-conflicts-routing-contract.mjs --self-test` and
  `workflow-control-plane-contract.mjs --self-test`, plus every check in the
  control-plane CI required `verify` lane. Parse YAML and check script syntax.
- After publishing, inspect checks on the exact pushed head. After rollout,
  inspect naturally arriving preview/comment runs: marked automation should
  skip conversation admission and routing with no Lopu worker. Inspect an
  unrelated simultaneous CI run to confirm it retains its own concurrency key.
- Record observed run IDs and conclusions. A replay or local test is not live
  proof; a cancelled run is not proof of a code failure. Do not rerun or repair
  unrelated work just to turn historic checks green.

## Explicit stack model and endpoint waterfall

- Run `node --test .github/scripts/feature-stack-waterfall.test.mjs` and
  `node .github/scripts/feature-stack-plan.mjs --self-test`. The real Git
  fixture must preserve both-parent topology and the exact source trailers.
- Run the routing and workflow-control-plane contract self-tests. Version 3
  keeps the existing CLI path; version 4 runs the selected HTTP waterfall.
- Verify mixed providers advance only after a signed gateway request receives
  an explicit unavailable receipt. Lost responses, rejected authorization,
  malformed resolution JSON, symlinks, binary and oversized conflicts stop.
- Deploy the matching Thingtime `api.ci-stack-completion` 1.x gateway and
  configure `THINGTIME_CI_ROUTER_SECRET` on both sides. Configure HTTP API keys
  server-side or choose owned Secure Vault connections; subscription CLI
  tokens continue to use the inherited version-3 path. Never put endpoint
  credentials in a plan, runner response, artifact, or log.
- After both PRs are deployed, accept a controlled stack using unavailable
  preferred endpoint then a working fallback. Inspect the exact selected order,
  independent verifier and required CI before publication. Local fixtures do
  not constitute paid-provider or production merge acceptance.

## Feature Stack snapshot publication and merge gates

- Run `node --test .github/scripts/feature-stack-publish-merge.test.mjs`,
  `node .github/scripts/feature-stack-plan.mjs --self-test`, and
  `node .github/scripts/feature-stack-progress.mjs --self-test`.
- A source PR that advances or merges after admission must still publish the
  captured SHA, with the exact merge parents checked by the history verifier.
  Identity changes, drafts, closed-unmerged PRs and explicit pause labels stop
  publication. Admission still authenticates the initially captured head.
- On an unprotected target, simulate the auto-merge rejection and verify two
  complete passing check snapshots precede a normal exact-head merge. Failed,
  missing, pending, stale-head and later-page checks cannot bypass the gate.
- A lost successful merge response reconciles the existing PR before retrying;
  unrelated authorization errors must never select the fallback merge path.
- A failed target publisher ends its confirmation job immediately; the progress
  reporter must not let a still-running gate conceal that failure at 99%.
  Other successfully merged targets retain their success receipts.
- After rollout, inspect an actual run's publisher, confirmation jobs and final
  dashboard receipt. Local tests alone do not establish live recovery.

## Feature Stack run status conversations

- Run `node --test .github/scripts/feature-stack*.test.mjs` and the progress
  reporter self-test. Waiting gates must not count as active model work; failed
  publishers remain failed. A published PR never counts as a confirmed merge.
- The product must advertise origin-scoped `api.integrations-ci-chat` 1.x before
  the worker polls. Missing/incompatible discovery disables chat only. Deploy the
  matching product PR before verifying a newly started live run.
- The progress job uses the existing vault origin/router secret and shared Claude
  model/credential waterfall. Claude is pinned; its status session runs in an empty
  temporary HOME/cwd, with no tools, MCP servers, source checkout, GH token, router
  secret, settings, plugins or persisted session. Test provider credential fallback.
- Ask a harmless status question on a test run; compare with GitHub's actual
  jobs/steps and exact stack-branch target PRs. Ask to restart: no mutation occurs.
  This is a responder alongside the workers, not their private model session.
- Verify uncertain reply delivery retries the original lease without generating
  another answer. Expired/replaced leases and older workflow attempts must not
  overwrite a newer answer. Ended/paused/stopped/replaced runs claim no new work.
- Cancel the test responder: the product shows offline within 150 seconds. Confirm
  merge workers continue if the optional model setup or mailbox service fails.
- Product UI coverage includes desktop/mobile overflow, long messages, queued /
  answering / failed / answered states, manual refresh, retry and legacy runs.

### Protected manager invariants

Lopu PR manager protected control plane. Product branches are thin reusable
workflow callers pinned to @github-actions; external events only detect work,
and bot-authenticated workflow_dispatch runs perform secret-bearing repairs.

Security invariants: exact live PR and branch SHAs are revalidated before
checkout, model execution, and publication; fork, protected-head, default-branch,
and user-paused PRs are rejected; git hooks and persisted checkout credentials
are disabled; model output is scope-checked before an exact-lease push.

Detailed behavior is enforced by resolve-pr-conflicts-routing-contract.mjs and
the comments beside each job and publication boundary below. Keep this file
below the guarded byte limit: GitHub leaves oversized revisions permanently
pre-queued with no jobs, logs, or cancellable run graph.

## Exact configured workflow model orders

- Run `node --test .github/scripts/admin-model-order.test.mjs`. Resolver,
  rebase and build doctor retain configured compatible entries without adding
  default. Missing, invalid, incompatible-only and oversized orders stop before
  a model invocation. An explicitly selected default retains its position.

## Configured cross-provider waterfall

- Save Claude High → Astra Medium, then the reverse order, and verify the run's
  actual models/efforts match each saved plan. No environment selector overrides it.
- Exercise exhausted/invalid provider credentials and verify the next configured
  entry runs. Ordinary task errors must stop. Verify selected Claude continuation
  never resumes after an OpenAI attempt.
- Test missing OpenAI credentials, invalid settings and incompatible capability
  manifests. No unconfigured model may run or credential value enter logs/commits.
- Run `node --test .github/scripts/admin-model-order.test.mjs .github/scripts/lopu-credential-vault.test.mjs`.
# Prebuilt-only deployments (2026-10-23)

## Storage release protection (2026-10-29)

- Run `node --test .github/scripts/storage-release-gate.test.mjs .github/scripts/deploy-vercel-prebuilt.test.mjs .github/scripts/environment-gateway-policy.test.mjs`.
- The existing required `control-plane / Build + typecheck ratchet + unit tests` context checks public production Nitro storage readiness in both full and lightweight paths. An HTTP-200 degraded body, unavailable endpoint, wrong origin, incompatible capability or missing storage status must fail the check. No new ruleset exemption or credential grant is needed.
- Publication uses two phases because an immutable candidate remains a proxy follower until the canonical alias elects it. Before any alias changes, verify its platform project/source/target/policy identity, local manifest origin/gateway deployment identity, `api.health-nitro >= 1.3.0` with its GET operation, shared `api.storage-accounting >= 1.0.0` (matching major 1), candidate-scoped runtime logs, and the **current canonical owner's** honest storage readiness bound to the snapshotted deployment ID. Do not call the candidate's health API or claim its storage census passed in this phase: it would proxy to the older owner, and local health getters can perform collection adoption and error-log writes. No pre-promotion database admission exception is allowed.
- Promote the canonical alias first, immediately verify its newly selected gateway identity and full storage readiness at health 1.3/storage 1.0, then move and verify secondary aliases. Only this post-promotion check exercises the candidate's own census. Existing bounded alias verification allows ownership/cache convergence and recovering queues to drain; they must reach exact `ready`. Failure rolls back only bindings still owned by this attempted deployment, using the pre-upload snapshot; concurrent operators' bindings remain untouched. This has a bounded post-promotion acceptance window rather than a guarantee that a candidate census ran before traffic moved. No success status is written until all aliases pass.
- A changed canonical owner aborts pre-promotion verification. Reuse an exact READY deployment/artifact on recovery, preserving all metadata and log gates. Premerge/current-owner checks accept repaired health 1.2.0 without the new shared feature so the first stronger contract can roll out. Unprivileged controller PRs test their exact candidate gate; product PRs always load protected controller code.
- The protected runtime monitor is called by the product default-branch thin listener `storage-release-monitor.yml`, every 15 minutes and after deployment completion. Activate the controller PR before that product listener. It reuses `vercel-prebuilt-control`'s existing `VERCEL_DEPLOY_TOKEN` and project/team vars; it does not create an admin token or run production migrations.
- Verify one live manual monitor run, not only fixtures: resolve `thingtime.com` to its current project-owned production deployment, negotiate health on that origin, then query that exact deployment's last 30 minutes through pinned Vercel CLI 59.10.0 `logs --project ... --deployment ... --environment production --since ... --until ... --level error --level fatal --limit 500 --json --no-follow`. Pass the token only in `VERCEL_TOKEN`. Current [CLI docs](https://vercel.com/docs/cli/logs) describe newer flags; use the pinned package's `logs --help` for this implementation. Query all error/fatal rows before local storage classification so an allowlisted structured code cannot be hidden by a prose-only provider search.
- Capture CLI output only in memory; report aggregate counts or fixed failure codes, never raw provider stdout/stderr, messages, URLs, account identifiers or credentials. Access failure, invalid JSON, message truncation and a saturated result window fail closed. Classify legacy migration prose plus the authored `STORAGE_MIGRATION_REQUIRED`, `STORAGE_RECOVERY_BUSY`, `STORAGE_ACCOUNTING_UNAVAILABLE` and `STORAGE_INVARIANT` codes (and fixed recovery message) emitted by the dispatcher/storage boundary. Generic unrelated HTTP 503 prose alone is not a storage classifier. Provider retention and best-effort application log capture bound detection; healthy sampled logs alone do not prove a real account write succeeded.
- The monitor publishes a source-specific `Production storage runtime` commit status and a failing workflow run. Deduplicate unchanged status state/description and stop stale observations when the production alias moves. A success requires both current readiness and no matching errors in the complete bounded query. Review the workflow failure before any recovery; no automatic migration or destructive repair is granted by this gate.
- Required Web CI's API-suite job runs `pnpm run test:storage-recovery:integration` whenever the product script exists. On Linux it explicitly selects Docker: an owned unique `mongo:7` container, loopback-only random port with host networking, tmpfs data and scrubbed child environment. It must not borrow the suite's existing MongoDB service or any host data directory. Script/package failures fail the required job; only historical script absence skips. Locally the same script resolves `mongod` from PATH or the explicit test-only binary override. Verify concurrent 100MiB admission, rollback, exact independent census and repeated drain through the real integration, plus exact container/process/temp-directory cleanup.

## Prebuilt artifact acceptance

- Prebuilt publication must write the immutable source cron list into Build Output API `config.json` for Production only, and set each function region from that source. Verify the live deployment reports Sydney only and the active project cron list contains all seven expected schedules. A changed output-policy marker must replace older READY artifacts.

- If publication stops after Vercel becomes READY, a fresh run skips compilation
  and upload, then recovers aliases and the GitHub status. Repeating a completed
  run must not write identical alias bindings or status receipts again.

- Prepare and publish may reuse the existing repository automation credential
  when available; product build jobs must never receive it. A READY deployment
  must finish branch verification, aliases and its GitHub status receipt.

- The publisher must pass both `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` to the
  pinned CLI, matching the authorized project even if inherited values differ.

- Run `node --test .github/scripts/deploy-vercel-prebuilt.test.mjs`, the existing
  preview controller self-tests and `extract-vercel-prebuilt.py --self-test`.
- Verify production/custom/preview routing, exact SHA and target receipts,
  fork/stale-source refusal, duplicate READY skip, GitHub-hosted build compute,
  no build-job deployment secrets, safe extraction and `--prebuilt` uploads.
- After cutover, inspect the actual project: no native Git link or deploy hooks,
  source ignore/build guards enabled, and existing domains/runtime/crons intact.
  Exercise manual Preview, Develop and Production and inspect their public
  root/index/asset/API paths and relevant stable aliases.

- After disconnecting native Git, verify existing provider branch aliases for main/develop/staging and the project production alias follow the verified prebuilt deployment. Only existing aliases owned by the selected project may be reconciled; skip unsupported/long branch slugs and absent aliases.

- A newly reassigned alias can briefly return a stale shell referencing an unavailable asset. Retry only the read verification with bounded backoff; never repeat the alias mutation blindly, and fail after persistent errors.

## Environment gateway publication

- Run `node --test .github/scripts/environment-gateway-policy.test.mjs .github/scripts/deploy-vercel-prebuilt.test.mjs`
  and `node .github/scripts/deploy-develop-pr-preview.mjs --self-test`.
- Verify ordinary PR builds and uploads retain custom `develop` credentials,
  select the logical Preview gateway, inject only its unbranched scoped signing
  secret into the upload child, and require the controlled main-source preview
  master. Legacy PR deployments must not be reused or mass-deleted.
- Request `/api/root-data` through the exact published `pr-N.previews.dev.thingtime.com`
  alias, not only the deployment URL. A proxy PR must admit only that exact
  source origin for its signed Preview relay; an older preview policy is
  rebuilt without deleting its same-head alias before replacement. A dedicated
  PR stays on its own configured develop database and rejects incoming relay
  headers. Confirm neither response exposes gateway or Mongo credentials.
- Verify production and preview master are separately built with their own target
  metadata and no provider/gateway secrets in either build or artifact.
- Missing encrypted scope bootstrap, unknown target, arbitrary PR master selection,
  stale deployment policy and inherited owner dedicated mode must fail closed.
- Simulate automatic alias assignment before CLI completion and failed API smoke:
  rollback must restore the pre-upload owner, remove only a newly created alias,
  and preserve a concurrent operator. Production passes `--skip-domain`; custom
  targets use pre-upload snapshots because CLI59.10.0 rejects that option there.
- A scheduled PR-preview reconciliation must never move the stable develop alias
  to a native or PR deployment. Verify canonical source and exact manifest owner,
  then ordinary API reads after the stable publisher's explicit alias assignment.
- Simulate edge propagation beyond the former seven-second retry window; the
  exact manifest owner must eventually pass without another upload or alias
  assignment. Persistent mismatches stop at the 90-second deadline, abort any
  in-flight read, preserve safe mismatch evidence and restore old bindings.
- Activate each environment only after source support and independent review;
  preserve known production/develop bindings for rollback. Do not retire old
  immutable deployments or change Atlas tier/credentials for this rollout.
- Exercise the full READY-reuse publisher with mocked GitHub/Vercel/runtime HTTP,
  no CLI or real network. Confirm canonical manifest/API acceptance reaches the
  success status and step-summary receipt, then repeat without another alias or
  status mutation. This guards receipt variables escaping their acceptance scope.

## Existing workflow preflight verification

- OpenAI preflight failures report the HTTP status and an allowlisted error code. Unknown codes and response messages must never enter logs; verify both quota classification and redaction before a bounded live vault probe.

- Verify reusable workflows parse on GitHub before running a credential probe. Job-level environment expressions must not reference step outputs or runtime environment values; those belong in step inputs or step environments.

## Preview receipt runner context (2026-10-26)

- Run `node --test .github/scripts/preview-recovery.test.mjs`. The receipt path
  must be initialized by a runner step through `GITHUB_ENV` before publication;
  `runner` expressions cannot appear in the controller's job-level environment.
- Verify the initializer handles a temporary directory containing spaces, writes
  exactly the receipt variable, and does not log environment values. Retain the
  protected receipt artifact path and existing source/permission boundaries.
- After authorized rollout, inspect a naturally arriving exact-head preview run:
  workflow compilation and receipt collection must execute. Local contract and
  lint checks do not establish a live publication. Do not replay shared jobs
  merely to satisfy this checklist without task authorization.

## Published PR gateway API acceptance (2026-10-26)

- Run both preview publisher self-tests and `node --test .github/scripts/preview-*.test.mjs .github/scripts/environment-gateway-policy.test.mjs`.
- Generated PR arguments must admit exactly their validated HTTPS PR alias;
  inherited source-origin lists and wildcards must never enter upload arguments.
- Ordinary PR publication must GET `/api/root-data` after alias assignment,
  with a bounded timeout and no redirects. A shell 200 with API 421, an HTML
  fallback, missing-build marker, invalid JSON or redirected API must fail.
- After authorized rollout, verify the exact head and API through the stable
  alias; local fixtures alone do not establish live alias acceptance.

## Protected native compilation

- Run `/usr/bin/python3 -I -S .github/scripts/native-compile-ci.test.py` and
  `actionlint .github/workflows/native-compile.yml` without privileged actions.
- Independently review/admit protected supervisor code and a separately pinned
  main listener before dispatch. Preserve reviewed helper H1 ancestry and
  literal H1 checkout/provenance pins; the listener separately pins workflow H2.
  Candidate helper imports must stay inert;
  native archive extraction and execution occur only after enforced isolation.
- Follow [the native compile runbook](NATIVE_COMPILE.md) for exact-head admission,
  hosted direct IPv4/IPv6, UDP/DNS and child-sandbox checks, cancellation/watchdog
  cleanup, and full unsigned Xcode acceptance. Static tests do not prove these.

## Native control continuity and bounded bootstrap

- Run the trusted native helper tests and actionlint without privileged local
  operations. Cover actual Runner.Listener/Worker UID admission, DNS broker UID
  separation, runner-only TCP `flags any`, finite command/group reap and cleanup
  lock deadlines, failed hostname controls, lost diagnostic pipes, and refusal
  to restore policy while owned probes/isolated descendants remain.
- After independent H1/helper and H2/pin admission, run **preflight first**:
  exact-source validation but no candidate download/extraction/execution, two
  separated control-host/TLS probes under PF, root/broker/isolated deny probes,
  and explicitly requested detached-watchdog cleanup. Verify phase timestamps,
  restored-state artifact upload and no surviving task-owned process groups.
- Treat a DNS/UID/control failure as a fail-closed diagnostic, never as permission
  for a broker exemption or native retry. Preflight success does not establish
  authenticated long-poll, DNS expiry, parent-loss/cancellation, or compilation.
  Native mode requires its separate explicit selection and later acceptance.

- Native probe lifecycle regression: verify numeric credential drop clears
  supplementary groups and verifies real/effective UID/GID before exec, each
  network/sandbox subprobe has its own marker and deadline, and only the
  pre-policy authority check invokes sudo. Capture stuck process state metadata
  without treating zombies as absence. Use owned fixture PIDs only locally.
- Verify a forked watchdog fixture closes inherited capture pipes while alive;
  command timeouts must reap their direct child even when another writer holds
  a pipe. Hosted preflight must finish or fail within the 10-minute job cap,
  upload its sanitized evidence after verified restoration, and never download
  candidate source. No native retry before successful hosted preflight.

- Watchdog setup must fail closed on setsid/descriptor failure, no ready signal
  or child death before admission; exercise a real nonprivileged fixture
  readiness pipe, and kill/reap only its exact child. Each command admission
  rejects a dead watcher. On cleanup failure, sanitized watchdog evidence stays
  readable while the protected active log is outside all uploaded artifacts.

- Darwin group verification: mock directory-list/kernel-list divergence, require
  only the intended primary kernel group, and reject extra root/admin groups,
  missing accessor/system limits, syscall/count failures and ID mismatches.
  A read-only current-process accessor test is allowed; never perform a local
  privileged identity drop. Verify failure diagnostics reject arbitrary output,
  command arguments/messages, environment values and unregistered labels;
  malformed prefixed JSON and non-string stage/error-type fields are ignored.
