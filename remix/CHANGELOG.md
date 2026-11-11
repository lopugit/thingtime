# Changelog

All notable changes to the **Thingtime web app** are recorded here. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with
assistant and manual changes attributed so future PR archaeology is less cursed.

**Author legend** — every entry is attributed:

- **Codex (AI)** — change made by the Codex AI assistant.
- **Claude (AI)** — change made by the Claude AI assistant.
- **Lopu** — change made manually by the developer.

> When you make a manual change, add a bullet under `[Unreleased]` ending with

- 2026-11-07: Wake indexed native sync feeds when their durable consumer drains,
  keeping live 25-second change reads during uploads instead of repeated
  two-second polling. Retain fresh admission, cancellation and native revision
  finish checks; installed startup timing remains a separate gate. **Codex (AI)**

- 2026-11-06: Defer already queued two-replica folder hints before expensive
  initial point reads. Preserve sequential journal processing, fresh effect
  policy and strict reconciliation; measure first-file startup and queued-peer
  effectiveness in the canonical mixed recovery fixture. **Codex (AI)**

- 2026-11-06: Avoid repeated point reads for exact opposite-feed folder echoes
  already proven to need no early copy. Keep fresh policy/effect checks, bounded
  observation memory and independent strict reconciliation. **Codex (AI)**

- 2026-11-06: Add an explicit canonical desktop-worker lane to mixed-file sync
  acceptance, preserving legacy fallback coverage, exact real-byte/restart
  checks and uncached native admission/HTTP timing. **Codex (AI)**

- 2026-11-06: Negotiate compatible minimum API versions in the disposable native
  paged-sync acceptance runner, retaining exact-origin and missing/breaking
  capability refusals before registration; record first body-byte timing, exact
  payload lengths and checkpoint/hash evidence without consuming request data. **Codex (AI)**

- 2026-11-06: Retain ordinary backup content with the versioned streaming v2
  codec while preserving v1 bytes/readers; verify deep/wide content, scalars beyond
  the legacy 128 MiB processing budget, immutable retries and independent source
  loss through worker tests and disposable production handlers. Whole-account
  coverage and destination acceptance remain gated. **Codex (AI)**

- 2026-11-06: Keep Add connection available while other sync drafts exist;
  preserve separate new/saved drafts and incomplete resource inputs through
  switching and reload, with compatible single-draft migration. **Codex (AI)**

- 2026-11-06: Builder app cards open their declared saved Thing entry point through independent read checks; explicit Browse/Edit remains, and kind/search/view changes retain the current app scope.

- 2026-11-04: Add Linux/Windows scoped desktop password delivery with a private agent CLI, OS-encrypted retry state, exact-origin catalog metadata (`api.passwords` 1.7.0), and the existing editable per-entry approval policy. Preserve the macOS Apple provider; system-wide autofill, passkey export and first-sign-in handoff are not advertised. See [implementation and acceptance](../PRs/1328-codex-native-autofill-linux-windows-add-scoped-native-password-delivery.md). **Codex (AI)**

- 2026-11-03: Resolve social OAuth apps from exact-origin/environment encrypted platform-vault entries; isolate encrypted multi-account grants per owner and fence callback replay, client changes and refresh/disconnect races. Preserve existing connection UI and legacy link IDs on reconnect. Real provider/deployed acceptance remains separate.

- 2026-10-29: Documented and verified popup-free native sync fixture acceptance, with focused byte/restart tests and separate signed installed UI acceptance gates.

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

- 2026-11-11: Stabilize editable Photos progress and expose upload speed/data
  settings. Add the explicit canonical background-file transfer contract,
  preserve automatic recovery after system interruption and saved-settings
  authority holds, retain Pause and authorization boundaries, and distinguish
  deferred work from a failed continued task. Simulator logic and physical
  background execution remain separate acceptance gates. See [PR 1466 evidence](../PRs/1466-codex-ios-photos-background-hardening-keep-photos-transfers-running.md). **Codex (AI)**
