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

- 2026-10-14 — **Claude (AI)**: History settings. New `api.timeline-settings`
  1.0.0 (`GET`/`POST /api/v1/timeline/settings`; `api.timeline` stays 1.18.0)
  stores the account-wide sync hold, the retention choice (stored only —
  nothing is deleted yet) and the per-Thing draft-capture pause list on the
  user Thing's protected `secure.meta.historyPrefs` blob through a
  home-pinned, injectable `createHistoryPrefsStore` (`users.ts`; pause/resume
  are deltas merged inside the `secureVersion` CAS write, 200-id cap, 64 KiB
  body cap, `timeline.settings` 30/min, 503 + `Retry-After: 1` on contention).
  Shared contract `remix/app/timeline/historyPrefs.ts`; Settings → History
  category, `pause-history`/`resume-history` verbs, Thing-page and editor
  History entry points, bounded client export. Pausing stops client draft
  capture in the Builder page and definition editors only; saved versions
  keep recording. Docs: `docs/unified-timeline.md` (2026-10-14 section),
  `docs/feature-map/history-and-timeline.md`.

- **Admin AI-moderation settings + free omni text moderation (2026-08-19,
  Claude (AI))**: `/admin` → Moderation gains an "AI moderation settings"
  card choosing the provider per surface — media uploads (default / tiered /
  free openai-only / claude / off) and post/comment text (default / free
  openai / off) — stored under `Thingtime.ModerationSettings` and overriding
  the env default. New text pipeline: post/comment/share `crystal.text` is
  screened by the free omni endpoint on create and on edit; block-worthy
  categories quarantine the thing (hidden from feeds/threads/search via
  `canView` + thread loading), other flags queue an advisory `moderationFlag`
  with a bounded excerpt; admin review (clear / nsfw / block) covers text rows
  and its stamps are final for the pipeline. A new hourly cron
  (`GET /api/v1/moderation/sweep`, `CRON_SECRET` bearer, vercel.json minute
  29) retries text moderation lost to mid-flight process deaths or provider
  outages and drains off-era backlog for free, plus the standard attachment
  sweep; the admin sweep button runs both batches and the tab shows the text
  backlog count. Post creation adds a hybrid sync gate: the free omni screen
  races `TT_TEXT_SCREEN_BUDGET_MS` (default 600ms, `0` disables) before the
  insert so flagged posts are born stamped (blocked content never renders,
  even briefly), while timeouts/outages fail open to the async pipeline —
  moderation can never break posting; a per-instance circuit breaker
  (3 failures → open, 60s cooldown) skips the omni call during confirmed
  outages. Fail-closed (owner decision 2026-08-19): when no sync verdict is
  obtainable while the surface is on, posts are born PENDING — owner-private
  until the async queue / hourly cron screens and releases them (creation
  notifications fire at release); `TT_TEXT_SCREEN_BUDGET_MS=0` becomes
  async-release mode, and the off sweep releases stranded pending docs. Screening now covers ALL omni-judgeable post content in one
  combined free request: prose + listing text + tags + legacy external image
  URLs (`crystal.images`, cap 8), closing the unmoderated URL-photos gap.

