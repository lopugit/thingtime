# Thingtime AI instructions

Updated 11 September 2026 from the current repo and a two-month PR review.
Read the canonical-file rules and recurring lessons first, then the relevant
runbook sections. If an injected excerpt is truncated, open the complete
relevant sections before acting. Source links, review limits and the dated branch checkpoint
are in [the review](docs/ai-guidance-review-2026-09-11.md).

This file is the canonical **repository** guidance. The complete current global
`/Users/lopu/.AI/AI_ALL.md` is preserved in the final, reference-only appendix;
that snapshot is not a second writable global policy or a replacement for live
global instructions. Machine-local commands in it are not setup steps for every
clone. The operative Thingtime sections below retain the repo guidance and
update stale details. Do not recursively reread this file through its aliases.

## Canonical instruction file

- `AI_ALL.md` is the only writable canonical root AI instruction file for this
  repository.
- Root `AGENTS.md` and `CLAUDE.md` must remain relative symbolic links that
  resolve to `AI_ALL.md`. Never create or maintain separate mirrored copies.
- Preserve this symlink layout in clones, linked worktrees, and generated
  checkouts.
- Make every root agent-instruction update directly in `AI_ALL.md`; reading
  either compatibility filename is equivalent to reading this file.
- More-specific instruction files below the repository root still apply to
  work in their directories and should be read before inspecting or changing
  files there.
- For PR reviews, prioritize code quality, performance, potential bugs,
  crashes, and especially security issues before style commentary.

## Recurring development lessons — 2026-09-11

These rules come from the [two-month PR review](docs/ai-guidance-review-2026-09-11.md)
(750 PRs active from 11 July to 11 September 2026, including 707 opened in that
window). The review links each family to PRs and current source. Promotions,
closed PRs and historical validation are evidence, not proof of current delivery
or authorization for new work.

### Start with the current implementation and task owner

- Inspect the checkout, unmerged/staged files, branch, current remote base and
  relevant open PRs before editing. Preserve unrelated work; use an isolated
  worktree when the attached checkout is conflicted or belongs to another task.
- Check the relevant TODO, active claims and existing implementation before
  starting a second solution. A stale TODO or an open promotion can describe
  work already present. Compare actual source trees and retained regression
  coverage before calling a PR redundant; do not count generated Graphify or
  changelog-only differences as feature delivery.
- Keep one implementation and one policy source. Extend shared helpers,
  registries and UI components before adding parallel versions. When consolidating
  duplicate work, preserve distinct tests, review findings and unfinished
  acceptance checks, and link the surviving PR.
- Read dated decisions as history. Confirm the current client entry, runtime,
  contracts and deployment before applying an old fix. The web app currently
  uses Vite, React Router in non-framework mode and Nitro; `entry.client.tsx`
  mounts with `createRoot`. Do not add SSR/hydration machinery to repair a stale
  chunk, client cache or missing-route problem without reproducing that cause.

### Carry new fields through the whole data path

- Trace editor/composer → `useApi` request shaping → route/body validation →
  canonical write utility → storage → public/read projection → rendered view.
  Adding a field to a component or schema alone is insufficient. Inspect
  `remix/app/hooks/thingsRequestPayload.ts` whenever post/comment payloads change.
- Await the live Editor.js save snapshot before freezing a create/edit payload.
  Test changing formatting or typing and immediately pressing Publish, before
  the autosave debounce. Preserve native rich text, whitespace, media order,
  layout and plain-text fallback through real browser transport and exact-ID
  readback, then reload the permalink and reopen the editor.
- A retry after an uncertain write must reuse the original operation identity
  and immutable payload. Do not turn ambiguous completion into a second post,
  upload, action, recording result or billing charge.

### Preserve useful state while enforcing identity boundaries

- Paint cached state immediately for the same viewer and resource, then
  reconcile in the background. Distinguish cold start, stale-but-usable data,
  retryable failure, forbidden and not found. Do not turn a network failure into
  an empty-success screen or discard good content during Retry.
- Scope caches and draft ownership to the relevant account, API origin, target
  and access/link context. Reset protected view state before a new identity
  renders. Fence async loads, saves, prompts and native callbacks with operation
  identity/generation and cancellation; an old completion cannot mutate a newer
  screen, session, recording or retry request.
- Protect optimistic edits from older reads. Cover fast repeated toggles,
  out-of-order replies, background refresh during mutation, rollback and reload
  convergence. Test every consumer of the shared result, including feed,
  profile, permalink, nested comments and cached thread reads.
- Keep drafts mounted across equivalent modes such as Chat → Voice → Chat.
  Preserve user-entered settings across migrations, page/modal switches and
  app restarts; do not reseed defaults on every render or store write.
- Use the canonical persistence codec. Date-like strings remain strings,
  explicit Dates retain type, legacy executable tags stay inert, and cycles
  remain supported. Test persistence, undo and cross-tab transport together;
  never restore `eval` of saved content or echo remote sync writes indefinitely.

### Treat sharing as a stored dependency and audience problem

- Reuse the shared composition traversal in `remix/app/api/utils/webpages/`
  and `actions/sharedComposition.ts`. Keep rendering, dependency discovery,
  collaborator-write validation and private copying consistent. Traverse only
  authorized stored references under bounded work budgets; visitor input, query
  values, action results, labels and condition operands must not create grants.
- For every sharing change, cover page/component/schema roots, schema controls,
  action references, HTML attributes, CSS/responsive media, saved/default args,
  page-instance overrides, conditional output branches and composed templates.
  Shared writers must also be refused when they inject inaccessible dependencies
  through an argument-only edit or an inactive branch.
- Reauthorize the outer root and each independently readable foreign-author
  audience boundary on every read/run/copy. Preserve standalone ACLs, hidden
  links, groups, app namespaces and revocation. Do not borrow an author's or
  visitor's unrelated private authority. Shared read-only actions cannot mutate
  saved data or mint persistent owner action-run records.
- Private copies need fresh owned identities and rewritten executable/media
  bindings; test copying a copy. When the feature promises independent files,
  copy authorized exact-version bytes through normal upload approval, quota,
  moderation and transactional binding, with cleanup on refusal/failure.
  Verify the copy after source edits, revocation and deletion. Stub image bytes
  prove UI/authorization paths only; real object-store independence needs its
  own evidence. Preserve validated linked-media records without arbitrary fetches.

### Keep storage, uniqueness and migrations coherent

- Keep user-writable crystal fields separate from protected root `uniqueKeys`
  identities. Never add a kind-blind unique crystal-path index or reserve normal
  data-property names as the permanent fix. Trace **every** generic, dedicated,
  bulk and migration writer; a dedicated poll/passkey/relationship path can miss
  a helper used elsewhere. Test hostile same-name data alongside legitimate
  writes and real concurrent create/move/toggle behavior.
- Use the canonical logical UTF-8 byte measurement and storage transactions.
  Account, app and app-user admission must agree on the same delta; unknown,
  malformed, stale or reconciling ledgers stay explicitly unavailable. Do not
  display unknown as zero, bypass admission or silently fall back to
  non-transactional writes.
- Match each transaction's Mongo client/session to its collections. Identity,
  auth and control-plane operations stay home-pinned; content follows the
  selected data plane. Exercise transaction-dependent paths on a disposable
  replica set through the real API; standalone Mongo or utility mocks cannot
  prove that transaction contract.
- Migration scans must retain all protected envelope fields required by the
  real validators/accounting code. Cover seeds, legacy rows, optional additions,
  malformed rows, interruption, retry and concurrent writers. Declare prerequisite
  ordering; keep readiness fenced until reconciliation reaches a fixed point.
  Diagnose with allowlisted field labels, not raw secret-bearing documents.
- Before changing an index, inspect the executable index/query plan, all writer
  versions and DB-sharing previews. Preserve uniqueness through backfill,
  activation/drain and retirement. Keep CI telemetry in its home `ciControl`
  satellite with its retention policy. A merged index plan does not prove a
  production migration or index retirement has happened.

### Keep private data private across every projection

- Whitelist public fields at the server boundary. A UI visibility toggle is not
  redaction. Owner-only email preferences must not expose email in public
  profiles; root data, search, metadata, notifications and diagnostic projections
  must preserve their own privacy boundaries. Check anonymous, owner, other-user,
  administrator and scoped-token callers as relevant.
- Normal vault/diagnostic reads remain redacted. Reveals require the current
  permission and fresh verification bound to account, session, origin and the
  exact selected item; recheck immediately before disclosure. Responses are
  private/no-store, transient display is cleared at identity/navigation/lifecycle
  boundaries, and passwords/passkey evidence never follow an origin fallback.
- Keep source/attachment lifecycle and upload-approval checks on the server.
  Test revocation between read and commit, namespace escape, wrong-account
  references and private metadata in logs/toasts. Preserve protected storage
  projections rather than weakening validators to get a migration green.

