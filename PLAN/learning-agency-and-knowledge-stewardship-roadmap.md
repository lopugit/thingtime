# Learning agency and knowledge-stewardship roadmap

**Status:** Proposed

**Prepared:** 2026-09-06, Australia/Melbourne

**Evidence:**
[learning agency and knowledge-stewardship baseline](../NOTES/learning-agency-and-knowledge-stewardship-baseline.md)

**Execution epic:**
[TODO 32](../TODO/claude-todo/32-learning-agency-and-knowledge-stewardship.md)

## Outcome

Let a person deliberately return to knowledge they care about, reflect in their
own words, understand which source/version they used, revise their thinking,
and leave with control intact. Prove the journey is understandable, accessible,
private, reversible, and operationally reliable before testing any learning
effect or automation.

## Recommended starting boundary

Start with one private, one-shot, in-app revisit of an owned or currently
visible saved Thing for a small consenting-adult cohort. Make the reflection
optional and private. Evaluate task success and control, not retention.

Do not start with a course platform, classroom, minor, quiz engine, mastery
model, certificate, public study profile, recurring scheduler, external
notification, AI tutor, or institutional dashboard.

## Dependencies and ownership

- [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md) owns durable
  UI-state snapshots, replay, rerun, and continuation. This roadmap references
  source context; it does not create a second experience-history store.
- [TODO 22](../TODO/claude-todo/22-trustworthy-adoption-loop.md) owns useful
  outcome definitions and privacy-safe product learning. Revisit opens and time
  spent are not adoption or learning outcomes.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns complete
  export, restore, deletion, and account closure.
- [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns calm
  delivery defaults, quiet hours, stopping points, and notification controls.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md) owns
  complete-journey accessibility and locale foundations.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns reports, blocks, moderation, appeals, and remedies for shared material.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  acknowledged writes, degraded behavior, recovery objectives, and incident
  practice.
