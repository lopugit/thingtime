# Control-plane changelog

Everything in this repository's **executable CI** lives on the `github-actions`
branch: the workflows, the automation scripts, and the actions they call. The
product branches carry only thin listeners that invoke this branch by ref, so a
change here is live everywhere the moment it lands — it is never promoted, never
merged into `main` or `develop`, and never appears in `remix/CHANGELOG.md`.

That is exactly why this file exists. The entries below were written into the
app changelog on this branch, where nothing could ever carry them to a product
branch: seven entries describing how conflict resolution and promotion behave
were invisible to anyone reading the app's history. They are reproduced here
verbatim, and CI changes are recorded here from now on.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
every entry is attributed the same way the app changelog attributes them.

---

## [Unreleased]

- Moved admin-selected Develop and Production/Main PR preview publication into
  the protected `github-actions` controller. The product backend now sends only
  a GitHub App-authenticated policy dispatch; the controller immediately
  comments the expected PR-scoped URLs and ready estimate, adds immutable
  snapshot URLs when known, and publishes aliases only after an exact-SHA READY
  verification. Develop previews now also accept every trusted same-repository
  PR base without requiring a live parent PR. — Codex (AI), 2026-09-03

- Reconciled cancelled or stale Feature Stack wrappers after their exact
  protected target PRs have already merged. Lopu now verifies every published
  branch/base identity and target-contained merge commit, skips duplicate AI
  work, and signs the terminal success back to the production CI console. —
  Codex (AI), 2026-09-01

- Kept Feature Stack completion tracking attached to the stable published PR
  instead of its first head SHA. An authorized repair push may now advance the
  protected PR while the original wrapper is waiting; the gate revalidates the
  exact head/base branch identity, follows that PR number, and reports its real
  merge rather than waiting five hours on a stale SHA. — Codex (AI), 2026-09-01
- Moved develop PR preview compilation from Vercel into a secret-free GitHub
  job. The exact authorized SHA now produces a symlink-preserving
  `.vercel/output` artifact; a separate protected publisher validates the
  untrusted archive and uploads it with a pinned Vercel CLI in prebuilt-only
  mode before applying the SHA-fenced alias and live CORS checks. — Codex (AI),
  2026-09-01
- Feature Stack target workers now start after their expected sibling jobs are
  skipped. The protected controller uses the same explicit `!cancelled()`
  dependency guard as the other Lopu workers and validates the durable
  Thingtime run identity against the immutable merge plan. — Codex (AI),
  2026-09-01
- Kept the priority `sync/main-into-develop` detector independent of the
  repository-wide open-PR GraphQL inventory. Its trusted pull-request event now
  hydrates and validates only the exact automation-owned PR through the REST
  API, so a large inventory-side GitHub 502 cannot stall a new `main` commit;
  scheduled and ordinary PR sweeps retain the complete topology scan. — Codex
  (AI), 2026-09-01
- Bounded the control-plane Graphify store to one active portable snapshot by
  default, added an explicit safe prune command, and made every successful
  update activate its replacement before deleting superseded snapshots. The
  active snapshot and semantic CAS remain preserved, while invalid retention
  settings fail closed. — Codex (AI), 2026-09-01
- Gave the exact automation-owned `sync/main-into-develop` conflict worker its
  own serialized priority lane. Detector deduplication now sees both that lane
  and the ordinary Lopu fleet, while ordinary capacity limits no longer defer
  the standing synchronizer; historical PR conflicts therefore cannot hold a
  new `main` commit behind the global model FIFO queue. — Codex (AI),
  2026-08-31
- Hardened the standing `main` to `develop` PR merger against two live GitHub
  consistency edges: the PR object's head may briefly lag the automation-owned
  branch ref, and a transient merge API error may arrive after GitHub has
  committed the merge. The merger now polls the first case and proves the
  merged PR plus `develop` ancestry before recovering the second, avoiding
  false deferrals and false-red runs without weakening the SHA fences. — Codex
  (AI), 2026-08-31
- Made the standing `main` to `develop` synchronization PR merge itself as soon
  as its exact published head becomes mergeable. Both the clean sync lane and
  Lopu conflict resolver now invoke one SHA-fenced terminal merger that verifies
  the repository, head/base names, live branch tips, and `main` ancestry before
  merging, then verifies `develop` afterward; moving refs and remaining
  conflicts defer safely instead of depending on unavailable native GitHub
  auto-merge. — Codex (AI), 2026-08-31
- Made Graphify scope exclusions compatible with the pinned `graphify 0.9.4`
  CLI. The immutable CAS wrapper now consumes and validates repository-local
  `--exclude` paths itself, atomically hides the nested trusted controller only
  while Graphify runs, and restores it on both success and failure instead of
  forwarding an unsupported update/extract option. — Codex (AI), 2026-08-28
- Moved post-rebase repository maintenance behind a verifiable rebase-fleet
  finalizer. Rewritten tips now carry one run/PR-bound Lopu trailer whose live
  controller run and exact rebase job must match before PR/push listeners defer
  work. The last active stack worker queues one repository-wide review and
  all-branch rebuild, while an already-draining conflict batch retains its own
  single finalizer. — Codex (AI), 2026-08-28