### Register and negotiate the real executable API

- API changes must update route implementation/import map, canonical docs,
  semantic feature versions, generated capability coverage and every dependent
  client's small requirement map. Check both manifest generators:
  `createApiCapabilitiesManifest` in `remix/app/docs/apiDocs.ts` and
  `thingtimeCapabilityManifest` in
  `remix/app/api/utils/capabilities/thingtimeCapabilities.ts`.
  Bump the affected feature deliberately; a commit SHA is not compatibility.
- Smoke the built Nitro/Vercel handler, not only a helper: discovery endpoints
  must return JSON with the selected origin and expected feature versions, not
  HTTP 200 containing the SPA shell. Verify routing before filesystem/SPA fallbacks.
- Test matching/missing/breaking capabilities, wrong origin, invalid JSON,
  timeout and retry after deployment. Failed negotiation must allow a fresh
  manifest fetch; an older rejection must not clear a newer in-flight check.
  Preserve the canonical bounded checker rather than scattering cached probes.
- Test stale-tab behavior across alias changes. Use the shared bounded
  stale-chunk recovery guard; never introduce a reload/retry loop to mask failure.

### Complete the actual login and consent flow

- Trace options/authorize → browser or host → exact callback → verification →
  live session/account read in the requesting client. Browser success text,
  launching OAuth or receiving a code alone does not prove the host connected.
- Preserve exact redirect/origin checks, PKCE, session revocation and one-use
  verified challenges. Cover cancellation, timeout, competing tabs/autofill,
  replay, provider refusal and account changes; release only the operation's own
  state. Do not loosen callbacks or permit arbitrary origins to repair one host.
- Thingtime's host-native `login_thingtime` is the anonymous MCP bootstrap;
  account/data tools stay OAuth-protected. Do not replace the native handoff with
  a terminal login that leaves the user's current chat disconnected.

### Verify UI behavior on every requested surface

- Reuse the design system and shared modal/layer, settings and input components.
  Include meaningful customization with safe defaults; avoid implementation-only
  settings. Popup and dedicated Settings views must share category behavior and
  deep links, including reload, back and Open settings page.
- Check mouse, keyboard, touch/long-press and actual editing focus. Menus must
  remain clickable rather than start a drag; global undo must not steal native
  text undo or IME input; another editor's save/remount must not wipe the caret.
- Open drawers, nested menus, tool history, pickers and confirmation cards at
  desktop and narrow mobile widths. Exercise long labels, multiple attachments,
  sticky navigation and scrolling to the bottom. Use the shared layering system
  instead of arbitrary z-index escalation; ensure focused controls and Send stay
  reachable. Compilation and closed-state screenshots cannot prove these states.

### Separate proposals, execution, history and delivery

- Lopu has no gender; use **it**. Use the existing Lopu notification primitives.
- A tool proposal/approval request is not a completed action or a runtime error.
  Show the real approval card through the intended non-mutating proposal path;
  execution needs the existing server-verified grant for that exact operation.
  Plain-text assent, a prior successful receipt or reopened history is not a
  reusable grant. Historical cards remain non-interactive.
- Later replies may use bounded, sanitized first-party historical receipts as
  evidence. Preserve success/failure/request distinctions, omit raw results and
  credentials, and never replay an action solely to reconstruct its history.
- Persist notification history independently of delivery preferences. Save final
  stream text once with idempotency; retain muted events and complete history,
  keeping bell and history counters distinct. Account changes cannot misattribute
  messages. Test long text through schema projection and credential redaction.
- Track saved notification → delivery attempt → provider acceptance → actual
  device display separately. Keep full Thing IDs in payloads; APNs collapse IDs
  must meet the byte limit through the canonical stable hash, not truncation.
  Expose only allowlisted provider diagnostics and retire invalid device tokens.

### Native apps and recordings need native acceptance

- Negotiate an explicit native feature version; the existence of a generic bridge
  does not prove microphone recording, Watch delivery or Live Activity support.
  Verify selected origin, generated build settings, signed entitlements and the
  installed bundle. Keep simulator, signed archive, TestFlight processing and
  physical-device acceptance separate in release notes.
- For macOS, preserve stable app/signing identity, exact installed paths and
  serialized helper lifecycle. Confirm the running installed executable,
  current permission preflight and the real protected operation after rebuilding.
  Unknown/stale permission state is not denied; a visible enabled macOS toggle is
  not proof. Permission changes remain explicit user actions.
- Preserve recoverable audio/drafts until durable completion. Bind processing to
  current consent, owner, source version/privacy, device and selected processor;
  recheck before disclosure and transactionally before commit. Retries, leases
  and completion receipts must not duplicate transcripts, reminders or charges.
- Explicitly selected saved recordings do not authorize automatic discovery of
  all recordings, bulk processing or processor opt-in. A personal-processing
  selection must not silently fall back to cloud. Keep transcripts relational.
  Use disposable synthetic fixtures and exact cleanup; distinguish transport
  tests from actual transcription/provider and physical Watch/iPhone acceptance.

### Keep controller work idempotent and on the right branch

- Inspect the protected implementation on `github-actions` and the thin product
  listeners before fixing CI. A product PR cannot repair controller code absent
  from its tree; a workflow-only branch cannot run a product build it lacks.
- Admit events before provisioning runners or models. Recognize canonical
  automation markers even under an owner PAT, while preserving actual human
  replies quoting those markers. Re-fetch queued source comments and PR/head
  identity before expensive work; skip superseded/deleted/automated events.
- Use durable per-work ownership and appropriate per-PR concurrency. Coalesce
  duplicate events and skip unchanged status writes. Do not cancel unrelated PRs
  through a global concurrency key, let skipped siblings suppress required work,
  or open competing repair PRs for the same known defect.
- Recheck exact heads, bases, reviews, required checks and provider deployments
  after source or base changes. A started run, queued merge, status comment,
  skipped matrix job or green warning-only check is not completion. Identify
  cancelled, pending, missing and failing checks accurately.
- Primary-branch merges/pushes still require explicit repository-specific
  authorization for the current action. Historical PR approval text never grants
  it. After an authorized merge, correlate the merge SHA, deployed source, actual
  alias and behavior; ancestry alone cannot prove a feature was newly shipped.

### Preserve evidence without turning old results into policy

- Reproduce the failure before fixing it where practical. Add a meaningful
  regression at the boundary that missed it, and update the affected manual
  section in `TESTING.md`. Test a browser transport defect through the real
  browser/API path and a race with controlled ordering or concurrent requests.
- Read the relevant script and prerequisites before claiming coverage. Explicitly
  run required opt-in integration tests; a default skip, negative-only probe,
  mock provider, or unapproved fixture is not positive end-to-end acceptance.
- Report the exact checks and limitations of the changed scope. Do not freeze old
  error counts, quotas, deployment URLs or device build numbers into rules.
  Preserve remaining acceptance work in the PR note instead of declaring a
  baseline error, emulator or generated plan to be live success.
- Finish source/docs edits and stage new documents before Graphify refresh. Use
  `scripts/graphify`; verify the source fingerprint and each new document in both
  the graph and manifest. Keep structural output usable if semantic extraction
  fails, record that limitation, and never claim missing semantic coverage was
  indexed. Use the immutable snapshot/cache policy below.

## Fundamentals (read first)

Read `FUNDAMENTALS.md` before adding features. Non-negotiables:

- All data access goes through the Thingtime API
  (`remix/app/routes/api/v1/...`) and the API utils layer. UI, scripts, and
  tests never touch MongoDB directly.
- Seed and test by calling the real API (for example, seed users via
  `POST /api/v1/auth/register`), never by writing to Mongo directly, so seeded
  data and real signups share one code path.
- Use one `thingtime` database and the everything-is-a-thing model: entities
  (users, themes, feed algorithms, waitlist, posts, comments, schemas, and so
  on) live in `things` by `kind`, plus `sessions`, the single-purpose
  auth/email satellites (`passwordResets`, `authOtps`, `email_*`, `rosters`),
  and the `ciControl` satellite for every `ci-*` control-plane Thing (webhook
  telemetry with TTL retention — never written to `things`).
  `users`, `themes`, `feedAlgorithms`, and `waitlist` are legacy collections:
  update existing records in place, but never add new records. Use one
  connection source (`mongodb/config.ts` `getMongoUri()`). Physical
  collections are versioned: logical `things` lives at `things_v2`
  (`COLLECTION_SCHEMA_VERSIONS` × `mongodb/collectionNames.ts`). Always use
  `getCollection()` or the named getters, never a raw collection-name string.
  Drop stale generations only through the admin
  `drop-stale-collection-generations` migration. The canonical list is in
  `FUNDAMENTALS.md` §3.
