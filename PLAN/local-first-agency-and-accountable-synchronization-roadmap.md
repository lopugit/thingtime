# Local-first agency and accountable-synchronization roadmap

**Status:** Proposed; owner and qualified review required before engineering

**Grounded:** 2026-09-13, Australia/Melbourne

**Evidence:** [Local-first agency and accountable-synchronization baseline](../NOTES/local-first-agency-and-accountable-synchronization-baseline.md)

**Execution epic:** [TODO 44 — Local-first agency and accountable synchronization](../TODO/claude-todo/44-local-first-agency-and-accountable-synchronization.md)

## Outcome

Prove one private text-edit journey where local work remains useful offline,
every state is truthful, conflicts preserve both intentions, canonical
acceptance is freshly authorized, and cleanup is complete. Widen only after the
same evidence exists for each new data class, device route, and side effect.

## Non-negotiable boundaries

- Canonical state remains the authenticated Thingtime API result.
- Projection, draft, intent, request, accepted response, authoritative reread,
  and device convergence are different facts.
- Every envelope is bounded and partitioned by account, selected origin,
  namespace, target, schema, permission generation, and version.
- Reconnect rechecks auth, ACL, deletion, quota, capability, expected version,
  and confirmation; elapsed time never preserves authority.
- Conflicts preserve both intentions and apply neither silently.
- No background replay, service worker, CRDT, collaboration, general offline
  mode, or user-facing local-first claim is authorized here.

## L0 — Approve the charter

- Approve vocabulary and a user-facing state matrix.
- Choose one synthetic private text field and maximum draft bytes/age.
- Approve browser, network, quota, corruption, and restart fixtures.
- Decide envelope scope, durability, reauthentication, expected-version,
  conflict, retry, discard, purge, export, support, and incident rules.
- Name product, API/data, storage, privacy/security, accessibility/language,
  reliability, support, and incident owners plus backups.
- Set hard-zero thresholds and manual stop authority.

**Gate:** no implementation, migration, participants, or public claim.

## L1 — Inventory and classify local state

- Inventory `localStorage`, LocalForage, IndexedDB, caches, downloads, and
  native state touched by the pilot.
- Classify each item as projection, preference, draft, pending intent, durable
  copy, receipt, or legacy/unknown.
- Record schema, scope, readers/writers, bounds, eviction, migration, purge, and
  accountable owner.
- Identify keys that omit scope or silently swallow a draft-relevant failure.
- Fail CI on an undeclared pilot key or unbounded namespace.

**Gate:** every pilot byte is attributable, bounded, and deletable.

## L2 — Persist one honest local draft

- Define an inert versioned envelope with scope, target, expected canonical
  version, intent ID, timestamps, size, and state.
- Use transactional local storage suitable for approved durability and size;
  do not turn optional cache helpers into a draft promise.
- Surface local-only, durability-unavailable, corrupt, expired, and discarded
  states accessibly and without a loading flash.
- Keep writes idempotent and atomic across crash, interruption, quota failure,
  and migration; retain the last known-good draft.
- Provide inspect, copy/export, and discard with consequence previews.

**Gate:** offline reload and storage failures never produce false “saved” or
silently destroy a known-good draft.

## L3 — Reconnect through fresh authority

- Negotiate the selected origin's capability.
- Reauthenticate and reauthorize target, account, origin, namespace, ACL,
  schema, capability, deletion, closure, quota, and expected version.
- Send one stable intent through the normal API writer; add no privileged sync
  route.
- Distinguish not sent, sending, accepted, reread-confirmed, rejected,
  conflicted, cancelled, expired, and unknown.
- Retry only unambiguously safe transport failures inside approved bounds.
- Purge only after authoritative reread or deliberate discard.

**Gate:** duplicate, reordered, stale, lost-response, revoke, delete, and scope
switches cause no duplication, resurrection, or false commit.

## L4 — Make conflicts and device state legible

- On mismatch, fetch the authorized current projection and show server value,
  local draft, exact versions, and safe field difference.
- Offer **keep server**, **replace with my draft**, and **edit a new draft** as
  freshly authorized actions; never guess a merge.
- Make the current same-path tab race a required fixture.
- Show device/browser scope, last confirmed sync, pending/conflict count,
  footprint, and purge state without fingerprinting hardware.
- Treat other-device state as unknown until authenticated server evidence.
- Pass keyboard, screen-reader, zoom, reduced-motion, narrow-width, locale,
  offline, stale, and failure checks.

**Gate:** no intention is silently overwritten and every state is understandable
without color, icon, connectivity, or logs alone.

## L5 — Run and clean the bounded pilot

- Use one approved adult test account, one synthetic private text Thing, one
  browser profile, two tabs, and deterministic network fixtures.
- Exercise draft, offline reload, concurrent edit, all conflict choices,
  duplicate/lost response, logout, scope switch, revoke/delete, quota,
  corruption, migration, and expiry.
- Verify every canonical outcome through the real API and fresh reread.
- Delete the Thing, drafts, intents, projections, receipts, and fixtures; prove
  no ghost or cross-account key remains.
- Publish bounded redacted evidence and exact limitations.

**Gate:** all criteria pass twice with zero severe authority, privacy, security,
accessibility, data-loss, false-success, or cleanup issue.

## Continuous gates

- Align route, docs, capability, client requirement, expected-version behavior,
  and authoritative reread.
- Test transaction abort, quota, eviction simulation, corruption, migration,
  bounds, expiry, and purge.
- Test same-path races, duplicate/reordered messages, restart, lost response,
  ambiguity, and scope changes.
- Test account, origin, namespace, ACL generation, schema/capability, revoke,
  delete, closure, and restore boundaries.
- Test every state, comparison, action, error, and cleanup accessibly at narrow
  and desktop widths.
- Keep operational evidence content-free and avoid a device graph.

## Measures and stop conditions

Measure draft preservation, state comprehension, conflict detection,
fresh-authority rejection, authoritative confirmation, storage bounds, purge
completion, and accessible task success. Define collection and deletion before
measurement.

Stop for silent draft loss; false saved/committed/synced state; cross-scope
disclosure; replay after revoke/delete/closure; duplicate or resurrected
effects; silent conflict resolution; unbounded state; inaccessible recovery;
missing cleanup; or a broader local-first/offline claim than the evidence.

## Expansion gates

Approve separately: additional scalar fields; bounded multi-field drafts;
another browser or native route; reversible offline queues; attachments and
large copies; then collaborative or automatic merge. Sharing, public content,
external systems, money, safety actions, AI, minors, institutions, and
sensitive/high-impact work require new threat models and qualified review.

## First owner decision packet

Approve or revise vocabulary and claim boundary; pilot field and bounds;
envelope scope/durability/migration/purge; expected-version/conflict/retry rules;
accessible inspection and cleanup; and owners, evidence, thresholds, and stop
authority.
