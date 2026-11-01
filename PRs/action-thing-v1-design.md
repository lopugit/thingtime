# Action Thing v1 — design (declarative, capability-bounded)

Data Thing + Component Thing + Action Thing = program.

An Action is a first-class `action` kind thing: a small declarative program
over a **closed, registered operation vocabulary**, with **author-declared
capabilities**, a **shared execution budget**, and **inspectable run records**.
No arbitrary persisted JavaScript — there is no `while` primitive because the
vocabulary deliberately does not define one.

## Non-negotiable invariants

1. **Capabilities only narrow, never widen.** The executor runs every
   operation through the existing things utils *as the invoking user*, so
   ACL, quota, schema validation and storage machinery all still apply.
   Declared capabilities are an *additional* filter on top. An Action can
   never do something its invoker couldn't do by hand; it can (and usually
   does) do much less.
2. **Closed vocabulary.** Unknown ops are rejected at save time AND at run
   time. v1 ops: `things.create`, `things.get`, `things.search`,
   `things.update`, `actions.invoke`, `return`.
3. **Declared and true.** At save time, every step must be covered by a
   declared capability (a `things.create` step on schema `customer` requires
   the `things.create` capability scoped to include `customer`), otherwise
   the save fails. The inspector *derives* reads/writes from the steps, so
   the displayed meaning cannot drift from the program.
