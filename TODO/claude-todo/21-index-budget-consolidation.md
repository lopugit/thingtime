# 21 — Index budget: reconcile the `things` indexes under MongoDB's 64 cap

MongoDB allows **64 indexes per collection**, hard. `things` (physically
`things_v2`) carries by far the most of any Thingtime collection and gains a
few with most features, so the budget needs a deliberate review before it
becomes an incident.

Filed after PR #401/#402, where a local `ensureIndexes` run hit the cap and
took registration down with it — see "The failure mode" below. Nothing here is
urgent; production has headroom. This is the plan for spending it wisely.

## 1. Where we actually stand (measured 2026-08-25)

| Count | What |
| - | - |
| **48** | indexes on `things` defined by current `develop` code (+ `_id_` = 49) |
| **15** | slots of headroom before the 64 cap |
| 63 | what a long-lived local dev database showed — **inflated, see below** |

Breakdown of the 48: **47** from `createThingsDataIndexes()` (the shared
data-plane set, which also lands on user-supplied custom Mongo endpoints) plus
**1** home-only TTL, `migration_diagnostic_expires_at`, created beside the
spread in `ensureIndexes()`. Counted by driving `createThingsDataIndexes()`
with a stub collection and de-duplicating the names it asks for — that also
captures the indexes created indirectly through `createIndexReplacing()`, which
a `grep` for `name:` misses.

**A dev machine is not a fair reading.** Every worktree runs its own branch's
`ensureIndexes` against the *same* local `thingtime` mongod, so a laptop
accumulates the union of every branch ever run — 13 of the 63 local indexes
(`things_device_*`, `things_external_*`, `things_ai_connection_key_unique`)
exist in **no** current code. Sibling worktrees also **resurrect** an index a
newer branch retired, at their next boot. Always measure the budget from the
code, or from production, never from a dev database.

Audit recipe:

```sh
# what the DB has
mongosh "<uri>" --eval 'db.things_v2.getIndexes().forEach(i => print(i.name))'
# what the code defines (named ones) — undercounts: misses every auto-named
# index and everything created through createIndexReplacing()
grep -oE "name: '[a-z_0-9]+'" remix/app/api/utils/mongodb/collections.ts | sort -u
```

For the authoritative code-side number, drive the builder with a stub instead
of grepping — it reports exactly what the code asks Mongo for. Note that
`createThingsDataIndexes` is module-private on `develop`, so this recipe needs
a temporary `export` (or a scratch copy of the function) to run:

```js
// node --import tsx, from remix/
const created = [];
const stub = { createIndex: async (keys, o = {}) => created.push(o.name ||
  Object.entries(keys).map(([f, d]) => `${f}_${d}`).join('_')),
  dropIndex: async () => {}, updateMany: async () => ({ modifiedCount: 0 }) };
await Promise.all(createThingsDataIndexes({ collection: () => stub }));
new Set(created).size; // 47 on develop; +1 home-only TTL, +1 _id_ = 49
```

Anything named `things_*` in the DB but absent from the code is residue.

## 2. The failure mode (why the cap is worth respecting)

`ensureIndexes` builds the whole battery in one `Promise.all`. If **any**
`createIndex` fails, the rejection fails the whole ensure — and `registerUser`
awaits it before its constrained writes, so:

> a single bad index ⇒ **registration and login return 500**.

Two ways to trip it, both observed:

