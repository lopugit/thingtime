## Codex workspace notes

- Always read both `AGENTS.md` and `CLAUDE.md` at the start of a repo session,
  whether the agent is running as Codex or Claude. Treat `CLAUDE.md`
  fundamentals and `AGENTS.md` workspace notes as shared repo instructions
  unless a rule explicitly names one tool.
- Before adding or changing agent instructions, check both `AGENTS.md` and
  `CLAUDE.md` for existing coverage. Keep shared rules in one canonical place
  with a pointer from the other file instead of duplicating long runbook text.
- When Lopu asks to add an instruction to `AGENTS.md` or `CLAUDE.md`, update
  the counterpart file as well so Codex and Claude keep using the same repo
  policy unless the requested rule is explicitly tool-specific.
- For PR reviews, prioritize code quality, performance, potential bugs,
  crashes, and especially security issues before style commentary.
- Also read `CODEX.md` for persistent environment/runbook notes before running checks or pushing branches from this workspace.
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
  TT_* overrides. If a worktree stack crash-loops with missing packages (e.g.
  `Cannot find package 'rolldown'`), the copied `remix/node_modules` is
  incomplete — run `corepack pnpm --dir remix install` and restart. If that
  plain install finishes in under a second reporting done but the package is
  still missing, the copied store's links are stale while pnpm thinks state is
  current — rerun with `corepack pnpm --dir remix install --force`.
  When preview/testing tooling needs to own the dev-server process (it usually
  cannot attach to the PM2-managed port), run a second foreground stack beside
  PM2 on a free trio: `TT_WEB_PORT=<web> TT_HMR_PORT=<hmr> TT_API_PORT=<api>
  npm --prefix remix run dev`. Keep any tooling config that hardcodes worktree
  ports (for example `.claude/launch.json`) untracked.
- Codex-managed worktrees use the root `.worktreeinclude` to copy ignored local setup into new managed worktrees. Keep tracked files out of `.worktreeinclude`, but preserve intentional ignored carryover paths for env files, dependency installs, and local generated state needed for validation. The current dependency directories alone are roughly 1.5 GB when present, and generated-output patterns can make managed worktrees larger.
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
- For rendered browser validation in Codex Desktop, prefer the in-app Browser first when it is available. If localhost is blocked there, or the user explicitly asks for Chrome, use the Codex Chrome tab control workflow (`chrome:control-chrome`) before falling back to standalone Playwright. Keep Chrome checks read-only unless the user requested an action, and do not inspect cookies, local storage, passwords, or profile data.
- For layout or alignment changes, always verify the affected screen in a live
  browser window before finishing. Use screenshot evidence or measured element
  bounds across the relevant desktop/mobile viewport so centering, max-width,
  overflow, and overlap behavior match the request.
- Optimistic rendering at all times: never flash a loading screen/spinner when
  prior or cached state exists — render last-known state instantly and refetch
  in the background. Canonical rule + the `~/hooks/localCache` first-paint tier
  live in `CLAUDE.md` ("Optimistic rendering at all times").
- Appended/child data (reactions, comments, any accumulating list) is
  relational: its own atomic `things` doc (`kind`) linked by `parentId`,
  batch-aggregated on read (one query per kind, never N+1), never an unbounded
  embedded array/map on the parent. Canonical rule lives in `FUNDAMENTALS.md`
  §3 ("Appended/child data is relational").
- New `/api/v1/...` endpoints must be registered in THREE places or Nitro
  404s them: the route file (`remix/app/routes/api/v1/.../_name.tsx` exporting
  `loader` for GET / `action` for POST), the import map in
  `remix/server/routes/api/[...].ts`, and the `apiRoutes` list in
  `remix/nitro.config.ts`. Copy the themes family for conventions: utils in
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
- For Vercel dashboard links, do not use `VERCEL_GIT_REPO_OWNER` as the
  dashboard owner slug; that value is the Git provider owner. Prefer Vercel API
  project/deployment data when `VERCEL_API_TOKEN` is available, or an explicit
  `VERCEL_DASHBOARD_TEAM_SLUG` env var for tokenless dashboard links.
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

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- graphify-out/graph.json + manifest.json are an atomic pair from one update run (manifest.json records which files are already analyzed). On any merge conflict under graphify-out/, take ONE side for the whole directory (`git checkout --ours -- graphify-out/` or `--theirs`, never mixed per-file), then run `graphify update .` and commit the refreshed outputs with the merge.
- Recovery for a poisoned pair (graph missing data for files `graphify update` reports as unchanged): delete graphify-out/manifest.json and run `graphify update .` — everything re-extracts (AST is free; semantic extraction is served from the tracked content-addressed cache in graphify-out/cache/semantic/) and a consistent pair is rewritten. `graphify update --force` bypasses the fewer-nodes guard after large deletions/refactors.
- graphify-out/graph.html is untracked derived viz — regenerate with `graphify export html`, never `git add` it. graphify-out/cache/semantic/ IS tracked (content-addressed, merge-safe); cache/ast/ and cache/stat-index.json stay local.

## Delivery messaging

- When finishing a branch update in this workspace, always report the pushed remote branch and the PR URL.
- If a PR exists (or was created), include the PR URL in your completion response.
- If Vercel preview deployment exists for that branch, include the most recent preview URL as well.
- When making or validating deployment, Vercel, hydration, environment, or local
  runbook workflow changes, add a concise dated entry to `remix/CHANGELOG.md`
  under `[Unreleased]` before finishing.
- For large PRs or PRs with several rounds of debugging, add or update a
  PR-specific note in the root `PRs/` directory named with the PR number,
  branch slug, and PR title slug, then keep `remix/CHANGELOG.md` as a concise
  grouped summary that links to the detailed PR note.
