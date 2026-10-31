# 32 — Learning agency and knowledge stewardship 📚

Status: **🟣 Proposed — owner and qualified review needed**

Evidence:
[learning agency and knowledge-stewardship baseline](../../NOTES/learning-agency-and-knowledge-stewardship-baseline.md)

Roadmap:
[learning agency and knowledge-stewardship roadmap](../../PLAN/learning-agency-and-knowledge-stewardship-roadmap.md)

## What it is for

Prove one private, user-requested way to revisit an owned or saved Thing and
optionally reflect on it in the person's own words. Preserve source/version
context, privacy, calm delivery, accessibility, export, deletion, and honest
evidence boundaries without turning learning into engagement pressure,
profiling, grading, or an unsupported efficacy claim.

This epic does not authorize a course platform, school/minor use, credential,
assessment, recurring schedule, external notification, AI tutor, learner model,
institutional dashboard, or production learning analytics.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain the architecture constraints.
- [TODO 20](./20-versioned-experience-history.md) owns durable UI-state
  snapshots; do not build a second experience-history path.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns useful product outcomes and
  privacy-safe learning; opens, dwell time, and completions are not learning.
- [TODO 23](./23-data-portability-and-exit.md) owns archive, restore, deletion,
  and closure.
- [TODO 24](./24-attention-agency-and-calm-use.md) owns calm delivery,
  notification controls, and stopping points.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns complete-journey
  accessibility and locale readiness.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns blocks,
  reports, moderation, appeals, and remedies.
- [TODO 28](./28-service-continuity-and-recovery.md) owns acknowledged writes,
  recovery, and incident practice.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns source,
  revision, correction, dispute, and assertion authority.
- [TODO 30](./30-resource-conscious-reach.md) owns constrained-device/network
  and local-footprint gates.
- Qualified research, privacy/security, accessibility, safeguarding, legal,
  operations, and support review is required for the exact approved scope.

## Phase 0 — Approve one bounded pilot

- [ ] Choose the consenting-adult cohort, eligible owned/saved content family,
      language, duration, environments, sample size, exclusions, support
      capacity, stop conditions, and manual stop owner.
- [ ] Approve one-shot, in-app-only delivery as the recommended default.
- [ ] Define unchanged, materially edited, corrected, deleted, moderated,
      blocked, private, expired, and unavailable source behavior.
- [ ] Approve reflection fields, source-version evidence, retention, export,
      deletion, cache, logs, support access, and prohibited inferences.
- [ ] Approve task-success and control questions that can be answered with
      structured sessions and local-only evidence.
- [ ] Explicitly exclude recurrence, push/email, inferred topics, auto-generated
      questions, quizzes, grades, streaks, mastery, credentials, public study
      profiles, minors, schools, institutions, AI, and learning-effect claims.
- [ ] Record any accepted product or architecture fork in `DECISIONS.md`.

**Phase gate:** no implementation or participant recruitment before the packet
and accountable owners are approved.

## Phase 1 — Specify canonical private state

- [ ] Define a bounded owner-private `knowledge-revisit` intention and optional
      `knowledge-reflection` child through the canonical Things model; never
      embed an unbounded schedule, attempt, or reflection history.
- [ ] Separate saving, scheduling, delivery, opening, reflecting, completion,
      and sharing as distinct states/actions.
- [ ] Bind the intention/reflection to an authorized source reference and
      available version/correction evidence without copying revoked content.
- [ ] Define legal scheduled, due, opened, postponed, dismissed, completed,
      expired, cancelled, source-changed, and source-unavailable transitions.
- [ ] Specify idempotency, uniqueness, concurrency, retry, clock skew,
      time-zone/DST, offline, stale client, duplicate tab/worker, and account
      switching behavior.
- [ ] Keep reflection text, questions, confidence, source choices, and schedule
      history out of product analytics and operational receipts.
- [ ] Define exact delete, retention, export, account closure, local-cache
      sweep, and operator access behavior.
- [ ] Threat-model IDOR, enumeration, notification leakage, stale ACL/source
      cache, cross-account first paint, forged completion, coercive sharing,
      insider access, and sensitive-trait inference.

## Phase 2 — Register protected API contracts

- [ ] Route every read/write through Thingtime API utilities and named versioned
      collection getters; UI, scripts, tests, and workers never write Mongo
      directly.
- [ ] Give each mutation explicit auth, owner authorization, bounded body,
      field allowlist, rate limit, idempotency key, audit receipt, and stable
      failure shape.
- [ ] Re-authorize the source at read/open time. Deletion, moderation, block,
      sharing revoke, and narrowed visibility override cached source material.
- [ ] Batch-read relational children by kind; never add an N+1 reflection,
      source, author, or revision query.
- [ ] For each new or changed `/api/v1` operation, update its route file, Nitro
      import map, API docs/route registry, semantic capability feature/version,
      client requirement map, compatibility tests, and built-server manifest
      smoke together.
- [ ] Generate the origin-scoped capability manifest from the canonical
      registry and active route map without exposing user, source, schedule,
      reflection, environment, or deployment data.
- [ ] Prove unauthorized callers cannot enumerate intentions, schedules,
      reflections, source links, operational receipts, or aggregates.

## Phase 3 — Prove one-shot in-app revisit

- [ ] Add **Revisit this** only to the approved artifact family, with explicit
      privacy and in-app delivery copy.
- [ ] Let the person choose a date/interval and optional question; no prechecked
      recurrence, urgency, streak, or hidden notification channel.
- [ ] At due time show “You asked to revisit this”, “why now?”, source state,
      and open, postpone, dismiss once, edit, and delete controls.
- [ ] Render last-known safe state optimistically, then reconcile permission and
      version in the background without flashing another account's data.
