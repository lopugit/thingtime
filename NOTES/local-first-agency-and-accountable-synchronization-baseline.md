# Local-first agency and accountable-synchronization baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-13, Australia/Melbourne

**Plan:** [Local-first agency and accountable-synchronization roadmap](../PLAN/local-first-agency-and-accountable-synchronization-roadmap.md)

**Execution epic:** [TODO 44 — Local-first agency and accountable synchronization](../TODO/claude-todo/44-local-first-agency-and-accountable-synchronization.md)

## Why preserve this note

Thingtime already gives people fast local first paint, one safe-codec persisted
Thingtime tree, same-origin tab propagation, and some deliberately bounded
offline copies. Those are useful foundations. They are not yet a general
local-first promise: feature caches are projections, server acceptance remains
canonical, same-path concurrent tab writes can diverge, browser storage can be
evicted or fill silently, and there is no shared owner-facing contract for
local drafts, pending synchronization, conflicts, device state, or cleanup.

This note freezes that boundary before “works offline” becomes an accidental
claim. It proposes one private synthetic text-draft pilot. A person preserves a
draft, reloads offline, reconnects after a deliberately concurrent canonical
edit, compares both versions, and explicitly commits or discards. It does not
authorize a general mutation queue, service worker, background sync,
collaborative editor, multi-device replication, or production rollout.

“Local-first” is a direction to test, not a current product label. [TODO 7](../TODO/claude-todo/07-cross-tab-thingtime-sync.md)
owns the shipped tab channel. [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md)
owns outage and recovery. [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md)
owns constrained-device budgets and offline expansion. This chain owns the
person-facing distinction between local work, canonical truth, synchronization
intent, conflict, and remedy.

## Evidence ledger

