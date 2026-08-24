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

- `ttAction` bindings inside component render trees (a Send button in a
  rendered component invoking the action directly): needs allowlist work in
  the sanitizing renderers (`data-tt-action` prop + delegated click capture)
  — deliberately kept out of the sanitizer-touching surface of this PR.
- `things.delete` op, `forEach`/`if`/`parallel`/`retry` primitives (each with
  explicit limits), Connection-owned external capabilities
  (`mailgun.send-email` style), PAT scope for runs, non-declarative executors
  behind the same Action interface.
