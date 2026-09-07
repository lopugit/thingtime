# 33 — AI agency and accountable assistance

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[AI agency and accountable-assistance baseline](../../NOTES/ai-agency-and-accountable-assistance-baseline.md)

**Plan:**
[AI agency and accountable-assistance roadmap](../../PLAN/ai-agency-and-accountable-assistance-roadmap.md)

## Objective

Turn Lopu's existing chat, model/provider choice, tools, confirmation tokens,
and tool cards into one bounded assistance contract that keeps people informed,
in control, and able to correct or remedy outcomes. Begin only with one private,
previewable, reversible draft journey for consenting adults.

## Required owner decisions before implementation

- [ ] Approve one private draft outcome, adult cohort, eligible content scope,
      language, environments, duration, participant support, and stop authority.
- [ ] Approve a complete inventory of model inputs, provider routes, tools,
      capabilities, targets, side effects, confirmation predicates, receipts,
      undo paths, stores, caches, logs, and operator access.
- [ ] Approve risk tiers and their allow, preview, confirm, stronger-review, and
      prohibit rules.
- [ ] Approve context-receipt categories, default exclusions, no-history
      behavior, provider/model disclosure, and the non-AI alternative.
- [ ] Approve receipt fields, retention, export, deletion, support access, and
      evidence minimization.
- [ ] Approve outcome measures, accessibility/language/network profiles,
      incident triggers, accountable owners, and the claims the pilot may make.
- [ ] Explicitly exclude public or external actions, bulk/recurring/background
      work, minors, cross-account memory, and high-impact domains.

No unchecked item above is implied permission to start engineering or recruit
participants.

## Dependencies

- [ ] [TODO 23](./23-data-portability-and-exit.md) defines complete export,
      retention, selective deletion, closure, and verified exit.
- [ ] [TODO 24](./24-attention-agency-and-calm-use.md) defines calm defaults,
      stopping points, explanations, correction, and notification agency.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) supplies
      complete-journey accessibility and locale foundations.
- [ ] [TODO 26](./26-community-safety-and-accountable-moderation.md) owns
      reporting, moderation, appeals, and community-harm remedies.
- [ ] [TODO 27](./27-trusted-developer-ecosystem.md) owns declared, versioned,
      reviewed tool and app capabilities and incident recovery.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns acknowledged
      writes, safe degradation, restore proof, and incident operations.
- [ ] [TODO 29](./29-content-provenance-and-correction-integrity.md) owns source,
      derivation, revision, correction, dispute, and claim authority.
- [ ] [TODO 30](./30-resource-conscious-reach.md) owns constrained-device and
      network behavior plus honest resource evidence.
- [ ] [TODO 32](./32-learning-agency-and-knowledge-stewardship.md) keeps
      learning evidence and AI tutoring separately gated.
- [ ] Name product, AI safety, privacy/security, accessibility, legal,
      operations, support, and relevant domain owners for the approved scope.

## Phase A — Freeze the current authority surface

- [ ] Generate a reviewable registry of every Lopu tool operation with semantic
      capability ID/version, input source, required viewer/app/role authority,
      target, side effects, reversibility, limits, confirmation rule, and owner.
- [ ] Trace conversation-history selection, selected page/Thing context, system
      instructions, tool results, provider routing, persistence, caches, logs,
      analytics, support access, export, and deletion.
- [ ] Classify read, propose, private reversible mutation, public/external,
      bulk/repeated, secret-bearing, money, identity, safety, irreversible, and
      background actions.
- [ ] Preserve the current signed exact-action confirmation guarantees and add
      regression tests before changing their predicates.
- [ ] Confirm every tool validates current server-side viewer, role, app,
      resource, ACL, rate, quota, and target state at execution time.
- [ ] Record unresolved authority or lifecycle paths as blockers; do not cover
      them with prompt language or a broad confirmation.

## Phase B — Specify context and memory transparency

- [ ] Define a per-turn context receipt that names eligible conversation range,
      selected Thing/page categories, provider/model, purpose, and tool classes
      without exposing hidden prompts, credentials, or raw private content.
- [ ] Add a no-history turn and selective source exclusion before submission.
- [ ] Make the submitted context contract stable against race conditions; if
      visibility or selected context changes materially, fail or ask again.
- [ ] Separate ephemeral turn context, persisted history, future opt-in memory,
      provider processing, product analytics, support evidence, and training.
- [ ] Explain provider/model limitations and allow switching or continuing
      without AI without loss of unrelated product access.
- [ ] Define keyboard, touch, screen-reader, zoom, reduced-motion, locale,
      low-bandwidth, offline, timeout, and error behavior end to end.

## Phase C — Enforce risk-tiered action control

- [ ] Map each capability version and state transition to allow, preview,
      confirm, stronger review, or prohibit.
- [ ] Bind approvals to user, chat, purpose, capability version, target,
      material inputs, side effects, preview identity, and expiry; consume once.
- [ ] Reconfirm any material change in target, visibility, quantity, cost,
      provider/model, side effects, reversibility, or risk tier.
- [ ] Keep pilot mutations owner-private, bounded, idempotent, previewed, and
      backed by an honest inverse operation.
- [ ] Fail closed on stale previews, expired/replayed approvals, permission
      changes, tool-version mismatch, timeout, partial failure, or cancellation.
