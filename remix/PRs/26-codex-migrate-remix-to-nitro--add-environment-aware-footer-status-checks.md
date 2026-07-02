# PR #26 - Environment-Aware Footer Status Checks

Branch: `codex/migrate-remix-to-nitro`
PR: https://github.com/lopugit/thingtime/pull/26
Date: 2026-07-03
Author: Codex (AI), with Lopu testing and review

## Summary

This PR adds compact environment-aware status checks to the footer for the
Nitro API, frontend shell, Vercel deployment state, and MongoDB connection.

## Footer Status UX

- Added an environment selector for this tab, local, development, staging, and
  production status targets.
- Renamed the self-targeting option to `Current Tab`.
- Added a branch deployment option when the current branch URL is available.
- Scoped the saved dropdown preference to the current browser origin and ignored
  the old unscoped preference so previews do not accidentally default to a stale
  local target.
- Kept the selector compact and label-free so the selected environment text is
  the control.
- Hid selector chrome at rest and only reveals its background/border treatment
  on hover or focus.
- Aligned the selected environment text with the status row labels while keeping
  the focus box aligned with the status rows.

## Health Checks

- Added Nitro API and frontend liveness checks in the footer.
- Reused the existing Vercel and MongoDB status rows so every environment uses
  the same compact status language.
- Routed remote status checks through a constrained target-origin allowlist.
- Clears stale status labels into checking state immediately when the selected
  environment changes, then refetches the selected target.
- Fixed local Nitro/Vite development so ignored env files are loaded before
  child processes start, allowing localhost MongoDB checks to see the same
  credentials as the rest of the local app.

## Scroll Restoration

- Mounted React Router's scroll restoration component so reloads restore the
  browser's previous scroll position.

## Verification

- Verified the footer selector layout in the local browser at desktop and
  mobile widths.
- Verified reload scroll restoration in the local browser.
- Verified localhost MongoDB health returns connected after the local env is
  present and the PM2-managed dev app is restarted.
- Verified the Vercel preview URL for the PR returned HTTP 200 after deployment.
- Ran `corepack pnpm --dir remix build`.
- Ran `git diff --check`.
- Ran `graphify update .` after code changes.
