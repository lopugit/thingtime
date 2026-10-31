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
- **The trusted firing surface IS shipped and reachable — the `/things`
  PreviewModal** (`ThingsDialogs.tsx:561`). Opening a `component`-kind thing
  (grid tile → preview, or the `?preview=<id>` deep link) renders it via
  `<RenderThing context={{ size: 'full' }}>` — no `untrusted` flag, so
  `context.untrusted` is falsy and the `onClickCapture` ttAction wrapper is
  live. **Verified end to end:** opened the seeded "Invoice #0420 (live Send
  demo)" component (bound to a real invoice), clicked its Send pill in the
  modal, and the invoice flipped **draft → sent** with `sentAt` stamped and the
  Lopu toast firing — 🧩 Component → ⚡ Action → 📦 Data, from a rendered
  component. The grid tiles *behind* the modal carry the same `data-tt-action`
  but sit under `pointer-events: none`, so a grid click selects, never runs
  (also verified: those nodes are inert). `/thing/:id` (raw JSON) and the
  `/components` catalog/tester (rendered directly through the sanitising
  renderers, bypassing the wrapper) deliberately do **not** fire — confirmed by
  the invoice staying `draft` when clicked there.
  (Correction: an earlier draft of this section wrongly said no shipped route
  exercised the trusted path — it missed the `/things` PreviewModal.)
- **What this means for scope.** "🧩 Component → ⚡ Action → 📦 Data" is
  reachable by an end-user today through the `/things` PreviewModal, in addition
  to the `/actions` run panel (verified: onboard-customer composition, 5 ops on
  one shared budget; send-invoice draft→sent). A dedicated app-composition page
  ("📁 My App" rendering many component-kind things together) is a nice future
  surface, not a prerequisite for the flow to work.
- **Product decision — RESOLVED 2026-08-25 by the repo owner: the tester should
  fire.** The `/components/:key` live preview and args tester will run ttAction
  bindings behind a "this will run the action" confirm; the browse grid stays
  inert (one preview component renders feed/grid/columns, so arming it would arm
  an infinite scroller). Scoped out of this PR and specced as
  `TODO/claude-todo/20-tester-runs-actions.md` (roadmap item 19); the "📁 My App"
  composition surface above is specced as
  `TODO/claude-todo/21-app-composition-surface.md` (roadmap item 20).

## Round 5 — functional multi-review pass (2026-08-25, post-completion directive)

