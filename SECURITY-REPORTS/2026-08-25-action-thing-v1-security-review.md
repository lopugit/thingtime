# Security review — Action Thing v1 (PR #387)

- **Date:** 2026-08-25
- **Scope:** the Action Thing v1 branch (`claude/action-thing-permissions-336bc0`), 41 files / ~5.5k added lines — the action grammar, the executor, the run/runs API, the ttAction render + click path, and the surrounding branch changes.
- **Method:** six scoped finder lenses (executor authorization, save-time grammar, HTTP surface, client render/click, data exposure, perimeter) → 9 raw findings → 5 after dedupe → each verified by two independent skeptics whose default answer was "not reportable", keeping only findings both rated ≥8/10. 78 further candidates were checked and rejected.
- **Outcome:** 3 findings reported, **all fixed on-branch and verified live**. One agent-vs-agent contradiction was resolved by hand and materially raised the severity (below).

---

## The chain (why this mattered)

The three findings composed into a data-exfiltration path. Each link was verified by reading the code, not inferred:

1. An attacker publishes a public `action` whose steps are an unscoped `things.search` followed by `things.create` with `values: { loot: "$step.1" }`.
2. They publish a public `component` whose render root carries `ttAction: "<that action id>"` — neither key is stripped at save time (`sanitizeSchemaRender` only caps size/depth and bans `$`-keys).
3. A signed-in victim opens `/things?preview=<component id>` and clicks once. The preview modal rendered **any** readable thing through the action-firing wrapper.
4. `resolveActionProgram` resolved the reference by id through a plain ACL read — no ownership check — so the **attacker's** program ran under the **victim's** session.
5. `things.search` returned the victim's own Data Things with full crystals into step scope.
6. `resolveValue` substitutes a bare `$step.N` whole-value, so the entire result array landed in the new thing's crystal.
7. `things.create` minted that thing with the **public** default audience — so the victim's private data became world-readable.

The design's core invariant — *capabilities only narrow; an action can never do what its invoker couldn't* — held throughout. The breach was that **the invoker's authority was lent to a program they never consented to**, and the public-by-default audience turned a read the invoker was entitled to into a world-readable artifact.

### A correction worth recording

Two review agents contradicted each other on step 7: one asserted minted docs were "owner-private", another that they defaulted to `tt:all`. The first was **wrong**. `execute.ts` passed no `acl`, `resolveInputAcl` therefore returned `null`, and `createThing` fell through its audience ladder to `acl = inputAcl || [ACL_ALL]`. That single fact is the difference between an integrity nuisance and a confidentiality breach — a reminder that multi-agent findings need adjudication, not aggregation.

---

## Finding 1 — Action-created things were minted world-readable

- **Severity:** HIGH · `sensitive_data_exposure` · `remix/app/api/utils/actions/execute.ts`

The executor's `things.create` handler passed no `acl`/`visibility`, so `createThing` applied its standalone-content default of `ACL_ALL` (`tt:all`). Every thing any action created was public. This fired with **no attacker present**: the shipped demo's `create-customer` / `generate-invoice` minted world-readable customer and invoice records, and the consent surface never mentioned audience — the grammar had no field for it, so an author could not even opt out.

**Fix.** Actions now mint `acl: [ACL_OWNER]`. The rationale is the invariant itself: "capabilities only narrow" means a run must never produce a *wider* audience than the invoker asked for, and a step that copies a read into a new thing would otherwise republish it. An explicit audience becomes a v2 grammar question — declared, and derived as an effect — never an implicit default.

## Finding 2 — Foreign-authored components fired actions as the viewer

- **Severity:** HIGH (in chain; MEDIUM alone) · `unintended_action_execution` · `remix/app/components/Things/ThingsDialogs.tsx`

`PreviewModal` rendered component things via `<RenderThing context={{ size: 'full' }}>` with no `untrusted` flag, so the firing `onClickCapture` wrapper was attached. The thing was never ownership-checked — the `?preview=<id>` deep link resolves any readable id, including another user's public component — and the click ran immediately, with no confirmation and without naming the action or its effects.

**Fix.** Ownership is now the trust boundary on that surface: `untrusted = !!thing && (!viewer?.id || thing.author?.id !== viewer.id)`. A foreign component renders normally but **inert**, matching the feed/search surfaces. The check lives inside the modal rather than at the call site so a future caller cannot forget it.

## Finding 3 — Action references resolved foreign programs by id