- [ ] Let the person write before reveal, after reveal, or not at all. Preserve
      the distinction privately without scoring or judging the response.
- [ ] Show unchanged, changed, corrected, unavailable, and unknown source states
      honestly; never silently substitute current content for the referenced
      version.
- [ ] Prove exactly-once due-state transition and idempotent presentation across
      retries, duplicate workers/tabs, refresh, app downtime, clock changes,
      DST, offline startup, and reconnection.
- [ ] Verify keyboard, screen reader, touch, reduced motion, 200% zoom, narrow
      viewport, approved locale/time zone, slow/lossy network, and error paths.

## Phase 4 — Evaluate without private learning analytics

- [ ] Begin with facilitated sessions, participant-selected test content,
      local-only notes, accessibility evidence, and aggregate operational
      health.
- [ ] Do not collect source ids/titles, questions, reflections, answers,
      confidence, schedule, URLs, search text, device fingerprints, or
      person-level history as product analytics.
- [ ] Define denominators and exclusions for task success: schedule, understand,
      postpone/dismiss/delete, revisit, optional reflection, and source context.
- [ ] Treat completion and self-rated usefulness as experience evidence only,
      never recall, transfer, mastery, or efficacy.
- [ ] Compare approved accessibility, language, network, and device profiles
      without inferring or labelling sensitive traits.
- [ ] If server aggregates become necessary, require a separately approved
      versioned signal allowlist, purpose, owner, minimum cohort, retention,
      access, deletion, opt-out, and fail-closed stop switch.
- [ ] Record continue, revise, narrow, stop, or separately study as the explicit
      outcome, including null and adverse findings.

## Phase 5 — Consider active reflection and reusable knowledge

- [ ] Test user-authored summary, explanation, question, connection,
      correction, and answer-before-reveal patterns separately and optionally.
- [ ] Explain each interaction, allow bypass, and make no learning claim without
      a separately approved evaluation design.
- [ ] Let people compare their own reflections across authorized source
      versions while preserving corrections and private deletion.
- [ ] Keep schedule suggestions transparent and overrideable; never claim one
      universal “optimal” interval.
- [ ] Keep licence, authorship, provenance, quality review, accessibility,
      language, and educational effectiveness as separate claims with separate
      evidence and authority.
- [ ] Never infer open reuse rights from public visibility; preserve exact
      licence version and attribution obligations for approved open resources.
- [ ] Keep baseline revisit, reflection, export, and deletion tier-neutral; no
      pay-to-learn, pay-to-remember, pay-to-rank, pay-to-trust, or public scores.

## Phase 6 — Block higher-risk expansion until separately approved

- [ ] Do not send private Things or reflections to a model without distinct
      informed consent and an approved purpose, provider, data-flow, retention,
      model/version, prompt-injection, correction, and human-override contract.
- [ ] Do not present AI feedback as an assessor or source of truth.
- [ ] Before school, minor, credential, assessment, or institutional use,
      approve age/safeguarding, teacher/parent/institution authority, education
      records, accommodations, appeals, procurement, residency, and support.
- [ ] Keep institutional administration and analytics out of personal accounts
      until a least-privilege consent, visibility, retention, and deletion model
      exists.

## Acceptance criteria

- One owner-approved pilot charter states cohort, content, journey, data,
  evidence, exclusions, owners, and stop authority.
- A participant can schedule, understand, postpone, dismiss, edit, delete,
  revisit, optionally reflect, and inspect source/version context without
  coaching on the approved desktop/mobile paths.
- Saving does not silently schedule; scheduling does not silently recur;
  opening does not mark learning; reflecting does not publish or score.
- Private source/reflection data never enters another account, public
  projection, generic search/feed, logs, notification payload, analytics, or
  unauthorized operator/support view.
- Deleted, blocked, moderated, revoked, and newly private sources never reappear
  through cache or history; unavailable state remains understandable.
- API writes are authenticated, owner-authorized, bounded, rate-limited,
  idempotent, versioned, documented, capability-registered, and tested through
  the real API path.
- Duplicate/reordered delivery, stale clients, account switches, clock/DST,
  offline, dependency failure, retry, export, retention, deletion, and closure
  tests preserve exactly one canonical outcome.
- Complete-journey accessibility, locale/time-zone, narrow viewport, touch,
  keyboard, screen reader, reduced motion, 200% zoom, and constrained-network
  checks pass for the approved scope.
- Every external claim says exactly what was tested. No completion, open,
  confidence, self-rating, or engagement metric is labelled learning.

## Stop conditions

Pause new intentions and preserve owned view/export/delete/remedy paths if:

- an unsolicited, duplicate, unavoidable, or misleading reminder is delivered;
- private source/reflection content leaks or crosses an account/authority
  boundary;
- revoked content reappears through cache/history;
- people are pressured by streaks, shame, urgency, grades, or paywalls;
- learning, mastery, credential, or efficacy claims exceed the approved study;
- accessibility, language, time-zone, offline, or constrained-device paths fail;
- an AI response gains unearned authority or private data leaves scope; or
- school, minor, assessment, credential, or institutional use appears without
  its own qualified approval.

## First decision packet

1. Adult cohort and eligible owned/saved artifact family.
2. One-shot in-app schedule choices and due-card behavior.
3. Source-version, edit/correction, unavailable, cache, and authorization rules.
4. Reflection fields, privacy, retention, export, deletion, and operator access.
5. Local-only research questions and success/stop thresholds.
6. Accessibility, language, time-zone, device, and network profiles.
7. Product, research, privacy/security, accessibility, operations, support, and
   manual stop owners.
8. Written exclusions for recurrence, external notifications, AI, minors,
   schools, institutions, assessment, credentials, and efficacy claims.