- [ ] Prohibit public sharing, external communications, payments, identity or
      access changes, moderation, secrets, bulk operations, unattended work,
      and high-impact domains in the pilot.
- [ ] Register every new or changed executable API/tool operation in the
      canonical capability registry and origin-scoped capability manifest.

## Phase D — Build bounded receipts and remedies

- [ ] Define a receipt joining intent, context categories, provider/model,
      capability version, target, preview, confirmation, result, uncertainty,
      timestamps, and remedy paths.
- [ ] Persist bounded identifiers and facts, not credentials, hidden prompts,
      full private content, or unrestricted internal traces.
- [ ] Represent proposed, confirmed, started, succeeded, partially succeeded,
      failed, cancelled, reversed, and externally pending states honestly.
- [ ] Implement and test review and inverse operations for the approved private
      mutation; disclose residual effects and cases where undo is impossible.
- [ ] Link report, dispute, correction, restore, delete, export, and human
      support to accountable owners and service objectives.
- [ ] Test that deletion, moderation, block, visibility changes, account
      closure, and provider failure do not resurrect or leak private context.

## Phase E — Validate before participants

- [ ] Add unit and integration coverage for authorization, prompt injection,
      context exclusion, no-history, confirmation binding, replay, race,
      escalation, stale preview, partial failure, cancellation, and retry.
- [ ] Assert every assistant operation and active API route appears in the
      capability manifest; compatible versions pass and missing/breaking
      versions fail closed.
- [ ] Exercise actual preview, mutation, receipt, review, undo, report, export,
      and deletion paths using synthetic or authorized non-sensitive data.
- [ ] Test complete journeys at approved desktop/mobile sizes and with keyboard,
      touch, screen reader, zoom/reflow, reduced motion, locale, slow network,
      offline transition, and recovery.
- [ ] Verify logs, metrics, traces, errors, notification payloads, support tools,
      and receipts contain no credentials or unapproved private content.
- [ ] Run adversarial cases for retrieved instructions, conflicting tool output,
      model overclaiming, repeated pressure, denied actions, and provider/model
      changes.

## Phase F — Run and evaluate the narrow pilot

- [ ] Obtain explicit participation consent, explain AI involvement and limits,
      provide withdrawal and deletion, and demonstrate the non-AI path.
- [ ] Keep all outcomes private and all mutations within the approved reversible
      draft boundary.
- [ ] Measure task completion, participant understanding, correction,
      cancellation, reversal, accessibility, privacy/safety incidents, support
      load, latency, and failure using only approved evidence.
- [ ] Do not use message count, time, token count, acceptance, or autonomous
      action count as success measures.
- [ ] Review failures and affected-person remedies before aggregate reporting.
- [ ] Publish only bounded claims that state cohort, task, version, conditions,
      exclusions, failures, guardrails, limitations, owner, and refresh date.
- [ ] Delete or retain pilot evidence exactly as approved and record completion.

## Acceptance criteria

- [ ] A person can identify AI involvement, provider/model, context categories,
      purpose, tool classes, and relevant limitations before submission.
- [ ] A person can exclude an eligible source, use no-history, cancel, switch,
      or continue without AI without losing unrelated access.
- [ ] Server-side checks prevent the model from expanding current authority.
- [ ] The pilot action cannot become public, external, bulk, irreversible,
      secret-bearing, high-impact, or unattended through stale state or replay.
- [ ] Preview, approval, target, material inputs, execution, receipt, and undo
      refer to the same versioned action.
- [ ] Failed, partial, cancelled, denied, and reversed outcomes are legible and
      never described as successful.
- [ ] Review, correction, undo, report, export, deletion, restore, and support
      paths complete within their approved boundaries.
- [ ] Complete-journey accessibility, language, privacy, safety, constrained
      network/device, incident, recovery, and capability-manifest checks pass.
- [ ] Evaluation distinguishes usefulness from factuality, authorization,
      safety, privacy, accessibility, resource use, and comprehension.
- [ ] No participant, provider, model, or aggregate result expands the approved
      claims or future scope automatically.

## Stop conditions

Pause intake and disable the narrowest affected capability if any of these
occurs:

- unauthorized context access, authority escalation, secret exposure, or
  cross-account leakage;
- a public, external, bulk, irreversible, high-impact, or unattended action
  escapes the pilot boundary;
- a stale preview, changed target, replayed approval, denied action, or model
  request executes anyway;
- the interface hides AI involvement, context, authority, material uncertainty,
  failure, or remedy;
- correction, undo, deletion, restore, reporting, export, or support cannot
  complete within the approved objective;
- a critical control fails for an approved accessibility, language, device, or
  network profile; or
- accountable owners cannot investigate incidents and sustain safe review.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, cleanup, and accountable owner
approval.

## Explicit non-goals

- No assistant impersonation, sentience, emotional dependency, manipulation,
  hidden persuasion, or guaranteed accuracy/safety claims.
- No public auto-publishing, external messaging, purchases, identity changes,
  moderation decisions, or background autonomous execution.
- No cross-account memory, inferred sensitive traits, training on private data,
  or exposure of hidden prompts and credentials.
- No minors, schools, credentials, institutional analytics, or health, legal,
  financial, employment, eligibility, crisis, safety, or other high-impact use.
- No replacement of qualified human judgment, appeal, support, or remedy with
  model output.
- No architecture decision until the owner approves the decision packet.
