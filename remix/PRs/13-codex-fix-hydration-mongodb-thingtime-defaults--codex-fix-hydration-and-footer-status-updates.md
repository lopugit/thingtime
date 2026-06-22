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
- Uses env-overridable fallback project/team IDs and the `lopugits-projects`
  dashboard owner slug so deployment links point to
  `https://vercel.com/lopugits-projects/thingtime/deployments`.
- Avoids appending tokenless fallback phase text to API error labels.
- Fixed preview footer branch display by preferring `VERCEL_GIT_COMMIT_REF`
  over stale committed `.env.auto` branch data.
- Keeps Vercel and MongoDB footer status dots visible in unavailable states by
  rendering neutral grey indicators with an outline.

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