Three independent functional review lenses over the full diff (correctness,
UX/design-consistency, docs-accuracy — review scope deliberately excluded
security/adversarial framing per the owner's directive), then fixes:

- **Optimistic cached paint on `/actions/:key`** (house-rule gap): the
  inspector now seeds instantly from the `/actions` list's `tt-actions-<user>`
  localCache (matched by id OR actionKey) while the authoritative fetch
  reconciles — no more blank 200px flash when navigating from the
  already-painted list.
- **ActionChip overflow guards**: chips cap at `maxWidth 100%` and ellipsize
  their label instead of pushing past the card edge at 375px (long actionKeys
  and multi-schema capability chips were the risk); the `actionKey · id` mono
  line wraps with `overflowWrap: anywhere`.
- **Family-consistent CTAs**: the three primary buttons (New action / Create
  action / Run action) moved `purple` → `pink`, matching the
  schemas/components builder family (`ComponentsBrowsePage`, `SchemaBuilder`).
  Tone dots and ⚡ accents stay purple — the action identity color is
  unchanged; only the CTA hue joins the family.
- **Trace polish**: run-trace target ids only get an ellipsis when actually
  truncated (previously unconditional).
- **Invisible NUL byte** found and removed inside the `requestKey` template
  literal in ActionDetailPage.tsx (runtime-harmless — both comparisons used
  the same expression — but it made grep classify the file as binary and
  broke exact-match tooling). Worth remembering as a debugging pattern:
  "grep says binary but the file looks like source" ⇒ scan for `\x00`.
- **Design-doc reconciliation** (drafted pre-implementation, never fully
  re-synced): input descriptors use `name` not `key`; `things.search` has no
  `filter` grammar in v1; run records link via `targetId` not `parentId`;
  there is no `GET /api/v1/actions/browse` (browse rides the unified things
  path); no `action-run` /things renderer (protected kind — runs render in
  the inspector); actionKey is owner-scoped-resolved, not index-unique, and
  no seed mints `action-<slug>` shareIds (the reserved prefix refuses user
  creates; the executor mints `action-run-<uuid>`); the limits grammar lists
  `maxInputBytes`; the invariants table now names the real mechanisms
  (hasOwnProperty-gated path resolution; `data`-kind crystal validation with
  schema provenance stamps).

### Validation (tip, this round)

- verify-actions.mjs **63/63** · verify-components.mjs **30/30** (needs the
  explicit base-url arg: `node scripts/verify-components.mjs
  http://127.0.0.1:<nitro-port>` — its default is another checkout's port).
- test:actions **23/23** · test:schemas **81/81** · test:things **7/7** ·
  builtinSchemaProjection **58/58** · targeted lint 0 errors ·
  `build:client` clean.
- Browser (desktop + 375px): ran Tag customer from the inspector
  (ok · 21ms · 2 ops, per-step trace, zero-padded phone survives as string,
  Last runs onRan-refresh); reset the demo invoice to draft and re-fired the
  PreviewModal Send pill (🧩→⚡→📦: draft→sent + fresh `sentAt`); inspector
  and browse pages show zero horizontal overflow at 375px with schema-name
  chips resolved.

### Round 5b — correctness-lens fixes (same review pass)

The correctness lens confirmed four defects; all fixed and regression-tested:

1. **Input-default/type congruence.** The builder coerced defaults blindly
   (`'true'` on a string input became boolean `true`), producing actions whose
   defaults could never pass run-time input validation when the input was
   omitted (`actions.invoke` children, ttAction clicks, API runs). Now:
   `coerceInputDefault` (pure, tested) coerces only toward the declared type,
   and `sanitizeActionInputs` refuses incongruent defaults at save time —
   string/text need text, number needs a number, boolean needs true/false,
   enum defaults must be one of the declared values (fail-at-save beats
   fail-at-every-run; actionGrammar congruence test added).
2. **⚡ kind renderer was unreachable from /things tiles**: `ThingsViews`
   stripped actions to the bare crystal, whose shape the renderer's `match`
   rejects (no kind/render key → native-tree fallback). Action things now
   pass WHOLE like components; grid/list tiles render the compact ⚡ card
   with op tone dots (verified live).
3. **Cross-action state leak in the inspector**: navigating A→B via an
   `open ⚡` chip kept A's run history, Used-by chips, schema names, and the
   RunPanel's last result until (and unless) B's fetches resolved. Satellite
   state now resets during render the moment the route key changes, and the
   RunPanel is keyed by action id.
4. **Nondeterministic invoke-by-key under duplicate actionKeys**: nothing
   index-enforces per-owner key uniqueness, and the executor's fallback was
   an unsorted `findOne` (Mongo natural order — typically the OLDEST
   revision), while the inspector's fallback used list order — the page could
   display a different program than a key-referenced run executed. Both now
   resolve the LATEST revision (highest `crystal.version`, newest doc as
   tiebreak): the executor sorts, and the shared `selectActionByKey` helper
   (pure, tested) drives both inspector fallbacks. New live battery pair
   creates v1-then-v2 with one key and proves the run returns v2 (a
   natural-order findOne would pick v1).

Also: the `things.ts` reserved-prefix comment no longer describes an
`action-<slug>` seed path that doesn't exist.

Validation: verify-actions.mjs **65/65** (63 + the 2 duplicate-key checks) ·
test:actions **25/25** · test:schemas **82/82** · targeted lint clean ·
build:client clean · /things ⚡ tiles verified in the browser.

## Round 6 — defensive security review + fixes (2026-08-25)

Full report: [SECURITY-REPORTS/2026-08-25-action-thing-v1-security-review.md](../SECURITY-REPORTS/2026-08-25-action-thing-v1-security-review.md).

Six scoped review lenses over the branch, each finding then verified by two
independent skeptics (keep only if both rate ≥8/10). Three findings, all fixed:

1. **Action-created things were public** (HIGH). `things.create` passed no
   `acl`, so `createThing`'s standalone-content default (`ACL_ALL`) applied —
   the demo's own invoices were world-readable, and audience appeared nowhere
   in the consent surface. Actions now mint `acl: [ACL_OWNER]`.
2. **Foreign components fired actions as the viewer** (HIGH in chain).
   `PreviewModal` rendered ANY readable thing through the firing wrapper.
   Ownership is now the trust boundary (`untrusted` computed inside the modal).
3. **Foreign action programs resolved by id** (MEDIUM). The delegated path
   (`source: 'component'`) is now owner-pinned like the actionKey branch;
   the deliberate `/actions` path still resolves readable foreign actions.

Chained, 1–3 were a data-exfiltration path: attacker markup → victim's click →
attacker's program under the victim's session → `search` results copied into a
`create` → minted public → attacker reads it. Two review agents disagreed about
step 3's audience; the one claiming "owner-private" was wrong, and adjudicating
that by hand is what raised this from integrity-only to a confidentiality
breach.

**Deliberately reverted:** a strict child-capability envelope (the below-bar
4th candidate). It broke the canonical composition shape — the parent declares
only `actions.invoke` and children do the work, exactly as `onboard-customer`
does — and no privilege boundary rode on it, since every op runs as the invoker
regardless. The real defect was disclosure, so `actionCannotAccess` now refuses
to assert absolute negatives for a composing action. The run-time
`things.create` / `actions.invoke` gates added during that work were kept.

Validation: verify-actions **73/73** (65 + 8 security regressions) ·
test:actions **27/27** · test:schemas **82/82** · lint clean · build clean.
Live: foreign component renders but is inert, owned one still fires
(draft→sent), onboard-customer's invoice is `["tt:user"]`, stranger and
anonymous reads refused.
