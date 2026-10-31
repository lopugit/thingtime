# Changelog

All notable changes to the **Thingtime web app** are recorded here. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with
assistant and manual changes attributed so future PR archaeology is less cursed.

**Author legend** — every entry is attributed:

- **Codex (AI)** — change made by the Codex AI assistant.
- **Claude (AI)** — change made by the Claude AI assistant.
- **Lopu** — change made manually by the developer.

> When you make a manual change, add a bullet under `[Unreleased]` ending with

- 2026-10-22: Add immediate per-connection Pause/Resume with durable restart fences, coalesced status work and individually editable optional bandwidth, transfer/index concurrency and sync-only CPU ceilings. Legacy policy IDs remain compatible; new limits require negotiated configuration3/native support. Release acceptance pending. [Details](../PRs/1086-codex-sync-resource-controls-make-sync-pause-immediate-and-add-scoped-resource-controls.md). **Codex (AI)**

- 2026-10-21: Keep eligible small-file batches running when a full preparation queue is refilled, preserve priority ancestry/receipt recovery at the actual preparation capacity, and add private bounded batch-result counts to the existing desktop timing log. Installed throughput remains unverified. [Details](../PRs/codex-sync-batch-full-queue.md). **Codex (AI)**

- 2026-10-20: Streaming file sync implementation and verification details: [PR 1062](../PRs/1062-codex-streaming-file-sync-stream-device-file-transfers-as-indexing-produces-entries.md).

- 2026-10-19: Cloud snapshot workers acquire renewable source-version holds;
  attachment deletion defers physical purge/refund and retained byte reads stay
  owner-only. Added isolated Mongo race/accounting proof and 1.15.0 content /
  1.2.0 cleanup contracts. Fleet/provider rollout, policy UI and safe backup
  pruning remain open; see [PR1002](../PRs/1002-codex-mobile-file-sync-add-native-mobile-pairing-and-recoverable-file-sync-core.md).

- 2026-10-19: Added bounded Previous/Next conflict-review navigation and a
  disposable, revision-guarded controller; Chromium restart checks now cover
  controller-driven choices and handoff. Editable Builder wiring remains open.
  See [PR 1002](../PRs/1002-codex-mobile-file-sync-add-native-mobile-pairing-and-recoverable-file-sync-core.md).

- 2026-10-19: Add automatic subspace message spaces, Posts/Messages controls,
  saved per-subspace comment expansion, and moderator-managed embedded Things
  above posts and in the sidebar. Message access follows live subspace membership;
  embedded Things retain their own access rules. Includes a retry-safe existing
  subspace migration and isolated acceptance harness. See [PR 1045](../PRs/1045-subspace-messages-views-and-moderated-embeds.md) for verification and rollout status. — Codex (AI)

- 2026-10-20: Add editable Lopu AI defaults and per-chat credential settings, with saved connection endpoint/model labels and explicit Thingtime-credit selection. Preserve unavailable pins, isolate defaults from chat changes, persist AI choices immediately and fence cold-link/pending-save routing. See [PR 1070](../PRs/1070-lopu-credential-selection-add-lopu-defaults-and-per-chat-ai-credentials.md) for validation and remaining live acceptance. — Codex (AI)

- 2026-10-19: Keep personal-plan chats on local management, make repeated verified provider selections idempotent, and align the floating header with plan eligibility. Added regressions for first sends, follow-ups, old-client background admission and revoked proofs. Reconcile completed Responses output items before executing tools; incomplete/conflicting output remains fail-closed (installed tool acceptance pending). — Codex (AI)

- 2026-10-18: Admit full-session owners to Lopu text chat through their live ChatGPT plan without an admin grant, preserve provider ownership on chat writes, and discard cached eligibility across identity changes. Catalog/API-key/voice invitation policy is unchanged. Live consent/model discovery/restart passed; rebuilt inference acceptance remains pending. See [PR 1034](../PRs/1034-chatgpt-plan-usage-local-runtime-and-encrypted-connection-moves.md). — Codex (AI)

- 2026-10-18: Fix rejected Mac telemetry after menu bar/script support pushed the native capability list to 65 entries. Pairing, heartbeat and owner projections now share a bounded 128-entry contract, with native-vocabulary regression coverage. See [PR 1038](../PRs/1038-device-scripts-page-layout-restore-full-mac-telemetry.md) for acceptance findings and the installed page layout correction.

- 2026-10-18: Refresh Claude public lifecycle metadata without an API key, preserve
  account-access uncertainty and admin admission, include discovered models in
  workflow settings, and persist the shared order when Save & apply is used.


- 2026-09-22 — **Claude (AI)**: PR preview docs. README and the preview
  listener's manual-dispatch description now state what the protected
  controller already does: every same-repository PR previews into the
  `develop` environment at `pr-<n>.previews.dev.thingtime.com` regardless of
  its base branch (`develop`, `main`, feature branches); production-environment
  previews stay an explicit admin choice. Evidence: PR #888 (base `main`) was
  built and published by the controller. No workflow logic changed.