- **Cap exhausted** — `add index fails, too many indexes for thingtime.things_v2`.
- **A duplicate on a unique index** — `E11000 … index: things_<x>_unique`.
  This is why kind-blind unique indexes over user-writable `crystal` paths were
  retired (PRs #320/#325/#326, #401/#402): any user could plant the duplicate.

Note also that `createIndexReplacing` is create-then-drop, so an index **swap
needs a free slot**. At the cap, swaps fail too (error code 67, which is not
the 85/86 that helper retries) — so the cap must never be reached, not merely
not exceeded.

## 3. Reclamation candidates

### 3a. Legacy-era indexes — best lead, but blocked on the v1 read path (~5 slots)

`kind` and `visibility` are the pre-`thingtime`/`acl` field names. **They are
not dead.** No current code *writes* them (the v2 migration unsets `kind`), but
`kind` still has live *readers*: an explicit v1/v2 era-compatibility layer that
`$or`s the old field alongside `thingtime` so posts written before the
migration keep showing up.

| Reader | Query fragment |
| - | - |
| `things/things.ts` `postMatch()` | `{ $or: [{ thingtime: 'post' }, { kind: 'post' }], thingtime: { $ne: 'comment' } }` |
| `things/things.ts` `postThingMatch()` | `{ $or: [{ thingtime: 'post' }, { kind: 'post' }] }` |
| `things/things.ts` `thingtimeInClause()` | adds `{ kind: 'post' }` whenever `'post'` is in the filter |
| `things/search.ts` | `$match: { parentId: { $in: ids }, kind: { $in: ['comment', 'reaction'] } }` |
| `things/views.ts` | projects `visibility` and `kind` |

`postMatch()` alone has seven call sites in `things.ts` — the feed, profile
lists, the public post count, and the share-original lookups. `visibility` is
also still accepted as *input*: `schemas/registry.ts` `aclFromVisibility()`
maps the legacy names onto acls, and `hooks/useApi.tsx` still sends the field.

| Index | Status |
| - | - |
| `kind_1_createdAt_-1_shareId_1` | backs the `{ kind: 'post' }` branch of `postMatch()` |
| `kind_1_ownerId_1_createdAt_-1_shareId_1` | backs the owner-scoped profile variants |
| `kind_1_parentId_1_createdAt_1` | backs the `search.ts` comment/reaction rollup |
| `kind_1_visibility_1_createdAt_-1_shareId_1` | plausibly superseded by the `acl_1_*` index — verify |
| `parentId_1_ownerId_1_token_1` | `partialFilterExpression: { kind: 'reaction' }` → nothing writes `kind` any more, but it is still the only unique guard over *existing* legacy reaction docs. The v2 invariant moved to `things_reaction_unique`, which is a different key shape (`{ targetId, ownerId, crystal.emoji }`) and cannot see a legacy `{ parentId, token }` doc |

**Why a zero count in production is not sufficient to drop them.** For an
`$or`, MongoDB uses an index-union plan *only when every branch is indexed*; if
one branch has no usable index the whole query degrades to a `COLLSCAN` over
`things_v2`. So dropping `kind_1_createdAt_-1_shareId_1` while `postMatch()`
still names `kind` would collection-scan the feed and every profile list —
**even if zero documents carry `kind`**, because the planner cannot know that.

Correct order of operations:

1. Count the fields in *production*:

   ```js
   db.things_v2.countDocuments({ kind: { $exists: true } })
   db.things_v2.countDocuments({ visibility: { $exists: true } })
   ```

2. Only if production is also 0 (and stays 0 after any pending backfill),
   **retire the era-compat read path first** — drop the `{ kind: … }` branches
   from `postMatch()`, `postThingMatch()`, `thingtimeInClause()`, and the
   `search.ts` rollup, keeping the `things.ts` era comment as the record of why
   they existed.
3. **Then** drop the four `kind_*` indexes, and confirm with `explain()` that
   the feed/profile/search plans still use `thingtime_1_*` / `acl_1_*`.

`parentId_1_ownerId_1_token_1` is the one entry with no *reader* to retire
first — no query uses its shape — so it comes out without touching the
era-compat read path above. It is not unconditionally safe, though: it is
write-dead, not data-dead. `collections.ts` says so at the definition site
("Legacy relational era … aggregation + dedup indexes stay until the things
migration converts those docs"), and `things_reaction_unique` does **not**
inherit the constraint: that index is `{ targetId, ownerId, crystal.emoji }`
and never matches a legacy `{ parentId, token }` document. Dropping it early
therefore removes the last uniqueness guard on any surviving `kind: 'reaction'`
doc. It still needs the step-1 census — just not steps 2–3.

### 3b. Prefix redundancy — one candidate, probably intentional

`notification_unread { thingtime, ownerId }` is a strict prefix of
`thingtime_1_ownerId_1_createdAt_-1_shareId_1`, so the planner *could* use the
longer one. It is **partial**, though, which is likely the point (a tiny index
for unread counts beats scanning the full compound). Decide deliberately and
record the reasoning either way.

### 3c. Families worth a design pass

Grouped by leading field, the consolidation surface is:

- **`thingtime` × 7** — the biggest family. `thingtime` is multikey, which
  constrains what can be compounded onto it; a review should ask which of the
  7 earn their keep against real query shapes.
- **`kind` × 4** — see 3a; write-dead but still read through the v1 era-compat
  `$or`, so they come out only after that read path does.
- **`crystal.quotaKind` × 4** — subscription/quota plane; probably consolidatable
  now that the shapes have settled.
- **`targetId` × 3**, **`ownerId` × 3**, **`appId` × 2**.

## 4. Plan

1. **Measure production** — index count + the `kind`/`visibility` census above,
   including `db.things_v2.countDocuments({ kind: 'reaction' })`, which step 2
   depends on. Record the real headroom.
2. **Retire `parentId_1_ownerId_1_token_1`** as soon as that census shows no
   surviving `kind: 'reaction'` documents. It needs no read-path change, so it
   lands well before steps 3–4 — using `dropIndexRetrying` (idempotent,
   absent = fine) behind the usual boot-time ensure rather than a migration.
3. **Retire the v1 era-compat read path**, then drop the four `kind_*` indexes
   (3a, steps 2–3). Order matters: indexes last, or the feed collection-scans.
4. **Explain-plan the `thingtime` and `quotaKind` families** against the actual
   hot queries (feed, profile, comments, admin lists) and merge what the
   planner proves redundant.
5. **Add a budget guard**: a unit test asserting the code-defined index count
   for `things` stays under an agreed ceiling (say 56), so the next feature
   that adds one has to think about it, and the cap can never be hit silently
   in production. **Partly done elsewhere:** the
   `codex/thingtime-mcp-desktop-connectors` lineage (PR #68, and #373 stacked
   on it) already carries `remix/app/api/utils/mongodb/indexBudget.test.ts`,
   which drives `createThingsDataIndexes()` with a stub and asserts four free
   slots below 64 plus "no retired name is re-created". Adopt that file rather
   than writing a second guard, and reconcile the ceiling (it currently
   encodes headroom-of-4, not a fixed 56). It does not port standalone: it
   imports `createThingsDataIndexes`, `RETIRED_THINGS_INDEXES`, and
   `pruneRetiredHomeThingsIndexes` from `collections.ts`, and `develop` exports
   none of those three — the retired-index registry and its home-layout pruner
   are part of the same #68 change. Either take that pair with the test, or
   port only the headroom assertion behind a new `createThingsDataIndexes`
   export.
6. Consider a `graphify`-style note in `FUNDAMENTALS.md` §3 so the rule
   ("`things` has an index budget; adding one is a decision") is discoverable.

## 5. Definition of done

- [ ] Production index count for `things` recorded, with headroom stated.
- [ ] `kind`/`visibility` census run in production and recorded here.
- [ ] v1 era-compat `$or` branches retired (or documented as still needed).
- [ ] Legacy indexes dropped **after** their readers, with `explain()` evidence
      that no feed/profile/search plan regressed to a `COLLSCAN`.
- [ ] Remaining families reviewed against explain plans; redundant ones merged.
- [ ] A test fails when the `things` index count crosses the agreed ceiling.
- [ ] `TESTING.md` gains a line for re-running the audit after index changes.
- [ ] Local-vs-production measurement caveat captured here stays accurate.
