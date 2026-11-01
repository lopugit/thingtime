# Personalization agency and accountable-memory roadmap

Status: Proposed

Evidence: [personalization agency and accountable-memory baseline](../NOTES/personalization-agency-and-accountable-memory-baseline.md)

Execution epic: [TODO 49](../TODO/claude-todo/49-personalization-agency-and-accountable-memory.md)

## Outcome

People can see what Thingtime remembers about them, distinguish choices from
observations and inferences, understand each memory's source and effect, and
correct, exclude, expire, forget, or reset it without losing unrelated content
or being forced into an unusable experience.

## Principles

- Prefer explicit choices over inferred proxies.
- Retain the minimum item for a named purpose and bounded lifetime.
- Keep choice, observation, derivative, and historical event distinct.
- Make every effect explainable from current, versioned inputs.
- Treat correction, exclusion, forgetting, and reset as different operations.
- Propagate lifecycle changes to declared derivatives and caches.
- Provide a useful non-personalized baseline.
- Treat sensitive traits, minors, institutions, and high-impact uses as new,
  separately reviewed scopes.

## Phase 0 — assign authority and freeze expansion

Qualified product, privacy, accessibility, safety, security, data, and affected
domain owners approve the vocabulary, pilot boundary, evidence standard,
exception process, and stop authority. Inventory existing personalization-like
state without creating new collection, inference, or telemetry.

Gate: every discovered item has an accountable owner or is disabled from the
pilot; unresolved sensitive or high-impact use stops the work.

## Phase 1 — define the contract and inventory

Create a versioned memory record covering identifier, kind, source, purpose,
scope, stores, age, expiry, policy, inputs, derivatives, effects, controls,
exceptions, and cleanup state. Define exact semantics for:

- correction without falsifying history;
- purpose-specific exclusion;
- expiry and delayed cleanup;
- forgetting and derivative invalidation;
- domain and global reset;
- non-personalized baseline; and
- import quarantine and account/device boundaries.

Gate: a reviewer can classify every pilot item and predict the result of every
control before implementation begins.

## Phase 2 — build an inspect-and-explain slice

In one exact non-production build, expose the four synthetic pilot items in a
single accessible inventory. Each item shows its source, purpose, scope, store,
age, expiry, policy version, current effect, and whether it is an explicit
choice, observation, or derivative. Explanations must be deterministic and
must not require a model call.

Gate: keyboard, screen-reader, reduced-motion, zoom, narrow viewport, offline,
stale, and account-switch checks preserve meaning and never expose another
account's state.

## Phase 3 — prove controls and propagation

Implement only the pilot controls needed to test edit, exclude, expire, forget,
domain reset, and global personalization reset. Produce bounded private
receipts showing requested scope, accepted scope, affected items, derivatives,
cache cleanup, exceptions, completion state, and remedy path.

Gate: failure injection cannot leave a hidden active derivative, cross-account
cache, falsely complete receipt, or product path that silently re-enables the
forgotten input.

## Phase 4 — evaluate a non-personalized baseline

Run the fixed scenario with personalization active, one use excluded, one item
forgotten, a domain reset, and a global reset. Compare task success, clarity,
control comprehension, accessibility, latency, storage, and cleanup proof. Do
not optimize engagement or infer preference from the review itself.

Gate: all reviewers can complete the basic task with personalization off and
can accurately explain what remains.

## Phase 5 — decide, document, or remove

Owners review positive and negative evidence. Record which contract elements
are approved, revised, rejected, or still unknown. Delete synthetic accounts,
Things, memories, derivatives, caches, exports, receipts, and fixtures. Broader
rollout requires a new decision and domain-specific qualification.

Gate: cleanup is proven and no production behavior, telemetry, or claim changed
through this roadmap alone.

## Pilot measures

- 100% of pilot items show kind, source, purpose, scope, store, age, expiry,
  policy, effect, and available controls.
- 100% of deterministic derivatives identify their declared inputs.
- Zero cross-account or cross-device-origin leakage in the fixed test matrix.
- Zero declared derivatives remain active after completed forgetting or reset.
- Reviewers correctly predict the effect of each control in the fixed scenario.
- The non-personalized baseline remains usable and accessible.
- Every injected partial failure is visible and recoverable without a false
  completion claim.

These are pilot gates, not production privacy, fairness, accessibility, or
outcome claims.

## Risks and responses

| Risk                                                | Response                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Inventory becomes a deceptive partial view          | Mark completeness and freshness; stop claims when an active store is unrepresented    |
| Correction rewrites history                         | Preserve the observation or event; change the future-use input with linked provenance |
| Deletion misses derivatives                         | Maintain an explicit derivative graph and fail closed when propagation is unknown     |
| Reset destroys unrelated content                    | Preview exact scope and keep content deletion under TODO 23                           |
| Accessibility preferences become sensitive profiles | Keep explicit settings distinct; prohibit undeclared inference                        |
| Explanations reveal private sources                 | Render only to the authorized subject and minimize source detail                      |
| Personalization-off becomes punitive                | Define and test a useful baseline before any expansion                                |
| Imported settings gain false authority              | Quarantine until the current person reviews and adopts them                           |

## Hard stops

Stop for missing accountable ownership; unknown source, purpose, store, or
effect; hidden collection; sensitive-trait inference; crossed account or
audience boundaries; unbounded retention; incomplete derivative propagation;
false completion; inaccessible controls; unusable non-personalized mode; real
personal data; minors; institutions; production telemetry; provider/model
calls; training; public ranking; advertising; or any high-impact decision.

## Dependencies and boundaries

- TODO 23 owns archive, export, restore, account deletion, and exit mechanics.
- TODO 24 and TODO 38 own feed and search behavior that may consume approved
  personal inputs.
- TODO 25 owns accessibility and language journeys.
- TODO 29 owns Thing/content provenance.
- TODO 33 owns assistant context, tool authority, and AI receipts.
- TODO 35 owns identity, authentication, disclosure, and presence.
- TODO 44 owns local/canonical synchronization and conflict semantics.
- TODO 45 qualifies any youth scope.
- TODO 46 governs product claims about this work.
- TODO 47 owns support coordination and routes domain remedies.
- TODO 48 owns versioned introduction, migration, rollback, and retirement.

## Next owner packet

Before implementation, present the baseline, vocabulary, four-item fixture,
memory-record schema, control/effect matrix, derivative cleanup diagram,
non-personalized baseline, accessibility matrix, failure injections, measures,
exclusions, cleanup proof, and named stop authority for approval.
