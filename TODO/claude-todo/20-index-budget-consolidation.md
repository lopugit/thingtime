# 20 — Index budget: reconcile the `things` indexes under MongoDB's 64 cap

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
| **49** | indexes on `things` defined by current `develop` code (+ `_id_` = 50) |
| **~14** | slots of headroom before the 64 cap |
| 63 | what a long-lived local dev database showed — **inflated, see below** |

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
# what the code defines (named ones)
grep -oE "name: '[a-z_0-9]+'" remix/app/api/utils/mongodb/collections.ts | sort -u
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

### 3a. Dead legacy indexes — strongest lead (~5 slots)

`kind` and `visibility` are the pre-`thingtime`/`acl` field names. They appear
in `collections.ts` **only inside index definitions** — no reader, no writer
anywhere in the app — and locally **0 of 6,831** things carry either field:

| Index | Key |
| - | - |
| `kind_1_visibility_1_createdAt_-1_shareId_1` | both fields dead |
| `kind_1_ownerId_1_createdAt_-1_shareId_1` | |
| `kind_1_createdAt_-1_shareId_1` | |
| `kind_1_parentId_1_createdAt_1` | |
| `parentId_1_ownerId_1_token_1` | `partialFilterExpression: { kind: 'reaction' }` → matches nothing; superseded by `things_reaction_unique` |

**Before dropping:** count these fields in *production* (older user data may
predate the migration that removed them) and confirm no query planner still
picks them:

```js
db.things_v2.countDocuments({ kind: { $exists: true } })
db.things_v2.countDocuments({ visibility: { $exists: true } })
```

If production also reports 0, these five are pure overhead: they cost write
amplification on every insert while serving no read.

### 3b. Prefix redundancy — one candidate, probably intentional

`notification_unread { thingtime, ownerId }` is a strict prefix of
`thingtime_1_ownerId_1_createdAt_-1_shareId_1`, so the planner *could* use the
longer one. It is **partial**, though, which is likely the point (a tiny index
for unread counts beats scanning the full compound). Decide deliberately and
record the reasoning either way.

### 3c. Families worth a design pass

Grouped by leading field, the consolidation surface is:

- **`thingtime` × 8** — the biggest family. `thingtime` is multikey, which
  constrains what can be compounded onto it; a review should ask which of the
  8 earn their keep against real query shapes.
- **`kind` × 4** — see 3a, likely all dead.
- **`crystal.quotaKind` × 4** — subscription/quota plane; probably consolidatable
  now that the shapes have settled.
- **`targetId` × 3**, **`ownerId` × 3**, **`appId` × 2**.

## 4. Plan

1. **Measure production** — index count + the `kind`/`visibility` census above.
   Record the real headroom.
2. **Drop the dead five** (3a) behind the usual boot-time ensure, using
   `dropIndexRetrying` (idempotent, absent = fine) rather than a migration.
3. **Explain-plan the `thingtime` and `quotaKind` families** against the actual
   hot queries (feed, profile, comments, admin lists) and merge what the
   planner proves redundant.
4. **Add a budget guard**: a unit test asserting the code-defined index count
   for `things` stays under an agreed ceiling (say 56), so the next feature
   that adds one has to think about it, and the cap can never be hit silently
   in production.
5. Consider a `graphify`-style note in `FUNDAMENTALS.md` §3 so the rule
   ("`things` has an index budget; adding one is a decision") is discoverable.

## 5. Definition of done

- [ ] Production index count for `things` recorded, with headroom stated.
- [ ] Dead legacy indexes dropped (or documented as still needed, with why).
- [ ] Remaining families reviewed against explain plans; redundant ones merged.
- [ ] A test fails when the `things` index count crosses the agreed ceiling.
- [ ] `TESTING.md` gains a line for re-running the audit after index changes.
- [ ] Local-vs-production measurement caveat captured here stays accurate.
