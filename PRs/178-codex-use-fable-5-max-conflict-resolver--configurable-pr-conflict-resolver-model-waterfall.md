# PR #178 — Configurable PR conflict-resolver model waterfall

- **Branch:** `codex/use-fable-5-max-conflict-resolver` → `main`
- **PR:** https://github.com/lopugit/thingtime/pull/178

## What changed

- `resolve-pr-conflicts.yml` keeps a hard `default` model baseline and fetches
  one public Thingtime setting snapshot per resolver sweep. The remote value
  can select only the workflow's closed Fable 5 / Opus 5 / default allowlist;
  every malformed or unavailable response falls back to `default`.
- The workflow translates the ordered snapshot into Claude Code's native
  `--model` plus `--fallback-model` chain and retains max effort, its no-shell
  model sandbox, deterministic conflicted-path derivation, secret scan, and
  staged-tree verification.
- Thingtime stores `Thingtime.PRConflictAutoResolverModelWaterfall` as a
  singleton in the home settings collection. Its safe projection is publicly
  readable for GitHub Actions; writes require a freshly verified admin session.
- Settings → Admin provides an optimistic, reorderable model editor with a
  dedicated drag handle, accessible move controls, curated add/remove actions,
  a required default fallback, and explicit save feedback through Lopu.

## Security boundaries

- Database content never becomes raw action or shell arguments. Both the API
  and the workflow independently validate a small enum, and the workflow emits
  only hard-coded model names.
- The public endpoint exposes only the setting key, ordered enum values, and
  public model labels. It exposes no actor, timestamp, credential, or internal
  settings document.
- The GitHub job that fetches the setting checks out no repository code and
  receives no AI credential. Resolver credentials stay scoped to the existing
  Claude action step.

## Verification

- `corepack pnpm --dir remix run test:settings` — 8/8 focused normalization,
  authorization, persistence, projection, malformed-body, and body-limit tests
  passed.
- `corepack pnpm --dir remix run build` — production Vite + Nitro build and
  `verify:vercel-output` passed; the new endpoint was emitted as a Vercel
  function.
- `actionlint` and an independent Ruby YAML parse passed for
  `resolve-pr-conflicts.yml`; its embedded shell also passed syntax and fixture
  checks for ordered, reordered, malformed, duplicate, injection-shaped, and
  multi-document responses.
- Live local API checks confirmed public safe reads, anonymous write rejection
  (`401`), admin writes, invalid-model rejection (`400`), ordered public
  readback, and restoration to `["default"]`.
- Live browser QA passed on 1280x900 desktop and 375x812 mobile: add, remove,
  up/down, held-handle drag, save, reload persistence, top-to-bottom scrolling,
  and zero horizontal overflow. No new browser console errors were observed.
- The typecheck ratchet remains blocked by pre-existing project diagnostics
  (149 current versus a 143 baseline); filtering the compiler output to every
  changed/new TypeScript path produced no owned diagnostics. Targeted ESLint
  still fails before file analysis on the repository's existing
  `eslint-scope/lib/definition` export-resolution error.
- Graphify semantic extraction, clustering, report generation, and high-limit
  HTML visualization refresh completed through the local Codex proxy. Hooks,
  union merge driver, and the `graphify-out/graph.json merge=graphify`
  attribute are installed and verified.
