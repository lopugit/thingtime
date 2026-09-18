# Evidence agency and accountable product claims baseline

**Status:** Evidence note; no public claim, instrumentation, legal conclusion, or implementation is authorized

**Grounded:** 2026-09-14, Australia/Melbourne, against `origin/develop@f4ff79879f7d6aaa4fba64e86368b6545e1edf37`

**Plan:** [Evidence agency and accountable product claims roadmap](../PLAN/evidence-agency-and-accountable-product-claims-roadmap.md)

**Execution epic:** [TODO 46 — Evidence agency and accountable product claims](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md)

## Why preserve this note

Thingtime already practices claim restraint in many places. Planning notes use
evidence ledgers and refresh triggers. API capability manifests describe
machine-readable support. CI, deployment and preview receipts are fenced to an
exact commit. Individual roadmaps distinguish observed facts from intended
outcomes and repeatedly prohibit claims broader than their evidence.

Those good fragments do not yet form one product contract. A person may meet a
Thingtime claim in a README, landing page, setting, Lopu response, API document,
status surface, badge, release note, app-store listing, or support answer. There
is no shared inventory that states what each claim means, where it appears, the
exact version and conditions tested, who reviewed it, which contrary evidence
exists, when it expires, or how every copy is corrected.

This note keeps authored-content provenance separate from platform speech.
[TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
owns who contributed to a content artifact, what changed, and how its sources
or corrections are represented. This theme owns what Thingtime itself says
about the product and the evidence a person needs to assess that statement.

## Evidence ledger

| Claim                                                                      | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Confidence and refresh trigger                                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The garden uses evidence before plans and TODOs.                           | [`NOTES/README.md`](./README.md) defines notes as evidence and observations rather than commitments. The current ethical baselines include dated evidence ledgers, confidence labels, and refresh triggers.                                                                                                                                                                                                                                                                                                                                                                              | High for repository practice; refresh if planning conventions change.                                                                              |
| Machine-readable capability evidence exists but is narrowly scoped.        | [`apiDocs.ts`](../remix/app/docs/apiDocs.ts) generates an origin-scoped API capability manifest from registered endpoint documentation. Clients use semantic feature versions to decide whether an exact operation is supported.                                                                                                                                                                                                                                                                                                                                                         | High for API compatibility; a feature version is not proof of availability, usability, safety, accessibility, privacy, or outcome quality.         |
| Delivery receipts are exact-head evidence, not durable product assurance.  | The durable [PR 557 note](../PRs/557-codex-thingtime-world-domination-todos-20260901-1933--docs-grow-thingtimes-world-domination-todo-garden.md) records commit-specific CI, CodeQL, deployment, preview, and graph receipts while keeping each observation bounded to the recorded build and time.                                                                                                                                                                                                                                                                                      | High for the recorded runs only; refresh after every code, environment, dependency, data, or route change.                                         |
| Existing theme plans deliberately limit their own claims.                  | The [resource-conscious reach baseline](./resource-conscious-reach-baseline.md) rejects environmental conclusions from logical storage bytes; the [learning baseline](./learning-agency-and-knowledge-stewardship-baseline.md) rejects learning claims from activity; the [AI baseline](./ai-agency-and-accountable-assistance-baseline.md) rejects correctness claims from fluent output or tool completion; and the [youth-safety baseline](./youth-safety-and-age-appropriate-agency-baseline.md) rejects safety or exclusion claims from terms text, birthday, or moderation labels. | High for the planning boundaries; there is no shared mechanism that keeps all copies synchronized.                                                 |
| Product claims can be express, implied, visual, or incomplete.             | The ACCC's [false or misleading claims guidance](https://www.accc.gov.au/consumers/advertising-and-promotions/false-or-misleading-claims) advises current, specific, evidence-backed information, an accurate overall impression, visible limitations, updates, and corrections.                                                                                                                                                                                                                                                                                                         | Strong Australian design and review input, not a legal conclusion about any Thingtime surface. Refresh before public release and qualified review. |
| Sustainability claims need evidence and qualifications people can inspect. | The ACCC's [environmental claims guide](https://www.accc.gov.au/about-us/publications/a-guide-to-making-environmental-claims-for-business) emphasizes clear, accurate, trustworthy information and reasonable grounds for environmental and sustainability claims.                                                                                                                                                                                                                                                                                                                       | Strong design input for environmental claims; do not generalize it into a compliance badge.                                                        |
| Measurement must match the service outcome and remain current.             | The Australian Digital Transformation Agency's [Digital Service Standard 2.0 introduction](https://www.dta.gov.au/articles/one-july-updated-digital-service-standard-applies-new-services) describes a service lifecycle from early research through monitoring and evaluation, with inclusive, adaptable, and measurable outcomes.                                                                                                                                                                                                                                                      | Useful service-design guidance; Thingtime is not claiming conformance. Refresh if the standard changes.                                            |
| High-trust claims need structured argument and objective evidence.         | NIST SP 800-160 v1r1 describes [assurance cases](https://csrc.nist.gov/pubs/sp/800/160/v1/r1/final) as reasoned, auditable arguments with evidence and explicit assumptions supporting defined system claims.                                                                                                                                                                                                                                                                                                                                                                            | Useful assurance vocabulary, especially for security claims; scope and reviewer competence still matter.                                           |
| Interface design can change the meaning and effect of a claim.             | The UK Competition and Markets Authority's [online choice architecture evidence review](https://www.gov.uk/government/publications/online-choice-architecture-how-digital-design-can-harm-competition-and-consumers) treats presentation, placement, ranking, and interface design as part of the environment in which people make choices and documents potential consumer and competition harms.                                                                                                                                                                                       | Useful design input, not proof that a particular Thingtime surface is harmful or deceptive.                                                        |

## Narrow vocabulary

| Term                   | Proposed meaning                                                                                                                        | Must not imply                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Product claim          | A statement or overall impression Thingtime creates about a capability, property, outcome, policy, status, or future commitment.        | That only marketing copy counts, or that technically true words cannot mislead. |
| Claim instance         | One exact copy, visual, badge, response, or machine-readable representation at a named surface and version.                             | That editing one canonical sentence corrects every distributed copy.            |
| Evidence object        | Versioned observation, test, analysis, audit, qualified review, or external source offered in support of a bounded claim.               | Truth outside its sample, environment, method, time, or competence boundary.    |
| Claim profile          | Claim text and meaning plus audience, scope, conditions, exclusions, evidence, confidence, owner, review, expiry, and correction state. | A public database of private tests, incidents, people, or security details.     |
| Assurance case         | A structured argument connecting a higher-risk claim to relevant evidence and explicit assumptions.                                     | Certification, compliance, universal safety, or absence of unknown risk.        |
| Contradictory evidence | A credible result, incident, limitation, or changed condition that weakens or narrows the claim.                                        | Automatic public disclosure of sensitive evidence or automatic guilt.           |
| Expiry                 | The point after which the claim must be revalidated, narrowed, marked stale, or removed.                                                | That time alone makes the underlying feature fail.                              |
| Correction family      | Every known instance, derivative, translation, cache, release, or support script that must converge on the corrected meaning.           | Silent rewriting of historical records or removal of an accountable receipt.    |

## Gaps and risks

1. No registry inventories product claims across code, docs, marketing,
   assistant output, support, stores, releases, status, badges, and APIs.
2. Claim text is not bound to one meaning, audience, version, environment,
   evidence set, confidence, limitation, owner, reviewer, or expiry.
3. Green CI, a READY deployment, route existence, a capability version, a
   successful request, a local cache, or an AI tool receipt can be mistaken for
   an end-to-end user outcome.
4. Evidence can be selected after the claim, omit negative or ambiguous results,
   or remain visible after the system and conditions change.
5. Copies, translations, screenshots, app listings, cached pages, generated
   answers, and third-party descriptions can drift from a correction.
6. Higher-risk safety, security, privacy, accessibility, youth, health,
   environmental, identity, learning, and AI claims lack common qualified-review
   and stop rules.
7. A transparent registry could itself leak incidents, vulnerabilities, private
   data, unreleased work, participant details, or exploitable test fixtures.
8. Claim counts, badge completion, or test volume could become a vanity target
   rather than improve truthful understanding.

The main failure modes are technically true but materially misleading copy,
unsupported superlatives, evidence from the wrong version or environment,
stale assurances, missing limitations, cherry-picked results, implied claims
created by visuals, inaccessible qualifications, correction drift, private
evidence exposure, and treating disclosure as a substitute for fixing harm.

## Smallest honest first study

Use only adult internal reviewers and synthetic data in a non-production
preview. Inventory current claim instances, then choose one low-risk,
deterministic capability claim: **a private text Thing exported from and restored
to the exact approved build preserves the specified fields under the tested
conditions**.

Before showing the sentence, record its intended meaning, audience, exact build
and origin, fixture, method, expected and negative cases, evidence location,
limitations, owner, review date, expiry, correction family, and removal switch.
Render a local claim-details preview that lets a reviewer move from the sentence
to a content-minimal evidence summary and back. Exercise pass, fail, stale,
unavailable-evidence, narrowed, corrected, and withdrawn states; verify that a
failure removes or qualifies every preview copy; then delete all fixtures.

Do not publish the claim, collect user telemetry, expose private content, create
a generic trust badge, claim legal compliance, reuse an old deployment receipt,
or broaden the result to attachments, collaboration, other origins, other
versions, accessibility, privacy, security, sustainability, AI, safety, minors,
institutions, or high-impact contexts.

## Owner decisions

1. Which surfaces and claim families are in the first inventory?
2. Who owns the claim, evidence, qualified review, correction, incident response,
   and manual stop?
3. What claim-risk tiers require which methods and reviewer competence?
4. What exact conditions, exclusions, confidence language, and expiry are visible
   to people rather than hidden in an internal ledger?
5. How are negative, ambiguous, contradictory, unavailable, and security-sensitive
   evidence handled?
6. Which copies, translations, caches, assistants, stores, releases, and external
   channels belong to one correction family?
7. What evidence may be public, summarized, access-controlled, or withheld, and
   how is withholding explained without false assurance?
8. Which changes automatically stale or withdraw a claim?

## Refresh triggers

Refresh this baseline before any public claim pilot; after a relevant code,
model, data, dependency, infrastructure, policy, copy, visual, locale, evidence,
incident, correction, or ownership change; and whenever selected ACCC, DTA,
CMA, NIST, or qualified-domain guidance changes.
