# Changelog

All notable changes to the **Thingtime web app** are recorded here. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with
assistant and manual changes attributed so future PR archaeology is less cursed.

**Author legend** — every entry is attributed:

- **Codex (AI)** — change made by the Codex AI assistant.
- **Claude (AI)** — change made by the Claude AI assistant.
- **Lopu** — change made manually by the developer.

> When you make a manual change, add a bullet under `[Unreleased]` ending with
> `— Lopu, YYYY-MM-DD`. Keep the newest entries at the top.

---

## [Unreleased]

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

- **Feature Stacks are now reusable, unlimited control-plane workflows.** Admin
  CI Control can save and edit multiple stacks, run a one-feature stack, select
  any number of live features and targets, see per-target PR progress, and use
  a default-on branch router that keeps `github-actions`, `main`, and `develop`
  sources in compatible lanes. The protected controller receives a v2 immutable
  plan and filters it to one target-specific source manifest before Lopu merges.
  PR statuses now use a Vercel-style multi-select; System model-order entries
  edit in place; and the encrypted credential waterfall accepts built-in or
  custom AI platform labels while GitHub keeps using the single stable router
  secret. [Detailed PR #498 notes](../PRs/498-codex-feature-stack-saved-workflows--saved-multi-target-feature-stacks.md).
  — Codex (AI), 2026-08-31

- **Admin CI Control now owns Lopu’s ordered Claude account vault.** Admins can
  add, name, rotate, enable, remove, and reorder up to eight write-only Claude
  Code OAuth tokens. Thingtime encrypts values with AES-256-GCM, exposes only
  redacted metadata to browsers, and delivers the ordered enabled bundle to a
  fresh replay-protected HMAC-authenticated controller run. Lopu masks the
  bundle, keeps it only for that run, and walks the array on classified account
  capacity/credential failures, removing the need for one GitHub secret name
  per Claude account. — Codex (AI), 2026-08-31

- **Admin CI Control now batches features as a verified multi-target Feature
  Stack.** Admins can preserve an ordered 2–20 PR selection, choose one or two
  live target branches, and dispatch once. The server snapshots exact live
  same-repository heads; the protected Lopu controller sequentially combines
  them per target, restricts AI edits to Git-reported conflicts, verifies merge
  topology and bytes, and opens branch-protected auto-merge PRs. The new
  origin-scoped API capability manifest advertises the additive dispatch
  contract as `api.admin-ci-dispatch` 1.1.0. Detailed validation notes:
  [PR #487 (`develop`)](../PRs/487-codex-feature-stack-merge-control-add-verified-multi-target-feature-stacks.md)
  and [PR #489 (`main` promotion)](../PRs/489-codex-feature-stack-main-add-verified-multi-target-feature-stacks.md).
  — Codex (AI), 2026-08-30

- **Thingtime’s MCP initialization now supplies connector-wide interaction
  instructions.** ChatGPT receives the account-selection, token-safety, and
  confirmed-mutation contract before tools are called; the additive MCP feature
  advances to `1.1.0`. — Codex (AI), 2026-08-26
- **Thingtime ChatGPT/Codex MCP connector.** A public OAuth 2.1 + S256 PKCE
  streamable-HTTP MCP gateway now connects multiple named, allowlisted
  Thingtime API endpoints through encrypted, scoped and revocable PATs. The
  bridge token cannot act as a Thingtime account session; tools are restricted
  to account management plus Things reads and explicitly confirmed writes.
  Protected-resource/auth-server discovery, an origin-scoped capability
  manifest, API docs, and the distributable plugin package live together so
  clients can negotiate the contract rather than route-probing. — Codex (AI),
  2026-08-25
- **Admin external integrations**: `/admin` now exposes a dedicated
  **External integrations** tab for a write-only AES-256-GCM secret vault,
  saved HTTPS endpoint policies, and a bounded redacted audit trail. The
  provider proxy enforces selected read / create-only / write permissions;
  Vercel create-only environment writes check for an existing value before
  POST and never use PATCH/upsert. Setup: `README.md` “Admin integration vault
  and policy proxy”. — Codex (AI), 2026-08-24

### Security

- **ChatGPT connections now survive secure refreshes without splitting account
  state.** The optional `offline_access` scope issues one-time rotating refresh
  credentials alongside the 30-day MCP bridge token. Every access and refresh
  credential references one encrypted, origin-bound connection session, so an
  account switch or final disconnect applies consistently across renewals; a
  final disconnect revokes the connection and all of its bridge credentials.
  The OAuth and connections capability features advance to `1.1.0`. — Codex
  (AI), 2026-08-26
- **ChatGPT tool annotations now match their actual effects.** Public-content
  writes are marked as open-world actions, only irreversible writes retain the
  destructive hint, and the MCP semantic feature advances to `1.0.2` for
  review-safe metadata scanning. — Codex (AI), 2026-08-26
- **ChatGPT now discovers OAuth before invoking protected tools.** The MCP
  catalog publishes standard per-tool OAuth metadata while returning no account
  data, protected calls emit the model-readable OAuth challenge ChatGPT uses to
  link an account, and bridge sessions are bound to the exact MCP origin that
  issued them. — Codex (AI), 2026-08-26
- **Passkey app links join the relationship-uniqueness family.** `passkey-app-link`
  shipped in #323 with its own kind-blind `crystal.linkKey` unique index —
  authored while #320/#325/#326 were retiring exactly that pattern. A
  free-form data crystal could take the slot (blocking a passkey's linked-app
  record) or, worse, hold a DUPLICATE of it, which fails the whole boot-time
  index battery on E11000 and takes registration/login down with it. Dedupe
  now rides the server-only root `uniqueKeys` namespace
  (`linkKey:<passkeyId>:<appKey>`, stamped through the shared
  `relationshipUniqueKeys` helper), the per-login upsert matches on that same
  stamped value (served by the existing `uniqueKeys` index, with a crystal-path
  fallback until legacy rows are backfilled), and the unique index is retired
  outright — no replacement lookup index needed, one less index on the busiest
  collection. The existing `backfill-relationship-unique-keys` migration is
  map-driven, so re-running it stamps legacy rows. Regression-pinned in
  `verify-passkeys.mjs` (47 checks). — Claude (AI), 2026-08-25

### Changed

- **Graphify output is now conflict-free and content-addressed**: a repository
  wrapper fingerprints the source tree without generated output, serializes
  writers, validates Graphify's atomic graph/manifest/report set, and publishes
  immutable snapshots whose identical artifacts deduplicate and whose valid
  variants coexist. Mutable semantic-cache entries are also promoted into
  immutable input-key/content-hash variants. Ignored root symlinks preserve ordinary query compatibility;
  committed hooks select/build snapshots without committing or pushing, and
  Lopu can regenerate a post-merge snapshot instead of line-merging generated
  JSON. [PR #436 details](../PRs/436-codex-graphify-snapshot-routing--make-graphify-output-conflict-free.md).
  — Codex (AI), 2026-08-27
- **ChatGPT OAuth client registration now accepts the stable Client ID Metadata
  Document.** The connector permits ChatGPT's current `oauth/client.json`
  client identifier, while retaining the previous fixed identifier for existing
  developer-mode connections. — Codex (AI), 2026-08-26
- **The develop Lopu listener exposes the complete maintenance contract**:
  manual recovery now includes the protected controller's bounded
  `backfill-codeql` operation alongside PR management, promotions, branch sync,
  and the wildcard-all build. The caller contract and operational checklist
  pin this menu so product-branch listeners cannot silently drift behind the
  single `github-actions` implementation. — Codex (AI), 2026-08-26
- **The wildcard `all`-branch workflow is folded into the one public Lopu
  manager**: product branches no longer retain a separate all-branch listener.
  Develop/main pushes, the full PR lifecycle including draft and close, the
  hourly backstop, and manual `build-all` recovery all route through **Lopu PR
  manager** to the protected reusable doctor. — Codex (AI), 2026-08-25
- **The last duplicate public PR-maintenance Actions are retired on develop**:
  promotion, main/develop synchronization, merge cascades, and rebase-stack
  repository events all enter through the one visible Lopu PR manager. The
  protected rebase engine remains implementation-only on `github-actions`;
  develop no longer carries a second rebase listener that could duplicate
  detection or cancellation ownership. — Codex (AI), 2026-08-25
- **Lopu CodeQL target events now use the metadata-only handoff they describe**:
  the default-branch listener sends PR number and exact head SHA through the
  protected handoff, while only the separate unprivileged dispatch invokes the
  analyzer. This prevents duplicate target-context base scans and the red
  cancelled analyzer checks they could leave behind. — Codex (AI), 2026-08-25
- **Lopu now receives every PR-head lifecycle update from the default branch**:
  `pull_request_target` includes synchronize, ready-for-review, and edited
  events, so old PR branches and non-default targets no longer depend on
  carrying a current push listener themselves. The develop caller is also
  aligned with the current principal-manager contract for comments, failed
  checks, promotion/maintenance inputs, and the separately fenced CodeQL
  disposition permission. The protected controller still deduplicates
  immutable snapshots and admits at most one model-backed Lopu worker per
  repository. — Codex (AI), 2026-08-25
- **CodeQL keeps normal PR checks while covering arbitrary targets**: the thin
  listener now calls separate protected workflows for unprivileged analysis
  and the metadata-only `pull_request_target` handoff. Ordinary PR tokens no
  longer fail workflow validation by inheriting the handoff's
  `actions: write` request; normal PRs retain their branch-protection contexts,
  while older target branches still receive exact-ref analysis through the
  trusted dispatch hop. — Codex (AI), 2026-08-25
- **Lopu CodeQL now covers every PR target and branch**: an unfiltered PR
  listener, all-branch push listener, scheduled backstop, and protected reusable
  implementation replace default-branch-only scanning. A metadata-only
  default-branch target event also dispatches exact-ref analysis for PRs whose
  target predates the listener, without checking out code or exposing AI
  credentials in the privileged run. Targets that already carry a listener
  keep the normal PR check as owner; older targets use their merge ref, with a
  head-ref fallback when the merge ref is missing or its parents are stale.
  Live-state fences and existing two-language snapshots reject stale or
  duplicate work, and Lopu accepts immutable head or merge-ref findings only
  after revalidating both the reviewed head and base revisions. The README
  documents the ordered default-setup-to-advanced-setup activation and its two
  repository variables, one of which prevents expected pre-activation upload
  failures.
  — Codex (AI), 2026-08-25
- **Signed Desktop PR releases now use the protected `github-actions` control
  plane**: this branch contains only a `pull_request_target`/manual listener;
  the owner-and-label gate, immutable PR-SHA checkout, unsigned verification,
  signing, notarization, and prerelease publishing remain in the reusable
  implementation. — Codex (AI), 2026-08-24
- **Paired-Mac display mode selections now persist**: resolution and refresh
  changes use Core Graphics' permanent display-configuration transaction rather
  than an app-lifetime mode setter, matching the existing layout and mirroring
  persistence. The desktop endpoint probe now requires the matching `api.devices`
  `^1.6.0` contract before activating controls. The closed command shape, fresh
  approval boundary, and advertised-mode validation are unchanged. — Codex (AI),
  2026-08-24

### Added

- **Account birthday as private state with an exact `profile.birthday` scope**:
  the birthday is a plain `YYYY-MM-DD` calendar date stored in the user thing's
  secure blob (`meta.birthday`), editable from Settings, and excluded from
  `PublicProfile` — other users and the public profile projection never see it.
  Apps receive it from `/api/v1/oauth/userinfo` only under the literal
  `profile.birthday` scope: it is marked `exact`, so a plain `profile` grant —
  including every legacy token — never silently covers it.
  `/api/v1/oauth/scopes` is now CORS-open so platforms can feature-detect the
  scope before opening the popup. Details in
  [`PRs/180-claude-user-birthday-scope--account-birthday-private-field-exact-scope.md`](../PRs/180-claude-user-birthday-scope--account-birthday-private-field-exact-scope.md).
  — Claude (AI), 2026-08-24
- **Unlimited AI workflow model waterfall**: Admin → System's model order now
  accepts any number of unique entries from a 33-model Claude + OpenAI
  catalog, each with a per-entry reasoning-effort tier and normal/fast mode
  (composed ids `<model>[:<effort>][:fast]`; reads drop unknown entries
  instead of collapsing; direct Anthropic/OpenAI features resolve their own
  provider's first entry). Lopu musings budget for the reasoning those entries
  now pay for — the OpenAI call uses `max_completion_tokens` (the deprecated
  `max_tokens` is rejected by o-series/GPT-5) and a provider that streams no
  text falls through instead of rendering a blank musing. The github-actions
  control plane still fail-closes to `["default"]` for non-legacy entries until
  its closed grammar is widened
  (see [PR #388 note](../PRs/388-claude-fallback-model-selection-0281b1--unlimited-ai-model-waterfall-claude-openai-catalog.md)).
  — Claude (AI), 2026-08-24
- **Commander GitHub release control plane**: main-branch Commander changes
  now route to a native macOS release workflow that publishes a versioned app
  archive and checksum; its base version is intentionally bumped in a reviewed
  Commander change while GitHub run metadata supplies each unique build number.
  — Codex (AI), 2026-08-23

- **Explicit UNSIGNED desktop-release fallback**: the owner-approved PR release
  worker now publishes an ad-hoc-only Electron and Recovery pair when all six
  Developer ID/notarization secrets are absent. Their SemVer, asset names,
  GitHub title, and notes all say UNSIGNED; a partial secret configuration
  stops the build. Recovery visibly separates them from verified releases and,
  after acknowledgement, can cache, launch, or atomically install one while
  warning that macOS may require Privacy & Security → Open Anyway. — Codex
  (AI), 2026-08-24

- **Admin deployment peer explorer**: **Dev → Deployment peers** now presents
  locally known signed mesh leases in grid, card, and list views, with a
  property-aware search selector and deliberate cursor paging. The browser
  uses a separate private admin projection; HMAC material, private keys,
  request signatures, and gossip cursors remain inaccessible to clients. —
  Codex (AI), 2026-08-24

- **Independent native rollback launcher for Thingtime Desktop**: the signed
  `Thingtime Recovery.app` now has its own SwiftUI version browser, a separately
  signed installer helper, its own companion release ZIP, and a self-update
  path. It shares the durable desktop cache at
  `~/Library/Application Support/com.thingtime.desktop/release-cache` while
  keeping recovery-launcher copies separate. It caches only verified bundle
  identifiers and same-team signatures, closes a running desktop before an
  atomic install, preserves the replaced bundle, and rejects a stale or
  malformed GitHub asset without changing the installed app. Its companion
  asset is supplied by the dedicated protected-release control plane. — Codex
  (AI), 2026-08-24

- **Signed Desktop PR releases and recovery-first version switching**: an
  owner-approved, same-repository PR carrying the `desktop-release` label can
  now publish a Developer ID-signed, notarized GitHub prerelease whose SemVer
  identifies its PR, normalized branch, and exact commit. Desktop Settings now
  fetches/searches the GitHub release catalog, caches only verified signed
  macOS ZIP bundles, lets a person launch or atomically install a cached
  version, and preserves the current production app as a fallback before every
  switch. The cache is bounded to twelve explicit recovery bundles, never
  silently installs, and remains revealable in Finder if a later UI is broken.
  — Codex (AI), 2026-08-24
- **Desktop recovery updater hardening**: GitHub release discovery now follows
  every API Link page instead of stopping at a fixed history cap, rejects
  redirect hops outside GitHub release storage, repairs stale cache metadata
  before applying its twelve-bundle limit, and removes a partial cache copy on
  failed verification. Recovery launches now hand off after the current app
  exits, preventing two cached/installed versions from sharing one local
  profile at once; cached recovery choices remain visible and usable if GitHub
  is offline. — Codex (AI), 2026-08-24

- **Approval-gated remote pointer and keyboard controls for paired Macs**:
  the desktop node now accepts a closed, capability-gated set of screen-relative
  pointer moves/clicks/scrolls, bounded text entry, and allowlisted keyboard
  shortcuts. Every command needs a fresh approval and macOS Accessibility
  permission; the node does not request Input Monitoring, Full Disk Access,
  root, clipboard, keylogging, event taps, shell execution, or arbitrary
  scripting. Quartz enqueueing stays journalled as `needs-review` rather than
  pretending that a target app accepted the input. The paired-device contract
  is now `1.8.0`; live screen pixels remain intentionally unimplemented until a
  privacy-preserving peer-to-peer transport is selected. — Codex (AI),
  2026-08-24

- **Consented media app and Chrome YouTube volume controls for paired Macs**:
  Apple Music and Spotify now expose their own bounded 0–100% volume settings
  alongside fixed playback controls. Chrome can set the active direct
  YouTube/YouTube Music audio/video element volume through one fixed Apple
  Event after the Mac user grants Automation and enables Chrome’s **Allow
  JavaScript from Apple Events** setting. These commands always require fresh
  approval, reject scripts, URLs, selectors, browser/profile data and unknown
  input, and do not collect media metadata or page data. Cross-origin embeds
  and generic browser media remain intentionally unavailable. Paired-device
  API contracts are now `1.7.0`. — Codex (AI), 2026-08-24

- **User-reviewed global availability policy proposals for paired Macs**:
  AirDrop and camera availability now have separate capability-gated commands
  that accept only a boolean and always require a fresh approval. Each command
  writes one fixed local configuration profile and opens macOS’s profile-review
  flow; macOS installation remains a separate local choice. The profiles never
  create MDM enrollment, carry arbitrary payload content, or alter per-app
  camera TCC grants. Paired-device API contracts are now `1.5.0`. — Codex (AI), 2026-08-24

- **Approval-gated persistent idle timers for paired Macs**: the node now
  reads and can set the documented IOKit display-idle, system-sleep, and
  disk-spindown timers from Never (0) through 180 minutes. Every change
  requires a fresh approval and verifies the observed value after macOS
  applies it; no power profile, arbitrary `pmset` key, or shell input is
  accepted. Paired-device API contracts are now `1.4.0`. — Codex (AI), 2026-08-24

- **Scoped Spotify playback controls for paired Macs**: the node now reports
  only whether Spotify is installed/running and accepts only fixed play,
  pause, previous, and next actions. Each command requires a fresh approval
  and macOS Automation consent, accepts no script, app, queue, track, library,
  or history input, and remains `needs-review` until the next observation.
  Paired-device API contracts are now `1.3.0`. — Codex (AI), 2026-08-24

- **Advanced paired-computer display, hardware, and lifecycle controls**:
  paired Macs now advertise capability-gated per-display
  mode/resolution/refresh, brightness, layout, mirroring and read-only HDR;
  default printer, preferred camera, paired Bluetooth device, existing VPN,
  and keep-awake controls; plus always-fresh-approved restart, shutdown, and
  logout. The device drawer groups the new controls in **Displays & system
  hardware**. Terminal lifecycle effects reconcile as `needs-review` after
  reconnect; no arbitrary scripts or shell input is accepted. Details:
  `PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md`.
  — Codex (AI), 2026-08-24

- **Scoped Apple Music and power-status controls for paired Macs**: the node
  now reports Low Power Mode and whether Apple Music is installed/running.
  Apple Music exposes only fixed play, pause, previous, and next actions;
  each needs a fresh approval plus macOS Automation consent, accepts no script,
  app, queue, track, library, or history input, and remains `needs-review`
  until the next observation. HDR and Low Power Mode remain read-only; Focus,
  AirDrop, Bluetooth radio power, camera privacy, and global media playback
  remain absent because macOS provides no supported scoped setter. Paired-device
  API contracts are now `1.2.0`. Details:
  `PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md`.
  — Codex (AI), 2026-08-24

- **Categorized safe machine controls in the paired-computer drawer**: everyday
  volume, mute, brightness, and application focus controls remain immediately
  available; advanced Audio & routing, Network & connectivity, Power,
  permissions, and diagnostics begin collapsed per computer. Audio routes use
  menus, each running app has a contextual More menu, and the Applications
  heading provides a separate global-actions menu. Wi-Fi permits only a
  saved/open SSID (never a password); Force quit always creates an explicit
  approval because it can discard unsaved work; and Sleep uses the existing
  approval policy. — Codex (AI), 2026-08-23

- **/branding redesigned as a full brand-resources page**: full-width
  Meta-style sections per logo variant with whitespace-trimmed previews and a
  minimalist custom exporter (PNG/SVG, any width, per-side pixel padding,
  optional background); pre-generated PNG ladders (10px → 10000px) + SVGs
  committed under `remix/public/branding/generated/` via the new
  `npm run branding-assets` (zero-dep deterministic PNG encoder), lazy-loaded
  for Google-image indexing; generated press-kit suite (OG cards, banners,
  wallpapers, tiles, confetti pattern); palette + usage sections; Asset
  library JSON dump removed. Details:
  `PRs/129-claude-todo08-branding-svg-png-s1--branding-brand-resources-redesign.md`.
  — Claude (AI), 2026-08-22
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

### Performance

- **Collection→things migration batches each phase per page (PR #69 review, c16)**:
  `collectionToThingsMigration.run` processed legacy docs one-by-one with 3-4
  sequential Mongo round trips each (upsert claim, twin re-read, fresh legacy
  read, optional replace, delete) plus a growing `$nin` page filter — migrating
  ~50k accounts cost ~150-200k serial round trips inside a single admin request
  (timeout territory). The CLAIM phase of each ~200-doc page is now batched: one
  unordered `bulkWrite` of `$setOnInsert` upserts (deterministic-shareId specs)
  classified via `upsertedIds`, one `shareId` `$in` re-read for the genuine
  check, a batched `findExistingMany` lookup for the uuid-shareId waitlist path,
  and one legacy `_id` `$in` fresh read — those steps drop from O(docs) to
  O(pages). The CONSUME phase's *mutations* deliberately stay per-doc: a
  conversion receipt may only certify a delete that verifiably landed, so each
  survivor still costs its own lease re-assert, exact-snapshot `deleteOne`, and
  receipt write (plus a CAS `replaceOne` on the repair path). Net effect is
  roughly halved round trips — about 3 per migrated doc instead of 6-7 — not a
  per-page constant; batching the guarded delete would require a different
  receipt protocol and is left as follow-up. Every guard is preserved verbatim: the updatedAt data-loss guard
  still leaves a raced legacy doc for the next run, and collisions /
  foreign-held ids / malformed docs still fall back to per-doc skip.
  Validated with a dry-run + real run against seeded legacy users (3 pages), the
  race-guard rebuild path, foreign-collision skip, waitlist dedup, and idempotent
  re-runs — Claude (AI), 2026-07-18.
  Follow-up: the batched BUILD phase now runs each `spec.toThing` through
  `conversionBuildOutcomes`, restoring the per-doc `try/catch` the per-doc loop
  had. A legacy `users` row whose `emailVerificationRequiredBy` is truthy but
  unparseable makes `buildUserSecure` raise `RangeError: Invalid time value`
  rather than returning `{ ok: false }`; in a bare page loop that escapes `run()`
  before the row reaches `skippedIds`, so every re-run re-reads the same page and
  aborts identically — one corrupt document wedges the whole migration instead of
  costing it a single skip. Pinned by a regression test — Lopu (AI), 2026-08-29.
  Follow-up: the consume phase's conversion-receipt LOOKUP is now batched too. It
  had been grouped with the mutations that must stay per-doc, but it is a pure
  read keyed only on `(collection, source._id)` — the same key for a page-query
  snapshot and its re-read — so one `key: { $in: [...] }` query against the
  unique `settings.key` index resolves a whole page. The freshness comparison
  (`conversionReceiptCovers`) stays per-document, run against the exact snapshot
  being judged, and receipts are only ever upserted, so a page-old snapshot can
  miss a receipt a concurrent runner just wrote but can never invent one — a miss
  falls through to the stricter semantic-equality path. Measured against a
  throwaway mongod with server-side profiling: receipt reads drop 250 → 2 over a
  250-doc/2-page `users-to-things` run, with every other operation count and the
  full report identical — Lopu (AI), 2026-08-30.
  [PR #74 details](../PRs/74-claude-batch-collection-things-migration--batch-collection-to-things-migration-per-page.md).

### Fixed

- **Lopu is the sole wildcard-union listener**: the legacy public **Build all
  branch** workflow is retired from the product branch. PR lifecycle, branch
  push, manual, and hourly union-build signals now enter the default-branch
  **Lopu PR manager**, whose protected maintenance namespace preserves the
  active build and coalesces only obsolete not-yet-started snapshots. The
  listener contract now rejects any reintroduction of the competing workflow.
  — Codex (AI), 2026-08-27
- **CI Control repository maintenance now dispatches the unified Lopu
  workflow**: existing rebase, feature-promotion, standing-promotion, and sync
  operation keys translate to typed `Lopu PR manager` inputs instead of naming
  retired workflow files. Rebase cascade and promotion dry-run/lookback values
  remain intact for GitHub-hosted and Vercel-routed runs. The last product
  rebase listener is removed; exact stack workers enter Lopu and then invoke
  the protected `workflow_call`-only engine. — Codex (AI), 2026-08-25
- **The default-branch all-builder listener no longer cancels its protected
  worker before the durable queue starts**: `main` now matches `develop` by
  leaving concurrency ownership entirely to the `github-actions`
  implementation. Bursty PR/push events therefore remain queued instead of
  cancelling an in-flight all-branch rebuild at the caller boundary. — Codex
  (AI), 2026-08-25
- **Lopu is the only automatic promotion and branch-sync entrypoint**: the
  three product-branch workflows that separately promoted develop, promoted
  features, and synchronized main into develop are removed. Their protected
  implementations are non-cancelling reusable jobs inside **Lopu PR manager**;
  develop pushes, main pushes, the six-hour backstop, and explicit
  `maintenance_operation` recovery now all enter through that one workflow.
  — Codex (AI), 2026-08-25
- **One automatic Lopu owns merge, stale-branch, rebase, and stack work**: the
  legacy rebase listener is now an internal `repository_dispatch` handoff only,
  so a branch push cannot spawn a competing standalone rebase run that gets
  cancelled when the unified manager starts its embedded rebase lane. Manual
  recovery also goes through **Lopu PR manager**. — Codex (AI), 2026-08-25
- **Lopu's default-branch listener can start every repository-manager lane**:
  the thin reusable-workflow caller now grants the maximum `security-events`
  permission required by its isolated CodeQL reader/writer jobs. GitHub no
  longer rejects `check_run`, comment, push, or scheduled Lopu runs before any
  job is created, while the model review job remains read-only and alert
  dispositions stay in the separately fenced writer. — Codex (AI), 2026-08-25
- **CodeQL promotion remains valid when release-listener work overlaps**: the
  main promotion now keeps one Electron release-listener contract block rather
  than combining two independently valid additions into duplicate JavaScript
  declarations. — Codex (AI), 2026-08-25
- **Commander launch and verification remain responsive when Launch Services stalls**:
  application launches now submit asynchronously instead of blocking the native UI
  thread, and the signed build verifier terminates only its own stuck launch helper
  after the installed Commander host is confirmed running. — Codex (AI), 2026-08-25
- **Build all branch listener can dispatch its control-plane worker**: the
  reusable workflow's push handoff requires `actions: write`; the main listener
  now grants that inherited permission instead of failing at workflow startup.
  — Codex (AI), 2026-08-24
- **PR #299 Messenger membership durability**: unordered batched member writes
  now treat duplicate-key failures as benign only when the Mongo driver reports
  no accompanying write-concern failure. The check covers the current driver's
  concern-only and result-level error shapes and fails closed when the result
  cannot be inspected. — Codex (AI), 2026-08-24

- **Signed-release MCP gate handles closed local connector pipes**: the JSONL
  transport now treats a child-process `EPIPE` as an unavailable connector and
  fails pending work closed, rather than allowing Node to throw an unhandled
  stream error during teardown. — Codex (AI), 2026-08-24

- **Signed-release native gate no longer relies on wall-clock scheduling**:
  the long-running lease-heartbeat test now waits for its three intended
  renewals before completing dispatch, then verifies renewal stops. This keeps
  the behavior under test intact while eliminating macOS runner timing flakes.
  — Codex (AI), 2026-08-24

- **Signed-release native checks now build across macOS SDK overlays**: printer
  identifiers and names are converted through the Core Foundation Get-rule
  bridge, rather than force-cast from one SDK-specific declaration. The
  release gate now works whether Core Printing imports these values as Swift,
  Core Foundation, or unmanaged Core Foundation strings. — Codex (AI),
  2026-08-24

- **Deployment peer discovery is bounded and gossip-based**: authenticated
  first-party deployments now maintain one relational, TTL-reaped peer lease
  per origin. `/api/v1/peers` streams cursor-paginated NDJSON instead of an
  all-peers array; a self-signed sync announces to production then probes a
  capped breadth-first peer set. HMAC binds method, path, timestamp, and raw
  body; each peer identity and streamed result has an Ed25519 public signature
  which is pinned to its origin. Anonymous, expired, tampered,
  non-first-party, key-rotated, and unbounded requests fail closed. — Codex
  (AI), 2026-08-24
  The production bootstrap advances its bounded traversal with a five-minute
  `CRON_SECRET`-protected Vercel schedule; other deployments can use the
  documented scheduler endpoint. — Codex (AI), 2026-08-24

- **Every API operation now advertises a compatibility contract**:
  `/api/v1/capabilities` is generated from the canonical API-doc registry and
  active runtime route map. It publishes a semantic `api.<endpoint-id>`
  contract for each documented operation plus discoverable `route.*` entries
  for every executable route. Desktop clients negotiate their required range
  before using a selected deployment,
  while older deployments retain the narrow devices-route fallback during the
  rollout. — Codex (AI), 2026-08-23

- **Desktop API endpoint compatibility is now explicit and fail-safe**: the
  packaged app validates both the selected deployment's computers route and
  its own bundled loopback proxy target on startup, endpoint changes, and a
  non-blocking Settings retry. A preview that is still deploying now stays
  visibly selected but is marked incompatible rather than looking like a
  production fallback; Thingtime desktop will not reconfigure or restart its
  managed node against that endpoint until both checks pass. — Codex (AI),
  2026-08-23

- **Per-computer device-drawer layout and browser navigation alignment**: each
  paired machine now remembers its own collapsed/expanded details sections and
  last chosen panel width locally, without storing device state or content. The
  browser nav now shares the drawer trigger's 52px/36px control grid, and the
  Commander search button remains available in ordinary web browsers as well
  as Electron. — Codex (AI), 2026-08-23

- **Paired-computer actions now default to Always allow**: the paired-account
  badge uses a soft green success treatment, and each account/computer drawer
  now offers a durable **Always allow / Ask every time / Deny** preference.
  Existing pairs read as Always allow without a migration. The server enforces
  the selected mode before creating a command, while pairing, capability,
  freshness, locked-session, and macOS privacy checks remain fail-closed in
  every mode. — Codex (AI), 2026-08-23

- **Device drawer drag now changes its visible width**: resize handling now uses
  one window-level pointer stream, preventing Chromium's compatibility
  `mousedown` from replacing the active pointer id. The desktop drawer width
  also explicitly outranks Chakra's inline `width: 100%`, so the rendered panel
  edge moves with the accessible splitter value. The same slim edge is now
  draggable on mobile instead of forcing a fixed full-width panel, with a
  mobile-safe 280px minimum; the oversized dotted grip has been removed while
  its generous invisible hit target remains. — Codex (AI), 2026-08-23
- **Storage-accounting migrations retain protected attachment fields**: the
  pending census and real whole-account backfill now read the complete stored
  attachment object envelope before calculating canonical bytes, preventing
  legitimate preview uploads from stopping migration with
  `InvalidAttachmentStorageEnvelopeError`. — Codex (AI), 2026-08-23

- **Interactive, resizable device details drawer**: the close control and panel
  surface are now explicit Electron `no-drag` regions, so the 44px X remains
  clickable even where the native title-bar drag band crosses the drawer.
  Desktop users now get an always-visible grip and a generous 24px hit area
  wholly inside the drawer's left edge, which can be dragged between bounded
  viewport-safe widths (or adjusted with arrow keys). Node, observed state,
  applications, connectors, screen, approvals, and command activity can each
  be collapsed independently. Mobile keeps the existing full-width drawer. —
  Codex (AI), 2026-08-22

- **Paired-node optimistic status, clickable device drawers, offline deep-link
  reloads, and launch restart**: background node checks now preserve the last
  paired badge and all known-good controls, adding only a tiny green activity
  indicator while each real action owns its own pending state. Chakra drawer
  portal stacking now keeps device and chat panels above their dimming overlay.
  Nitro bundles the React index shell as a server asset so Cmd+R on `/things`
  remains local and returns the app instead of a build-placeholder 503.
  Electron desktop settings default **Auto-start node on Thingtime launch** on;
  app launch revives only a previously approved managed LaunchAgent and never
  silently installs a never-enabled node. — Codex (AI), 2026-08-22

- **Desktop pairing response reconciliation and Thingtime Node identity**: the
  manually signed helper now stores its encrypted pairing vault in the
  traditional macOS login Keychain instead of requesting the provisioning-only
  Data Protection Keychain access group that failed with
  `errSecMissingEntitlement`. Local Keychain failures are definitive and
  actionable rather than being mislabeled as an unconfirmed server response.
  The signed node now retries an ambiguous prepare/complete response up to three
  times inside the original locally approved operation, replaying only the
  exact key-bound signed claim so a committed response loss does not surface as
  a false failure or require another confirmation. If every bounded attempt is
  still uncertain, `/things` immediately refreshes into the durable **Resume
  pairing** state with actionable copy. The embedded node helper now declares a
  distinct RGBA macOS app icon that makes the four Thingtime canopy/trunk
  squares smaller and more widely spaced, joined through pixel relays to a
  central pink/red mesh square. — Codex
  (AI), 2026-08-22

- **Electron now always renders its packaged Thingtime build**: API/deployment
  selection no longer replaces the desktop window with `thingtime.com` or a
  preview website. The bundled loopback UI remains authoritative and proxies
  only account/API traffic to the selected origin; that normalized API URL and
  label now survive relaunches, reinstalls, and build-profile ID changes. Local
  Vite and packaged Nitro use the same validated HTTPS/loopback fallback target,
  while an unavailable API can no longer prevent the offline interface from
  starting. — Codex (AI), 2026-08-22

- **Multi-account desktop pairing and native menu polish**: one Mac now retains
  up to 32 independently scoped Thingtime account credentials and runs an
  isolated command/live-sync loop for each, while an account can continue to
  pair any number of computers. Pair links remain single-use; endpoint drift is
  rejected with an actionable origin-specific error instead of a generic toast.
  Fresh installs default to the pink four-square menu-bar artwork, the full
  wordmark is a tightly cropped 86x16 raster (eliminating SVG join seams), and
  the native menu consistently says Thingtime with separate Restart and real
  Quit commands. The Electron titlebar now restores drawer/history controls on
  first paint and places notifications immediately after the account control.
  — Codex (AI), 2026-08-22

- **Electron titlebar, notification, and drawer interaction boundaries**: the
  draggable region now stops at the 52px desktop titlebar instead of extending
  through the inactive Commander over Lopu notifications. Notification text is
  selectable and its close control has a 28px target; Electron places Back and
  Forward between the drawer and home controls and moves the account to the end
  of the left icon row, followed by notifications. Hovered/pinned drawers remain below those controls, use
  an even 10px hover-surface gutter, and no longer add excess top menu padding.
  — Codex (AI), 2026-08-22

- **Desktop node endpoint, permissions, relaunch, and identity follow-up**:
  Electron now stores a local list of named API origins, seeds the build's PR
  preview, probes `/api/v1/devices` before switching, and moves the renderer,
  LaunchAgent, Keychain, and journals to the same deployment scope. Explicit
  native permission requests refresh TCC preflight, the KeepAlive helper
  suppresses duplicate LaunchServices relaunches, and pairing confirmations
  allow normal human response time. The menu bar is an image-only selectable
  Thingtime tree/wordmark (including pink and private custom artwork), while
  the Electron bundle uses adaptive light/dark Icon Composer artwork. — Codex
  (AI), 2026-08-21

- **Media layout selections now reach the Things API**: the shared client API
  transport preserves `mediaLayout` for post creation and rich comments, so a
  Rows/Grid preview no longer silently reopens as Auto after save. — Codex
  (AI), 2026-08-21

- **Develop staging domain kept on the protected branch during PR previews**:
  `dev.thingtime.com` remains bound exclusively to the literal `develop` Git
  branch (`gitBranch: develop`, with no custom-environment binding). The
  `develop` Vercel Custom Environment is reserved for isolated PR deployments
  and owns no stable domain, so a controller-created preview cannot advance the
  signed-in staging origin. — Codex (AI), 2026-08-21

- **Stable develop alias advances only to an exact native develop build**: the
  protected controller fences the current GitHub `develop` SHA, Vercel project,
  repository, custom environment, native non-PR Git source, READY state, and
  post-assignment domain binding before moving `dev.thingtime.com`. Merged PRs
  wait boundedly for their build, while scheduled reconciliation provides an
  idempotent recovery path. — Codex (AI), 2026-08-21

- **PR #321 legacy detected-type backfill preserves media annotations**:
  re-detecting a pre-#319 opaque attachment now changes only its server-owned
  type fields and retains #312's owner-authored title/description exactly;
  malformed annotation metadata fails closed instead of being erased. — Codex
  (AI), 2026-08-21
- **PR #312 media integration hardening**: attachment annotation now preserves
  server-owned magic-byte `detectedContentType`, Auto layout removes the
  optional `mediaLayout` key, and media-card permalinks consistently use
  `/media/:id`. Internal repost/quote controls stay hidden on media Things
  until attachment-target shares have a non-empty renderer. Gallery layout
  numbers and span keys are now strict rather than coercible/prototype-shaped,
  annotation accepts only its documented request fields, and media cards label
  their audience as inherited instead of incorrectly falling back to Public.
  — Codex (AI), 2026-08-21
- **Build-all push handoff permission boundary**: the thin product-branch
  listener now grants `actions: write`, allowing the protected reusable
  workflow's push-only handoff to dispatch its supported-event worker instead
  of being rejected by GitHub before any job starts. The caller contract pins
  the required grant. — Codex (AI), 2026-08-21
- **Desktop mesh node and connector stay alive independently of Electron**:
  LaunchAgent generation now emits valid property-list `<key>` fields and
  registration no longer performs an unconditional immediate kickstart. The
  connector reads its long-lived pipe incrementally through `AsyncBytes`, with
  a generation guard preventing stale canceled readers from tearing down a
  replacement process; pending approvals also survive reload through only
  their privacy-safe opaque/redacted projection. The final installed-app proof
  replaced the old managed node once, kept the launchd node and connector alive
  for more than two minutes and after Electron Cmd+Q, and reported one launchd
  run with no exit. — Codex (AI), 2026-08-19
- **CSP blocked attachment uploads on header-serving deployments**: the
  application Content-Security-Policy's `connect-src` never allowed the
  private S3 bucket origin, so on any surface that serves the CSP header
  (`pr-*.previews.dev.thingtime.com`, `dev.thingtime.com`, staging — and
  production once the policy ships) the composer's direct-to-S3 part PUT was
  killed by the browser and every upload failed with "The file could not
  reach storage. Check your connection and retry." (`*.vercel.app` previews
  carry no CSP header, which is why uploads kept working there.) `csp.mjs`
  now derives the exact bucket origin from
  `THINGTIME_PRIVATE_S3_BUCKET`/`_REGION` at build time, with a regional
  `*.s3.<region>.amazonaws.com` wildcard fallback when the env is absent.
  Verified via S3 preflight (bucket CORS already allowed the preview origins
  — only the page policy blocked the connection). — Claude (AI), 2026-08-19
- **Cross-tab persisted Thingtime state (PR #92)**: same-origin tabs now share
  each successfully applied path-level write through one
  `BroadcastChannel('thingtime')`, reusing the active safe Thingtime codec and
  existing mutation queue. Remote writes skip the local undo timeline and
  cannot echo; root `timemachine` metadata stays tab-local while ordinary paths
  restored by undo/redo still converge. The debounced latest-revision
  LocalForage autosave remains the only persistence path. This prevents a stale
  open tab's next full-tree save from silently reverting newer drawer,
  Commander, Content, or preference changes made elsewhere. See the
  [PR #92 implementation note](../PRs/92-claude-cross-tab-thingtime-sync-s4--cross-tab-sync-for-persisted-thingtime-state.md).
  — Claude (AI), 2026-08-20
- **Cross-tab sync excludes view chrome (PR #92 review)**: writes that describe
  what is open and focused in the current viewport — `settings.drawer.open` and
  `settings.commander.<id>.commanderActive` — now pass `{ tabLocal: true }` to
  `setThingtime`, which suppresses only the broadcast. Because `commanderId` is
  a literal shared by every tab, broadcasting them let one tab toggle another's
  palette and drawer; closing the palette in one tab ran the peer's toggle
  effect, which clears its input under the default `clearCommanderOnToggle`,
  destroying a query being typed there. All of it is still persisted, so a
  reload restores it as before, and drawer width/direction/ordering and the
  Commander's own preferences keep syncing. — Lopu (AI), 2026-08-30
- **Cross-tab sync also excludes the drawer's selected section (PR #92 review)**:
  `settings.drawer.selectedItem` now passes `{ tabLocal: true }` too. It is not a
  preference — `DrawerContent` writes it from the current tab's `pathname`, so
  two tabs on two routes hold two legitimately correct selections. Broadcasting
  it swapped a peer's drawer to a section that peer was not on, and nothing there
  restored it: the pathname-sync effect re-runs only on
  `pathname`/`open`/`variant`/`loading` — none of which a remote write touches —
  and returns early while that peer's drawer is closed. Still persisted, so each
  tab's reload restores the section it last chose. The call-site guard test now
  covers `open` and `selectedItem` together. — Lopu (AI), 2026-08-30
- **Cross-tab sync excludes the editor's open-config handoff (PR #92 review)**:
  both `settings.editor.openConfig` writes — the drawer's set and `EditorSplit`'s
  consuming clear — now pass `{ tabLocal: true }`. An earlier note called this key
  harmless because it is only read on mount; that was wrong. `openedConfigRef` is
  a per-mount latch and the effect re-runs on the value, so a tab already on
  `/editor` that had not yet consumed an intent would apply a *remote* config over
  its own open windows. The key is a handoff to the writing tab's next navigation
  (when the editor is already mounted the drawer uses the tab-local events bus
  instead). Clearing had to be suppressed too, or consuming one tab's intent would
  erase an intent another tab had not navigated to yet. — Lopu (AI), 2026-08-30
- **Cross-tab sync excludes the DevKit form prefills (PR #92 review)**: both
  `devKit.registerPrefill` and `devKit.loginPrefill` now pass `{ tabLocal: true }`.
  A prefill fills the form in front of *that* DevKit, and `root.tsx` renders
  DevKit for every session (not dev-only). `Login`/`Register` consume it from an
  effect keyed on `_ts` — a fresh `Date.now()` per click, so it always re-fires —
  meaning one click replaced the username/email/password a peer tab had typed
  into its own form and called `setPasswordVisible(true)` there. Still persisted,
  so the same DevKit still prefills after a reload. — Lopu (AI), 2026-08-30
- **A broadcast failure can no longer discard a local write (PR #92 review)**:
  `flushSetThingtimeQueue` published inside the callback whose return value *is*
  the new state, and `drainThingtimeMutationQueue` drops any update whose apply
  throws — so a throw on the publish path would have silently rolled back a write
  that had already applied. The channel catches internally today, so this was not
  a live defect; the publish is now contained in its own `try` so that stays true
  independently of the transport. Sync is best-effort, the local write is not.
  — Lopu (AI), 2026-08-30
- **The composer's spent-draft clear is tab-local too (PR #92 review)**: the
  post-submit `setThingtime('tmp.<draftSessionId>', {})` was the one half of the
  `tmp` branch still on the wire — its sibling seed had already been made
  `tabLocal`. `draftSessionId` is minted per mount, so the key names the writing
  tab's own composer session and no peer owns one: it could not destroy a peer
  draft, but it did land a foreign `s<hex>` branch in every other tab, which that
  tab then persisted in its next full-tree autosave and displayed under `tt.tmp`
  in the tree editor until its own next composer mount pruned it. Local clear and
  persistence are unchanged; only the broadcast is suppressed. The composer guard
  test now asserts the seed and the clear together so the pair cannot drift again.
  — Lopu (AI), 2026-08-30
- **iOS build 14 TestFlight delivery**: rebuilt the production native shell
  with the drawer and media-capture fixes, verified the signed IPA metadata and
  privacy descriptions, and published build 14 for internal TestFlight testing.
  — Codex (AI), 2026-08-18

### Performance

- **PR #299 performance audit — findings, notes and fixes**: full ten-dimension
  audit of the codebase with every finding adversarially verified against the
  real source (74 raw → 63 confirmed, 11 refuted); see
  `PRs/299-claude-thingtime-performance-optimization-55ea95-performance-audit-findings-notes-and-fixes.md`
  for the complete record. Landed this round: route-level code splitting plus
  removal of the never-rendered FontAwesome solid set, taking the entry chunk
  from 1,165 KB to 168 KB gzipped (−86%); `resolveSessionUser` now resolves
  session, user and subscription concurrently, turning three sequential Mongo
  round trips into one on every authenticated request; `useRecentReactions`
  shares a single fetch across all consumers (8 → 1 identical requests per page,
  ~40 → 1 on a 20-post feed); chat-member writes batch into one `insertMany`
  (50 → 1 round trips per add); `toPublicPosts` overlaps attachment and profile
  resolution; and the notifications bell no longer polls hidden tabs.
  — Claude (AI), 2026-08-18
- **PR #299 performance audit, round two**: content-hashed `/assets/` now ship
  `immutable` caching (index.html's ~80 eagerly-referenced chunks stopped costing
  a conditional GET per repeat visit, restoring the zero-network disk-cache
  path); the comment permalink's ancestor ACL checks share one batched lookup
  (was n + n(n-1)/2 sequential round trips at nesting depth n); search result
  pages use the same batched walk; a partial index backs the unread-notification
  badge so the count no longer fetches every notification a user ever received;
  `buildSummaryContext` resolves in 3 dependency stages instead of 6 serial ones;
  the messenger access gate resolves chat and membership together; and the
  `/api/docs` render cache is LRU-bounded (it was keyed by the caller-controlled
  Host header). — Claude (AI), 2026-08-18
- **PR #299 performance audit, round three**: `resolveRelated`'s child reads are
  projected (dropping each comment's `extended` sidecar, up to 512KB per doc)
  and the reply aggregate projects before `$group`, removing a 100MB
  `$group`-cap failure mode on large threads; a `{kind, createdAt, shareId}`
  index gives the dual-era post match a sortable v1 branch, so the feed stops
  fetching every visible post and sorting in memory; a sparse `shareOfId` index
  turns the live share-count aggregation from a full collection scan into an
  indexed lookup on every feed page, post read and reaction toggle; chat member
  existence checks batch into two queries; and the feed's post row is memoized
  so `PostCard`'s `React.memo` actually hits. — Claude (AI), 2026-08-18
- **PR #299 independent review**: every push was re-reviewed by a second
  session (verification record in the PR note's "Review record" section);
  no invalid changes found. One hardening landed from review:
  `insertChatMembers` rethrows bulk write-concern failures instead of
  swallowing them with the benign duplicate-key races, matching the old
  per-id `insertOne` semantics. The `readAt: null` partial-index spec was
  confirmed against the production cluster's MongoDB 8.0.1.
  — Claude (AI), 2026-08-18
- **PR #299 follow-up review**: `resolveRelated`'s narrow child projection now
  retains `crystal.mediaLayout`, so rich comments keep their selected Rows/Grid
  layout across feed, profile, and permalink reloads instead of silently
  falling back to masonry. A focused projection-contract regression test covers
  every direct-comment and eagerly shipped reply-level use of that field.
  — Codex (AI), 2026-08-24

### Added

- **Open Graph / Twitter cards for shared links**: the Nitro page catch-all
  (`server/routes/[...].ts`) now injects per-request social meta into the SPA
  shell's new `tt-social-meta` head block (`remix/index.html`), built by
  `app/api/utils/meta/socialMeta.ts` — `/post/:id` gets author + text/poll
  tags with the first image attachment (public `tt:all` posts only; private or
  missing posts fail closed to the generic site block), `/profile/:username`
  gets displayName/bio/avatar tags, and every other page gets site defaults
  with request-derived absolute URLs. Deployment wiring:
  `scripts/patch-vercel-output.mjs` routes the two permalink patterns to the
  Nitro `__server` function (everything else stays on the static shell),
  `scripts/verify-vercel-output.mjs` asserts that routing, and
  `nitro.config.ts` gained an explicit `assets:shell` server-assets mount
  because nitro 3's default `assets:server` mount no longer resolves to
  `server/assets`. Note: the shell handler always answers 200 — h3 2.x treats
  a 404 middleware Response as "unhandled" and would fall through to the raw
  source template. Verification recipe lives in `TESTING.md` ("Social meta /
  link unfurls"). — Claude (AI), 2026-08-19

- **Login with Thingtime anywhere (federated hints + SSO handoff + FedCM).**
  Three layers, all powered by the browser's own sessions — never a central
  session store. (1) _Federated hint resolution_: `/api/v1/auth/account-hints`
  now reports foreign-database origins as `unresolved`, and the client fans
  out to each origin's new `/account-hints/resolve` (CORS restricted to the
  Thingtime family, credentialed, read-only) so every environment vouches
  only for its own sessions. (2) _Cross-origin session handoff_: a signed-in
  surface mints a 2-minute, aud-bound, single-use code
  (`POST /api/v1/auth/sso-handoff`) that a Thingtime deployment OUTSIDE the
  cookie family (immutable `*.vercel.app` previews) redeems at its own
  `POST /api/v1/auth/sso-session` for a first-class session — replay revokes
  the session (theft signal), different-environment redemption fails closed;
  the `/authorize?self=1` popup ("Continue to <host>?") and a
  "Sign in with Thingtime 🌈" card on foreign origins drive it. (3) _FedCM
  identity provider_: `/.well-known/web-identity` + config/accounts/
  client-metadata/assertion endpoints let Chromium render its native
  "Continue as…" sheet on any domain from the switcher roster
  (`Sec-Fetch-Dest: webidentity` enforced, roster ownership re-checked,
  assertion mints handoff codes for Thingtime-self or baseline app tokens for
  registered clients). E2E: `remix/scripts/verify-federated-login.mjs` — 31
  checks against two stacks on separate mongods, including the full
  FedCM→assertion→session loop. — Claude (AI), 2026-08-19

- **Passkeys (WebAuthn) + cross-deployment auto-login.** Full passkey support:
  password-confirmed registration (`POST /api/v1/auth/passkeys/register-options`
  → `/register`), usernameless discoverable login (`/login-options` → `/login`,
  bypasses email-OTP by design, sessions carry `meta.method: "passkey"`), and a
  Settings → Security manager (nicknames, descriptions, provider names derived
  from authenticator AAGUIDs, created/last-used dates, linked apps, revoke +
  delete, both password-confirmed). rpID is `thingtime.com` for every
  `*.thingtime.com` deployment so one passkey works on production, dev, and
  previews; conditional-UI autofill (`autocomplete="username webauthn"` +
  `mediation: conditional`) surfaces the native iCloud Keychain / 1Password
  popups on the login form. Credentials are protected `passkey` things (secure
  blob + uniqueKeys, HOME collection — a `tt_mongo` override can never capture
  or plant credentials); usage records are `passkey-app-link` child things.
  Auto-login: every sign-in writes a `{rosterId, origin}` pointer into the
  `Domain=.thingtime.com` `tt_hints` cookie; `GET /api/v1/auth/account-hints`
  resolves pointers live (same roster/session chokepoints as the switcher) so
  signed-out visitors get a "Continue as…" popup listing accounts with live
  sessions on other deployments — picking one still requires that account's
  password or passkey. E2E-verified by `remix/scripts/verify-passkeys.mjs`, a
  software WebAuthn authenticator (P-256 + CBOR) driving the real API (44
  checks). — Claude (AI), 2026-08-19

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
  (`GET /api/v1/moderation/sweep`, `CRON_SECRET` bearer, vercel.json minute 29) retries text moderation lost to mid-flight process deaths or provider
  outages and drains off-era backlog for free, plus the standard attachment
  sweep; the admin sweep button runs both batches and the tab shows the text
  backlog count. Post creation adds a hybrid sync gate: the free omni screen
  races `TT_TEXT_SCREEN_BUDGET_MS` (default 600ms, `0` disables) before the
  insert so flagged posts are born stamped (blocked content never renders,
  even briefly), while timeouts/outages produce owner-private pending posts
  for the async pipeline — moderation can never break posting; a per-instance circuit breaker
  (3 failures → open, 60s cooldown) skips the omni call during confirmed
  outages. Fail-closed (owner decision 2026-08-19): when no sync verdict is
  obtainable while the surface is on, posts are born PENDING — owner-private
  until the async queue / hourly cron screens and releases them (creation
  notifications fire at release); `TT_TEXT_SCREEN_BUDGET_MS=0` becomes
  async-release mode, and the off sweep releases stranded pending docs. Screening now covers ALL omni-judgeable post content in one
  combined free request: prose + listing text + tags + legacy external image
  URLs (`crystal.images`, cap 8), closing the unmoderated URL-photos gap.
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

- **iOS build 14 TestFlight delivery**: rebuilt the production native shell
  with the drawer and media-capture fixes, verified the signed IPA metadata and
  privacy descriptions, and published build 14 for internal TestFlight testing.
  — Codex (AI), 2026-08-18

### Performance

- **PR #299 performance audit — findings, notes and fixes**: full ten-dimension
  audit of the codebase with every finding adversarially verified against the
  real source (74 raw → 63 confirmed, 11 refuted); see
  `PRs/299-claude-thingtime-performance-optimization-55ea95-performance-audit-findings-notes-and-fixes.md`
  for the complete record. Landed this round: route-level code splitting plus
  removal of the never-rendered FontAwesome solid set, taking the entry chunk
  from 1,165 KB to 168 KB gzipped (−86%); `resolveSessionUser` now resolves
  session, user and subscription concurrently, turning three sequential Mongo
  round trips into one on every authenticated request; `useRecentReactions`
  shares a single fetch across all consumers (8 → 1 identical requests per page,
  ~40 → 1 on a 20-post feed); chat-member writes batch into one `insertMany`
  (50 → 1 round trips per add); `toPublicPosts` overlaps attachment and profile
  resolution; and the notifications bell no longer polls hidden tabs.
  — Claude (AI), 2026-08-18
- **PR #299 performance audit, round two**: content-hashed `/assets/` now ship
  `immutable` caching (index.html's ~80 eagerly-referenced chunks stopped costing
  a conditional GET per repeat visit, restoring the zero-network disk-cache
  path); the comment permalink's ancestor ACL checks share one batched lookup
  (was n + n(n-1)/2 sequential round trips at nesting depth n); search result
  pages use the same batched walk; a partial index backs the unread-notification
  badge so the count no longer fetches every notification a user ever received;
  `buildSummaryContext` resolves in 3 dependency stages instead of 6 serial ones;
  the messenger access gate resolves chat and membership together; and the
  `/api/docs` render cache is LRU-bounded (it was keyed by the caller-controlled
  Host header). — Claude (AI), 2026-08-18
- **PR #299 performance audit, round three**: `resolveRelated`'s child reads are
  projected (dropping each comment's `extended` sidecar, up to 512KB per doc)
  and the reply aggregate projects before `$group`, removing a 100MB
  `$group`-cap failure mode on large threads; a `{kind, createdAt, shareId}`
  index gives the dual-era post match a sortable v1 branch, so the feed stops
  fetching every visible post and sorting in memory; a sparse `shareOfId` index
  turns the live share-count aggregation from a full collection scan into an
  indexed lookup on every feed page, post read and reaction toggle; chat member
  existence checks batch into two queries; and the feed's post row is memoized
  so `PostCard`'s `React.memo` actually hits. — Claude (AI), 2026-08-18
- **PR #299 independent review**: every push was re-reviewed by a second
  session (verification record in the PR note's "Review record" section);
  no invalid changes found. One hardening landed from review:
  `insertChatMembers` rethrows bulk write-concern failures instead of
  swallowing them with the benign duplicate-key races, matching the old
  per-id `insertOne` semantics. The `readAt: null` partial-index spec was
  confirmed against the production cluster's MongoDB 8.0.1.
  — Claude (AI), 2026-08-18
- **PR #299 follow-up review**: `resolveRelated`'s narrow child projection now
  retains `crystal.mediaLayout`, so rich comments keep their selected Rows/Grid
  layout across feed, profile, and permalink reloads instead of silently
  falling back to masonry. A focused projection-contract regression test covers
  every direct-comment and eagerly shipped reply-level use of that field.
  — Codex (AI), 2026-08-24

### Added

- **Login with Thingtime anywhere (federated hints + SSO handoff + FedCM).**
  Three layers, all powered by the browser's own sessions — never a central
  session store. (1) _Federated hint resolution_: `/api/v1/auth/account-hints`
  now reports foreign-database origins as `unresolved`, and the client fans
  out to each origin's new `/account-hints/resolve` (CORS restricted to the
  Thingtime family, credentialed, read-only) so every environment vouches
  only for its own sessions. (2) _Cross-origin session handoff_: a signed-in
  surface mints a 2-minute, aud-bound, single-use code
  (`POST /api/v1/auth/sso-handoff`) that a Thingtime deployment OUTSIDE the
  cookie family (immutable `*.vercel.app` previews) redeems at its own
  `POST /api/v1/auth/sso-session` for a first-class session — replay revokes
  the session (theft signal), different-environment redemption fails closed;
  the `/authorize?self=1` popup ("Continue to <host>?") and a
  "Sign in with Thingtime 🌈" card on foreign origins drive it. (3) _FedCM
  identity provider_: `/.well-known/web-identity` + config/accounts/
  client-metadata/assertion endpoints let Chromium render its native
  "Continue as…" sheet on any domain from the switcher roster
  (`Sec-Fetch-Dest: webidentity` enforced, roster ownership re-checked,
  assertion mints handoff codes for Thingtime-self or baseline app tokens for
  registered clients). E2E: `remix/scripts/verify-federated-login.mjs` — 31
  checks against two stacks on separate mongods, including the full
  FedCM→assertion→session loop. — Claude (AI), 2026-08-19

- **Passkeys (WebAuthn) + cross-deployment auto-login.** Full passkey support:
  password-confirmed registration (`POST /api/v1/auth/passkeys/register-options`
  → `/register`), usernameless discoverable login (`/login-options` → `/login`,
  bypasses email-OTP by design, sessions carry `meta.method: "passkey"`), and a
  Settings → Security manager (nicknames, descriptions, provider names derived
  from authenticator AAGUIDs, created/last-used dates, linked apps, revoke +
  delete, both password-confirmed). rpID is `thingtime.com` for every
  `*.thingtime.com` deployment so one passkey works on production, dev, and
  previews; conditional-UI autofill (`autocomplete="username webauthn"` +
  `mediation: conditional`) surfaces the native iCloud Keychain / 1Password
  popups on the login form. Credentials are protected `passkey` things (secure
  blob + uniqueKeys, HOME collection — a `tt_mongo` override can never capture
  or plant credentials); usage records are `passkey-app-link` child things.
  Auto-login: every sign-in writes a `{rosterId, origin}` pointer into the
  `Domain=.thingtime.com` `tt_hints` cookie; `GET /api/v1/auth/account-hints`
  resolves pointers live (same roster/session chokepoints as the switcher) so
  signed-out visitors get a "Continue as…" popup listing accounts with live
  sessions on other deployments — picking one still requires that account's
  password or passkey. E2E-verified by `remix/scripts/verify-passkeys.mjs`, a
  software WebAuthn authenticator (P-256 + CBOR) driving the real API (44
  checks). — Claude (AI), 2026-08-19

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
  (`GET /api/v1/moderation/sweep`, `CRON_SECRET` bearer, vercel.json minute 29) retries text moderation lost to mid-flight process deaths or provider
  outages and drains off-era backlog for free, plus the standard attachment
  sweep; the admin sweep button runs both batches and the tab shows the text
  backlog count. Post creation adds a hybrid sync gate: the free omni screen
  races `TT_TEXT_SCREEN_BUDGET_MS` (default 600ms, `0` disables) before the
  insert so flagged posts are born stamped (blocked content never renders,
  even briefly), while timeouts/outages produce owner-private pending posts
  for the async pipeline — moderation can never break posting; a per-instance circuit breaker
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

### Security

- **Crystal namespace reopened after structural uniqueness migration**: once
  phase 1 has replaced every relationship crystal-path unique index and the
  relationship `uniqueKeys` backfill has converged, free-form data may again
  use `followKey`, `friendKey`, `memberKey`, `dmKey`, `inviteCode`,
  `emojiKey`, and `voteKey`. Those values enter no platform unique index;
  system dedupe remains exclusively in protected server-owned `uniqueKeys`.
  — Codex (AI), 2026-08-21

- **Relationship uniqueness is structural across all reserved key families**:
  follow, friend, member, DM, invite, emoji, and vote dedupe now rides the
  protected root `uniqueKeys` namespace. Boot-time index convergence replaces
  every kind-blind crystal-path unique index with a non-unique lookup, and the
  idempotent backfill stamps legacy relationship docs while only reporting
  suspicious free-form data. The vote family is migrated as security
  substrate without shipping the deferred polls product; boot convergence also
  removes the superseded `crystal.follow` marker index that no current writer
  uses. — Codex (AI), 2026-08-21

- **Moderation reconciliation and pending-media quarantine**: replayed the
  NSFW/TOS pipeline onto the singular public/private/all upload-permission
  model with no legacy one-boolean gate dependency. Attachment completion now
  atomically records `pending`; pending and blocked media are absent from
  public projections/content routes while owner/admin evidence access and
  bounded sweep recovery remain available. Generic Things writes cannot forge
  root moderation state or moderation-flag control Things, and deterministic
  flag-id collisions leave ordinary user Things untouched for operator
  review. — Codex (AI), 2026-08-21

- **Relationship uniqueness is structural across all reserved key families**:
  follow, friend, member, DM, invite, emoji, and vote dedupe now rides the
  protected root `uniqueKeys` namespace. Boot-time index convergence replaces
  every kind-blind crystal-path unique index with a non-unique lookup, and the
  idempotent backfill stamps legacy relationship docs while only reporting
  suspicious free-form data. The vote family is migrated as security
  substrate without shipping the deferred polls product; boot convergence also
  removes the superseded `crystal.follow` marker index that no current writer
  uses. — Codex (AI), 2026-08-21

- **Canonical scoped-upload UX reconciliation**: every attachment picker now
  reads the existing public/private approval booleans directly and shows a
  purpose-specific approval card when its scope is withheld. The obsolete
  one-boolean upload alias is not retained. Revoking a scope disables new file
  starts without hiding finish, retry, or cleanup controls for a draft already
  in progress. — Codex (AI), 2026-08-21

- **Upload approval now has public / private / all scopes**: the
  signup-permissions gate is split into two independent tri-state flags —
  `meta.publicUploads` (post/comment/custom-emoji attachments) and the new
  `meta.privateUploads` (message attachments + own profile media) — both
  stamped `false` at registration and both privileged meta keys. The upload
  start gate is purpose-aware (`403 public_uploads_not_approved` /
  `private_uploads_not_approved`), `POST /api/v1/admin/users/public-uploads`
  accepts `scope: 'public' | 'private' | 'all'` (default `public`, wire-
  compatible), and the /admin Users tab's control becomes an Approve menu with
  per-scope and enable/withhold-all actions plus per-scope pending flags.
  Grandfathering and the admin bypass are unchanged. — Claude (AI), 2026-08-18

- **New signups no longer receive public upload permissions**: accounts created
  from this change forward start with `meta.publicUploads: false`, and verifying
  the email address no longer grants uploads. `POST /api/v1/attachments/uploads`
  fails closed with `403 public_uploads_not_approved` until an administrator
  enables the account, so no upload is reserved and no MPU is opened. Once a new
  account verifies its email, an `admin.new_user` notification carrying the
  account details goes to `THINGTIME_ADMIN_NOTIFICATION_EMAIL` (default
  `admin@thingtime.com`), and the **/admin → Users** tab gained an Uploads
  column, a pending-approval banner, and a per-user Enable/Withhold toggle
  backed by `POST /api/v1/admin/users/public-uploads`. The flag is tri-state:
  accounts predating the change have no flag and keep uploading, so no data
  migration is required, and administrators bypass the gate entirely.
  — Claude (AI), 2026-08-18

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

- **Components library (/components) + 1000-component catalog**: new
  first-class `component` thing kind (arg-templated render trees drawn through
  the sanitising allowlist renderers), a /components browse page with a live
  args tester, a hidden per-card Schema expander, and "Save version" (stores
  the tester snapshot as a user-owned component thing). The platform catalog —
  1000 components styled after Ant Design, Bootstrap, MUI, shadcn/ui,
  Untitled UI, daisyUI, React Flow, and the Thingtime house style — lives in
  the repo `components-db/` folder database (deterministic generator under
  `scripts/components-db/`) and seeds into the dev DB as system things via the
  admin `POST /api/v1/admin/components/seed` endpoint (idempotent,
  self-healing, `component-` shareId prefix reserved). Drawer: Schemas moved
  out of Search into its own top-level item, Components added beside it.
  Verification: `remix/scripts/verify-components.mjs` (30 checks) + the new
  Components checklist in `TESTING.md`. Follow-up in the same PR: component
  families — the library renditions of one functional component share a
  crystal `familyKey` and collapse into ONE card with a designs
  click-through (server `group=family` aggregation + `family=` roster
  fetch, client-side collapse for text search), and every family gets its
  own deep-linked page at `/components/<key>` with a `/docs` twin the
  cards' Docs buttons open. The catalog kept growing meanwhile
  (tranche 2: 70 archetypes / 350 families / 2800 components seeded, every
  one tagged "Made by Fable 5 Ultracode" and surfaced as tag chips on cards
  and detail pages). — Claude (AI), 2026-08-17

### Fixed

- **PR #99 final security reconciliation**: the current Thingtime serializer
  now treats persisted state strictly as data—functions are omitted on write,
  every legacy function tag is removed without compilation, code-defined
  defaults refill runtime behavior, and graph-aware repair preserves circular
  aliases. Explicit Date tags and data-first legacy handling stop repeated
  hydration from changing ordinary text. The strict app CSP now loads preview
  freshness from external `/tt-preview-freshness.js`, while active Commander
  assignments parse data literals without `eval`. Registration preserves the
  existing shared limiter (10 per 15 minutes) and adds only the shared 16 KiB
  streaming body cap. — Codex (AI), 2026-08-18
- **Posts, Messenger, and persistent device mirrors share the exact account
  quota**: every user-owned Messenger row—including chats, messages,
  communities, memberships, follows, and imported AI history—now carries the
  canonical content-byte stamp and changes the subscription ledger in the same
  Mongo transaction as its write. Persistent protected device mirror rows use
  the same accounted-Thing admission path. Attachments remain separately
  metered by their protected object-backed Things, while transient command and
  event delivery is count/byte bounded and TTL-expiring. Storage accounting v2
  forces the idempotent whole-account backfill to recount legacy posts and
  Messenger content; identical AI re-imports add zero bytes, and quota failures
  roll back related container/membership, send, delete, invite, and section
  mutations rather than leaving partial or unmetered rows. See the
  [PR #68 implementation notes](../PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md).
  — Codex (AI), 2026-08-19
- **Native iOS drawer and media capture**: the iOS WebView now uses the same
  fixed drawer trigger as mobile web, so opening the drawer keeps its close
  control inside the panel instead of translating it with the top nav. The
  generated app Info.plist now declares camera, microphone, and photo-library
  purpose strings so WebKit's Take Photo or Video flow requests permission
  instead of terminating the app. — Codex (AI), 2026-08-17
- **Develop preview exact-SHA rebuilds**: repository-root Vercel ignore logic
  now lets the controller build an already-previewed commit in the isolated
  `develop` Custom Environment instead of canceling it as a duplicate, while
  the thin `github-actions` control plane remains excluded before every other
  rule. — Codex (AI), 2026-08-17
- **Manual develop-preview recovery reaches its controller**: the thin `main`
  listener now converts `workflow_dispatch`'s string PR number to the numeric
  input required by the protected reusable workflow. Manual recovery no longer
  fails before GitHub can create a controller job, and the caller contract now
  locks that typed boundary. — Codex (AI), 2026-08-17
- **Vercel status in custom environments**: deployment status now checks
  Vercel's system environment and custom target independently, so the
  Preview-backed `develop` target keeps `/api/v1/vercel/status`, `/status`, and
  the footer status enabled without a dashboard override. The API and root-data
  paths now share one tested feature gate. — Codex (AI), 2026-08-17
- **Accurate attachment quota recovery**: upload preparation now preserves
  bounded storage failure codes through the API and distinguishes a full
  account tier from missing environment configuration, temporary private
  storage outages, and storage-accounting reconciliation. Every shared media
  picker uses the current account allowance as a safe fallback and tells users
  to delete stored media or upgrade their tier instead of incorrectly claiming
  that uploads are unavailable in the environment. File-row errors now span
  the available width on narrow screens instead of being squeezed between the
  preview and action controls. Unexpected server, ledger, proxy, and provider
  detail remains hidden. See the
  [PR #237 implementation notes](../PRs/237-codex-conversation-media-attachments--add-media-attachments-across-conversations.md).
  — Codex (AI), 2026-08-11

### Added

- **Thingtime desktop mesh nodes and live AI sessions**: a signed, persistent
  macOS node now pairs to a user account, mirrors bounded device/app/permission
  state into protected `/things` device views, leases an exact allowlist of
  idempotent commands, and keeps remote mutations behind lock, capability, and
  approval gates. Messenger distinguishes imported history from live sessions:
  the native Codex app-server connector lists/reads/creates chats, queues or
  steers messages, interrupts turns, forwards safe visible deltas, and brokers
  approvals; semantic Accessibility connectors for ChatGPT and Claude expose
  only already-visible user/assistant chat content and require one-time approval
  for mutation. Completed visible messages become quota-accounted relational
  Messenger rows while transient stream/control events expire separately.
  Electron embeds the same-team signed node and bounded runtime; local paths,
  credentials, cookies, hidden reasoning, and tool arguments/results never
  enter Thingtime. A gated view-only ScreenCaptureKit primitive is included,
  but the UI remains explicitly unavailable until a real peer media transport
  is installed. The current delivery checkpoint proves the byte-identical local
  Apple Development package/install and that its launchd node plus connector
  survive Electron Cmd+Q; authenticated pairing and TCC-protected real-operation
  acceptance remain open. The stale protected workflow still requires its
  Developer ID/notarization patch before production. See the
  [PR #68 implementation notes](../PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md).
  — Codex (AI), 2026-08-19
- **Native iOS per-branch deployment history**: the Vercel deployments API now
  preserves its existing latest-per-branch response while optionally returning
  a bounded newest-first history for each branch. The native Web destination
  drawer presents that history as a second disclosure level, marks the most
  recent ready deployment as `Last successful` when a newer build is queued,
  and keeps every specific deployment URL directly selectable. Signed iOS
  build 15 targets the matching branch preview and is available to internal
  TestFlight testers. — Codex (AI), 2026-08-18
- **ChatGPT and Claude desktop history in Messenger**: the Electron app now
  discovers local ChatGPT Work/Codex sessions plus the main and Thingtime
  Claude desktop profiles, accepts official ChatGPT/Claude JSON or ZIP exports,
  and streams bounded normalized batches through a narrow preload bridge into
  the authenticated Messenger API. Projects map to Spaces, conversations to
  chats/channels, and provider messages to read-only relational rows with
  owner-scoped idempotency keys, native source badges, progress UI, and no
  credential, cookie, hidden-reasoning, tool-traffic, or raw-path exposure.
  Users can react, thread, and reply inside Thingtime without posting back to
  the provider. See the
  [PR #68 implementation notes](../PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md).
  — Codex (AI), 2026-08-17
- **Recoverable first-session Things space**: a fresh browser can land on
  `/things` and immediately receive the real Things UI through a rate-limited
  temporary user Thing, bounded subscription, normal browser session, and
  account-switcher roster entry. The pre-paint bootstrap is idempotent,
  preserves existing signed-in users, retains ordinary ACL/quota enforcement,
  and leaves login/register reachable so the browser can add another account
  without discarding its temporary space. Temporary sessions now retain the
  standard logged-out `Login` navigation while every visible identity surface
  presents `Anonymous` and `Login to claim`, never the generated guest handle
  or placeholder email. — Codex (AI), 2026-08-12
- **Per-automation GitHub/Vercel compute routing**: Admin → CI Control can now
  keep each supported automation on GitHub-hosted runners or move its expensive
  work to an ephemeral Vercel Sandbox with one toggle. A signed, idempotent
  provider route starts a durable Vercel Workflow, registers a uniquely labelled
  self-hosted runner, dispatches the exact protected `github-actions` workflow,
  projects its status history, and removes the runner/Sandbox afterward. Native
  trigger routing fails over to GitHub compute when the external path is not
  configured or is unavailable; Docker-backed Web CI and native Electron builds
  remain explicitly GitHub-only. Fork-safe App permissions, secrets, bootstrap,
  first-Reconcile behavior, and regression checks are documented in
  README/TESTING. — Codex (AI), 2026-08-10
- **Conversation media, file attachments, and S3 custom reactions**: rich
  comments and replies now use the same gallery-style linked-media and private
  upload UI as posts, while DMs, groups, requests, community channels, inline
  replies, and Slack-style threads can send image, video, audio, or generic
  files—including attachment-only messages. Stable owner-scoped request ids,
  atomic purpose/target binding, exact lost-response reconciliation, inherited
  comment ACLs, current-chat membership checks, nested cascade cleanup, and
  exact-version deletion keep storage private and tier accounting fail-closed.
  Custom reaction emoji now bind quota-accounted GIF/PNG/JPEG/WebP uploads
  instead of accepting new inline base64 payloads; legacy emoji remain
  read-compatible. See the
  [PR #237 implementation notes](../PRs/237-codex-conversation-media-attachments--add-media-attachments-across-conversations.md).
  — Codex (AI), 2026-08-10
- **Gallery-style post and profile media**: post photo links now use responsive
  preview tiles with stable multi-line URL add, deduplication, credential-free
  http(s) validation, and no-referrer previews, while private image/video/file
  uploads use a Facebook-like `🏞️ Add Media` tile without removing the
  quota-saving URL option. Avatar and banner editors in both Profile and
  Settings can now upload safe raster images through the same private,
  checksummed S3 pipeline or retain an external URL. Profile attachment purpose
  and slot are server-owned; ready media binds to the exact owner/user slot in
  the profile transaction, renders through the stable same-origin content
  route, and old bytes remain billed until exact-version cleanup. Ordinary PR
  Previews now explain that private storage is unavailable there without
  exposing provider errors; the develop Custom Environment remains the secure
  positive upload target. See the
  [PR #232 implementation notes](../PRs/232-codex-media-gallery-profile-attachments--add-media-galleries-and-managed-profile-attachments.md).
  — Codex (AI), 2026-08-09
- **Isolated develop S3 attachment environment**: `dev.thingtime.com` now maps
  to a branch-tracked Vercel Custom Environment named `develop`, with its own
  private bucket, exact-subject OIDC role, dev-origin-only CORS, Sensitive S3
  variables, and cleanup secret. Generic feature previews receive no attachment
  configuration and their shared Preview OIDC identity cannot assume the
  develop role. Because Vercel Cron runs Production only, a one-purpose AWS
  EventBridge API Destination is configured to invoke develop cleanup hourly;
  its first successful invocation and the positive upload/delete smoke wait for
  this PR's routes to be deployed to `develop`. Production bucket configuration,
  variables, and objects remain unchanged; its role gained the required
  `s3:PutObjectTagging` action used by Thingtime's tagged multipart start. —
  Codex (AI), 2026-08-09
- **Private S3 post attachments with exact tier accounting**: posts can upload
  images, video, audio, and generic files directly through checksummed multipart
  S3 uploads without exposing AWS credentials or public objects. Protected
  relational attachment Things reserve verified object bytes against the same
  transactional account storage ledger as Mongo content, stable authorized
  content routes replace persisted presigned URLs, and unsafe active content is
  forced to download. S3 VersionIds keep sniff/tag/read/delete pinned to the
  exact verified object version before quota refund, stable client request ids
  make ambiguous upload starts idempotent, and an hourly bounded cron safely
  retries expired or crash-interrupted cleanup behind a lifecycle-backed,
  two-pass multipart settlement fence. Production uses an exact-subject Vercel
  OIDC role and server-only `THINGTIME_PRIVATE_*` configuration; comments and
  messenger/thread surfaces remain intentionally unchanged in this post-only
  scope. See the
  [PR #201 implementation notes](../PRs/201-codex-s3-post-attachments--add-private-s3-post-attachments-with-tier-accounting.md).
  — Codex (AI), 2026-08-09
- **One GitHub Actions control plane + Admin CI dashboard**: executable CI,
  promotion, sync, release, rebase, and AI conflict-resolution behavior now
  lives on the protected `github-actions` branch. `main`/`develop` retain only
  GitHub-required trigger/input/permission callers pinned to that branch, with
  a regression contract that rejects runner steps or local Actions scripts.
  Admin → CI Control renders cached feature/branch/PR/run/deployment/preview
  topology, signed GitHub/Vercel webhook freshness, relational status history,
  GitHub App reconciliation, and allowlisted audited dispatch controls across
  desktop and mobile. All current projections and append-only events are
  protected, system-owned, non-billable Things. Fork-safe App/webhook setup and
  failure-preserving verification are documented in README/TESTING. Reconcile
  pagination covers repositories with more than 100 branches, and administrator
  dispatches can enter only through the reviewed `develop`/`main` listeners. —
  Codex (AI), 2026-08-09

### Fixed

- **Repository-root Vercel builds preserve the app's pnpm pin and function
  aliases**: the root package now declares pnpm 10.12.1 to match Remix, so
  Corepack cannot select Vercel's newer global pnpm before entering the nested
  workspace. Output promotion preserves Nitro's relative function symlinks,
  keeping route aliases inside the root artifact instead of pointing back into
  `remix/.vercel/output`. The deployment contract covers both invariants. —
  Codex (AI), 2026-08-17
- **Vercel builds now start at the repository root without deploying the thin
  CI branch**: root `vercel.json` installs only the Remix workspace, a tested
  wrapper preserves the existing Vite/Nitro verification before staging the
  Build Output API artifact at root `.vercel/output`, and the attachment-cleanup
  and weekly-summary crons now live in that same root config. Both config and the
  ignored-build decision exclude `github-actions`. The matching control-plane
  config disables Git deployments for that branch and its descendants. Setup
  and live verification steps are recorded in README, TESTING, and
  VERCEL_DEPLOYMENTS. — Codex (AI), 2026-08-17
- **Root bootstrap no longer exposes server secrets**: browser-visible loader
  configuration is now built from an explicit status-origin allowlist instead
  of every `THINGTIME_*` variable, and `/api/root-data` is private, no-store,
  and cookie-varying. Regression coverage seeds representative CI, webhook, and
  email HMAC values and proves none cross the server/client boundary. — Codex
  (AI), 2026-08-17

- **Thin Web CI promotion no longer blocks on topology contracts**: the stale
  product-branch copy of the develop-preview controller was removed, the two
  workflow/topology contract commands were removed from the required unit-test
  aggregate, and the thin Web CI listener now delegates PR-warning permission
  to the protected non-blocking advisory job. Real product unit tests, build,
  typecheck diagnostics, API tests, and security checks remain unchanged.
  — Codex (AI), 2026-08-17

- **Mobile Safari Feed controls receive their click and focus events**: the
  global Commander no longer changes Thingtime state from a document-level
  `touchend` before Safari can synthesize the touched control's click. Its
  click-away behavior now waits for `click` / `focusin` and is a no-op while
  Commander is already closed. Editor.js also restores contenteditable focus
  synchronously on a genuine touch release, so the Feed composer opens, accepts
  typing, and leaves adjacent buttons and native inputs interactive in retained
  account sessions. — Codex (AI), 2026-08-15

- **A legacy Lopu browser snapshot is repaired before Feed becomes
  interactive**: Thingtime hydration now reports and removes invalid saved
  functions, commits the repaired snapshot before completing the first load,
  and never persists the provider's live root `set` / `get` React closures.
  Nested user data with those names is preserved. This removes the one-load
  poisoned-state window that could make “What's on your mind?” and adjacent
  inputs appear inert until another tab or reload. — Codex (AI), 2026-08-15

- **Legacy Thingtime function state no longer disables interactive editors**:
  persisted anonymous, arrow, named, method, and scoped functions now revive
  only after Flatted has reconstructed their complete object graph. The parser
  also removes the old saved no-op recovery function so current defaults can
  repair poisoned browser state instead of carrying it into Feed composer and
  other input sessions. — Codex (AI), 2026-08-15

- **Safari-restored Vercel previews now force a real HTML navigation before the
  app can remain inert**: an inline Vite preview freshness bootstrap runs before
  the React application graph, refreshes every preview restored from Safari's
  back/forward page cache, and permits one guarded recovery after a same-build
  asset runtime error. Generated Vercel routes now return the SPA HTML shell
  with `private, no-store` browser headers while leaving versioned assets on the
  filesystem path. — Codex (AI), 2026-08-14

- **Commander History now links searches to the commands they launched**:
  each local search session renders its term plus replayable, de-duplicated
  commands, ordered with the newest executed command first and its search term
  next as a separate full-width top-level result. The compact History view
  keeps the newest eight sessions while Show More expands up to 50 retained sessions, including
  migrated string-only history from earlier builds. The complete legacy
  Raycast extension also moved under `Commander/extensions/raycast/`, keeping
  its image tools and real Open Commander command in Commander's extension tree. See the
  [PR #263 engineering note](../PRs/263-codex-commander-cross-platform--add-cross-platform-commander-launcher.md).
  — Codex (AI), 2026-08-17
- **Commander now ships ready for Thingtime sign-in and paints only its
  rounded launcher surface**: its public production client ID is built in,
  legacy blank settings migrate automatically, and the native WebKit canvas is
  transparent and compositor-masked behind the intentional card and shadow.
  Its windows are draggable, Option-modified physical keys now record as real
  global shortcuts, and a built-in Raycast-shaped Commander extension now
  separates whole-app Close Commander, Close Commander Window, and Open
  Commander lifecycle commands. Every floating-window reopen starts with an
  empty query while device-local recent searches remain first in a persistent
  History section, and the existing Raycast extension can relaunch Commander
  through its own no-view Open Commander command. Command-A now selects the
  complete focused launcher query even though the accessory host has no
  conventional Edit menu. Local verification can also explicitly request
  ad-hoc signing when the configured development key is locked, while
  release/default builds still require the stable Apple Development identity.
  See the
  [PR #263 engineering note](../PRs/263-codex-commander-cross-platform--add-cross-platform-commander-launcher.md).
  — Codex (AI), 2026-08-14

- **Stale Vercel preview tabs recover their interactions after a redeploy**:
  preview-only startup logic compares the loaded hashed Vite entry asset with
  the branch alias's current HTML on load, foreground, and focus, then reloads
  only when the alias has moved. A tab holding the pre-fix Things bundle can no
  longer remain visually rendered but inert after the repaired deployment is
  available; production-domain behavior is unchanged. — Codex (AI), 2026-08-13

- **Things kind grouping no longer crashes populated spaces**: Group by Kind
  now reads section icons from the canonical Thing icon registry instead of a
  removed local binding, with a populated-group runtime regression test in the
  required unit suite. — Codex (AI), 2026-08-12

- **Hosted development isolation docs now match the shared Preview runtime**:
  the runbook records verified `dev.thingtime.com` DNS/ownership/HTTPS and the
  distinct development-versus-Production Atlas/JWT/S3 planes while clarifying
  that generic Preview intentionally shares development MongoDB, JWT, cron,
  and private-S3 configuration. It also documents URI-authoritative MongoDB
  usernames and the live health checks for the canonical `thingtime` database
  without storing credentials. The runbook now records the restored
  branch-scoped `dev.thingtime.com` binding and explains how to verify the
  healthy Cloudflare-to-Vercel ACME delegation in the authoritative DNS
  referral instead of mistaking empty recursive short output for a missing
  record. It separates that corrected live domain state from the #188
  default-branch listener promotion, which merged on 2026-08-17 and put the
  thin listener on `main`. — Codex (AI), 2026-08-12

- **The Thingtime AI preference now reaches the remaining Claude runtime**:
  Lopu musings resolve their Anthropic model from the current Admin waterfall
  on every Claude attempt, just like conflict resolution, rebase repair, and
  semantic Graphify. Named Admin choices override the old environment model;
  the explicit `default` sentinel safely delegates to `LOPU_CLAUDE_MODEL`, and
  the independent OpenAI fallback retains its provider-valid model. Focused
  tests prevent warm runtimes from pinning an earlier Admin choice. — Codex
  (AI), 2026-08-12

- **iOS Vercel destination history is usable at full length**: the native Web
  destination drawer now keeps its controls pinned above a lazy vertical list,
  shows scroll indicators when content exceeds the viewport, and reserves the
  swipe-to-close gesture for predominantly horizontal drags so vertical row
  scrolling remains responsive. TestFlight build 13 includes the fix. — Codex
  (AI), 2026-08-10
- **Develop PR preview DNS publication now tests the live path**: externally
  managed wildcard DNS can remain labelled `misconfigured` by Vercel while the
  required Cloudflare CNAME, delegated ACME validation, and wildcard TLS are
  healthy. The executable controller and reusable workflow now live on the
  protected `github-actions` control plane behind a thin product-branch
  listener. The controller verifies the actual probe CNAME against Vercel's
  recommended target, verifies the assigned alias over HTTPS, and no
  longer claims generic Preview is credential-free when it intentionally uses
  the shared development runtime. The runbook also records the controller's
  team-scoped token boundary accurately. See the
  [PR #233 engineering note](../PRs/233-codex-fix-develop-preview-dns-gate.md)
  and paired [control-plane PR #239](https://github.com/lopugit/thingtime/pull/239).
  — Codex (AI), 2026-08-10
- **Vercel's universal image now boots and tears down GitHub runners reliably**:
  ephemeral CI setup runs GitHub's version-matched dependency installer,
  provides the conventional `/dev/fd` link required by Bash process
  substitution, and establishes a provisional cleanup handle immediately after
  Sandbox creation. ICU or later bootstrap failures can no longer strand an
  offline runner/Sandbox, and the same exact cleanup is preserved after a
  registered job succeeds or fails. Three live canaries proved registration,
  App-authored protected-workflow re-entry, GitHub fallback, successful Vercel
  execution, and final resource deletion. — Codex (AI), 2026-08-10
- **Vercel CI readiness now fails closed across UI, API, and routing**: Admin →
  CI Control no longer reports a runner ready merely because the page is hosted
  by Vercel. One server-derived capability now requires the GitHub App id,
  installation id and private key, provider-router secret, and Vercel runtime
  identity; the badge names incomplete setup, the dropdown stays disabled, and
  direct policy writes receive an authored 409 while existing automation keeps
  its safe GitHub fallback. Focused tests also cover runner identity, job
  completion/failure summaries, and configuration drift. — Codex (AI),
  2026-08-10
- **Develop-preview automation no longer breaks product-branch CI**: the
  develop-preview listener now delegates to the protected `github-actions`
  implementation, and the thin workflow-caller contract rejects every local
  Actions script on product branches. — Codex (AI), 2026-08-10
- **Required Web CI checks no longer strand non-Remix pull requests**: the
  stable product-branch listener is now path-filter-free and grants only the
  read access needed by the protected classifier, which always starts and
  classifies the complete changed-file list. The control plane assigns both
  existing `control-plane /` check names to either the real build/API jobs or
  lightweight no-op companions, without changing their ruleset identity; the
  historical build label stays stable even though typecheck growth is
  warning-only. Incomplete or unavailable changed-file listings safely run the
  full suite instead of stranding the required names. See the
  [PR #222 engineering note](../PRs/222-codex-typecheck-ratchet-warning-main-ci-make-typecheck-ratchet-warning-only.md).
  — Codex (AI), 2026-08-10
- **Proxied private-media mutations preserve same-origin protection**:
  attachment and avatar/banner writes now compare browser origins with the
  trusted forwarded public host and protocol, so local and reverse-proxied
  requests no longer fail against the internal Nitro origin while mismatched
  and explicitly cross-site requests still fail closed. Invalid external
  profile-image URLs also expose their error state to assistive technology. —
  Codex (AI), 2026-08-10
- **Attachment parent refresh preserves deployment and workflow boundaries**:
  the hourly attachment cleanup and weekly notification digest each appear
  exactly once in `vercel.json`, with an automated uniqueness contract that
  prevents duplicate-cron deployment rejection. Product branches also retain
  only the secret-free develop-preview listener; the privileged controller
  implementation remains owned by the protected default-branch control plane.
  See the
  [PR #201 implementation notes](../PRs/201-codex-s3-post-attachments--add-private-s3-post-attachments-with-tier-accounting.md).
  — Codex (AI), 2026-08-10
- **Worktree lint and formatting dependencies now self-heal completely**:
  validation startup probes detect incomplete transitive pnpm links even when
  every direct package looks installed, retry once with a forced relink, and
  verify ESLint plus the now-direct Prettier CLI before reporting the checkout
  ready. — Codex (AI), 2026-08-10
- **Creation-time promotion conflicts are resolved automatically**: when a
  selected `develop` feature cannot be replayed cleanly onto its promotion base,
  the protected per-feature promoter first positively proves its historical
  patch is still effective at the current `develop` tip, then reserves the
  deterministic branch and hands the immutable source/base plan to a bot-only
  worker on the fixed `github-actions` control plane. The thin `develop`
  listener grants the Actions permission needed for that dispatch without
  restoring executable workflow behavior to product branches. The
  secret-bearing provider router stays on GitHub-hosted compute and accepts only
  authenticated, validated downstream runner metadata; promotion-plan handoffs
  bypass external provider routing until that boundary supports the same
  immutable plan envelope. The worker re-derives live authority, resolves only
  mechanically proven conflict paths, treats `graphify-out/**` as derived
  target-side output, publishes with an exact lease, opens the promotion PR, and
  resumes dependent stack members automatically. The result
  is labelled for review and receives evidence naming the resolver run,
  immutable SHAs, and AI-edited paths; unchanged failed snapshots pause
  visibly instead of requiring undocumented manual cherry-picks or repeatedly
  spending model budget. Bot attestations, exact leases, durable stale-snapshot
  retirement, and idempotent checkpoint/metadata recovery make retries
  converge across API ambiguity, worker crashes, base movement, or duplicate
  comments. A recoverable historical patch that current `develop` classifies as
  removed or ambiguous now blocks visibly before any reservation, branch,
  immutable promotion plan, AI worker, or promotion PR is created. Only later
  members of its dependent promotion group wait; unrelated groups continue
  independently. A later run can proceed only after freshly proving the patch
  effective and creating a new verified plan; no blocked state is upgraded in
  place. Missing objects, unreadable patches, operational Git failures, and
  worker classification mismatches likewise stop before publication. See the
  [PR #213 engineering note](../PRs/213-codex-auto-resolve-promotion-conflicts-automatically-resolve-promotion-creation-conflicts.md).
  Conflict-free and AI-resolved verified-source promotions that touch
  `.github/**` still share the same bot-authored `[skip ci]` content commit and
  `GITHUB_TOKEN` review checkpoint, so promoted workflow changes cannot execute
  merely from the branch push that creates their review PR. Removed or ambiguous
  historical patches never reach that gate because no branch or PR is created.
  — Codex (AI), 2026-08-10
- **Generic Vercel Preview now mirrors the shared development runtime**: all 26
  variables currently assigned to `develop` also target Preview, while the six
  existing Preview-only filesystem/CI/webhook settings remain. The development
  S3 role now trusts the generic `environment:preview` OIDC subject and the
  development bucket permits Thingtime's generated Vercel Preview origins;
  production MongoDB/JWT/S3 and the production S3 role remain excluded. The
  trusted controller is retained for stable `*.previews.dev.thingtime.com`
  aliases, exact-SHA status, and cleanup. See the
  [PR #212 engineering note](../PRs/212-codex-develop-pr-previews-add-secure-develop-target-pr-previews.md).
  — Codex (AI), 2026-08-10
- **Develop and production preview hostnames are now separated**: the trusted
  `develop` controller uses `*.previews.dev.thingtime.com`, with its protected
  GitHub variable, detached Vercel wildcard, DNS/ACME delegation, TLS, and S3
  CORS aligned to that origin. `*.previews.thingtime.com` is reserved for a
  separate future production-preview controller, while ordinary Vercel
  previews retain the development role but never the production role. See the
  [PR #212 engineering note](../PRs/212-codex-develop-pr-previews-add-secure-develop-target-pr-previews.md).
  — Codex (AI), 2026-08-10
- **Develop-preview activation runbook now matches the live control plane**:
  documents the no-bypass `main` ruleset, automatic no-reviewer cleanup,
  installed team-scoped 90-day Vercel token and exact-bucket CORS-probe
  secret, narrowed develop/production runtime scope, and authoritative/public
  resolver verification of the wildcard CNAME. The narrow ACME NS delegation,
  exact-bucket CORS, `main` merge, and end-to-end gates remain. Independent
  CODEOWNER approval is recorded as optional future hardening once a second
  trusted collaborator exists. See the
  [PR #212 engineering note](../PRs/212-codex-develop-pr-previews-add-secure-develop-target-pr-previews.md).
  — Codex (AI), 2026-08-10
- **Every live AI conflict/rebase path now follows the current Thingtime Admin
  model order**: merge resolution, all rebase rounds, and their semantic
  Graphify refreshes share the validated primary model instead of letting the
  refresh silently fall back to Sonnet. The public setting endpoint now reads
  the home-DB singleton on every request (retaining last-known-good only for a
  real database outage), so a successful Admin reorder is visible immediately
  across warm serverless instances. Source contracts cover the delegated
  product-branch callers and inventory every control-plane AI workflow/action,
  rejecting new unbound runtimes or obsolete hard-coded models. The deleted
  legacy GitHub workflow registration was also disabled.
  — Codex (AI), 2026-08-10
- **PR conflict resolver model selection follows Thingtime Admin**: the
  protected `github-actions` resolver controller loads the public, allowlisted
  model waterfall instead of hardcoding Opus 4.8, safely falling back to the
  Claude default if the setting is unavailable or malformed. The change was
  authored on PR #54, but that branch's `.github/workflows/` snapshot has since
  been collapsed back to the trigger-only listener, so the live implementation
  is on `github-actions` only. — Codex (AI), 2026-08-10
- **The complete Actions control plane is ready for atomic promotion to
  `main`**: the mutually dependent workflow fixes from source PRs #192, #193,
  #194, #190, #199, #206, #207, and #208 are replayed together so the default
  branch never runs an obsolete intermediate resolver, rebaser, or feature
  promoter revision. The seven action workflow/script files exactly match the
  current `develop` versions. See the
  [PR #210 engineering note](../PRs/210-promote-actions-control-plane-rollup.md).
  — Codex (AI), 2026-08-09
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
  removed aggregate ranges are classified instead of being mistaken for
  current source; PR #213 visibly blocks removed or ambiguous recoverable cases
  before any reservation, branch, worker, or promotion PR, while unrecoverable
  authority still fails closed. It records structured per-PR blocks instead of
  aborting the batch. A failed standalone feature no longer prevents later
  independent promotions; a failed stack member still defers only its
  dependent members. Group-local
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

### Security

- **Service-account provisioning is now rate limited and input-capped**
  (TODO #7 / `claude-todo/09` A3, the last open item of the three): the public
  `POST /api/v1/auth/service-account` route previously accepted unlimited
  anonymous requests, each minting a non-expiring bearer token + a 5 GiB
  storage-allowance account. It now enforces the shared Mongo-backed limiter
  fail-closed per IP (`auth.serviceAccount`, default 10 / 15 min,
  admin-editable), caps the request body at 16 KiB via `readJsonBody`, and
  whitelists provisioning fields instead of spreading the raw body (privileged
  meta is already stripped at the `createUserAccount` chokepoint —
  defense-in-depth). API docs and `/tests` coverage updated; the sibling
  raw-results/populate lockdowns from the same TODO shipped earlier —
  Claude (AI), 2026-07-21.

### Added

- **Installed-app Login with Thingtime via loopback + S256 PKCE**: native
  desktop clients can now reuse the existing consent screen without exposing an
  app token to a WebView or custom URL scheme. The first-party page issues a
  signed five-minute `oauth-code` session to an exact registered
  `127.0.0.1`/`[::1]` callback; `/api/v1/oauth/token` atomically consumes it
  with the original verifier and returns the existing 30-day, revocable,
  namespace-fenced app token. OAuth codes are explicitly barred from all
  full-account auth paths, and loopback validation, PKCE, callback construction,
  API docs, and manual replay/mismatch checks are covered. See the
  [PR #263 engineering note](../PRs/263-codex-commander-cross-platform--add-cross-platform-commander-launcher.md).
  — Codex (AI), 2026-08-12

- **Trusted `develop`-target PR deployment controller**: same-repository,
  trusted-author PRs targeting `develop` can now be deployed through a
  secret-free `pull_request_target` dispatcher and provenance-checked
  default-branch `repository_dispatch` controller to the exact Vercel `develop`
  Custom Environment. Neither GitHub job executes PR-head code, the detector
  never receives the Vercel token, and generic Preview access was not broadened
  when the controller was introduced (it was deliberately broadened later as
  recorded above); the approved Vercel build intentionally receives the shared
  develop runtime configuration. An explicit trusted-actor plus live write/admin permission
  gate protects the dedicated GitHub Environment secret. Each PR gets a
  marker-updated status comment, transient GitHub Deployment, and dedicated
  alias under `*.previews.dev.thingtime.com`; SHA revalidation, marker-scoped
  supersession/close cleanup, six-hour reconciliation, and bounded manual
  recovery prevent stale builds from retaining aliases or shared develop
  credentials. The fork-safe runbook keeps
  `dev.thingtime.com` bound to the literal `develop` branch, stores the exact
  Custom Environment ID only in a private GitHub variable, documents minimal
  wildcard S3 CORS/DNS, and calls out that eligible PRs intentionally share the
  same development data plane rather than receiving isolated sandboxes. — Codex
  (AI), 2026-08-09. [Detailed PR #212 runbook](../PRs/212-codex-develop-pr-previews-add-secure-develop-target-pr-previews.md).
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

- **Per-feature develop → main promotion PRs (with stacks)**: a new **Promote
  features to main** workflow (`promote-features-to-main.yml`) joins the
  standing all-or-nothing **Promote develop to main** omnibus PR (#186) as a
  granular release train. It scans PRs merged into `develop`, cherry-picks
  each unshipped one onto its own `promote/pr-<n>-<slug>` branch cut from
  `main`, and opens a per-feature promotion PR for release review; PRs sharing
  a feature group (`Promotion-Group:` body line, `stack:`/`group:`/`feature:`
  label, `feature/<key>/...` branch, or `feat(<key>):` title scope) become a
  stacked chain in merge order, with automatic retargeting as earlier members
  merge. The two trains coexist: merge individual promotion PRs for granular
  review, or merge the omnibus PR when everything on develop is mergeable —
  promotion PRs whose diff becomes empty afterwards are closed automatically
  as redundant (branches deleted once nothing stacks on them). `no-promote`
  skips a source PR; closing a promotion PR rejects that change for `main`
  permanently; cherry-pick conflicts stop the affected group and the job
  summary prints exact manual-promotion commands. Runs on pushes to `develop`,
  a 6-hourly schedule, and manual dispatch with a dry-run mode.
  — Claude (AI), 2026-08-08

- **AI PR and stack rebase conflict resolution**: a separate **Rebase PRs and
  stacks (AI)** workflow evaluates every same-repository PR regardless of base
  branch. Standalone PRs that merge cleanly but cannot rebase and stack members
  needing a history update are rebase-owned, while standalone merge conflicts
  remain disjointly owned by **Resolve PR conflicts (AI)**. It replays standalone heads onto
  their bases and stacks root-to-leaf with bounded, file-only Claude conflict
  rounds and trusted Git verification. Push/open/reopen triggers plus a
  scheduled all-PR backstop feed the trusted dispatch path, while manual
  dispatch can target one PR or scan the repository. The merge resolver now
  has its own staggered all-PR backstop and exact live-ref snapshot, pre-push
  revalidation, lease, publication classification, and `ai-merge-paused`
  retry-loop guard. Global merge scans use true GraphQL pagination, while
  rebase verdicts poll round-robin and stack traversal supports 64 levels.
  Both pause labels are bound to strict bot-authored owner/ref/SHA/topology
  snapshots; queued retries re-prove ownership before deleting a specific stale
  hold, publication requires pauses to be absent, and post-push cleanup
  preserves newer-snapshot holds. `ai-rebase-in-progress` is the only hard
  mutex.
  Claude sees only regular conflict-file copies in a
  repo-less scratch directory; the real checkout, Git state, exact trusted
  action, and credentials remain outside its workspace. Exact force-with-lease
  prevents concurrent work from being overwritten; fork, default, and
  protected branches are refused; `no-ai-rebase` opts out; and failures add
  `ai-rebase-paused` instead of retrying forever. Parent barriers preserve
  root-to-leaf ordering, orphaned run locks recover after 90 minutes, and web
  rewrites explicitly dispatch Web CI for the new SHA. The existing merge
  resolver now routes stack members deterministically, pins its runner actions,
  and avoids checkout's spurious `/dev/null` Git-config annotation. See the
  [PR #183 implementation notes](../PRs/183-codex-ai-rebase-stack-resolver--add-automatic-ai-rebase-support-for-pr-stacks.md).
  — Codex (AI), 2026-08-08

- **Stable Vercel domain for the `develop` branch**: the Thingtime project now
  assigns `dev.thingtime.com` to `develop` as a branch-specific Preview
  domain, matching the existing staging pattern while preserving the
  branch-scoped Preview secrets already used by develop deployments. The
  deployment runbook now records the required Cloudflare DNS-only CNAME and
  ownership-verification flow. This original assignment was superseded on
  2026-08-09 by the isolated `develop` Custom Environment recorded above. —
  Codex (AI), 2026-08-07

- **Typed queries across every admin workspace**: Users, Apps, Tiers, rate
  limits, and the administrator roster now share an all-field free-text,
  filter, and deterministic-sort interface. It handles nested/list fields,
  created-day ranges, tiers and immutable versions, quotas/usage/counts,
  lifecycle state, pricing/discounts/inclusion text, and booleans. User/app
  APIs use private, no-store 200-row keyset pages, and the UI drains the full
  directory before applying computed/nested filters instead of silently
  filtering only the newest page. User/app rows now expose created time, while
  hidden rate-limit edits remain intact. — Codex (AI),
  2026-08-05

- **Versioned subscription-tier admin + customer cards**: `/admin` now has a
  Tiers workspace with separate Live, Draft / not live, and Archived sections.
  Admins can create tiers and immutable revisions; edit names, taglines,
  banners, four renewal prices, six annualized computed-or-custom savings,
  Editor.js inclusions, metering, and quota defaults; then publish/archive with
  confirmation while preserving every historical revision. The public
  `/api/v1/tiers`, admin `/api/v1/admin/tiers`, subscription editor, and app
  storage manager all use exact tier version ids. Each revision freezes its
  pricing/discounts, and assignments freeze the tier name, version, metering,
  and quota snapshot so later catalog changes cannot move existing customers.
  Includes standalone-Mongo-safe
  publish recovery, protected `subscription-*` ids, default-tier safeguards,
  dynamic customer cards, schemas/indexes/docs/tests, and legacy v1 pinning. —
  Codex (AI), 2026-08-05

- **App-owner storage subscriptions + app-user sub-tiers**: `/apps/manage`
  lets a registering owner or linked co-manager inspect measured whole-app
  usage, switch the aggregate plan (Free 5 GiB, Plus 25 GiB, Pro 100 GiB,
  metered PAYG), change the inherited per-user cap (50 MiB by default), and
  assign/reset one or up to 200 selected app users to custom caps. App tier +
  aggregate allowance/usage now live atomically on the app Thing; protected
  relational `app-storage` Things hold user usage and optional overrides, with
  guarded writes enforcing both ceilings and clamping every user cap to the
  whole-app total. Includes owner/co-manager API, privacy-gated usernames,
  responsive manager UI, schema/index/migration updates, API/embed docs, and a
  30-check local-only live suite. This supersedes the earlier app→end-user-tier
  fallback from the stacked admin-manager change. — Codex (AI), 2026-08-05

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
  notes in
  [`PRs/172-followers-friends-notifications-views-4fcfcf-followers-friends-notifications-views.md`](../PRs/172-followers-friends-notifications-views-4fcfcf-followers-friends-notifications-views.md).
  — Claude (AI), 2026-08-03

- **CI conflict-resolver graphify refresh now does LLM semantic extraction**:
  after an auto-resolved merge, `resolve-pr-conflicts.yml` runs
  `graphify extract` + `cluster-only` with whichever Claude credential the
  repo has (`ANTHROPIC_API_KEY` → claude API backend, else
  `CLAUDE_CODE_OAUTH_TOKEN` → claude-cli backend, sonnet), so content new to
  the merge is semantically indexed in CI instead of waiting for a local run.
  Unchanged content is served from the tracked content-addressed semantic
  cache (new CI-paid blobs are committed back), and the step falls back to
  the old AST-only `graphify update` when no credential exists or extraction
  fails. Staged refresh outputs get the same best-effort secret scan as
  resolved files. — Claude (AI), 2026-08-03

- **Thingtime Messenger** (`/messages`): a full chat platform inside the app —
  Slack-style **Spaces** (communities with channels, sidebar sections, topics,
  invites, threads) and FB-style **Chats** (DMs, groups, nicknames, message
  requests bucketed follower/unknown) behind one mode toggle. Everything is a
  thing: nine new dedicated-endpoint kinds (`chat`, `chat-member`,
  `chat-message`, `chat-section`, `community`, `community-member`,
  `community-invite`, `custom-emoji`, `follow`) with membership enforced in
  `api/utils/messenger/` and the generic `/api/v1/things` paths refusing them.
  Reactions reuse the post reaction store + unique index and add a
  `custom:<emoji id>` token namespace for uploaded gif/webp emojis (≤512KB
  data URIs, the avatar pattern). Read receipts are per-member forward-only
  high-water marks with a parity privacy setting (off = neither share nor
  see); unread counts skip system messages and muted chats; new-message Lopu
  toasts + nav badge ride a visibility-aware poll (4s open chat / 15s list /
  25s global). 23 new documented endpoints (docs registry = Nitro
  registration), 6 new rate-limit buckets, 7 new partial/thread indexes, and
  `scripts/verify-messenger.mjs` (100 live-API checks, including 14
  regressions locked in from the pre-merge adversarial multi-agent review —
  community-gated channel adds, a generic-DELETE wall for messenger kinds,
  community-leave channel revocation, ex-owner role reset, sealed DM member
  verbs, request-walled group invites, receipt-free pending reads, and
  cursor/limit fixes). Detailed note:
  [PR #174](../PRs/174-thingtime-messenger-platform-thingtime-messenger-spaces-chats.md).
  — Claude (AI), 2026-08-03

- **/admin dashboard + subscription tiers + ownership links** (stacked on the
  PAT × app-namespace tree): admin-gated `/admin` page (Users / Apps / System
  tabs) managing every user and app — subscription tiers (free/plus/pro/payg;
  payg = metered, no hard caps) with per-field admin overrides (`null` =
  unlimited), quota enforcement wired through the tiers (whole-app storage,
  app registration, and PAT mint caps), platform-level app suspension
  (`crystal.revokedAt` checked at
  the `resolveAppToken` choke point + live-session sweep), and many-to-many
  ownership links (`account-link` things): owned accounts appear in the
  switcher's "Owned accounts" and are assumable without credentials
  (`POST /api/v1/auth/accounts/assume`), app links grant co-management. New
  protected kinds `subscription` + `account-link`; 7 new documented endpoints;
  guard smoke tests; `test:subscriptions` unit suite; live suite
  `scripts/verify-admin-subscriptions.mjs` (38 checks, needs
  `TT_VERIFY_ADMIN_USER`/`TT_VERIFY_ADMIN_PASS` of an env-admin). See the
  detailed PR note in `PRs/`. — Claude (AI), 2026-08-02

### Performance

- **PostCard's `React.memo` actually bails now** (TODO #12): `PostList` passed
  a fresh per-card arrow for `onChanged`, so every engagement event / scroll
  re-render repainted every card in the column. `PostCard`'s contract is now
  `onChanged(id, next)` and `PostList` passes the consumers'
  `useCallback`-stable `handlePostChanged` straight through (Feed and
  ProfilePage reach PostCard through `PostList`, so they were already stable).
  Live-verified: reactions, comments, and both consumers behave identically
  — Claude (AI), 2026-07-21.

  Every other `PostCard` consumer was migrated to the two-argument contract in
  the same change: `routes/thing.tsx`, `routes/post.tsx`, `routes/media.tsx`
  and `components/Search/SearchPage.tsx` each took `(change)` only, so after
  the signature change they bound `change` to the post **id string** and wrote
  it into state in place of the post — `/thing/:id`, `/post/:id`, `/media/:id`
  and search results would have blanked out on any react/comment/share/delete.
  The three route handlers now take `(id, change)` and ignore changes addressed
  to a different post; SearchPage drops its per-card wrapper and passes the
  already-stable `updateResultPost` straight through, which extends the memo
  win to search — Lopu, 2026-08-28.

  Six `onChanged` call sites *inside* `PostCardImpl` were still on the old
  one-argument contract and were fixed in the same pass: `handleEditSave`'s
  optimistic text write and its failure revert (L1180/L1185),
  `handleVisibilityChange`'s optimistic flip, server reconcile and revert
  (L1199/L1203/L1208), and the full-composer edit's `onPosted` (L1566). Each
  passed the change into the `id` slot, so every consumer compared an id string
  against a function/post object, matched nothing and dropped the update: on
  feed, profile, search and the three routes, **editing a post's text or
  changing its privacy showed a success toast while the card kept rendering
  stale content** until the next refetch. Now all 17 card-level calls address
  `post.id` — Lopu, 2026-08-28.

  Correction to an earlier note in this entry: the stale handlers were *not*
  invisible to the type checker. Parameter bivariance does not apply here —
  neither `string` nor `PostChange` is assignable to the other, so `tsc` rejects
  the swap even with `"strict": false` (verified against the repo's exact
  compiler flags). CI genuinely saw all six: the run for the superseded head
  `4f44384` logged
  `PostCard.tsx(1180|1185|1199|1203|1208|1566): error TS2554: Expected 2
  arguments, but got 1` and summarised `Typecheck ratchet WARNING: 144 tsc
  errors vs baseline 143 (+1). This check is non-blocking.` The gap is that the
  ratchet is deliberately advisory (`ci: make typecheck ratchet warning-only`),
  so a real regression annotates and still goes green — worth revisiting as its
  own change, not silently here — Lopu, 2026-08-28.

  Those six are fixed as of `c8cbab7`, whose CI run reports `Typecheck ratchet:
  138 errors, DOWN from baseline 143 🎉`; base `261072a` measures the same 138
  with a byte-identical error set, so this change is exactly type-neutral. That
  comparison also sharpens the point above: the superseded head's true
  regression was **+6**, not the +1 the ratchet printed — develop had
  independently dropped 5 errors and the stale 143 baseline netted the two off.
  The confirmed number is now locked in
  (`node scripts/typecheck-ratchet.mjs --update-baseline`, 143 → 138), so that
  masking headroom is gone; a ratchet that diffed error *identities* instead of
  totals would close the remaining gap and stays worth doing as its own change,
  not here — Lopu, 2026-08-28.

  Both halves of the fix are now pinned by `test:feed-contract`
  (`app/components/Feed/postCardChangeContract.test.ts`): every post-level
  `onChanged?.()` call must address `post.id` (and every comment-level
  `onChanged()` call `comment.id`), and no PostCard consumer may bind
  `onChanged` to an inline closure. tsc covers the arity but not which id a call
  addresses — a wrong id compiles, matches no post in any consumer and silently
  drops the update — and nothing at all caught a consumer re-introducing the
  per-card arrow, which is the original TODO #12 regression. Verified by
  mutation: reverting the prop to one argument, mis-addressing a call site, and
  restoring PostList's closure each fail the suite — Lopu, 2026-08-28.

  That guard had a gap in the one place this change actually regressed. Both
  call-site checks read the id out of `onChanged(<id>, …)`, so they only ever
  saw calls that *have* a second argument: a site reverting to the old
  one-argument shape stopped being counted rather than failing, and the
  remaining sites still all said `post.id`. That is precisely the shape of the
  six regressions above, and the only thing that catches it — tsc's TS2554 — is
  reported by the deliberately non-blocking ratchet, so it ships green. Each
  test now also counts raw `onChanged` call sites and asserts every one is
  addressed. Verified by mutation on top of the existing cases: dropping the id
  from a post-level call (17 sites, 16 addressed) and from a comment-level one
  (5 sites, 3 addressed) each failed, where both passed before
  — Lopu, 2026-08-28.

### Fixed

- **PR #99 persisted-state, CSP, and registration-body hardening**: persisted
  Thingtime functions are no longer serialized or revived with `eval`; Dates
  use explicit tags so ordinary date-like strings retain their type; Vite and
  Vercel now share a CSP without `unsafe-eval`; and public registration caps
  request bodies at 16 KiB while continuing to use the IP-based
  `auth.register` limiter already merged in PR #167. The pre-paint theme and
  environment title boot moved to a same-origin external script so they still
  run under the policy; generated design prototypes retain their required
  runtime compiler and unpkg access through a path-scoped compatibility policy
  that never applies to the app shell. See the
  [PR #99 implementation note](../PRs/99-claude-eval-csp-hardening--persisted-state-csp-register-body-cap.md).
  This consolidates the useful work from closed PRs #94, #96, #98, #103, and
  #106 plus stacked PR #102; open cross-tab PR #92 remains a separate feature.
  — Claude (AI) + Codex (AI), 2026-08-08

- **Sync main→develop fallback PR is now PAT-authored**: the **Sync main into
  develop** workflow's "Open (or reuse) the sync PR" step used `GITHUB_TOKEN`,
  which failed outright while the repo blocked Actions-created PRs — and even
  with that setting enabled, a `GITHUB_TOKEN`-created PR triggers no workflows
  (GitHub anti-recursion), so the sync PR would sit with no Web CI/CodeQL
  checks. The step now uses the same
  `SYNC_BRANCHES_PAT || CONFLICT_RESOLVER_PAT` chain as the checkout/push path
  and fails loudly when neither secret exists instead of degrading to a
  checkless PR. — Claude (AI), 2026-08-08
- **PRs that make themselves conflicted now get rescanned**: a push to a PR's
  head branch can create a conflict (the resolver deliberately ignores
  `synchronize` to avoid self-loops), and with no follow-up push to the base,
  the PR sat unresolved indefinitely — observed on the resolver's own PR #173.
  Every branch push already spawns a detect run; it now also scans the open PR
  _from_ the pushed branch, and the handoff dispatches under each conflicting
  PR's base branch instead of the pushed ref. Self-terminating: the resolver's
  own resolution push finds its PR mergeable and no-ops.
  — Claude (AI), 2026-08-06

- **Born-conflicting PRs now actually trigger the conflict resolver**: GitHub
  creates no `pull_request` workflow run for a PR that opens CONFLICTING (no
  merge ref exists), so the resolver's `pull_request: [opened, reopened]`
  trigger was a silent no-op for exactly the case it was added for (verified
  empirically on a canary PR). Replaced with `pull_request_target` routed
  through the existing detect→handoff→dispatch hop — API-only in the target
  context, no PR code checkout, resolve job excluded for that event.
  — Claude (AI), 2026-08-03

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
## [1.0.0] - YYYY-MM-DD
Move entries up from [Unreleased] when cutting a tagged release.
-->
