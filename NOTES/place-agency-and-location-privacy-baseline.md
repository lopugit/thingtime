# Place agency and location-privacy baseline

Last grounded: 2026-09-17 21:18 AEST, Australia/Melbourne

Status: evidence note; not an approved location policy, legal conclusion,
production tracking feature, public-location default, or permission change

Plan: [place agency and location-privacy roadmap](../PLAN/place-agency-and-location-privacy-roadmap.md)

Execution epic: [TODO 52](../TODO/claude-todo/52-place-agency-and-location-privacy.md)

## Question

How could Thingtime make nearby discovery and place-aware expression useful
without turning a one-shot location choice into durable tracking, unintended
publication, inferred routine, unsafe exposure, or a hidden input to ranking,
identity, advertising, eligibility, or AI?

## Working vocabulary

| Term            | Meaning in this note                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Device position | Coordinates returned by a device or browser after a permission decision                                                                |
| Place assertion | Location a person deliberately attaches to a Thing, which may be an exact point, coarse area, chosen tag, or free-text description     |
| Place query     | Location used to find or order results without necessarily being stored as account or content data                                     |
| Precision       | The disclosed granularity, from exact coordinates through neighbourhood/region to a person-chosen text label                           |
| Purpose receipt | A bounded record of what location was requested for, at what precision, for which audience/effect, and whether it was retained         |
| Location family | A source position plus copies, public projections, cached requests, derived places, aggregates, exports, notifications, and audit data |
| Stale location  | A formerly accurate position or place assertion that is no longer safe or correct for the intended use                                 |

These are product-planning terms. They do not determine whether a value is
personal or sensitive information, establish a lawful basis, or replace
privacy, safety, accessibility, child-safety, or legal review.

## Repository evidence

### The local feed starts with an explicit, one-shot choice

- `remix/app/components/Feed/Feed.tsx` asks for browser geolocation only after
  the person presses **Use my location**. It offers a manual location-tag
  fallback, states that the position is used for the search, and says it is not
  added to posts automatically.
- The coordinate lives in React state, resets when the viewer changes, and is
  not written to the local cache. The chosen text tag is cached locally under
  `tt-feed-local-tag`.
- `navigator.geolocation.getCurrentPosition()` uses a ten-second timeout and a
  five-minute maximum age. The repository does not prove how each browser
  explains permission duration or whether a returned fix is sufficiently fresh
  for every safety context.

This is a useful explicit-action baseline, not proof of a complete location
lifecycle.

### Exact coordinates travel through the feed request

- The local feed sends `lat`, `lng`, and a fixed 50 km radius to the GET feed
  route when a device position is active.
- The server validates finite latitude/longitude and a radius greater than zero
  and no more than 1000 km, then applies a Mongo `$geoWithin` query.
- Anonymous feed responses containing coordinates are deliberately excluded
  from the shared anonymous cache. That protects response reuse, but the
  repository does not establish whether request URLs, edge/server logs,
  analytics, error capture, support tooling, or upstream services retain exact
  coordinate parameters.

### A Thing can deliberately publish exact coordinates to its whole audience

- The root Thing schema accepts optional `geo.lat` and `geo.lng`, stores a
  GeoJSON point plus derived coordinates, and describes it as visible to
  everyone allowed to read that Thing. `null` clears the field.
- Generic create and update paths validate the point. Public Thing and post
  projections call `publicGeo()`, which returns the exact latitude and
  longitude to every authorized viewer.
- ACL checks still protect the Thing's audience, but there is no separate
  location audience, precision level, purpose, capture time, expiry, or stale
  marker. Sharing a Thing more broadly therefore shares its exact stored point
  equally broadly.
- Nearby generic search can also match stored points. A location attached for
  one future feature could become discoverable through another unless purpose
  and searchability are defined explicitly.

### Human-readable place and machine-searchable position already differ

Marketplace-shaped posts have a bounded free-text `listing.location`, while
the root `geo` field is machine-queryable coordinates. This is a useful design
distinction: a person can say “Melbourne,” “online,” or a fictional place
without claiming an exact device position. The current model does not yet give
one shared UI contract for choosing between those meanings or previewing their
different effects.

## External design anchors

