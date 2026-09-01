# Thingtime AI instructions

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
  on) live in `things` by `kind`, plus `sessions` and the single-purpose
  auth/email satellites (`passwordResets`, `authOtps`, `email_*`, `rosters`).
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

## Local development and worktrees

## Commander macOS distribution signing

- For Commander direct-distribution builds, prefer an installed `Developer ID Application` identity whenever one is available. Do not silently fall back to `Apple Development`, `Apple Distribution`, or ad-hoc signing for a release build: those identities do not provide the same Gatekeeper contract.
- Keep local iteration explicit with `COMMANDER_SIGNING_MODE=development`; production/direct-distribution builds must fail closed when no Developer ID Application certificate and private key are installed.
- Keep Apple Developer and notarization credentials in the Keychain or CI secret store only. Never print, export, commit, or copy their values into project documentation.

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
- Committed git hooks live in `.githooks/`; enable them in a checkout with
  `npm run install-git-hooks` or `git config core.hooksPath .githooks`. There
  are currently no active hooks. Branch awareness needs no hook: local
  checkouts generate untracked `remix/.env.auto` via `pre-dev.sh`, and Vercel
  reads `VERCEL_GIT_COMMIT_REF` from the system env at build and runtime.
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

- All pull requests must target the `develop` branch, not `main`. `develop` is
  the integration base for every feature, fix, docs, and chore branch. Stacked
  branch → branch PRs keep their parent feature branch as base. Target `main`
  only when the user explicitly authorizes that exact PR against `main` (for
  example a `develop` → `main` promotion PR).
- When you find an open PR still based on `main` that is not an authorized
  promotion PR, retarget it to `develop` (`gh pr edit <n> --base develop`).
  GitHub refuses base changes on PRs that belong to a native stack; report
  those to the user instead of forcing them.
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
- Full `pnpm --dir remix exec tsc --noEmit` currently has pre-existing
  project/type failures outside many focused changes, including Commander
  components, `app/smarts/index.tsx`, and dependency declaration mismatches.
  Until those are fixed, use targeted linting plus focused runtime/build checks
  where possible and clearly report the full-project typecheck limitation.
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