- **Free omni-moderation first-pass gate (2026-08-19, Claude (AI))**: the
  moderation pipeline gains a tiered `openai+claude` provider — OpenAI's free
  `omni-moderation-latest` endpoint screens every image first; clean images
  stamp `clear` at $0 and only flagged/borderline images escalate to the paid
  Claude vision call (fail-safes: omni outage → straight to Claude; Claude
  outage → omni-flagged images stamp `nsfw`/blur instead of pending). New env:
  `OPENAI_API_KEY` reused for the screen, optional
  `TT_MODERATION_ESCALATION_SCORE` (default 0.2);
  `THINGTIME_MODERATION_PROVIDER` accepts `openai+claude` (alias `tiered`) and
  standalone `openai`, and the unset default picks the tiered pipeline when
  both API keys are present. Cost basis: `docs/ai-api-cost-analysis.md`
  (PR #308 note has details).
- **`all` branch AI build doctor**: the Build all branch workflow now runs the
  union build after every input-changed rebuild and, when textually-clean
  merges collide semantically (duplicate helpers declared by two PRs), repairs
  the branch with up to three guarded, edit-files-only Claude rounds — the
  conflict resolver's action pin, model waterfall, and credential-scan
  posture — committing replayable fixups on `all` itself and re-verifying the
  build mechanically. Live-fired locally against the real 64-PR union: four
  collision layers healed to a green build, and the fixups replayed cleanly
  onto the next rebuild. — Claude (AI), 2026-08-19
- **`all` wildcard branch automation**: new **Build all branch** control-plane
  workflow — thin listener `.github/workflows/all-branch.yml` on product
  branches, implementation plus `build-all-branch.mjs` builder on the
  protected `github-actions` branch — that deterministically rebuilds the
  generated `all` branch: `develop` + `main` + every open non-fork PR (stacked
  branch → branch PRs included, `no-all` label opts out) merged newest-wins
  with theirs-biased auto-resolution, force-pushed only when the resulting
  tree actually changes, with an `ALL_BRANCH.md` manifest on the branch
  recording every merge and skip. See README “Branch automation: the `all`
  wildcard branch”. — Claude (AI), 2026-08-18

- 2026-09-30 — **Codex (AI)**: Unacknowledged server Action completions can now
  survive locally and synchronize through the shared Timeline outbox without
  rerunning the Action. Canonical events/relationships stay identical locally
  and remotely; proofs bind exact content, account and database. Local storage
  failures remain explicit. Timeline 1.16.0 / Actions 1.37.0; configured signing
  keys are required for recovery. Replica quota/tamper/idempotence and headed
  desktop/mobile reload/reconnect checks passed; fork setup is in README.
  Details: [PR #988](../PRs/988-codex-timeline-outcome-recovery-recover-action-completion-history-without-rerunning-actions.md).

- 2026-09-30 — **Codex (AI)**: Server Actions now save accepted-run and redacted
  outcome activity in canonical Timeline, including read-only runs. History
  survives Action deletion; quota failures distinguish refused execution from
  incomplete completion recording. Fable's four looks and the Action inspector
  use this shared activity with captured names and no replay/restore controls.
  Timeline 1.15.0 / Actions 1.36.0; no new collection, index or secret. Details:
  [PR #987](../PRs/987-codex-timeline-action-outcomes-record-server-action-outcomes-in-shared-timeline-history.md).

- 2026-09-30 — **Codex (AI)**: History can recover deleted ordinary Things at
  their original links as new private versions, with recorded component copies,
  reviewed folder placement and all prior history retained. Canonical Published
  branch heads survive deletion; stale/concurrent requests and failed copies
  refuse atomically. Timeline 1.14.0; no new collection/index/secret. Desktop and
  mobile recovery use the shared Fable History details. Details and limits:
  [PR #985](../PRs/985-codex-timeline-deleted-recovery-recover-deleted-things-privately-from-timeline-history.md).

- 2026-09-30 — **Codex (AI)**: Fable's Page + related scope now combines a saved
  page's owned Component, Action, Data and Schema histories in the shared browser.
  Current membership is authorized and bounded; shared authors' histories remain
  private, changed references reset paging, and cached canonical events survive
  failed refreshes. Timeline 1.13.0; no schema/index migration. Details in the
  [PR #984](../PRs/984-codex-timeline-related-history-show-a-page-and-its-related-things-in-one-timeline-history.md).


- 2026-09-29 — **Codex (AI)**: History browser and recorded component restore
  validation details: [PR #983](../PRs/983-codex-timeline-published-components-bring-timeline-designs-to-life-and-restore-recorded-components.md).

- 2026-09-29: Integrate the working History browser from Fable 5.1's PR #947:
  shared List/Cards/Line/Frames, recorded cards and property changes, URL filters,
  desktop details/mobile sheet, read-only comparisons and friendly variation
  controls over the existing Timeline core. Search/density are explicitly
  limited to loaded history. [Design mapping and remaining work](../docs/timeline-design-integration.md).


- 2026-09-29 — **Codex (AI)**: Published Timeline restore/merge now reviews
  recorded component definitions and creates private copies for the page in the
  same transaction as its content, history and storage accounting. Shared pages
  stay unchanged; stale component previews refuse, known absence stays explicit,
  and merges follow stable block identities after copying. Desktop/390px review
  and guarded API rollback/concurrency checks cover the flow. See
  [the implementation and remaining work](../docs/unified-timeline.md#published-component-restore-and-merge--2026-09-29).

- 2026-09-28 — **Codex (AI)**: Named-branch merges preserve recorded component
  definitions, combine independent changes and ask for overlapping choices.
  Inert previews show current/incoming/result versions; offline save/reload
  preserves selected captures and reconnect advances once. Added bounded private
  Timeline 1.11.0 comparison and mobile long-title wrapping. Full unit/build,
  focused HTTP/Timeline and desktop/mobile checks passed; TypeScript baseline
  unchanged. [PR #979](../PRs/979-timeline-component-merge-preserve-recorded-components-when-merging-timeline-branches.md).

- 2026-09-28 — **Codex (AI)**: Page versions capture readable component definitions
  as atomic linked Timeline records, using the same local/remote schema. History
  and visual branches preview recorded definitions, preserve offline drafts,
  and offer an explicit current-component preview. Added bounded private API
  reads, insertion/preview regressions and desktop/mobile acceptance. Timeline
  capability 1.10.0; nested runtime dependencies and dependency-aware merges
  remain open. [PR #978](../PRs/978-timeline-component-snapshots-preserve-recorded-component-definitions-in-timeline-page-versions.md).

- 2026-09-28 — **Codex (AI)**: Named page branches open in the visual Builder,
  sharing durable draft events and revision-checked saves with the field editor.
  Offline recovery, one-click inline saves, stale-push preservation and scoped
  current-component previews keep published content unchanged. Validated on
  desktop/390px, disposable HTTP, full unit/build and baseline TypeScript checks.
  [PR #977](../PRs/977-timeline-visual-branches-edit-named-timeline-branches-in-the-visual-builder.md).

- 2026-09-28 — **Codex (AI)**: Direct private named-branch lookup for cold
  editors, with account/database fences and canonical cache adoption that
  preserves queued pushes. Timeline 1.9.0; existing schemas and indexes.
  [PR #976](../PRs/976-timeline-branch-lookup-resolve-named-timeline-branches-directly-with-scoped-reads.md).

- 2026-09-28 — **Codex (AI)**: Named Timeline branches can open their exact
  historical content in the shared field editor. Device-first drafts survive
  reload, resume offline, and push through the existing revision-fenced queue;
  stale or divergent edits stay in History. Published Things are unchanged.
  Added private bounded checkout in `api.timeline` 1.8.0, API regressions and
  desktop/mobile acceptance. Visual Builder branch switching remains open.
  Details: [PR #975](../PRs/975-timeline-branch-checkout-edit-named-timeline-branches-with-durable-offline-drafts.md).

- 2026-09-28 — **Codex (AI)**: Named Timeline branches can review and merge a
  selected version with explicit conflict choices. Merges use the existing
  canonical local/remote event and branch queues, survive offline reload and
  retries, and preserve the version after a stale push. Published Things stay
  unchanged. Shared version reconstruction retains folder moves through later
  drafts. Added real API and desktop/mobile offline acceptance; `api.timeline`
  advances to 1.7.0. Direct branch checkout/editing remains in progress.
  Details: [PR #974](../PRs/974-timeline-branch-merge-review-and-merge-versions-into-named-timeline-branches.md).

- 2026-09-28 — **Codex (AI)**: Fixed a Timeline null-connection crash on
  signed-out pages and sign-out transitions. Require a viewer and connection
  before checking account/database identity; preserve same-viewer cached
  history and all scope fences. Added a regression and desktop/mobile
  sign-in/sign-out acceptance.

- 2026-09-28 — **Codex (AI)**: History can open its Thing in the home database
  through an explicit selection change. Links pin account/database identity;
  Thing-page caches and cross-tab invalidation keep same-id records separate.
  Root data shares Timeline's canonical database key, and negotiated optional
  API preconditions refuse stale-source reads/writes before handlers run.
  MongoDB endpoint capability 1.1.0; no Timeline record-format change.
  Fallback deployments forward the same source precondition as root identity;
  the upstream enforces it without breaking ordinary Thing reads/writes.
  [PR #972 details](../PRs/972-timeline-thing-navigation-open-history-things-in-their-matching-database.md).

- 2026-09-28 — **Codex (AI)**: Home history is accessible while a custom database
  stays selected. Saved themes expose History; Timeline offers Home account and
  Selected database views. Shared connection leases prevent duplicate home
  uploads and keep each database's pending edits/cache separate. Explicit scoped
  API routing covers branches and restore with existing account/source fences;
  Timeline 1.6.0. Opening Timeline also closes the History modal.
  [PR #971 details](../PRs/971-timeline-home-scope-keep-home-history-accessible-across-database-selections.md).

- 2026-09-27 — **Codex (AI)**: Lopu continuations recover completed tool results
  from their exact private background transcript, so a checkpoint after an
  Action preserves its output without rerunning it. Account, chat, deployment,
  retention and completion checks remain required. Expired task outputs stop
  repeated polling. Reply capability 1.19.2.
  [PR #969 details](../PRs/969-lopu-checkpoint-tool-results-preserve-completed-tool-results-when-lopu-resumes.md).

- 2026-09-27 — **Codex (AI)**: Saved theme creation, token/visibility updates
  and deletion now record approved token versions in shared History. Content,
  head and storage commit together in the home database, including under a
  custom data-source selection. Identical saves add no event; deleting at the
  storage ceiling retains the prior version. Timeline 1.5.0 and themes/delete
  1.1.0; dedicated restore, selection history and legacy coverage remain open.
  [PR #970 details](../PRs/970-timeline-theme-history-record-saved-theme-changes-in-shared-history.md).

- 2026-09-27 — **Codex (AI)**: Timeline quota acceptance uses synthetic accounts
  and the normal admin API on a guarded disposable replica. At the exact limit,
  reads, folder organization and deletion retain history; refused edits/restores
  leave content, events and accounting untouched. Below-usage downgrades remain
  refused. Storage errors now explain that retained history uses space instead
  of promising deletion will free it. Fork-safe test setup is in README.

- 2026-09-27 — **Codex (AI)**: Things display-name edits for themes, algorithms,
  emoji and chat archives now appear in shared History. Strict title-only
  snapshots preserve protected payloads; content, quota and history commit
  together. Stale/refused writes and unchanged titles add no successful event.
  The Thing permalink updates immediately after Rename, and optimistic views
  preserve protected source names. Temporary refresh failures keep the matching
  cached Thing with a retry control; access refusals clear it.
  Timeline 1.4.0 / Things 1.33.2. Dedicated
  content writers and protected restoration remain in progress. See
  [PR #966 details](../PRs/966-timeline-library-history-record-library-renames-in-shared-history-and-refresh-thing-views.md).

- **2026-09-27 · Codex (AI):** Added 41 reusable native traversal programs and bounded synchronous callback definitions saved as Component data. Verified 116 native cases, edited-filter save/reload/reuse, private API round-trips, responsive layout and production output; Actions contract is 1.35.0. See [PR #962 details](../PRs/962-web-standards-traversal-reusable-native-traversal-and-editable-callback-programs.md).

- 2026-09-27 — **Codex (AI)**: Folder deletion records each child move before
  removing the folder; shared transactional ancestor checks prevent deleted
  destinations and concurrent cycles. Compact placement history restores exact
  saved content, and the open Thing refreshes after restore/merge. Protected
  library moves retain folder metadata only. Timeline 1.3.0 / Things 1.33.1;
  [PR #965 implementation and acceptance](../PRs/965-timeline-folder-history-record-folder-moves-and-restore-their-exact-thing-history.md).

- 2026-09-27 — **Codex (AI)**: Private account autosave for post/comment, Thing,
  definition and schema editors; shared draft/template picker, reusable post
  templates with independent media, revision-safe recovery and scoped local
  workspaces. Preserve original definition versions during recovery so stale
  drafts cannot overwrite newer saved content; retain recovered text in History.
  Preserve raw JSON schema input through account recovery and parse only for
  validation/publication, including schemas copied from the platform catalog.
  Verified full unit, production output, real API/media and browser recovery
  flows against current main. See [PR #957 details](../PRs/957-codex-account-drafts-autosave-account-drafts-and-add-reusable-post-templates.md).

- 2026-09-27 — **Codex (AI)**: Lopu Mac/browser dictation waits five seconds
  before sending the current message draft. Settings → Lopu → Voice transcription
  and the voice gear share a custom 1–120 second delay. Chat settings adds
  **Hear me out**: keep listening and ask “Send now?” every ten seconds of silence,
  with no automatic send. Manual Stop retains the draft; stale timers and rejected
  sends cannot lose text. Removed the Mac dictation capture's fixed 1.5-second cutoff.
  See [PR #961 details](../PRs/961-codex-voice-silence-settings--configurable-dictation-silence-and-hear-me-out.md).

- 2026-09-27 — **Codex (AI)**: Canonical Thing changes from server Actions and
  Lopu tools now retain trusted origin and group nested writes through the
  existing relational Timeline operation links. Concurrent calls stay isolated;
  partial failures record only committed edits, and browser preparation claims
  no execution. Shared local/remote record schemas remain unchanged. Complete
  Action outcomes and ordinary browser execution receipts remain in progress.
  [PR #959 details](../PRs/959-timeline-mutation-coverage-preserve-action-and-ai-provenance-in-thing-history.md).

- 2026-09-27 — **Codex (AI)**: Reviewed PR #954 against current main, preserved Lopu Ask/Full permissions with prompt settings, validated all 100 public schema definitions, and fixed concurrent attachment-save rollback deleting a completed file. Full unit suite, 902 API checks, real-byte acceptance, settings isolation/concurrency, production web build and iOS simulator build pass; no added TypeScript diagnostics. [QA details](../PRs/954-post-schemas-attachments-make-all-schemas-copyable-fix-uploads-and-add-lopu-prompt-settings.md).


- 2026-09-27 — **Codex (AI)**: Add 30 reusable XPath query, expression, namespace and result programs, with owned document isolation and synchronous work limits. Negotiate Actions 1.34.0; validate saved edits and native browser behavior. See [PR #958 details](../PRs/958-web-standards-xpath-reusable-native-xpath-query-and-result-programs.md).

- 2026-09-27 — **Codex (AI)**: Unified Timeline work in progress: shared local/API
  event and relationship records, durable draft recovery, private relational event/link Things and transactional
  ordinary Thing history. Shared History now previews restores and three-way
  merges with explicit conflict choices and idempotent, version-fenced commits.
  Named branches now use separate branch/Thing head records, durable local
  commands, private exact-version reads, and transactional forward-only pushes.
  Concurrent/deferred pushes preserve versions and show per-branch outcomes.
  Large versions retain separate snapshot parts, so history cannot strand later
  edits or deletion; the real API grow/shrink/restore/delete regression passes.
  IndexedDB upgrades pending work to atomic relationship records; server ancestry
  uses exact parent links and existing shared indexes. Lopu preserves missing/dirty page context instead of treating it as an empty
  page. Disposable replica-set and browser evidence, limits and outstanding
  delivery gates: [PR #956 notes](../PRs/956-unified-timeline-add-relational-timeline-history-and-durable-branch-synchronization.md) and [implementation contract](../docs/unified-timeline.md).

- 2026-09-27 — **Codex (AI)**: Add 53 reusable ARIA object programs with native nullable reflection, owned element relationships and frozen-list identity; negotiate Actions 1.33.0. Make animation stages grow to keep both tiles visible. Validate production output and retain the managed loopback dev stack; see [PR #955 details](../PRs/955-web-standards-aria-reusable-native-aria-object-programs.md).

- 2026-09-27 — **Codex (AI)**: Lopu can execute saved browser and server Actions
  from chat. Per-chat **Ask before running** and **Full access** controls gate
  mutations, persist safely across chat/account changes, and retain existing
  Action, account and storage boundaries. The internal host shares canonical
  data routes with Nitro and works in durable workflows. See
  [execution contract](../docs/lopu-action-access.md) and
  [PR #953 validation](../PRs/953-codex-lopu-workspace-actions--allow-lopu-actions-with-per-chat-access.md).

- 2026-09-27 — **Codex (AI)**: Follow-up to the live Lopu Action run: large
  Thing reads now offer lossless, authorized JSON Pointer pages instead of
  repeating a truncated summary. Workspace select errors report their exact
  allowed values, so Lopu can correct categories without trial writes. See
  [PR #960 validation](../PRs/960-lopu-action-observation-lossless-inspection-and-actionable-category-errors.md).

- 2026-09-27 — **Codex (AI)**: Lopu can inspect Action contracts and check
  candidate inputs without execution. Invalid inputs fail before confirmation;
  partial failures retain their run identity and recovery guidance. Newly
  authored workspace Actions expose canonical choices, numeric bounds and
  reference hints. Existing installed apps and their data are preserved. See
  [PR #964 validation](../PRs/964-lopu-action-guidance-inspect-action-contracts-and-recover-from-errors.md).

- 2026-09-27 — **Codex (AI)**: Lopu now recognizes JSON-labelled tool fences,
  repairs printed tool requests with bounded corrective hops, and restores
  lossless read pages across checkpoints with fresh access/revision checks.
  Private message metadata stores only read locators; Action failure recovery
  details now reach the next model hop. Reply capability is 1.19.1. See
  [PR #967 validation](../PRs/967-lopu-stall-recovery-fix-tool-call-stalls-and-preserve-read-context.md).



- 2026-09-27 — **Codex (AI)**: Mac/browser Lopu dictation now writes directly into the editable
  message field. Stop keeps partial words, recording again appends, and explicit
  Send uses the ordinary composer with late-result and rejected-send protection.
  See [PR #952](../PRs/952-codex-voice-composer-draft--keep-voice-transcription-in-the-editable-message-draft.md) for behavior and validation.

- 2026-09-27 — **Codex (AI)**: Web Standards adds 111 editable native animation
  programs with saved keyframes/timing, playback promises and callbacks, scoped
  receivers and cleanup. Both manifests/client negotiate actions-run 1.32.0.
  Browser validation includes native interpolation, keyframe copying and ignored
  option detection. See the [animation guide](../docs/web-standards-builder.md#native-web-animation-programs) and [PR #951 details](../PRs/951-web-standards-animations-reusable-web-animations-programs.md).
- 2026-09-27 — **Codex (AI)**: Publish all built-in schemas as copyable public
  Schema Things, preserve nested/JSON fields and render templates in forks,
  fix real Builder file commits, and let Lopu save chat attachments as durable
  private files for Thing properties. Add visible shared Lopu guidance,
  private tickable custom instructions, admin base-prompt editing, and shared
  prompt composition across chat, voice, musings and recording analysis.
  Includes isolated local upload/schema acceptance and native voice support.
  [PR #954 details](../PRs/954-post-schemas-attachments-make-all-schemas-copyable-fix-uploads-and-add-lopu-prompt-settings.md).

- 2026-09-27 — **Codex (AI)**: Add 40 reusable live/static range programs with
  editable boundaries, native document edits and bounded contextual fragments.
  Check owned endpoints and concrete native getters; negotiate actions-run 1.31.0.
  See [PR #950](../PRs/950-codex-web-standards-ranges--add-reusable-live-and-static-range-programs.md).


- 2026-09-27 — **Codex (AI)**: Add 81 reusable observer programs with database-authored callbacks, native records, scoped targets and synchronous mutation batches. Disconnect on completion/Stop, preserve unsupported results in callbacks, and negotiate actions-run 1.30.0. See [PR #949](../PRs/949-codex-web-standards-observers--add-reusable-observer-programs-and-database-authored-callbacks.md).
- 2026-09-27 — **Codex (AI)**: Recover from the Mac speech recognizer's observed
  empty-input retry during silence. Keep listening without a false service
  error, while preserving errors from failed captures that contain speech and
  from unrelated service failures.
- 2026-09-27 — **Codex (AI)**: Clear stale microphone/recognition errors when
  retrying Lopu voice input. Capture errors no longer linger as conversation
  history after permission is granted and a voice message sends successfully.

- 2026-09-27 — **Codex (AI)**: Add 149 reusable layout/Geometry programs with scoped browser metrics, hit tests, native scroll completion, quad/range measurements and removable media-query listeners. Preserve native mixin accessors and private Component save/reuse. See [PR #944](../PRs/944-codex-web-standards-layout--add-reusable-layout-and-geometry-standards-programs.md).

- 2026-09-27: Fix Mac Lopu voice input reporting `Microphone unavailable (network)`
  by routing standard desktop transcription through a signed Apple Speech helper.
  Preserve the existing chat/model flow, stop capture at lifecycle boundaries,
  and show actionable microphone/speech permission errors. See [PR #945 notes](../PRs/945-codex-mac-voice-input--fix-mac-lopu-voice-input-with-native-speech-recognition.md).


- 2026-09-27 — **Codex (AI)**: Add 102 reusable CSSOM programs, bounded native stylesheet/declaration receivers, scoped adoption and cancellable async replacement. Fix sample CSS masking adopted widths; verify private save/reload/reuse and native browser behavior. See [PR #943](../PRs/943-codex-web-standards-cssom--add-reusable-cssom-programs-and-native-stylesheet-editing.md).

- 2026-09-27: Add reusable CSS Typed OM programs for 249 catalogue entries, with native unit/math/transform/style-map receivers, bounded CSS factories and actions-run 1.27.0 negotiation. See [PR #942](../PRs/942-codex-web-standards-typed-css--add-reusable-css-typed-om-programs-and-native-style-maps.md) for native/API validation and delivery evidence.


- 2026-09-27 — **Codex (AI)**: Reusable CSS function comparisons cover 180
  catalogue entries (137 newly interactive), including maths, colour, transforms,
  shapes, grids, easing, counters and anchors. Scoped CSS probes distinguish
  syntax acceptance from native computed results and compare a control sample.
  Edited programs retain the existing private Component/Action save path;
  actions-run 1.26.0 advertises the additive contract. Details:
  [PR #940](../PRs/940-codex-web-standards-css-functions--add-reusable-css-function-comparisons.md).

- 2026-09-27 — **Codex (AI)**: Added 192 reusable SVG filter programs with visible
  original/filtered drawings, typed native values and private Component saving.
  Shared filter/PNG budgets preserve the existing isolated runtime; literal SVG
  booleans and non-element DOM ownership stay correct. Actions-run is 1.25.0.
  Validation and deployment: [PR #939](../PRs/939-codex-web-standards-svg-filters-add-reusable-svg-filter-programs.md).

- 2026-09-27 — **Codex (AI)**: Added 311 reusable SVG programs with native geometry,
  units, text, transforms, typed lists and primitive IDL constants. Namespaced
  documents and surface receivers keep bounded local resources; native probes
  report ignored bounding-box options as unsupported. Actions-run advances to
  1.24.0; private save/reload, browser boundaries and deployment checks recorded
  in [PR #938](../PRs/938-codex-web-standards-svg-add-reusable-native-svg-programs.md).

- 2026-09-27 — **Codex (AI)**: Added 145 reusable Canvas programs with native
  surface receivers, drawing, fonts, pixels, paths and typed settings. Fixed
  detached-context font no-ops by using the actual isolated surface. Bounded
  bitmap/path work and blocked runtime-document access; actions-run is 1.23.0.
  Details: [PR #936](../PRs/936-codex-web-standards-canvas-add-reusable-native-canvas-programs.md).


- 2026-09-27 — **Codex (AI)**: Web Standards Builder adds 95 reusable native media
  programs (89 newly interactive entries), local audio/video clips, editable
  playback settings, native media events and property/range/error results.
  Playback promises retain rejection and fence stale completions; initial mute
  uses the native setter. Both manifests/client require actions-run 1.22.0.
  Local validation includes restarting a crashed Nitro worker through the
  checkout's PM2 lifecycle command while preserving the disposable API scope.
  Details: [PR #935](../PRs/935-codex-web-standards-media-add-reusable-native-audio-and-video-programs.md).


### 2026-09-27 — Reusable live HTML event programs

- Add 107 editable HTML/GlobalEventHandlers examples with native listener options,
  IDL handler properties, propagation/cancellation controls and bounded event traces.
  Interactive coverage reaches 3,184 entries; the full catalogue remains incomplete.
- Report cancellation after native dispatch, clean up failed/exhausted bindings,
  and preserve ordinary private Component save/reopen behavior. Existing sandbox
  restrictions remain unchanged. Catalogue/client contract: 1.21.0.
  Details: [PR #934](../PRs/934-codex-web-standards-html-events-add-reusable-live-html-event-programs-and-native-handler-bindings.md).


- 2026-09-27 — **Codex (AI)**: Added 132 reusable Web IDL dictionary, field,
  enum and callback programs for events, files, fetch metadata, decoding,
  geometry and stream lifecycles. Interactive coverage reaches 3,077 entries.
  Saved callbacks and inputs use the existing isolated runtime; native errors
  and unsupported features stay visible. Catalogue/client contract: 1.20.0.
  Details: [PR #933](../PRs/933-codex-web-standards-webidl-options-add-reusable-web-idl-options-and-callback-programs.md).

- 2026-09-27 — **Codex (AI)**: Added reusable native destructuring patterns
  across declarations, assignments, parameters, catches and loops. Twenty new
  examples bring coverage to 2,945; Parameter Lists now demonstrates patterns.
  Getter-order differences remain visible. API/client negotiation advances to
  `api.actions-run` 1.19.0; runtime sandbox permissions are unchanged. Details:
  [PR #932](../PRs/932-codex-web-standards-binding-patterns--add-reusable-binding-patterns-and-javascript-examples.md).

- 2026-09-27 — **Codex (AI)**: Added 66 reusable constructor-signature
  programs, taking interactive coverage to 2,925 entries. Editable native
  call/new behavior, typed-array overloads, Promise order, Proxy invariants and
  saved defaults use existing Component language nodes. The catalogue contract
  is `api.actions-run` 1.18.0; runtime permissions are unchanged. Details:
  [PR #931](../PRs/931-codex-web-standards-constructor-programs-add-reusable-javascript-constructor-signature-programs.md).

- 2026-09-27 — **Codex (AI)**: Saved collection sources load cursor pages through viewer-authorized Actions, with older-result search, deduplication, retry and bounded accumulation. Copies preserve the source Action dependency; existing collection styling and editable row templates are retained. Details: [PR #929](../PRs/929-codex-builder-paged-collections-load-editable-collections-from-paged-action-sources.md).

- 2026-09-27 — **Codex (AI)**: Added 67 reusable TypedArray, iterator and
  generator intrinsic examples, taking worked coverage to 2,859 entries.
  Native byte conversions, callback traces, cleanup and protocol errors remain
  editable Component program data. Missing-throw behavior reports differences
  from ECMA-262 2026 without replacing native results. The catalogue contract
  is `api.actions-run` 1.17.0; runtime permissions remain unchanged. Details:
  [PR #928](../PRs/928-codex-web-standards-intrinsic-receivers-reusable-typed-array-and-iterator-examples.md).

- 2026-09-27: Added editable `tt-menu` controls with bounded native popovers, keyboard navigation and scoped dialog hosting. See [PR note](../PRs/925-codex-builder-menu-controls-editable-native-menus.md).
- 2026-09-27 — **Codex (AI)**: Reusable ECMAScript receiver and prototype
  programs fill 136 missing built-in examples and improve 22 existing ones.
  Editable binary data, iterator consumption, weak identity, promises, function
  receivers and local prototype extensions use existing Thingtime language
  nodes. The catalogue reaches 2,792 interactive entries; API/client catalogue
  negotiation advances to `api.actions-run` 1.16.0. Details:
  [PR #924](../PRs/924-codex-web-standards-js-receivers-add-reusable-ecmascript-receiver-and-prototype-examples.md).

- 2026-09-27 — **Codex (AI)**: Live Components expose scoped pending Action
  state for authored saving labels and disabled forms, plus current page identity
  for reusable page controls. Dialog close content
  and its accessible label can use the same sanitized, editable markup as
  the rest of the app.

- 2026-09-27 — **Codex (AI)**: Saved Component links keep their page and view
  mode inside Builder. Local Back controls can return through nested links
  within the same app, with an explicit fallback for direct entry.

- 2026-09-27 — **Codex (AI)**: Reusable live form programs add native reset,
  requestSubmit/submitter and user-edited validity examples. Shared DOM bindings
  resolve native methods despite named form controls, preserve immediate errors,
  and expose bounded event receipts. Form events explicitly opt in while runtime
  CSP keeps the origin opaque and denies submission navigation. Catalogue and
  client capability contract advance to `api.actions-run` 1.15.0. Details:
  [PR #919](../PRs/919-codex-web-standards-live-form-actions-add-reusable-live-form-events-and-validation-contexts.md).

- 2026-09-27 — **Codex (AI)**: Editable media forms can reset automatically
  after a successful receipt matches their generated operation id. Failed and
  sibling saves preserve drafts and retry identities. Attachment controls add
  configurable helper text, linked-URL visibility and local upload readiness.
  Nested discussions also isolate clicks from authored ancestor Actions.

- 2026-09-27 — **Codex (AI)**: Web standards adds 212 reusable HTML form
  examples with typed control state, text selection, validity and live
  option/radio collections. Native overload dispatch and detached collection
  allocation limits are covered by real-browser regressions. Reset remains
  requires-context after a native detached-document no-op was reproduced.
  The catalogue Action contract advances to 1.14.0. Validation includes private
  API round trips, browser execution and a full Vercel build. Details:
  [PR #914](../PRs/914-codex-web-standards-form-receivers-add-reusable-html-form-state-and-selection-examples.md).

- 2026-09-27 — **Codex (AI)**: Saved Builder Components can embed the standard
  Thing discussion with `tt-discussion`, retaining rich comments, replies,
  reactions, media and collection controls. Previews stay inert; target reads
  and writes keep the current viewer's permissions. Accepted comments refresh
  source-bound page blocks for related galleries and record revisions.

- 2026-09-27 — **Codex (AI)**: DOM receiver inspection and projection now use
  captured browser accessors, so named form controls cannot hide descendants
  from allocation/depth limits. Added reusable browser regressions and rejected
  shallow clones that would create a second receiver Document. Details:
  [PR #909](../PRs/909-codex-web-standards-dom-receivers-add-reusable-dom-receivers-to-web-standards-programs.md).

- 2026-09-26 — **Codex (AI)**: Web standards adds 158 editable detached-DOM
  examples through reusable program operations: native document/element/text
  receivers, node collections, attributes and class tokens. Run-local handles,
  native member policies and shared execution/allocation limits preserve the
  isolated runtime. Private API round trips and browser mutation/refusal checks
  cover the new path. Full platform demo coverage remains unfinished; these
  examples do not provide a live window/layout context. Details:
  [PR #909](../PRs/909-codex-web-standards-dom-receivers-add-reusable-dom-receivers-to-web-standards-programs.md).

- 2026-09-26 — **Codex (AI)**: Web standards edited draft saving. The authored
  save Action keeps the full program and current input defaults in a private
  reusable Component. Added bounded JSON Action inputs and preserved literal
  program data across Component rendering. Invalid drafts cannot save an older
  snapshot; resolved defaults and nested calls obey input byte limits. Details:
  [PR #908](../PRs/908-codex-web-standards-save-drafts-save-edited-web-standards-examples-as-reusable-components.md).

- 2026-09-24 — **Codex (AI)**: Web standards language programs. Added reusable
  class/function/generator, template and control-flow nodes with 28 authored
  recipes (25 additional interactive entries). Interface inspection now reads
  descriptors without invoking getters. Runtime HTML versions its compiler URL
  by content digest; both assets use no-store to prevent stale compiler reuse.
  Template encoding explicitly escapes backslashes before delimiters, with
  adversarial plain/tagged literal regressions.
  Details: [PR #903](../PRs/903-codex-web-standards-language-programs-add-reusable-javascript-language-definitions.md).

- 2026-09-24 — **Codex (AI)**: Add 120 interactive Web API entries for event and
  abort lifecycles, streams, native controllers, BYOB reads, queue strategies,
  streaming text encoding and compression. Editable Component programs share
  reusable expression builders and show observed delivery, backpressure,
  cancellation and closure. Browser support remains independently reported;
  no runtime permission or account access is added. See the
  [PR #902 validation note](../PRs/902-codex-web-standards-events-streams-add-reusable-event-and-stream-lifecycle-demos.md).

- 2026-09-23 — **Codex (AI)**: Complete saved planner date, filter and move bindings with reusable change/drag controls. Split the planner controls and days into editable Components, group daily visits once, preserve the original page-size choices and cancel delayed field changes when their binding changes. Local fixture requests now time out and negotiate Action protocol 1.11. See [PR #899 implementation and validation notes](../PRs/899-codex-builder-portable-app-programs-compose-editable-planner-and-themed-collections.md).

- 2026-09-23 — **Codex (AI)**: Add inherited Component theme tokens, instance-scoped CSS rules, deferred editable collection rows and configurable dialog/selection behavior. Builder app authoring uses the original HQ styles and saved relationship calculations. Copying preserves row Actions, media and dialog completion references. Index/group expressions negotiate Action protocol 1.11; production HQ data migration remains a separate reviewed operation.

- 2026-09-23 — **Codex (AI)**: Normalize Builder app record titles once and use shared field descriptors so each saved Action fits the existing signed mutation preview. Preserve reference permissions, archived labels, zero values, and empty text.

- 2026-09-23 — **Codex (AI)**: Add 248 reusable Web API member demos for URLs,
  collections, blobs/files, fetch objects and bodies, encoding, exceptions and
  geometry. All 272 runnable Web API recipes pass the Chrome runtime audit;
  missing browser/context support remains explicit. Definitions retain their
  full program and only the inputs they use. See
  [PR #901 validation and scope](../PRs/901-codex-web-standards-worker-api-add-reusable-web-api-member-demos-and-receiver-fixtures.md).

- 2026-09-23 — **Codex (AI)**: Expand the reusable Web standards catalogue to
  576 runnable JavaScript examples, including language control flow and
  well-known symbol members. Builder fields adopt asynchronous defaults while
  preserving visitor edits. Isolated workers get a bounded startup phase before
  their unchanged two-second execution limit; regression checks cover delayed
  startup, cancellation and filter reloads. See
  [PR #900 validation and delivery notes](../PRs/900-codex-web-standards-syntax-and-controls-expand-standards-language-demos-and-preserve-builder-filter-values.md).

- 2026-09-23 — **Codex (AI)**: Added authored declarative JavaScript fixtures
  for Intl, Object/Reflect, collections, promises, buffers and byte encodings.
  The shared isolated worker reports unavailable features before execution,
  without invoking getters during support detection. A local browser audit now
  checks catalogue recipe execution separately from definition validation. See
  [PR #898 validation notes](../PRs/898-codex-web-standards-runtime-coverage-fix-javascript-standards-fixtures-and-browser-availability-reporting.md).

- 2026-09-23 — **Codex (AI)**: Added the reusable Web standards Builder suite,
  a sourced standards inventory and editable isolated HTML/CSS/JavaScript demo
  programs. Inspection/context-dependent entries retain explicit coverage gaps.
  Shared query-form controls now collect their declared fields; development and
  Vercel builds include the sandboxed runtime. See the
  [PR #897 validation and coverage notes](../PRs/897-codex-web-standards-builder-add-reusable-web-standards-builder-catalogue-and-isolated-demos.md).


- 2026-09-23 — **Codex (AI)**: Ordinary shared Builder pages can expose an
  editable copy through the reusable `$install` control. Copying pins the
  account and preserves connected-record permissions. Revoked source access
  clears previously rendered data while transient failures retain it.
  Verified with separate local team accounts, private 50-Thing copies and
  membership revocation; production app migration remains in progress.
  [PR #896 details](../PRs/896-codex-builder-shared-app-copies--editable-shared-app-copies-with-live-access-checks.md).

- 2026-09-23 — **Codex (AI)**: Add saved, editable linked-record histories,
  child-form defaults, duplication, visit totals/status controls, discussions
  and image selection to the opt-in Builder composition. Copies use relative
  page links and stable save receipts. Existing records and access rules remain
  authoritative; production page migration is tracked separately.
  [PR #895 details](../PRs/895-codex-builder-linked-workflows--editable-linked-records-and-copy-safe-app-flows.md).

- 2026-09-23 — **Codex (AI)**: Editable planner/address workflows and record-bound source state. Validation and remaining migration scope: [PR #894](../PRs/894-codex-builder-app-workflows--editable-planner-address-and-record-workflows.md).

- 2026-09-23: Fence Builder source results, cached bindings and action receipts across record navigation and viewer/page/sharing changes so stale controls cannot target the previous record.

- 2026-09-23 — **Codex (AI)**: Editable app flows add day/week planner filters, readable record references, category-specific equipment choices, role-gated forms, grouped media and a saved address-search Action. Reusable local draft fallbacks, atomic patches and configurable select state preserve typed values through refreshes and reset on navigation. Local fixture validation only; live app migration remains separate.

- 2026-09-23 — **Codex (AI)**: Builder Components retain saved source bindings;
  reusable form, searchable selection, map and attachment primitives support
  record screens authored as editable Things. Browser Actions add bounded
  `each` and configurable expression budgets (protocol 1.9), and populated
  textareas reopen without a renderer crash. The local composition fixture
  exercises the existing record API without migrating live records or ACLs.
  Details: [PR #893](../PRs/893-codex-editable-builder-app--reusable-record-controls.md).


- 2026-09-23 — **Codex (AI)**: Saved browser Actions can collect cursor-backed
  GET lists with configurable response fields, deduplication and explicit
  budgets. Every page retains account/capability checks; incomplete lists
  fail visibly. Versioned client preparation protects older clients from
  silently truncating lists. The full-program composer includes a paginated
  request preset. See [browser Action documentation](../docs/builder-browser-actions.md).


- 2026-09-23 — **Codex (AI)**: Add saved browser Action request flows with
  endpoint allowlists, semantic capability negotiation, account fencing,
  shared execution limits and session traces. Add nested Fields/Source editing
  for saved Builder definitions and a full Action authoring mode with stale
  edit protection. Existing native workspaces are not yet converted. See
  [PR #890 acceptance notes](../PRs/890-codex-editable-service-components--editable-builder-definitions-and-browser-actions.md).

- 2026-09-22 — **Codex (AI)**: Hide empty user placeholders reconstructed from
  background reply output after reload, and retain an already-saved terminal
  reply instead of appending an empty duplicate. Preserve attachment-only
  messages, active output and manual Retry; stopped tasks remain stopped.

- 2026-09-22 — **Codex (AI)**: Include the pinned Claude runtime in Vercel
  Workflow execution packaging and check the worker bundle independently of the
  main server. Align each Claude-consuming function’s CPU architecture with
  its packaged executable. Reply capability 1.14.2 records the correction for a
  production failure before provider invocation. The follow-up PR records
  deployed acceptance and final release evidence; see the
  [follow-up note](../PRs/883-codex-lopu-workflow-claude-runtime-fix-claude-workflow-runtime-and-stop-recovery-display.md).
- 2026-09-22 — **Claude (AI)**: The five demo apps adopt PR #870's native
  controls — confirmation dialogs (`tt-dialog`) on every destructive control,
  a focus-timer countdown (`tt-countdown`) with `$ui` length pickers, a `$ui`
  "Hide unseen" toggle on the Thingmon dex — and return tidy results for the
  runtime's inline result panel. [PR #886 note](../PRs/886-claude-builder-demos-native-controls--demo-apps-adopt-native-controls.md).
- 2026-09-22 — **Codex (AI)**: Route native-tool GPT-5.6 Sol chat replies through
  Responses while retaining the selected reasoning effort and speed. The reply
  contract advances to 1.14.1 after authenticated preview QA exposed a rejected
  Chat Completions combination. Live repaired-path acceptance remains pending;
  details are in the [PR 867 note](../PRs/867-codex-thingtime-continuity-ux-seamless-lopu-and-things-controls.md).

- 2026-09-22 — **Codex (AI)**: Commit keyboard adjustments on the remote
  brightness and volume sliders. Arrow and range-navigation keys now send the
  displayed value, with duplicate pointer/keyboard completion suppressed.

- 2026-09-22 — **Codex (AI)**: Keep remote device telemetry flowing when a
  macOS application has a blank display name. The native heartbeat now uses
  its bundle identifier as the name and skips blank identifiers before paging,
  preventing HTTP 400 responses that hide brightness and file capabilities.

- 2026-09-21 — **Claude (AI)**: Five creative builder demo app suites on the
  📱 Apps tab — ✅ Done & Dusted (todo), 🔮 Thingmon (creature collector with
  60 generated original pixel-art species and a new `thingmon` domain pack),
  📸 Snapquest (photo hunt with real uploads), 📖 Branchwood (choose-your-own-
  adventure), 🌱 Pixel Garden (time-based growth on an interval source).
  Adds `schemas/appSuites/kit.ts`, `BehaviourSuite.content` (generic seeding
  of app content), `scripts/generate-thingmon-sprites.mjs` and the live
  verifier `scripts/verify-demo-apps.mjs` (151 checks). Details, gotchas
  (rolldown + JSON initialisers, nested `$item` lambdas) and the manual
  checklist: `PRs/864-claude-thingtime-builder-demos-2e2672--creative-demo-app-suites.md`
  and `TESTING.md`.

- **2026-09-21 · Codex (AI):** Seamless Lopu continuation with browser/server
  management, one aggregate iOS chat Live Activity, Builder settings and unified
  Commander navigation. Things now share post discussions, attach existing
  Things, recognize legacy folders, preserve scalar previews and expose broader
  management/rename controls. Shared discussions preserve paginated search and
  filters with authorized rich comment batches (Things 1.27.0). Generic Thing
  reads also protect device-command inputs and expiring file results. Action-run delivery defaults off; unlisted social
  previews retain context without indexing. Fix Nitro shell asset registration
  and writable Graphify working copies. Pre-merge review also hardens abandoned
  server task cancellation, workflow admission recovery and persisted local
  retry limits. See the [delivery note](../PRs/867-codex-thingtime-continuity-ux-seamless-lopu-and-things-controls.md)
  for validation and device/deployment limits.

- 2026-09-21 — **Codex (AI)**: Restore native display brightness on Apple
  Silicon Macs and refresh paired capabilities on heartbeat. Add a shared
  Things file browser in full-page, docked and pop-up layouts, with protected
  Thingtime files and bounded remote copy/cut/paste. Preserve originals on
  failed transfers and keep file bytes out of device history/events. Verified
  real brightness round-trip, repeated native/web tests, a full web build and
  desktop/mobile browser states. [QA and rollout](../PRs/878-codex-remote-device-files-fix-brightness-and-shared-file-browser.md).

- 2026-09-21 — **Codex (AI)**: Add 40 Mapbox, Google Maps/Places and larger-platform examples (540 total), isolated browser SDK loading with transient key controls, bounded Places POST searches and generated builder pages. `api.library-request` advances to 1.2.0; setup and verification guidance cover separate browser/server keys. [PR #880 details](../PRs/880-codex-library-maps-platforms-maps-and-major-platform-examples.md).

- 2026-09-21 — **Codex (AI)**: Added shared franchise list controls with search, relevant filters, result counts, 5/10/15/20 page sizes and infinite scrolling across records, histories, comments, media and planner days. Removed the eight-visit dashboard cutoff; paged planner moves retain the full day order. Details: [PR #879](../PRs/879-codex-franchise-list-controls-paginate-and-filter-franchise-lists.md).

- 2026-09-21 — **Codex (AI):** Require native app changes, including Thingtime
  Mac, Thingtime Recovery and Commander, to be rebuilt, verified, reinstalled
  and launched on the development machine before handoff, with installed-build
  and smoke-check evidence in the completion report.

- 2026-09-21 — **Codex (AI)**: Production franchise follow-up: restore saved
  comment attachments in workspace galleries, clear committed upload batches,
  and show safe Google Places setup or gateway error guidance. Contracts:
  api.things 1.24.0 and api.builder-workspaces 1.0.1.
  [PR #876 details](../PRs/876-codex-franchise-production-polish-media-galleries-and-places-errors.md).

- 2026-09-21: Added an integration builder index, 42 service pages and 500 individual example pages with reusable component blocks, private editing, and an idempotent admin setup action. Long account names now truncate in the mobile header, with a compact search trigger. Retired a stale Connections lookup that could block seeding at the MongoDB index limit. [PR #875 notes](../PRs/875-codex-library-builder-pages-integration-builder-pages.md).
- **2026-09-20 · Claude (AI):** Developer-experience follow-ups. Filesystem
  stand-in for the private S3 bucket (`THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR`,
  `localAttachmentStorage.ts`, dev-only `GET|PUT /api/v1/attachments/local-object`
  with HMAC-signed URLs, refused on Vercel) so uploads, previews, downloads,
  archives and moderation fetches run locally; `remix/scripts/seed-fixture.mjs`
  (`create`/`resume`/`cleanup`/`list`) seeds a user, folder and post with N
  stored files through the real API; `docs/feature-map/` per-domain maps linked
  from `AI_ALL.md`; `nitro.config.ts` duplicate `serverAssets` merged (the
  `shell` mount was silently dropped), `registry.ts` schema fields completed and
  the typecheck baseline ratcheted down; Graphify snapshot files are now
  read-only on activation so stale hooks cannot mutate committed snapshots;
  `npm run worktree-bootstrap` + `post-checkout` auto-bootstrap for linked
  worktrees (deps, env copy, derived-port `.claude/launch.json`, relative
  `core.hooksPath`). Validation: `test:attachments`, `test:api-capabilities`,
  `test:graphify-cas`, seed → archive → cleanup against the local stand-in.
  Details: [PR #863 note](../PRs/863-claude-dx-local-storage-fixtures-feature-maps--developer-experience-follow-ups.md).

- **2026-09-21 · Claude (AI):** Once-over review fixes for download-all
  archives and the local attachment stand-in. Archive: the 280 s deadline is a
  timer that aborts stalled upstream reads and now covers planning too (504 on
  overrun); `manifest=1`/HEAD probes authorize without presigning on their own
  `attachments.archiveManifest` window; bound rows past the cap return 413
  instead of a shorter ZIP; the traversal budget counts only visible Things;
  blocked linked media is withheld from `links.txt`; the `skipped` count is
  owner/admin-only and 404s carry one message; `sharedRoot` resolves a
  composition-only media root; long names keep their extension; client toasts,
  folder-pill caching and hook placement tightened (`api.attachment-archive`
  1.0.1). Stand-in: signing-secret retry, `PrivateS3ConfigError` on Vercel,
  foreign version ids as absent objects, honoured abort signals, one pipeline
  per completion, 400 for cancelled part PUTs, optional
  `THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN`, ETag/304
  (`api.attachment-local-object` 1.0.1). Scripts: install lock in
  `ensure-dependencies.js`, `.worktreeinclude`-driven env copy and an attach
  entry in `.claude/launch.json`, seed-fixture cleanup/validation/realpath
  fixes, ratchet hard-fail on duplicate declarations. Details:
  [PR #865 note](../PRs/865-claude-dx-once-over-fixes--archive-and-local-storage-review-fixes.md).

- 2026-09-21 — **Codex (AI)**: Allow the franchise Google Maps SDK and map-service
  hosts in production/dev CSP while retaining the inline-script and eval bans;
  use raster map rendering and verify the explicit host policy.

- 2026-09-21 — **Codex (AI)**: Added an admin catalog importer on `/components`
  with whole-file schema validation, capability negotiation, bounded paced
  batches, cancellation and real publication counts. Functional demo runtime
  PR #870 is production-live; all 322 built-in demos and 18 suites are seeded.

- 2026-09-21 — **Codex (AI)**: Keep mobile sign-in hints above the floating
  assistant and DevKit buttons, with bounded scrolling for short viewports.
  Verified while testing the remote integration catalogue preview.

- 2026-09-21 — **Codex (AI)**: Enable 500 remote integration examples across 42
  libraries/services with searchable `/library` pages, editable demos, source,
  provider account/key entry and private reusable Things. The catalogue extends
  the previously delivered isolated runtime with capability 1.1.0. [Acceptance notes](../PRs/869-codex-third-party-catalogue-500-remote-integration-examples.md).

- 2026-09-21: Make demo forms run real Actions, preserve confirmation through
  composed pages, show results inline, and support bounded local component
  controls. Site forms and requests save private Things; template copying
  installs their dependencies. Added responsive browser regression coverage.
  [Validation notes](../PRs/870-codex-functional-thingtime-demos-functional-demo-controls.md).
- 2026-09-21 — **Codex (AI)**: Add the curated remote integration runtime, opaque
  preview documents, cancellable workers, credential-safe read-only provider
  requests, capability negotiation and reusable Component Thing rendering.
  Build and dev workflows generate the isolated runner. The catalogue ships
  separately after this backing infrastructure. [Validation notes](../PRs/866-codex-third-party-runtime-isolated-remote-integration-runtime.md).

- **2026-09-21 · Codex (AI):** Add a native builder service workspace for franchise
  operations: folder-backed customer/property/job/visit/equipment records, live
  role and customer access, direct record context menus, day/week planning,
  time and resource logs, per-record comments/media and Google Maps via the
  owner's Vault. Add environment selection for new Vault secrets and metadata-only
  environment moves for existing secrets/providers. Document fork setup and
  local role, scheduling, media and responsive regression checks.
  [Validation notes](../PRs/871-codex-jims-franchise-builder-franchise-workspaces-and-vault-environments.md).

- **2026-09-20 · Claude (AI):** Download all attachments. New
  `GET /api/v1/attachments/archive?id=<post|comment|page|folder|media>` streams
  one stored (uncompressed) ZIP of every file the caller may already read —
  posts/comments archive their gallery in stored order, folders walk nested
  folders and post galleries with each child re-judged on its own ACL, linked
  media lands in `links.txt`, and `manifest=1` returns the file list/bytes as
  JSON. Every file is signed through the existing content-endpoint gates; bounds
  are 500 files / 2 GiB / 1000 Things / 280 s. UI: a `Download all · N files`
  pill under multi-file post galleries, a folder-down button in the lightbox,
  a **Files** section (`Download all files`, `Share download link`) in the
  post/media ⋯ menus and the /things item menu, a `/media/:id` gallery button
  and a current-folder pill on /things. The share link is the canonical
  endpoint URL (no secret key): it downloads directly in browsers, `wget` and
  `curl` for whoever can view the Thing. Capability `api.attachment-archive`
  1.0.0 on both manifests; rate key `attachments.archive`. Validation:
  `test:attachments`, `test:api-capabilities`, lint, browser checks. Details:
  [PR note](../PRs/download-all-attachments-archive.md).

- **2026-09-19 · Codex (AI):** Make unlisted posts, pages and inherited media
  open through their canonical URLs, including fresh anonymous gallery visitors.
  Copy/share controls omit legacy secret keys; saved discoveries remain bound
  to the account or anonymous browser identity. Private/group-only access and
  moderation remain enforced. Removing the link audience revokes URL access.
  Details: [PR #860](../PRs/860-codex-plain-link-sharing-canonical-unlisted-urls.md).

- **2026-09-19 · Codex (AI):** Keep inherited secret-link context through nested
  comment/media galleries, standalone share menus and parent navigation. Show
  the resolved parent audience beside privacy icons; enforce intermediate
  moderation gates and negotiate the additive audience read contract.
  Details: [PR #857](../PRs/857-codex-inherited-media-audience-preserve-inherited-media-sharing.md).

- **2026-09-18 · Codex (AI):** Preserve the mounted page and unsaved UI state when
  a background session read temporarily fails. Recover initial session failures
  on return/reconnect, and invalidate same-origin tabs on account changes.
  Navigation and permission failures continue to fail closed.

- 2026-09-18 — Remove the post attachment count cap and add Retry all. Images and videos share ordered layouts, a popup player and shareable media links. Profiles include permitted direct/group audiences and previously collected secret posts, with account/browser discovery revoked by link rotation. [PR #852 validation](../PRs/852-codex-media-gallery-profile-access-unify-post-media-and-collect-secret-posts.md). Local validation uses worktree ports 18420–18422; Tailscale/Funnel is unavailable because the installed CLI target is missing. — Codex (AI)

- 2026-09-18 — Fix Copy to my Things for image-only posts and nested comment
  galleries. Copies preserve attachment order/purpose and reply parents, validate
  inspected media, and negotiate `api.things-fork` 1.5.0. Verified with local
  replica-set API tests and desktop/mobile Chrome. [PR #851 validation notes](../PRs/851-codex-copy-nested-things-fix-copying-nested-comments-and-attachment-galleries.md). — **Codex (AI)**

- 2026-09-18 — Floating builder controls follow Lopu split panes and pinned
  navigation drawers. Narrow panes use a wrapped bar and keyboard-accessible
  mode menu; preview popovers stay inside the available pane. — Codex (AI)

- **2026-09-18 · Codex (AI):** Fix Enter and the normal send arrow to auto-queue during Lopu replies, remove the separate Queue button, and allow draft attachment editing while replying. Keep Stop visible with a floating send arrow for typed drafts and a compact Send now menu. Remove accepted messages from the queue immediately without releasing the reply lock.

- **2026-09-18 · Codex (AI):** Fix native uploads in embedded Builder components, preserve explicit empty form fields, validate before saving, guard pending uploads and inherit component sources. Add `/docs/builder` sections shared with Lopu and a capability-scoped Google geocoding adapter using owned Vault credentials. Local isolated validation uses ports 14870–14872; no live Google/storage credentials were used. [PR #853 validation and setup](../PRs/853-codex-builder-sdk-uploads-forms-fix-builder-uploads-and-form-saves-document-sdk-and-add-scoped-lookups.md).

- **2026-09-18 · Codex (AI):** Add Lopu message queues with drag/arrow ordering, default grouped sends, pause/resume and stable retries; add immediately saved notes consumed at safe provider boundaries. Queues restore paused after reload. Publish background-task 1.2.0 and chat-reply 1.13.0 capabilities. [PR #846 validation notes](../PRs/846-codex-lopu-message-queue-add-lopu-message-queues-and-send-now-notes.md).

- 2026-09-18: Add reversible account-saved Lopu chat archiving with Chats/Archived views and Restore in the shared page/window list. Preserve transcripts and running replies; guard rollback across account changes and negotiate archive API capabilities. — Codex (AI)

- **2026-09-17 — Lopu context and docking (Codex):** Show and toggle current-page context, attach recent Thingtime pages, persist minimise-to-bubble, resize every edge/corner, and dock on all four sides with split or overlay behavior. Split navigation adapts to the remaining page width. Reply capability 1.12 adds validated page references without granting permissions. [PR #844 validation notes](../PRs/844-codex-lopu-context-docking-add-page-context-and-flexible-docking-to-lopu.md).

- 2026-09-17 — Shared seamless builder on `/builder` and `/p`: live inline text
  editing with pink block controls, Builder/Edit/Layout/View/Visit/Deploy, one
  floating navigation/preview/mode bar, overlay inspector, real
  responsive device previews and natural-height Container previews without an
  iframe. Dedicated live output
  fills the available space; `/t/` hides Thingtime chrome except its tiny credit
  link. Local PM2 validation uses worktree ports 11060–11062; Tailscale is
  unavailable because its installed CLI target is missing.
  [PR 843 notes](../PRs/843-codex-seamless-live-builder-add-seamless-live-builder-modes-responsive-previews-and-standalone-pages.md). — Codex (AI)
- 2026-09-17: Lopu removes the 24-tool, 12-hop and four-minute task limits, renews background worker leases, and automatically continues saved hosting checkpoints and token-truncated replies without a fixed continuation cap, preserving chat/model selection and completed-work receipts. Stop, account switches, confirmations, unsaved replies, and ambiguous interruptions prevent automatic continuation. [PR #842 validation and rollout notes](../PRs/842-codex-lopu-auto-continue-remove-lopu-task-caps.md).
- **2026-09-17 — Social previews and Schema.org foundation (Codex):** align server titles, canonical URLs, image alt metadata and safe JSON-LD with anonymous public previews; revise the branded image cache URL, make fallback image URLs absolute and mark private/unavailable pages noindex. [PR #841 validation, investigation and broader SEO TODO](../PRs/841-social-schema-crawler-fix.md).
- 2026-09-17: Lopu collapses submitted attachments optimistically, clears them on server acceptance despite uploader handle changes, restores rejected drafts, and keeps typing enabled during uploads. Expand supports native new-tab/window links. See [PR #838](../PRs/838-lopu-expand-link-optimistic-composer.md).
- 2026-09-17: Floating Lopu chat and voice now share the full conversation list with the Lopu page, with collapsible wide-window navigation and a narrow list view that preserves the composer. — Codex (AI)

- 2026-09-16 — **Codex (AI):** Fix image uploads hitting the legacy 30/hour start limit: default to 60/minute, upgrade only the exact persisted legacy policy, preserve custom rules, and honor bounded Retry-After retries without changing upload identity. Show the actual wait on persistent throttling; add policy, cancellation, route and capability regressions.

- 2026-09-16: Enable attachment paste/drop directly in Lopu and Messenger message fields; clear Lopu media on server acceptance instead of reply completion. Added synthetic browser regression coverage. — Codex (AI)
- 2026-09-16 — **Codex (AI):** Default link previews now use the branding
  press-kit wordmark on white. All SPA routes receive crawler-visible defaults
  (including invites), using shared public page titles or the new default
  `Thingtime - Your Home for Everything` (also used for browser tabs), while
  preserving custom public-content previews and excluding query/fragment secrets.

- 2026-09-16 — **Codex (AI)** — Add native image/file uploads to authored
  components; forward authorized image/PDF/text bytes into Lopu provider calls,
  including Claude OAuth tool hops; add a capability-negotiated browser HTTP
  SDK and confirmed API tool; keep the mobile composer above the visual
  keyboard viewport with independently scrolling attachments and long text.
  [Validation and limits](../PRs/816-codex-lopu-attachments-sdk-mobile-fix-lopu-uploads-provider-attachments-http-and-mobile-keyboard.md).
- 2026-09-16 — Fix desktop hover drawer scrolling and place its preview below the top bar, with viewport-safe bounds and fixed header/footer. Local validation: `http://localhost:18640` (HMR 18641, Nitro 18642; `TT_WEB_PORT`/`TT_HMR_PORT`/`TT_API_PORT` overrides for the hover-drawer worktree). Tailscale/Funnel unavailable: the installed launcher points to a missing Tailscale app. **Codex (AI)**
- 2026-09-16 — Messenger spaces show only their own direct/group conversations. Add an account-specific **Show Lopu chats** checkbox, off by default, while preserving explicit conversation links. **Codex (AI)**
- 2026-09-16 — Restore held-row drawer reordering after navigation rows became
  real links. Prevent native anchor/image dragging only while a reorder is
  armed, preserving normal navigation and browser link shortcuts. **Codex (AI)**

- 2026-09-16 — Lopu conversation lists/messages, Messenger, credits and shared session data now refresh quietly in the background and on returning to a tab or reconnecting. Shared polling avoids duplicate requests, keeps hidden-tab traffic low, and fences stale reads against local edits and account changes. [Details and validation](../PRs/818-codex-background-ui-refresh-keep-lopu-and-messenger-current.md). — Codex (AI)
- 2026-09-16 — Use PNG for HEIC/HEIF conversions and invite thumbnails, including server normalization. PNG preserves decoded pixels without JPEG recompression; invite photos retain their 128px crop. Version invite/signup capabilities for bounded PNG payloads. **Codex (AI)**

- 2026-09-16 — Accept HEIC/HEIF photos throughout the shared media uploader and
  convert them locally to JPEG for previews, moderation and storage. Invite
  photos now use the same profile-media control and queue with a bounded
  pre-account thumbnail transport. Includes conversion/retry regression checks.
  — Codex (AI)

- 2026-09-16 — Background chat, voice transcript replies, musings and AI
  completions: SharedWorker observation, idempotent Nitro/Vercel execution,
  private task overview, static rings, Stop and Retry / Continue. Keeps partial
  output, handles complete tool JSON missing its closing fence, and preserves
  token-limit recovery. Fixes proxy origin checks and reserves a 300-second
  Vercel budget. [Details and validation](../PRs/814-codex-lopu-background-tasks-keep-lopu-ai-tasks-running-in-the-background-with-recovery-controls.md). **Codex (AI)**
- 2026-09-16: Added eight feed perspectives, the opt-in public algorithm directory and creation/sharing flows, plus validated Thing coordinates and radius-based Local/search queries. Verified the Vercel build and responsive screens. See [PR #813](../PRs/813-feed-algorithm-community-defaults-discovery-geographic-queries.md).


- 2026-09-16: Lopu tool cards now expose safe Open anchors for read pages, search/list results, related components and URLs, retained in new saved receipts. Verified desktop/390px layouts and production build; older receipts keep their available Thing link.

- 2026-09-15 — **Codex (AI)** — System now manages shared platform credentials,
  integration secrets and Vercel environment variables with verified reveals.
  Claude chat, voice, recordings and moderation use the shared Claude OAuth
  runtime; explicit chat selections preserve model/effort/speed and never
  silently switch providers. Packages the pinned runtime for Vercel.
  [Validation and rollout notes](../PRs/811-claude-oauth-only-shared-system-vault.md).
- 2026-09-15 — AI workflow model order preserves configured entries without appending or requiring a default fallback; adds save/load regression coverage and capability negotiation. — **Codex (AI)**

- 2026-09-15 — **Codex (AI)** — Moderation now resolves a dedicated encrypted
  `OpenAI Moderation` admin-vault credential per deployment environment for
  images, invitation avatars and text, ahead of the legacy server key. Rotation
  is immediate; vault failures remain closed. No new env variable or index.

- 2026-09-15 — **Codex (AI)** — Added the shared AI policy requiring minimal Vercel bootstrap variables and environment-scoped application configuration in the Thingtime vault, with centralized resolution, isolation and verified migration/rollback.

- 2026-09-14 — **Codex (AI)** — Added protected admin-searchable error-log Things in `/things?logs=1`, bounded seven-day retention using shared Thing indexes, request correlation, redacted shared/API error capture and richer moderation provider diagnostics. [PR 799 details](../PRs/799-admin-error-log-things-searchable-admin-error-log-things.md).

- 2026-09-14 · Codex: Subspace icon/banner settings now reuse upload-first media fields with **Use URL instead**, previews and retry; added purpose-bound, quota-accounted branding attachments and the repo-wide media-input rule. Desktop/mobile URL saves and production build verified; upload storage remains subject to existing approval. See [PR #805 details](../PRs/805-subspace-image-upload-upload-first-subspace-branding.md).
- Give the notifications bell a 36px click target and reserve desktop search
  space between navigation controls so Commander cannot intercept bell clicks
  when the drawer narrows the header. — Codex (AI), 2026-09-14

- 2026-09-14 — Dropping files onto a post composer opens Photos and queues the files through the existing uploader without deselecting other modes, including Poll. Collapsed prompts and rich comments use the same flow. — Codex (AI)

- 2026-09-14 — Allow `thingtime` as a subspace slug and let owners rename URLs in Mod tools → Settings, preserving posts and memberships with atomic uniqueness checks and capability negotiation. **Codex (AI)**

- Add a public support page with the existing GoFundMe contribution link and
  editable paid-setup/sponsorship email enquiries. Replace unsupported landing
  totals, reward promises and the unavailable Indiegogo link; add a funding
  launch plan and fork-safe support setup notes. — Codex (AI), 2026-09-14

- Recover committed text/link posts when the server omits an empty media layout;
  bound stalled publish/readback requests and preserve the same retry UUID. Use
  same-tab authority sign-in on foreign previews and keep login forms unobscured.
  Retry brief moderation throttles once and preserve invite drafts on review
  failure; auth-invites contract 1.0.1. [PR #796 evidence](../PRs/796-codex-mobile-auth-post-recovery-mobile-signin-and-invite-review.md). — Codex (AI), 2026-09-13

- 2026-09-14 — Give Thingtime Recovery its own app section, isolate product build
  lists, and show build/release dates on all Recovery build views. Cache release
  dates for offline use and stamp new native bundles before signing. — Codex (AI)

- Add Settings → Account in the shared page and popup for account switching,
  storage, invitations, credits and plans. Preserve old credits/invite bookmarks
  and keep profile editing and assistant preferences in their existing tabs.
  — Codex (AI), 2026-09-13

- Add personal signup invitations with editable avatar, display name and username,
  password-only redemption, and credits reserved from the inviter's balance.
  Signup transfers the gift atomically once; cancellation and hourly expiry
  return unused gifts. Add capability negotiation, moderated thumbnails and
  concurrency/rollback coverage. [PR #790 details](../PRs/790-codex-gift-credit-invites-signup-invitations.md). — Codex (AI), 2026-09-13

- 2026-09-13 — Reconciled marketing publishing PR #638 with main, preserving both marketing and run-chat capability regressions. Verified 85 marketing, 56 capability and 16 navigation tests, plus the anonymous admin boundary and unpublished marketing gate in the PR preview at desktop/mobile sizes. — Codex (AI)

- 2026-09-13 — Correct transcript reads for Watch attachments and comments with
  inherited privacy. Resolve only their exact, still-private owned parent;
  reject shared/rebound/deleted children. Recordings capability 1.7.1.
  Regression includes production-shaped inherited ACLs. **Codex (AI)**

- 2026-09-13 — Show saved recording transcripts as subtle, expandable quotes
  beneath the shared audio player and recording activity. Owner-scoped batched
  reads resolve existing relational comments without inference, copied parent
  data or migrations; recordings capability 1.7.0. **Codex (AI)**

- 2026-09-12 — Add native Things paste, clipboard capture in Import, and bounded
  multi-file selection/drop with serial private imports and stop-on-error behavior.
  Pasted content opens ready for confirmation with the file picker collapsed.
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Connect authorized external HTTPS chat avatars to portable ZIP
  files with fresh private import bindings; negotiate export 1.14.0. Unsafe or
  unreadable images still fail explicitly. Live provider acceptance remains
  pending. [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Add the internal bounded external-avatar downloader prerequisite:
  pinned public DNS, credential-free HTTPS and image/size validation. Not yet
  enabled in chat export. [PR 764](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI)

- 2026-09-12 — Verified the private AI archive-format API/ZIP round trip on the
  PR preview, including fresh copy IDs, preserved presentation and denied anonymous
  reads; cleaned both fixtures. Source-adapter and browser acceptance remain
  separate. [Evidence and harness caveat](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI)

- 2026-09-12 — Correct the second capability suite's stale archive contract
  assertions after the AI transfer addition; 53 capability tests pass. Live
  round-trip limits are recorded in [PR 764](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI)

- 2026-09-12 — Private AI-chat archives preserve assistant avatar presets,
  inert tool receipts and explicit message/segment order through transfer and
  re-export. Capability negotiation prevents older servers from silently
  dropping presentation. [PR #764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI)

- 2026-09-12 — **Codex (AI):** Add an opt-in real recording ZIP regression proving fresh private recording import, exact-byte independence after source deletion, re-export and cleanup. [PR #764 evidence](../PRs/764-thing-transfer-clipboard.md).

- 2026-09-12 — Added and passed real nine-kind library ZIP/import regression:
  folders, schemas/data, components/pages, actions, posts, themes and algorithms,
  including fresh references on a second copy and verified cleanup. See
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Added and passed opt-in real live-chat image ZIP/import acceptance
  on preview `3e29ad283`: fresh media binding, byte independence after source
  deletion, anonymous denial and verified cleanup. Updated current transfer
  acceptance gaps in [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Include shared emoji dependencies from membership-authorized
  live chat history, without widening standalone owner-only emoji export or
  importing source account/community authority. Export capability 1.12.0;
  real multi-user media acceptance remains pending.
  [PR #764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Reconcile the transfer branch with current develop, preserving
  newer archive capability requirements alongside the incoming marketing and
  social-preview features. [PR #764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Verify ordinary live Messenger history through real dev export,
  ZIP import and Chrome clipboard/download/file-picker controls. Preserve edits,
  threads and deletion markers; verify source messages and copied-archive cleanup.
  Media and AI history acceptance remain separate. [PR #764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Add private-archive transfer controls to Messenger details,
  omit Cut for live chats, and keep nested transfer menus accessible inside
  drawers. Desktop/mobile rendered smoke covers the entry point and dialogs.
  [PR #764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Fix live-chat archive conversion of the canonical ISO edit and
  deletion timestamps after a real self-only chat export exposed a 422. Keep
  deleted text redacted and require export capability 1.11.1. [PR #764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Connect ordinary live-chat export to private archive conversion
  with membership-gated snapshots, canonical managed media reads, bounded
  preparation and export capability 1.11.0. AI/external-avatar/shared-emoji
  completion and live round-trip proof remain pending. [PR #764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12 — Bound portable export metadata preparation to 30 seconds, with
  cancellation and a recoverable retry message shared by Copy and Download.
  Large file downloads retain their separate lifecycle. See [PR #764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12: Bound private archive reads to 15 seconds with a recoverable Retry
  state and account-safe cancellation. Verify the stalled-read path in Chrome
  and real folder context-menu clipboard/ZIP behavior; see
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Add an opt-in real browser ZIP/media round-trip acceptance phase,
  including duplicate-name uploads, annotation/byte checks and source-deletion
  independence. Live execution remains pending; see
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Bound the archive-emoji binary acceptance wait to 30 seconds for
  asynchronous moderation, retaining strict safe-image assertions. Live
  confirmation remains pending the ordinary upload rate limit.
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Save real headed-Chrome transfer acceptance for OS clipboard
  Copy/Cut, Paste copy/move, downloaded JSON/ZIP file-chooser imports and verified
  cleanup. Passed on the PR preview; stored-emoji acceptance remains unresolved.
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Correct historical emoji reads to use persisted attachment purpose
  `emoji`, not its upload alias. A real ZIP test exposed the mismatch; expand
  regression coverage for remapped reactions and source-emoji deletion. Things
  1.16.1 negotiates the correction. [PR 764](../PRs/764-thing-transfer-clipboard.md).
  — **Codex (AI)**

- 2026-09-12: Render safe personal custom emoji images in private chat archives
  through an owner-only snapshot projection and Things 1.16.0 negotiation.
  Unavailable/moderated images retain readable placeholders. See
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Verify real archive avatar/message-image ZIP round trips and
  independent copies after source deletion on the deployed PR preview. Extend
  the dev-fenced binary regression test; see [PR 764](../PRs/764-thing-transfer-clipboard.md).
  — **Codex (AI)**

- 2026-09-12: Render imported chat media with the shared gallery, NSFW reveal
  and lightbox; preserve moderation for historical avatars. Desktop/mobile
  fixture checks pass; real media acceptance remains separate. See
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Prepare owner-only archive gallery metadata with canonical
  moderation flags and bounded batched reads; inline rendering remains pending.
  See [PR 764](../PRs/764-thing-transfer-clipboard.md). — **Codex (AI)**

- 2026-09-12: Surface owner-only archive roots in Things and add a read-only
  historical chat page with account-change clearing, reply links, transfer and
  dedicated deletion. Include archives in owner folder exports; Things is now
  feature 1.14.0 and export 1.10.0. Desktop/mobile fictional-browser checks pass;
  inline media rendering remains unfinished. See
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12: Add first-party owner-only archive root moves through the guarded
  managed placement writer, preserving historical records and accounting.
  Bulk contract/client minimum is 1.4.0. See
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12: Add owner-only whole-history archive re-export to portable transfer
  plans, including required media and custom emojis; optional traversal cannot
  silently truncate chats. Export contract/client minimum is 1.9.0. See
  [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI)

- 2026-09-12: Fix shared custom reaction parsing for canonical 70-character
  stored-emoji IDs, preserving archive remapping/readback and Messenger emoji
  projections without widening feed reactions or ownership rules. Clients
  negotiate the corrected contracts. Live image rendering remains unverified.
  — **Codex (AI)**

- 2026-09-12: Add an opt-in, dev-fenced archive HTTP lifecycle acceptance test
  with capability/identity checks and exact-root cleanup. Both tests pass live
  against the dev fixture with zero skips; the imported test archive was removed
  and verified absent. Media and rendered UI remain unverified. — **Codex (AI)**

- 2026-09-12: Add bounded owner-only chat archive snapshot reads with explicit
  history projection, private responses and api.things 1.13.0 negotiation.
  Archive rendering, listing and re-export remain unfinished. — **Codex (AI)**

- 2026-09-12: Route first-party owner archive deletion through whole-history
  cleanup with transactional preview timestamps and sanitized retryable errors.
  Negotiate api.things 1.12.0; archive browsing/export remain unfinished.
  — **Codex (AI)**

- 2026-09-12: Connect private chat archive groups to the transfer importer,
  protect their records from generic CRUD, and negotiate import contract 1.9.0.
  Archive UI/export and public owner deletion remain unfinished. See
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — **Codex (AI)**

- Integrate develop sign-in recovery with transfer intent; revoke Cut authority
  synchronously during pending identity changes and reject stale generations.
  See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Preserve earlier dependencies and linked resources when transfer rollback
  cannot finish; report retained IDs for recovery. Import contract/client
  requirement is now 1.8.1. See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Added retryable internal Messenger archive deletion/compensation: keep history
  until object cleanup succeeds, then refund/remove the archive atomically.
  HTTP/UI integration is still pending. See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Added the internal quota-accounted Messenger archive writer with atomic file
  binding, fresh identity/reference remapping and folder-deletion fencing.
  Endpoint and chat UI integration remain unfinished. See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Added Messenger archive contract groundwork following the requested importer
  identity replacement and archived-participant model. Runtime import/export and
  chat UI integration are not enabled yet. See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Verified real post/emoji image ZIP round trips and concurrent upload claims on
  PR 764's dev preview, including byte/annotation equality and confirmed cleanup.
  Hardened the opt-in fixture guard and corrected its archive/cleanup checks.
  Broader UI/type acceptance remains open. See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Connected custom emoji export/import, including legacy inline images, fresh
  personal copies, image annotations, dedicated rollback and folder placement.
  Desktop/mobile import-dialog checks passed with simulated uploads; real storage
  acceptance remains pending. See [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Added internal custom-emoji import writer groundwork: fresh-upload checks in
  the binding transaction, server-owned attempt identity and a personal-library
  adapter. Transfer endpoints are not enabled for emojis yet; see
  [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- Added custom-emoji transfer-envelope groundwork and tests for stored images,
  names, source-scope exclusion and upload limits. The adapter is not enabled
  yet; see [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-12

- 2026-09-12 (Codex): Shorten download-format labels to avoid mobile clipping; keep byte inclusion guidance below the selector. Real browser ZIP/JSON round-trip evidence is recorded on PR 764.

- 2026-09-12 (Codex): Export 1.7.1 skips storage verification for excluded file bytes after live attachment authorization. Links remain independently selectable. See [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).

- 2026-09-12 (Codex): Retain theme/algorithm folders during transfer, enable their owned-library Cut controls and dedicated folder moves, and negotiate export/import 1.7.0, bulk 1.2.0 and own-library 1.10.0. See [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).

- 2026-09-11 (Codex): Preserve Cut intent across SPA navigation, revoke on account/root changes, and fence stale async completions. See [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).

- 2026-09-11 (Codex): Fix durable recording export/download being rejected as expired drafts; preserve owner-only access and advertise attachment-content 1.6.4 / export 1.6.1. See [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).

- Codex — recording Cut/paste uses dedicated folder placement (bulk 1.1.0);
  export/import 1.6.0 retains included recording folders and supports a selected
  destination. Verification and remaining acceptance: [PR 764](../PRs/764-thing-transfer-clipboard.md).

- Connected standalone recordings to portable export/import 1.5.0, with collision-safe byte entries, per-file upload purpose, private independent copies and attachment-lifecycle rollback. Approved-upload round-trip acceptance remains pending; see [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI), 2026-09-11

- Added private-approved `recording-import` upload intents, purpose-separated replay checks and upload lifecycle capability negotiation (1.3.0). Portable recording adapters remain in progress. — Codex (AI), 2026-09-11

- Added server-only recording-import draft lifecycle groundwork, preserving immutable upload purpose, normal expiry cleanup and transactional storage accounting. Recording transfer adapters are not enabled yet; see [PR 764](../PRs/764-thing-transfer-clipboard.md). — Codex (AI), 2026-09-11

- Feed-algorithm transfer preserves private weights and training statistics via
  owner-only reads and dedicated quota-accounted imports, with fresh unshared
  copies and no active-selection change. Settings exposes Copy/Download/Import
  with a private-interest warning; transfer contracts advance to 1.4.0. See
  [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md). — Codex (AI), 2026-09-11

- Portable transfers now support saved themes through dedicated owner/public
  readers and private theme writers, including legacy reads and rollback.
  Theme Studio exposes Copy/Download/Import and identifies the My themes
  destination. Transfer capabilities advance to 1.3.0. See
  [PR 764 notes](../../PRs/764-thing-transfer-clipboard.md). — Codex (AI), 2026-09-11

- Preserve stored-file titles, multiline descriptions and display filenames
  in transfer plans, ZIP/clipboard bundles and imported copies. Fence import
  annotation writes transactionally to fresh unbound post drafts; negotiate
  import/export 1.2.0 without accepting server-derived moderation/type stamps.
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-11

- Preserve linked galleries and their mixed file/link order in portable JSON/ZIP
  transfers. Recreate private URL records through normal link and annotation
  writers, without fetching external bytes; reject flagged link exports and
  clean new drafts on failure. Import/export negotiate contract 1.1.0.
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-11

- Add portable JSON/ZIP Download and reviewed file import to nested Thingtime
  value menus. Copy/Cut use typed envelopes, preserve numeric strings, and
  refuse lossy values; repair top-level and direct-path deletion for Cut.
  Keep transfer dialogs above stacked success notifications on mobile.
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-11

- Add shared Transfer controls to Builder, component-family pages, Thing
  details and public webpages. Keep transfer menus/dialogs above the Builder
  inspector and require saving dirty Builder drafts before export. Verify
  desktop/mobile clipboard and download behavior across all four surfaces.
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-11

- Preserve split-template component media during import and repeated transfers;
  negotiate import contract 1.0.1 and retain ordinary upload approval gates.
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-11

- Add authorized exports and real clipboard Copy/Cut/Paste plus JSON/ZIP
  Download in Things. Verify browser download/import round trips, same-session
  moves, responsive dialogs and a full build. Broader surfaces and file/gallery
  acceptance remain in progress: [PR 764 notes](../PRs/764-thing-transfer-clipboard.md).
  — Codex (AI), 2026-09-11

- Add the private Thing import API and JSON/ZIP picker with destination choice,
  validated uploads and fresh reference IDs; verify real local imports and
  responsive dialog states. Export/clipboard delivery remains in progress:
  [PR 764 notes](../PRs/764-thing-transfer-clipboard.md). — Codex (AI), 2026-09-11

- Promote the native Apple widget suite, browser OAuth scopes, saved endpoints, per-widget routing, automatic signed Widgets releases and Recovery support from PRs #727 and #774. — Codex (AI), 2026-09-12
- 2026-09-12: Add a main-only signed/notarized Thingtime Widgets release workflow and a dedicated Widgets product, cache and installer path in Thingtime Recovery.
- Bound root session reads to two attempts with timeout/cancellation, provide
  recoverable retry/reload controls, and hide/reset account-owned UI across
  sign-in changes without falling back to another account's root data.
  — Codex (AI), 2026-09-12

- Refresh root AI guidance from two months of PR history and current source:
  preserve existing repo topics and the full global reference snapshot, add
  recurring regression/verification rules, and correct stale hook/typecheck
  advice. Keep canonical instruction symlinks unchanged. See the
  [PR #768](../PRs/768-codex-thingtime-ai-guidance-20260911-refresh-ai-guidance-from-pr-history.md)
  and its linked review/inventory.
  — Codex (AI), 2026-09-11

- Replace the Mac Widgets webview with native navigation and browser PKCE sign-in, app-only Keychain credentials, and revocable connections. Expand OAuth consent and route enforcement for account Things, actions, and Lopu; preserve selected-only legacy grants and granular read/write choices. See [PR #727 notes](../PRs/727-apple-widget-suite.md). — Codex (AI), 2026-09-11

- 2026-09-10: Add shared iOS/Mac WidgetKit actions, dashboards, Thing rendering, recent Things, and iOS Control Centre buttons. Add opt-in bounded content sync, native launch routes, Mac companion signing/install runbook, and widget acceptance checks. See [PR #727 notes](../PRs/727-apple-widget-suite.md) and [Apple widget setup](../apple/README.md). — Codex (AI), 2026-09-10

- Unify Thing, post, recording and message action-menu rendering and inherited
  base verbs. Dispatch recording handoffs through the versioned Things action
  API, retaining the legacy adapter and protected writers. Fix stale open
  submenus and scrollbar-edge clipping. Details:
  [PR 767](../PRs/767-unified-thing-menus-native-links-search-history.md).
  — Codex (AI), 2026-09-11

- Make drawer and Thing-menu destinations native anchors, preserving browser
  new-tab modifiers, and persist Things search/view/filter/sort/group rules in
  URL history, including rapid input and folder navigation. — Codex (AI), 2026-09-11

- Verify real shared-file and linked-gallery copies on the exact PR preview,
  including private copies surviving source revocation/deletion and cleanup
  of all disposable test content. Record the separate post-login root-data
  network failure and acceptance boundaries in
  [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-11

- Add confirmed Send to Lopu to private recording Things in desktop and phone menus, with capability, account-switch and processor-consent guards and a link to recording activity. Keep phone content inset. Details: [PR 761](../PRs/761-lopu-saved-recording-handoff.md). — Codex (AI), 2026-09-10

- Allow explicitly selected private saved audio Things through the recording queue and confirmed Send to Lopu flow, with source-state revalidation and transactional attachment fences. Keep automatic discovery Watch-only, preserve relational transcripts and negotiate the new 1.5 recording controls. — Codex (AI), 2026-09-10

- Add an explicitly opted-in, loopback-only recording-delivery smoke with synthetic audio, real HTTP upload/pairing/completion paths, duplicate/privacy checks, and disposable-account cleanup. Document its upload-approval prerequisites and separate synthetic broker proof from real provider/Watch acceptance. — Codex (AI), 2026-09-10

- Give historical Lopu tool summaries their own full-width row on phones,
  preserving compact desktop rows and non-interactive approval history.
  — Codex (AI), 2026-09-10

- Show earlier Lopu confirmation requests as "Approval requested" after reload,
  not failed executions. Historical receipts never restore approval grants or
  claim that later actions succeeded. — Codex (AI), 2026-09-10

- Preserve split-fragment media templates in private copies using bounded
  root-render bindings after interpolation. Keep labels and action inputs
  unchanged, compose bindings on re-fork, and align shared media discovery.
  Negotiate fork 1.4.0 and attachment-content 1.6.3. Real storage acceptance
  remains tracked in [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-10

- Reconcile the shared-copy follow-up with develop's personal-recording
  contracts, preserving fork 1.3.3 and device-pairing 1.1.0 assertions.
  Acceptance boundaries remain listed in [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-10

- Preserve linked gallery records and annotations in shared-content copies
  without fetching external bytes or changing download redirect protections.
  Negotiate fork 1.3.3 and check late revocation/metadata changes; live acceptance
  remains tracked in [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-10

- Include relational post-purpose galleries when copying shared content,
  preserving copied home targets and order with one bounded discovery query.
  Negotiate fork 1.3.2; live storage acceptance remains pending in
  [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-10

- Correct shared-app file copies whose templates interpolate stored attachment
  IDs, including defaults, nested lists, branch selectors and page-instance overrides. Preserve
  template behavior and non-argument text; enforce recipient upload approval
  inside the copy service and negotiate fork 1.3.1. Split partial
  IDs and real-storage acceptance remain tracked in [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-10

- Connect shared app forks to exact-version file copying, retarget authored
  media and bind newly owned files transactionally. Add revocation/cleanup
  coverage and negotiate the additive fork 1.3.0 contract. Live storage and
  browser-copy acceptance remain pending. See [PR #755](../PRs/755-shared-composition-file-copies.md).
  — Codex (AI), 2026-09-10

- Prepare the internal exact-version file-copy path for shared app forks.
  Reuse attachment authorization, quota reservation, multipart finalization,
  moderation and deferred cleanup. Fork-route/media rewriting integration and
  live object-store acceptance remain pending; no new HTTP capability is exposed.
  — Codex (AI), 2026-09-10

- Verify real macOS Keychain recording state storage and add explicit,
  confirmed recovery cleanup for expired unfinished pairing; completed local
  pairings remain protected and server revocation stays separate. See
  [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Make identical in-flight recording completion retries recoverable without
  repeating inference or reporting a lease conflict; publish personal broker
  1.0.1 and reconcile the latest develop sync. See
  [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Verify synthetic WAV/M4A local transcription and native Claude OAuth
  note/todo extraction with an opt-in runtime smoke. Real paired-account and
  Watch delivery remain pending; details in
  [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Add recording-settings Mac pairing with expiring masked secrets, explicit
  copy/reveal and account-switch guards; publish pairing 1.1.0. Reconcile
  develop's sharing boundaries and both manifest suites. Build and API smoke
  pass; signed-in visual and real audio acceptance remain outstanding.
  Details: [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Add an interactive Mac recording worker with hidden pairing input,
  origin-bound Keychain storage, interrupted-claim recovery and bounded
  foreground polling. Real local lost-receipt recovery passes; pairing UI,
  native Keychain and audio acceptance remain pending.
  Details: [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Register personal recording HTTP operations and owned-device settings,
  origin-scoped capability negotiation, account-tier limits, private errors and
  processor-change fences. Real local signup/pairing/selection smoke passes;
  audio, deployed worker and visual acceptance remain pending.
  Details: [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Add the unexposed personal recording broker, transactional device/consent
  fences and crash-safe completion receipts; personal jobs cannot enter the
  cloud-provider queue. HTTP/selection integration and live acceptance remain
  pending. Details: [PR 754](../PRs/754-lopu-personal-recording-worker.md).
  — Codex (AI), 2026-09-10

- Add the personal recording worker's outbound transport and bounded result
  contract: origin-scoped negotiation, credential-safe audio retrieval,
  heartbeat cancellation, grounded text results and idempotent submission
  retries. Server pairing/queue integration is still pending; no new endpoint
  or automatic processing is enabled by this foundation. — Codex (AI), 2026-09-10

- Include the origin-scoped capability-manifest suite in the standard API
  capability CI command and reconcile its assertions after combining saved
  action sharing and Lopu reply updates. — Codex (AI), 2026-09-10

- Promote shared component audience boundaries to main and reconcile the
  newly enabled origin-manifest assertions with the sharing patch versions.
  See [PR #756](../PRs/756-promote-public-component-boundaries-main.md).
  — Codex (AI), 2026-09-10

- Preserve an independently readable foreign component's authored dependency
  audience when embedded in a shared page. Revalidate each boundary, keep
  cross-author page arguments from borrowing private authority, and preserve
  independent copies and read-only execution. See [PR #753](../PRs/753-codex-shared-public-component-boundaries.md).
  — Codex (AI), 2026-09-10

- Include the origin-scoped capability-manifest suite in the standard API
  capability CI command and reconcile its assertions after combining saved
  action sharing and Lopu reply updates. — Codex (AI), 2026-09-10

- Clarify Lopu's two-step comment tool: an unapproved call opens the real
  approval card without posting; a verified follow-up posts the exact comment.
  Publish reply capability 1.6.2 without weakening the write guard.
  — Codex (AI), 2026-09-10

- Bypass the browser HTTP cache when negotiating capabilities, bound checks
  to 20 seconds and let failures retry without a page reload. Successful
  concurrent checks still share a request; incompatible contracts fail closed.
  — Codex (AI), 2026-09-10

- Preserve bounded, sanitized action receipts in Lopu conversation history so
  subsequent replies can distinguish past successes from failures. Publish
  reply capability 1.6.1; historical results grant no new action permissions.
  See [PR #731 follow-ups](../PRs/731-lopu-unified-scheduled-chats.md).
  — Codex (AI), 2026-09-10

- Keep uploaded file cards in Lopu's live user-message rows instead of hiding
  them until reload; snapshot selected public metadata locally while sending
  only attachment IDs to the server. — Codex (AI), 2026-09-10

- Layer Lopu's Thing picker above the fixed navigation using the shared modal
  stack, keeping its title and Close button accessible on phones.
  — Codex (AI), 2026-09-10

- Resolve shared controls from saved component arguments and every persisted
  page instance; preserve argument templates when copying and rebind only the
  executable actions. Guard argument-only collaborator edits against private
  dependency injection. See [PR #747](../PRs/747-codex-shared-saved-action-contexts.md).
  — Codex (AI), 2026-09-10

- Preserve Lopu's mounted composer across text/voice route changes. Signed-in
  development testing found that separate route wrappers discarded unsent
  drafts; both modes now export the same component identity, guarded by a
  route-module regression test. — Codex (AI), 2026-09-10

- Keep long Thing-picker labels within the dialog and wrap the composer
  toolbar so its settings and Send controls remain reachable on narrow phones.
  — Codex (AI), 2026-09-10

- Publish native build 31 for unified Lopu conversation recovery. All 51 native
  CI tests and signed iPhone/Watch verification pass; Apple confirms VALID and
  internal TestFlight availability. Physical-device acceptance remains separate.
  See [PR #731](../PRs/731-lopu-unified-scheduled-chats.md).
  — Codex (AI), 2026-09-10

- Add a loopback-only real HTTP acceptance smoke for linked Lopu chats,
  scheduled Things and relational comments, including account boundaries,
  pause/resume and owned-fixture cleanup. No provider or scheduler delivery is
  claimed by this smoke. — Codex (AI), 2026-09-10

- Pin the scheduled-task run schema projection in the builtin seeding
  regression gate; retain all five owner-editable run fields.
  See [PR #731](../PRs/731-lopu-unified-scheduled-chats.md).
  — Codex (AI), 2026-09-10

- Add native direct-voice transcript recovery and bounded shared-chat context
  behind bridge 1.3.0; reconcile transcription-only chat saves and expose native
  retry state without storing credentials. Simulator/provider/device gates are
  tracked in [PR 731](../PRs/731-lopu-unified-scheduled-chats.md).
  — Codex (AI), 2026-09-10

- Reconcile PR 731 with develop's authored/nested media inheritance without
  downgrading Lopu discussions or notification-test capabilities; retain both
  Things read and write compatibility coverage. — Codex (AI), 2026-09-10

- Persist direct web voice transcripts into their Lopu conversation with
  account-fenced recovery/retry; seed recent chat context when starting voice,
  isolate message caches by account, and discard late account-switch fetches.
  Live local API retries pass; native and real-provider acceptance remain
  pending. See [PR 731](../PRs/731-lopu-unified-scheduled-chats.md).
  — Codex (AI), 2026-09-10

- Add relational discussions to Thing details/previews and confirmation-bound
  Lopu comment tools; unify the text/voice page composer, add chat attachment
  selection, and introduce searchable scheduled tasks with separate run Things
  and Lopu-message notifications. Browser and end-to-end release checks remain
  separate from focused tests; see the [feature validation notes](../PRs/731-lopu-unified-scheduled-chats.md) before deployment.
  — Codex (AI), 2026-09-10

- Use cryptographic UUIDs for voice-session and transcript request identities,
  with regression coverage that refuses an insecure fallback. Reconcile the
  conditional-media write fix without downgrading Lopu capabilities; the
  combined Things contract is 1.8.2 (legacy 1.7.2).
  See [PR #731](../PRs/731-lopu-unified-scheduled-chats.md).
  — Codex (AI), 2026-09-10

- Promote shared-page recovery from PR 740 without unrelated develop changes.
  Temporary resolver failures offer Retry and retain same-viewer content;
  viewer, target and link-key changes isolate drafts and stale responses.
  See [validation and scope](../PRs/740-codex-shared-page-load-recovery.md).
  — Codex (AI), 2026-09-10

- Distinguish temporary shared-page resolve failures from unavailable pages.
  Offer Retry, retain same-viewer content on a failed refresh, and reset drafts
  before rendering under another viewer, target or link key. Keep optional site
  decoration resolves nullable. See [PR 740 validation and scope](../PRs/740-codex-shared-page-load-recovery.md).
  — Codex (AI), 2026-09-10

- Follow stored conditional media-property alternatives through shared root
  inheritance, including argument-backed src/poster/href and style records.
  Exclude condition metadata and bound discovery across all property visits;
  shared writers cannot smuggle unreadable uploads into inactive branches.
  Advance content capability to 1.6.1 and patch both Things write contracts.
  — Codex (AI), 2026-09-10

- Prepare the focused main promotion of shared HTML/contained media, stored
  component arguments and page-block overrides from PRs #730, #733 and #734.
  Preserve main's prior sharing/startup release and APNs/recording fixes;
  the application source matches #734, with separate main CI and preview
  validation required before release.
  [Main promotion #735](../PRs/735-codex-promote-shared-argument-media-main-promote-shared-html-and-component-argument-media-inheritance-to-main.md).
  — Codex (AI), 2026-09-10

- Include containing page-block argument overrides in same-author shared media
  inheritance, matching defaults → savedArgs → block args render precedence.
  Compare the same resolved dependencies before/after shared edits, reusing
  query results within validation; guessed private media remains forbidden.
  Advertise attachment-content 1.6.0 with patched Things write contracts.
  Foreign templates retain independent authority; full conditional coverage
  and independent protected-upload fork copies remain follow-ups.
  — Codex (AI), 2026-09-10

- Resolve stored component defaults and saved arguments in shared media
  positions with the canonical template resolver and one expansion budget.
  Preserve unknown runtime tokens and reject truncated candidate values;
  apply identical discovery to non-owner write validation. Publish
  attachment-content 1.5.0 and patch Things write contracts. Page-block
  argument overrides, full conditional-state coverage and independent
  protected-upload copies remain follow-ups. — Codex (AI), 2026-09-10

- Extend shared-root media inheritance to authored rich/raw HTML rendering
  positions and uploads bound directly to contained same-author Things.
  Share the browser tag/depth/node policy with bounded server discovery;
  retain foreign-owner, managed-purpose, revocation and non-owner writer
  guards. Advertise attachment-content 1.4.0 and patch the Things write
  contracts. Stored component arguments and independent protected-upload
  copies remain separate follow-up work.
  [PR 730 validation and scope](../PRs/730-codex-shared-nested-media-inheritance-inherit-shared-root-access-for-authored-html-and-contained-media.md).
  — Codex (AI), 2026-09-10

- Promote the shared CSS-media and early-startup recovery increment from
  develop PR #719, including the reviewed single media-grant predicate and
  unresolved-template preservation. Develop merge `5839533` is verified in
  signed-out Safari; the main promotion requires its own CI and deployment
  receipts. [Main promotion](../PRs/728-codex-promote-shared-media-boot-main-promote-shared-media-context-and-startup-recovery-to-main.md).
  — Codex (AI), 2026-09-10

- Fix APNs rejection of notification tests and long reminder IDs by hashing the collapse header to Apple’s 64-byte limit; expose the safe BadCollapseId diagnostic. — Codex (AI), 2026-09-10

- 2026-09-10: Recover older iPhone Lopu recordings into private Things with durable import receipts; fix notification bell toggling and refresh, reconnect native push from Settings, report APNs outcomes, and keep single/bulk push delivery alive through Vercel responses. Details: [PR 726](../PRs/726-ios-push-recording-import.md).

- Update the connections preview with released shared-index readers, writers and migrations while retaining relational external-post sources and private-subspace fences. Make stubbed outbound redirect tests independent of machine DNS. — Codex (AI), 2026-09-09

- Refresh the custom-audience promotion preview with released main's shared-index readers. Resolve equivalent ACL merge blocks and duplicate viewer fields, composer state, and modal rendering; retain main's unified audience controls and drawer layering. Database migration activation remains separate. — Codex (AI), 2026-09-09

- Refresh the standing promotion preview with released main's shared-index readers and poll writer before database index retirement; preserve the feature branch and keep migration activation separate. — Codex (AI), 2026-09-09

- Save new iOS Lopu voice recordings as owner-private playable audio Things,
  retaining on-device recovery files and an account-bound retry outbox.
  Completed recordings survive draft cleanup; upload/complete contracts are
  1.2.0 and native delivery is build 29.
  [Release and validation notes](../PRs/722-ios-voice-recording-things-save-ios-lopu-recordings-to-private-things.md).
  — Codex (AI), 2026-09-09

- Recover initial static-module download failures before the application entry
  can install its listeners. Preserve the shared URL, retry automatically at
  most once and provide an accessible manual fallback when recovery fails or
  session storage is unavailable. Keep existing rendered content untouched.
  Add desktop/mobile native-browser regressions and diagnostic bundled-client
  sharing coverage. [Validation and rollout](../PRs/719-codex-shared-render-media-context.md).
  — Codex (AI), 2026-09-09

- Shared CSS media now carries the root audience through page/block backgrounds,
  HTML styles and Chakra responsive/pseudo styles. A shared parser recognizes
  literal URL/image-set references without granting quoted text or external
  URLs; shared writers cannot insert unreadable private CSS media. Linked text
  downloads use the same context. Publish attachment-content 1.3.0 and require it
  before shared media renders. Rich HTML/argument dependency discovery and
  independent protected-upload copying remain separate follow-ups.
  Cover escaped CSS function identifiers (including hex-terminating whitespace)
  with a bounded argument scanner shared by discovery and rendering.
  Preserve recording-Thing support when integrating develop; publish the
  combined Things feature 1.7.1 / contract 1.6.1 without a version downgrade.
  [PR #719 validation and remaining browser gate](../PRs/719-codex-shared-render-media-context.md).
  — Codex (AI), 2026-09-09

- 2026-09-09: Reconcile Watch/Lopu automation with current develop and main: preserve durable notification history, verified vault controls, shared Settings tabs and iPhone voice recovery. Combine notification contracts as list 1.6.0/settings 1.5.0 and remove the obsolete history-trimming call from the reminder transaction. — Codex (AI)

- 2026-09-09: Recover expired Watch upload drafts without dropping local audio or falsely disconnecting the account; add explicit Send to Lopu handoffs, owner-private Thing/notification/reminder tools, and notification Settings test/pause controls. Compatible capability updates, isolated safety tests and iPhone/Watch + Vercel builds pass; hosted/browser/physical delivery gates remain separate. See [PR #665 notes](../PRs/665-codex-watch-lopu-recording-automation-private-transcripts-todos-reminders.md). — Codex (AI)

- 2026-09-09: Provision a distinct sensitive admin-vault key for the hosted develop custom environment in Vercel and document activation and credential-store boundaries. Production External integrations contains no saved policies; server OpenAI/Anthropic credentials already include develop. Saved Claude Code CI credentials still require an authenticated transfer or secure re-entry; no token values were exposed or rotated. — Codex (AI)

- 2026-09-09: Tie shared AI completions and recording-automation mutations to the protected account subscription: Free/current configured limits, Plus 5x, Pro/PAYG unlimited product request rates. Preserve account windows across tier/device changes and fail closed on entitlement outages. Live index cutover separately completed: production 47, develop 48 including Watch scheduler. Personal Claude Code synthetic text completion passed; cloud recording bridge remains pending. — Codex (AI)

- 2026-09-09: Bring the Watch preview onto the released staged index migrations and poll writer. Remove its competing startup-only poll-index retirement while preserving the recording scheduler index. Retire obsolete deployment URLs only after exact project, live alias and active-head checks; production/develop migration activation remains pending. — Codex (AI)

- 2026-09-08: Restore four-slot MongoDB index headroom by moving poll point reads/writes to protected Binary unique keys; validate/backfill legacy votes before retiring the home lookup index. A disposable MongoDB test proves 60 indexes, indexed lookups and duplicate protection. Poll contract/client minimum is 1.0.1. — Codex (AI)

- 2026-09-08: Reconcile PR #665 with released Desktop Node ownership and subspace notifications. Preserve both notification families, opt-in email defaults, and relational delete cascades; publish compatible notification list/settings contracts 1.4.0/1.3.0. — Codex (AI)

- 2026-09-08 — **Codex (AI):** Add a bounded local speech-to-text and personal Claude Code adapter; synthetic audio produced validated grounded todos without sending audio to Claude. Cloud job pairing remains pending. See [PR #665 notes](../PRs/665-codex-watch-lopu-recording-automation-private-transcripts-todos-reminders.md).

- 2026-09-08: Add the shared owner-scoped text AI endpoint and origin-negotiated client with explicit multi-endpoint credential waterfall, redacted routing traces and shared recording retry policy. Personal Claude Code runtime and local transcription integration remain release gates. See [PR #665](../PRs/665-codex-watch-lopu-recording-automation-private-transcripts-todos-reminders.md). — Codex (AI)

- 2026-09-07: Add explicit account-owned AI credential waterfalls for Watch recording transcription and analysis, including Claude API analysis, bounded failover, renewed consent checks, redacted connection choices and capability 1.1.0. Existing accounts keep their original provider selection. See [PR #665](../PRs/665-codex-watch-lopu-recording-automation-private-transcripts-todos-reminders.md). — Codex (AI)

- 2026-09-07: Use provider-neutral recording consent and status wording. Report safe, actionable recording failure categories for source/format, storage download, provider credentials/quota, transcription, analysis and saving. Live preview acceptance surfaced an immediate retry previously hidden behind one generic message. — Codex (AI)
- 2026-09-07: Bring recording automation up to date with the released Lopu/Builder/rich-text work and the verified production storage-ledger repair. See the [PR #665 verification note](../PRs/665-codex-watch-lopu-recording-automation-private-transcripts-todos-reminders.md). — Codex (AI)

- 2026-09-06: Integrate recording automation with the merged Watch foundation;
  send daily reminders through its native push channel after durable commit,
  preserving a bounded title and safe recordings link. — Codex (AI)

- 2026-09-06: Add opt-in private Watch recording transcription, relational
  transcript comments, grounded notes/todos, durable retry checkpoints and
  daily local-time reminders. Add account settings/activity at
  `/lopu/recordings`, explicit capability contracts and fork-safe scheduler /
  provider setup. Browser checks cover persisted settings and mobile layout;
  live audio and native push acceptance remain release gates. See the
  [PR #665 verification note](../PRs/665-codex-watch-lopu-recording-automation-private-transcripts-todos-reminders.md). — Codex (AI)
- Keep Commander's display-name prefix tier reachable for queries that span a space ("the lopu"), which previously matched no single split word and let a matching Thing title outrank the person. — Lopu (AI), 2026-09-09
- Prepare the focused main promotion of shared Data/schema controls after
  exact-head CI and logged-out Safari verification on PR #714. Preserve the
  separate unresolved initial-load and protected-media-copy limitations in the
  [delivery note](../PRs/714-codex-shared-schema-action-inheritance.md).
  — Codex (AI), 2026-09-09

- Include schema-template actions in shared-root dependency resolution and
  private copies. Data Thing detail controls use root-authorized read-only
  execution unless both the data and its schema are owned by the viewer;
  list/grid previews remain inert. Add API, copy, revocation and responsive
  browser regressions. Shared searches resolve included schema definitions
  without borrowing the author or visitor's private inventory (action contract
  1.2.1). Validation and remaining scope:
  [PR #714](../PRs/714-codex-shared-schema-action-inheritance.md).
  — Codex (AI), 2026-09-09

- 2026-09-09: Deliver native Lopu voice and its signed Live Activity extension
  in iOS build 27; older general bridges now show an update instruction.
  Repair iOS Lopu voice startup/stop races, preserve partial speech
  and local audio/transcript files, save ordinary voice turns in the selected
  chat, and surface separate Speech Recognition and Live Activity failures.
  Native voice now checks the selected origin's semantic API capabilities.
  [Release evidence and device checklist](../PRs/715-ios-lopu-voice-recovery-deliver-lopu-voice-recording-and-live-activities.md).

- Include schema-template actions in shared-root dependency resolution and
  private copies. Data Thing detail controls use root-authorized read-only
  execution unless both the data and its schema are owned by the viewer;
  list/grid previews remain inert. Add API, copy, revocation and responsive
  browser regressions. Shared searches resolve included schema definitions
  without borrowing the author or visitor's private inventory (action contract
  1.2.1). Validation and remaining scope:
  [PR #714](../PRs/714-codex-shared-schema-action-inheritance.md).
  — Codex (AI), 2026-09-09

- 2026-09-09: Shared pages resolve author-owned embedded components through the
  root audience, including anonymous link readers and custom groups; preserve
  standalone privacy and prevent shared editors adding unrelated private
  dependencies. Shared sources/controls now use a root-authorized read-only
  action mode, including child actions and explicit data dependencies. Added
  private independent composition copies with rewritten component/action
  references. Restore canonical hidden-key/group authorization for page/post
  media and forward shared keys only to first-party attachment content URLs.
  Extend private copying to ordinary standalone content, preserving extended
  content and independently copied schema definitions. Restore shared Data
  Thing rendering through root-authorized private schema reads, preserving
  standalone ACLs and refusing app-token namespace escapes.
  Carry the root context through explicitly embedded private media, persistent
  cache validation and audio downloads; retain independent foreign/profile
  access and prevent shared writers injecting private media references.
  Live target deployment and broader inheritance remain under
  active validation; see [PR #707](../PRs/707-shared-root-inheritance-read-only-app-use.md). — **Codex (AI)**

- Add fresh-password or user-verified passkey Show controls for CI, admin integration and personal Secure Vault credentials. Keep normal reads redacted, bind passkey challenges to a single session/item/origin, and clear displayed values after 30 seconds or leaving the tab. [PR #710 security and verification notes](../PRs/710-vault-verified-reveal-verified-vault-credentials.md). — Codex (AI), 2026-09-09

- Notification-history validation and rollout boundaries: [PR #705 notes](../PRs/705-codex-system-notification-history-save-system-events-and-retain-user-history.md).

- Save notification history independently of delivery preferences, retain records without the former 10,000-item trim, log all action runs and successful sign-ins, and persist shared Lopu messages with account-fenced retry deduplication and credential redaction. History uses stable pagination and preserves bounded full message text. — Codex (AI), 2026-09-09
- Share tabbed settings between the popup and dedicated page, with Profile as the default and category deep links. Keep Mac node recovery in Things settings and let healthy nodes hide the Things-page panel until a problem occurs. [PR 709 details](../PRs/709-codex-shared-settings-tabs-unify-settings-views.md). — Codex (AI), 2026-09-09

- Route both permission-settings actions through the shared Open App Locations flow, so Finder always shows the combined app shortcuts. — Codex (AI), 2026-09-09

- Keep App Locations working when a neighbouring app in Applications cannot be read, stop the bundle scan once every known app is found, and report a failed Node restart only when one was actually attempted. — Lopu, 2026-09-09

- Add Desktop permission recovery guidance, App Locations shortcuts to current installed apps, and a one-shot Node restart choice after returning from recovery. — Codex (AI), 2026-09-09

- Refresh the clipboard-attachment preview with released main's shared-index readers and poll writer, preserving its bounded paste queue and attachment permissions. Database migration activation remains separate. — Codex (AI), 2026-09-09

- Refresh the Commander intent-ranking preview with released main's shared-index readers and poll writer before database index retirement; retain its ranking changes without promoting them to production. — Codex (AI), 2026-09-09

- Refresh the saved Feature Stack workflow promotion preview with released main's shared-index readers and poll writer. The feature is already integrated upstream; keep the preview branch and database activation separate. — Codex (AI), 2026-09-09

- 2026-09-09: Refresh the notification-history preview with released main's staged shared-index readers and poll identity writer, preserving feature changes. Preview replacement and live production/develop index activation remain pending. — Codex (AI)

- Repair a poll writer found during the index audit: stamp the shared protected vote identity (no new index), preserve legacy lookup compatibility and unbilled engagement policy. Native regression reproduces 16 duplicate rows before the fix and checks concurrent votes, toggles, private access and cascade cleanup. — Codex (AI), 2026-09-08

- Extend [Thing index consolidation](../PRs/692-thing-index-consolidation-shared-plan-audit.md) to a 47-index candidate: canonical legacy/feed/search/embed readers, eight exact retirements, one shared updated-order index, and two-stage cache-drained migrations. Native MongoDB verifies 60 → 47 with bounded sampled plans and preserved ACL/CAS behavior. Production/develop rollout remains pending. — Codex (AI), 2026-09-08

- Prepare five relationship lookup families to share the existing protected unique-key index (54-index intended home plan). Keep legacy/custom reads until an explicit leased migration validates keys and activates the layout; cold requests do not backfill. Preserve identity and attachment permission guards. Native/live rollout remains pending; see [PR #692](../PRs/692-thing-index-consolidation-shared-plan-audit.md). — Codex (AI), 2026-09-08

- Fix index-usage statistics in the admin workbench by keeping MongoDB's metadata-only `$indexStats` stage first, while retaining protected-field and join safeguards. See [PR #692](../PRs/692-thing-index-consolidation-shared-plan-audit.md). — Codex (AI), 2026-09-08

- Begin [Thing index consolidation](../PRs/692-thing-index-consolidation-shared-plan-audit.md): inventory the executable plan, retire the unused emoji lookup while retaining protected uniqueness, and repair relationship-key backfills to preserve partial keys and terminate on duplicate batches. Production/develop migrations and the broader reduction remain in progress. — Codex (AI), 2026-09-08
- 2026-09-07: Desktop privacy status now refreshes while visible and on return from System Settings, exposes Check access, distinguishes unknown/stale results from macOS denial, and explains recovery for grants tied to an older signing identity.

- Add Desktop Node start/stop/restart controls with serialized lifecycle operations and a native Node About panel showing installed build metadata. — Codex (AI), 2026-09-07

- Desktop recovers its bundled node after plist rewrites, records the owning Desktop build, and starts or refreshes the node on launch when auto-start is enabled. — Codex (AI), 2026-09-07

- 2026-09-06: **Subspaces 🪐 round 2** — everything a subreddit needs to run:
  ownership transfer + owner-only delete (posts are released as plain posts;
  members/modlog/reports cascade), join requests for private subspaces and
  posting-approval requests for restricted ones (Requests mod tab), per-member
  user flairs with `authorFlair` on every post/comment projection, removal
  reasons + Chakra modals for remove/ban/report/transfer/delete (no browser
  prompts), post/comment reports with a Reports mod queue and `reportCount`,
  six `subspace-*` notification types (mod-team actor on the punitive pair),
  `GET /api/v1/things/feed?scope=subspaces`, directory sorts (new / members /
  active, rate-limited `subspaces.list`), an Explore "Popular subspaces" strip
  and a Search "Subspaces" section, per-card comment sort (top / new / old),
  guest nudges and a 375px layout pass. Live walk `remix/scripts/verify-subspaces.mjs`
  sections A–T: 486 passed. See the [PR note](../PRs/subspaces-communities-and-updown-votes.md). — Claude (AI)

- 2026-09-05: **Subspaces 🪐 + up/down votes 🔼** — Reddit-style communities as
  things: `subspace` (slug, branding, rules, flairs, access), relational
  `subspace-member` (role/approval/ban) and `subspace-modlog` docs, posts
  gaining `title`/`subspaceId`/`flairId` with a server-side posting gate and a
  root `subspaceMod` state (remove/approve/pin/lock/nsfw/spoiler, redaction for
  non-mods, feed fences incl. private subspaces), `/api/v1/subspaces*` (list/
  create, get, update, join, leave, members, moderate, modlog, feed with
  hot/new/top/rising/controversial), and `updown` — a separate focused vote kind
  (`POST /api/v1/things/updown`, one of up/down per user per post or comment,
  aggregated as `votes`) beside the untouched native emoji reactions. UI: `/s`,
  `/s/:slug`, `/s/:slug/mod`, the ▲ score ▼ pill on every post/comment card,
  subspace/title/flair in the composer, mod menu on cards, drawer entry,
  Settings → Subspaces. One new partial index (`things_subspace_posts`);
  contracts `api.things`, `api.things-feed`, `api.things-comment`,
  `api.things-user` bumped to 1.2.0. Live walk: `remix/scripts/verify-subspaces.mjs`.
  See the [PR note](../PRs/subspaces-communities-and-updown-votes.md). — Claude (AI)

- 2026-09-06: Lopu verified access + credits (client): a `tt-lopu-account-<uid>`
  store slice + `useLopuAccount` (refreshed on mount, after every `done` and
  slowly on focus), the invite-only locked state on `/lopu`, the floating
  window / sheet and voice mode (composer + mic disabled, navbar 🦄 and the
  drawer entry still open it), the composer's balance chip (amber under the
  admin threshold, red at zero with the top-up action, "your provider" for
  BYO), per-turn footer credits, 403/402 reply refusals as Lopu bubbles with
  the matching action, Settings → Lopu "Credits & usage" (balance, month,
  lifetime, cursor history, request form, Buy credits), the user settings
  modal mirror and Admin → Lopu accounts (verified toggle, balances, pending
  requests, add credits, `Thingtime.LopuAccess` editor). Design note:
  [`PRs/lopu-verified-credits-design.md`](../PRs/lopu-verified-credits-design.md). — Claude (AI)

- Fix production storage-ledger validation to accept the catalog's optional speed-test quota without coercion, subscription rewrites, or allowance resets; retain legacy snapshots and fail closed on malformed quotas. — Codex (AI), 2026-09-06

- 2026-09-06: Add bounded, value-free admin dry-run diagnostics for malformed protected storage ledgers; preserve fail-closed validation and all subscription allowances.

- 2026-09-06: Include #612's final detail-page review follow-up in the main
  release: reject inherited/unknown `from` parameters and keep the Back link
  functional. This completes the source revision beyond the initial #668 merge.

- 2026-09-06: Let rich-text style controls initialize in embedded browsers that
  omit `crypto.randomUUID`; use independent local registry IDs as a fallback.

- 2026-09-06: Combined Lopu, Builder and rich-text release validation is recorded
  in [PR #668 notes](../PRs/668-codex-lopu-builder-main-release-integrate-assistant-builder-rich-text.md).

- 2026-09-06: Integration browser checks fixed signed-out Watch approval
  rendering and Lopu composer clipping. Keep textarea padding inside its card;
  verify mobile/desktop nested previews and whole-code clipboard paste. — Codex (AI)

- 2026-09-06: Integrate component catalog #291, Builder suites #578 and live
  detail pages #612, Lopu assistant #592, and rich-text controls #635 alongside
  the Watch release. Preserve shared text/node expansion budgets and all
  account-cache logout cleanup; keep ActivityKit out of the Watch target while
  embedding both Watch and Lopu widget. Validation uses worktree ports
  17890/17891/17892 with automatic restart disabled. — Codex (AI)

- Make rich-text history controls small, muted absolute overlays near the bottom-right, without adding padding or changing content dimensions. Keep selected-text formatting above the line, reserving temporary space instead of falling below into the native iOS menu. — Codex (AI), 2026-09-06

- 2026-09-06: Share editor presentation across posts, replies, Thing fields, tiers and builder; reserve field history space and avoid neighbouring controls. See [PR #635 notes](../PRs/635-editor-rich-text-controls-complete-editorjs-rich-text-styling.md).

- 2026-09-05: Coordinate builder labels, history and selection controls using
  measured free space; adapt to narrow blocks, viewport/inspector edges and
  scrolling containers. Keep history reachable across hover gaps and fix
  builder frames intercepting Changes-dialog clicks. [PR #635 verification](../PRs/635-editor-rich-text-controls-complete-editorjs-rich-text-styling.md). — Codex (AI)

- 2026-09-05: Share full selected-text/block styling across Editor.js and builder
  editors: colour wheel, alpha, HEX/RGB(A)/HSL(A), highlights, decorations and
  custom font sizes/units. Preserve styles through builder HTML round trips and
  saved rendering; position the selection toolbar above text within the visual
  viewport. Add live previews with Save/Cancel, conversion style preferences,
  branching Undo/Redo and a Changes timeline, larger resizable panels, and
  floating controls that preserve the document width. [PR #635 verification](../PRs/635-editor-rich-text-controls-complete-editorjs-rich-text-styling.md). — Codex (AI)

- 2026-09-06: Fix the global Watch approval banner crashing signed-out first
  paint when both account IDs were absent; add account/expiry/dismissal
  regression coverage to the notification suite. — Codex (AI)

- 2026-09-06: Watch-to-main integration [PR #667](https://github.com/lopugit/thingtime/pull/667)
  passes native compilation, web build and focused tests. Align the Nitro health
  smoke with its documented migration-required response without calling a
  degraded deployment ready. — Codex (AI)

- Validation and rollout notes for account-tier speed-test allowances: [PR #664](../PRs/664-speed-test-tier-allowances-account-tier-speed-test-allowances-and-feature-comparison.md).

- 2026-09-06: Tie Commander speed-test allowances to protected account-tier
  quotas (Free 4/hour, Plus 20/hour, Pro/PAYG unlimited), add the live account
  feature comparison and admin quota controls, and preserve readings after a
  rejected retry. Versioned API capabilities prevent old-server fallback. — Codex (AI)

### 2026-09-05 — Native passkey entitlement — Codex (AI)

- Backport the production passkey cancellation, challenge replay and settings fixes to the Watch preview used by TestFlight. Build 25 adds `webcredentials:thingtime.com` while preserving the embedded Watch app and production push entitlements. Native credential acceptance still requires a real device. Details: [PR #656](../PRs/656-codex-passkey-ios-release-restore-native-passkeys-with-watch-companion.md).
- The web repair is released in PRs #641 and #651; the native build retains the existing PR #596 preview origin so Watch pairing continues using its compatible API.

### 2026-09-05 — Watch code-entry and pairing recovery — Codex (AI)

- Added four-digit, five-minute codes, `/pair/1234` links, and a phone/computer
  `/watch/pair` form. Paired-iPhone account handoff (default) and username targeting
  show a prefilled **Approve Watch** card in matching signed-in sessions; delivery
  never approves automatically. Older complete approval links still work.
  `api.watch-pairing` is now 1.2.0. Watch build 24 displays the
  exact address and retry/new-code controls without opening a watchOS web sheet.
- The approval PIN has evenly spaced squares backed by one accessible native
  input, preserving whole-code paste, autofill, selection and legacy-code support.
  Keep 1Password's saved-password badge off the final square without turning off
  native one-time-code autofill; fixture passwords are generated directly at runtime.
- Split claim-poll and human-code rate limits, recover from transient network
  errors, reserve unique active PINs, and reject unsupported origins before pairing. Added full HTTP flow
  coverage through direct notification sync; details in
  [PR #596](../PRs/596-codex-watch-app--add-native-apple-watch-notifications.md).

### 2026-09-05 — Direct Apple Watch accounts, sync, and private Things — Codex (AI)

- Replaced the Watch's iPhone-relay session dependency with direct HTTPS device
  pairing, capability negotiation, notification sync, read receipts, push
  registration, and idempotent private attachment Thing creation.
- Added on-Watch production/development account pairing, account switching,
  username/avatar identity, live connection health, last-check/last-reply
  timestamps, and a manual **Check & refresh** action.
- Added configurable **Add private Thing** favourites with **Record** enabled by
  default, retained Thingtime recordings, and direct retryable uploads.
- Apple Watches now appear in `/things` as devices with sync/battery/error
  health, a created-Thing count, and an owner-only recent-Things list.

### 2026-09-04 — Visible Watch account and live connection checks — Codex (AI)

- The Apple Watch connection card now shows the authenticated Thingtime
  username, live checking/connected/error state, last check and reply times,
  and an always-visible **Check & refresh** action.
- Notification pages now include a minimal viewer username projection for
  native account confirmation; the `api.notifications-list` capability is
  versioned at 1.2.0 for this additive response contract.

### 2026-09-04 — Watch origin migration and visible build diagnostics — Codex (AI)

- TestFlight builds now migrate a legacy persisted production selection to the
  build's configured Thingtime origin unless the user explicitly chose another
  destination, preventing the Watch from silently using an older API contract.
- The Watch connection UI now shows its own build, the paired iPhone build, and
  the active Thingtime origin, warns when companion builds differ, and reports
  the actual notification-history capability version when an origin is stale.

### 2026-09-04 — Resilient Watch pairing and saved-recording chooser — Codex (AI)

- Added acknowledged Watch-to-iPhone authentication refreshes with visible
  connection state, bounded automatic retries, durable unreachable-phone
  fallback, response timeouts, and manual retry actions across pairing,
  notification history, and attachment transfer screens.
- Added a dedicated **Choose saved recording** screen for Thingtime recordings
  retained on the Watch, and made Apple-recorder completion tolerate delayed
  file finalization so a successfully saved `.m4a` is not falsely rejected.

### 2026-09-04 — Apple-native Watch recordings and upload-later library — Codex (AI)

- Replaced the custom Watch recording controls with Apple's native high-quality
  recorder, retained saved `.m4a` recordings in Thingtime's on-watch library,
  added manual re-upload and swipe-to-delete actions, and added a persistent
  **Upload after saving** preference. Existing Apple Voice Memos remain isolated
  by watchOS and are directed to the synced iPhone Thingtime upload path.

### 2026-09-04 — Apple Watch notification history and offline archives — Codex (AI)

- Added stable opaque notification cursors, 10-at-a-time Watch inbox/history
  paging, one-date and inclusive date-range selection, and full-period offline
  archive downloads to the paired Watch. Historical transfers remain bounded
  by Thingtime's retained latest 500 notifications and fail closed when the
  selected origin lacks the `api.notifications-list` 1.1 capability.

### 2026-09-04 — Apple Watch private attachment Things — Codex (AI)

- Added an authenticated **Add private Thing** Watch flow for selecting up to
  five Photos-library screenshots/images or recording an audio clip. Files use
  a durable Watch-to-iPhone queue, capability-gated checksummed multipart upload,
  and owner-only Thing creation without copying the iPhone session to watchOS.

### 2026-09-04 — Watch-enabled TestFlight release path — Codex (AI)

- Added target-specific App Store profile mapping for the iPhone and embedded
  Watch apps, bumped the native build to `16`, and added an encrypted
  `macos-15`/Xcode 26.2 TestFlight workflow for release builds when a developer
  machine is running an incompatible beta macOS host. Apple accepted the
  signed iPhone app with its companion under `Watch/`; build 16 is valid and
  in internal beta testing.

### 2026-09-03 — Native Apple Watch notification companion — Codex (AI)

- Added a native watchOS 10 SwiftUI companion that pairs through the signed-in
  iPhone app, mirrors the notification inbox and unread count, marks rows read,
  and registers for watch alerts without copying a Thingtime credential.
- Added protected iPhone/watch APNs device registration, a versioned
  `api.notifications-devices` capability contract, token-based APNs delivery,
  invalid-token cleanup, configuration docs, and focused contract tests.
- 2026-09-05: Reconcile PR #592 with current develop, preserving Lopu widget support and passkey entitlements, both capability suites, all private logout caches, and both unit-test lists. Verify its exact-SHA preview and make preview delivery visible above collapsed PR comments. — Codex (AI)

- 2026-09-05: Fix Commander's emoji permission feedback widening the picker beyond its window, stop failed pastes changing ranking or the clipboard, and provide explicit Accessibility recovery for stale signing grants. [Investigation](../PRs/662-codex-commander-emoji-paste-recovery-picker-overflow.md). — Codex (AI)
- 2026-09-05: Align Lopu notifications with the desktop content area as the drawer opens, closes, or resizes; keep mobile messages readable. — Codex (AI)

- 2026-09-05: Add bounded persistent media caching with access revalidation,
  responsive low-resolution image previews, and cache controls in Settings.
  Preserve restorable non-secret AWS S3 and SES customizations under
  `configurations/`, with live observations separated from templates. See the
  [PR #650 note](../PRs/650-codex-persistent-media-cache-responsive-previews-and-aws-configurations.md).
  Main promotion: [PR #654](../PRs/654-codex-persistent-media-cache-main-production-promotion.md), explicitly authorized by the owner. — Codex (AI)

- 2026-09-05: Promote PR #611 notification history and placement settings to main, including drawer-relative toast alignment. — Codex (AI)

### 2026-09-05 — Re-land hidden 🕵️ links, the PAT GET bridge and custom audiences 🎭 — Claude (AI)

- PRs #413 and #431 merged into their stacked base branches a minute after that base (#411)
  had merged into develop, so the feature stack never reached develop or main. PR #613
  re-lands `origin/claude/hidden-links-get-bridge` on current develop; conflict
  resolutions and the 149-check `verify-pat-tokens.mjs` run are recorded in
  `PRs/613-claude-hidden-links-custom-audiences-reland--re-land-hidden-links-get-bridge-custom-audiences.md`.
- `scripts/verify-pat-tokens.mjs` now reads search/feed `posts` keyed by thing id
  (develop's shape) as well as the older array form.
- GET bridge `op=update` / `op=delete` now honour `expectedUpdatedAt`, the
  optimistic-concurrency guard `PATCH`/`DELETE /api/v1/things` already anchor into
  the write filter. The bridge was dropping it silently, so a caller asking for a
  compare-and-swap got an unguarded write and a 200 — which this branch makes
  reachable in earnest, since a custom audience can grant `tt:user/<name>/write`
  to other people and give one thing concurrent writers. — Lopu (AI)
- "Copy hidden link 🕵️" now appears for a custom audience 🎭 that picked the
  "+ secret link" baseline. The server mints, projects and honours `linkKey`
  off `acl.includes('tt:hidden')`, but `visibilityFromAcl` reports `custom`
  whenever `tt:custom` rides along, so the post menu's `visibility === 'hidden'`
  gate never fired for those things — the key existed and the owner already held
  it in their own payload, with no UI to reach it. The menu now derives the link
  from `post.linkKey`, which is already owner-only and hidden-only, and a new
  `hiddenLinkContract.test.ts` pins the derivation. — Lopu (AI)

### 2026-09-04 — Rich public link previews — Codex (AI)

- Shared public pages now publish route-aware Open Graph/Twitter metadata and
  colourful 1200×630 Thingtime PNG cards. Posts carry author/excerpt/context;
  image posts safely render up to four stored images as a collage; text,
  marketplace, structured Thingtime, poll, share, comment, reply, standalone
  image/video/audio/file, profile, Thing, published page, feed and public
  catalogue/docs variants each have their own preview treatment.
- Cards ship their own copy of Liberation Sans (SIL OFL 1.1, metric-compatible
  with Arial) embedded in the server bundle. The deployed Vercel Node runtime
  has no fonts installed, so the renderer previously drew every card's artwork
  and not one glyph; CI and dev machines have system fonts and looked fine. —
  Lopu (AI)
- Details in the PR note
  (`PRs/607-codex-rich-link-previews--rich-route-aware-thingtime-link-previews.md`).

- 2026-09-05: Correct Commander archive architecture and UI resource verification after Apple's successful notarization; add real macOS lipo and Vite output regression checks. [Release notes](../../PRs/648-commander-cloud-releases-publish-installable-signed-commander-builds-with-recovery-provenance.md).
- 2026-09-05: Repair passkey request cancellation across login, account switching and settings; isolate concurrent challenges and reject saved-cookie replay; add native Apple domain association support and account-scoped settings caches. Verified a signed iOS Release build and configured the matching public Apple application ID in Vercel; production code rollout and device acceptance remain pending. See `PRs/641-passkey-reliability-fix-passkey-cancellation-concurrent-challenges-and-native-app-association.md` for validation and rollout requirements.

- 2026-09-05: Repair native Commander speed tests with proxy-safe exact-byte
  validation, upload v2 chunks below Vercel's request limit, explicit capability
  negotiation, single-flight execution, and retained/labelled partial results.
  Latency refreshes no longer erase throughput readings. See the
  [main release note](../PRs/657-codex-commander-main-fixes-search-and-network-repairs.md). — Codex (AI)

- 2026-09-05: Keep native Commander search catalogues complete, reuse fresh saved
  indexes, improve matching app-name ranking, and add the pin menu's new-window
  default toggle. See the [PR #652 verification note](../PRs/652-codex-commander-app-name-ranking-complete-search-catalogues-and-pin-toggle.md). — Codex (AI)

- 2026-09-05: Repair Commander GitHub release packaging, preserve build/commit metadata in Recovery, and keep build-only checks from stopping the installed Commander app.

- 2026-09-05: Fix the signed Electron builder's certificate selector: give
  electron-builder the unprefixed name while preserving the exact Developer ID
  identity for native code signing. — Codex (AI)

- 2026-09-05: Add Recovery release cards, readable cached build IDs, and an app
  selector with isolated Commander recovery. Pass cloud build numbers into
  Electron and reuse the approved CI Apple API key for macOS notarization.
  Remove the confirmed damaged legacy downloads. — Codex (AI)

- 2026-09-05: Repair Recovery catalogue refresh and architecture selection,
  malformed archive handling, background verification, damaged app replacement,
  rollback preservation, installer failure notices, and cold cloud packaging.
  Share the protected main/PR release builder and correct its caller-event gate
  so desktop and Recovery publish together. Withdraw damaged legacy archives
  from installation while keeping their history visible. See the
  [PR #627 engineering note](../PRs/627-codex-recovery-release-sync-github-catalogue-and-installer.md). — Codex (AI)

- 2026-09-05: Publish Graphify lock ownership atomically and remove only the
  releasing owner's record. Concurrent queries retain their snapshot lock
  through completion; regression tests cover stale cleanup, writer death,
  contention, malformed ownership, and timeout cleanup. — Codex (AI)

### 2026-09-04 — Lopu direct voice + reconciled provider models (PR #592) — Claude (AI)

- Reconciles the concurrent Codex "per-chat models" / "direct voice" commits
  with the wave-2 assistant: the unified architecture stays, their
  capability is ported. Details in the PR note
  (`PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md` §6) and
  `TESTING.md` ("Lopu voice + personal Secure Vault").
- **Direct voice** (opt-in, `settings.lopu.directVoice` + `directVoiceModel`,
  mirrored in Settings → Lopu 🦄): when the chat's Secure Vault provider's
  kind lists a realtime model (xAI Grok Voice), the mic streams 24 kHz PCM
  straight to the provider's realtime WebSocket (`lopuVoiceRealtime.ts`) on
  a five-minute credential from the new `POST /api/v1/lopu/voice/session`
  (`api.lopu-voice-session` 1.0.0: session-only, 403 for guests, JSON-only,
  the `lopu.voiceReply` bucket; the stored key never leaves the server, a
  minted secret that echoes it is refused); the gear's switch explains in one
  line when a provider cannot do it and the standard path runs. The iOS
  controller's provider-audio mode (`inputMode`, `model`, `effort`, `speed`
  on `lopu-voice-start`; `lopu-voice-realtime-user` /
  `lopu-voice-realtime-assistant-start` back) is wired into `useLopuVoice`.
- **Provider models**: templates gain per-kind catalogs (`models[]` with
  efforts, speeds, `audioInput: 'realtime'`) and four more kinds (Mistral,
  DeepSeek, Groq, Cohere); a connection's `model` is optional again (the
  Secure Vault form offers the catalog or a custom id) and a row without one
  runs on its kind's first catalog model — one rule (`resolveVaultTurnModel`:
  own → kind default → requested) for the chat client config, the voice turn
  and `GET /api/v1/ai/models` (`vaultProviders[].model`, plus
  `realtimeModels`; `api.ai-models` 1.3.0). The voice turn accepts optional
  `model` / `effort` / `speed` mapped onto each vendor's fields
  (`api.lopu-voice-reply` 1.1.0, `api.lopu-vault` 1.1.0).
- Coverage: `voice.test.ts` rewritten against the shared client (per-kind
  request bodies, the model rule, the credential exchange, the session),
  `vaultProviders` / `lopuProviderCore` / `useLopuSettings` unit tests, three
  `apiTests` session entries, `verify-lopu.mjs` §A + §K session walls.

### 2026-09-04 — Lopu wave 2 hardening: server-verified confirmations, JSON fences, deterministic provider choice (PR #592) — Claude (AI)

- Adversarial-review fixes; details in the PR note
  (`PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md` §0, §1.3,
  §2.3, §2.4 "Confirmations", §2.6) and `TESTING.md` ("Lopu AI assistant").
- **Destructive tools wait for the user** (was: gated by a model-asserted
  `confirmed` flag that prompt injection through tool results / page blocks
  could set): `delete_thing`, `update_thing` with `replaceCrystal`, and
  `run_action` on a program that deletes things now stop with a `confirm`
  event carrying a server-signed grant (purpose JWT bound to user + chat +
  action key, 15 min) and `tool_result.needsConfirmation`; the tool card's
  Confirm sends the grant back once as `confirmations: [{ key, token }]`,
  the route verifies it (400 otherwise) and the executor spends it once per
  turn. The stable prompt gains the "Untrusted content" rule and the page
  blocks arrive fenced. The "Confirm deletes" preference is renamed to what it
  gates (deleting a conversation from the list).
- `/api/v1/lopu/chats/reply` (1.2.0), `/voice/reply` and `/vault` (1.0.1)
  apply the JSON-only CSRF fence (415) before reading the body or spending a
  bucket; voice/vault refuse a temporary session (403); the chat write buckets
  (create/update 1.1.1, delete 1.0.1) fail closed. Capability pins updated.
- The client states `providerId` explicitly (`null` included) whenever it
  knows the chat's settings, so a refused `/update` or a de-listed provider can
  never route a turn behind the picker's back; the window's header chip reads
  the per-chat store settings and lists "Your providers".
- A chat whose stored effort/speed is `null` inherits the admin defaults
  (was: the provider's own default); `'vault'` rows persist `providerLabel`;
  a first turn that fails to persist discards the chat it just created; the
  bubble link guard rejects `/\host` (browsers read `\` as `/`), NAT64
  `64:ff9b::/96` is blocked, the vault's "custom endpoint" template starts
  blank, persisted message bubbles are memoised.
- Coverage: `chatTools`/`confirmations`/`chatPrompt`/`chat.streaming`/
  `lopuTurnCore`/`lopuChatStore`/`userVaultCore`/`lopuChats` unit tests,
  6 new `apiTests` lopu entries, `verify-lopu.mjs` §A fences + §H2
  confirmations (delete_thing + a deleting `run_action` through the scripted
  provider's new `purge` script).

### 2026-09-04 — Lopu wave 2: voice in the chat page, your own providers, design pass, navbar 🦄 (PR #592) — Claude (AI)

- Grouped summary; details in the PR note
  (`PRs/592-claude-lopu-ai-chatbot-358029--lopu-ai-assistant.md`, §1.3 own
  providers, §3.2 surfaces, §6 voice + Secure Vault — the Codex voice note is
  folded in there) and the checklist in `TESTING.md` ("Lopu AI assistant").
- **Voice unified into the Lopu page**: `/lopu` | `/lopu/voice` is a
  route-driven Chat | Voice switch on one `LopuPage`; `useLopuVoice`
  (`LopuVoiceControls.tsx`) owns SpeechRecognition / the iOS bridge /
  speechSynthesis and the feedback-loop guard, every final utterance is a
  normal chat turn (tools included, the chat's model or provider), Transcribe
  mode keeps `/api/v1/lopu/voice/reply` and its quotes render inside the
  conversation list; settings `spokenReplies` / `transcribe` / `providerId`
  are mirrored in Settings → Lopu 🦄 and the user-settings modal.
- **Your own providers**: `GET /api/v1/ai/models` returns redacted
  `vaultProviders` + `vault.configured` for a session; chats carry
  `lopu.providerId` (create / update / list) and `POST /api/v1/lopu/chats/reply`
  runs a pinned turn on the caller's Secure Vault connection (Anthropic path
  or the OpenAI-compatible path with native tools / the fenced `tt-tool`
  protocol) through the shared SSRF fence in `lopu/vaultProviderClient.ts`,
  which `voice.ts` now delegates to; meta `provider: "vault"` +
  `providerLabel`; the server keys are never a fallback. Capability bumps
  `ai-models` 1.2.0, `admin-ai-models` / `settings-lopu-chat-defaults` /
  `lopu-chats` / `lopu-chats-update` / `lopu-chats-reply` 1.1.0 are now
  published through `contractVersion` (what `/api/v1/capabilities` reads)
  as well as `featureVersion`, pinned in both manifest tests.
- **Design pass** (`lopuTheme.ts` tokens only, light + dark): one calm
  neutral surface with a single restrained rainbow (ring, caret, send/mic),
  18px bubbles, 760px centred column, 272px conversations sidebar, mobile
  full-screen with the composer above the safe area, compact floating window,
  markdown code copy button, aria-live streaming bubble, model picker grouped
  Claude / OpenAI / Your providers with unavailable reasons and a "Manage your
  providers" footer.
- **Navbar 🦄** (`LopuNavButton`, beside ⌘K, hidden on `/lopu*`) toggles the
  restyled floating window (avatar/status header, mic, model chip, open-full,
  minimise, close; launcher ring; mobile sheet); Drawer → Lopu gains Voice and
  Secure Vault (`/settings#secure-vault`) children.
- Integration pass fixes: the site "Edit page" pill hides on `/lopu/*`
  (`SiteBlocksHost`), the conversations sidebar clears it, the effort control
  wraps for OpenAI's seven tiers (labels for `none` / `minimal` / `ultra`),
  the picker opens on the current choice, persisted rows show the catalog
  label, previews strip markdown, and voice transcript rows sit inside the
  conversation list (`LopuChatView` `trailing`).
- Live verification: `node scripts/verify-lopu.mjs <base>` (147 checks incl. the
  vault-unconfigured path; the BYO turn needs `THINGTIME_USER_VAULT_KEY` and
  `THINGTIME_LOPU_PROVIDER_DEV_REWRITES`, README "Lopu AI assistant").

### 2026-09-05 — Marketing suite locked behind an admin publish gate — Claude (AI)

- Grouped summary; details in the PR note (`PRs/638-claude-marketing-pages-admin-guard--marketing-publish-gate.md`).
- Everything under `/marketing` (hub, category indexes, the 1,600+ generated
  pages, their sections, the social-image suite and each feature's image set)
  is now admin-only until an admin publishes it, one key at a time
  (`remix/app/marketing/publishingCore.ts` + `publishing.ts`; model in
  `docs/marketing-suite.md` → Publishing). Nothing cascades: an index lists
  whatever is published beneath it; sections can be hidden inside a published
  page.
- Visitors get a `noindex` "Not published yet" card (never a redirect); every
  in-suite link, crumb, count, footer link, drawer entry and search result
  follows the viewer's visibility. Unknown state fails closed.
- State is one `settings` singleton (`marketing-publications`), read by
  `GET /api/v1/marketing/publications` and written by the admin-only
  `GET|POST /api/v1/admin/marketing/publications` (≤ 2,000 catalog-validated
  changes per atomic write, fail-closed rate limit); both documented and
  published through `/api/v1/capabilities` at 1.0.0.
- Controls: an admin bar under the sub-nav on every marketing page (publish
  this surface, bulk over its children, 👁️ View as visitor, Manage all →),
  🌐/🔒 chips on cards and social menu rows, hide/show frames on page sections,
  and a new `/admin/marketing` tab for whole-suite sweeps.
- Tests: `test:marketing` now also covers the publishing core, the store and
  the API route folders; `test:api-capabilities` pins the two new contracts.

- 2026-09-03: Keep `/api/v1/capabilities` aligned with the protected admin preview dispatcher by publishing `api.admin-ci-previews` 2.0.0 from the canonical endpoint contract.

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

### 2026-09-03 — Multi-environment PR preview links — Codex (AI)

- Admin-selected Develop and Production/Main preview settings now dispatch only
  their bounded full policy to the protected `github-actions` controller; the
  product backend no longer creates, aliases, deletes, or comments on Vercel
  deployments. GitHub Actions maintains one PR comment, posted before build
  launch with every
  selected environment's expected persistent URL and estimated ready time, then
  updated with each immutable snapshot URL and final status. READY receipts move
  only the matching alias to the verified current deployment, while
  disable/close cleanup remains bounded to Thingtime-owned preview resources.
  Each exact-SHA environment build runs without deployment credentials and only
  its validated prebuilt artifact reaches the protected publisher.
  See the [PR #597 engineering note](../PRs/597-codex-preview-pr-environment-links-publish-multi-environment-preview-links-on-prs.md).

### 2026-09-03 — Storage migration readiness and API sweep correction — Codex (AI)

- Detailed diagnosis, migration receipts, and validation:
  [`PRs/601-codex-fix-image-upload-migrations--storage-migration-readiness.md`](../PRs/601-codex-fix-image-upload-migrations--storage-migration-readiness.md).
- Nitro health now reports `degraded` and names
  `backfill-user-storage-accounting` whenever current user ledgers are absent,
  malformed, non-ready, or behind `USER_STORAGE_ACCOUNTING_VERSION`, making
  the same fail-closed condition that blocks image uploads visible to deploy
  monitoring before users encounter it.
- Corrected the email-config API docs and live test contract: sanitized email
  diagnostics remain available in local development and Vercel previews, while
  production's intentional 403 environment gate is now documented and tested.

### 2026-09-03 — Host-native Thingtime login bootstrap — Codex (AI)

- `@Thingtime login` is now callable before authentication and returns its
  OAuth challenge as a successful MCP tool response, allowing the invoking
  ChatGPT/Codex task to own PKCE, browser launch, callback, and subsequent
  authenticated requests without a separate CLI transport.
- Account and data tools remain OAuth-only and continue to fail closed at the
  HTTP authorization boundary.

### 2026-09-02 — CI telemetry satellite + things index storage reclaim (PR #583) — Claude (AI)

- Grouped summary; details in the PR note
  (`PRs/583-claude-thingtime-mongodb-index-storage-dffe19--ci-control-satellite-index-storage.md`)
  and the audit report (`docs/architecture/mongodb-index-storage-audit.md`).
- **Production audit**: `things_v2` was 1.82 M docs / 3.15 GB of index at the
  64-index cap, 99.75 % of it `ci-*` webhook telemetry with no retention.
- **New `ciControl` satellite collection** (`ciControl_v1`) for every `ci-*`
  Thing, six-index plan, TTL retention on root `expiresAt`
  (`THINGTIME_CI_{EVENT,JOB,ACTIVITY}_RETENTION_DAYS`, defaults 14/30/90,
  `0` = forever); the repository row records events only on real transitions.
- **`things` index plan**: seven dead/moved indexes retired at boot, `kind_*`
  and the sandbox TTL made partial, cap-safe swaps, leftover rebuild twins
  pruned.
- **Admin migrations** `relocate-ci-control-telemetry` and
  `rebuild-things-indexes`; `/migrations` shows a per-collection storage
  census (`api.admin-migrations` 1.1.0); `ciControl` queryable in the
  workbench (`api.mongodb-raw-results` 1.1.0).
- **Deployment note**: after deploying, run the two migrations from
  `/migrations` (dry run, then confirm) to move existing rows and reclaim the
  index files; boot alone only frees the retired indexes.


### 2026-09-01 — Builder round 8: saved-media lifecycle + 17-finding review batch — Claude (AI)

- Grouped summary; details in the PR note (`PRs/485-…`, round 8).
- **Saved pages own their media now**: webpage saves bind the owner's
  referenced builder uploads to the page thing (`webpageAttachments.ts`,
  wired into things create + PATCH), so the draft reaper stops eating media
  off saved pages and a public `/p/` page serves its images anonymously via
  acl inherit. A live-preview E2E caught TWO buried blockers: the id capture
  truncated real 68-char attachment ids (`{8,64}` → `{8,128}`), and the
  content endpoint's target authorization only recognized post targets —
  `attachmentAccess.ts` now accepts exactly-`['webpage']` targets alongside
  exactly-`['post']`, still failing closed otherwise. Verified end-to-end on
  the preview: drop-upload → public save → bind stamped → anonymous 200.
- **Adversarial review batch (49 agents, 16 confirmed findings fixed)**:
  edit/view WYSIWYG parity (root gaps, placeholder leaks, edit-only border
  radius), inspector typography actually reaching text, rendered-seam drag
  convention (downward off-by-one), acl-preserving public toggle +
  `expectedUpdatedAt` concurrency on saves, foreign-page fork fallback,
  touch access to the full block menu (⋯ chip) + 28px coarse hit bands,
  authored-html `data-tt-*`/`on*` scrubbing, per-account view caches, and
  a confirm before discarding unsaved edits.
- **Mobile edit mode**: the drawer starts closed under 768px (selecting a
  block still opens it) and the 🌐 hint text hides on phones.

### 2026-09-01 — Builder round 6: true-WYSIWYG canvas, inline Editor.js, wrap-with-block — Claude (AI)

- Grouped summary; details in the PR note (`PRs/485-…`, round 6).
- **Rendered rich-text typography**: Chakra's reset made sanitised
  h1-h6/lists/quotes/tables render as plain body text — `RichHtmlView` +
  `richHtmlStyles.ts` restore a real document scale (heading sizes match the
  Editor.js editing scale) and memoise the parse.
- **Inline Editor.js**: selected text blocks edit in place with the FULL
  Editor.js block editor; the modal stays as the "advanced" surface (drawer
  button + new right-click menu, shared `RichTextModal`). The old
  contentEditable inline editor was retired.
- **Block context menu + wrap-with-block**: right-click any frame (or the
  chip's ⊞) for Advanced editor / Wrap with block (searchable drill-down;
  containers are the only block kind with a children slot) / Duplicate /
  move / delete. New pure ops `wrapBlock` + `duplicateBlock` (tested).
- **True-WYSIWYG edit canvas**: insert affordances became absolute overlay
  edge strips — edit-mode geometry is pixel-identical to view mode
  (measured across the mode toggle). The 🌐 Global label floats in the nav
  breathing band; the region separator is a zero-height overlay; the
  trailing add affordance is a spacious dashed well.
- **Input UX**: numeric clamps commit on blur/Enter (typing "300" no longer
  snaps to the minimum at "3"); sides/corners inputs stop trimming per
  keystroke.

### 2026-08-31 — Builder round 5: media drop/paste everywhere, Figma-parity controls, resizable drawer — Claude (AI)

- Grouped summary; details in the PR note (`PRs/485-…`, round 5).
- **Media lands anywhere**: dropping a file ONTO any block frame uploads it
  (media blocks swap their src in place, containers take it inside, others
  get it inserted after); window-level edit-mode guards stop the browser
  from opening dropped files — unhandled drops append to the page;
  ⌘/Ctrl+V of clipboard files uploads at the selected block (text paste is
  never hijacked). Media inspector gains ⬆️ Upload file + URL input.
- **Figma-parity inspector controls** (`FigmaControls.tsx` + pure
  `figmaControlValues.ts`, node-tested): padding/margin with uniform ▢ /
  linked-axes ⬍⬌ / independent-sides ⛶ modes, per-corner radius, border
  (style/width/color) and shadow (X/Y/blur/spread/color) composers,
  segmented text-align — all writing css shorthands into the bounded
  per-block css record. Min width/height fields added.
- **Alignment actually visible**: aligned blocks shrink to fit-content and
  use justify-self in grid cells (align-self alone was invisible on
  100%-wide blocks and wrong-axis in grids).
- **Editor.js rich editing**: 📝 Rich editor modal on text blocks — full
  Editor.js block vocabulary, converted doc↔html (`editorJsHtml.ts`);
  rendered html still passes only through the sanitising allowlist
  renderer. Component blocks: double-click any rendered text to edit the
  matching arg in an inline popover.
- **Drawer**: drag-resizable via the left edge (persisted width shared with
  the canvas padding); paired fields wrap instead of crushing selects
  ("imag/e" cutoff fixed); placeholders muted; inline editor no longer
  draws a second outline inside the selected frame.

### 2026-08-31 — Builder round 4: Figma-layer styling, WYSIWYG, layout fixes — Claude (AI)

- Grouped summary; full detail in the PR note
  (`PRs/485-thingtime-design-system-01d6ee-design-system-builder.md`, PR #485
  round 4).
- **Layout/selection fixes**: nested blocks are clickable (innermost frame
  wins the capture-phase click, ancestors no longer steal selection); grid
  containers place children in cells correctly (insert zones no longer occupy
  grid cells — side-by-side blocks work; trailing add-tile cell instead); row
  children share the line via flex sizing; global strip gets breathing room
  below the nav and the edit canvas paints the surface wash (no white body
  bar between regions).
- **Figma-layer styling**: every block carries a bounded `css` record edited
  through inspector Layout/Appearance/Typography panels + a raw Custom CSS
  editor; text blocks gain tag overrides + rich `html`; new `media` and
  `html` block types; OS file drops upload via the attachments API into
  media blocks. Server gate: `sanitizeWebpageBlock` bounds css keys/values
  and blocks `expression()`/`@import`/`javascript:`/non-https `url()`;
  coverage in `app/schemas/webpageBlockGate.test.ts`.
- **Inline WYSIWYG**: selected text blocks edit in place (contentEditable,
  Enter/Shift+Enter soft breaks, rich paste, floating B/I/U/S/link toolbar);
  rendered rich text passes only through the sanitising allowlist renderer
  (`htmlToNode` + `HtmlThingRenderer`, which gained the pure formatting tags
  b/i/u/s/mark/sub/sup).
- **Stale-chunk self-heal**: after each preview alias flip, already-open tabs
  died on "Failed to fetch dynamically imported module" (old HTML → replaced
  hashed chunks). `entry.client` (vite:preloadError) and `lazyRoute` now
  recover with one session-guarded hard reload.
- **Component catalog seeded**: the 2800-component catalog
  (lopugit/thingtime-components) now lives in the dev DB behind
  `*.previews.dev.thingtime.com` via `POST /api/v1/admin/components/seed`
  (census 2800) — the builder's component search returns real results.

### 2026-08-30 — Design system alignment + block-based site builder — Claude (AI)

- Grouped summary; full detail in the PR note
  (`PRs/485-thingtime-design-system-01d6ee-design-system-builder.md`, PR #485).
- **Design system**: new shared `PageShell`/`PageHeader` primitives
  (`remix/app/components/Layout/PageShell.tsx`) extracted from the canonical
  hand-copied idiom; every off-system page aligned (status, mongodb-status,
  tests, vercel, crypto, migrations, apps, raw, ode, reset-password,
  catch-all shell, admin dashboard + TierManager/IntegrationManager/
  ModerationTab/AdminPanel/CIControlDashboard) plus a token nit sweep.
  `/docs/design-system` gains foundations/page-scaffold/brutal-button/
  builder-blocks entries; `/design-system` redirects there.
- **Builder**: new `webpage` thing kind (bounded block tree, sanitized in the
  registry write gate), `GET /api/v1/webpages/resolve`, admin
  `POST /api/v1/admin/webpages/seed` (26 site docs + site-global), `/builder`
  canvas (hover boundaries, inline + add-block menu with Mongo-backed
  component search, drag/drop, right-side inspector drawer), `/p/:id`
  published pages, and site-wide ✏️ edit mode with viewer-owned
  personalisation forks + memoised global blocks.
- **Round 3 (limitless builder)**: builder mode is full-bleed on every page
  (dual-region 🌐 global + page editing, one drawer, collapsible), touch UX is
  Squarespace-grade (44px zones, dropwells, bottom-sheet insert menu, chrome
  unselectable), and built-in pages decompose into PIXEL-IDENTICAL native
  sections via the new registry (`components/Builder/nativeSections.tsx`):
  status, home landing, welcome, ode, mongodb-status so far — the route, the
  seed table, and the builder all share one section list.
- **Catalog eviction**: the components-db catalog + pipeline moved to the
  public repo <https://github.com/lopugit/thingtime-components> (2800
  components); this repo ships only the runtime — components live in MongoDB
  and the frontend fetches them via `/api/v1/components/browse`.
- Local runbook: seed site pages with an admin session via
  `POST /api/v1/admin/webpages/seed`; smoke with
  `node remix/scripts/verify-webpages.mjs http://127.0.0.1:<nitro-port>`.

### 2026-09-01 — ChatGPT OAuth production credential vault

- Production ChatGPT connector credentials now use a dedicated sensitive Vercel
  encryption key, allowing the OAuth connection screen to create and retain
  independently encrypted multi-account credentials. — Codex (AI), 2026-09-01
### 2026-09-01 — Self-draining moderation safety sweep

- A successful full moderation sweep batch now immediately starts a durable
  continuation run. Each run remains bounded to 25 text posts and 10
  attachments; only failures stop that surface's chain, leaving the hourly
  Vercel Cron as the safe retry path. — Codex (AI), 2026-09-01

### 2026-09-01 — Production search server-bundle repair

- `/api/v1/things/search` now statically bundles its emoji-name metadata
  instead of leaving an untraced runtime JSON lookup in the Vercel function.
  The Vercel output verifier now fails the build if this missing-dependency
  class returns, and the `api.things-search` capability advances to `1.1.1`.
  — Codex (AI), 2026-09-01

### 2026-08-31 — Bounded Graphify snapshot retention

- Graphify now retains one active portable snapshot by default after successful
  update, extract, cluster, and ensure runs, with fail-closed retention
  overrides and an explicit prune command. The semantic content-addressed cache
  remains reusable, while older snapshots stay recoverable from Git history.
  — Codex (AI), 2026-08-31

### Added

- **NSFW/TOS media moderation pipeline**: uploaded images are analyzed
  asynchronously after `complete` (provider-pluggable: Claude API vision via
  `THINGTIME_MODERATION_PROVIDER=claude`, deterministic `test` provider, or
  `off`), stamping a protected `moderation` root field on the attachment
  thing. NSFW media renders behind a heavy blur + red wash with a centered
  NSFW badge and "Show Anyway" reveal; TOS/illegal verdicts quarantine the
  media (dropped from public payloads, content route 404s for non-admins)
  and log a `moderationFlag` thing. New `/admin` → Moderation tab reviews
  flags (Clear/NSFW/Block overrides, audit-stamped) and runs a bounded
  analysis sweep via `GET/POST /api/v1/admin/moderation`. See the
  [PR #308 implementation notes](../PRs/308-claude-nsfw-tos-media-moderation--nsfw-tos-media-moderation-pipeline.md).
  — Claude (AI), 2026-08-18

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

<!--

- 2026-09-16: Account invites default to Never expire, offer an expiry dropdown and owner-only show/copy links, with explicit replacement for older hash-only links. Worktree validation uses localhost:17360; Funnel unavailable because the installed Tailscale CLI target is missing.

## [1.0.0] - YYYY-MM-DD
Move entries up from [Unreleased] when cutting a tagged release.
-->
