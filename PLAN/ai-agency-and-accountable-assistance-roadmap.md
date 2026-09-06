# AI agency and accountable-assistance roadmap

**Status:** Proposed

**Prepared:** 2026-09-06, Australia/Melbourne

**Evidence:**
[AI agency and accountable-assistance baseline](../NOTES/ai-agency-and-accountable-assistance-baseline.md)

**Execution epic:**
[TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md)

## Outcome

Let a person understand when AI is involved, choose and limit the context and
authority granted for one outcome, inspect important actions, correct or stop
the assistant, and obtain useful review and remedy. Prove a small private draft
journey before considering broader autonomy or higher-impact use.

## Recommended starting boundary

Start with one owner-private draft task for a small consenting-adult cohort.
Show an adjustable context receipt before the model call, restrict mutations to
previewable and reversible private changes, and show a bounded action receipt
afterwards. Provide a no-history path and a non-AI alternative.

Do not start with public publishing, external communications, payments,
identity or access changes, moderation decisions, unattended automation,
cross-account memory, minors, or health, legal, financial, education,
employment, eligibility, crisis, or safety decisions.

## Dependencies and ownership

- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns complete
  export, retention, selective deletion, account closure, and verified exit.
- [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns calm
  defaults, stopping points, explanations, correction, and notification agency.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md) owns
  complete-journey accessibility and locale foundations.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns reporting, moderation, appeals, and remedies for community harm.
- [TODO 27](../TODO/claude-todo/27-trusted-developer-ecosystem.md) owns tool and
  app declarations, versioned capabilities, review, incidents, and recovery.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  acknowledged writes, degradation, restore proof, and incident operations.
