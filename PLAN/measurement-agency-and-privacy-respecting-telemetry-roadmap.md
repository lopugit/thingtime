# Measurement agency and privacy-respecting telemetry roadmap

Status: Proposed

Evidence: [measurement agency and privacy-respecting telemetry baseline](../NOTES/measurement-agency-and-privacy-respecting-telemetry-baseline.md)

Execution epic: [TODO 54](../TODO/claude-todo/54-measurement-agency-and-privacy-respecting-telemetry.md)

## Outcome

Thingtime learns enough to operate, protect, and improve the service while
people retain a useful baseline, understandable choices, bounded retention,
inspectable effects, and protection from hidden behavioral dossiers or
secondary use.

## Principles

- Declare purpose and necessity before choosing a signal.
- Separate operational, public-count, user-owned, product, and safety planes.
- Collect the minimum sufficient resolution for the approved outcome.
- Optional measurement never becomes a gate, penalty, or hidden ranking signal.
- Prefer short-lived, rotating, aggregate, and thresholded evidence.
- Keep linkable observations and derived effects inspectable and stoppable.
- Give every field and derivative an explicit retention and cleanup path.
- Version metrics, definitions, exclusions, uncertainty, and environments.
- Treat provider defaults and privacy labels as claims requiring live proof.
- Qualified product, privacy, security, data, safety, accessibility,
  child-safety, infrastructure, support, research, and legal owners approve
  real collection or use.

## Phase 0 — assign authority and inventory the current measurement family

Name owners and inventory browser events, Vercel Analytics, post views, feed
engagement, algorithm weights, error logs, console/platform logs, provider
copies, CI telemetry, dashboards, exports, alerts, models, reports, backups,
legal text, and deletion paths. Record exact environments and distinguish
observed implementation from provider documentation or assumptions.

Gate: no new collection, production experiment, analytics export, drain,
dashboard access expansion, or privacy claim; one owner can stop the rehearsal.

## Phase 1 — approve purpose, signal, and plane taxonomy

Define reliability diagnosis, public count integrity, user-owned adaptation,
optional product learning, and safety evidence as separate planes. For each
current field, record purpose, necessity, subject, source, resolution, linkability,
processor, consumer, effect, security, retention, deletion, and prohibited uses.

Gate: every signal has one approved primary purpose and no catch-all event
stream, dashboard, stable identifier, or generic consent silently authorizes
secondary use.

## Phase 2 — specify choice, receipts, retention, and metric truth

Define the useful no-optional-measurement baseline, in-context explanations,
plain-language and machine-readable catalog, account/device/environment scopes,
pause/reset/delete controls, provider configuration proof, aggregation
thresholds, field-specific expiry, family cleanup, and versioned metric schema.

Gate: a person can tell what is observed, why, by whom, for how long, with what
effect, how to stop it, what remains, and whether refusal changes the service.

## Phase 3 — prototype five synthetic measurement planes

In one exact non-production build, use three synthetic adult accounts, one
fictional post, one synthetic feed session, generated routes, and a deterministic
local fake collector. Rehearse redacted diagnostics, public count alternatives,
owned algorithm learning, optional aggregate product learning, and a mock safety
envelope without crossing data or authority between them.

Gate: reviewers predict every field, derived effect, processor, retention,
choice, metric output, and cleanup result before any synthetic event is emitted.

## Phase 4 — rehearse failure, manipulation, and secondary-use pressure

Exercise duplicates, replay, spoofed identities, bot traffic, late events,
offline/page-hide delivery, clock skew, missing fields, partial provider outage,
account switch, deletion during aggregation, small cohorts, differencing,
dashboard/export leakage, and a proposal to reuse data for ranking or pricing.

Gate: failures remain non-blocking and bounded; manipulation cannot create a
trusted metric; small cohorts remain hidden; and unapproved secondary use fails
closed without retaining extra input.

## Phase 5 — accessibility, evidence, and cleanup proof

Test keyboard, touch, screen reader, 200% zoom, narrow screens, plain language,
localization, low bandwidth, private browsing, blocked scripts, and no-JavaScript
baseline. Measure purpose/choice comprehension, data footprint, refusal parity,
expiry, reset/delete success, metric reproducibility, and support burden using
only synthetic records. Delete all fixtures, fake provider copies, weights,
aggregates, exports, caches, and local logs.

