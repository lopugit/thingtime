# Search and discovery agency baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-10, Australia/Melbourne

**Plan:** [Search and discovery agency roadmap](../PLAN/search-and-discovery-agency-roadmap.md)

**Execution epic:** [TODO 38 — Search and discovery agency](../TODO/claude-todo/38-search-and-discovery-agency.md)

## Why preserve this note

Thingtime can already search visible Things with ranked text, structured
conditions, schema-guided filters, people and subspace rails, and compact
Commander results. Those are strong finding tools. They do not yet form one
contract explaining which corpus was searched, why an item matched, what
affected its position, whether the query was retained, or how a person can
change the result without feeding an attention profile.

Those distinctions become essential as Thingtime adds more public content,
schemas, apps, creators, communities, AI assistance, or commercial surfaces.
This note separates direct retrieval from recommendation, promotion, trust,
and truth before scale makes those concepts easy to blur.

This is product and engineering research, not legal advice or a claim of
accessibility, fairness, privacy, or regulatory compliance.

## Evidence ledger

| Claim                                                                                                                              | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Confidence and refresh trigger                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search is an established product and API surface.                                                                                  | [`SearchPage.tsx`](../remix/app/components/Search/SearchPage.tsx), [`things/search.ts`](../remix/app/api/utils/things/search.ts), and the registered [`things-search`](../remix/app/docs/apiDocs.ts) endpoint provide ranked text plus structured search. Merged PRs [#63](https://github.com/lopugit/thingtime/pull/63), [#69](https://github.com/lopugit/thingtime/pull/69), and [#427](https://github.com/lopugit/thingtime/pull/427) record major search slices.                                                                                                                                                                                                              | High for the inspected `develop` snapshot. Recheck route, utility, docs, schema, index, and projection changes together.                                  |
| First-party Thing search starts from an ACL-aware visibility superset and applies an exact per-document verdict before projection. | [`searchThings()`](../remix/app/api/utils/things/search.ts) composes `visibilityQueryFor()` with query clauses, then `projectVisiblePage()` uses `canViewInherited()` before returning public projections. App-token search substitutes the app namespace and author-consent lens rather than borrowing first-party visibility.                                                                                                                                                                                                                                                                                                                                                   | High for current code. Re-test every paging, inherited-ACL, app-token, block, moderation, and account-switch path after authorization changes.            |
| Protected system kinds are excluded from generic search, and people search does not match email.                                   | Generic search excludes protected user/theme/feed-algorithm/waitlist kinds. [`searchUsersPublic()`](../remix/app/api/utils/auth/users.ts) matches bounded username or display-name literals and returns public profiles only; the route is rate-limited and requires non-empty text.                                                                                                                                                                                                                                                                                                                                                                                              | High for current writers and projections. Recheck when identity fields or discovery rules change.                                                         |
| The structured grammar is bounded and does not accept raw database operators or regular expressions.                               | [`things/search.ts`](../remix/app/api/utils/things/search.ts) allowlists fields and operators, caps query length, group depth, condition count, values, field paths, result size, and ranked offset, and escapes literal text operators.                                                                                                                                                                                                                                                                                                                                                                                                                                          | High for this implementation. Fuzz and real-API test after every grammar or schema change.                                                                |
| Ranked Thing search uses one weighted wildcard text index and returns query-relative scores.                                       | [`collections.ts`](../remix/app/api/utils/mongodb/collections.ts) weights names/text above titles and tags, with English as the default text language. [`searchRanking.ts`](../remix/app/api/utils/things/searchRanking.ts) attaches finite Mongo text scores, and the page labels them “ranked match.”                                                                                                                                                                                                                                                                                                                                                                           | High for current mechanics. It is not a quality, truth, popularity, or universal relevance score. Recheck index migrations and language handling.         |
| Search surfaces use different candidate sets and ordering rules.                                                                   | The full page combines Things, public people, and subspaces; Commander combines a pinned full-search row, platform results, and local paths; the quick switcher combines fuzzy pages, people, and the viewer's own Things. People search is username-sorted while Thing text search uses relevance, and other browse surfaces have their own popularity or recency rules.                                                                                                                                                                                                                                                                                                         | High for repository behavior, not a usability judgment. Re-map every search/discovery surface before unifying labels or metrics.                          |
| Plain text searches become shareable URL state after success.                                                                      | `SearchPage` replaces the location with `?q=<text>` after a successful plain search. The GET route supports anonymous edge caching, while structured search uses POST. A URL is useful for deliberate sharing, but can also enter browser history, screenshots, referrers, support captures, and infrastructure logs.                                                                                                                                                                                                                                                                                                                                                             | High for the client flow. The repository does not prove every deployment-log or browser-retention behavior; inspect those systems before a privacy claim. |
| Cached search state is local and account-scoped, but no expiry is visible in the search cache contract.                            | `SearchPage` uses `tt-search-<userId>`, purges the older global cache key, paints cached results immediately, and does not auto-run a plain `/search` visit. The snapshot can include the account owner's private Things.                                                                                                                                                                                                                                                                                                                                                                                                                                                         | High for current code. Recheck local-cache deletion, sign-out, shared-device, endpoint-switch, and retention behavior before expanding the cache.         |
| Counts and ranked pages deliberately trade completeness for bounds.                                                                | Ranked pages use offset within a bounded candidate window; engagement filters use a 400-candidate window; first-page totals are capped visibility-superset approximations and may be unavailable. The UI prefixes uncapped totals with `~`.                                                                                                                                                                                                                                                                                                                                                                                                                                       | High for current mechanics. Do not translate approximate counts, a short page, or no visible rows into “nothing exists.”                                  |
| Search exposes a score, not a complete explanation or correction contract.                                                         | Result cards can show `rankScore`; API docs describe static index weights. No canonical response field identifies matched terms/fields, corpus boundary, eligibility exclusions, ranking-policy version, personalization input, sponsorship state, or a reason/correction action.                                                                                                                                                                                                                                                                                                                                                                                                 | High for the inspected response and UI. Absence is not proof that no operational metadata exists outside the repository.                                  |
| Recent delivery work strengthens search authority boundaries without creating a discovery policy.                                  | Merged PR [#716](https://github.com/lopugit/thingtime/pull/716) lets shared actions resolve authorized schema dependencies while retaining their declared account and ACL search scope. It proves an important capability boundary, not relevance, fairness, or user comprehension.                                                                                                                                                                                                                                                                                                                                                                                               | High for the merged change. Recheck exact deployed behavior before relying on it.                                                                         |
| Search and Commander continue to evolve.                                                                                           | PRs [#659](https://github.com/lopugit/thingtime/pull/659), [#701](https://github.com/lopugit/thingtime/pull/701), and [#757](https://github.com/lopugit/thingtime/pull/757) were open during this snapshot. Open work is evidence, not shipped behavior. GitHub returned no open issue whose title named search, Commander, discovery, or ranking.                                                                                                                                                                                                                                                                                                                                | High for 2026-09-10 only. Refresh head, base, checks, merge status, and live behavior before implementation.                                              |
| External guidance supports data minimisation, understandable ordering, control, and accessible search structure.                   | W3C's [Privacy Principles](https://www.w3.org/TR/privacy-principles/) covers minimisation, purpose limitation, transparency, and user control. The EU [Digital Services Act, Article 27](https://eur-lex.europa.eu/eli/reg/2022/2065) is a useful design reference for explaining recommender parameters and available choices. W3C's [search landmark example](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/search.html) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) inform structure, labels, status, and error handling. Apple's [Search documentation](https://developer.apple.com/documentation/swiftui/search) highlights suggestions and explicit scopes. | High as design input. Applicability and conformance require qualified review and complete-journey evidence.                                               |

## Vocabulary that must stay separate

| Term           | Proposed meaning                                                                             | Must not silently mean                                                        |
| -------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Query          | The person's explicit request, filters, scope, and sort for one search.                      | A durable preference, training signal, public interest, or consent to retain. |
| Corpus         | The content families and audience-visible records eligible before matching.                  | Every Thing in storage or everything the account could ever access.           |
| Candidate      | A record inside the bounded retrieval window.                                                | A visible result or qualified recommendation.                                 |
| Match          | A record satisfies the declared text/structured rule.                                        | Accurate, useful, safe, endorsed, or trustworthy.                             |
| Rank           | The deterministic relative order under one named policy and request.                         | Universal relevance, popularity, quality, or importance.                      |
| Presentation   | The sections, labels, snippets, counts, and order shown to this viewer.                      | Proof that a person noticed or agreed with the result.                        |
| Recommendation | Content proactively selected from inferred or declared interests.                            | A synonym for direct query matching.                                          |
| Promotion      | Consideration or placement influenced by payment or another explicit commercial arrangement. | Organic relevance or platform endorsement.                                    |
| Trust evidence | Scoped provenance, review, moderation, or safety context from its owning contract.           | Factual truth, identity proof, authority, or ranking privilege.               |
| Answer         | A synthesized claim intended to resolve a question.                                          | An ordinary search result or a claim guaranteed by its sources.               |

## Strengths to preserve

- **Authority is evaluated on the server.** Client filters cannot expand the
  viewer's or app's audience.
- **The grammar is expressive but constrained.** Structured search can remain
  powerful without accepting arbitrary database syntax.
- **Private state paints optimistically.** Account-scoped cached results avoid
  a blank reload while fresh work remains user-triggered.
- **Approximation is partially honest.** Capped counts and ranked state appear
  in the response instead of pretending every result set is exact.
- **People discovery has a narrow projection.** It avoids email lookup and the
  generic endpoint does not expose the user Thing partition.
- **Search-by-schema reuses canonical schema metadata.** It does not invent a
  second field vocabulary for the builder.

## Gaps that block accountable discovery

1. **No common search receipt.** Scope, corpus, ordering policy, bounds,
   approximation, and privacy behavior are spread across code and docs.
2. **A number stands in for explanation.** A query-relative score does not say
   which visible fields matched or what else affected position.
3. **Multi-rail semantics are inconsistent.** Things, people, subspaces,
   schemas, components, local paths, and apps use different eligibility and
   sorting rules without one comparison boundary.
4. **URL privacy is implicit.** The UI writes plain query text into location
   state without an approved public/private query classification or retention
   explanation.
5. **Local cache lifecycle is incomplete.** Account scoping is strong, but
   expiry, sign-out cleanup, endpoint changes, shared-device behavior, and
   private result invalidation need an explicit contract.
6. **Search state and search learning are not separated in product language.**
   Querying, saving a query, restoring a prior view, and training a recommender
   need distinct consent and storage rules.
7. **Fair ordering boundaries are not registered.** There is no canonical
   declaration of whether payment, popularity, relationship, moderation,
   provenance, recency, or personalization may influence each surface.
8. **Unknown and bounded states need clearer recovery.** Empty, exhausted,
   filtered, inaccessible, approximate, stale, offline, rate-limited, and
   failed results should not collapse into one blank state.
9. **Language assumptions are embedded in the index.** English stemming and
   field weighting precede an approved multilingual search contract.
10. **No complete-journey evaluation exists.** Current tests prove important
    mechanics, not that people understand scope, ordering, privacy, errors, and
    corrections across keyboard, touch, assistive, locale, and slow-network
    profiles.

## Candidate first pilot

Use one private adult test account with a dedicated synthetic schema and a
small fixed set of synthetic Things. Let the owner choose the corpus, enter a
text or structured query, choose `relevance` or `newest`, inspect a plain
request summary and deterministic “why matched” evidence, revise the query,
and clear the local snapshot.

The pilot uses POST, keeps query text out of the URL, creates no server search
history, performs no recommender training, and excludes public content, people,
subspaces, apps, creators, advertising, sponsorship, AI-generated answers,
minors, institutions, sensitive domains, and real private material. Saved or
restorable searches remain under [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md)
and require an explicit save action.

## Candidate measures without attention surveillance

| Measure                | Candidate definition                                                                           | Guardrail                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Find-task success      | Participants find the known synthetic target or correctly conclude it is outside scope.        | No click-through, dwell, scrolling, or query-volume target.         |
| Scope comprehension    | Participants can state which corpus and audience were searched.                                | Do not expose hidden-result counts or access-control reasons.       |
| Ordering comprehension | Participants distinguish match, rank, recency, recommendation, promotion, and trust.           | Explanations come from the active policy, not generated rationales. |
| Revision success       | A person can change scope/filter/sort and predict the direction of change.                     | No covert learning from revisions or abandoned queries.             |
| Privacy fidelity       | Query, result, cache, logs, and retention match the approved no-history contract.              | Synthetic fixtures only until operational logging is verified.      |
| Accessibility          | Search, result status, explanations, errors, and clear controls work across approved profiles. | No hover-only meaning, focus theft, or color-only rank/scope state. |

## Privacy, security, fairness, and accessibility boundaries

- Treat query text, filters, result sets, and clicks as potentially sensitive.
  Do not place them in analytics, traces, support captures, or training by
  default.
- Keep search authorization independent of ranking. A score, payment,
  popularity, relationship, schema, or app declaration cannot widen access.
- Never reveal that hidden content matched, why it was excluded, another
  person's private behavior, or a sensitive inferred trait.
- Keep direct retrieval, recommendation, promotion, moderation, provenance,
  and AI answers visibly distinct and independently disableable where relevant.
- Register every ranking input and tie-breaker. Default direct search to
  deterministic non-personalized rules; separately approve any learning.
- Sponsored placement, if ever considered, must be labeled, segregated from
  organic ordering, excluded from trust/safety decisions, and unable to buy
  access or suppress an eligible organic result.
- Use exact, current projections for snippets. Do not index or display fields
  whose audience, deletion, moderation, or correction state no longer permits
  them.
- Make scope, sort, approximation, empty/error state, and explanations
  programmatically determinable. Preserve input and safe last-known state when
  refresh fails without presenting stale results as current.
- Test misspellings, long and mixed-script text, RTL, emoji, assistive input,
  keyboard/touch order, zoom/reflow, reduced motion, slow/offline behavior, and
  stale-response races before widening the pilot.

## Open decisions

1. Which single private corpus and synthetic fixture set should anchor the
   first pilot?
2. Which request fields are always visible to the person, and which response
   fields constitute the minimum useful search receipt?
3. When, if ever, may query text enter a shareable URL, local history, saved
   Thing, support artifact, or operational log?
4. What does “why matched” show when the underlying database score cannot
   safely expose field-level contributions?
5. Which sort and tie-break policies are approved for Things, people,
   subspaces, schemas, components, apps, and local paths?
6. How do language choice, stemming, tokenization, emoji, and exact matching
   behave without inferring a person's language or identity?
7. Who owns relevance defects, privacy incidents, ranking abuse, accessibility,
   commercial separation, correction, and stop authority?
8. Which expansion requires qualified legal, safety, fairness, child-safety, or
   domain review?

## Refresh checklist

- Re-read SearchPage, Commander/quick-switcher search, the things and people
  routes/utilities, schema/component/subspace browse paths, Mongo indexes,
  projections, rate limits, API docs, capability manifest, caches, and tests.
- Re-query open and merged search/Commander PRs and issues; inspect exact
  deployed behavior before changing a status claim.
- Verify logging, URL/referrer, cache, deletion, and endpoint-switch behavior
  in the real target environment before making a privacy promise.
- Recheck external design references and qualified-review needs before public,
  personalized, commercial, child, institutional, or high-impact discovery.
- Record approved authority, storage, retention, ranking, and commercial forks
  in [`DECISIONS.md`](../DECISIONS.md), not by rewriting this evidence snapshot.
