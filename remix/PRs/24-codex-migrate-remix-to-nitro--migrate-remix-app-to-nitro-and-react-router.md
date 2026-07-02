# PR #24 - Migrate Remix App To Nitro And React Router

## Summary

- Replaced the Remix runtime with a React Router non-framework Vite client and
  Nitro server/API runtime.
- Added Nitro API adapters for the existing route modules, a root-data endpoint,
  SPA fallback routes, and Vercel output verification.
- Added a `vercel.json` override so Vercel uses the Nitro build path instead of
  the stale Remix framework preset.
- Added exact pnpm release-age exceptions for the locked `rolldown@1.1.4`
  packages required by Vite 8.1.2, preserving the broader release-age policy.
- Approved pnpm dependency build scripts for `bcrypt` and `core-js`, the
  lifecycle hooks Vercel blocks during strict preview installs.
- Pinned the web package to `pnpm@10.12.1` so Vercel Corepack uses the same
  package-manager generation as local verification.
- Patched the Vercel output routes so `/` and non-API app paths resolve to the
  static Vite shell instead of Nitro's server fallback.
- Added root `VERCEL_DEPLOYMENTS.md` notes for the Vercel project, aliases,
  preview URL pattern, and verified PR #24 preview deployment.
- Updated PM2, root package scripts, README, AGENTS, and CLAUDE runbooks for
  the Vite `9999` plus Nitro `10000` local dev split.
- Refreshed graphify outputs after the migration and added graphify/build
  artifact ignore rules.

## Verification

- `corepack pnpm --dir remix build`
- `git diff --check`
- `graphify query "What files implement the Remix to Nitro React Router migration on this branch, including dev scripts and API routing?" --graph graphify-out/graph.json`
- `GRAPHIFY_VIZ_NODE_LIMIT=15000 graphify update . --force`
- PM2-managed local smoke on `tt-nitro-react-router-9999`.
- Browser QA in the in-app Browser at `http://127.0.0.1:9999/` and
  `/vercel`, desktop `1280x720` and mobile `390x844`, including page identity,
  nonblank render, no framework overlay, console health, horizontal overflow,
  top-to-bottom scroll, Vercel filter input, and status popover checks.

## Known Issues

- `corepack pnpm --dir remix exec tsc --noEmit --pretty false` still fails in
  existing legacy typing areas: `CommanderV1Deprecated`, `CommanderV2`,
  `MagicInput`, `ReactiveNav`, `Thingtime`, `useUuid`, and `smarts`.
- The production build still reports existing direct `eval` warnings in
  `ThingtimeProvider`, `Commander`, and `smarts`, plus a large client chunk
  warning.