- Appended/child data (reactions, comments, or any accumulating list) is
  relational: store it as its own atomic `things` document (`kind`) linked by
  `parentId` and aggregate it on read. Never grow an unbounded embedded array
  or map on the parent. See `FUNDAMENTALS.md` §3 ("Appended/child data is
  relational").
- Auth uses an httpOnly cookie carrying a signed JWT (`jti`/`sub`/`exp`) plus a
  Mongo `sessions` document for revocation. Bearer tokens are supported for
  API clients.
- All user-facing notifications go through the Lopu toast
  (`components/Lopu/useLopu.tsx` — `useLopu()` / `useLopuStream()`), never raw
  Chakra `useToast` or `alert()`.

The active build roadmap lives in `TODO/claude-todo/`. The owner's engineering
decisions and thinking method are logged in `DECISIONS.md`; read it when
product direction or architecture tradeoffs matter. Default to
single-source-of-truth, determinism, test-equals-live cohesion, and merge
commits.

## Commander macOS distribution signing

- For Commander direct-distribution builds, prefer an installed `Developer ID Application` identity whenever one is available. Do not silently fall back to `Apple Development`, `Apple Distribution`, or ad-hoc signing for a release build: those identities do not provide the same Gatekeeper contract.
- Keep local iteration explicit with `COMMANDER_SIGNING_MODE=development`; production/direct-distribution builds must fail closed when no Developer ID Application certificate and private key are installed.
- Keep Apple Developer and notarization credentials in the Keychain or CI secret store only. Never print, export, commit, or copy their values into project documentation.

## Local development and worktrees

- On local desktop sessions, use the PM2 ecosystem configs for local dev servers instead of starting duplicate ad-hoc app servers. The local alias `pm` may be available for PM2; otherwise use `pm2`. The root `ecosystem.config.js` defines `thingtime-stack`, while `remix/ecosystem.config.js` defines the Nitro + React Router dev app `tt-nitro-react-router-9999`, with Vite on port 9999 and Nitro on port 10000. Prefer `npm run web-pms` from the repo root, or the compatibility alias `npm run remix-pms`, to start or restart the local web app — it is now the blessed lifecycle command (it cleans up the previous timestamped app and starts a fresh one). Do **not** use a raw `pm2 restart ecosystem.config.js`: the app name carries a clock-time suffix that is re-stamped on each config load, so a raw restart would spawn a duplicate instead of restarting in place. Do not restart the PM2-managed web dev app after every source edit; it has rebuild/hot reloading. Restart only for env var changes, dependency/native-binding changes, server config changes, a crashed/stale process, or an explicit user request. Stop/restart the managed app before claiming a local dev-server state.
- Worktree dev servers: `remix/scripts/worktree-ports.cjs` is the single source
  of truth for local dev ports, the PM2 dev app name, and the full PM2 app
  definition (`pm2AppConfig`, which `remix/ecosystem.config.js` and
  `remix/scripts/dev-pm2.cjs` both consume). The main checkout keeps Vite 9999 /
  HMR 9998 / Nitro 10000; a linked git worktree gets a deterministic port trio
  (11000-19899, hashed from the worktree directory name). Ports are
  deterministic and stable across restarts. The PM2 **name** is
  `tt-nitro-react-router-9999` (main) or `tt-wt-<worktree>-<web-port>`
  (worktree), plus a clock-time suffix (e.g. `-1005am`, 12-hour, colon-free)
  showing when the app was last started. `remix/vite.config.ts`,
  `remix/scripts/dev.mjs`, and `remix/scripts/dev-nitro.cjs` resolve ports
  through the same module; `TT_WEB_PORT`/`TT_HMR_PORT`/`TT_API_PORT` env vars
  override. The port shown in the app **name** is always the deterministic
  derived port (the stable identity used for cleanup); a `TT_WEB_PORT` override
  changes the port the stack actually binds but not the name/base, so
  start/stop still match and never orphan.
  - `npm run web-pms` — start/restart this checkout's stack (deletes any prior
    app sharing the stable base name, then starts a freshly time-stamped one, so
    restarts never orphan a process).
  - `npm run web-pms-stop` — remove this checkout's PM2 dev app (matches on the
    stable base, any timestamp).
  - `npm run web-ports` — print this checkout's derived ports and names.
  - `npm run web-ports:all` — list every thingtime dev app PM2 knows about
    across worktrees, with ports, status, and start time.
  - `node remix/scripts/dev-pm2.cjs start --cwd <other-worktree>/remix` — start
    another worktree's stack under PM2 with a correctly derived, time-stamped
    name even if that checkout predates this tooling (the name is assigned at
    pm2-start time).

  If a derived port is already taken, Vite fails fast (strictPort) — set the
  TT_* overrides. Fresh worktrees deliberately do not copy dependency trees:
  pnpm's symlink graph is not portable between checkouts. Run
  `npm run worktree-setup` to bootstrap or repair Remix dependencies from the
  shared pnpm store. The canonical dev/build/lint entry points run the same
  check automatically and retry one forced relink if pnpm's links stay stale.
  When preview/testing tooling needs to own the dev-server process (it usually
  cannot attach to the PM2-managed port), run a second foreground stack beside
  PM2 on a free trio: `TT_WEB_PORT=<web> TT_HMR_PORT=<hmr> TT_API_PORT=<api>
  npm --prefix remix run dev`. Keep any tooling config that hardcodes worktree
  ports (for example `.claude/launch.json`) untracked.
- Codex-managed worktrees use the root `.worktreeinclude` to copy ignored local
  setup into new managed worktrees. Keep tracked files and every
  `node_modules/` directory out of `.worktreeinclude`: copied pnpm symlink
  trees can be incomplete and were roughly 1.5 GB. Preserve intentional env
  files and local generated state needed for validation; rebuild Remix
  dependencies with `npm run worktree-setup` and install other workspace
  dependencies through their normal package-manager command when needed.
- When cloning or checking out branches under `.test-branches/`, copy the
  parent checkout's local env files into the clone before running install,
  dev, build, or smoke checks. Preserve matching paths for root `.env*` files
  and nested app env files such as `remix/.env*`; keep secret-bearing env files
  untracked and never commit secrets. `remix/.env.auto` is untracked and
  generated; `remix/scripts/pre-dev.sh` rewrites it on the next dev/build run.
- Inspect `git config --get core.hooksPath` and `scripts/graphify hook status`
  before changing hooks. Graphify post-commit/post-checkout hooks are active on
  this machine; do not overwrite them with the older empty `.githooks/` setup.
  Preserve repository-wrapper snapshot handling. Branch awareness itself needs
  no hook: local checkouts generate untracked `remix/.env.auto` via `pre-dev.sh`,
  and Vercel reads `VERCEL_GIT_COMMIT_REF` at build and runtime.
- If local web dev 500s with a missing `bcrypt_lib.node` native binding, run `corepack pnpm --dir remix run ensure-bcrypt`, then restart the PM2-managed `tt-nitro-react-router-9999` app. The app `postinstall`, `dev`, and `build` scripts also run this check automatically.

## Browser and UI validation

### Feature customization defaults

- Every new user-facing feature or meaningful product addition must include a reasonably chosen settings surface for the behaviors users are likely to want to customize. Choose safe, useful defaults; avoid exposing implementation-only knobs; preserve existing preferences through migrations; and document what each control changes. If a feature genuinely has no meaningful user choice, no setting is required.

- For rendered browser validation in Codex Desktop, prefer the in-app Browser first when it is available. If localhost is blocked there, or the user explicitly asks for Chrome, use the Codex Chrome tab control workflow (`chrome:control-chrome`) before falling back to standalone Playwright. Keep Chrome checks read-only unless the user requested an action, and do not inspect cookies, local storage, passwords, or profile data.
- Before finishing a PR, run the manual checklists in `TESTING.md` for every
  area the PR touches, and add a line there whenever a new bug class is fixed
  so the regression is covered permanently.
- For layout or alignment changes, always verify the affected screen in a live
  browser window before finishing. Use screenshot evidence or measured element
  bounds across the relevant desktop/mobile viewport so centering, max-width,
  overflow, and overlap behavior match the request.
- Optimistic rendering at all times (UI house rule): never flash a loading
  screen, spinner, or skeleton when prior or cached state exists. Render the
  last-known value instantly from cache/local state and refetch in the
  background, reconciling (and reverting on failure) when fresh data lands.
  Only show a loading state on a true cold start with nothing to show. Use the
  synchronous `~/hooks/localCache` tier (localStorage, keys `tt-<domain>`) for
  anything that gates first paint; the async localforage `thingtime` blob
  cannot seed the first render. Examples: the account switcher paints its
  last-known roster on open instead of "Checking accounts…"; post reactions
  toggle instantly before the API returns; the emoji picker's Recently Used
  list paints from cache while the server list loads.

## Data and API conventions