- [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
  owns source, revision, derivation, correction, dispute, and assertion
  authority.
- [TODO 30](../TODO/claude-todo/30-resource-conscious-reach.md) owns constrained
  network/device profiles, local-footprint controls, and honest resource
  evidence.
- Product, research, privacy/security, accessibility, safeguarding, legal,
  operations, and support owners must be named for the approved scope. A
  documentation proposal does not supply qualified review.

## Invariants

1. The person chooses what to revisit, when, how, and whether to reflect.
2. Saving, scheduling, opening, reflecting, and sharing are separate actions.
3. Reflection content is private user content, never analytics by default.
4. Source identity, version, availability, and correction state remain legible.
5. A reminder delivered or opened is not a learning outcome.
6. Missing a revisit causes no penalty, shame, lost streak, or reduced access.
7. Deleted or revoked content cannot be resurrected through a cache or receipt.
8. AI output, credentials, scores, and assessments gain no authority from
   fluency, popularity, payment, or a badge.

## Milestone L0 — Approve the learning-agency charter

**Outcome:** one owner-approved question and pilot boundary exist before data
or UI design.

- Choose the adult cohort, eligible content family, language, environments,
  duration, sample size, support capacity, and manual stop authority.
- Decide whether the candidate supports owned private Things, saved public
  posts, or both.
- Approve one-shot in-app delivery as the default; document why any broader
  channel is necessary before adding it.
- Define source-version behavior for unchanged, edited, corrected, deleted,
  moderated, blocked, private, and unavailable artifacts.
- Approve field-level boundaries, retention, export, deletion, operator access,
  local cache, logs, support evidence, and prohibited inferences.
- Define evaluation questions: can people schedule, understand “why now?”,
  postpone, dismiss, delete, revisit, reflect, and find source context?
- Explicitly deny efficacy, mastery, credential, institutional, child, and AI
  claims for the pilot.

**Gate:** no schema, endpoint, notification, experiment flag, or participant
recruitment until the charter and owners are approved.

## Milestone L1 — Specify private, provider-free product truth

**Outcome:** the smallest data and interaction contract can be reviewed without
choosing a notification provider or model.

- Define a private `knowledge-revisit` intention and optional private
  `knowledge-reflection` as bounded relational Things linked by `parentId` or
  another approved canonical relation; do not embed unbounded histories.
- Keep schedule revisions and delivery attempts as bounded append-only evidence
  only if the approved operation requires them.
- Define immutable identity, owner, source reference/version, author question,
  scheduled time/zone, status, created/updated/completed time, and retention
  semantics. Keep display strings out of notification payloads by default.
- Define legal transitions for scheduled, due, opened, postponed, dismissed,
  completed, expired, cancelled, source-changed, and source-unavailable states.
- Specify idempotency, concurrency, time-zone/DST handling, stale clients,
  account switching, duplicate tabs, offline state, retries, and exact delete.
- Keep reflection text separate from operational delivery evidence and all
  aggregate product measures.
- Define an allowlisted public/export projection; private reflections are never
  public merely because their source is public.
- Threat-model IDOR, schedule enumeration, notification leakage, stale ACL
  caches, source-content resurrection, forged completion, cross-account local
  cache, coercive sharing, and operator overreach.

**Gate:** product, privacy/security, accessibility, and continuity review accept
the same state machine and source-authority boundary.

## Milestone L2 — Prove the one-shot journey without push or AI

**Outcome:** the user-controlled path works end to end in a test environment.

- Add **Revisit this** only on the approved content family, with plain-language
  privacy and delivery copy.
- Offer date/interval, optional author-written question, and in-app-only
  delivery. No preselected recurrence or urgency.
- Show a due card that says “You asked to revisit this” and supports open,
  postpone, dismiss once, edit, and delete without hiding the underlying source
  or current context.
- Preserve optimistic last-known state while reconciling source authorization
  and version in the background. Never flash another account's cached card.
- Let the person optionally write before reveal, after reveal, or not at all;
  preserve that distinction without scoring.
- Show exact current/source-version relationships: unchanged, changed with
  available history, corrected, unavailable, or unknown.
- Exercise one-shot timing around DST, clock skew, app downtime, offline use,
  retries, duplicate workers, and account switches. Delivery is idempotent.
- Add keyboard, screen-reader, touch, reduced-motion, 200% zoom, narrow viewport,
  approved locale/time-zone, and slow/lossy-network checks.

**Gate:** no recurring schedule or external notification until the complete
journey passes and participants understand control without coaching.

## Milestone L3 — Evaluate usefulness without surveillance

**Outcome:** the team can decide whether to continue without collecting private
learning content.

- Begin with facilitated sessions, participant-chosen examples, local-only
  test notes, accessibility evidence, support outcomes, and aggregate
  operational health.
- Do not collect source ids/titles, questions, reflections, answers, confidence,
  schedules, full URLs, search text, device fingerprints, or person-level
  histories as product analytics.
- If server signals are proven necessary, define a versioned allowlist with one
  purpose, owner, denominator, minimum cohort, retention, access, deletion,
  opt-out, and stop threshold for each aggregate.
- Treat completion, self-rated usefulness, and confidence as experience
  evidence only. They are not durable retention, transfer, or educational
  efficacy.
- Compare barriers and outcomes across approved accessibility, language,
  network, and device profiles without inferring sensitive traits.
- Publish an internal decision receipt: continue unchanged, revise, narrow,
  stop, or separately design an efficacy study with qualified researchers.

**Gate:** expansion requires evidence that control, accessibility, privacy,
reliability, and usefulness remain within approved bounds.

## Milestone L4 — Add active reflection carefully

**Outcome:** optional evidence-informed interactions improve the journey without
becoming grades or manipulation.

- Test user-authored answer-before-reveal, summary, explanation, connection,
  question, and correction patterns separately.
- Explain the interaction and allow bypass. Never claim a person “learned”
  because they completed it.
- Let people compare their own earlier reflections and source versions while
  preserving correction context and private deletion.
- If schedule suggestions are tested, show the assumption, let the person
  override it, and never describe it as universally optimal.
- Keep no streaks, public scores, leaderboards, punitive reminders, or paid
  efficacy tiers.
- Require a pre-registered or otherwise explicit evaluation design before any
  retention or transfer claim; record populations, materials, conditions,
  uncertainty, adverse effects, and null results.

**Gate:** a qualified research and accessibility review accepts the exact claim
and evidence boundary before any external learning-effect language.

## Milestone L5 — Steward reusable knowledge

**Outcome:** eligible creators and learners can preserve, correct, adapt, and
share knowledge without confusing licence, quality, truth, and authority.

- Build only on TODO 29's provenance/correction evidence and TODO 23's portable
  archive; do not create parallel revision or export formats.
- Keep copyright holder, asserted licence/version, source/derivation,
  accessibility metadata, language, quality review, and educational claim as
  distinct fields with distinct authorities.
- Verify any open-licence selector and attribution output against the exact
  licence terms; never infer permission from public visibility.
- Preserve accessible and offline representations where approved, including
  source files needed for lawful adaptation.
- Give creators a correction and version path that does not rewrite a learner's
  historical reflection, while revoked access and deletion remain effective.
- Keep discovery fair and free from pay-to-rank, engagement pressure, and
  learner-error profiling.

**Gate:** no “open”, “verified”, “accessible”, or “effective” badge until its
separate criteria, issuer, evidence, expiry, correction, and appeal are clear.

## Milestone L6 — Consider AI or institutional use separately

**Outcome:** higher-risk scopes remain blocked until their own authority and
safety contracts exist.

- For AI-generated questions, explanations, feedback, or summaries, require a
  documented pedagogical purpose, model/version provenance, data-flow and
  retention review, prompt-injection boundary, human override, uncertainty,
  correction, red-team cases, and fallback.
- Never send private Things or reflections to a model without separate informed
  consent and an approved provider/data contract.
- Define age, safeguarding, teacher/parent/institution authority, education
  record, accommodation, assessment, credential, appeals, procurement,
  residency, and support requirements before school or minor use.
- Keep institutional analytics and administration out of personal accounts
  until a separate consent, visibility, deletion, and least-privilege model is
  approved.
- Record each accepted architectural fork in `DECISIONS.md`; none is implied by
  completion of the adult personal pilot.

## Measurement ladder

| Level | Question | Acceptable initial evidence | Claim limit |
| --- | --- | --- | --- |
| Operation | Did the intention persist and become due once? | Deterministic API, clock, retry, and recovery tests. | Delivery reliability only. |
| Usability | Can a person understand and control the journey? | Structured sessions and complete-journey accessibility checks. | Usability for the tested scope. |
| Usefulness | Did people say the journey helped them do intended work? | Qualitative findings and bounded self-report. | Perceived usefulness, not learning. |
| Retention | Was knowledge recalled after a defined delay? | Separately approved study with appropriate comparison and analysis. | Only the tested population, material, interval, and method. |
| Transfer | Could knowledge be applied in a different context? | Separately approved authentic task and assessor contract. | No broad mastery or credential claim. |

## Stop conditions

Stop new intake, preserve owned data and remedies, and investigate when:

- reminders occur without explicit intent, duplicate, ignore quiet controls, or
  cannot be disabled/deleted;
- private source or reflection content enters logs, analytics, notification
  payloads, another account, or an unauthorized operator view;
- removed, blocked, or newly private content is revealed through cache/history;
- completion, streak, confidence, or dwell time is presented as learning;
- people feel coerced, shamed, graded, diagnosed, or unable to stop;
- accessibility, language, time-zone, offline, or constrained-device paths fail;
- an AI response is presented as authoritative or private content leaves the
  approved boundary;
- school, minor, credential, assessment, or institutional use begins without
  its own qualified review and decision.

## First decision packet

The next planning session should decide:

1. eligible adult cohort and content family;
2. one-shot in-app delivery and scheduling choices;
3. source-version and unavailable-source behavior;
4. reflection fields, retention, export, deletion, cache, and operator access;
5. local-only evaluation questions and evidence;
6. accessibility, language, time-zone, network, and device profiles;
7. accountable owners, support capacity, stop thresholds, and manual stop
   authority; and
8. explicit exclusions for recurrence, external delivery, AI, institutions,
   minors, assessment, credentials, and efficacy claims.
