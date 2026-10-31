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
