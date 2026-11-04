# Measurement agency and privacy-respecting telemetry baseline

Last grounded: 2026-09-18 21:00 AEST, Australia/Melbourne

Status: evidence note; not an approved analytics policy, consent model,
retention schedule, production experiment, legal conclusion, or authorization
to collect new telemetry

Plan: [measurement agency and privacy-respecting telemetry roadmap](../PLAN/measurement-agency-and-privacy-respecting-telemetry-roadmap.md)

Execution epic: [TODO 54](../TODO/claude-todo/54-measurement-agency-and-privacy-respecting-telemetry.md)

## Question

How could Thingtime learn whether the service is reliable, useful, safe, and
fair without turning page visits, reading time, viewport position, errors, or
product choices into an invisible behavioral dossier, a growth objective, or
authority for an unrelated decision?

## Working vocabulary

| Term                | Meaning in this note                                                                                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Measurement purpose | One approved reason to process a defined signal, such as reliability diagnosis, public count integrity, user-owned adaptation, safety evidence, or aggregate product learning           |
| Signal              | The minimum observed fact needed for the approved purpose, before enrichment or inference                                                                                               |
| Measurement plane   | A deliberately separated store and authority boundary for operational diagnostics, public counters, user-owned adaptation, aggregate analytics, or safety evidence                      |
| Event envelope      | A versioned record of purpose, signal fields, source surface, subject scope, time resolution, environment, processor, retention, and allowed consumers                                  |
| Derived metric      | A reproducible calculation over approved inputs with a named definition, version, caveats, and minimum aggregation threshold                                                            |
| Secondary use       | Any use, combination, audience, model, ranking, eligibility decision, or retention purpose not approved in the original envelope                                                        |
| Measurement family  | The client event, request metadata, provider copy, raw or aggregate row, cache, export, dashboard, alert, model weight, report, backup, and deletion trail derived from one observation |
| Useful baseline     | The service remains functional and humane when optional measurement is refused, unavailable, or deleted                                                                                 |

These are planning terms. They do not establish consent, lawful basis,
anonymity, de-identification, necessity, security, accuracy, fairness, or
regulatory compliance.

## Repository evidence

### Vercel Web Analytics is mounted globally after hydration

- [`root.tsx`](../remix/app/root.tsx) imports `Analytics` from
  `@vercel/analytics/react` and renders it whenever the root has mounted.
- The inspected root does not put that mount behind a Thingtime measurement
  purpose, environment, account preference, or per-surface choice.
- The current privacy policy says website analytics help Thingtime understand
  page visits and use, and names Vercel hosting and analytics as an example
  service provider.

That is useful notice at policy level. It is not an exact inventory of route
fields, redaction rules, environment coverage, processors, retention,
aggregation, settings, exports, or downstream decisions. Vercel's default
privacy properties are provider documentation, not proof of Thingtime's live
project configuration.

### Public post views collect more than a public count

- [`useViewTracking.ts`](../remix/app/components/Feed/useViewTracking.ts)
  observes post cards and, after at least 50% visibility for at least one
  second, sends dwell time, maximum visible ratio, and viewport position.
  Batches flush every ten seconds and on page hide. Headless clients are
  skipped and one event is emitted per post per page view.
- [`views.ts`](../remix/app/api/utils/things/views.ts) accepts the event only
  for a post the viewer may read, drops owner self-views, clamps fields, and
  deduplicates one document per post and viewer identity. A signed-in viewer is
  keyed by user ID; an anonymous viewer is keyed by a salted hash of IP and
  user agent, with no raw IP stored in that collection.
- Each persistent row can accumulate impressions and dwell, remember maximum
  ratio, last viewport position, first time, and last time. Aggregates expose
  unique views, impressions, and average dwell on public post payloads and feed
  ranking can use the public view count.
- The inspected `postViews` index is unique on post and viewer key. No TTL,
  expiry field, or participant-facing deletion/control contract is visible in
  the inspected path.

Anti-bot checks and hashing reduce abuse and direct exposure. They do not make a
stable per-post viewer key non-personal, necessary for every purpose, immune to
linkage, or appropriate for indefinite retention.

### Feed learning transforms behavior into user-owned weights

- [`useFeedEngagement.ts`](../remix/app/components/Feed/useFeedEngagement.ts)
  watches view and dwell and also records expand, reaction, comment, and share
  signals. It keeps a session copy and flushes bounded batches every eight
  seconds or when the page hides.
- Without an active algorithm, the network queue is cleared. With one, the
  authenticated `/api/v1/algorithms/track` route applies valid signals to that
  caller-owned algorithm's deterministic weights, event count, and last-trained
  time.
- The inspected server path transforms accepted events into weights rather
  than creating a durable raw event Thing. The client still holds session
  events long enough to support an explicit save-as-algorithm flow.

