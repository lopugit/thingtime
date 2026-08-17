# components-db pipeline

Deterministic generator + seeder for the Thingtime UI component catalog
(`components-db/` at the repo root — one JSON per component + `index.json`).
Browse the result on `/components`; seeded components are system things
(`component-<slug>`), user "Save version" instances ride the same kind.

## Layout

- `lib/tokens.mjs` — 8 library token sets (antd, bootstrap, mui, shadcn,
  untitled, daisyui, reactflow, thingtime). All styling flows from these.
- `lib/helpers.mjs` — node builders + the arg-template DSL shorthands
  (`ttArg`/`ttMap`/`ttIf`/`ttMerge`/`ttRepeat` — never `$`-prefixed keys; the
  server render gate rejects those).
- `lib/archetypes/<id>.mjs` — one builder per archetype. Contract: exactly
  5 variants, `build(lib)` returns 5 `define()`d definitions, slugs
  `<library>-<archetype>-<variant>`. `button.mjs` is the exemplar.
- `lib/catalog.mjs` — `ARCHETYPE_ORDER` (append new ids under the tranche-2
  marker only; never reorder), tranche accounting, catalog assembly.
- `lib/resolve.mjs` — canonical DSL resolver (client twin:
  `remix/app/components/ComponentsLibrary/componentTemplate.ts` — keep
  semantics identical).
- `lib/validate.mjs` — mirrors renderer caps AND the server's raw-JSON node
  accounting (`countServerRenderNodes`, cap 580 vs server 600: every style
  value counts). Never nest a 6-tone `toneMap` inside another multi-value
  `ttMap`; use CSS `calc({token} * 20px)` for arithmetic the DSL can't do.
- `generate.mjs` — build + validate + write (`--check` validates only,
  `--archetype <id>` scopes either mode).
- `seed.mjs` — seeds via the real API only: admin login from untracked
  `.seed-env` (`TT_SEED_BASE` / `TT_SEED_ADMIN_USER` / `TT_SEED_ADMIN_PASS`),
  batches of 100 to `POST /api/v1/admin/components/seed`, idempotent.
  `GET` the same path = census `{ totalSeeded }`.

## Growth-loop runbook (10-minute cadence, target 6000)

Each iteration is idempotent and state is derived, never assumed:

1. `node scripts/components-db/generate.mjs --check` → current count +
   missing archetypes. `components-db/index.json` `.count` is the folder-db
   truth; the seed census GET is the DB truth.
2. If count < target: append ~2–3 NEW archetype ids to `ARCHETYPE_ORDER`
   (tranche-2 section), author their modules (follow `button.mjs` +
   `badge.mjs`; each id adds 40 components), and iterate
   `generate.mjs --check --archetype <id>` until clean. Keep archetypes
   genuinely varied — new UI patterns, not palette swaps of existing ones.
3. `node scripts/components-db/generate.mjs` (writes only new/changed files),
   then `node scripts/components-db/seed.mjs` (converges: unchanged for
   already-seeded slugs). A skipped slug is a bug to fix, not to ignore.
4. Commit source + components-db (discard `graphify-out/` churn first:
   `git checkout -- graphify-out/`), push to the PR branch, report the census.
5. Stop conditions: catalog + census reach the target (6000), or the weekly
   usage quota is exhausted (scheduled runs stop executing on their own; any
   in-session overage signal counts too). On completion: report and disarm
   the cron.
