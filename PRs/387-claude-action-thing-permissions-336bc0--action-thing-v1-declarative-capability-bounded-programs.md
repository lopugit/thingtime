# PR #387 — Action Thing v1: declarative capability-bounded programs

Branch: `claude/action-thing-permissions-336bc0` → `claude/components-runtime-split-336bc0` (stacked on #382)
PR: https://github.com/lopugit/thingtime/pull/387
Design doc: [action-thing-v1-design.md](action-thing-v1-design.md)

Together with #382 (Components runtime split from #291) this completes the
runtime trio: **Data Thing + Component Thing + Action Thing = program.**

## Shape of the change

1. **Registry** (`remix/app/schemas/registry.ts`): `action` + `action-run`
   grammars; step sanitizer over the closed vocabulary
   (things.create/get/search/update, actions.invoke, return); whole-value ref
   grammar (`$input.<name>`, `$step.<n>.<path>`, `$now`, `$$` escape,
   `ttConcat`) with proto-segment bans and earlier-step-only references;
   capability entries scoped by schema (+ invoke allowlists); limits clamped
   to server ceilings; **save-time capability-coverage check** (an action that
   saves has declared-and-true effects); `deriveActionEffects` (the inspector
   renders THIS, never author prose); `action-run` in PROTECTED_THINGTIME;
   `action-` reserved shareId prefix; pin-test entries.
2. **Executor** (`remix/app/api/utils/actions/execute.ts`): re-sanitizes at
   run time (legacy docs included); delegates every op to the ordinary things
   utils AS the invoking user (capabilities only narrow); one shared budget
   (deadline/ops/depth/childActions/bytes) across child `actions.invoke`
   recursion; direct + indirect cycles refused via the invocation stack;
   every run direct-inserts a protected `action-run` (newThingDoc posture,
   `storageClass: 'control'`, size-capped inputs/result echo + per-step
   trace); owner-scoped run-history read model.
3. **API**: `POST /api/v1/actions/run`, `GET /api/v1/actions/runs` — all-three
   registration, `actions.run` 60/min + `actions.runs` 120/min, session-only
   (PATs default-denied until a things.action scope exists). Actions
   themselves ride the unified things path.
4. **UI** (minimalist Apple-like, sm/md/lg sizing, `--tt-*` tokens, quiet
   tinted-dot `ActionChip`s): `/actions` browse + `/actions/:key` inspector
   (Takes / Does / Can access / Cannot access / Limits / Effects / Run panel /
   Last runs / Definition), ⚡ kind renderer + filter pill + click-through in
   /things, drawer entry, title arms.
5. **Demo** (`remix/scripts/seed-demo-app.mjs`): customer/invoice schemas with
   `{field}` render templates, Customer/Invoice Card components, and
   create-customer / generate-invoice / send-invoice / onboard-customer
   actions — idempotent, real API only.

## Debugging history worth keeping

- **registry `isFail` is NOT null-safe** (`value.ok === false` on a generic) —
  `parseActionRef` returns `null` for plain literals, so every call site must
  discriminate `'kind' in ref`, never `isFail(ref)`. Symptom: 500s on any
  action whose step values contained a literal string.
- **Schema NAME refs resolve owner-scoped** (own `crystal.name` lookup), so a
  foreign invoker of a shared action can't resolve them. Rule: shareable
  actions reference schemas by ID (public schema things resolve for any
  viewer); name refs are an owner-side convenience. Encoded in the verify
  battery and the demo seed.
- **`action-run` had to be protected + direct-inserted**: `createThing`
  refuses protected kinds and generic reads `$nin` them, which is exactly
  right for a forgery-proof audit trail — but it means run history needs its
  own read model (`GET /api/v1/actions/runs`).
- **routes.tsx conflicts with #299's code-splitting** for anything from the
  #291 era — re-author route entries in the `lazyRoute` idiom; named exports
  need a custom lazy fn.
- Run history fetched on mount only → in-page runs didn't appear until
  reload; fixed with an `onRan` refresh callback.

## Validation (2 full passes)

- `verify-actions.mjs` — **52/52** (twice, plus once mid-fix at 51/52).
- `verify-components.mjs` on this branch — **30/30** (stack composes).
- `builtinSchemaProjection.test.ts` 58/58 · `test:things` 7/7 · targeted lint
  0 errors · `build:client` clean.
- Browser (desktop + 375px mobile): logged in, seeded the demo, ran
  onboard-customer from the inspector (ok · 41ms · 5 ops · depth 1 · 2 child
  actions; hierarchical trace 1→1.1/1.2, 2→2.1/2.2/2.3; ttConcat-composed
  "Invoice for Margaret Hamilton"), ran send-invoice (status draft→sent,
  `$now` sentAt), watched the /things schema-render card update to "— sent",
  verified run history persists, no horizontal overflow at 375px.

## Deferred (with rationale)

- ~~`ttAction` bindings inside component render trees~~ — **SHIPPED in Round 4
  (7e8f751a1)**: `ttAction`/`ttActionInputs` node keys fold into
  `data-tt-action`/`data-tt-action-inputs` (the only two data-* attributes the
  sanitizing renderer allowlists; inert markup, no URL/JS sinks, tt keys
  stripped from nodes); `useTtActionClicks` onClickCapture on trusted surfaces
  runs the action AS the viewer (no new authority; executor envelope bounds
  the run). /things renders component things through the kind renderer now
  (resolved savedArgs; PreviewModal is the interactive surface, grid tiles
  stay pointerEvents:none for selection). Browser-verified: Send pill inside
  a rendered Invoice Card → send-invoice ran 28ms · 2 ops, invoice
  draft→sent. componentTemplate.test.ts guards the fold (test:actions 19/19).
- `things.delete` op, `forEach`/`if`/`parallel`/`retry` primitives (each with
  explicit limits), Connection-owned external capabilities
  (`mailgun.send-email` style), PAT scope for runs, non-declarative executors
  behind the same Action interface.

## Round 3 — Lopu review round 2 rebuilt on-branch (2026-08-25, commit 7706c3eef)

Lopu's second review confirmed the four executor-contract fixes and raised two
NEW findings in the builder; its prepared fixes again never landed on the
branch (head pinned at `e91d0baf`), so both were rebuilt from the findings:

1. **Derivation honesty** — `deriveRequiredCapabilities` now unscopes the
   whole capability the moment one step for it lacks a literal schema. The
   regression: `things.search {schema}` + bare `things.get $input.x` derived
   `things.read: [schema]`, which saved (save time can't resolve dynamic ids)
   and then refused mid-run — while `deriveActionEffects` reported the same
   step as the `'*'` broad read. One unscoped step ⇒ unscoped capability;
   the chip and the effects summary can no longer contradict. Same rule for
   `actions.invoke` without a literal action name.
2. **Canonical-decimal coercion** — `coerceValueText` moved into
   `actionInspect.ts` (pure, testable) and only coerces text matching
   `^-?(0|[1-9]\d*)(\.\d+)?$`: `0412345678`, `0800`, `007`, `1e3`, `0x10`,
   `Infinity` stay strings (`1.50` still reads 1.5). Zero-padded values were
   unauthorable: coercion was lossy AND string schema fields reject numbers.

Tests: `app/components/Actions/actionInspect.test.ts` (13) + `test:actions`
script wired into the `test:unit` chain web-ci runs. Revert-proofed both
directions (old derivation fails the sibling-widening + effects-agreement
tests; old coercion fails the zero-padded/exponent test).

### Validation (this round)

- `test:actions` 13/13 · `test:schemas` 81/81 · targeted lint clean ·
  `build:client` clean.
- `verify-actions.mjs` **56/56** and `verify-components.mjs` **30/30** against
  the live worktree stack (after clearing an orphan port-squatting dev pair on
  17050/17052 — the PM2 entry was crash-looping on "port in use"; killed the
  orphans by port, clean restart, re-ran green).
- Browser click-through (desktop 1280 + 375px mobile, no horizontal
  overflow): authored **Stamp phone note** in the builder — search scoped to
  a schema + bare get + update stamping `phone: 0412345678` — and watched the
  derived CAN ACCESS chips show **unscoped** `things.read` (the fix, live);
  saved definition carries `"phone": "0412345678"` as a string. First run
  failed cleanly (`Schema "Customer" was not found` — demo schema is
  lowercase) and the error run landed in LAST RUNS with budget stamps — the
  inspectable-trail invariant covering the failure path. Edited the step to
  `customer` through the unified things path (grammar re-validated on save),
  re-ran from the inspector: **ok · 26ms · 3 ops**, per-step trace, Margaret
  Hamilton stamped with the zero-padded phone string intact and schema
  provenance preserved. Intent → build → inspect → edit → re-run, all in UI.

## Round 4 — ttAction reachability, precisely mapped (2026-08-25)

Traced the ttAction binding end to end on the live stack and pinned exactly what
is and isn't reachable today:

- **Runtime: complete and safe.** `componentTemplate.ts` folds `ttAction` /
  `ttActionInputs` into `data-tt-action` / `data-tt-action-inputs` (verified
  live: the tester's `invoiceId` arg substitutes correctly into the DOM
  attributes). `useTtActionClicks` reads them and runs the action AS the viewer
  through the ordinary bounded `/api/v1/actions/run`. The firing wrapper lives in
  `ComponentKindRenderer` as `onClickCapture={context.untrusted ? undefined : …}`.
- **The trusted firing surface is wired but not yet exercised by a shipped
  route.** `/thing/:id` renders the raw JSON "Thing data" view (no kind render);
  `/components` catalog + args tester render the template *directly* through the
  sanitising renderers, bypassing the wrapper (confirmed live: clicking Send in
  the tester left the invoice `draft`); `/things` cards render with
  `untrusted: true`. So `ComponentKindRenderer` with `untrusted=false` — the one
  path that fires ttAction — is correct but has no current end-user route.
- **What this means for scope.** The click-to-run half of "🧩 Component → ⚡
  Action → 📦 Data" is built and inspectable; an end-user can't yet click Send
  in a rendered app because the trusted **app-composition render surface** (the
  "📁 My App" page that renders a component-kind thing through the kind registry)
  is beyond this runtime-primitive PR. Today, actions execute from the `/actions`
  run panel (verified: onboard-customer composition, 5 ops on one shared budget,
  and send-invoice draft→sent). The app-render surface is the natural next PR.
- **Open product decision (raised on the PR):** whether the `/components` tester
  should also fire ttAction behind a "this will run the action" confirm, or stay
  inert (the current safe default — no side-effectful runs while authoring).