This is meaningfully different from product analytics: the immediate effect is
an owned feed algorithm. The interface still needs to explain which behaviors
train it, how to pause/reset it, what the resulting weights mean, and whether
the same observation may enter any other measurement plane.

### Error logs demonstrate a bounded operational plane

- [`errorLogs.ts`](../remix/app/api/utils/errors/errorLogs.ts) stores protected,
  non-billable, admin-only error Things for seven days. It removes known
  secrets, URLs, opaque values, request bodies, cookies, authorization headers,
  images, and arbitrary provider objects from the closed snapshot.
- Capture is best effort and bounded to five per request, five concurrent
  writes, sixty writes per server instance per minute, and a one-second
  persistence deadline. The code explicitly says this is a diagnostic trail,
  not a complete audit ledger.
- Tests cover protection, expiry, redaction, access, and capability-manifest
  publication.

This is a useful model for purpose limitation and retention. It does not prove
that every console, platform, provider, browser, notification, or support log
uses the same boundary.

### The legal text is broad; the product contract is not yet inspectable

The current privacy policy names technical information, request/error logs,
website analytics, service use, reliability, abuse detection, providers,
international processing, and variable retention. The inspected product paths
do not yet expose one plain-language and machine-readable measurement catalog
showing each signal, purpose, necessity, processor, retention period,
aggregation, consumer, secondary-use ban, choice, deletion path, or metric
definition.

## External design anchors