4. **Shared budget.** One invocation envelope per root run: deadline,
   operation budget, depth, child-action count, result bytes. Child Actions
   invoked via `actions.invoke` consume the *parent's* budget — `A → B → A`
   terminates by construction (no perpetual motion at AWS's expense).
5. **Actions mint private.** A created thing gets the owner-only audience, never
   the public standalone default: "capabilities only narrow" governs the
   AUDIENCE of what a run produces as much as the operations it performs, so a
   step that copies a read into a new thing can never republish it. An explicit
   audience is a v2 grammar question (declared, and derived as an effect).
6. **No network, no secrets, no runtime access in v1.** There is no op that
   can reach `fetch`, env vars, or MongoDB directly. External integrations
   arrive later as Connection-owned capabilities (`mailgun.send-email`
   style), keeping credentials on the Connection, never in the Action.
7. **Data-ops touch Data Things only.** All four data-ops share one kind
   boundary: `things.create` mints `thingtime: ['data']`, `things.search`
   filters `thingtime: 'data'`, and `things.get`/`things.update` require the
   resolved target to be a data thing (`isDataThing`). A capability scope
   constrains *by schema*, and non-data kinds (`action`, `schema`, `post`,
   `component`, `folder`) carry no schema, so the schema check alone can't
   hold this line — the kind guard does. An Action therefore operates on Data
   Things and never on the program's own definition or other kinds, so
   editing an Action stays an explicit `/things` action, never a side effect
   of running one.

## The `action` crystal grammar (schemas/registry.ts)

```
name          string (required)
description   text
actionKey     slug (resolved owner-scoped at invoke time — first match;
              per-owner uniqueness is not yet index-enforced. The action-
              shareId prefix is reserved in sanitizeShareId like component-:
              user creates refuse it, and the executor mints run-record ids
              as action-run-<uuid>)
version       int
forkOf        optional source reference
inputs        ≤16 typed descriptors: { name, type: string|text|number|boolean|enum,
              required?, default?, values? (enum) } — same bounded-descriptor
              posture as component args
steps         1..20 ordered ops (closed vocabulary, see below)
capabilities  declared list (see below)
limits        { timeoutMs ≤10000, maxOperations ≤50, maxDepth ≤8,
              maxResultBytes ≤256KB, maxChildActions ≤20,
              maxInputBytes ≤64KB } — author may lower, server caps are
              the ceiling
```

### Steps

```
{ op: 'things.create', schema: 'customer', values: { name: '$input.name', ... } }
{ op: 'things.get',    id: '$input.invoiceId' }
{ op: 'things.search', schema: 'invoice', limit: ≤50 }   // no filter grammar in v1
{ op: 'things.update', id: '$step.1.id', values: { status: 'sent', sentAt: '$now' } }
{ op: 'actions.invoke', action: '<actionKey|id>', inputs: {...} }
{ op: 'return',        value: '$step.1' }
```

Value templating is **reference substitution, not evaluation**: a string that
is exactly `$input.<key>`, `$step.<n>` or `$step.<n>.<path>` is replaced
whole-value (type-preserving); `$now` yields an ISO timestamp; everything
else is literal data. String composition uses `{ ttConcat: [ ... ] }` (tt-
prefixed like the component DSL, because `$`-prefixed *keys* are banned by
the crystal sanitizer — refs are string *values*, which is allowed). Path
resolution forbids `__proto__`/`constructor`/`prototype` segments and only
roots at `$input`/`$step`.

### Capabilities

```
{ capability: 'things.read',   schemas: ['customer', 'invoice'] }
{ capability: 'things.create', schemas: ['customer'] }
{ capability: 'things.update', schemas: ['invoice'] }
{ capability: 'actions.invoke', actions: ['send-welcome-email'] }   // optional allowlist
```

Omitted scope = all schemas *the invoker can already reach* (still narrowed
by ACL); the UI nudges toward explicit scopes. `things.delete` is deferred
out of v1 entirely — the vocabulary simply doesn't have it yet.

## Execution (api/utils/actions/execute.ts)

- `POST /api/v1/actions/run { action, inputs }`, auth `getCurrentUser`.
- Validate inputs against descriptors; enforce `maxInputBytes`.
- Build the budget: `{ deadline, opsRemaining, depthRemaining, childActionsRemaining }`.
- Execute steps sequentially; each op (a) checks the budget, (b) checks the
  declared capability covers the concrete target (defense-in-depth on top of
  the save-time check), (c) delegates to the existing things utils with the
  invoker's identity, (d) records a trace entry `{ step, op, target, ms }`.
- `actions.invoke` loads the child action thing (ACL applies — you can only
  invoke actions you can read), pushes onto an invocation stack (fast cycle
  diagnostics), decrements depth + childActions, and recurses with the SAME
  budget object.
- Always write an `action-run` child thing (targetId = action id): status,
  timings, ops/depth used, size-capped inputs echo, size-capped result,
  error, trace. Run records are executor-written only — the kind is blocked
  from direct create/update via the generic things routes (moderation-stamp
  posture) but readable by their owner.
- Rate limit: `actions.run` entry in rateLimit config (fail-closed family).

## API family (all three registration places, themes-family conventions)

- `POST /api/v1/actions/run` — execute (auth; rate-limited).
- `/actions` browse rides the unified things path (`things.list` on the
  `action` kind) — no dedicated browse endpoint in v1; a decorated
  `GET /api/v1/actions/browse` (lastRun summary, runCount) is future work.
- `GET  /api/v1/actions/runs?action=<id>` — run history (batch child
  aggregation, one query, never N+1).
- Actions are created/edited through the unified `POST /api/v1/things`
  (registry-validated like components); optional admin seed for the demo app.

## UI

- `/actions` browse (drawer top-level ⚡) + `/actions/:key` detail — the
  **inspector**: Inputs, derived Reads/Writes/Creates (clickable), declared
  capabilities, a "Cannot access" line (derived complement: no network, no
  secrets, kinds outside scope), the limits envelope, the numbered step list,
  a Run panel (typed input form → result + per-step trace + budget used),
  and run history.
- `/things`: kind renderer for `action` (capability/effect badges).
  `action-run` needs no /things renderer — the kind is protected and
  excluded from generic reads; runs render in the inspector's Last runs
  panel via its own read model.
- Component glue for the working-app proof: a component render node may
  declare `ttAction: '<actionKey>'` on a button; the renderer wires it to the
  run endpoint (viewer-invoked, same bounded machinery). This is the
  Data + Component + Action closure: an Invoice Card's Send button IS a
  bounded Action invocation.

## Demo proof (seeded via the real API only)

Customer/Invoice mini-app: `customer` + `invoice` schema things; Customer
Card + Invoice Card component things (Send button bound via `ttAction`);
`create-customer`, `generate-invoice`, `send-invoice` action things
(send-invoice: reads invoice, updates `status`/`sentAt` — honest about v1
having no email capability yet). Intent → Data + Component + Action →
inspect/edit in /things → click Send in the rendered component → watch the
run record land.

## Security map (each gets a test)

| Concern | Defense |
| --- | --- |
| Privilege escalation | executor delegates to things utils under the invoker's identity; capabilities only narrow |
| Undeclared effects | save-time capability-coverage check + run-time re-check per op |
| Perpetual recursion (A→B→A) | shared budget + depth cap + child-action cap + invocation stack |
| Prototype pollution via refs | rooted path grammar, forbidden segments, hasOwnProperty-gated path resolution |
| Injection via values | refs are whole-value substitution; created/updated crystals pass validateThingtimeCrystal for the bounded `data` kind (schema/schemaId are provenance stamps — field-level schema gating is future work) |
| Resource exhaustion | deadline, op budget, input/result byte caps, steps ≤20, trace capped, rate limit on run |
| Secret/network reach | no op exists that touches fetch/env/Mongo; vocabulary is closed both at save and run |
| Audience widening (created things) | actions mint `acl: [ACL_OWNER]`; createThing's public standalone default must never apply to something a program mints on the invoker's behalf |
| Delegated authority (a ttAction click) | `source: 'component'` resolves ONLY actions the invoker owns (owner-pinned id lookup, like the actionKey branch); the flag only narrows, and rides the per-invocation budget so the whole tree inherits it |
| Foreign markup on a trusted surface | ownership is the trust boundary: /things PreviewModal passes `untrusted` for any thing the viewer does not own, so a foreign component renders inert |
| Consent surface over-claiming | an action that invokes children never asserts absolute negatives ("Cannot create things") about code its page never read; only the vocabulary-level negatives are unconditional |
| Run-record forgery | action-run blocked from direct generic-route writes |
| Foreign action invocation | actions.invoke goes through ACL read check + optional allowlist |
| Cross-kind reach (data-op → non-data thing) | all four data-ops pin the `data` kind; get/update require `isDataThing(target)` so an unscoped read/update can't resolve to an action/schema/post/component/folder |

## Future (explicitly out of v1)

Connections as capability providers (`integration: mailgun.send-email`,
scoped external mutations/invocation), `forEach`/`if`/`parallel`/`retry`
primitives (each with explicit limits), non-declarative executors (JS
sandbox / WASM / remote) behind the same Action interface, field-level write
scopes, approval gates ("invoices over $10k require approval").