Gate: cleanup is independently verified and no public privacy, necessity,
anonymity, accuracy, fairness, safety, or deletion claim outruns exact evidence.

## Measures to define before implementation

| Measure                   | Required definition                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Purpose comprehension     | Reviewer correctly states why each signal exists, who receives it, and what it may affect                              |
| Minimum data footprint    | Fields, identifier stability, time/location precision, raw volume, processors, and retained bytes per approved outcome |
| Refusal parity            | Optional-measurement refusal preserves function, price, support, safety, accessibility, and account standing           |
| Retention convergence     | Client, server, provider, aggregate, export, cache, and backup copies reach the approved expiry or deletion state      |
| Secondary-use containment | No signal appears in an unapproved ranking, targeting, pricing, eligibility, AI, safety, or research path              |
| Metric reproducibility    | Independent reviewer recomputes a versioned metric with the same numerator, denominator, exclusions, and environment   |
| Manipulation resistance   | Replay, bots, duplicates, spoofing, late events, and partial loss are bounded and visible in uncertainty               |
| Accessible outcome parity | Supported access paths reach the same explanation, choice, useful baseline, and remedy                                 |

No measure is a target until owners approve its purpose, collection method,
retention, aggregation threshold, accessibility/safety breakdown, minimum
sample, uncertainty display, and stop threshold.

## Risks and responses

| Risk                                              | Response                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Automatic analytics outruns notice or choice      | Inventory the exact live configuration, redact sensitive paths, separate essential from optional, and add in-context catalog/control |
| Public view count becomes a viewing-history graph | Test aggregate or rotating-key alternatives, remove unnecessary fields, bound retention, and prevent viewer-list access              |
| Feed learning becomes product surveillance        | Keep it user-owned, explain signals/effects, add pause/reset/delete, and prohibit cross-plane reuse                                  |
| Error content escapes into logs                   | Closed schemas, aggressive redaction, field allowlists, bounded capture, access control, and short expiry                            |
| Hashing is mistaken for anonymity                 | Document linkability and attack assumptions; use rotation, thresholds, deletion, and no public anonymity claim                       |
| Small cohorts expose people                       | Minimum cohort thresholds, anti-differencing rules, coarse dimensions, and suppressed exports                                        |
| Metrics reward harmful optimization               | Pair outcomes with safety/quality constraints and forbid metric-only release or staff/user scoring                                   |
| Missing events are treated as behavior            | Record loss, blocking, offline state, and sampling as uncertainty, never as a negative user signal                                   |
| Optional refusal degrades the product             | Maintain and test a useful baseline; no retaliation, dark pattern, or unrelated feature gate                                         |
| Provider defaults drift                           | Pin/version integration, verify live fields/settings, and refresh the contract on provider or package change                         |

## Hard stops

Stop for real browsing or behavior; production analytics or dashboard mutation;
provider drains or exports; private content, queries, messages, contacts, precise
location, raw IP addresses, device fingerprints, or vulnerable-trait inference;
minors or small identifiable cohorts; advertising or cross-context tracking;
staff/user productivity or risk scores; covert experiments; silent ranking,
pricing, eligibility, moderation, or AI reuse; unbounded raw events; failed
expiry/deletion; inaccessible choice; retaliation for refusal; or missing
qualified owners.

## Dependencies and boundaries

- TODO 20 owns participant-visible event history and provenance.
- TODO 22 owns adoption experiments and learning loops.
- TODO 24 owns attention and calm-use constraints.
- TODO 26 owns moderation and safety decisions.
- TODO 28 owns reliability and incident recovery.
- TODO 30 owns collection, processing, storage, and delivery budgets.
- TODO 33 owns AI/model/tool authority and training/context choices.
- TODO 38 owns ranking and discovery outcomes.
- TODO 45 owns age-appropriate safeguards.
- TODO 46 owns public evidence and claims.
- TODO 49 owns personalization observations, derivatives, forgetting, and reset.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative.

## Next owner packet

Present the evidence baseline, live signal/provider inventory, purpose and
necessity register, measurement-plane map, field and derived-effect matrix,
useful-baseline proof, choice/receipt design, retention and family-cleanup
schedule, provider configuration evidence, metric schema, manipulation/small-
cohort threat model, accessible synthetic fixture, measures, stop conditions,
and owner decisions before implementation.