| Anchor                                                                                                                                                                                                                                                                                                                                                                                                        | Planning implication                                                                                                                       | Limit                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| The W3C [Geolocation specification](https://www.w3.org/TR/geolocation/) treats geolocation as a powerful feature requiring express permission and advises recipients to request it only when necessary, use it for the stated task, dispose of it afterwards unless retention is expressly permitted, protect it, and explain collection, purpose, retention, sharing, access, update, deletion, and choices. | Make browser permission the beginning of a purpose-specific lifecycle, not blanket consent for storage, publication, reuse, or inference.  | Technical and privacy guidance, not jurisdiction-specific legal advice. |
| The W3C [Privacy Principles](https://www.w3.org/TR/privacy-principles/) call for purpose specification when personal data or a powerful feature is requested and warn against shifting all privacy labour onto individuals.                                                                                                                                                                                   | Present a small number of meaningful defaults and effects instead of a dense permission form or an all-purpose location grant.             | Design principles; qualified review is still required.                  |
| OAIC [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) emphasizes necessity, proportionality, fair collection, and data minimisation.                                                                                                                                     | Use the coarsest data sufficient for the approved task and justify every retained or derived field.                                        | Applicability and lawful basis require qualified assessment.            |
| Australia's eSafety Commissioner explains that [location sharing](https://www.esafety.gov.au/key-topics/online-tools-and-features/location-sharing) can reveal routines across services and can enable stalking, harassment, or coercion.                                                                                                                                                                     | Treat audience expansion, repeated observations, household/routine inference, and stopping as safety issues, not merely preference polish. | General safety guidance; threat models vary by person and context.      |

All four official pages returned HTTP 200 when checked on 2026-09-17.

## The product gap

Thingtime has useful coordinate validation, ACL enforcement, a one-shot local
feed control, a manual tag fallback, and explicit clearing. It does not yet
have one approved contract joining:

1. search input, stored place, published location, and derived location as
   different authorities;
2. the coarsest useful precision, purpose, audience, effect, freshness, expiry,
   and reuse rule for each surface;
3. an exact preview before a place becomes part of a Thing's readable data;
4. safe behavior across permission denial, stale fixes, account switching,
   audience changes, copies, embeds, exports, notifications, and deletion;
5. protection against routine, home/work, co-presence, or vulnerability
   inference from repeated observations;
6. request/log/analytics minimisation for coordinate-bearing query URLs;
7. correction and family-wide removal when a location is unsafe or wrong;
8. accessible, localized, low-bandwidth, and no-location equivalents; and
9. evidence that nearby utility does not depend on background tracking.

## Boundaries with adjacent garden work

- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md)
  owns complete-journey accessibility and language readiness.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns reports, protective controls, and moderation remedies after abuse.
- [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
  owns optional provenance fields; a location must never be inferred as proof
  of authorship, presence, custody, or event truth.
- [TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md)
  owns AI authority. Models cannot infer or expand location purpose.
- [TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)
  owns context-safe identity and disclosure.
- [TODO 38](../TODO/claude-todo/38-search-and-discovery-agency.md) owns query
  privacy, ranking explanations, and discovery behavior. This chain owns the
  location input and place-disclosure contract used by those systems.
- [TODO 41](../TODO/claude-todo/41-relationship-agency-and-consentful-connection.md)
  owns relationship state; a connection never implies location access.
- [TODO 45](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)
  owns age-appropriate safeguards; minors remain outside the first rehearsal.
- [TODO 48](../TODO/claude-todo/48-change-agency-and-humane-product-evolution.md)
  owns migration or changed meaning for existing `geo` data.
- [TODO 49](../TODO/claude-todo/49-personalization-agency-and-accountable-memory.md)
  owns inspectable derived memory; location history cannot appear by inference.

## Candidate place contract

1. **No location by default.** A useful tag/text/no-location path remains
   available and no account, content, or device position is inferred silently.
2. **One purpose per choice.** Nearby search, content publication, routing,
   safety response, and personalization require separate explicit authority.
3. **Use the coarsest sufficient precision.** Prefer chosen text or area over
   coordinates, and lower precision before expanding audience or retention.
4. **Preview publication.** Show the value, precision, audience,
   discoverability, freshness, expiry, and removal path before saving a place.
5. **Keep one-shot search ephemeral.** Do not persist, publish, train on, or
   reuse a device fix merely because it was supplied for nearby results.
6. **Never derive presence as fact.** A location may be chosen, stale, spoofed,
   proxied, or associated with content rather than its author.
7. **Stop across the family.** Clearing or narrowing a place follows stored
   fields, derived values, caches, copies, indexes, exports, and notifications
   under their approved contracts.
8. **Treat unsafe disclosure as a safety event.** Fast correction, audience
   narrowing, family deletion, support, and preservation of minimum evidence
   outrank engagement or ranking continuity.

## Bounded first rehearsal

Use adult internal reviewers, synthetic accounts, fixed fictional coordinates,
one fictional region/tag, one synthetic private text Thing, and one exact
non-production build. Rehearse:

- nearby search with a one-shot coordinate and the no-location tag baseline;
- an explicit choice between no place, text place, coarse area, and exact point;
- an audience-and-precision preview before synthetic save;
- denial, timeout, stale fix, viewer switch, audience expansion, correction,
  clearing, export preview, and cleanup; and
- proof that raw coordinates do not survive in fixtures, caches, analytics, or
  logs beyond the approved synthetic task.

Do not use a real person's position, contact anyone, enable background
tracking, publish an exact point, infer a home/work/routine, use production
analytics, change production permissions, include minors, or claim legal
compliance or safety.

## Evaluation questions

- Can a reviewer tell whether location is being used for search, stored on a
  Thing, shown to an audience, or retained for a later effect?
- Does the useful task still work with a chosen tag or coarser area?
- Can the person preview and reduce precision before audience expansion?
- Do denial, timeout, stale permission, unavailable sensors, and account
  switching leave no misleading state or cross-account location?
- Can one correction or safety stop remove or fence the approved location
  family without destroying unrelated content?
- Are exact coordinate request URLs absent from unapproved logs, analytics,
  support captures, notifications, and error records?
- Do keyboard, touch, screen reader, zoom, narrow-screen, plain-language,
  localization, and low-bandwidth paths reach the same safe outcome?

## Open owner decisions

- Which Thingtime tasks genuinely need exact coordinates rather than a chosen
  tag, region, or server-side coarse token?
- Should root `geo` remain exact-readable data, gain precision/purpose/expiry
  metadata, or be replaced by a safer place-reference model?
- Which location-bearing request data can infrastructure observe, for how long,
  and how will that be verified rather than assumed?
- How should audience expansion, copies, embeds, exports, and notifications
  transform or suppress location?
- What correction, emergency hiding, evidence preservation, and support path is
  operationally safe after unintended disclosure?
- Which aggregate utility and safety measures authorize a narrower pilot or
  force the feature to remain tag-only?

Refresh this note after changes to Thing `geo`, feed/search transport, local
algorithms, ACL/public projections, logging, analytics, copies/embeds, exports,
native location APIs, privacy/safety policy, or browser permission behavior.
