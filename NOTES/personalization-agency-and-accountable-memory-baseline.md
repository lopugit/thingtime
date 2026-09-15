# Personalization agency and accountable-memory baseline

Last grounded: 2026-09-16

Status: evidence note; not an approved product decision

## Question

What would Thingtime need to make every durable memory about a person
inspectable, explainable, correctable, excludable, expirable, forgettable, and
resettable without pretending that a cache, conversation, profile, or inferred
pattern is harmless merely because it is useful?

## Working vocabulary

| Term                   | Meaning in this note                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Personalization memory | A retained fact, choice, observation, or derivative that may change a person's future experience            |
| Explicit choice        | A person-authored setting or preference with a stated effect                                                |
| Observation            | A recorded interaction or event, distinct from what the system infers from it                               |
| Derivative             | A label, score, profile, summary, embedding, or other conclusion produced from inputs                       |
| Effect                 | A product decision or presentation influenced by a memory item                                              |
| Forget                 | Remove the item and declared derivatives from future use, subject to an explicit lawful or safety exception |
| Reset                  | Return one scope to a stated non-personalized baseline without deleting unrelated account content           |

These terms are proposals for review, not implementation facts.

## Repository evidence

### Explicit preferences and local state already exist

- `remix/app/hooks/localCache.ts` stores feature-scoped, stamped local values
  under `tt-<domain>` namespaces. It supports exact or prefix clearing and
  bounded entries, while quota failures may be intentionally silent.
- `remix/app/components/AI/useSavedAiWaterfalls.ts` combines a user-id-scoped
  browser cache with account API state for explicitly named AI configurations.
- `Thingtime.LopuChatDefaults` is an admin-owned settings singleton. It is not
  evidence that an affected person chose or can inspect a personal preference.

These are useful primitives, but they do not form one inventory explaining why
an item is remembered, where it lives, how long it remains, or what it changes.

### Behavioral adaptation exists in a bounded domain

- `useFeedEngagement.ts` records bounded events such as view, dwell, expand,
  react, comment, and share only when an active feed algorithm is present.
- The feed algorithm utilities support named, private, branchable interest
  profiles and a protected active pointer.

This is evidence of domain-specific care, not a product-wide memory contract.
The repository does not establish a shared view covering explicit choices,
observations, inferred derivatives, their effects, and their cleanup together.

### Conversation history is not durable consent

The AI-agency work distinguishes per-turn context and tool authority from
durable memory. A prior conversation, accessible transcript, or helpful model
response does not by itself authorize future profiling, training, or continued
personalization.

## External design anchors

- [W3C Privacy Principles](https://www.w3.org/TR/privacy-principles/) supports
  purpose clarity, data minimization, user agency, and understandable controls.
- [W3C Personalization Semantics requirements](https://www.w3.org/TR/2020/WD-personalization-semantics-requirements-1.0-20201028/)
  frames personalization as an accessibility opportunity while requiring
  semantics that remain understandable and user-controlled.
- [NIST Privacy Framework](https://www.nist.gov/privacy-framework/getting-started-0)
  offers a risk-management structure, not a claim that one control proves
  privacy.
- [EDPB profiling guidance](https://www.edpb.europa.eu/documents/guideline/automated-decision-making-and-profiling_en)
  is a reminder that profiling and consequential automated decisions require
  separate legal and qualified review. This note does not determine compliance.

## The gap

Thingtime has no shared, person-facing answer to these questions:

1. What is remembered about me, and was it my choice, an observation, or an
   inference?
2. What source, purpose, scope, store, age, expiry, and policy govern it?
3. Which visible or invisible product effects currently depend on it?
4. Can I correct the source without falsely rewriting a historical event?
5. Can I exclude an item from one use while retaining it for another?
6. Does forgetting propagate to derivatives, caches, indexes, and queued work?
7. What exactly remains after a domain reset or global personalization reset?
8. Can I use a stable, useful non-personalized baseline?

Without those answers, a collection of individually reasonable features can
produce an opaque model of a person.

## Boundaries with adjacent garden work

- TODO 20 owns historical experience state: what happened then. This theme
  owns the retained model that may affect what happens next.
- TODO 23 owns export, restore, deletion, and exit. It transports or removes
  data; this theme defines memory meaning and derivative lifecycle.
- TODO 24 owns feed behavior and calm use. This theme governs whether retained
  personal inputs may be used by that behavior.
- TODO 25 owns accessibility and language. An explicit access preference must
  not silently become a sensitive trait inference.
- TODO 29 owns content provenance. This theme adds provenance for memory items
  and their derivatives, not authorship claims about Things.
- TODO 33 owns per-turn AI context and tool use. Durable assistant memory needs
  a separately approved contract.
- TODO 35 owns identity and presence. An inferred profile is not identity,
  authentication, authority, or a public claim about a person.
- TODO 38 owns search, ranking, and promotion behavior. This theme governs
  retained personal inputs that those policies may consume.
- TODO 41 owns relationship transitions and graph effects.
- TODO 45 owns youth-safety qualification.
- TODO 48 owns how a changed memory policy is introduced and rolled back.

## Proposed minimum memory record

For review, every personalization memory should be representable with:

- accountable owner and stable item identifier;
- kind: explicit choice, observation, or derivative;
- source and creation time, with source-version or policy-version where useful;
- declared purpose and prohibited purposes;
- subject, account, device, workspace, feature, and audience scope;
- storage locations and sync state stated honestly;
- expiry, last-use time, and cleanup state;
- derivation inputs and downstream derivatives where applicable;
- current effects and a plain-language reason for each effect;
- correction, exclusion, forgetting, reset, appeal, and remedy paths; and
- qualified exceptions with owner, duration, and review trigger.

## Bounded first pilot

Use adult internal reviewers, one synthetic account, one synthetic private text
Thing, and one exact non-production build. Create exactly four fixed items:

1. one explicit, non-sensitive display preference;
2. one device-local last-view cache value;
3. one synthetic low-stakes observation; and
4. one deterministic, manually seeded low-stakes derivative.

Show source, purpose, scope, store, age, expiry, policy, and effect. Exercise
inspect, explain, edit, exclude, expire, forget, domain reset, global
personalization reset, account switching, device-origin change, offline and
stale states, export/import quarantine, and cleanup. Prove the declared
non-personalized baseline remains usable.

Do not use real personal data, production telemetry, model/provider calls,
training, public feeds, advertising, sensitive traits, minors, institutions,
or health, safety, employment, education, housing, credit, legal, identity, or
other high-impact decisions.

## Evaluation questions

- Can a reviewer predict each item's effect before and after every control?
- Are choice, observation, and derivative visually and semantically distinct?
- Does correction preserve historical truth while changing future effect?
- Does exclusion stop only the named use?
- Does forgetting remove all declared derivatives and bounded caches?
- Does reset have an exact scope and a reversible preview where possible?
- Are offline, stale, partial-failure, and cross-account states explicit?
- Can the team prove cleanup without collecting new production telemetry?

## Open owner decisions

- Who owns the cross-product memory vocabulary and inventory?
- Which exceptions may delay forgetting, and who approves them?
- Are derived artifacts deleted, invalidated, or recomputed after correction?
- Which effects require a contemporaneous explanation or confirmation?
- What minimum useful baseline must remain when personalization is off?
- How should import quarantine distinguish foreign preferences from trusted
  choices made in the current account?

Refresh this note when the named primitives change, a memory inventory is
implemented, a pilot is approved, or qualified privacy, accessibility, safety,
security, and domain owners resolve these questions.