- **Severity:** MEDIUM · `confused_deputy` · `remix/app/api/utils/actions/execute.ts`

`resolveActionProgram` tried the reference as a thing id first, through a plain ACL read, so any action the viewer could merely *read* became a runnable program executing with their credentials. The `actionKey` branch directly beneath it was deliberately owner-scoped, with a comment explaining that a key reference must not be hijacked — the id path granted exactly that hijack.

**Fix.** Resolution now has two modes. The **deliberate** path (`/actions` inspector, where the user has read the derived effects and pressed Run) still resolves a readable foreign action by id. The **delegated** path — a ttAction click inside rendered markup, flagged `source: 'component'` by our own client — is owner-pinned like the key branch. The flag only ever *narrows*, so honouring a client-supplied value is safe: the victim's browser always sends it, and a caller who omits it is acting as themselves. The mode rides the per-invocation budget so it applies to the whole invocation tree.

---

## Considered and deliberately not shipped: strict capability envelopes

A fourth candidate (scored 7/10, below the reporting bar) observed that an invoked child action runs on its **own** declaration rather than the intersection with its parent's. A strict envelope was implemented, then **reverted** after it broke three composition checks: the canonical composed action declares only `actions.invoke: [child]` and lets children do the creating — the shape the flagship `onboard-customer` demo uses. Intersecting would have required every parent to re-declare the union of its children's capabilities.

That trade is justified because no privilege boundary rides on it: every op executes as the invoker under the ordinary ACL either way. The real defect was **disclosure**, and it was fixed where it belongs — `actionCannotAccess` no longer asserts absolute negatives ("Cannot create things") for an action that invokes another action whose code the page never read. It now discloses the composition instead, and the invoked children remain one click away in the Does list. Only the three vocabulary-level negatives (no network, no secrets, no deletes) are claimed unconditionally, because those hold for every program by construction.

Two run-time gates added during that work were **kept** as defence-in-depth: `things.create` and `actions.invoke` are now re-checked against the running program's declaration at execution time, not only at save time.

---

## Verified clean (selected negative space, 78 candidates rejected)

The security-critical core held up under direct scrutiny:

- **Run records** stamp `ownerId: viewer.id` (the **invoker**, not the action's author), and `listActionRuns` filters on `ownerId: viewer.id`. A foreign invoker's data never becomes readable by the action's author, and the `action` parameter cannot be used for IDOR.
- **No NoSQL injection**: `action` is type-guarded at `runAction`, and `validateRunInputs` coerces every input by its declared type.
- **Ref resolution** guards each hop with `hasOwnProperty` and bans `__proto__`/`constructor`/`prototype` segments.
- **`things.update`** cannot reach root fields (`ownerId`/`acl`/`shareId`/`thingtime`/`secure`) and resolves its target as `{ shareId, ownerId: viewer.id }`, so cross-user writes are impossible.
- **Run-record forgery** is blocked: `action-run` is a PROTECTED kind with no crystal sanitizer, and the reserved `action-` shareId prefix is refused on create and update.
- **Steps** are rebuilt field-by-field from an allowlist, and the same sanitizer re-runs at invocation.
- **The kind boundary** (`isDataThing`) holds on get, update, and child frames.
- **Recursion** is refused via the invocation stack with a `finally` pop.

---

## Verification

- `verify-actions.mjs` **73/73** (grew from 65 — eight new security regressions).
- `test:actions` **27/27** · `test:schemas` **82/82** · targeted lint clean · `build:client` clean.
- **Live, end to end:**
  - `onboard-customer` run through its real composition path produced an invoice with `acl: ["tt:user"]` — Finding 1 fixed at the point it actually bit.
  - A second user cannot read an action-created thing; neither can an anonymous reader.
  - A **foreign** component rendered in the preview modal keeps its `data-tt-action` attribute in the DOM but is **inert** — clicking left the target invoice `draft`.
  - An **owned** component still fires: `draft → sent` with `sentAt` — no regression to the 🧩 → ⚡ → 📦 flow.
  - A component-sourced run of a foreign action id is refused 404; the deliberate inspector path still runs it.

## Follow-ups (not blocking)

1. An explicit, declared **audience** field in the step grammar, surfaced as a derived effect, so an action can create public things intentionally rather than never.
2. A confirmation step naming the action and its derived effects before any delegated run — defence in depth behind the ownership boundary.
3. Transitive effect derivation through `actions.invoke` edges, so a composing action can display its children's effects inline rather than one click away.
