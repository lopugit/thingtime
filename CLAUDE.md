## Shared agent instructions

- Always read both `CLAUDE.md` and `AGENTS.md` at the start of a repo session,
  whether the agent is running as Claude or Codex. Treat `AGENTS.md`
  workspace/runbook notes as shared repo instructions unless a rule explicitly
  names one tool.
- Before adding or changing agent instructions, check both `CLAUDE.md` and
  `AGENTS.md` for existing coverage. Keep shared rules in one canonical place
  with a pointer from the other file instead of duplicating long runbook text.
- When Lopu asks to add an instruction to `CLAUDE.md` or `AGENTS.md`, update
  the counterpart file as well so Claude and Codex keep using the same repo
  policy unless the requested rule is explicitly tool-specific.
- For PR reviews, prioritize code quality, performance, potential bugs,
  crashes, and especially security issues before style commentary.
- When cloning or checking out branches under `.test-branches/`, copy the
  parent checkout's local env files into the clone before running install,
  dev, build, or smoke checks. Preserve matching paths for root `.env*` files
  and nested app env files such as `remix/.env*`; keep these files untracked
  and never commit secrets.
- For local Remix development, use the PM2-managed `tt-remix-9999` app on port
  9999 and rely on rebuild/hot reloading for normal source edits. Do not
  restart the PM2 Remix dev server after every change; restart only for env var
  changes, dependency/native-binding changes, server config changes, a
  crashed/stale process, or an explicit user request.
- For layout or alignment changes, always verify the affected screen in a live
  browser window before finishing. Use screenshot evidence or measured element
  bounds across the relevant desktop/mobile viewport so centering, max-width,
  overflow, and overlap behavior match the request.
- The native iOS app lives in `iOS/` and uses XcodeGen; treat
  `iOS/project.yml` as the source of truth and run `xcodegen generate` inside
  `iOS/` before `xcodebuild` checks. Keep generated `.xcodeproj` files
  untracked.
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

## Fundamentals (read first)

Read `FUNDAMENTALS.md` before adding features. Non-negotiables:
- All data access goes through the Thingtime API (`remix/app/routes/api/v1/...`) + the API utils layer. UI/scripts/tests never touch MongoDB directly.
- **Seed and test by calling the real API** (e.g. seed users via `POST /api/v1/auth/register`), never by writing to Mongo directly — so seeded data and real signups share one code path.
- One `thingtime` db (`users`, `sessions`, `things`); one connection source (`mongodb/config.ts` `getMongoUri()`).
- Auth: httpOnly cookie carrying a signed JWT (`jti`/`sub`/`exp`) + a Mongo `sessions` doc for revocation; Bearer token supported for API clients.
- All user-facing notifications go through the Lopu toast (`components/Lopu/useLopu.tsx` — `useLopu()` / `useLopuStream()`), never raw Chakra `useToast` or `alert()`.

The active build roadmap lives in `claude-todo/`. The owner's engineering decisions + thinking method are logged in `DECISIONS.md` (read it to predict the call that fits — default to single-source-of-truth, determinism, test==live cohesion, merge commits).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