- Bound Lopu's per-resolution review and all-branch deferrals to durable
  controller provenance instead of GitHub's push actor alone. Repository-owner
  PAT pushes are now recognized through a run/PR commit trailer whose live
  workflow run must belong to the protected `github-actions` resolver; ordinary
  collaborator messages cannot suppress maintenance. Clean merges, AI-resolved
  merges, and terminal Graphify commits all carry the same marker. — Codex
  (AI), 2026-08-28
- Made every queued Lopu conflict owner immediately discoverable. Conflict
  matrices now materialize completely inside a 90-member durable-fleet cap
  instead of hiding later PRs behind `max-parallel: 3`; overflow stays
  conflicting for the next event or scheduled scan, and an unavailable queue
  inventory safely defers dispatch rather than risking GitHub dropping jobs at
  its 100-pending-member limit. Pre-migration batches with unknowable latent
  members drain under their distinct legacy title before the new dispatcher
  admits replacements. — Codex (AI), 2026-08-28
- Stopped overlapping Lopu conflict detectors from queuing the same PR more
  than once behind the durable repository fleet. Before dispatching a fresh
  batch, the protected handoff now reads GitHub's live concurrency group and
  removes PRs that already have a pending or in-progress merge/rebase owner;
  immutable worker leases remain the fail-open correctness backstop if that
  read-only inventory is temporarily unavailable. — Codex (AI), 2026-08-28
- Allowed Lopu's isolated rebase rounds to resolve ordinary executable text
  conflicts. Scratch copies remain non-executable, while the trusted verifier
  restores the incoming replay side's exact `100644` or `100755` Git mode;
  symlinks, submodules, non-regular entries, and binaries remain excluded. —
  Codex (AI), 2026-08-28
- Coalesced Lopu's conflict-resolution follow-up work at the batch boundary.
  Bot-authored resolution pushes no longer enqueue one repository review and
  one all-branch rebuild per PR ahead of the remaining conflict matrix; one
  review and one rebuild are dispatched after the complete batch succeeds. —
  Codex (AI), 2026-08-28
- Fixed Lopu's post-merge Graphify scan so the nested `trusted/` controller
  checkout remains available for GitHub action post-steps without being
  indexed as duplicate product source. Both structural and LLM-semantic phases
  now exclude that checkout, preventing duplicate-node collisions and false
  unchanged-file symbol-loss rejections. — Codex (AI), 2026-08-28
- Fixed Lopu's Graphify snapshot stager on legacy product branches whose broad
  ignore rules predate the immutable CAS layout. The trusted stager now
  force-adds only allowlisted immutable snapshots and semantic-cache variants,
  while mutable legacy root outputs retain ordinary Git ignore semantics.
- Fixed Lopu's post-resolution cleanup so its ignored `trusted/` controller
  checkout survives the Graphify preflight. This keeps the local action
  definition available for GitHub's registered post-run steps while every
  other ignored or untracked model-created path is still removed.
- Fixed Lopu's `all`-branch rebuild so generated `graphify-out/` state is
  pinned to the primary-base snapshot after every PR merge, preventing legacy
  cache/snapshot layouts from excluding real source changes or ballooning the
  synthetic branch. A failed lazy promisor fetch now also triggers one
  complete refetch of the exact live base and PR refs before retrying.
- Fixed Lopu's stack-rebase prompt so the live rebase checkout is explicitly
  inspection-only and every bounded related edit is submitted as a verified
  scratch copy, preventing model-side writes from tripping the immutable real
  checkout guard during large semantic conflict rounds.

### Changed

- **Lopu now resolves Git's marker-free distinct-type conflicts for the
  repository's canonical root instruction aliases**: when the exact target
  snapshot proves `AGENTS.md` and `CLAUDE.md` are `AI_ALL.md` symlinks and the
  historical PR head proves regular files, the trusted controller preserves
  the canonical symlinks, removes Git's synthetic `~HEAD` sidecars, and leaves
  every unfamiliar type conflict untouched. A real merge fixture protects the
  behavior. — Codex (AI), 2026-08-28
- **Lopu rebase rounds now preserve validated related fixes instead of
  discarding an otherwise-correct conflict resolution**: a live Commander
  replay resolved all thirteen mechanically-derived conflicts but also updated
  the existing Nitro API route registry required by Thingtime's endpoint
  conventions, so the former exact-file-set guard rejected the whole round.
  Every listed conflict remains mandatory, while up to 32 related edits may
  now be admitted only when they are existing stage-0, non-executable regular
  text files and pass the same path, size, binary, marker, credential, index,
  aggregate-byte, and final staged-tree verification before import. — Codex
  (AI), 2026-08-28