| Anchor                                                                                                                                                                                                                                                                                                                                                 | Planning implication                                                                                                                                                          | Limit                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| OAIC [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) says collection must be reasonably necessary and proportionate, and calls for data minimisation because over-collection increases security and breach harm. | Require a written necessity test for every signal and field before collection; usefulness alone is not enough.                                                                | Applicability, lawful basis, consent, and reasonable necessity require qualified legal review.                    |
| The W3C [Privacy Principles](https://www.w3.org/TR/privacy-principles/) call for data minimisation, purpose specification, relevant explanations, user controls, no unrelated secondary use, and no retaliation for refusing non-essential processing.                                                                                                 | Separate essential operation from optional learning, preserve a useful baseline, and make processing visible in context and machine-readable.                                 | Design guidance, not a Thingtime implementation or jurisdiction-specific legal safe harbour.                      |
| The [NIST Privacy Framework](https://www.nist.gov/privacy-framework) provides a voluntary way to identify, govern, control, communicate, and protect privacy risk across data processing and ecosystem relationships.                                                                                                                                  | Treat clients, Thingtime stores, Vercel, dashboards, drains, exports, models, and operators as one governed measurement family.                                               | Risk-management guidance, not a product specification or certification.                                           |
| Vercel's [Web Analytics privacy and compliance](https://vercel.com/docs/analytics/privacy-policy) documentation describes automatic page-view collection, an ephemeral 24-hour visitor session, aggregate statistics, recorded route/referrer/location/device fields, and configurable redaction through `beforeSend`.                                 | Verify the exact installed version and live project configuration; explicitly redact sensitive paths and never infer that provider defaults settle Thingtime's full contract. | Provider documentation can change and does not describe Thingtime's first-party post-view or algorithm telemetry. |

All four official pages returned HTTP 200 when checked on 2026-09-18.

## The product gap

Thingtime has useful redaction, access, rate-limit, deduplication, aggregation,
owned-algorithm, and seven-day diagnostic primitives. It does not yet have one
approved contract joining:

1. an inventory of every browser, server, provider, operational, ranking, and adaptation signal;
2. one declared purpose, necessity test, subject scope, and allowed consumer for each field;
3. strict separation between operational diagnostics, public counters, user-owned learning, optional product analytics, and safety evidence;
4. a useful service baseline when optional measurement is refused or unavailable;
5. in-context, plain-language and machine-readable notice plus inspect/pause/reset/delete controls where a signal is linkable;
6. exact raw, derived, aggregate, provider, export, backup, and deletion retention;
7. minimum aggregation and anti-reidentification rules before sharing or comparing cohorts;
8. a ban on silent reuse for ranking, targeting, pricing, eligibility, AI training, moderation, or staff/user scoring;
9. versioned metric definitions, denominator and missingness truth, uncertainty, and correction; and
10. a synthetic rehearsal proving value without real behavior, production dashboards, or external analytics calls.

## Boundaries with adjacent garden work

- [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md) owns
  participant-visible event history and version provenance.
- [TODO 22](../TODO/claude-todo/22-trustworthy-adoption-loop.md) owns adoption
  experiments and learning loops; this chain owns what measurement may enter
  them.
- [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns calm
  use and prohibits engagement goals from overruling a person's attention.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns safety and moderation decisions; telemetry cannot silently become a
  safety score.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  reliability and incident recovery; this chain bounds the evidence used.
- [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md) owns resource
  budgets for collection, processing, storage, and delivery.
- [TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md) owns
  model/tool authority and AI training/context choices.
- [TODO 38](../TODO/claude-todo/38-search-and-discovery-agency.md) owns ranking
  and discovery outcomes; a metric is not automatic authority to rank.
- [TODO 45](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)
  owns child-specific safeguards; minors remain outside the first rehearsal.
- [TODO 46](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md)
  owns public claims and exact-version evidence.
- [TODO 49](../TODO/claude-todo/49-personalization-agency-and-accountable-memory.md)
  owns inspectable observations, derivatives, effects, forgetting, and reset.

## Candidate measurement contract

1. **Purpose before signal.** No event or field exists without an approved
   user/service outcome, necessity test, owner, processor map, and stop rule.
2. **Separate planes.** Operational diagnosis, public counts, user-owned
   adaptation, aggregate product learning, and safety evidence never share a
   catch-all stream or authority.
3. **Minimum sufficient resolution.** Prefer counters, bounded sketches,
   coarse time, thresholded aggregates, and short-lived rotating identifiers
   over event histories and stable identities.
4. **Optional means optional.** Refusing product analytics never degrades an
   unrelated core function, hides a control, or becomes a negative signal.
5. **Derived effects stay legible.** A person can inspect, pause, reset, or
   delete linkable observations and learned state where appropriate.
6. **Retention is field-specific.** Raw input expires first; derived and
   aggregate state has a stated purpose, deadline, cleanup path, and backup rule.
7. **No silent secondary use.** New ranking, targeting, pricing, eligibility,
   AI, safety, or research use requires a new reviewed contract and transition.
8. **Metrics are versioned evidence.** Publish definition, numerator,
   denominator, exclusions, missingness, uncertainty, environment, and expiry.
9. **Failure is quiet and safe.** Telemetry loss cannot break the product,
   retry-loop, disclose content, or create hidden authority.
10. **Claims follow proof.** Privacy-preserving, anonymous, necessary, safe,
    accurate, representative, and deleted are evidence claims, not labels.

## Bounded first rehearsal

Use adult internal reviewers, three synthetic accounts, one fictional public
post, one synthetic feed session, generated route names, a deterministic local
fake collector, and one exact non-production build. Rehearse five distinct
planes:

- a bounded redacted reliability error with seven-day fake expiry;
- a synthetic public view counter with alternative aggregate and rotating-key designs;
- user-owned algorithm learning with inspect, pause, reset, and delete;
- optional aggregate page/use measurement with refusal and no-retaliation proof; and
- a non-functional safety-evidence envelope handed to TODO 26.

Do not use real browsing, accounts, posts, routes containing personal data,
production providers, Vercel project data, analytics dashboards, drains,
advertising, experiments, minors, vulnerable groups, private content, precise
location, device fingerprinting, real IP addresses, or public claims.

## Evaluation questions

- Can a person distinguish essential operation from optional product learning?
- Can reviewers explain every field's purpose, resolution, processor,
  retention, audience, derived effects, deletion, and prohibited uses?
- Does refusal preserve the same useful baseline, price, support, safety,
  accessibility, and account standing?
- Can a public count resist manipulation without retaining a durable viewer
  history or exposing who viewed what?
- Can an owned algorithm learn without exporting raw behavior into another plane?
- Are error logs useful after content, credentials, URLs, and unrelated context
  are removed and expiry is enforced?
- Can every published metric be recomputed from its versioned definition and
  show exclusions, missingness, uncertainty, and environment?
- Do keyboard, touch, screen reader, narrow-screen, low-bandwidth, private-
  browsing, and no-JavaScript paths receive the same explanation and baseline?

## Open owner decisions

- Which measurements are strictly necessary to operate or secure the service,
  and which are optional learning?
- Are dwell time, maximum ratio, viewport position, stable per-post viewer
  keys, and signed-in user IDs necessary for the public view-count purpose?
- What retention and deletion rules apply to `postViews`, provider page views,
  feed weights, operational logs, aggregates, exports, and backups?
- Which exact Vercel environments, routes, fields, redactions, project settings,
  exports, APIs, and drains are active?
- Should Thingtime support browser privacy signals such as Global Privacy
  Control, and what processing would they change?
- Which user-owned learning signals may remain private weights, and how can a
  person inspect or reset their effects without exposing a behavioral history?
- What aggregation threshold and anti-differencing rules make a cohort report
  safe enough to share?
- Who may approve a new secondary use, and how are existing observations
  excluded until that transition is complete?

Refresh this note after changes to Vercel Analytics, root mounting, feed/post
tracking, algorithms, logs, privacy/legal text, provider exports or drains,
ranking, experiments, personalization, safety evidence, deletion, storage, or
backup architecture.