- Appended/child data (reactions, comments, any accumulating list) is
  relational: its own atomic `things` doc (`kind`) linked by `parentId`,
  batch-aggregated on read (one query per kind, never N+1), never an unbounded
  embedded array/map on the parent. Canonical rule lives in `FUNDAMENTALS.md`
  §3 ("Appended/child data is relational").
- Physical MongoDB collections are versioned (`things` lives at `things_v2`):
  always reach collections through `getCollection()`/the named getters in
  `api/utils/mongodb/collections.ts`, never a raw name string. Canonical rule
  lives in `FUNDAMENTALS.md` §3 ("Physical collections are versioned").
- New `/api/v1/...` endpoints must be registered in THREE places or Nitro
  404s them: the route file (`remix/app/routes/api/v1/.../_name.tsx` exporting
  `loader` for GET / `action` for POST), the import map in
  `remix/server/routes/api/[...].ts`, and an `apiEndpointDocs` entry in
  `remix/app/docs/apiDocs.ts` (Nitro's explicit route table is derived from the
  docs registry via `apiV1RouteKeys` — there is no hand-maintained `apiRoutes`
  list in `remix/nitro.config.ts`; documenting the endpoint IS the
  registration, and each entry also auto-generates two `-docs` smoke tests).
  Copy the themes family for conventions: utils in
  `remix/app/api/utils/...` returning `{ ok:false, status, error } |
  { ok:true, ... }` unions, `json` from `~/api/http` (use `readJsonBody` for
  size-capped mutation bodies), auth via `getCurrentUser(request)`, public
  projections that whitelist fields, new collections + indexes in
  `ensureIndexes()` and the FUNDAMENTALS §3 table.
- When adding or changing a feature that depends on private/non-public
  configuration, external dashboards, secrets, deploy settings, or environment
  variables, also document the fork-safe setup steps in `README.md`. Use
  placeholder values only; never copy real tokens, passwords, project secrets,
  or account-specific credentials into public docs.
- Thingtime email delivery work must stay aligned with the owned-stack plan in
  `docs/email-owned-architecture.md`. App/auth code enqueues through the shared
  email service boundary — `sendEmail()` in
  `remix/app/api/utils/email/service.ts`, backed by the `email_messages` outbox
  and its deliverability satellites (FUNDAMENTALS §3) — rather than calling SES,
  SMTP, or another transport directly, so provider-backed and self-hosted
  delivery share the same templates, events, suppressions, compliance checks,
  and audit trail. New mail must map onto an existing `EmailStream`
  (`transactional`, `newsletter`, `notification`) instead of adding a fourth
  name for the same traffic.
- For Vercel dashboard links, do not use `VERCEL_GIT_REPO_OWNER` as the
  dashboard owner slug; that value is the Git provider owner. Prefer Vercel API
  project/deployment data when `VERCEL_API_TOKEN` is available, or an explicit
  `VERCEL_DASHBOARD_TEAM_SLUG` env var for tokenless dashboard links.

## GitHub push and PR publishing

- Product feature, fix, docs and chore PRs target `develop`. Protected
  controller-only changes use the canonical `github-actions` branch and its
  own runbook/contracts; do not route those through a missing product build.
  Stacked branch → branch PRs keep their parent feature branch as base. Target
  `main` only when the user explicitly authorizes that exact PR against `main`
  (for example a `develop` → `main` promotion PR). Opening a promotion is not
  permission to merge it or update the remote primary branch.
- For a PR being maintained in the current task, correct an unintended `main`
  base to `develop` (`gh pr edit <n> --base develop`) unless it is an authorized
  promotion. Do not retarget unrelated PRs during a read-only history review.
  GitHub refuses some native-stack base changes; report those rather than
  forcing them.
- The repository may not have a configured Git remote in a cloud checkout. The
  canonical repository URL from `package.json` is
  `https://github.com/lopugit/thingtime.git`.
- If no remote exists, add it with:

  ```sh
  git remote add origin https://github.com/lopugit/thingtime.git
  ```

- Pushing still requires GitHub credentials or a pre-authenticated remote. If
  `git push -u origin <branch>` fails with
  `could not read Username for 'https://github.com': No such device or address`,
  commit locally, preserve the PR metadata where tooling allows, and tell the
  user the exact authentication blocker and local branch name.
- GitHub app/plugin tools are available only when the current agent environment
  exposes them. Check available tools first; otherwise use authenticated Git
  or GitHub CLI.
- GitHub CLI can be installed in Ubuntu-based containers with
  `sudo apt-get update && sudo apt-get install -y gh`.
- If `GH_TOKEN` or `GITHUB_TOKEN` was added after the environment started, it
  may not be visible to the current shell. Check only for variable names, never
  values, and restart the environment if needed.
- A fine-grained token for `lopugit/thingtime` needs Contents read/write and
  Pull requests read/write. Keep it in `GH_TOKEN` or `GITHUB_TOKEN`; never put
  a token in chat, logs, docs, commits, command output, or a credential-bearing
  remote URL that could be printed.
- After every successful push, clearly report the remote branch, for example:
  `Pushed to origin/codex/example-branch`.

## Linting, type checks, and package managers

- The repository root `.eslintrc.json` extends `next/core-web-vitals`, but the
  current checkout does not include a `next/` workspace or root-level
  `eslint-config-next` dependency.
- `remix/.eslintrc.json` intentionally sets `"root": true` so Remix linting
  stops at the app config rather than inheriting the root Next.js config.
- Prefer this targeted command for changed Remix files:

  ```sh
  corepack pnpm --dir remix run lint:files -- <changed remix files>
  ```

  This entry point also repairs missing pnpm links in fresh worktrees before
  ESLint starts.
- Use `corepack pnpm --dir remix run typecheck` for raw TypeScript results and
  `corepack pnpm --dir remix run typecheck:ratchet` for the tracked comparison.
  The ratchet is warning-only, including increases: read its diagnostics rather
  than treating exit 0 as a clean typecheck. Compare with the current base and
  baseline file, fix errors introduced by the change, and report unrelated
  failures precisely. Never raise a baseline merely to hide a regression or
  reuse historical error counts without rerunning the check.
- Use the package manager already used by the workspace being changed. For
  Remix checks, prefer `pnpm --dir remix ...`. Avoid lockfile changes unless
  dependency changes are intentional.

## iOS development and releases

- The native iOS app lives in `iOS/` and uses XcodeGen; treat
  `iOS/project.yml` as the source of truth and run `xcodegen generate` inside
  `iOS/` before `xcodebuild` checks. Keep generated `.xcodeproj` files
  untracked.
- When simulator-validating a non-default web URL, pass `THINGTIME_WEB_URL` as
  an explicit `xcodebuild` build setting (for example
  `xcodebuild ... THINGTIME_WEB_URL=http://127.0.0.1:9999 build`) and verify the
  built app's `Info.plist`; shell environment alone can be overridden by the
  xcconfig default.
- Before TestFlight, signing, or Apple Developer auth work, read
  `iOS/AGENTS.md` for the iOS-local App Store Connect env/key/profile flow.
- Use `bundle exec fastlane beta` from `iOS/` for TestFlight uploads. Provide
  App Store Connect API key, issuer, team, and bundle identifier values through
  environment variables only; never commit `.p8` keys or account-specific
  signing secrets.
- Prefer `iOS/scripts/testflight-beta.sh` for TestFlight uploads. It loads
  ignored values from `iOS/.env` when present, then runs the Fastlane `beta`
  lane from `iOS/`. Put `THINGTIME_WEB_URL` and Apple signing/API values in the
  shell environment or `iOS/.env`; keep only placeholder examples in git.
- If iOS TestFlight export fails with `Cloud signing permission error` or `No
  profiles for '<bundle id>' were found` while an App Store provisioning
  profile is already installed, set `PROVISIONING_PROFILE_SPECIFIER` to that
  profile name. The Fastlane lane keeps automatic signing by default and uses
  manual export mapping only when this variable is present.
- The iOS Fastlane build lane syncs an Apple Distribution certificate and App
  Store provisioning profile via the App Store Connect API key before
  archiving. Use `SKIP_CERT_SYNC=1` or `SKIP_PROFILE_SYNC=1` only when the
  correct signing asset is already installed and that sync should be skipped
  intentionally.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- If the `graphify` binary is not on `PATH`, install it from the upstream
  repository with:

  ```sh
  pipx install git+https://github.com/safishamsi/graphify.git
  ```

  Verify with `graphify --help` before continuing.
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- Use the repository wrapper, `scripts/graphify`, for queries and mutations. It
  routes Graphify through immutable content-addressed snapshots under
  `graphify-out/snapshots/v1/`, hydrates a private semantic cache from immutable
  variants under `graphify-out/cache/semantic-cas/v1/`, and
  refreshes ignored root aliases so ordinary `graphify query` remains
  compatible. It retains one active portable snapshot by default and prunes
  superseded snapshots after successful activation; use
  `GRAPHIFY_SNAPSHOT_RETENTION=<positive integer>` only for an explicit bounded
  local need. Do not invoke mutating commands through the bare binary in this
  repository.