- **Lopu now coalesces obsolete pending conflict-worker batches before it
  dispatches a fresh live snapshot**: repeated push, PR, check, and workflow
  signals had accumulated fourteen not-yet-admitted batch runs behind the
  single-agent fleet; GitHub then rejected newer matrix jobs before assigning a
  runner or first step. The protected handoff lists only pending/queued Lopu
  batch workers, rechecks each live status, preserves every in-progress run,
  cancels stale waiters, waits for their capacity to release, and only then
  dispatches the newest re-derived batch. Graphify's CAS router also makes
  private working copies writable after copying 0444 immutable snapshots, so a
  new source fingerprint can refresh without weakening stored snapshot
  immutability. — Codex (AI), 2026-08-27
- **Lopu now rejects poisoned Graphify snapshots at the single immutable CAS
  boundary**: every structural and semantic result is compared with the richest
  snapshot for the same source fingerprint. If Graphify's manifest says a file
  is unchanged but its graph loses two or more symbols, publication fails even
  when other files make the total graph larger; one-node extractor jitter and
  legitimate hash-changing edits remain allowed. Immutable snapshot files are
  also made read-only when finalized or activated, so a legacy raw Graphify
  hook cannot follow a compatibility symlink and rewrite a content-addressed
  artifact in place; if that legacy writer replaces only an ignored root alias
  with a regular generated file, the next CAS activation safely reclaims the
  exact compatibility pathname. — Codex (AI), 2026-08-27
- **Graphify snapshot activation now repairs dangling compatibility aliases**:
  deleting a stale snapshot leaves its ignored root symlink present even though
  ordinary existence checks report it missing. The trusted router now inspects
  the link itself, replaces it with the newly selected immutable target, and
  regression-tests the exact migration sequence. — Codex (AI), 2026-08-27
- **Lopu's Graphify publisher now content-addresses semantic-cache variants as
  well as graph snapshots**: real semantic builds proved that upstream can
  rewrite one input-key filename with different valid response bytes. The
  trusted router hydrates a private work cache from
  `semantic-cas/v1/<input-key>/<content-hash>.json`, ingests only after a
  successful build, preserves divergent responses additively, and restores any
  legacy tracked mutable cache after staging so old product branches remain
  clean. — Codex (AI), 2026-08-27
- **Lopu now wakes on first-party CI failures without duplicating repository
  review sessions**: the default listener forwards a bounded allowlist of
  completed GitHub Actions workflows, and the protected controller binds the
  exact workflow-run id into the review evidence. PR, CodeQL, external-check,
  and first-party CI signals coalesce only when an identical review scope is
  still unstarted; a running review retains one newest waiter and is never
  cancelled. Human conversation is deliberately never coalesced — only its own
  dispatch id names the comment Lopu must read and answer — so every PR comment
  still wakes its own session. CodeQL dispositions enforce GitHub's
  280-character evidence limit and accept a transient nullable alert state only
  when the exact newest instance remains open, unfixed, and undismissed
  immediately before the isolated writer acts. — Codex (AI), reviewed by Lopu
  (AI), 2026-08-27
- **Lopu's historical CodeQL backfill now advances past completed PR
  snapshots instead of repeatedly dispatching safe no-ops**: inventory resolves
  each live synthetic merge ref and validates its exact base/head parents using
  the same ownership rule as the analyzer. It no longer trusts the lagging
  `merge_commit_sha` returned by the paginated pull-list API, so the bounded
  maintenance window reaches older genuinely missing PR analyses. — Codex
  (AI), 2026-08-27
- **Lopu's isolated CodeQL writer now validates repository-level dispositions
  against the live target branch tip** instead of the historical base snapshot
  stored on an out-of-date PR. The pre-write guard still requires the exact
  reviewed PR head and CodeQL head-or-merge instance, but valid dispositions on
  older `develop` PRs are no longer silently skipped solely because their
  recorded base SHA predates the current target. Matching proposals for a
  shared repository alert are coalesced to one write; conflicting reasons leave
  the alert open without failing unrelated reviews. — Codex (AI), 2026-08-27
- **Unrouted Lopu review events now fail closed instead of escalating to every
  open PR**: exact PR, branch, operator-wide, and protected-controller-push
  scopes retain their existing behavior, while any unknown event that carries
  no derivable scope logs a notice and dispatches no model work. This removes
  merge-order dependence between metadata-only product listeners and the
  protected controller, preventing a newly activated trigger from saturating
  the repository-wide Lopu fleet before its matching router lands. — Codex
  (AI), 2026-08-27