| Claim                                                                  | Current evidence                                                                                                                                                                                                                                                                         | Confidence and refresh trigger                                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Optimistic first paint is a cache tier, not authority.                 | [`localCache.ts`](../remix/app/hooks/localCache.ts) describes `localStorage` as the flash-free tier, returns `null` on read failure, and intentionally swallows disabled-storage and quota errors.                                                                                       | High for the helper; recheck after cache or error-surface changes.                    |
| Entity caches have bounded primitives, but use is opt-in.              | `writeStampedCache()`, `pruneCacheNamespace()`, and `clearLocalCachePrefix()` provide timestamps, oldest-first pruning, and prefix cleanup. Each feature still chooses namespace, scope, bounds, and purge points.                                                                       | High for the primitives; feature coverage needs an inventory.                         |
| The main Thingtime tree has one browser persistence path.              | [`ThingtimeProvider.tsx`](../remix/app/Providers/ThingtimeProvider.tsx) restores LocalForage state and delegates newest-state persistence to [`latestRevisionAutosave.ts`](../remix/app/Providers/latestRevisionAutosave.ts).                                                            | High for repository structure; durability and eviction need live proof.               |
| Same-origin tabs share applied path writes.                            | [`thingtimeSyncChannel.ts`](../remix/app/Providers/thingtimeSyncChannel.ts) uses `BroadcastChannel`, the safe codec, source-tab suppression, and the provider queue. [`TESTING.md`](../TESTING.md) includes two-tab convergence, burst, reload, and undo-isolation checks.               | High for intent; rerun live after provider, codec, or tab-local changes.              |
| The tab channel has explicit convergence limits.                       | Its timestamp is diagnostic only; two near-simultaneous same-path writes can leave tabs holding opposite values. Broadcast is also default, while viewport-only paths depend on call-site `tabLocal` declarations.                                                                       | High because the limitation is code-pinned; do not claim general conflict resolution. |
| Local persistence and server truth are separate.                       | Browser state is a frontend tier; protected Things continue through authenticated API utilities and versioned collections under [`FUNDAMENTALS.md`](../FUNDAMENTALS.md).                                                                                                                 | High; recheck any offline-writer proposal.                                            |
| Existing plans defer general offline writes.                           | [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md) permits bounded reads first and no queue before authority/conflict semantics. [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) separates local-only, queued, committed, failed, and reconciled states. | High for current garden decisions.                                                    |
| Browser storage is quota- and eviction-governed.                       | The WHATWG [Storage Standard](https://storage.spec.whatwg.org/) defines origin buckets, quota estimates, persistence requests, and best-effort versus persistent storage.                                                                                                                | High as platform input; actual browser policy needs fixtures.                         |
| Transactional local storage can be stronger than scattered key writes. | W3C's [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/) defines scoped transactions, atomic commit/abort, ordered requests, and durability hints.                                                                                                                             | High as working-draft input, not a commitment to IndexedDB or a durability guarantee. |
| Local-first ideals do not choose Thingtime's conflict policy.          | Ink & Switch's primary essay [Local-First Software](https://www.inkandswitch.com/essay/local-first/) proposes offline work, multi-device access, longevity, privacy, and user control as ideals.                                                                                         | Useful design evidence, not a standard or proof Thingtime meets them.                 |

## A narrow vocabulary

| Term             | Proposed meaning                                                                | Must not imply                                                    |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Canonical state  | Current version accepted through the authoritative API.                         | Every local surface has received it.                              |
| Local projection | Bounded copy used to render known state quickly.                                | Complete, fresh, durable, or writable.                            |
| Local draft      | Owner-controlled uncommitted work in one approved scope.                        | Server acceptance, sharing, backup, or cross-device availability. |
| Intent           | One proposed mutation plus target and expected version.                         | Permission to replay after authority changes.                     |
| Pending          | Intent preserved locally but not accepted or rejected.                          | In flight or guaranteed automatic retry.                          |
| Committed        | API acceptance confirmed by authoritative reread.                               | Every device or derivative has converged.                         |
| Conflicted       | Expected canonical version changed; both intentions need comparison.            | The platform knows which value is correct.                        |
| Reconciled       | Fresh action selected, combined, or discarded the intent and reread the result. | Every device or history entry is synchronized.                    |
| Device scope     | Browser/profile/app and account/origin boundary holding state.                  | Unique-person or trustworthy-hardware proof.                      |
| Sync receipt     | Bounded target/version, intent, outcome, and cleanup evidence.                  | Immutable audit, delivery, or comprehension proof.                |

## Strengths to preserve

- Cached state paints immediately and refreshes in the background.
- The main browser tree keeps one codec and persistence coordinator.
- Cross-tab writes use the normal queue and suppress echo.
- Tab-local undo and viewport state are deliberately separated.
- Namespace helpers can bound and clear local projections.
- Canonical writes remain behind current auth, ACL, schema, quota, and API
  contracts.

## Gaps that keep local agency implicit

1. There is no inventory classifying every `tt-*` key and local store.
2. Silent optional-cache failures are unsafe for a promised durable draft.
3. Account, origin, namespace, permission generation, and schema are not one
   shared local-envelope contract.
4. Same-path tab races do not converge deterministically.
5. There is no shared expected-version conflict preview for preserved edits.
6. “Offline,” “saved,” “synced,” and “available here” lack one accessible
   vocabulary.
7. Logout, scope switch, revoke, delete, closure, eviction, corruption, and
   quota pressure lack one purge test.
8. There is no local-copy/pending-intent inventory or last-confirmed-sync view.
9. Background retry could replay stale authority or duplicate effects.
10. A local-first claim would outrun complete-journey evidence.

## Threat and failure sketch

| Scenario                            | Required response                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Storage write fails                 | Retain the last known-good draft where possible and never claim saved.        |
| Best-effort storage is evicted      | Explain loss boundaries; keep server truth and verified export distinct.      |
| Another surface changes the Thing   | Stop automatic commit, show both versions, and require fresh choice.          |
| Account or endpoint changes offline | Quarantine the old scope; never render or replay it into the new one.         |
| Access is revoked or target deleted | Reauthorize and fail closed; do not resurrect content.                        |
| Duplicate or reordered reconnect    | Use stable intent and expected version; create no duplicate effect.           |
| Envelope is corrupt or unknown      | Isolate it, offer bounded export/delete, and never execute it.                |
| Queue or retry grows                | Stop at approved item, byte, age, and attempt bounds.                         |
| Status is inaccessible              | Block rollout; color, icon, motion, or connectivity cannot carry truth alone. |

## Smallest honest pilot

Use one approved adult test account, one synthetic private text Thing, one
browser profile, two same-origin tabs, and deterministic network fixtures.
Preserve one draft transactionally, reload offline, reconnect after the second
tab changes the canonical version, show a text comparison, then exercise **keep
server**, **replace with my draft**, and **edit a new draft** as separate fresh
actions. Confirm only through the real API and authoritative reread.

The pilot records synthetic target/version identifiers, state transitions,
bounded timings, and cleanup results. It excludes attachments, sharing,
collaboration, automatic merge, background replay, other devices, real personal
content, public claims, analytics, AI, minors, and sensitive/high-impact work.

## Owner decisions

1. Is “local-first” internal direction or a qualified user-facing promise?
2. Which exact field and size form the first pilot?
3. What persistence, quota, age, attempt, and corruption guarantees are supportable?
4. Which scope dimensions are mandatory in every envelope?
5. Which conflict choices and reauthentication rules apply?
6. What may retry, what needs foreground review, and what is never replayable?
7. How can a person inspect, export, discard, and purge state accessibly?
8. Who can stop the pilot, and what hard-zero failure ends it?