- After modifying code, run `scripts/graphify update .` to keep the graph
  current (AST-only, no API cost). When Markdown, docs, PDFs, images, or another
  non-code corpus changes, use the semantic extraction path through the local
  Codex LLM proxy and then let the wrapper cluster/export the result.
- Never commit mutable `graphify-out/graph.json`, `manifest.json`,
  `GRAPH_REPORT.md`, or `cost.json` root files. They are ignored symlink aliases
  selected by the wrapper. Commit the selected immutable snapshot directory,
  the wrapper's removal of superseded snapshots, and any new
  `graphify-out/cache/semantic-cas/` variants instead; the upstream mutable
  `graphify-out/cache/semantic/` directory stays ignored.
- A commit SHA cannot name generated output included in that same commit.
  Thingtime therefore keys snapshots first by a source-only Git-tree
  fingerprint that excludes `graphify-out`, then by the Graphify version and
  portable output bytes. Identical builders deduplicate; divergent valid
  outputs coexist and merge additively instead of line-merging an atomic JSON
  pair.
- On an old branch that still carries legacy root artifacts, take either side
  for the entire legacy generated set, remove those root files from tracking,
  and run `scripts/graphify update .`. Do not hand-merge graph JSON or combine
  a graph from one run with a manifest from another.
- `graphify-out/graph.html` and snapshot-local HTML are untracked derived viz.
  The wrapper regenerates them with a high node limit. Immutable semantic-cache
  variants and portable snapshots are tracked; hydrated semantic data, AST
  caches, stat indexes, locks, work directories, and mutable aliases stay local.
- The design, migration procedure, integrity rules, and research references
  live in `docs/graphify-content-addressed-snapshots.md`.

## Delivery messaging

- When finishing a branch update in this workspace, always report the pushed remote branch and the PR URL.
- If a PR exists (or was created), include the PR URL in your completion response.
- For every web-app branch or PR delivery, actively discover its Vercel preview before finishing: inspect the PR checks or deployment status first, then the Vercel project deployments when needed. Always include the most recent reachable branch preview as a clickable `Preview:` link in the completion response. If no reachable preview exists, is pending, or cannot be verified, explicitly say so and include the relevant PR check or deployment dashboard link with the reason; never silently omit preview status.
- When making or validating deployment, Vercel, hydration, environment, or local
  runbook workflow changes, add a concise dated entry to `remix/CHANGELOG.md`
  under `[Unreleased]` before finishing.
- For large PRs or PRs with several rounds of debugging, add or update a
  PR-specific note in the root `PRs/` directory named with the PR number,
  branch slug, and PR title slug, then keep `remix/CHANGELOG.md` as a concise
  grouped summary that links to the detailed PR note.

## Preserved global AI_ALL.md — reference snapshot, 2026-09-11

The following block retains all 38,768 bytes of the global source at review
capture (SHA-256 `72fa2b188df422ce376dfb18b8db5987f76d4714e090b24c1ef2c272f9f56881`).
It is source material, not another active instruction layer. Live global policy
still comes from its canonical path; make global updates there only. Keep the
repo's current wrapper, immutable Graphify outputs, contribution lanes and
runtime guidance above. In particular, this archive's generic mutable-Graphify
and browser/scheduling guidance must not undo current applicable instructions.
Refreshing this archive does not authorize running its commands or editing any
global symlink. Keep the preserved block verbatim when updating this repo file.

<!-- global-ai-all-snapshot:start -->
````markdown
# Canonical global AI instructions (non-waivable)
- `/Users/lopu/.AI/AI_ALL.md` is the only writable canonical global AI instruction file. Make every global instruction update directly to that exact path.
- `/Users/lopu/.codex/AGENTS.md` and `/Users/lopu/.claude/CLAUDE.md` must always remain symbolic links resolving to `/Users/lopu/.AI/AI_ALL.md`. Never create or maintain separate mirrored copies.
- Never write, edit, patch, copy, synchronize, redirect output to, or otherwise replace either global symlink path. This prohibition includes editing through the symlink even when it currently resolves to `AI_ALL.md`.
- Never run `cp ~/.AI/AI_ALL.md ~/.codex/AGENTS.md` or any equivalent `cp`, `cp2`, `rsync`, `install`, `mv`, `tee`, shell-redirection, editor, or patch command targeting the global `AGENTS.md` or `CLAUDE.md` paths. Copying identical content is still forbidden because it can replace a symlink with a regular file.
- After changing `AI_ALL.md`, run `/Users/lopu/.codex/bin/sync-ai-all --check`. If either link is absent, incorrect, or a regular file, use only `/Users/lopu/.codex/bin/sync-ai-all --repair` to restore it; the repair command is the sole permitted mutation of those two symlink paths and backs up unexpected regular files first.

## Also read my Codex instructions
After reading this CLAUDE.md, always read my global Codex guidance and follow any
applicable instructions there:
- `~/.codex/AGENTS.md`
- `~/.codex/AGENTS.override.md` if it exists; apply it after `AGENTS.md` because
  it takes precedence.

When working inside a project directory, also locate and read the applicable
project `AGENTS.md` files before editing or making project decisions. At minimum,
read the project-root `AGENTS.md`, every `AGENTS.md` on the path from the project
root to the current working directory, and any `AGENTS.md` in subdirectories that
contain files you will inspect or modify. If multiple instruction files conflict,
the more specific project-local `AGENTS.md` wins over broader guidance unless a
higher-priority global instruction explicitly says otherwise.

If anything in Codex or project `AGENTS.md` files conflicts with this CLAUDE.md,
CLAUDE.md wins.