- [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
  owns source, derivation, revision, correction, dispute, and claim authority.
- [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md) owns constrained
  devices/networks and honest resource evidence.
- [TODO 32](../TODO/claude-todo/32-learning-agency-and-knowledge-stewardship.md)
  owns learning-specific evidence and keeps AI tutoring separately gated.
- Product, AI safety, privacy/security, accessibility, legal, operations,
  support, and relevant domain owners must be named for the approved scope.

## Invariants

1. AI involvement, provider/model, limitations, and available alternatives are
   legible at the moment they matter.
2. Conversation history is not durable memory, profiling consent, or blanket
   permission for future turns.
3. Model requests never expand user, role, app, ACL, billing, moderation, or
   tool authority.
4. Context and authority are purpose-bound, minimal, reviewable, revocable, and
   no broader than the selected outcome.
5. Riskier actions require stronger human control; some actions remain
   prohibited regardless of confirmation.
6. Tool completion is not outcome correctness. Receipts preserve uncertainty,
   review, correction, and remedy.
7. Using, declining, switching, pausing, or deleting AI assistance does not
   remove unrelated access or punish the person.
8. Success is a useful, understood, correctable outcome, not compliance,
   messages, minutes, tokens, or autonomous action count.

## Milestone A0 — Approve the assistance charter and risk map

**Outcome:** one low-risk outcome and one enforceable authority model exist
before new assistant data or capabilities are built.

- Choose the adult cohort, private draft outcome, eligible content, languages,
  environments, duration, support capacity, and manual stop authority.
- Inventory every current model input, provider route, tool capability,
  side-effect class, target, confirmation predicate, receipt, undo path, store,
  cache, log, and support access path.
- Define risk tiers for read, propose, private reversible mutation, public or
  external action, bulk/repeated action, secrets, money, identity, safety,
  irreversibility, and background execution.
- Map each tier to allow, preview, confirm, stronger review, and prohibit.
- Approve prohibited domains and claims, including human impersonation,
  sentience, expertise, guaranteed correctness, and hidden autonomy.
- Define owners for product truth, safety, security, accessibility, incidents,
  restoration, support, model changes, and pilot pause.

**Gate:** no new assistant tool, memory store, background runner, or pilot
recruitment until the charter, inventory, risk map, owners, and stop conditions
are approved.

## Milestone A1 — Make context and memory boundaries visible

**Outcome:** a person can understand and adjust what one turn will use before
private content leaves the product boundary.

- Specify a concise context receipt covering conversation range, selected
  Thing/page categories, provider/model, tool classes, and purpose.
- Offer no-history and selective-exclusion controls before submission without
  requiring deletion of the conversation.
- Separate ephemeral turn context, persisted chat history, optional future
  memory, provider processing, product analytics, support evidence, and model
  training as distinct contracts and choices.
- Keep hidden prompts, secrets, credentials, raw private content, and internal
  security signals out of user-visible receipts and routine logs.
- Preserve owner authorization when a referenced Thing changes visibility,
  is blocked, deleted, moderated, or becomes unavailable.
- Define accessible keyboard, touch, screen-reader, reduced-motion, zoom,
  language, and constrained-network behavior for the entire context flow.

**Gate:** participants can accurately explain what categories are sent, use a
no-history turn, exclude an eligible source, and continue without AI.

## Milestone A2 — Enforce risk-tiered capability control

**Outcome:** backend authority, not model prose, determines whether and how an
action can proceed.

- Register each tool operation with semantic capability version, risk tier,
  scope, side effects, reversibility, confirmation rule, limits, and owner.
- Validate viewer, role, app, resource, ACL, rate, quota, and state authority at
  execution time; never trust a prompt, prior tool result, or UI state.
- Bind confirmation to the exact user, chat, purpose, capability version,
  target, material inputs, disclosed side effects, and expiry; consume it once.
- Reconfirm when the target, visibility, quantity, side effects, cost, provider,
  model, or risk tier materially changes.
- Require a truthful preview for private reversible mutations. Block the pilot
  from public, external, bulk, irreversible, secret-bearing, high-impact, or
  unattended operations.
- Add capability-manifest coverage for every executable endpoint and assistant
  tool contract; test missing and incompatible versions fail closed.

**Gate:** authorization, replay, race, escalation, prompt-injection, stale
preview, denial, timeout, and partial-failure tests pass for the pilot contract.

## Milestone A3 — Produce bounded receipts and real remedies

**Outcome:** a person can inspect what happened, correct it, and reach help
without turning private content into surveillance.

- Define an action receipt linking request intent, context categories,
  provider/model, capability version, target, preview, confirmation, result,
  uncertainty, timestamps, and remedy paths.
- Store bounded identifiers and facts rather than hidden prompts, credentials,
  or full content snapshots unless the approved operation requires otherwise.
- Distinguish proposed, confirmed, started, succeeded, partially succeeded,
  failed, cancelled, reversed, and externally pending states.
- Implement and test inverse operations where truthful; state what undo cannot
  recall or repair.
- Provide report, dispute, correction, restore, delete, export, and human
  support paths with ownership and service expectations.
- Connect security, privacy, safety, model/provider, and tool incidents to the
  continuity and community-remedy plans without duplicating their ledgers.

**Gate:** synthetic and authorized test cases can reconstruct the bounded
decision path, reverse eligible changes, explain residual effects, and complete
the applicable remedy.

## Milestone A4 — Run one private assisted-creation pilot

**Outcome:** a small cohort can complete one useful private draft with agency
and guardrails intact.

- Recruit only approved consenting adults with clear withdrawal and support.
- Present provider/model, context receipt, tool boundary, limitations, and the
  non-AI route before participation.
- Keep reads explicit and mutations private, previewed, bounded, reversible,
  idempotent, and attributable to the requesting owner.
- Capture only approved aggregate or session-research evidence. Treat prompts,
  source content, drafts, corrections, and receipts as private user content.
- Measure completion, comprehension, correction, cancellation, reversal,
  accessibility, privacy incidents, support burden, latency, and failure.
- Pause on unauthorized access, misleading success claims, unremedied changes,
  inaccessible critical controls, repeated confusion, or incident overload.

**Gate:** the pilot report states cohort, exclusions, failure cases, guardrail
results, limitations, deletions, incidents, and unresolved questions without a
claim that assistance is generally safe or effective.

## Milestone A5 — Evaluate changes and contestable outcomes

**Outcome:** model, provider, prompt, tool, and policy changes cannot silently
weaken the approved contract.

- Maintain representative, adversarial, accessibility, privacy, and recovery
  scenarios tied to the approved outcome and risk map.
- Separate task quality, factuality, authorization, safety, accessibility,
  privacy, latency, resource use, and user understanding; no single score hides
  a guardrail failure.
- Version material model/provider/prompt/tool changes and rerun the required
  evaluation before rollout.
- Preserve user-visible uncertainty and correction even when benchmark scores
  improve.
- Publish only bounded claims with their population, task, version, conditions,
  limitations, owner, and refresh date.

**Gate:** every material change has evidence, rollback, incident ownership, and
an approved claim boundary before reaching the pilot cohort.

## Milestone A6 — Consider broader agency separately

**Outcome:** public, external, recurring, unattended, multi-party, or
high-impact assistance remains a new decision rather than scope creep.

- Require a fresh threat model, rights/recourse review, qualified domain review,
  evidence plan, authority design, operational capacity, and owner approval.
- Prefer human-in-the-loop control for sensitive actions and human-on-the-loop
  supervision only where monitoring, intervention, and rollback are real.
- Do not infer blanket autonomy from repeated confirmations or successful
  private drafts.
- Keep child-facing, institutional, identity, payment, moderation, crisis,
  safety, health, legal, financial, employment, education, and eligibility use
  prohibited until separately authorized and validated.

**Gate:** a durable decision records the exact new scope, evidence, owners,
controls, affected people, remedies, stop conditions, and prohibited remainder.

## Measure contract

| Question                    | Candidate evidence                                                                                        | Guardrail                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Can people control context? | Task test for viewing, excluding, and using no-history.                                                   | Do not log excluded or raw private content.           |
| Is authority understood?    | Participant explanation of preview, confirmation, target, and side effects.                               | A click alone is not comprehension.                   |
| Are changes correctable?    | Eligible undo/restoration success and residual-effect disclosure.                                         | Do not count a button render as recovery.             |
| Are outcomes useful?        | Participant-defined task completion plus correction and abandonment reasons.                              | Do not optimize acceptance or usage duration.         |
| Is the journey accessible?  | Complete-journey tests across approved assistive technology, input, zoom, language, and network profiles. | Do not substitute component checks for the journey.   |
| Do remedies work?           | Authorized report, dispute, deletion, export, restore, and support exercises.                             | Do not expose private content in operational metrics. |

## Stop conditions

Pause intake and disable the narrowest affected capability when any of these
occurs:

- unauthorized context access, authority expansion, secret exposure, or
  cross-account leakage;
- a public, external, bulk, irreversible, high-impact, or unattended action
  escapes the approved boundary;
- the product claims success without execution evidence or obscures material
  uncertainty and failure;
- confirmation replay, stale-preview execution, covert retry, or denial bypass;
- correction, undo, deletion, restore, reporting, or support cannot complete
  within its approved objective;
- critical controls fail for an approved accessibility or language profile;
- participants cannot reliably distinguish AI, context, authority, result, and
  remedy, or operating owners cannot sustain safe review.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, data cleanup, and accountable
owner approval.

## First owner decision packet

Before implementation, ask the owner to approve or revise:

1. the one private draft outcome, adult cohort, content scope, duration, and
   participant support;
2. the context receipt categories, default exclusions, no-history behavior,
   provider/model disclosure, and non-AI route;
3. the capability inventory, risk tiers, confirmation rules, prohibited actions,
   and approved inverse operations;
4. receipt fields, retention, export, deletion, provider/cache boundaries, and
   support access;
5. evaluation questions, accessibility/language/network profiles, incident
   triggers, stop authority, and accountable owners; and
6. the explicit exclusion of public, external, background, high-impact,
   institutional, child-facing, and general safety or efficacy claims.
