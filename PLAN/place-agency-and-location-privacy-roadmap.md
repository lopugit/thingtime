# Place agency and location-privacy roadmap

Status: Proposed

Evidence: [place agency and location-privacy baseline](../NOTES/place-agency-and-location-privacy-baseline.md)

Execution epic: [TODO 52](../TODO/claude-todo/52-place-agency-and-location-privacy.md)

## Outcome

Thingtime can offer useful nearby discovery and deliberate place expression
without silent collection, background tracking, accidental exact publication,
purpose drift, routine inference, unsafe audience expansion, or a location
requirement for core use.

## Principles

- No location is the useful default; text/tag/coarse choices stay available.
- Search input, stored place, publication, and derivation are different grants.
- Use the coarsest precision and shortest lifetime that completes the task.
- Preview value, precision, purpose, audience, effect, and retention before save.
- A browser or OS permission is not consent to persist, publish, infer, or reuse.
- Location never proves identity, authorship, presence, trust, or eligibility.
- Clearing or narrowing follows the complete location family.
- Safety and accessible stopping outrank engagement or local-feed continuity.
- Qualified product, privacy, safety, security, accessibility, child-safety,
  data, infrastructure, support, and legal owners approve any real scope.

## Phase 0 — assign authority and protect the current boundary

Name accountable owners and inventory browser/native permissions, feed/search
requests, Thing `geo`, free-text locations, projections, indexes, caches, logs,
analytics, error capture, exports, copies, embeds, notifications, and support.
Preserve the current explicit local-feed button and tag fallback while marking
every unverified retention or downstream behavior unknown.

Gate: no surface implies that a local-feed permission authorizes storage or
publication, and one owner can stop the rehearsal.

## Phase 1 — approve the place taxonomy and effect matrix

Define source position, chosen point, coarse area, text place, place query,
derived place, repeated observation, and safety-suppressed state. For each,
record purpose, minimum precision, audience, searchability, freshness, expiry,
retention, correction, deletion, export, copy/embed, and prohibited effects.

Gate: every allowed location effect has one source of authority and no browser,
account, content, relationship, or AI permission silently supplies another.

## Phase 2 — specify choice, preview, and lifecycle contracts

Define a versioned place-choice envelope and a bounded purpose receipt. Before
save or publication, show the selected value/area, precision, audience,
discoverability, retention, expiry, and removal path. Specify one-shot query
handling, safe request transport, family cleanup, audience-change rules, and
minimum evidence retained after a safety removal.

Gate: a reviewer can reconstruct what was requested, chosen, disclosed,
retained, changed, and removed without recovering an unnecessary exact point.

## Phase 3 — prototype one synthetic nearby-and-publish choice

In one exact non-production build, use fixed fictional coordinates and a
fictional tag. Compare the no-location/tag path with one-shot nearby search;
then preview no place, text place, coarse area, and exact-point publication on
one synthetic private Thing. Exact publication remains disabled by default and
no production service, permission, account, or dataset changes.

Gate: adult internal reviewers can identify search versus publication, choose
the coarsest option, state the audience/effect, decline without losing utility,
and clear every synthetic location.

## Phase 4 — rehearse failure, audience change, and safety stopping

Exercise denial, timeout, unavailable sensor, stale fix, changed browser grant,
rapid repeat, out-of-order response, viewer switch, audience expansion,
revocation, copied/embedded/exported content, wrong location, unintended
disclosure, correction, emergency hiding, and retry. Fence every asynchronous
result to the initiating viewer, purpose, and Thing version.

Gate: no stale or cross-account point survives; broader audiences never inherit
greater precision silently; one safety stop prevents further disclosure while
preserving only approved evidence and a useful no-location path.

## Phase 5 — evaluate utility, safety, accessibility, and cleanup