# graphify
- **graphify** (`~/.Codex/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

## Finding my Claude Design questionnaire answers
My prototypes are built in Claude Design (claude.ai/design, also in the Claude
Desktop sidebar). When I ask for the answers I gave to a project's intake
questionnaire ("Claude has some questions"), get them from Claude Design — NOT
from Cowork/desktop chat history or local session files:
1. Open claude.ai/design with the Chrome tools (I'm logged in as NF).
2. Open the relevant project (e.g. "Thingtime project launch" = my first
   Thingtime prototype build).
3. Answers are at the top of the project's chat, in the opening
   "Questions answered" block. The exact question wording is collapsed;
   the stored record is the field:answer list.

# Graphify folder workflow
- For every Codex session with an attached folder where the task involves folder, file, repo, codebase, docs, or project-content work, use graphify as the default folder map before broad manual inspection.
- Before folder work, check the target root for `graphify-out/graph.json`. If it is missing, initialize the folder with the full graphify flow, not a raw partial extraction: prefer `/graphify <folder>` or run `graphify extract <folder>` and then run the cluster/report/html generation step supported by the installed CLI, such as `graphify cluster-only <folder>` plus the equivalent HTML/export step. A finished initial build should leave usable portable outputs such as `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/manifest.json`, and `graphify-out/cost.json` when the corpus and CLI support them.
- Run folder/file/codebase questions through the graphify CLI before broad `rg`, `find`, `ls`, or one-off file reads: use `graphify query "<question>" --graph <folder>/graphify-out/graph.json`, and use `graphify path` or `graphify explain` for relationship tracing.
- Graphify query hard rule: before every `graphify query`, convert the request into concrete graph vocabulary such as changed files, routes, symbols, functions, classes, or domain nouns; never seed with generic package metadata terms like `repository`, `api`, `package`, `scripts`, `dependencies`, `name`, `version`, `license`, `homepage`, `bugs`, `env`, or `config` unless that metadata is the target.
- If graphify skips, removes, or would delete `graphify-out/graph.html` because the refreshed graph is above the default visualization limit, regenerate the HTML export with an explicit high limit so the portable graph output stays present. Use `GRAPHIFY_VIZ_NODE_LIMIT` set above the current graph node count with generous headroom, for example `GRAPHIFY_VIZ_NODE_LIMIT=1000000 graphify export html` from the project root, or rerun the refresh/export command with that environment variable. Do not accept a `graph.html` deletion solely because the default viz cap was too low; only skip HTML when generation is genuinely impossible or the user asks to skip it, and state that limitation plainly.
- For graphify builds that need semantic/LLM extraction on this machine, use the local Codex LLM proxy by default instead of a direct provider key: first confirm `http://127.0.0.1:4768/api/health` is healthy or start `codex-llm-proxy` with PM2 from `/Users/lopu/things/code/lopugit/llm-proxy`; run graphify with `OPENAI_BASE_URL=http://127.0.0.1:4768/v1`, `OPENAI_API_KEY="$(cat ~/.codex-llm-proxy/key)"`, `GRAPHIFY_OPENAI_MODEL=codex-default`, `--backend openai`, `--max-concurrency 4`, and `--api-timeout 7200`. Never print the local proxy key in chat, logs, docs, commits, or command output.
- Do not let missing, slow, or failed semantic/LLM extraction prevent a usable graphify build. If the proxy or semantic backend is unavailable, report the limitation plainly, continue with structural/code-only extraction or update, and still run the cluster/report/html generation step from whatever graph data exists. State that docs, Markdown, PDFs, images, or other non-code content were not semantically indexed when that fallback is used.
- After changing files or folders in an initialized target, always refresh the graph. Use `graphify update <folder>` for incremental refreshes and do not do a full rebuild unless the graph is missing, corrupted, explicitly requested, or the incremental path cannot handle the change. If only code files changed, run the code-only update path and skip semantic extraction. If Markdown, docs, PDFs, images, or other non-code corpus files changed, run the semantic update/extract path with the local proxy when available, then rerun the cluster/report/html generation step so the portable outputs stay current. If semantic extraction is unavailable or fails, fall back to the code-only update and still regenerate the available outputs, with the limitation stated clearly.
- For every git repo with `graphify-out/` or any newly initialized graphify output, verify the repo-local graphify hooks and merge driver before the first graph-related commit, merge, or PR push. Run `graphify hook status`; if either `post-commit` or `post-checkout` is missing, run `graphify hook install` from the repo root and then rerun `graphify hook status`. Also ensure `graphify-out/graph.json` is routed through Graphify's union merge driver: set `git config merge.graphify.name "graphify graph.json union merge"` and `git config merge.graphify.driver "graphify merge-driver %O %A %B"` when missing, add or preserve the tracked `.gitattributes` line `graphify-out/graph.json merge=graphify`, and verify with `git check-attr merge -- graphify-out/graph.json`. After a merge-driver merge, regenerate the derived portable outputs (`GRAPH_REPORT.md`, `graph.html`, `manifest.json`, `cost.json`) with `graphify cluster-only <folder>` or the appropriate update/export step rather than hand-resolving generated graphify files.
- If graphify is missing or the folder cannot be initialized/updated, install or repair graphify when permissions allow; otherwise report the blocker plainly instead of silently falling back.
- Keep graphify-generated artifacts in sync and update each project's ignore rules so the useful graph outputs are committed while temporary/local graphify internals are ignored. Commit portable outputs such as `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`, `graphify-out/manifest.json`, and `graphify-out/cost.json`; ignore machine-local or regenerable files such as `graphify-out/.graphify_python`, `graphify-out/.graphify_root`, `.graphify_*` temp/cache files, chunk files, and other graphify scratch folders unless explicitly requested.

# Shell session hygiene
- If Bash prints `syntax error: unexpected end of file` followed by `error importing function definition for '<name>'`, assume the current AI process inherited stale or malformed exported Bash functions (`BASH_FUNC_*`) before the user's fixed startup files could run.
- Prefer renewing into a fresh login Bash with the current startup files after clearing the stale inherited function-export environment. The goal is a clean login Bash, not a long-running non-login workaround.
- Do not try to fix this by launching another login Bash from the same polluted Bash environment alone: Bash imports exported functions before it reads `.bash_profile`, `.bashrc`, or `BASH_ENV`. If import spam appears, use a sanitized launcher only as a bridge to clear or avoid inherited `BASH_FUNC_*` variables, then start a fresh login Bash so the current `.bash_profile` and `BASH_ENV` take effect.
- Verify the clean path with `bash -c 'declare -F add >/dev/null && echo has-add; env | grep "^BASH_FUNC_" || echo no-exported-functions'`. A healthy Codex/noninteractive shell should report the function is available and no exported functions are present.
- If a fresh login Bash is still noisy after sanitizing, tell the user the already-running Codex app/server process likely needs a full restart to drop the old parent environment.
- Do not edit zsh config for this Bash exported-function issue unless the user explicitly asks.

# Scheduled wake-ups
- **Never use `ScheduleWakeup` under any circumstance.** For a future or recurring continuation, use `/loop` with a standalone cron-scheduled automation/job instead of a chat-attached wake-up.
- Treat every `/loop` request as requiring a cron-backed scheduled automation, including when the user omits an interval. Never reinterpret a missing interval as "dynamic mode", immediate one-session execution, or permission to skip scheduling. Infer and state a reasonable cron cadence from the task context; ask the user only when the cadence materially affects safety or cost and cannot be inferred safely.
- The cron job is the wake-up mechanism: each run must inspect durable task state, check or resume the work, and continue it toward completion. Working on the task immediately in the current session is encouraged when useful, but it never replaces arming the cron job unless the user explicitly cancels the loop or asks for immediate-only execution.
- Every `/loop` task must be idempotent, detect already-running or already-completed work and no-op, prevent overlapping runs, persist enough state for a fresh scheduled run to continue safely, and include explicit completion or stop conditions. When the task is complete, the scheduled job must record completion and stop or disable further runs. Do not emulate scheduling with `sleep`, a foreground wait, or repeated wake-up calls.

# Browser automation preference
- For browser-dependent tasks, prefer using the user's live Chrome window or tab first when available, especially when the task may depend on logged-in state, cookies, extensions, or visible page context.
- Chrome extension control may be exposed through the Node/browser-client bridge rather than visible `chrome_*` tools; check that bridge before assuming the Chrome plugin is unavailable.
- If a live Chrome tab is unavailable, unsuitable, or cannot be controlled reliably, fall back to Playwright-based browsing.
- If Playwright browsing is needed but Playwright or its browser runtime is missing, install the required pieces when the current permissions allow it: Playwright package support, a compatible standalone Chromium/Chrome browser, and any Node/runtime compatibility dependencies needed for Playwright to launch successfully.

# UI change verification
- For every UI, frontend, or visual layout change, open the affected page or app in a Chrome tab before finishing the task whenever it can be run locally, on a preview URL, or in production. Inspect the changed states at the relevant desktop and mobile viewport sizes, then fix alignment, overflow, clipping, and overlapping issues before handing back.
- During that browser check, scroll each affected page from the top all the way to the bottom at the relevant viewport sizes. Verify that sticky elements, long content, section transitions, lazy-loaded content, and bottom-of-page content remain aligned and free of overflow or overlap.
- If the changed experience includes modals, pop-ups, drawers, menus, accordions, tabs, dropdowns, expandable panels, hover/focus states, or other nested dynamic content, interact with those controls so the relevant states are visible and testable. Fix layout, stacking, clipping, focus, and overflow issues in those opened states before handing back.
- If Chrome UI testing reveals an infinite scroll, recursive loading loop, repeating pop-up/modal/drawer, navigation loop, or any recursive clicking/scrolling edge case, do not keep interacting indefinitely. Stop that path, refresh the page once, and retry only once; if it gets stuck again, move on to the next test path or task and report the loop plainly.
- Treat text or controls sitting too high, too low, too far left, or too far right as layout defects. Also fix text that wraps badly, clips, escapes its container, collides with adjacent content, or causes horizontal scrolling unless the user explicitly asks to defer visual cleanup.

# macOS app local installation
- After successfully building and verifying a macOS `.app` bundle for local use, always copy the final runnable bundle into the standard per-user `~/Applications/` directory (plural) before treating the build as complete. Create that directory if it is missing, and report both the build-output path and installed path.
- Preserve code signatures, extended attributes, and bundle contents when copying, such as by using `ditto`. Resolve and validate the exact source and destination first; replace only the same named destination app, and never overwrite or delete another app bundle.
- Verify the installed copy itself with `codesign --verify --deep --strict` and a bundle executable check. Future launches and user-facing app links should use the installed `~/Applications/<AppName>.app` copy rather than a transient build, archive, DerivedData, or repo `dist` path.
- Do not install a partial or failed build. Run the project's required tests and canonical verification path first, and keep any prior known-good installed copy when verification fails.

# macOS privacy permission signing and testing
- For direct-distribution macOS builds, prefer an installed `Developer ID Application` identity and a secure signing timestamp whenever one is available. Do not silently replace it with `Apple Development`, `Apple Distribution`, or ad-hoc signing: those are distinct trust models and do not make a Gatekeeper-ready direct download. Keep development signing explicit and fail closed for a requested distribution build when the Developer ID identity is unavailable.
- Keep Apple Developer certificates, private keys, and notarization credentials in the Keychain or approved CI secret store only. Never print, export, commit, or copy them into documentation; notarization remains a separate requirement for public direct downloads.
- For apps that need Screen Recording, Accessibility, Automation, camera, microphone, or another TCC-controlled permission, establish a stable bundle identifier and stable Apple Development signing identity before asking the user to grant access. Do not use repeatedly changing ad-hoc signatures for iterative permission testing: macOS can retain a blue/enabled System Settings toggle for an older code requirement while rejecting the rebuilt app whose ad-hoc CDHash changed.
- Discover and validate the intended `Apple Development` identity with `security find-identity -v -p codesigning`; allow a project-specific override instead of silently falling back to ad-hoc signing. Keep the same bundle identifier, signing identity, entitlements, and installed application path across rebuilds. A signing-identity or designated-requirement change is a one-time TCC migration and must be reported to the user.
- Assemble and sign the runnable bundle in a clean, deterministic staging directory outside iCloud Drive, Documents File Provider, or another synchronized folder, such as `~/Library/Caches/<bundle-id>/bundle-stage/<AppName>.app`. This avoids Finder metadata, resource forks, and extended attributes that can make `codesign` fail with “resource fork, Finder information, or similar detritus not allowed.” Sign nested code first when present and the outer app last; use hardened runtime for the final app where supported, then verify the staged bundle with `codesign --verify --deep --strict`.
- Inspect and record the designated requirement with `codesign -dr - <app>` and the signing details with `codesign -dvv <app>`. Rebuild and sign a second time when establishing a new local workflow, then confirm the designated requirement remains identical even if the binary CDHash changes. Treat a changing designated requirement as a release-process defect before testing permissions.
- Install the exact verified signed bundle into `~/Applications/<AppName>.app` with `ditto`, verify the installed copy again, and launch only that installed copy. Before diagnosing TCC, use a read-only process check to confirm the running executable resolves to the installed path rather than `.build`, DerivedData, `dist`, or a stale copy elsewhere.
- Test each privacy permission independently using the appropriate preflight API, such as `CGPreflightScreenCaptureAccess()` for Screen Recording and `AXIsProcessTrustedWithOptions` without prompting for Accessibility. Request access only after an explicit user action; do not repeatedly call a prompting API on startup or after every failed refresh. The app should show actionable instructions and a button that opens the exact Privacy & Security pane.
- When System Settings shows the app enabled but the preflight still fails, inspect recent unified TCC logs for that bundle identifier and messages such as `Failed to match existing code requirement` before changing code or resetting permissions. Never print unrelated TCC records or sensitive application history. A stale grant after moving from ad-hoc to stable signing normally requires the user to switch that app off and on once in the relevant privacy pane, then quit and reopen the installed app.
- Do not automate a privacy-toggle change or run `tccutil reset` without the user's explicit confirmation at the moment of the action. Prefer the narrow off/on migration for the exact app; explain that `tccutil reset` can remove grants more broadly. After the user refreshes the grant, relaunch the installed copy and verify the real protected operation, not just the toggle or preflight result: capture an actual window for Screen Recording and perform a harmless focus/read operation for Accessibility.
- A permission-sensitive macOS build is complete only after tests pass, the staged and installed signatures verify, the installed executable path is confirmed, Screen Recording and Accessibility preflights match the visible settings, and the app successfully performs its protected operations after a rebuild made with the same stable designated requirement. Preserve a prior known-good installed bundle whenever any of those checks fail.

# MarkItDown first-read workflow
- MarkItDown is installed globally at `/Users/lopu/.local/bin/markitdown`, and the MarkItDown MCP server is installed at `/Users/lopu/.local/bin/markitdown-mcp`.
- Before reading any MarkItDown-supported file or URL, check `/Users/lopu/.codex/markitdown-filetypes.md`. If that file type is not marked with `[x]` or `[X]`, run it through MarkItDown first and use the Markdown output as the initial read.
- MarkItDown-supported inputs include PDF, PowerPoint, Word, Excel/spreadsheets, images with EXIF/OCR, audio with EXIF/transcription, HTML, CSV, JSON, XML, ZIP archives, YouTube URLs, EPUBs, plain text, and other formats supported by MarkItDown.
- Prefer the `markitdown` CLI for local files and the MarkItDown MCP `convert_to_markdown(uri)` tool for `file:`, `http:`, `https:`, or `data:` URIs when the MCP tool is available.
- Treat MarkItDown output as a first-pass reading aid, not a complete substitute for native inspection. If the Markdown output is too thin, loses structure, omits images/layout/charts/speaker notes/formulas/metadata, or the task needs exact structured data, open or parse the file with the appropriate native/domain tool as a fallback and state that fallback clearly.
- For text-native formats such as CSV, JSON, XML, HTML, and plain text, use MarkItDown when it improves readability or strips noise, but prefer direct parsing/native inspection when exact fields, rows, schema, markup, scripts, or data fidelity matter.
- If a file type is disabled in `/Users/lopu/.codex/markitdown-filetypes.md`, skip MarkItDown for that type and use the appropriate native/domain tool directly.

# Remote primary-branch safety (non-waivable)
- Never merge a branch or pull request into, enable auto-merge or a merge queue for, or push commits or ref updates directly to a remote repository's primary/default branch (`main`, `master`, or another server-designated default branch) unless an instruction explicitly authorizes that exact primary-branch action for that exact repository. If the repository or action is ambiguous, stop and ask.
- Primary-branch permission must be repository-specific. A direct user instruction or repo-local instruction counts only when it unambiguously applies to that repository and authorizes the relevant merge or push. Do not infer permission from requests to finish, publish, deploy, commit, push a feature branch, open a pull request, or perform related work, nor from a previous authorization for another task or repository.
- Without exact primary-branch authorization, work on a feature branch and, when otherwise permitted, push that feature branch and open or update a pull request. Leave the pull request open for review; do not merge it, enqueue it, enable auto-merge, or update the remote primary branch.
- Authorization for one repository never propagates to another repository. This includes related or external repositories, dependencies, services, SDKs, infrastructure repositories, submodules, sibling repositories, forks, and upstream projects touched while completing the same task. Each remote repository requires its own separate explicit primary-branch authorization.
- A repo-local primary-branch sync or auto-publish rule applies only to that repository. It never authorizes a primary-branch merge or push in any related external repository.
- For cross-repository work, identify each proposed primary-branch action separately and obtain permission for each repository before acting. Safe read-only work, local edits, feature-branch pushes, and pull requests may continue independently when otherwise authorized.

# GitHub project publishing
- All new projects should be initialized as git repositories and published to private GitHub repositories by default. If a new project has no GitHub remote, create a private repository for it before treating the project as durable work.
- Push owned changes to the private GitHub remote as often as practical: create focused commits for meaningful changes, use new branches for separate work streams, and push those commits/branches after verification unless the user asks to keep the work local.
- For existing repos, any file change is not complete until the owned changes are on a pushed branch and a GitHub PR exists, unless the user explicitly says not to commit, not to push, not to open a PR, or to keep the work local. Detached HEAD, unrelated dirty files, pending checks, failed non-blocking checks, missing preview URLs, or pre-existing untracked files are conditions to work around, not reasons to stop at local changes.
- Open every PR as a regular OPEN (ready-for-review) PR, never as a draft, unless the user explicitly asks for a draft. If an earlier step created a draft PR in the same task, mark it ready for review before handing back.
- If the checkout is on a detached HEAD after making or validating changes, create a scoped branch from the current HEAD before staging, preferably `codex/<short-task-slug>` unless the user requested another branch name. Then stage only the owned changes, commit, push that branch, and open a PR. Do not hand back "detached HEAD so I did not push"; detached HEAD means "make a branch here and publish it."
- If the worktree has unrelated modifications, leave them unstaged and continue. Use `git status --short`, `git diff --name-only`, and `git diff --cached --name-only` to confirm the staged set only contains owned changes. If user edits overlap the same files, preserve them and stage a narrow patch when possible; ask only when the overlap makes a safe commit impossible.
- If the current branch already has an open PR, push the owned commit to that branch and report the PR URL. If no PR exists, open a PR against the appropriate base branch after pushing. If the branch is protected, inappropriate for the task, or shared with unrelated work, create a new scoped branch from the current commit and open the PR there.
- If no GitHub remote exists, infer the canonical repo from local metadata when safe or create a private GitHub repo for new projects, then push. If the remote cannot be inferred for an existing project, ask one focused question instead of silently keeping changes local. If GitHub auth or network push fails after a real push attempt, keep the local commit, report the exact blocker and branch name, and do not describe the task as fully published.
- If CI, CodeQL, Vercel, or another deployment check is pending or failing for a reason unrelated to the change, still open a PR with the validation notes and current check state. Re-check after creating the PR and report the pushed branch, PR URL, latest check status, and any Vercel preview URL or dashboard link that exists.
- For every web-app branch or PR delivery, actively discover its Vercel preview before finishing: inspect the PR checks or deployment status first, then the Vercel project deployments when needed. Always include the most recent reachable branch preview as a clickable `Preview:` link in the completion response. If no reachable preview exists, is pending, or cannot be verified, explicitly say so and include the relevant PR check or deployment dashboard link with the reason; never silently omit preview status.
- Do not push secrets, local credentials, machine-specific caches, or generated private state. Add or update project ignore rules before publishing when needed.

# API capability manifests (non-waivable)
- Every externally reachable HTTP or remote API must have a machine-readable, origin-scoped capability manifest. Use independently versioned semantic feature identifiers (for example `api.devices`) as the compatibility contract; a Git commit SHA, deployment URL, route existence check, or UI build version is never sufficient compatibility evidence.
- The manifest must be generated from the API's canonical registry and active runtime route map. It must cover every executable endpoint, including intentionally undocumented diagnostics or internal routes, while publishing no account data, secrets, deployment configuration, filesystem paths, or environment values.
- Adding an endpoint, removing an endpoint, or changing an endpoint's request, response, permissions, side effects, pagination, or streaming behavior requires the same change to register or update its manifest feature. Bump the feature's SemVer deliberately: PATCH for compatible corrections, MINOR for compatible optional/additive behavior, and MAJOR for removals or incompatible behavior. Do not silently rely on a default version for a changed existing contract.
- Clients must ship a small explicit requirement map only for the features they use; they negotiate against the selected origin before persisting/activating an endpoint or performing dependent work. Require matching majors and the declared minimum compatible minor/patch. Keep any legacy route probe narrowly scoped, safe, time-bounded, and only for an explicitly supported no-manifest rollout path.
- Add or update automated coverage with every API change: assert every registered semantic operation and every active runtime route appears in the manifest, assert required client capability ranges accept compatible updates and reject missing/breaking features, and smoke the built server's manifest response. A route is not complete until this coverage, its manifest contract, API documentation, and client negotiation behavior are all updated together.

# Web app creation defaults
- For new web app creation requests, use Nitro, React Router in non-framework mode, and Vite unless the user explicitly asks for a different stack or an existing repo already requires one.
- For Vite apps that will be exposed through Tailscale Funnel, add or update a repo-local `vite.config.*` so `server.allowedHosts` includes the exact Tailscale Funnel hostname before handing back the public URL. Prefer an explicit hostname list for hosts the user controls; do not set `allowedHosts: true` unless the user explicitly accepts the broader dev-server exposure.
- For Funnel-backed Vite dev servers, bind the app to loopback, preferably `server.host: "127.0.0.1"` or the equivalent package script flag, and let Tailscale proxy from the public/tailnet listener into `127.0.0.1:<port>`. Do not use `0.0.0.0` for this pattern unless there is a specific non-Funnel reason to expose the dev server on every interface.
- Default visual direction for new web apps: clean, minimalist, greyscale, Vercel-style UI with restrained typography, neutral surfaces, and very little decorative color.
- New web apps should use a slide-out drawer pattern. When open on desktop and mobile, the drawer should be flush with the left, top, and bottom viewport edges with `0` spacing on those sides. If the current viewport does not require a 100% width drawer, leave breathing room on the right instead of forcing full width.
- When the drawer is collapsed, show only a compact drawer/menu icon trigger. Do not leave a long vertical rail or pane that consumes horizontal layout space.
- Main site content should be center aligned across the full available width, with max-width containers for readable content while keeping the overall page and primary content areas centered.
- Non-production web app builds and preview URLs should prefix the page title with a short environment/source identifier for at-a-glance tab management, such as `[TS]` for Tailscale Funnel, `[VC]` for Vercel preview, `[LC]` for localhost, or another concise project-specific dev identifier. Prefer the Magic/CodexTime pattern of host-based title prefixing in `index.html`; confirmed production domains may keep the normal public title.

# Vercel project setup
- New web apps and web app projects should be set up in Vercel by default. If a matching Vercel project does not already exist, create one and connect it to the project's private GitHub repository so new commits and all branches rebuild automatically.
- Use the Vercel admin API credentials at `/Users/lopu/things/cloud/config/enc/vercel.auth.all` when Vercel automation needs authentication, but never copy the secret value into chat, commits, logs, or project files.
- Record Vercel project and deployment URLs in a project-local `VERCEL_DEPLOYMENTS.md` file unless the project already has a clearly equivalent deployment README. Keep that file updated with the Vercel project/dashboard URL, production URL, branch/preview URL patterns, and any project-specific notes needed to find current deployments.
- For Nitro + Vite + React Router non-framework apps deployed on Vercel, make the Vercel build prove that the Vite static shell is present before trusting the deployment. Use a build path like `npm run build:client && NITRO_PRESET=vercel nitro build`, and configure Nitro `publicAssets` so it points at the real Vite `dist` directory from the project root, preferably with an absolute path such as `const publicDir = new URL("./dist", import.meta.url).pathname`; do not leave `publicAssets.dir: "dist"` if `srcDir: "server"` causes Nitro to emit an empty `.vercel/output/static`. Add a repo check such as `npm run verify:vercel-output` that asserts `.vercel/output/static/index.html` exists, contains the Vite `<div id="root"></div>` shell, and `.vercel/output/config.json` has filesystem routing before the Nitro fallback. If a live Vercel URL returns Nitro JSON like `Cannot find any route matching /` while `/api/...` works, inspect `.vercel/output/static`, fix the public asset path, rebuild, then ensure the public alias or production domain is assigned to the fixed deployment rather than an older broken deployment. Verify `/`, `/index.html`, at least one `/assets/...` file, and `/api/site` on the actual public alias after reassignment.

# AI and automated PM2 safety
- These rules apply to every PM2 process started or changed by Claude, ChatGPT/Codex, another AI agent, or any automated tool. Use a deterministic process name containing the project or worktree identity and its port; never create multiple timestamped PM2 entries for the same cwd, command, and ports.
- Before every start or restart, inspect `pm2 jlist` for matching names, cwd, command, and ports, and inspect every required listener with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Reuse the exact intended entry, remove an exact obsolete duplicate when authorized, and refuse to start while an unrelated process owns a required port.
- AI-started development and one-shot processes must default to `autorestart: false` (for example, `pm2 start ... --no-autorestart`). Never configure an unbounded restart loop. Only an explicitly user-approved persistent service may auto-restart, and its repo-local ecosystem config must set a sane `min_uptime`, a small finite `max_restarts`, and `restart_delay` or exponential backoff.
- If a process fails to start or exits rapidly, stop it immediately and diagnose the first failure; do not keep retrying. Check for descendant or orphan processes and verify they terminate when the PM2 parent stops.
- After any PM2 change, verify that there is exactly one intended entry, its restart counter stays stable, only the expected listeners and child processes exist, and the app is actually reachable before running `pm2 save`. Keep PM2 logs bounded with `pm2-logrotate` or an equivalent size-and-retention policy.

# Dev server port coordination
- Every local project dev server must use a project-specific unique port. Do not rely on framework defaults like 3000, 5173, 8000, or 8080 when adding or changing a project.
- Configure the chosen port durably in the project, preferably through `.env`, `.env.example`, package scripts, Vite/Next/Remix config, or another repo-local config file so future agents and automations reuse the same port.
- Before starting a dev server, check the intended port and pick a different unused project-specific port if it conflicts with another active project. Update the project's docs or queue notes with the final local URL.
- Whenever giving the user a dev URL, provide both the `localhost` URL and the project’s Tailscale/Funnel URL in the same message. Do not hand back only `localhost`; if the Tailscale URL is not configured or cannot be verified, say that explicitly and include what was checked.
- Treat global dev-URL delivery requirements as additive and non-waivable by project-local `AGENTS.md`, `CLAUDE.md`, README, PR, deployment, or delivery-message rules. If local instructions require PR, Vercel, production, preview, or other URLs, include those in addition to the global `localhost` plus Tailscale/Funnel dev URLs. When instructions appear to conflict, satisfy the stricter superset and explicitly report any unavailable or unverified URL instead of omitting it.
- When exposing a dev server through Tailscale, Vercel preview alternatives, or browser automation, use the configured project port and record the mapping from project name to local port/public URL in the project README or coordination docs.
- For web apps, add the dev server to PM2 using a repo-local `ecosystem.config.*` file, start it through that ecosystem entry, and run `pm2 save` so it persists after restart.
- Register web app dev servers with Tailscale using a public Funnel on the configured project port. Derive the public hostname from `tailscale funnel status --json` or `tailscale serve status --json`, then verify the public URL in browser or with `curl` before finishing.
- If a Tailscale/Funnel URL reaches the machine but the page shows Vite's blocked-host message or a Vite 403, treat it as a Vite `server.allowedHosts` issue rather than a Funnel routing failure. Patch the app's `vite.config.*` with the exact Funnel hostname, restart only the affected PM2 process, then re-check both the local and public URLs.
- If Vite cannot bind the configured port because the address is already in use and `tailscaled` is listening on the tailnet interface for that same port, keep the Funnel mapping and move the app bind to `127.0.0.1:<port>` instead of changing the project port. Update every durable start path that sets the host, including `vite.config.*`, package scripts, and the PM2 ecosystem file, then restart only the affected PM2 process.
- Record the Tailscale domain/public URL, mapped port, and any required Vite `allowedHosts` hostname in the project README alongside the local dev URL.
````
<!-- global-ai-all-snapshot:end -->