- 2026-09-22 — **Claude (AI)**: Service workspaces (the builder's franchise
  app block) run live again on `/p/` pages and in the seamless editor. Html
  blocks now provide `NativeControlsEnabled` for live viewers in every runtime
  mode (Edit/Layout show a preview hint, View and the page run the app; Builder
  mode and previews stay inert with a named placeholder). Workspace Back
  returns to the previous record, new logs/sub-jobs/links keep their parent
  open, and creating a workspace on an unsaved page explains how to connect
  it. Validation: `test:webpages`, `test:service-workspaces`, `test:editorjs`,
  lint, ratchet, `build:client`, local desktop/390px click-through. Details:
  [PR #888](../PRs/888-claude-task-completion-43f339--run-service-workspaces-live-on-pages-and-in-the-editor.md).

- 2026-09-19 — **Claude (AI)**: Brand logo SEO. Every public shell now
  publishes an `Organization` JSON-LD node (logo = the 1024px voxel tree icon,
  wordmark image, `sameAs` profiles) linked from `WebSite.publisher`; the
  `/branding` hero previews and the landing `<Logo>` render real committed
  PNG `<img>` files instead of `data:` URIs / bare `<div>`s so image search can
  index the marks. New Nitro routes `GET /robots.txt` (everything allowed,
  AI crawlers named explicitly, origin-scoped `Sitemap:` line) and
  `GET /sitemap.xml` (index + bounded `static` / `posts` / `pages` / `profiles`
  sections with image-sitemap entries), twinned by `GET /api/v1/sitemap` and
  the offline `npm run sitemap:generate` script. Vercel routing sends both
  root files to Nitro ahead of the SPA shell (`patch-vercel-output.mjs`,
  verified by `verify-vercel-output.mjs`). Validation: `test:seo`,
  `test:social-previews`, `test:api-capabilities`, `test:vercel-config`, Vercel
  preview curl checks. Details: [PR note](../PRs/brand-logo-seo-robots-sitemap-organization.md).

- 2026-09-16: Added public legal directory, versioned privacy/Apple TV privacy/terms pages and copy/text exports; retained legacy notices as labelled archives. Verified anonymous preview routes and responsive exports.


- 2026-09-12 — CI Control now distinguishes target activity, waiting, conflicts,
  failed workers and confirmed merges; removes the rolling finish estimate.
  Adds private per-run Ask Lopu status chat with capability negotiation, durable
  delivery/retry states, and an optional responder in the matching controller.
  Requires both product and controller rollout for new live conversations.
  Validation and rollout: [PR #782](../PRs/782-codex-stack-progress-chat-clarify-stack-progress-and-add-ask-lopu-run-chat.md).

- 2026-09-11: Add Settings saved AI waterfalls and reusable select, edit, save-copy and save-and-apply controls with private storage and stale-edit protection. See [PR 771](../PRs/771-ci-stack-model-selection-reusable-model-and-endpoint-waterfall.md).

- 2026-09-11: Add a reusable AI model/endpoint waterfall dialog and per-stack
  immutable routing, with a protected completion gateway and mixed-provider
  availability fallback. [Contract and rollout](../docs/ai-waterfall-selector.md). [PR #771 notes](../PRs/771-ci-stack-model-selection-reusable-model-and-endpoint-waterfall.md).

> `— Lopu, YYYY-MM-DD`. Keep the newest entries at the top.

---

## [Unreleased]

### 2026-09-03 — Generated marketing suite: 1,600+ pages, animated walkthroughs, social image suite — Claude (AI)

- Grouped summary; details in the PR note (`PRs/610-claude-marketing-suite--generated-marketing-suite.md`).
- **`/marketing`** is a catalog-generated marketing site: feature landing
  pages, how-to guides, animated cursor walkthroughs over mock screens,
  fair competitor comparisons and alternatives, audience pages, use cases,
  concept explainers, starter templates, twelve "style editions" per lead
  feature, FAQ pages and getting-started checklists — 1,635 pages from one
  data set (`remix/app/marketing/`), every slug validated, every link
  resolved, hero-first and CTA-last, deterministic per slug.
- **`/marketing/social-media`** is a menu-navigable image suite: every
  feature × twelve viral trend styles × ten platform formats renders as a
  self-contained SVG and downloads as PNG at the exact platform size, with
  per-platform captions and hashtags (10,680 images).
- Routes are lazy (`marketing`, `marketing/social-media`,
  `marketing/:category`, `marketing/*`); the root title effect defers to
  `useMarketingSeo` under `/marketing`; the drawer gains a Marketing hub.
- Tests: `npm run test:marketing` (catalog validation, walkthrough target
  coverage, SVG rendering, copy determinism, mock-screen coverage, player
  engine); manual checklist in `TESTING.md` ("Marketing suite"); design
  notes in `docs/marketing-suite.md`.

- 2026-09-03: Keep `/api/v1/capabilities` aligned with the protected admin preview dispatcher by publishing `api.admin-ci-previews` 2.0.0 from the canonical endpoint contract.

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
- **A declined promotion now says so on the source PR**: the promoter's
  stand-aside verdicts existed only as lines in a run summary, so a decline was
  invisible unless someone opened the run — which is why #211, the PR that
  converts `main` from a 2167-line resolver copy to a thin listener, was
  declined on 2026-08-09 and sat unnoticed. Declines now upsert one
  hidden-marker comment on the merged source PR, edited in place on later runs
  so repeat scans never stack, naming the reason and how many stacked PRs are
  held behind it. Dry runs stay side-effect free and a failed comment is a
  warning, never a reason to abandon promotion work. — Claude (AI), 2026-08-10

- **The thin product-branch listeners can reach the conflict resolver**: every
  secret-bearing gate tested `github.ref_name == 'github-actions'`, but under
  `workflow_call` that is the *caller's* ref, so `develop`'s listener was
  rejected in `detect` on every push, schedule and handoff it forwarded —
  including the worker handoffs older branch copies still aim at that ref.
  The gates now also accept a run started by this workflow's own listener on
  `develop`/`main`, which the caller contract already constrains to a single
  pinned `@github-actions` call with no executable behavior of its own.
  — Claude (AI), 2026-08-10
- **Required Web CI checks no longer strand non-Remix pull requests**: the
  protected implementation now classifies the complete changed-file list and
  assigns both stable context names to either the real build/API jobs or
  lightweight no-op companions. Incomplete or temporarily unavailable file
  listings safely run the full suite instead of stranding the required names.
  — Codex (AI), 2026-08-10
- **AI conflict resolution runs again (every worker was silently skipped)**:
  adding the promotion validator to `model_config`'s `needs` made GitHub apply
  that job's ordinary-mode skip to the whole downstream chain, so both the
  `resolve` matrix job and `resolve_promotion` never started — detection,
  routing, and model selection all reported success while nothing resolved
  (PR #220 and every handoff after the promotion worker landed). Both workers
  now opt out of inherited skips with `!cancelled()` plus exhaustive per-need
  result checks. — Claude (AI), 2026-08-10
- **Admin-selected conflict model now covers every protected AI runtime**: the
  `github-actions` control plane passes its validated Thingtime Admin primary
  model into merge- and rebase-side Graphify semantic refreshes as well as the
  Claude conflict edit. Clean rebases now load the setting before Graphify,
  and the control-plane contract inventories all active AI workflow/action
  YAML while rejecting legacy or hardcoded model selections. — Codex (AI),
  2026-08-10
- **Promotion self-test and empty-pick handling are runner-safe**: the
  per-feature promoter's orphaned-history fixture now configures its own Git
  author identity instead of depending on runner account defaults. Failed
  cherry-picks are classified from sequencer and index state rather than broad
  error-message words, so an operational failure such as `empty ident name`
  is aborted and reported instead of being mistaken for an empty patch and
  silently skipped. A genuine already-applied cherry-pick still advances the
  sequencer safely. See the
  [PR #207 engineering note](../PRs/207-codex-fix-promoter-empty-pick-detection-distinguish-empty-promotion-cherry-picks-safely.md).
  — Codex (AI), 2026-08-09
- **Automatic rebasing is now restricted to genuine PR stacks**: the stack
  detector still identifies a member only when its base targets another open
  PR head or another open PR targets its head, but automatic scans no longer
  override that topology for standalone PRs whose combined diff merges cleanly
  while individual commits are not replayable. Those standalone branches are
  left untouched instead of being force-rebased or ping-ponging after a merge
  resolver update. Shared topology and ownership expressions are rechecked at
  detection, worker validation, post-replay validation, pre-push validation,
  and failure cleanup; an inline truth-table regression guard covers
  standalone, stack, opt-out, and explicit exact-PR retry cases. — Codex (AI),
  2026-08-09
- **Per-feature promotion survives rewritten historical merge commits and
  isolated failures**: the `develop` → `main` promoter now verifies every
  source merge object, fetches unreachable historical merges by exact SHA,
  distinguishes a normal non-ancestor result from a Git inspection error, and
  requires original ancestry or both patch-equivalent history and current-tip
  effect verification before an old change may be promoted. Later reverts and
  removed aggregate ranges fail closed instead of being resurrected. It
  records structured per-PR blocks instead of aborting the batch. A failed
  standalone feature no longer prevents later independent promotions; a
  failed stack member still defers only its dependent members. Group-local
  exceptions are contained through the remaining groups before failing the
  run, the partial summary is always published, reused promotion branches are
  freshly fetched and checked against an exactly reconstructed source tree and
  expected PR base before stacking, every external OPEN link is validated back
  to `main`, every genuinely earlier CLOSED predecessor is checked, and
  `MAX_NEW_PRS` applies to branch reuse too. A local-Git regression test
  reproduces the force-rewritten-history failure before proving full-parent
  recovery. Promotion-marker lookup also scans up to 1,000 PRs so older records
  remain idempotent as the repository grows. See the
  [PR #206 engineering note](../PRs/206-codex-harden-feature-promoter-keep-feature-promotion-running-across-historical-git-failures.md).
  — Codex (AI), 2026-08-09
- **Conflict resolution now uses a fixed `develop` control plane**: every
  external event and human manual run is detector-only, then dispatches each
  selected PR number to the resolver workflow revision on `develop`; only a
  validated bot-originated internal handoff on that ref may load the model or
  resolve. Manual selection now accepts an exact PR number or a PR base/head,
  fails visibly when nothing open matches, reports when no merge worker is
  needed, and carries explicit retry intent through the trusted hop. Direct
  stack cascades use the same per-PR Actions dispatch instead of loading
  secret-bearing resolver YAML from the repository default branch. This closes
  the recurring `develop`-target/default-`main` workflow split once promoted;
  the older workflow already on `main` remains a one-time bootstrap limitation
  until this revision reaches it. See the
  [PR #190 repair note](../PRs/190-claude-github-action-pr-promotion-c65173-per-feature-develop-main-promotion-prs-with-stacks.md).
  — Codex (AI), 2026-08-09
- **Conflict resolver no longer mistakes promotion PRs for giant stacks**:
  `no-ai-rebase` PRs now break stack-topology edges, so the standing
  `develop` → `main` promotion PR cannot divert every feature PR targeting
  `develop` away from merge-based conflict resolution. The rebase detector's
  bottom-up ordering also loads repository-wide JSON from `RUNNER_TEMP`
  instead of command-line `--argjson` values, preventing the observed
  `jq: Argument list too long` detector crash as the open-PR graph grows. —
  Codex (AI), 2026-08-09
- **Password-confirmed reveal for protected Thing diagnostics**: new migration
  diagnostics use a backward-compatible v2 secure envelope that keeps a bounded
  set of MongoDB ObjectIds supplied by explicitly authored server-side error
  context behind numbered redaction
  references. The ordinary diagnostic response exposes descriptors only;
  credentials, tokens, URLs, private keys, query identifiers, and ambiguous
  24-hex values remain irreversible. `/thing/:id` now offers a reusable Reveal
  modal that verifies the current password on every lookup, keeps only one value
  transiently in memory, and clears it on hide, account/Thing change, navigation,
  or tab backgrounding. The closed-codec reveal endpoint rejects arbitrary
  secure fields and cross-origin/non-JSON browser posts, returns private no-store
  responses, and has a non-configurable fail-closed five-request/15-minute
  confirmation ceiling. Existing v1 diagnostics remain readable without reveal values. — Codex
  (AI), 2026-08-09
- **Builtin schemas no longer block whole-account storage accounting**:
  reserved system-owned `schema-*` Things are now seeded with the server-owned
  `storageClass: "control"` stamp, existing genuine seeds missing that stamp
  surface as pending and self-repair, and the account-storage orchestrator runs
  the schema seed prerequisite before scanning billable content. Community and
  user-authored schemas remain billable. — Codex (AI), 2026-08-09
- **Conflict detection waits out GitHub and says so when it stands aside**:
  the merge resolver's detector polled mergeability for only ~80 seconds
  after a base push, but GitHub's verdicts can take ~6 minutes to settle —
  observed on PR #190, where the develop push that created the conflict ran
  detection while the PR still read UNKNOWN, so nothing was handed off, no
  comment appeared, and the conflict sat silent until the scheduled sweep.
  Detection now re-queries until every scanned PR has a verdict or a time
  budget runs out (`MERGEABLE_POLL_SECONDS`, default 500s, with
  `MERGEABLE_POLL_INTERVAL` between re-queries; detect timeout raised to 15
  minutes), and the detect job now upserts a status comment on any PR it must
  leave alone — conflicting fork PRs it cannot push to, and PRs whose
  mergeability never settled — so detector silence always means "nothing
  needed doing", never "nobody looked". Conflicts that are handed off keep
  announcing themselves through the existing "Auto-resolve running" comment;
  the rebase workflow already polls its verdicts round-robin and is
  unchanged. Also restored the "AI PR and stack rebase conflict resolution"
  changelog bullet's opening line, dropped by the AI resolution of a previous
  merge. — Claude (AI), 2026-08-08
- **Contextual reaction/migration errors + storage migration upsert repair**:
  Lopu can no longer render a lone 🌧️ when Nitro replaces an unhandled server
  exception with boolean `error: true`; fetch failures now become typed,
  action-aware errors, one-shot toasts reject non-string runtime values, and
  failed reaction writes distinguish known rejection from an ambiguous
  network/5xx outcome (refetching server truth instead of blindly reversing a
  possibly committed toggle). Reaction and migration routes preserve authored
  failures and turn unknown exceptions into safe class/code summaries without
  leaking stacks or database details publicly. Failed real admin migrations now
  capture a bounded, secret-scrubbed diagnostic after releasing their lease,
  store it as an expiring owner-only, non-billable control Thing, and link the
  Lopu toast to its readable `/thing/:id` view; failed dry runs never create a
  diagnostic Thing and show the full redacted detail in a long-lived scrollable
  toast. If diagnostic persistence is unavailable, real runs use that same
  private inline fallback without masking the original status or outcome.
  Structured login/account-switcher failure
  fields remain intact, malformed successful mutation responses are reconciled
  as commit-unknown, server-marked reaction rejections roll back without a
  redundant read, and late reaction truth merges only reaction fields so it
  cannot overwrite newer comments or shares. Migration invariants now use a
  closed operator-safe message catalogue with private record ids confined to
  server logs. The three storage backfills are unblocked:
  their shared app-counter ensure path no longer puts `$expr` in an upsert
  predicate (MongoDB code 224); it upserts by the deterministic reserved
  `shareId` and still validates the complete protected envelope before trusting
  either a new or existing ledger. — Codex (AI), 2026-08-08
- **`withMongoTransaction` ReferenceError + Web CI transaction support**: the
  AI-resolved merge that landed on main via PR #158 left `withMongoTransaction`
  calling the removed `getClientCached()`, 500-ing every transactional write
  (registration's subscription-ledger seed, service-account creation,
  verification emails — Web CI's API suite red on main). The transaction client
  now mirrors the collection getters: `withMongoTransaction` follows the ACTIVE
  data plane (like `getCollection`) and the new `withHomeMongoTransaction` is
  pinned home (like `getHomeCollection`) for the protected home-plane callers
  (themes, algorithms, apps, registration). Web CI's `mongo:7` service is
  replaced by a docker-run **single-node replica set** (standalone mongod
  rejects transactions with IllegalOperation, and there is deliberately no
  non-transactional fallback), so the transactional paths are now genuinely
  exercised in CI — local runbook note: transactional flows need an
  RS-enabled local mongod too (`mongod --replSet …` + one-time
  `rs.initiate(...)` with an explicit `127.0.0.1` member host). The two strict
  `[401]` auth-guard API tests now send truly anonymous requests (new
  `anonymous` test flag honored by both the /tests page and the headless
  runner) instead of inheriting the suite's shared session cookie. Full suite:
  307/307 against a local single-node RS. Both auto-resolver workflows also
  now post an upserted "resolution/rebase running, expected finish ~time"
  PR comment before starting, so reviewers who catch the conflict window
  aren't left guessing. — Claude (AI), 2026-08-08
- **Mixed-plane transactions resolved — ledgers have one true plane**: user
  subscription/billing objects (`subscriptions.ts`, `userStorage.ts`,
  `tierCatalogStore.ts`) are now HOME-pinned like users/sessions, and account
  storage meters HOME-hosted bytes only — active-plane writers (`things.ts`
  create/update/delete, `appData.ts` set/delete) skip account accounting and
  content stamps when a data-plane endpoint override is live (bytes on a
  user's own MongoDB are not Thingtime storage; app ledgers still
  self-account on the active plane). Registration/service-account creation
  now succeed with an override active: identity + ledger land home, verified
  live (register + posts with/without `x-tt-mongo-url` against two dbs on
  one RS mongod — home ledger read exactly the home post's bytes; the
  override post carried no stamps and moved no ledger). Local runbook:
  boot now probes transaction support and prints the exact single-node-RS
  conversion + `rs.initiate` commands when the connected mongod is
  standalone (`warnIfTransactionsUnsupported`), `/api/v1/mongodb/status`
  reports `replicaSet`, and the brew `mongod.conf` replica-set stanza is
  staged locally (takes effect on the next sudo mongod restart +
  one-time initiate). — Claude (AI), 2026-08-08

### Added

- **Control-plane pushes sweep every open PR, plus a `no-ai-merge` opt-out**:
  pushing the `github-actions` branch now runs a repository-wide conflict
  sweep instead of matching only PRs based on that branch, so landing a
  resolver change retries every conflicting PR immediately rather than waiting
  for the twice-hourly schedule. PRs labelled `no-ai-merge` (the new
  never-auto-resolve opt-out, narrower `no-ai-rebase`'s counterpart) are
  dropped by the detector before any comment, dispatch, or AI spend. — Claude
  (AI), 2026-08-10
- **Promotion PR rebase protection (`no-ai-rebase`)**: the promotion workflow
  now creates the standing develop → main PR with — and re-applies on every
  develop push — the `no-ai-rebase` label (env `PROMOTION_PR_LABELS`, creating
  the repo label if missing; the AI workflows honored it but nothing had ever
  created it). The AI rebase workflow skips labeled PRs, so develop — an
  integration branch whose history IS its merge commits — is never flattened
  again (the 2026-08-08 develop rebase destroyed merge-subject and SHA↔PR
  attribution, the changelog's primary signals). The merge-based conflict
  resolver explicitly keeps ownership of `no-ai-rebase` PRs and levels
  develop with main via history-preserving merge commits, the repo's house
  style. Label state is read via REST (search-backed listings lag) and stray
  removals self-heal on the next develop push. — Claude (AI), 2026-08-08
- **Promotion PR changelog**: the **Promote develop to main** workflow now
  maintains an at-a-glance changelog on the standing promotion PR. A new
  `.github/scripts/promotion-pr-changelog.mjs` resolves the first-parent spine
  of `main..develop` to the merged develop-based PRs it carries (merge/squash
  subjects, then content matching against recently merged PRs — merge SHA, PR
  title, and the PRs' own commit subjects, which survives AI rebases of
  develop — then the commit-association API), rewrites a marker-delimited
  section of the PR description with a PR table (title, author, source branch,
  merge date), `no-promote` label warnings re-verified via REST, and collapsed
  direct commits, and posts short delta comments when PRs enter or leave the
  promotion window. State is derived from the PR body itself; re-runs on the
  same develop SHA are byte-identical no-ops. Supports `DRY_RUN=1` and
  `--self-test`. — Claude (AI), 2026-08-08

- **Beta media-upload approval gate (consolidated with the #301/#310
  hotfixes)**: uploads are governed by the scoped permissions from PR #310
  (tri-state `meta.publicUploads` + `meta.privateUploads`; absent =
  grandfathered, purpose-aware start gate with
  `public_uploads_not_approved` / `private_uploads_not_approved`). This PR
  fixes the parallel-gate double-grant hazard by removing the earlier
  duplicate gate from the upload START path, keeps
  `PublicUser.canUploadMedia` as the any-scope alias, and ships the composer's
  purpose-aware 🔐 approval-pending card (public purposes check
  publicUploadsEnabled, message/profile purposes check privateUploadsEnabled).
  The already-started parts/complete calls keep one extra any-scope check that
  still answers `403 { code: "media_upload_not_granted" }`, while abort/delete
  stay open. The per-account `meta.mediaUpload` / root `secureMediaUpload`
  grant (Grant/Revoke media on `/admin` → Users, `POST
  /api/v1/admin/set-media-upload`, the registration request email to
  `THINGTIME_ADMIN_EMAIL`, and the `grant-media-upload-to-existing-users`
  grandfathering migration) is retained as an admin-visible grant record; the
  scopes are the single enforcement path. See the
  [PR #302 implementation notes](../PRs/302-claude-media-upload-permission-gate--beta-media-upload-permission-gate.md).
  — Claude (AI), 2026-08-18

### Fixed

- **Consolidated uniqueness lookups no longer collection-scan `things`.** The
  post-consolidation helpers queried `$or: [{uniqueKeys}, {crystal.<field>}]`,
  but the five `crystal.*Key` indexes had just been dropped and MongoDB only
  unions an `$or` when *every* branch is indexed — so each lookup degraded to a
  full scan (measured on a live MongoDB 8 replica set: 50,001 docs examined vs
  1), once per synced live event, message segment, command and approval. The
  fallback arm could never match anyway: all five key families are introduced
  by this branch, so no row predates the root stamp. Lookups are now a single
  indexed `uniqueKeys` predicate, and the key rides `$setOnInsert` rather than
  `$addToSet`, which an equality filter makes illegal on upsert.
  — Lopu, 2026-08-28
- **The device bootstrap stopped resurrecting `crystal.deviceUniqueKeys`.**
  `newDeviceThing` deliberately no longer writes that mirror, so every device
  row created since the last cold start re-matched the legacy backfill and had
  it written back — an unaccounted `raw` write that bypasses the storage ledger,
  on a filter that never converged. The backfill is now scoped to rows that
  predate the root `uniqueKeys` stamp. — Lopu, 2026-08-28

### 2026-08-25 — Action Thing v1 security review: private minting, trust boundary, delegated resolution

- Multi-agent defensive security review of the Action Thing surface (report:
  SECURITY-REPORTS/2026-08-25-action-thing-v1-security-review.md). Three
  findings, all fixed: action-created things now mint PRIVATE
  (`acl: [ACL_OWNER]`) instead of inheriting createThing's public standalone
  default; the /things PreviewModal passes `untrusted` for components the
  viewer does not own, so foreign markup renders inert; and a ttAction click
  (`source: 'component'`) resolves only actions the invoker owns, closing an
  id-path hijack the actionKey branch was already hardened against. The
  inspector also stopped asserting absolute negatives for composing actions.
  Battery 73/73 (+8 security regressions), test:actions 27/27,
  test:schemas 82/82. Verified live: a foreign component renders but does not
  fire, an owned one still does, and onboard-customer's invoice is private.

### 2026-08-25 — Action Thing v1: builder, ttAction closure, Used-by, v2 design

- "⚡ New action" builder on /actions with LIVE-DERIVED capabilities
  (declaration always covers behavior — one unscoped step unscopes the
  capability), ttAction component-render bindings (data-tt-action /
  data-tt-action-inputs, the only allowlisted data-* attributes; /things
  PreviewModal is the interactive surface), the Used-by back-reference
  panel on the inspector, seven Lopu-review fixes across review rounds, unit
  suites test:actions (23) + actionGrammar (15), and the v2
  external-capabilities design (PRs/action-thing-v2-external-capabilities.md).
  Details: PRs/387-*.md. CI green; batteries 65/65 + 30/30. A functional
  multi-review pass (correctness / UX-consistency / docs-accuracy) then
  landed: optimistic cached paint on /actions/:key, ActionChip overflow
  guards at 375px, family-consistent pink CTAs, design-doc reconciliation
  with the shipped grammar/executor, input-default/type congruence
  (save-time refusal + type-aware builder coercion), the ⚡ kind renderer
  wired into /things tiles, inspector state reset on cross-action
  navigation, and latest-revision resolution for duplicate actionKeys
  (executor + inspector agree; test:actions 25, test:schemas 82).

### 2026-08-24 — Action Thing v1 (declarative, capability-bounded programs)

- New `action` + protected `action-run` kinds, executor
  (`api/utils/actions/execute.ts`), `POST /api/v1/actions/run` +
  `GET /api/v1/actions/runs`, /actions browse + inspector UI, ⚡ kind renderer
  and Actions filter on /things, drawer entry, and the Customer/Invoice demo
  seed (`scripts/seed-demo-app.mjs`). Verified by
  `scripts/verify-actions.mjs` (52 live checks) + browser click-through.
  Details: `PRs/action-thing-v1-design.md` and PR #387 (stacked on the
  Components runtime split, PR #382).

### Changed

- **Saved Feature Stacks now have Pause, Stop, and Restart controls.** Pause
  and Stop cancel only the exact linked GitHub Actions run while retaining the
  stack definition and historical run links; Restart safely cancels active
  compute before creating a fresh immutable run. Late webhook and progress
  receipts cannot overwrite a deliberate paused or stopped state.
- **Feature Stack progress no longer disappears under a busy CI event feed.**
  The saved-stack endpoint returns a bounded per-dispatch event stream, so
  immediate, phase-change, and 10-minute Lopu heartbeats remain chronological
  and visible while unrelated repository automation is active.
  Details: [PR #550](../PRs/550-codex-feature-stack-lifecycle-main-feature-stack-run-controls.md).
  — Codex (AI), 2026-09-01

- **Reusable Feature Stacks no longer fail because an older selected PR has
  already completed.** Each run now omits merged, closed, and draft entries at
  admission time, keeps every remaining live source in the saved order, and
  rejects only when no compatible live source remains. The protected target
  worker now stays active through branch protection until its generated stack
  PR has actually merged. — Codex (AI), 2026-09-01

- **Feature pushes no longer spend Vercel Build CPU.** Root Vercel Git policy
  now disables automatic deployments with the recursive `**` branch glob for
  every branch except exact `main` and `develop`; eligible PR previews are
  compiled on GitHub and uploaded as validated prebuilt bundles targeting the
  `develop` Custom Environment without the production-only `--skip-domain`
  flag, while native production and stable-development builds remain intact.
  — Codex (AI), 2026-09-01

- **Editor.js block controls now stay at the active line's right edge on
  mobile.** The + and settings buttons no longer drop underneath post text,
  and the editor reserves enough inline space to prevent overlap with long or
  right-aligned blocks. — Codex (AI), 2026-09-01

- **Running Feature Stacks now report durable Lopu progress into their own CI
  console.** The protected controller sends an immediate signed snapshot,
  phase transitions, ten-minute heartbeats, and a terminal update. Thingtime
  binds each event to the exact stored stack/run, renders it chronologically,
  links back to the precise Actions run, and refreshes progress plus the
  viewer-local finish estimate without exposing workflow credentials.
  — Codex (AI), 2026-09-01

- **Feature Stack runs now expose their exact GitHub Actions history and stop
  reporting a finished controller as live.** Every new dispatch carries a
  durable run identity, signed workflow events attach the exact run URL, the
  activity stream is sorted chronologically, and a controller that exits before
  publishing a target PR is labelled Needs attention instead of receiving an
  ever-moving ETA. The protected Lopu worker also tolerates its expected skipped
  sibling dependencies, so admitted target merges actually start.
  — Codex (AI), 2026-09-01

- **Published posts and rich comments now retain their native Editor.js
  document across the browser API boundary.** The request allowlist includes
  `richText` alongside the canonical plain-text fallback, so headings no
  longer reappear as literal Markdown such as `## Posts` after posting or
  reloading. — Codex (AI), 2026-09-01

- **Posting now flushes the live Editor.js document before freezing a post
  payload.** Tapping Post immediately after changing a heading, colour,
  alignment, size, whitespace, or line break can no longer publish the older
  plain-text snapshot while the composer still shows the newer rich styling.
  — Codex (AI), 2026-08-31

- **Post media editing now has one visual source of truth.** Auto and Rows show
  final-view previews, Rows uses add/remove and per-row image-count controls,
  Grid previews expose the clickable 1×1 span badge, and the single Media &
  files panel owns reorder, metadata, and delete actions in create and edit.
  Attachments are now default searchable level-one Things (including display
  filename/title/description), while Reaction schema searches resolve human
  emoji names such as “heart” to stored emoji and render the matching parent
  posts. — Codex (AI), 2026-08-31

- **[Admin CI refreshes now fail softly and recover without a request
  storm.](../PRs/513-codex-fix-admin-ci-sort-memory-admin-ci-refresh-resilience.md)**
  The protected snapshot route turns MongoDB blocking-sort memory failures into
  a retryable, private 503 with stable route/error-code telemetry, while the UI
  keeps its cached state, deduplicates overlapping pollers, and exponentially
  backs off automatic retries up to five minutes. — Codex (AI), 2026-08-31

- **Passkeys and the Admin CI snapshot now recover from the two mobile failure
  modes seen in production.** Registration and login options require the same
  on-device user verification enforced by the WebAuthn verifier, so a valid
  iCloud Keychain or 1Password ceremony is no longer rejected after the
  authenticator returns. CI entities are read per repository through a stable
  compound sort index instead of a growing in-memory sort, and a saved Feature
  Stack keeps its PR-number placeholders visible until a temporarily missing
  live snapshot can rehydrate them. Unlimited Feature Stack selection no longer
  makes the same request fetch unlimited run, deployment, preview, and dispatch
  history; activity stays bounded while the dashboard totals remain exact.
  Running Feature Stacks now also respect an
  admin's collapsed-card choice instead of immediately forcing themselves open.
  — Codex (AI), 2026-08-31

- **[Admins can now opt a trusted PR into Develop and Production/Main previews
  independently.](../PRs/505-codex-feature-stack-merge-status-filters-admin-ci-feature-stacks-and-pr-previews.md)**
  Each switch builds the exact live same-repository SHA with
  its selected Vercel environment, production access requires an explicit
  warning acknowledgement, signed PR/Vercel events refresh later commits and
  status, and immutable preview URLs never take over a stable custom domain.
  Marker-scoped cleanup cannot delete ordinary develop or production
  deployments. — Codex (AI), 2026-08-31

- **Feature Stack selection and monitoring now stay focused during large merge
  batches.** Exact clean, conflicting, draft, merged, closed, and unknown PR
  filters replace the broad status buckets; independently scrolling selected
  and available-PR panes stop row additions from moving the page; compatible
  sources and targets are safely retained when another selected branch family
  has no match; and the active stack shows a live progress feed with workflow,
  target, and local-time ETA updates. Every Admin tab now has a bookmarkable
  subroute, CI Control's long cards remember their collapsed state, and its
  compute settings identify the one Lopu repository manager separately from
  supporting build pipelines. — Codex (AI), 2026-08-31
- **Post text now keeps its real rich-text presentation after saving.** Feed,
  profile, repost, comment, and permalink cards render the bounded native
  Editor.js document—including inline marks, block style tunes, repeated
  whitespace, and hard line breaks—while retaining a canonical plain-text
  fallback for search, moderation, notifications, and older clients. — Codex
  (AI), 2026-08-31

- **Moving preview and production aliases now self-heal stale client chunks.**
  Vite preload failures and React Router lazy imports share a one-reload
  session guard, recognise Chromium, Safari, and Firefox dynamic-import errors,
  and clear the guard only after ten healthy seconds so a broken network or
  deployment cannot create a reload loop. — Codex (AI), 2026-08-31

- **Vercel now serves Thingtime's origin-scoped API capability manifest from
  Nitro instead of the SPA shell.** The generic
  `/.well-known/thingtime-capabilities.json` route joins OAuth and ChatGPT
  discovery ahead of the filesystem and `index.html` fallbacks, and the built
  output verifier locks in that ordering. — Codex (AI), 2026-08-31
- **The new Limitless MCP Lab turns the live connector contract into an
  interactive use-case gallery.** `/docs/mcp` discovers the public MCP methods
  in parallel, keeps the current release contract on first paint, demonstrates
  five composable workflows, and drives the exact shipped review App with
  synthetic non-mutating previews so confirmation and recovery behavior can be
  explored safely. Its production route grants that sandboxed App only the
  exact SHA-256 script hash it needs, preserving the strict global CSP without
  `unsafe-inline` or `unsafe-eval`. — Codex (AI), 2026-08-30
- **[Thingtime’s ChatGPT/Codex MCP surface is now composable and preview-first.](../PRs/482-codex-limitless-mcp-make-thingtime-mcp-limitless-composable-and-safe.md)**
  Thirty-one bounded tools add exact batch reads, schema intelligence,
  relationship/thread traversal, change polling, signed multi-Thing previews,
  optimistic concurrency, encrypted history/undo, durable Capability workflow
  runs, MCP prompts/resources, and an interactive result/diff review UI while
  continuing to reject arbitrary routes, queries, and code. — Codex (AI),
  2026-08-30
- **Desktop AI and device idempotency now share Thingtime's protected
  uniqueness namespace.** Five one-off crystal-path unique indexes were
  consolidated into the existing Binary root `uniqueKeys` index, restoring
  five MongoDB slots (57/64 in the complete home plan), keeping domain hashes
  out of the wildcard text index's uniqueness mechanism, and preserving
  compatibility through a home-only backfill. The migration no longer rewrites
  or drops indexes in user-owned custom data endpoints. — Codex (AI), 2026-08-28
- **Lopu's model-waterfall streaming retries now have behavioral SSE coverage.**
  A dedicated provider-double suite proves that a reasoning-starved decorated
  Claude or OpenAI stream retries bare on the same model, never retries after
  visible text, reads the durable waterfall once, emits no blank provider
  metadata, and reaches the canned library only after both providers genuinely
  starve. — Codex (AI), 2026-08-27
- **Web search now exposes its real relevance signal and keeps post context
  inline.** Ranked Thing results carry the query-relative Mongo text score and
  show it as subdued metadata in both Standard and Data views; unselected
  Commander Enter defaults to the full-search row without stealing setter
  commands, and `/thing/:id` renders a post-shaped Thing with its interactive
  post card above the raw data. — Codex (AI), 2026-08-27
- **Thingtime’s ChatGPT deployment runbook now follows the supported workspace
  app path.** It documents Admin/Owner Developer Mode, Apps → Create, OAuth
  tool scanning, draft testing from the tools menu/@mentions, publication,
  frozen tool snapshots, Enterprise/Edu refresh controls, Business
  recreate-and-republish release requirements, role/action controls, and the
  current web-only plus plan-level write limits. — Codex (AI), 2026-08-26

- **Explicit data-authority identity for clients and peer federation**:
  deployments now publish a safe `production`, `development`, or named
  `custom` database/authentication environment through root data and
  `api.capabilities` `1.1.0`. Electron rejects selected endpoints that cannot
  prove this identity, account recovery uses its configured authority rather
  than Vercel tier/branch inference, and signed peer gossip is scoped to the
  matching federation id. No MongoDB host, database name, connection string,
  account, or secret is exposed. — Codex (AI), 2026-08-24

### Added

- **Per-channel notification toggles + SES notification emails**: Settings →
  Notifications is now a per-type × per-channel switch matrix — Push (the
  bell/in-app channel, stored as the original flat pref keys so existing prefs
  keep working) and Email (new nested `email`/`masters` keys in the same
  secure-blob pref object), each with a master switch. Activity notifications
  (friend requests/accepts, new followers, comments, replies, reactions,
  shares; posts-from-followed/friends email opt-in) now also send SES emails on
  the new `notification` email stream — fire-and-forget from the same emits,
  verified addresses only, ≤10/recipient/hour throttle, manage +
  one-click-unsubscribe links in every footer (HMAC-tokened
  `GET /api/v1/notifications/email/unsubscribe`). A weekly summary digest
  (email-only type, Vercel cron `remix/vercel.json` →
  `GET /api/v1/notifications/email/weekly-summary` with `CRON_SECRET` bearer or
  admin session, six-day idempotency lookback, dry-run mode) recaps followers,
  requests, comments, replies, reactions, shares, post views and posts. New
  env: `THINGTIME_EMAIL_NOTIFICATIONS_FROM`, `THINGTIME_EMAIL_UNSUB_SECRET`
  (optional), `CRON_SECRET`, `APP_URL` (email links) — see README “Notification
  emails”. — Claude (AI), 2026-08-03

- **Followers + friends, notifications, and public post view stats**: one-way
  follows and approval-based friendships (`follow`/`friend` protected things,
  `/api/v1/users/{follow,friend,relationships,connections}`) with the
  `tt:userFriends` acl circle now resolving against the real friend graph;
  server-minted in-app notifications (nav bell 🔔 + popover, capped post
  fan-out, per-type switches in Settings → Notifications stored in the user
  secure blob, read-time pref filtering); and anti-bot post view telemetry
  (`postViews` collection, unique-viewer dedup per salted identity,
  dwell/ratio/position capture via `useViewTracking` on feed/profile/permalink,
  public 👁 viewCount + impressions/avg-read-time on every post). Detailed
  notes in `PRs/followers-friends-notifications-views.md`.
  — Claude (AI), 2026-08-03

### Fixed

- **Multi-emoji reaction tokens render in full on the react button**: the
  merged reaction control truncated every token to its first grapheme, so a
  🤣🤣🙌💀💦 reaction looked like 🤣; posts and comments now show the whole
  token. — Claude (AI), 2026-08-03
- **Mobile nav controls no longer sit under the commander pill**: the
  nav-right section (bell, username) stacks above the absolutely-positioned
  search pill and the pill reserves room for the bell, so those controls are
  tappable on phones. — Claude (AI), 2026-08-03

- **Index bootstrap recovery after PRs #159/#161**: failed boot-time
  `ensureIndexes()` work no longer caches a rejected promise for 60 seconds.
  The next explicit bootstrap caller retries immediately, while hot request
  paths remain isolated from the index battery; rate-limit and index-warmup
  diagnostics/checklists now describe their independent failure paths.
  — Codex (AI), 2026-07-30
- **Fresh worktrees now bootstrap complete pnpm dependency links**: Codex
  worktree carryover no longer copies large, partial `node_modules` symlink
  trees that can leave ESLint/Vite wrappers without their packages. A shared
  dependency check now repairs links from pnpm's store and runs automatically
  before Remix dev, build, and lint commands. — Codex (AI), 2026-07-30

- **PR #69 final-review hardening round**: a multi-agent review of the unified
  /search + profile/feed branch surfaced a batch of merge-blocking issues, all
  fixed here — Claude (AI), 2026-07-17:

  - **Advanced filters no longer 400 + wipe results on numeric values**: the
    query builder's default `contains` operator coerced `4`/`true`/`null` to
    real types, which the server rejects for text-only operators, clearing the
    visible feed. `contains`/`startsWith`/`endsWith` now keep the raw string.
  - **Composer no longer destroys a user's `tmp` things**: seeding the thingtime
    draft replaced the whole `tmp` store branch; it now prunes only prior
    composer sessions and preserves any user-authored `tmp` keys.
  - **Untrusted schema render can't paint a full-viewport overlay**: the Chakra
    thing renderer allowed arbitrary `position` CSS, enabling a clickjacking /
    phishing overlay on the schema-browse page. Out-of-flow positioning
    (`fixed`/`absolute`/`sticky`) is now stripped at every nesting level.
  - **`/api/v1/email/config` is dev/preview-only**: the endpoint exposed SES
    region, sender identities, and the test-recipient email with no auth; it now
    gates on `shouldShowDevVerificationLink()` like its sibling `test-otp`.
  - **Collection→things migration no longer drops writes that raced an earlier
    pass**: the delete guard compared fresh legacy data only to the batch
    snapshot, so a retry deleted newer legacy writes while the thing kept stale
    data. It now reconciles against what the destination twin actually reflects
    and preserves the destination's shareId when rebuilding.
  - **Data-crystal keys reject prototype accessors**: `__proto__` matched the key
    grammar and was silently dropped by `out[key] = …` (a contract violation);
    it now fails loudly, consistent with the render-tree sanitizer.
  - **/search and feed Advanced filters agree on relevance-without-text**:
    `/search` sent `sort=relevance` with an empty query (server 400); it now
    drops to server-pick like the feed panel does.
  - **Re-clicking Search with an unchanged Advanced draft refetches** instead of
    silently no-op'ing on React's identical-state bail-out.
  - **`/verify-email` renders real copy for crafted `state` params** (own-property
    lookup instead of a prototype-chain hit that blanked the card).
  - **Password-reset confirm is now IP-throttled** (`auth.passwordResetConfirm`),
    and a few PR-introduced `tsc` errors (schema browse cursors, migration
    fail-reason narrowing) were cleared.

- **/search no longer hijacks navigation or searches uninvited**: a search
  resolving after the user already left the page used to replace-navigate
  them back to `/search` (the post-search `?q=` URL sync); it now only syncs
  the URL while the page is still mounted. Entering `/search` also no longer
  auto-fires a search — only explicit deep links (`?q=` from Commander,
  `?schema=` from /schemas) auto-run; plain visits paint last-cached results
  without a refetch, and a fresh visit shows an invite empty state instead of
  "Nothing matched". The input's rainbow ring also renders at full strength
  from the first frame (new `Rainbow` `instant` prop) instead of fading in
  over ten seconds. Review hardening: the URL sync also respects pending
  departures to loader-bearing routes and Back within /search (location-key +
  navigation-idle guards), Commander re-running a cache-restored query fires
  a real search (echo guard now tracks the last synced q, not live input),
  failed/aborted searches keep the invite state and can't poison Load more
  pagination, and a dead `?schema=` link strips itself without firing an
  unrequested fallback search. — Claude (AI), 2026-07-16

### Changed

- **One exact logical-byte accounting model across Thingtime**: account usage
  now comes only from the protected subscription ledger and is enforced on
  every supported customer-content writer in the same Mongo transaction as
  the content. App data moves the account, whole-app, and per-app-user scope
  counters from one canonical UTF-8 JSON measurement without double-counting
  the account total. Legacy user usage values are ignored and removed during
  the idempotent storage migration; explicit legacy allowances become real
  overrides. APIs and UI now expose a canonical `storage` projection with
  `ready`, `reconciling`, or `unavailable` status, preserve flat fields only as
  derived compatibility aliases, show exact byte counts, and never present an
  unavailable ledger as zero. Protected envelopes, transactional
  reconciliation, full-source compare-and-swap migration, global lease
  fencing, app lifecycle guards, and focused race/malformed-ledger tests close
  the previously independent and bypassable counter paths. See PR #170's
  detailed note in `PRs/`. — Codex (AI), 2026-08-07

- **PR conflict-resolution models are now an admin-managed waterfall**:
  the resolver hard-defaults to Claude Code's `default` model, then reads the
  public `Thingtime.PRConflictAutoResolverModelWaterfall` setting and applies
  its strictly allowlisted order through Claude Code's native model fallback
  chain at max effort. Admins can add, remove, and drag Fable 5, Opus 5, and
  the required default fallback in Settings; anonymous callers can read the
  public projection, while every write is re-authorized server-side. Invalid,
  empty, or unavailable remote config fails safely back to `default`.
  — Codex (AI), 2026-08-07

- **App-data now has real allowances at both scopes**: every registered app
  stores a server-owned 5 GiB aggregate allowance/usage counter plus a 50 MiB
  per-app-user allowance. Namespace writes reserve both guarded ledgers,
  deletes refund both, `/api/v1/app-data/usage` reports used/allowance/remaining
  for each, and `/api/v1/apps` exposes the developer's aggregate status without
  allowing `/apps/update` to raise it. The idempotent
  `backfill-app-storage-allowances` migration write-fences legacy apps,
  reconciles user ledgers, and initializes aggregate usage last. — Codex (AI),
  2026-08-02

- **Repository AI guidance now has one canonical source**: unique rules from
  the former root `AGENTS.md`, `CLAUDE.md`, and `CODEX.md` now live in
  `AI_ALL.md`; the standard Codex and Claude filenames are relative symlinks to
  it so every checkout and tool reads the same policy. — Codex (AI), 2026-07-30

- **Feed things render natively** (`ThingView`): thingtime posts mount the real
  Thingtime component — right-click context menu, collapse, and view⇄edit
  toggling — over a sandboxed store, defaulting to view mode. Things resolving a
  kind renderer (a `render:` prop, explicit kind, or structural match — first
  that adapts wins) or an Editor.js `rich-text` value render through that
  renderer by default, with a corner icon flipping back to the Thingtime tree.
  Untrusted feed/search data is fenced: an explicit safe-kind allowlist, every
  `href`/`src`/`url()` sink scheme-guarded (`safeUrl`/`safeCssUrl`), the chakra
  path + `window.meta` writes disabled, Cmd+Z contained so it can't corrupt the
  viewer's real tree, and large things bounded (collapse + scroll box). Detail
  in `PRs/69-…`. — Claude (AI), 2026-07-15
- **Everything is a thing, for real now**: users, themes, feed algorithms, and
  waitlist entries are stored in the `things` collection as protected system
  kinds (`user`/`theme`/`feed-algorithm`/`waitlist`, plus seeded `schema`
  things for every builtin kind). Public payloads live in `crystal`; secrets
  (emails, password hashes) are BinData under the root `secure` field so the
  search text index can never tokenize them; uniqueness rides BinData
  `uniqueKeys` (PII hashed). Reads are dual-era (things first, frozen legacy
  collections as fallback) and admin migrations under `/api/v1/admin/migrations`
  convert each legacy collection idempotently. Legacy ids are preserved as
  thing shareIds so sessions, rosters, ownerId joins, share links, and active
  theme/algorithm pointers keep working unchanged. FUNDAMENTALS §3 rewritten.
  Details in TODO/claude-todo/22-everything-is-a-thing-collections.md.
  — Claude (AI), 2026-07-12

### Added

- **Public sign-up rate limit (`auth.register`)**: POST /api/v1/auth/register is
  now throttled per IP (default 10 per 15 minutes, admin-tunable like every
  rule) before any work runs. Registration was the one unauthenticated mutating
  auth route with no limiter — each attempt burns a bcrypt hash, a success
  emails an arbitrary address, and since PR #162 a broken-index state re-runs
  the ensureIndexes battery per attempt; blocked requests now 429 before
  reaching any of that. — Claude (AI), 2026-07-30

- **Atomic service-account quotas**: `GET|POST /api/v1/things/quota` stores one
  private deterministic `data` Thing per service owner + key and atomically
  reserves daily work, grants rolling-window permits, releases unused slots,
  and resets daily usage without cancelling in-flight identities. The route
  accepts only live service-purpose credentials, pins policy on first reserve,
  uses server time, scopes every mutation by owner, and fails closed when
  storage is unavailable. Official API docs, auth smoke coverage, and focused
  policy/rollover/idempotency tests ship with it. — Codex (AI), 2026-07-19

- Added the standalone consent-first Thingtime MCP foundation under `MCP/`:
  MCP desktop hosts can explicitly stage their current chat, user-approved
  ChatGPT/Claude exports and a portable app manifest normalize into one schema,
  allowlisted local attachments are copied into private staging, credential-like
  metadata is redacted, and relational `ai-chat`/`ai-chat-message` ThingtimeDB
  records can be previewed without writing to the platform. Details in
  [`PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md`](../PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md).
  — _Codex (AI), 2026-07-13_

- Extensible data: every `things` doc now carries a schema-free top-level
  `extended` property — any JSON up to 512KB, stored and returned exactly as
  given, never validated, structured-searchable, or interpreted;
  replace-on-write (`null` clears), threaded through create/upsert/patch and
  both public projections, with one reserved key (`tt:textLanguage`, the text
  index's language override). Crystals are now optionally schema-less too:
  omitting `thingtime` on create defaults to `["data"]`, so a bare
  `{ crystal: {…} }` behaves like an extended-style field bag while staying
  /search-able. — Claude (AI), 2026-07-12
- Ported the stranded PR #52/#35 email + auth work onto the unified data
  model: the owned email layer (`api/utils/email/` — outbox `email_messages`
  rows for every send, suppression/unsubscribe checks, SES or console
  delivery, `GET /api/v1/email/config`, dev/preview `POST /api/v1/email/test-otp`),
  password reset (`POST /api/v1/auth/password-reset` + `/confirm` — probe-proof
  neutral responses, single-use 1h tokens, revoke-all-sessions on rotation,
  per-IP `auth.passwordReset` rate limit, `/reset-password` page), and opt-in
  email 2FA (`GET/POST /api/v1/auth/two-factor`, two-step
  `POST /api/v1/login { challenge, code }` with hashed attempt-capped OTPs in
  `authOtps`, per-IP `auth.login` rate limit, Settings → Security toggle, login
  form code step). Also ports the `/verify-email` landing page the emailed
  verification links point at. — Claude (AI), 2026-07-12
- `/search` page + `POST/GET /api/v1/things/search`: a Commander-style search
  over every visible thing — whitelisted MongoDB operator grammar (nested
  all/any groups, bounded primitives only, escaped-literal text ops), ranked
  text search via a weighted wildcard text index, new free-form `data` and
  user-authored `schema` crystal schemas, search-by-schema prefill, a pinned
  Commander "Search things" row, and a `things.search` rate-limit window.
  Details in
  [PRs/63](../PRs/63-claude-search-page-mongodb-query-154eb4--search-page-query-builder-ranked-text-search-by-schema.md).
  — Claude (AI), 2026-07-12
- Replaced the unfinished `/raw` MongoDB dump with an admin-only no-code Query
  Workbench: nested filters, typed BSON values, projections, sorting, bounded
  find/count/distinct/index/stats tools, read-only aggregation pipelines,
  execution plans, cancellation, request previews, and JSON/table/CSV results.
  Server-side allowlists, complexity/time/response caps, protected-field probe
  prevention and redaction, blocked write/server-JavaScript stages, and
  fail-closed rate limiting keep the tool read-only and bounded. Details in
  [`PRs/64-codex-mongodb-query-builder--add-no-code-mongodb-query-workbench.md`](../PRs/64-codex-mongodb-query-builder--add-no-code-mongodb-query-workbench.md).
  — _Codex (AI), 2026-07-12_

- Unified the data model so posts, comments, reactions, and shares are all one
  root **Thing** shape: sub-schemas apply through the `thingtime` array of
  schema ids, payloads live under `crystal`, and every doc in every collection
  now stores its root-level `schemaVersion`. Added `GET /api/v1/things`
  (read/list), `POST /api/v1/things/update`, `GET /api/v1/schemas`, a `/schemas`
  browser page with an admin Database-migrations panel, and admin-only
  schema-version migration endpoints (`/api/v1/admin/migrations*`) gated by the
  admin role (`meta.admin` flag or the `ADMIN_USERNAMES` allowlist); the
  previously unauthenticated `mongodb/raw-results` dump is now admin-only. Legacy wire shapes stay
  byte-compatible and reads merge v1 embedded data until the idempotent
  `things-v1-to-v2` migration runs. Round 2: the stored visibility enum became
  a generic `acl` permission array (tt: grants plus "-"-prefixed exclusions,
  most-specific entry wins — e.g. `["tt:all","-tt:user/somebody"]`), with the
  legacy names still accepted and derived, and `/api/v1/things` grew the full
  verb set (GET read/list, POST create, PUT upsert, PATCH merge, DELETE).
  Merged origin/main (multi-emoji reactions, relational comments, meta.admin
  role system, account switcher) and reconciled onto the unified model; a
  post-merge adversarial security review then fixed 5 issues (a listThings acl
  leak of private shares, a reaction-cap DoS bypass on the generic endpoint,
  missing rate limits on /things, and migration id-squat data loss).
  Details in
  [`PRs/59-claude-unified-thing-crystal-schemas--everything-is-a-thing.md`](../PRs/59-claude-unified-thing-crystal-schemas--everything-is-a-thing.md).
  — _Claude (AI), 2026-07-10_
- Added the Thingtime Embed SDK: a verified single-file minified IIFE with
  JSON-only Shadow DOM mounts, shared get/set/subscription and undo/redo state,
  a responsive injected popup, a first-party full-editor/save bridge, public
  cross-origin reads, version-safe `kind: 'embed'` persistence, and an
  interactive safety-canary demo. See the
  [embed guide](../docs/THINGTIME_EMBED.md) and
  [PR 57 notes](../PRs/57-codex-thingtime-embed-sdk--share-thingtime-through-a-single-file-embed-sdk.md).
  — _Codex (AI), 2026-07-10_

- Added `docs/email-owned-architecture.md`, a phased plan for owning
  Thingtime email end-to-end with a self-hosted SMTP path, Mongo-backed queues
  and events, stream separation, sender-reputation warm-up, bounce/complaint
  handling, one-click unsubscribe, abuse contacts, security controls, and
  compliance requirements. — _Codex (AI), 2026-07-10_
- Updated the Electron release workflow trigger so merges that modify
  `.github/workflows/electron-release.yml` also spawn the release workflow,
  covering workflow-only release pipeline fixes. — _Codex (AI), 2026-07-08_
- Updated the Electron release workflow to run on Node 24 so the Remix/Nitro
  bundle build matches the app's declared `node: 24.x` engine during
  post-merge GitHub Releases. — _Codex (AI), 2026-07-08_
- Added a main-branch GitHub Actions release workflow for the Electron app. On
  pushes to `main` that change `electron/**`, it builds the macOS bundle,
  creates an `electron-v<base>+build.<run-number>` tag, generates GitHub release
  notes, and uploads the bundle assets while leaving the source base version
  unchanged. Electron packaged builds now store that CI metadata so update
  checks can compare build-metadata releases correctly. Details in
  [`PRs/42-codex-electron-remix-app--add-electron-desktop-app-shell.md`](../PRs/42-codex-electron-remix-app--add-electron-desktop-app-shell.md).
  — _Codex (AI), 2026-07-08_
- Added Codex-style Electron macOS window chrome: the native titlebar is hidden,
  traffic lights sit over the web surface, and the top nav/drawer reserve the
  titlebar control area so the app feels flush with the window edge. — _Codex
  (AI), 2026-07-08_
- Added Electron update-check/download settings with a per-install auto-check
  toggle at `thingtime.settings.electron.${sessionHash}AutoUpdateEnabled`, plus
  a GitHub release resolver that fetches the latest `Electron App Release`
  macOS bundle asset into `~/Downloads` and a local installer that registers
  `~/Applications/Thingtime.app` for Spotlight/Raycast discovery. — _Codex
  (AI), 2026-07-08_
- Added an Electron desktop URL switcher that stores the selected destination
  at `thingtime.settings.electron.${sessionHash}URL`, auto-loads that saved URL
  on launch, and adds desktop menu fallbacks for bundled/prod loading. —
  _Codex (AI), 2026-07-08_
- Added a root `electron/` desktop package that rebuilds the `remix/` Vite
  client and Nitro server with the Node server preset, stages the output for
  Electron, and packages an app shell that starts the bundled Nitro server on
  loopback before opening the desktop window. — _Codex (AI), 2026-07-08_
- 📰 **Feed, feed algorithms, profiles + settings**: new Facebook-style `/feed`
  page rendering public things by type (text / image / marketplace posts with
  reactions, comments, shares), an algorithm dropdown backed by per-user
  doomscroll-trained feed algorithms (create/branch/switch/save-session, new
  `feedAlgorithms` collection + `/api/v1/algorithms` family, active pick in
  `users.meta.activeFeedAlgorithmId`), minimalist filters (post type / circles /
  date), a full profile page (banner, bio, avatar, user posts feed, public view
  at `/profile/:username`, new `/api/v1/users/profile`) and a dedicated
  `/settings` page. Feed posts live in the `things` collection as `kind:'post'`
  docs behind the new `/api/v1/things` family (feed/user/react/comment/share/
  delete); seeding creates demo users, posts, reactions, comments and two demo
  algorithms through the same utils the routes use (FUNDAMENTALS §2). New API
  routes registered in `nitro.config.ts` + `server/routes/api/[...].ts`; API
  tests added under `things`/`algorithms`/`profile` groups. Full detail (data
  model, ranking maths, 20 adversarially-verified review fixes) in
  [`PRs/40-claude-feed-algorithms-profile-516506--feed-personal-algorithms-profiles-settings.md`](../PRs/40-claude-feed-algorithms-profile-516506--feed-personal-algorithms-profiles-settings.md).
  — Claude (AI), 2026-07-08

- Added compact one-line docs crumbs under each `/docs/api` endpoint title.
  The group crumb links/copies `/docs/api/:group#:docId`, while the endpoint
  crumb links/copies `/docs/api/:group/:docId`. — _Codex (AI), 2026-07-08_
- Added dedicated `/docs/api/:group` category pages and
  `/docs/api/:group/:docId` endpoint pages, while keeping the global
  `/docs/api#api-*` deeplinks. Endpoint copy-link buttons now copy a URL for
  the current view: global hash link, category hash link, or dedicated endpoint
  page. — _Codex (AI), 2026-07-08_
- Added grouped endpoint navigation to the `/docs/api` drawer: each API route
  now has its own deep-linkable submenu item under a group heading, and the API
  reference body/side index mirror those grouped sections. — _Codex (AI),
  2026-07-08_
- Updated `/docs/api` so platform examples use a tabbed code view, and all API
  docs snippets share the homepage developer-block styling with dark panels,
  line numbers, lightweight syntax colouring, and copy controls. — _Codex
  (AI), 2026-07-08_
- Added zero-env API fallback for fresh local/sandbox development: when local
  MongoDB/auth env is absent, Vite and Nitro forward same-origin API requests to
  `https://thingtime.com` with the same method, path, query, cookies, headers,
  and payload, rewriting upstream auth cookies for local HTTP. — _Codex (AI),
  2026-07-08_
- Added API self-documentation: every registered Thingtime API endpoint now has
  a matching `-docs` JSON route that responds to GET or POST, and `/docs/api`
  documents endpoint behavior, steps, payload/response examples, and curl,
  wget, Node.js, Python, and Ruby examples from the shared docs registry. —
  _Codex (AI), 2026-07-08_
- 🌈 **2026 design refactor**: adopted the Claude Design mockups
  (`docs/design/claude-design-mockup-v1` product UI + `claude-design-mockup-v2-fable`
  landing) across the whole app. New runtime theming system — every design token
  is a `--tt-*` CSS custom property (`app/theme/tokens.ts`, `ThemeHost`), with
  presets (Thingtime/Fable/Prism/Midnight), a Theming section in the settings
  modal, and a full Theme Studio at `/themes` (edit colours/fonts/general feel,
  save + share themes by link). New API: `/api/v1/themes` (+`/shared`, `/active`,
  `/delete`) and `/api/v1/waitlist`, with `themes`/`waitlist` collections and
  browser API tests. The front page is rebuilt to match the v2-fable landing
  (hero + waitlist, live `Content` demo card, use cases, ecosystem, dark
  developers section, back-the-launch, FAQ, confetti). Fonts (Space Grotesk /
  Hanken Grotesk / JetBrains Mono) now load from `index.html`, with a pre-paint
  theme snapshot script to avoid theme flash. Design token spec lives in
  [`docs/design/DESIGN_LANGUAGE.md`](../docs/design/DESIGN_LANGUAGE.md); PR
  details in
  [`PRs/32-claude-vigilant-moser--design-refactor-theming.md`](../PRs/32-claude-vigilant-moser--design-refactor-theming.md).
  — _Claude (AI), 2026-07-07_
- Dev runbook: local dev ports resolve through the shared
  `remix/scripts/worktree-ports.cjs` module (worktree-derived defaults;
  `TT_WEB_PORT`, `TT_HMR_PORT`, `TT_API_PORT` overrides) so secondary
  checkouts/worktrees run beside the canonical 9999/10000 pair. Originally
  shipped on this branch as `THINGTIME_VITE_PORT`/`THINGTIME_VITE_HMR_PORT`/
  `THINGTIME_API_PROXY_TARGET`; unified with main's system on merge.
  — _Claude (AI), 2026-07-07_
- Added `thingtime.settings.visual.bottomPadding`, which drives the native iOS
  footer bottom padding and the derived DevKit floating trigger bottom offset.
  Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-07_
- Added a committed `.githooks/post-commit` workflow that auto-commits
  `remix/.env.auto` after ordinary commits when that generated file changes,
  plus a root `install-git-hooks` script for `core.hooksPath` setup. — _Codex
  (AI), 2026-07-06_
- Added native iOS destination-drawer URL context menus: touch and hold any
  Thingtime/Vercel URL row to copy the URL, open it externally in the browser,
  or share it. Bumped the native build number to `7` for TestFlight. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-06_
- Updated the iOS TestFlight lane and runbook so App Store Connect individual
  API keys can leave `ASC_ISSUER_ID` blank, documented the supported-Xcode
  retry for App Store Connect `90534` upload rejections, and bumped/uploaded
  native build `3`. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-05_
- Added an iOS web destination drawer that opens from the left edge, fetches
  Vercel deployment options from `/api/v1/vercel/deployments`, and lets native
  builds switch the WebKit view between Thingtime.com, the configured build URL,
  and returned deployment URLs. — _Codex (AI), 2026-07-05_
- Added a drawer-based nav system (Claude-desktop style): edge-flush resizable
  drawer driven by `thingtime.settings.drawer.*` (open direction, top-level
  item limit with a faint “More” reveal, dynamic grouped second-level menu,
  click-and-hold drag reordering persisted to `userDrawerOrdering`, search
  button honouring `searchClosesDrawer`, sticky avatar opening a desktop
  centred settings modal / mobile slide-up sheet). Desktop hovers the trigger
  for a popup preview and pins to a split view; mobile shifts (never resizes)
  the page. Replaces the dead `ProfileDrawer`. Details in
  [`PRs/28-codex-service-account-api--drawer-based-nav-revamp.md`](../PRs/28-codex-service-account-api--drawer-based-nav-revamp.md).
  — _Claude (AI), 2026-07-05_
- Added the local Tailscale/Funnel hostname to Vite's allowed hosts and
  documented the Thingtime `:9999` local/Tailscale dev URLs. — _Codex (AI),
  2026-07-04_
- Added a `/tests` frontend API test harness with group filters, individual
  route checks, safe all-runs, optional mutating checks, and coverage for the
  current API route map. — _Codex (AI), 2026-07-04_
- Added a self-service service-account provisioning API that creates
  service-owned users, returns non-expiring bearer tokens, requires email
  verification within seven days, and grants a default 5 GiB storage allowance
  for backend integrations. — _Codex (AI), 2026-07-04_

### Changed

- Branch awareness no longer depends on a committed env file: `remix/.env.auto`
  is now untracked/gitignored and generated locally by
  `remix/scripts/pre-dev.sh`; the `.githooks/post-commit` auto-commit hook and
  the unreferenced legacy `remix/vercel.sh` are removed. Vercel deployments
  read the `VERCEL_GIT_COMMIT_REF` system env var (already preferred by
  `root-data.server.ts` at runtime), so previews stay branch-aware while
  `.env.auto` merge conflicts become structurally impossible. `pre-dev.sh` now
  warns instead of failing the Vercel build when the ref is missing. Existing
  checkouts with a locally modified `.env.auto` may hit a one-time
  modify/delete conflict when pulling this change — resolve by keeping the
  local file untracked (`git rm --cached remix/.env.auto`). Also routed
  `graphify-out/graph.json` through the graphify union merge driver via
  `.gitattributes`. — _Claude (AI), 2026-07-08_
- Moved PR-specific notes from `remix/PRs/` to the repo-root `PRs/`
  directory and updated changelog/runbook links to the new convention. —
  _Codex (AI), 2026-07-07_

### Fixed

- Login and registration now return standalone users to the last page they
  visited before entering auth, including query strings and hashes. The
  session-scoped destination is consumed only after success, auth/API/external
  targets are rejected, direct auth visits keep the existing `/` and
  `/welcome` fallbacks, and embedded account switching remains in place.
  Details in
  [`PRs/64-codex-mongodb-query-builder--add-no-code-mongodb-query-workbench.md`](../PRs/64-codex-mongodb-query-builder--add-no-code-mongodb-query-workbench.md).
  — _Codex (AI), 2026-07-12_

- Fixed Editor.js autosave echoes remounting the active editor and stealing
  focus after the asynchronous save/parent echo. Changed parent values now
  reach the pending-echo reconciliation path before skipped intermediate
  signatures are retired, so ordinary local echoes preserve the Editor.js
  instance while genuine external replacements still refresh it. Added focused
  coverage for the changed-signature echo case. Details in
  [`PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md`](../PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md).
  — _Codex (AI), 2026-07-11_
- Fixed Editor.js persistence and duplicate toolbox entries. The List-v2
  Checklist alias is hidden while the compatible legacy Checklist tool remains,
  Editor.js snapshots are emitted in change order, and Thingtime now serializes
  only the latest revision after a 350ms idle window (with a 2s maximum wait)
  instead of serializing the whole object during every keystroke. Edit/history
  events remain immediate, LocalForage writes cannot overlap, lifecycle flushes
  cover background/navigation, and pre-hydration placeholder state is never
  persisted. Removed per-keystroke full-object logging, React-state queue churn,
  and unbounded debug snapshots from the same hot path. Details in
  [`PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md`](../PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md).
  — _Codex (AI), 2026-07-11_
- Fixed Editor.js multiline tool textboxes treating empty internal lines as
  block boundaries. Quote, warning, image-caption, and embed-caption fields now
  keep Backspace/Delete and arrow-key editing inside the active textbox at
  internal line boundaries, while genuine field boundaries, native inputs, and
  ordinary paragraph, heading, list, and checklist block navigation remain
  unchanged. Dynamically added Editor.js fields receive the same guard. Details
  in [`PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md`](../PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md).
  — _Codex (AI), 2026-07-11_
- Fixed Editor.js chrome being clipped by the Thingtime atomic-value scroll
  wrapper. Rich-text values now keep floating toolboxes visible, wide editors
  reserve an in-card gutter for both the `+` and six-dot controls, and narrow
  editors retain Editor.js's mobile bottom-sheet layout. Header blocks now use
  an explicit H1-H6 scale in edit mode and semantic heading elements with the
  same scale in view mode, while validated Style Tune sizes still override the
  defaults. Details in
  [`PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md`](../PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md).
  — _Codex (AI), 2026-07-11_
- Fixed the Thingtime value editor jumping between its inline string control
  and Editor.js after Enter/focus/save. Primitive strings now stay plain;
  Editor.js is a persistent `rich-text` block datatype with content-preserving
  String ↔ Editor.js context-menu conversions and native-payload detection.
  Rich-text view rendering now uses the same allowlist sanitizer during SSR
  and hydration, with bounded detection/rendering and safe URL protocols for
  hostile or oversized stored documents.
  Details in
  [`PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md`](../PRs/53-claude-nested-data-viewer-concepts-1ebbbe--nested-data-viewer-concepts-kind-renderers.md).
  — _Codex (AI), 2026-07-10_
- Fixed Electron release packaging on GitHub Actions by giving the Electron
  package explicit repository metadata, preventing electron-builder from
  crashing after producing macOS assets when it cannot infer the GitHub repo
  from the runner checkout. — _Codex (AI), 2026-07-09_
- Aligned the Electron desktop titlebar and drawer with the Codex-style macOS
  layout: compact drawer/home/search controls now sit in the titlebar, the
  titlebar stays at the compact Electron height, the control row no longer
  shifts when the drawer opens, the drawer starts directly with menu items,
  inactive commander search no longer occupies titlebar space, and the topbar
  drag region covers the inner nav layers. Details in
  [`PRs/42-codex-electron-remix-app--add-electron-desktop-app-shell.md`](../PRs/42-codex-electron-remix-app--add-electron-desktop-app-shell.md).
  — _Codex (AI), 2026-07-08_
- Inset the Electron titlebar drawer trigger and home affordance past the
  macOS traffic-light controls, and restored top-strip window dragging by
  keeping only real interactive controls marked as no-drag. Details in
  [`PRs/42-codex-electron-remix-app--add-electron-desktop-app-shell.md`](../PRs/42-codex-electron-remix-app--add-electron-desktop-app-shell.md).
  — _Codex (AI), 2026-07-08_
- Tightened the native iOS WebView footer bottom padding so the account footer
  no longer leaves a large blank tail at full scroll, and re-clamped the DevKit
  floating trigger against native safe-area values so saved positions stay fully
  visible above the home indicator. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-06_
- Fixed the iOS WebKit bottom-scroll nav disappearance by rendering the fixed
  web chrome outside the scrollable `Main` layout container, disabling native
  WKWebView rubber-band bounce, removing the native bottom content inset that
  created a fake scroll range, and giving the native web footer real CSS bottom
  padding above the home indicator. Bumped the native build number to `9` for
  TestFlight. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-06_
- Fixed the remaining iOS WebKit bottom-scroll nav overlap by keeping the
  native `WKWebView` below the top safe area instead of full-screening it
  behind the status bar, while preserving the bottom safe-area/footer inset.
  Bumped the native build number to `8` for TestFlight. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-06_
- Kept the iOS WebKit nav below the native status area at the bottom scroll
  limit by offsetting the fixed nav layer with the native safe-area top value
  instead of padding inside a `top: 0` layer, and hardened the native safe-area
  resolver against full-screen `WKWebView` inset edge cases. Bumped the native
  build number to `6` for TestFlight. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-06_
- Tightened the iOS WebKit safe-area follow-up: the native shell now pushes
  stable safe-area CSS variables into every loaded page, reserves a larger
  bottom scroll inset for the footer, and bumps the native build number to `5`
  for the next TestFlight build. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-06_
- Fixed iOS WebKit/mobile drawer polish from TestFlight: the native
  left-edge swipe recognizer no longer blocks taps on the web drawer icon, the
  collapsed drawer trigger has an edge-to-edge hit target, footer scrolling gets
  bottom safe-area breathing room, and WKWebView overscroll now uses the page's
  white background instead of showing black. Bumped the native build number to
  `4` for the follow-up TestFlight build. Details in
  [`PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md`](../PRs/30-codex-ios-deployment-url-picker--add-ios-web-destination-picker.md).
  — _Codex (AI), 2026-07-05_
- Made the compact footer environment selector text flush-left with the footer
  column and vertically centered by replacing the native select with a custom
  menu button. — _Codex (AI), 2026-07-03_
- Made the footer environment selector default to `Current Tab` per browser
  origin, added a current branch deployment option, and reset status rows to
  checking immediately when the target environment changes. — _Codex (AI),
  2026-07-03_
- Aligned the compact footer environment selector with the status rows, restored
  browser scroll position after reloads via React Router scroll restoration, and
  loaded ignored local env files into the Nitro/Vite dev launcher so localhost
  MongoDB status checks can see configured credentials. — _Codex (AI),
  2026-07-03_

### PR #26 - Environment-Aware Footer Status Checks

Detailed PR notes:
[PRs/26-codex-migrate-remix-to-nitro--add-environment-aware-footer-status-checks.md](../PRs/26-codex-migrate-remix-to-nitro--add-environment-aware-footer-status-checks.md)

### Added

- Added `/docs` and `/docs/design` browser routes with a Shopify-style docs
  layout, mockup navigation, and full-screen previews for the PR #25 design
  bundles. — _Codex (AI), 2026-07-03_
- Added an environment-aware footer status selector for this tab, local,
  development, staging, and production targets, with compact Nitro API,
  frontend, Vercel, and MongoDB checks. — _Codex (AI), 2026-07-02_

### PR #24 - Nitro React Router Migration

Detailed PR notes:
[PRs/24-codex-migrate-remix-to-nitro--migrate-remix-app-to-nitro-and-react-router.md](../PRs/24-codex-migrate-remix-to-nitro--migrate-remix-app-to-nitro-and-react-router.md)

### Changed

- Migrated the app runtime from Remix to a Nitro server plus React Router
  non-framework Vite client, with PM2 running Vite on port 9999 and Nitro on
  port 10000. — _Codex (AI), 2026-07-02_
- Added Vercel output verification for the Nitro build so deployments must
  include the generated Vite shell before the build is accepted. — _Codex (AI),
  2026-07-02_
- Added a Vercel project config override so preview deployments use the Nitro
  build command instead of the previous Remix builder preset. — _Codex (AI),
  2026-07-02_
- Added exact pnpm release-age exceptions for the locked `rolldown@1.1.4`
  packages pulled by Vite 8.1.2 so Vercel preview installs can keep the latest
  Vite stack without disabling the broader supply-chain policy. — _Codex (AI),
  2026-07-02_
- Approved pnpm dependency build scripts for `bcrypt` and `core-js` so strict
  Vercel installs can complete while keeping unlisted lifecycle scripts blocked.
  — _Codex (AI), 2026-07-02_
- Pinned the web package manager to `pnpm@10.12.1` so Vercel Corepack uses the
  pnpm version that understands the migration's workspace policy settings. —
  _Codex (AI), 2026-07-02_
- Patched the Vercel build output so `/` and non-API app paths route to the
  static Vite `index.html` shell before Nitro's server fallback, and made the
  verifier assert that order. — _Codex (AI), 2026-07-02_
- Added root Vercel deployment notes with project, production alias, preview
  pattern, and the verified PR #24 preview URL. — _Codex (AI), 2026-07-02_

### PR #16 - Auth And Lopu Hardening

Detailed PR notes:
[PRs/16-resolve-main-into-thingtime-dev-branch.md](../PRs/16-resolve-main-into-thingtime-dev-branch.md)

### Fixed

- Ignored canceled Vercel deployments when selecting the footer deployment
  status so skip-rule cancellations do not mask the latest live deployment
  state. — _Codex (AI), 2026-06-24_
- Hardened JWT auth so deployed runtimes fail closed without `JWT_SECRET`, and
  live session checks now require the session `userId` to match the JWT `sub`.
  — _Codex (AI), 2026-06-23_
- Limited raw dev email-verification links to local development and Vercel
  preview environments only. — _Codex (AI), 2026-06-23_

### Changed

- Exposed the Vercel footer deployment status and `/vercel` dashboard in
  production deployments as well as local development and previews. —
  _Codex (AI), 2026-06-24_
- Added a native iOS agent runbook documenting the Apple Developer environment,
  App Store Connect API-key validation, signing, Xcode SDK, and TestFlight
  upload flow. — _Codex (AI), 2026-06-24_
- Bumped the native iOS build number to 2 for the next TestFlight upload. —
  _Codex (AI), 2026-06-24_
- Disabled iOS export symbol packaging for the initial webview shell TestFlight
  build to avoid the local Xcode beta `rsync --extended-attributes` packaging
  failure. — _Codex (AI), 2026-06-24_
- Added an optional iOS `PROVISIONING_PROFILE_SPECIFIER` export fallback so
  TestFlight uploads can use an installed App Store profile when Xcode automatic
  export cannot create or find one. — _Codex (AI), 2026-06-24_
- Added iOS Fastlane distribution-certificate and App Store profile syncing
  before TestFlight builds so fresh local keychains can recover signing assets
  from the App Store Connect API key. — _Codex (AI), 2026-06-24_
- Added an ignored `iOS/.env` TestFlight workflow and
  `iOS/scripts/testflight-beta.sh` so native uploads can target preview web URLs
  without committing branch-specific build values. — _Codex (AI), 2026-06-24_
- Added a build-time iOS `THINGTIME_WEB_URL` override so TestFlight builds can
  point the native webview at a Vercel branch deployment while production still
  defaults to `https://thingtime.com`. — _Codex (AI), 2026-06-24_
- Added iOS webview safe-area support with `viewport-fit=cover`, full-bleed
  native WKWebView rendering, and status-bar-aware Remix nav padding. —
  _Codex (AI), 2026-06-24_
- Added shared AGENTS/CLAUDE PR-review instructions prioritizing code quality,
  performance, potential bugs, crashes, and security issues. — _Codex (AI),
  2026-06-23_
- Changed `/vercel` to scan paged Vercel deployments for latest unique branch
  deployments, added deployment timestamps plus compact filter/sort/branch-cap
  controls and total branch counts, linked the footer status to `/vercel`, and
  stopped idle ready-state footer polling. — _Codex (AI), 2026-06-23_
- Added shared AGENTS/CLAUDE instructions requiring mirrored instruction-file
  updates and parent env-file seeding for `.test-branches` branch clones. —
  _Codex (AI), 2026-06-23_
- Added shared AGENTS/CLAUDE instructions requiring live browser verification
  for layout and alignment changes. — _Codex (AI), 2026-06-23_
- Added a centered `/vercel` deployment URL dashboard backed by
  `/api/v1/vercel/deployments`, and constrained both `/crypto` and `/vercel`
  to viewport-safe centered page widths. — _Codex (AI), 2026-06-23_
- Added shared AGENTS/CLAUDE runbook instructions so Codex and Claude both read
  both files and avoid duplicating long agent rules. — _Codex (AI),
  2026-06-23_
- Added `/crypto` plus `/api/v1/crypto` key-generation and verification tools,
  including format selectors for PEM, escaped PEM, base64 PEM, base64url PEM,
  JWK JSON, and message encodings. — _Codex (AI), 2026-06-23_
- Added a Remix `ensure-bcrypt` install/dev/build hook that repairs missing
  `bcrypt_lib.node` native bindings before local Vite startup. — _Codex (AI),
  2026-06-23_
- Added ES256 JWT signing with a public JWKS endpoint at `/api/v1/auth/jwks`
  for external verification, while keeping `JWT_SECRET` as a legacy HS256
  migration fallback for existing sessions. — _Codex (AI), 2026-06-23_
- Added a Mongo-backed rolling 10-per-hour IP quota for AI-backed Lopu musings;
  over-limit or rate-limit-storage failures now stream the built-in fallback
  library instead of calling weather or AI providers. — _Codex (AI), 2026-06-23_

### PR #13 - Remix Hydration, Vercel Status, And Deployment Hygiene

Detailed PR notes:
[PRs/13-codex-fix-hydration-mongodb-thingtime-defaults--codex-fix-hydration-and-footer-status-updates.md](../PRs/13-codex-fix-hydration-mongodb-thingtime-defaults--codex-fix-hydration-and-footer-status-updates.md)

### Added

- Added shared Chakra/Emotion SSR style context so critical Emotion CSS is
  rendered as part of the Remix document tree. — _Codex (AI), 2026-06-22_
- Added a Vercel deployment footer status indicator with tokenless fallback and
  optional Vercel API-backed build phase/progress links. — _Codex (AI),
  2026-06-22_
- Added local development and deployment runbook notes for PM2-managed Remix
  restarts, Vercel duplicate-SHA deploy skipping, and PR-specific change notes.
  — _Codex (AI), 2026-06-22_

### Changed

- Limited Vercel deployment status UI and status routes to local development
  and Vercel preview environments, marked successful API-backed status as
  configured, and hardened Vercel branch-name source rewriting for slash
  branches. — _Codex (AI), 2026-06-23_
- Minified the Vercel footer status copy by deduping ready/STAGED wording,
  shortening last-ready ages to `s`/`m`/`h` units, and showing active build
  percentages without brackets. — _Codex (AI), 2026-06-23_
- Replaced the Vercel footer progress bar with a tiny pale-track meter that
  hides after ready builds and marks failed builds at their failure point. —
  _Codex (AI), 2026-06-23_
- Added tiny lucide refresh buttons to the Vercel and MongoDB footer status
  indicators so users can recheck each service without opening the status
  links. — _Codex (AI), 2026-06-23_
- Improved footer health indicators so Vercel and MongoDB unavailable states
  render visible neutral grey status dots instead of appearing blank, including
  MongoDB's checking state. — _Codex (AI), 2026-06-22_
- Made Vercel status resolution derive the project name from Vercel's repo slug
  when only `VERCEL_API_TOKEN` is configured, derive dashboard links from
  Vercel project/deployment API data when available, retry without `teamId` on
  `403`, parse the dashboard owner from preview hosts as a final fallback, and
  stop mixing tokenless phase text into API error labels. — _Codex (AI),
  2026-06-22_
- Added Vercel footer polling plus last-ready deployment metadata so active
  builds can refresh progress and ready deployments can show when the last
  successful build completed. — _Codex (AI), 2026-06-22_
- Completed proper Chakra/Emotion document hydration wiring around
  `hydrateRoot(document, ...)`, server-collected Emotion style chunks, and a
  one-shot client Emotion sheet handoff before first paint. — _Codex (AI),
  2026-06-22_
- Removed the manual Emotion style clone/restore loop and made Vercel Analytics
  client-only after mount to avoid initial hydration/document mismatches. —
  _Codex (AI), 2026-06-22_
- Replaced invalid Remix loader typing and tightened root loader env/branch data
  so preview footers prefer Vercel's current git branch metadata. —
  _Codex (AI), 2026-06-22_

### Fixed

| #   | Problem                                                                                                         | Fix                                                                                                                             | Author     | Date       |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| 6   | Vercel and MongoDB footer refresh icons rendered but did not trigger a recheck.                                 | Wired the shared refresh button to call its callback, prevent link bubbling, and show a small loading spin.                     | Codex (AI) | 2026-06-23 |
| 1   | Emotion hydration caused `insertBefore` crashes, flash-of-unstyled content, boxed icons, and update-depth risk. | Hydrate the Remix document with server-rendered Emotion style tags in the React tree and perform the Emotion handoff pre-paint. | Codex (AI) | 2026-06-22 |
| 2   | Vercel serverless wrapped Emotion CJS modules differently than local default imports expected.                  | Resolve `@emotion/cache` and `@emotion/server/create-instance` across direct, default, named, and nested default export shapes. | Codex (AI) | 2026-06-22 |
| 3   | Vercel previews could show `git/unknown`, and repeated branch-head deployments could rebuild unchanged SHAs.    | Prefer Vercel git env vars for branch display and document/test an Ignored Build Step duplicate-SHA guard.                      | Codex (AI) | 2026-06-22 |
| 4   | Local dev-server and PR validation workflow details were scattered across chat.                                 | Document PM2-managed Remix restarts, PR-specific notes, and verification in project docs.                                       | Codex (AI) | 2026-06-22 |
| 5   | `smarts.merge(..., { clone: true })` behavior was at risk during PR cleanup.                                    | Verified the clone path still deep-clones nested values without mutating the source object.                                     | Codex (AI) | 2026-06-22 |

### Verified

- Targeted Remix ESLint checks, production build, compiled SSR bundle import,
  local browser smoke checks, Vercel status endpoint checks, duplicate-SHA
  ignored-build testing, and `graphify update .` all ran during PR validation.
  — _Codex (AI), 2026-06-22_

---

- 2026-10-30: Refresh Commander indexes in the background with responsive search and measured totals/age. Recover real-root watcher starvation, complete full indexing under the saved 512 MiB policy, and retain measured counts during pending updates. Signed installed count/freshness and health checks passed; physical Cmd+E remains unverified. [Details](../PRs/1282-codex-commander-background-index-keep-commander-indexes-fresh-without-interrupting-search.md). **Codex (AI)**


<!--

- 2026-09-16: Account invites default to Never expire, offer an expiry dropdown and owner-only show/copy links, with explicit replacement for older hash-only links. Worktree validation uses localhost:17360; Funnel unavailable because the installed Tailscale CLI target is missing.

## [1.0.0] - YYYY-MM-DD
Move entries up from [Unreleased] when cutting a tagged release.
-->
