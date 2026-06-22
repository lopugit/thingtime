# PR #13 - Hydration, Vercel Status, and Deployment Hygiene

Branch: `codex/fix-hydration-mongodb-thingtime-defaults`  
PR: https://github.com/lopugit/thingtime/pull/13  
Date: 2026-06-22  
Author: Codex (AI), with Lopu testing and review

## Summary

This PR stabilizes Remix full-document hydration with Chakra UI and Emotion,
adds Vercel preview/build status visibility to the app footer, and records the
deployment runbook changes discovered while validating Vercel previews.

## Hydration And Emotion

- Restored proper `hydrateRoot(document, ...)` document hydration.
- Added shared Chakra/Emotion server/client style context in
  `app/Providers/Chakra/emotionContext.ts`.
- Updated server rendering so Emotion critical CSS is collected and emitted as
  React-rendered `<style data-emotion="...">` nodes in `<head>`.
- Reworked client boot so existing SSR Emotion style tags are read and passed
  through the same style context during hydration.
- Removed the manual Emotion style clone/restore loop that could briefly expose
  unstyled content.
- Moved the Emotion sheet handoff before first browser paint using an
  SSR-safe layout effect, fixing intermittent boxed icons/layout snapping.
- Kept the Emotion handoff intentionally one-shot so `ClientStyleContext.reset()`
  cannot recurse into an update-depth loop.

## Vercel Runtime Fixes

- Fixed `TypeError: createCache is not a function` in Vercel serverless by
  resolving `@emotion/cache` across direct, `default`, `createCache`, and nested
  CJS default export shapes.
- Fixed `TypeError: createEmotionServer is not a function` in Vercel serverless
  by resolving `@emotion/server/create-instance` across direct, `default`, and
  nested default export shapes.
- Added local verification that loads the compiled SSR bundle with:

  ```sh
  cd remix && node -e "require('./build/server/index.js'); console.log('server bundle loaded')"
  ```

## Vercel Status And Branch Display

- Added a compact footer Vercel deployment status indicator.
- Added `/api/v1/vercel/status` and `/api/v1/vercel/status-data` endpoints.
- Supports tokenless local/preview fallback state.
- Uses `VERCEL_API_TOKEN` plus Vercel project identity when available to show
  deployment state, build phase, build progress, and build page links.
- Derives Vercel project name from the Vercel git repo slug when
  `VERCEL_PROJECT_NAME` is not configured, so setting only `VERCEL_API_TOKEN`
  can still query the deployments API when the token has access.
- Derives Vercel dashboard links from Vercel project/deployment API data when
  available, with `VERCEL_DASHBOARD_TEAM_SLUG` as an explicit tokenless
  override if Vercel does not expose the dashboard slug.
- Retries Vercel deployment API lookups without `teamId` after a `403`, then
  falls back to parsing the dashboard owner/project from the preview host so
  status-unavailable links still land on the Vercel deployments dashboard.
  A persistent `403` means the configured `VERCEL_API_TOKEN` does not have
  access to the Vercel team/project used by this preview.
- Polls Vercel status while builds are active and exposes last successful build
  completion metadata when the deployments API is available.
- Minifies Vercel footer copy so ready deployments render with compact elapsed
  ages like `12s`, active build percentages render without brackets, and
  redundant ready/STAGED wording is deduped.
- Replaces the Vercel progress bar with a tiny pale-track meter that keeps the
  build endpoint visible, hides when ready, and places a small failure marker
  where errored builds stopped.
- Adds tiny lucide manual refresh controls to both Vercel and MongoDB footer
  status rows, with the buttons kept outside the status links so refresh does
  not navigate away.
- Wires those refresh controls to actually call their status recheck callbacks,
  clear current labels into checking state, and show a tiny loading spin.
- Avoids appending tokenless fallback phase text to API error labels.
- Fixed preview footer branch display by preferring `VERCEL_GIT_COMMIT_REF`
  over stale committed `.env.auto` branch data.
- Keeps Vercel and MongoDB footer status dots visible in unavailable states by
  rendering neutral grey indicators with an outline, including MongoDB's initial
  checking state.

## Deployment And Repo Hygiene

- Removed `vercel.json` configuration so Vercel dashboard settings remain
  editable.
- Added `.test-branches/.keep` and ignored checkout contents for branch testing.
- Added AGENTS/CODEX runbook notes for PM2-managed local Remix dev server usage.
- Confirmed Vercel's Ignored Build Step can skip duplicate branch SHA deploys:

  ```sh
  [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]&&[ "$VERCEL_GIT_COMMIT_SHA" = "$VERCEL_GIT_PREVIOUS_SHA" ]
  ```

## Preserved Behavior

- Confirmed `smarts.merge(..., { clone: true })` still deep-clones nested values
  without mutating the source object.
- Preserved automatic `.env.auto` updates from `remix/scripts/pre-dev.sh`.

## Verification

- Targeted Remix ESLint checks passed for hydration and Emotion files.
- `corepack pnpm --dir remix run build` passed.
- Compiled SSR bundle import passed after Emotion interop fixes.
- Clean headless Chrome local smoke tests showed Emotion SSR style tags present
  and no React hydration, Emotion insertion, or update-depth console failures.
- `/api/v1/vercel/status-data` returned a local/unconfigured payload locally.
- Vercel marked the latest pushed preview deployment as successful after the
  server Emotion import fixes.
- `graphify update .` was run after code changes.