- **Commander macOS releases are now Developer ID signed, notarized, and
  stapled**: the release job imports the existing Developer ID certificate and
  App Store Connect key into an ephemeral runner keychain, builds under the
  distribution signing policy instead of the previous ad-hoc identity, and then
  submits, staples, and Gatekeeper-assesses the bundle before it publishes any
  asset. Credentials are imported only after the duplicate-release check — the
  same ordering the Electron PR release uses — so a re-run that publishes
  nothing never unlocks them, and the otherwise unbounded notarization wait is
  capped so an Apple-side stall cannot hold a macOS runner for six hours. The
  imported keychain, certificate, and App Store Connect key are deleted at the
  end of the job whatever its outcome, matching the Electron lane, so a failed
  build or notarization does not leave signing material behind. The lane
  requires the six existing macOS signing secrets and stays inert until the
  Commander sources reach `main` (#263) and a thin `main` listener calls this
  workflow. — Lopu (AI), 2026-08-27
- **All-branch maintenance now coalesces before it reaches Lopu's durable model
  fleet**: PR lifecycle, protected-branch push, and hourly backstop events make
  the same metadata-only handoff to the protected manager instead of attaching
  one full union doctor to every originating run. That central namespace keeps
  the active rebuild plus one newest pending live snapshot and never cancels
  active work, preventing the unbounded all-branch waiter backlog that delayed
  conflict resolution and ordinary PR checks. The eventual doctor still shares
  the repository-wide single-agent fleet, while its full-history checkout uses
  blobless transport to avoid downloading historical file contents the current
  union never reads. — Codex (AI), 2026-08-26
- **Lopu now closes historical CodeQL coverage gaps across every open PR**:
  each existing repository-maintenance cadence inventories current merge/head
  snapshots, both required CodeQL languages, and already-active analysis runs,
  then dispatches at most two recent missing snapshots through the protected
  unprivileged analyzer. A manual `backfill-codeql` operation may process up to
  twelve. Every dispatch is bound to the PR's current head SHA, stale merge
  snapshots are rejected, completed or active work is skipped, transient
  GitHub API failures receive bounded retries, and no AI credential or PR code
  enters the inventory job. The lane is part of **Lopu PR manager**, shares its
  existing schedules, serializes without cancelling active work, and resumes
  idempotently from live CodeQL state on the next pass. — Codex (AI),
  2026-08-26
- **Conflict resolution now recovers from incomplete partial-clone object
  hydration**: ordinary resolver checkouts remain blobless for cost and speed,
  but a GitHub promisor-object rejection now aborts the partial merge, refetches
  only the exact PR head and target branch histories without a filter, and
  retries the same immutable merge once before any AI spend. This fixes the
  pre-model failure observed while Lopu tried to merge `main` into `develop`
  for PR #289, without making every PR download the repository's full object
  history. — Codex (AI), 2026-08-25
- **The wildcard `all`-branch doctor is now internal to the one public Lopu
  manager**: its independent push/manual workflow is retired. PR lifecycle
  changes and the hourly backstop call the protected reusable doctor directly;
  develop, main, and controller pushes make one bounded bot-authored handoff
  back through **Lopu PR manager** so provider actions never inherit unsupported
  push provenance. Manual recovery is the manager's `build-all` maintenance
  choice, and the doctor keeps the shared non-cancelling model fleet lock. —
  Codex (AI), 2026-08-25
- **Codex-backed Graphify attestations now survive promotion recovery**: the
  interrupted-run validator accepts the same `openai` semantic mode emitted by
  Terra/Sol-backed promotion publication, and ordinary PR merge commits and
  status comments now identify OpenAI semantic extraction instead of
  incorrectly reporting that no semantic credential was available. Contracts
  keep every publication, recovery, and reporting enum aligned. — Codex (AI),
  2026-08-25
- **Rebase roots, stack children, and moving-ref recovery now round-trip through
  the one public Lopu manager**: the internal rebase engine no longer attempts
  to dispatch its triggerless implementation directly. Exact immutable worker
  data is nested beneath a bounded repository-dispatch payload, merge-cascade
  and rebase events have mutually exclusive owners, and automatic race retries
  cannot inherit manual-selector authority or launch duplicate merge/review
  work. Root handoffs use the endpoint's narrow `contents: write` permission;
  publication-local race helpers release current and child ownership labels
  before a fresh-ref retry. — Codex (AI), 2026-08-25
- **Lopu now immediately recovers when a PR head or target advances beside
  publication**: the exact lease still refuses the stale merge, but that
  expected race is recorded as a successful guarded attempt and requeued from
  fresh live refs up to three times instead of leaving a red run until the next
  scheduled sweep. Success comments and stack cascades remain gated on a live
  ref proving the exact merge commit was published. — Codex (AI), 2026-08-25
- **Lopu's public queue now coalesces repeated repository snapshots without
  interrupting active work**: each semantic PR/branch boundary keeps the
  running workflow plus the newest pending signal, which re-derives all live
  comment, check, branch, and PR state when it starts. The shared model fleet
  retains `queue: max` only after distinct PR work has been selected, avoiding
  the former 100-run duplicate backlog while `cancel-in-progress: false`
  protects every running detector, worker, and model session. CodeQL's
  `pull_request_target` metadata bridge is also isolated in its own protected
  reusable workflow, so normal read-capped PR analysis retains its check
  contexts without trying to inherit `actions: write`. — Codex (AI),
  2026-08-25
- **The last rebase-specific public entrypoint is folded into Lopu**: legacy
  `rebase-pr-stack-ai` exact-worker events now enter through **Lopu PR
  manager**, retain their rebase compute-provider policy and snapshot payload,
  and invoke the reusable stack engine internally. The engine itself exposes
  only `workflow_call`, so product branches no longer need a second rebase
  listener. — Codex (AI), 2026-08-25
- **Lopu is now the sole automatic promotion and branch-synchronization
  entrypoint too**: the standing develop→main promotion, per-feature promotion
  train, six-hour promotion backstop, and main→develop synchronization run as
  internal jobs of **Lopu PR manager**. Their reusable implementations no
  longer expose push, schedule, or manual triggers, and explicit recovery is
  selected through Lopu's `maintenance_operation` input. Each durable
  component retains non-cancelling concurrency, so a new repository event
  queues behind rather than replacing in-flight maintenance. Custom
  source/target/path promotion authority stays on a reviewed GitHub runner so
  CI-provider routing cannot drop those owner-selected inputs. — Codex (AI),
  2026-08-25
- **Every model-backed repository lane now runs through one protected Lopu
  action**: review/check repair, CodeQL triage, merge conflicts, promotion
  replay, release analysis, rebase and stack-conflict rounds, and the wildcard
  `all`-branch doctor share the repository-wide `LOPU_AGENT_BACKEND` selector.
  The action validates and labels either the pinned Claude implementation or
  pinned Codex implementation with an allowlisted Terra/Sol model and explicit
  reasoning effort. Direct provider actions no longer appear in individual
  workflows, the historical `LOPU_REVIEW_BACKEND` remains a compatibility
  fallback, and post-merge Graphify prefers the same provider while retaining
  structural output when semantic extraction is unavailable. — Codex (AI),
  2026-08-25
- **Lopu CodeQL now covers PRs targeting branches that predate the listener**:
  a trusted default-branch `pull_request_target` event carries only the PR
  number and immutable head SHA into a separate `workflow_dispatch` run. The
  protected worker revalidates live PR state, rejects stale handoffs, preserves
  the normal PR run when the target already carries a listener, and otherwise
  uploads against the exact PR merge ref (or head while conflicts remain).
  A merge ref is accepted only when its parents equal the live base and head,
  preventing GitHub's stale conflict refs from being analyzed. Existing
  two-language snapshots suppress duplicate scans. The privileged event path
  performs no checkout or analysis and receives no AI credential. — Codex
  (AI), 2026-08-25
- **CodeQL now has a protected advanced-setup implementation for every PR
  target and branch**: a thin product listener calls the canonical
  `github-actions` workflow for unfiltered `pull_request` and all-branch
  `push` events. Open PR heads use their PR analysis as the single owner rather
  than paying for a duplicate push scan; direct `github-actions` pushes are
  scanned by the protected implementation itself. The workflow analyzes
  Actions and JavaScript/TypeScript without persisted checkout credentials or
  any AI secret. A repository variable keeps uploads cleanly inactive until
  the listener reaches the default branch and default setup is disabled.
  — Codex (AI), 2026-08-25
- **Lopu now owns evidence-backed CodeQL triage for reviewed PRs**: each review
  receives the exact open CodeQL findings bound to the immutable PR head or
  advanced-setup merge analysis. The isolated handoff revalidates the reviewed
  head and base revisions plus the exact analysis ref and SHA. Real
  findings are repaired in the PR branch and left open for the next scan to
  mark fixed; only demonstrably inapplicable findings can be proposed as
  `false positive` or `used in tests`. A separate model-free job revalidates
  the live PR head, alert ref, commit, and state before applying a dismissal,
  then records the evidence and disposition on the PR. Lopu never selects
  `won't fix`, and the model itself has read-only code-scanning access. — Codex
  (AI), 2026-08-25
- **Lopu now publishes conflict-free Graphify snapshots**: structural and
  semantic refreshes run through a trusted content-addressed router that
  fingerprints only source, serializes writers, validates atomic portable
  output, rejects large accidental collapse, and stages immutable additive
  snapshots. Root graph aliases are local-only, so independent PRs and stacks
  no longer fight over the same generated JSON paths. — Codex (AI), 2026-08-27
- **Lopu now updates clean-but-behind PR branches before reviewing them**:
  the shared detector treats GitHub's `BEHIND` state as a base-merge request,
  snapshots both refs, and merges the PR target into an eligible same-repo
  head under the same serialized Lopu worker used for conflict resolution.
  Conflicting stacks remain on Lopu's rebase lane, while clean behind stacks
  receive the requested target-into-head merge and cascade; reviews wait for a
  current head. Every completed merge rebuilds Graphify structurally first with
  `graphify update .`, then runs incremental LLM semantic extraction when a
  configured credential is available. A semantic failure preserves and
  publishes the valid structural rebuild. — Codex (AI), 2026-08-25
- **Signed Desktop PR releases now run from the protected control plane**:
  the reusable builder/releaser validates current owner-labelled PR state and
  pins its exact source SHA before checkout; the eventual product listener is
  trigger-only. GitHub write access is scoped to GitHub API/publish steps, PR
  checkout persists no credential, and Developer ID/notarization secrets enter
  only after unsigned source tests pass. The workflow publishes both the
  Desktop updater asset and its separately signed Thingtime Recovery companion.
  — Codex (AI), 2026-08-24
- **Lopu now performs whole-PR repository reviews in the same control plane**:
  a push or selector creates one serialized Lopu batch for the affected clean
  same-repository PRs, each checked out against its target branch. Lopu reviews
  the full codebase context, makes only justified fixes, commits and pushes
  them to the PR heads, and posts a Lopu-branded update with the configured
  Claude backend and validation report. — Codex (AI), 2026-08-24
- **Lopu is now the single public PR-management workflow**: the conflict,
  promotion, rebase, and stack-cascade paths share one Lopu entrypoint and a
  serialized model-worker fleet. Clean `.github/**` promotions now publish
  directly, without CI-sensitive quarantine, `[skip ci]` content commits, or
  synthetic review checkpoints; Lopu receives full repository, shell, GitHub,
  and web-tool access while deterministic Git checks continue to validate the
  result. — Codex (AI), 2026-08-24

### Fixed

- **Lopu's PR detector now survives transient GitHub API outages without
  corrupting its JSON pipeline**: read-only API calls retry bounded HTTP 408,
  429, 500, 502, 503, and 504 responses with short backoff while permanent
  authentication, permission, and schema failures still fail closed. The
  detector validates GraphQL response shape before parsing it and reuses each
  complete repository PR snapshot for selection and stack ownership instead of
  immediately requesting the same inventory twice. This fixes the pre-model
  HTTP 504 failure observed on the first safe `main`→`develop` sync PR #414.
  — Codex (AI), 2026-08-26
- **PR resolution no longer downloads every historical repository blob**:
  Lopu's merge worker keeps full commit ancestry for exact merge-base and
  merge-tree verification while using `blob:none` partial clone. Current and
  merge-required blobs remain available on demand, avoiding a multi-gigabyte
  full-history transfer for each merely out-of-date PR. — Codex (AI),
  2026-08-25
- **Post-merge Graphify semantics now follow Lopu's configured AI backend**:
  promotion refreshes can use the same `OPENAI_API_KEY` and validated
  Terra/Sol model as Codex-backed repository review, while retaining Claude
  API/CLI credentials as a fallback. Every provider credential is included in
  the derived-output secret scan, and structural Graphify still completes when
  no semantic provider is available. — Codex (AI), 2026-08-25
- **Lopu's single-agent fleet durably queues distinct selected work while its
  event boundaries stay bounded**: PR reviews and check fixes, merge conflict
  resolution, promotion replay, rebase/stack operations, and the wildcard
  `all`-branch build doctor still allow only one live model-backed Lopu session
  per repository. The model fleet can retain up to 100 already-selected jobs,
  but repeated check, PR, branch, and all-branch signals are coalesced before
  they enter it. The all-branch doctor is Lopu-branded and its rebuild cannot
  cancel or overlap another active model-backed operation. — Codex (AI),
  2026-08-25
- **Preview wildcard fallbacks are environment-locked and stack-aware**:
  `*.previews.dev.thingtime.com` must bind to `develop`, while the Vercel
  production fallback for `*.previews.thingtime.com` must stay detached and
  prove it resolves to `main`; the protected controller verifies each binding,
  CNAME, and live runtime branch before publishing an alias. Trusted
  same-repository stacked PRs now resolve their bounded parent chain to
  `develop`, while missing, ambiguous, draft, untrusted, cyclic, or overlong
  chains fail closed. — Codex (AI), 2026-08-24
- **`ai-merge-paused` is now a durable user-controlled stop label**: neither
  conflict resolution nor stack rebasing can create, add, remove, recover, or
  supersede it. Detectors exclude it regardless of ref/topology changes, and
  queued workers re-check it before checkout or model work, preventing an
  operator pause from being raced by an already-dispatched AI/Vercel/GitHub
  automation. — Codex (AI), 2026-08-24
- **Manual develop-preview recovery reaches the trusted controller again**:
  GitHub could drop the reusable workflow's forwarded typed input while
  evaluating its job guard, producing an immediate failed run with no jobs.
  Manual runs now schedule the controller unconditionally outside PR listener
  events; the checked-out controller still validates the original PR-number
  event input before any mutation, and the environment remains restricted to
  `main`. — Codex (AI), 2026-08-17
- **The control-plane tree is thin again after PR #272 regrew it**: the product
  test note, app changelog, and generated graph remnants are removed from
  `github-actions`, restoring the branch's bare-tree contract without touching
  their canonical product-branch copies or Git history. — Codex (AI),
  2026-08-17
- **The thin control plane is excluded from repository-root Vercel builds**:
  its only Vercel config disables every Git deployment and ignores any fallback
  build, while the bare-tree contract requires and validates that exact
  kill-switch. The remaining product, graph, test-note, and PR-note remnants
  were removed so the branch finally satisfies the invariant it introduced. —
  Codex (AI), 2026-08-17
- **The trusted promotion validator is lane-aware**: the reverse lane's first
  real run failed on "Source PR was not merged to develop" — the promoter was
  lane-parameterized but the validator still assumed the develop lane. The
  plan envelope now carries `source_ref` (closed to `develop|main`), the
  merged-into and live-tip checks follow the lane, and the deterministic
  branch check accepts the uniform `--to-<target>` shape plus legacy
  unsuffixed main-lane names — closing a near-miss where every post-uniform
  promotion, develop→main included, would have failed its next cycle. A
  second pass made the worker job itself lane-aware — pre-AI revalidation,
  mid-run authority recheck, attestation and checkpoint tip checks, comment
  texts, analysis prompt, failure snapshot — with a class-killer contract pin
  forbidding any promotion check from naming the source branch literally
  again. — Claude (AI), 2026-08-13
- **Promotion rounds prompt for a faithful replay, retry, and settle the
  provably superseded**: the round prompt taught the model stack semantics
  ("keep the destination's newer intent", "leave markers when unsure") inside
  promotions, producing base-side resolutions, emptied commits, and leftover
  markers — each correctly refused by a verify layer. Promotion mode now
  prompts that the source patch's intent governs; leftover markers defer to
  bounded retry rounds (chained like the stack flow, final round strict); and
  a conflict whose base-side blob already exists in the source history
  settles deterministically with evidence naming the containing commit.
  — Claude (AI), 2026-08-12
- **The AI round's tamper guard understands deterministic settlements**: the
  guard recomputes the full conflict set from immutable SHAs, but the live
  pre-model set excludes paths the worker settles deterministically — so
  every delete-bearing promotion burned a complete model round and then
  failed its own audit. The round now compares against the union and stages
  deterministic paths only from the expected rebase head's exact side; model
  output can never reach them. Stack rebases unchanged. — Claude (AI),
  2026-08-12
- **The sensitive-path deny-list is gone (owner decision, 2026-08-12)**: the
  conflict/promotion AI rounds may now be shown any conflicted repo file —
  `sensitive_path()` deleted, the refusal fixture flipped to prove
  eligibility, and the contract pins the absence so a deny-list cannot
  quietly return. Safety now lives in the mechanical shape checks (regular
  files, coherent markers, size cap), the scope verifier, `[skip ci]` +
  approval-required publication gating for CI-sensitive content, and the
  model file-tool infra denies. — Claude (AI), 2026-08-12
- **Delete-shaped promotion conflicts resolve deterministically**: the first
  unverified promotion (#211) deletes `.github/scripts/*` files `main` had
  since modified — modify/delete conflicts carry no zdiff3 markers, so the AI
  round refused every one and the run failed after the never-cancel gate had
  already opened. The worker now settles any conflict with a deletion on
  either side toward the source patch's intent (`git rm` where the patch
  deleted; keep the patch's content where the base deleted) before the AI
  round, finishes the replay itself when nothing needs a model, and the
  promotion PR's review comment names every path resolved this way. Content
  conflicts still go to the model; symlink/mode shapes still terminal-review.
  — Claude (AI), 2026-08-12
- **Unverified-lineage promotions publish for review instead of failing the
  worker**: the promoter queued them (never-cancel), but the trusted worker
  chain still refused at three layers — validate gate, worker environment
  check, and the worker's independent lineage re-derivation — so #211, #215
  and #223 each produced a failed run and no promotion PR. All three now
  accept the closed review-required set; the `observed == declared`
  consistency check stays (both classify against the immutable source tip,
  so disagreement means forgery or staleness); and a non-verified lineage
  review-gates publication like CI-sensitive paths (`[skip ci]` content
  commits, approval-required checkpoint, `source-lineage-unverified` label,
  release-decision warnings on both the promotion and source PRs). The
  contract tripwire that forbade this allow-list was retired deliberately
  with owner authorization and now pins the new posture instead. Nothing is
  ever auto-merged. — Claude (AI), 2026-08-12
- **AI conflict resolution runs again (every worker was silently skipped)**:
  adding the promotion validator to `model_config`'s `needs` made GitHub apply
  that job's ordinary-mode skip to the whole downstream chain, so both the
  `resolve` matrix job and `resolve_promotion` never started — detection,
  routing, and model selection all reported success while nothing resolved
  (PR #220 and every handoff after the promotion worker landed). Both workers
  now opt out of inherited skips with `!cancelled()` plus exhaustive per-need
  result checks. — Claude (AI), 2026-08-10
- **The thin product-branch listeners can reach the conflict resolver**: every
  secret-bearing gate tested `github.ref_name == 'github-actions'`, but under
  `workflow_call` that is the *caller's* ref, so `develop`'s listener was
  rejected in `detect` on every push, schedule and handoff it forwarded —
  including the worker handoffs older branch copies still aim at that ref.
  The gates now also accept a run started by this workflow's own listener on
  `develop`/`main`, which the caller contract already constrains to a single
  pinned `@github-actions` call with no executable behavior of its own.
  — Claude (AI), 2026-08-10
- **A declined promotion now says so on the source PR**: the promoter's
  stand-aside verdicts existed only as lines in a run summary, so a decline was
  invisible unless someone opened the run — which is why #211, the PR that
  converts `main` from a 2167-line resolver copy to a thin listener, was
  declined on 2026-08-09 and sat unnoticed. Declines now upsert one
  hidden-marker comment on the merged source PR, edited in place on later runs
  so repeat scans never stack, naming the reason and how many stacked PRs are
  held behind it. Dry runs stay side-effect free and a failed comment is a
  warning, never a reason to abandon promotion work. — Claude (AI), 2026-08-10
- **A promotion is never cancelled for an unverifiable lineage**: a source
  patch that can't be proven present at the current `develop` tip used to drop
  the promotion entirely — no branch, no worker, no PR — so the change simply
  vanished. The plan is now kept and quarantined instead: the non-verified
  status routes it through the trusted AI worker, and the PR it opens carries
  `source-lineage-unverified` plus the exact reason it could not be proven.
  Nothing merges without a human either way; the failure mode changes from
  "silently nothing" to "a PR you can reject". Operational inspection failures
  are still errors — there the patch state is genuinely unknown — but they now
  surface on the source PR and retry next run. — Claude (AI), 2026-08-10
- **Admin-selected conflict model now covers every protected AI runtime**: the
  `github-actions` control plane passes its validated Thingtime Admin primary
  model into merge- and rebase-side Graphify semantic refreshes as well as the
  Claude conflict edit. Clean rebases now load the setting before Graphify,
  and the control-plane contract inventories all active AI workflow/action
  YAML while rejecting legacy or hardcoded model selections. — Codex (AI),
  2026-08-10
- **A branch pushed just before its PR opens no longer times out that PR's
  CodeQL check**: the analyzer's scope pre-flight samples PR ownership seconds
  after the push, so a branch adopted by a PR moments later still reached the
  analyze job believing it owned analysis. The resulting `refs/heads` analysis
  at a live PR head made GitHub Advanced Security open that PR's check against
  the branch snapshot and close it `timed_out` with only one of the two
  language configurations uploaded — the recurring "1 configuration not found"
  symptom. The analyze job now re-confirms ownership after database init and
  before upload, ceding to the PR's own run; a transient lookup failure keeps
  the prepared analysis rather than failing the check it protects. Only the
  branch-ref push path is affected, so `pull_request`, scheduled, and centrally
  dispatched merge-ref analyses are unchanged. — Lopu (AI), 2026-08-27

### Added

- **The CI promotion lanes auto-run**: after every successful default
  develop → main promoter run, a fan-out job dispatches the
  main → github-actions and develop → github-actions lanes with the
  `.github/` prefix guard (dry-run passthrough, no cascade, serialized by the
  shared concurrency group). The primary promotion namespace is pinned to
  `main`, and naming is uniform (owner request): **every** lane's branches
  carry `--to-<target>` — `develop → main` now creates
  `promote/pr-N-<slug>--to-main` — with legacy unsuffixed branches recognized
  as main-lane history so no live promotion is orphaned. — Claude (AI),
  2026-08-12
- **Reverse promotion lane**: the promoter takes `source_branch`,
  `target_branch` and `require_path_prefix` as dispatch inputs (defaults keep
  the standing develop → main lane untouched), `github-actions` joins the
  promotion-base allowlist, and a lane path guard promotes only PRs whose
  entire planned patch stays under the lane's prefixes — so main-only CI work
  promotes onto the control plane through the same trusted chain: reservation,
  faithful replay, review gating, and the release analysis. — Claude (AI),
  2026-08-12
- **Model-authored release analysis on every published promotion**: a
  deterministic step precomputes three-branch history of the promoted paths,
  pairwise branch-only commit lists, the diff stat, the source PR and recent
  PR inventory; a model pass reads only those files and answers whether the
  historical change still belongs, what base-only work the replay overrides
  and whether it is superseded, and the concrete follow-up for anything that
  is not (e.g. cherry-pick onto a branch off github-actions and open a PR
  targeting github-actions). Posted as one advisory comment on the promotion
  PR — continue-on-error, Write scoped to a single output file, size-capped
  and secret-scanned; the replayed content stays deterministic. The promotion
  body's lineage section now describes the analysis instead of disclaiming
  it. — Claude (AI), 2026-08-12
- **Control-plane pushes sweep every open PR, plus a `no-ai-merge` opt-out**:
  pushing the `github-actions` branch now runs a repository-wide conflict
  sweep instead of matching only PRs based on that branch, so landing a
  resolver change retries every conflicting PR immediately rather than waiting
  for the twice-hourly schedule. PRs labelled `no-ai-merge` (the new
  never-auto-resolve opt-out, narrower `no-ai-rebase`'s counterpart) are
  dropped by the detector before any comment, dispatch, or AI spend. — Claude
  (AI), 2026-08-10
- **One merged PR can promote to several branches**: the promoter had exactly
  one target, so a source PR owing changes to two branches — #211 converts
  `main` to thin listeners *and* carries the implementation those listeners
  call, which may only live on `github-actions` — could never be expressed; the
  half that didn't belong on `main` just conflicted and the promotion died.
  Each configured target now gets its own pass, branch (`…-to-<target>`),
  promotion record, and PR, and a pass whose replay doesn't apply cleanly goes
  to the trusted AI worker exactly as a single-target conflict does. Nothing
  path-routes the split — the same file legitimately contributes different
  content to different bases, so the per-base replay and the worker decide.
  Off by default; set the `PROMOTION_TARGET_BRANCHES` repository variable to
  enable. — Claude (AI), 2026-08-10