Review task completion with and without coordinates, precision reduction,
permission comprehension, mistaken publication, correction/removal completion,
unsafe disclosure response, retention proof, and support load. Test keyboard,
touch, screen reader, zoom, narrow screens, plain language, localization,
reduced connectivity, and no-sensor behavior. Delete all fixtures and record
open decisions.

Gate: qualified owners approve one narrower next experiment or archive the
proposal; no synthetic coordinate remains outside approved evidence.

## Measures and release policy

| Measure                    | Required interpretation                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Purpose comprehension      | Reviewers distinguish nearby query, stored place, publication, and derivation before acting                 |
| Precision minimisation     | The task succeeds at the coarsest approved precision; exact use has a documented necessity                  |
| No-location parity         | Core use and a useful local/tag alternative remain available without device location                        |
| Audience integrity         | Precision never expands when a Thing's audience, copy, embed, export, or notification expands               |
| Ephemeral-query proof      | One-shot coordinates are absent from unapproved persistence, logs, analytics, caches, and later effects     |
| Correction and safety stop | Wrong or unsafe location can be fenced, corrected, and removed across the approved family                   |
| Failure/account separation | Denial, timeout, stale results, and viewer switches leave no misleading or cross-account location state     |
| Accessible outcome parity  | Supported input and assistive paths reach the same choice, preview, stopping, correction, and no-place path |

No metric is a target until owners approve its definition, data source,
retention, minimum sample, accessibility/safety breakdown, and stop threshold.

## Risks and responses

| Risk                                          | Response                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Search permission becomes durable tracking    | Bind one-shot input to one request/purpose and prove family cleanup                           |
| Exact point is published unintentionally      | Default to none/coarse, require explicit preview, and separate search from save               |
| Broader audience inherits exact precision     | Re-preview and reduce precision before expansion; fail closed on stale consent                |
| Query URL reaches logs or analytics           | Inventory every hop, minimize transport, redact/disable capture, and verify retained evidence |
| Repeated points reveal home, work, or routine | Prohibit cross-event derivation; aggregate only through separately approved privacy review    |
| A stale/spoofed point is treated as truth     | Show source/freshness and never use location as proof of presence or identity                 |
| Relationship implies location access          | Require a distinct purpose/audience choice; connections grant nothing automatically           |
| Safety removal destroys needed evidence       | Fence disclosure first, then preserve only qualified, minimum, access-controlled evidence     |
| Local utility excludes no-sensor users        | Maintain a fully useful text/tag/coarse and low-bandwidth path                                |
| Location claim outruns evidence               | Route every privacy, safety, locality, and deletion claim through TODO 46                     |

## Hard stops

Stop for a real person's precise or repeated location; background or passive
tracking; production permission/default changes; public exact coordinates;
home/work/routine or co-presence inference; advertising, price, rank,
eligibility, moderation, identity, or AI use; minors; domestic/family/safety
cases without qualified protection; inaccessible or no-location dead ends;
unbounded retention; unclear infrastructure capture; failed family cleanup;
or absent qualified owners.

## Dependencies and boundaries

- TODO 24 owns accessibility and language readiness.
- TODO 26 owns moderation and post-abuse remedies.
- TODO 29 owns provenance; place never proves presence or authorship.
- TODO 33 owns AI authority and prohibits unapproved location inference.
- TODO 35 owns identity and context-safe disclosure.
- TODO 38 owns search/query privacy and discovery explanations.
- TODO 41 owns relationship state; connections grant no location authority.
- TODO 45 owns age-appropriate safeguards.
- TODO 46 owns public privacy, safety, locality, and deletion claims.
- TODO 48 owns migration or changed meaning for existing location data.
- TODO 49 owns inspectable memory and derived-data controls.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative.

## Next owner packet

Present the evidence baseline, current data/transport map, place taxonomy,
purpose-and-effect matrix, precision ladder, preview/receipt sketches,
request/log retention audit, location-family cleanup graph, threat model,
accessible no-location baseline, synthetic fixture plan, measures, stop
conditions, and the decisions needed before implementation or public claims.
