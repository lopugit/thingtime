# PR 557 — Grow Thingtime's world-domination TODO garden

Branch: `codex/thingtime-world-domination-todos-20260901-1933` → `develop`

PR: <https://github.com/lopugit/thingtime/pull/557>

## Why this PR stays open

This is the durable research and planning branch for Thingtime's long-horizon
product garden. Each automation run adds one evidence-backed theme in the
required sequence:

1. current-state evidence in `NOTES/`;
2. an implementation roadmap in `PLAN/`;
3. a concrete, acceptance-testable item in `TODO/claude-todo/`;
4. links from the relevant indexes and adjacent plans.

The branch is intentionally cumulative. It does not merge itself, implement
the product work, or treat a plausible idea as an approved decision.

## 2026-09-02 — attention agency and calm use

This run audits how feeds, ranking, training signals, notifications, and
digests affect user attention. It adds:

- `NOTES/attention-agency-baseline.md`, a source-linked current-state audit;
- `PLAN/attention-agency-roadmap.md`, a staged delivery and decision plan;
- `TODO/claude-todo/24-attention-agency-and-calm-use.md`, the implementation
  backlog with explicit acceptance criteria, gates, measures, risks, and stop
  conditions.

The proposal keeps Latest chronological and non-training, makes continuation
and ranking user-controlled, introduces negative feedback and deterministic
“Why this?” explanations, defines calm notification defaults and quiet hours,
and rejects raw attention surveillance as a success metric.

It connects to TODO 22's trustworthy-adoption work and TODO 10's delight and
growth ideas without redefining retention or dwell time as product goals.

## Verification for the 2026-09-02 run

- all new local Markdown links resolve;
- all three core documents have non-empty, content-matching semantic hashes in
  the selected immutable Graphify snapshot;
- Graphify CAS tests pass 15/15;
- Graphify hooks and the `graphify-out/graph.json` union merge driver are
  installed;
- graph diagnostics report no missing or dangling endpoints, self-loops,
  exact duplicate edges, or same-endpoint edge collapses;
- `git diff --check` passes.

The final CI, CodeQL, and Vercel preview state is recorded in the PR body for
the exact pushed head rather than frozen here, because those receipts change
with every garden update.

## 2026-09-02 — accessibility and language readiness

This run records the difference between useful local affordances and a
release-level access contract. It adds:

- `NOTES/accessibility-and-language-readiness-baseline.md`, a dated evidence
  ledger covering the static English shell, existing motion/focus/announcement
  work, missing owned audit/i18n commands, privacy boundaries, and open
  decisions;
- `PLAN/accessibility-and-language-readiness-roadmap.md`, a gated sequence from
  complete-journey baseline through shared interaction repair, one canonical
  locale path, a human-reviewed pilot language, and continuous quality;
- `TODO/claude-todo/25-accessibility-and-language-readiness.md`, an
  implementation-ready epic with owners, dependencies, phases, security/
  privacy safeguards, acceptance criteria, and a first decision packet.

The proposal recommends considering WCAG 2.2 AA for explicitly approved core
web journeys, without making a conformance claim until the complete evidence
pack exists. It separates UI locale, authored-content language, and optional
translation; private user content never leaves Thingtime for translation or
auditing without a separately approved contract.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO
indexes, plus the ethical-adoption baseline, trustworthy-adoption roadmap, and
TODO 22 dependency list. It does not implement UI, install audit tooling,
translate copy, or change settings/API behavior.

Validation and exact-head CI/preview receipts for this run are recorded in the
PR body after publication.

## 2026-09-03 — trusted developer ecosystem

This run connects Thingtime's registered-app identity, origin-bound OAuth,
explicit consent scopes, revocation layers, user-owned app data, sandbox,
self-documenting API, semantic capability manifest, bounded actions, and
ChatGPT plugin handoff to a missing general distribution lifecycle. It adds:

- `NOTES/trusted-developer-ecosystem-baseline.md`, a dated evidence ledger with
  current strengths, compatibility debt, release/review/incident gaps, external
  standards, measures, risks, and owner questions;
- `PLAN/trusted-developer-ecosystem-roadmap.md`, a gated path from one app
  declaration and no-secrets conformance kit through immutable releases,
  reproducible review receipts, consentful updates, narrow containment,
  remediation, appeal, fair discovery, and aligned developer services;
- `TODO/claude-todo/27-trusted-developer-ecosystem.md`, an implementation epic
  with owners, dependencies, phases, security/privacy/accessibility boundaries,
  acceptance criteria, and a concrete first decision packet.

The proposal keeps declarations and review evidence separate from runtime
authority. It rejects score-only approval, inherited trust for changed child
artifacts, silent permission expansion, pay-to-rank/pay-to-trust, private
source or grant analytics, and suspension paths that strand owner data. No app,
OAuth, scope, token, storage, review, marketplace, or API behavior changed.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO
indexes, plus the ethical-adoption evidence, trustworthy-adoption roadmap, and
TODO 22 dependency list. Validation and exact-head CI/preview receipts for this
run are recorded in the PR body after publication.

## 2026-09-03 — community safety and accountable moderation

This run connects Thingtime's existing community roles, invite controls,
message-request buckets, chat mute, and automated content-moderation queue to a
missing user-centered safety contract. It adds:

- `NOTES/community-safety-and-accountable-moderation-baseline.md`, a dated
  evidence ledger distinguishing shipped controls from missing account block,
  user report, case, scoped moderator, appeal, and transparency paths;
- `PLAN/community-safety-and-accountable-moderation-roadmap.md`, a gated path
  from immediate quiet control through report integrity, community governance,
  reasoned decisions, appeals, remedies, operations, and aggregate transparency;
- `TODO/claude-todo/26-community-safety-and-accountable-moderation.md`, the
  implementation epic with owner decisions, security/privacy boundaries,
  capability-manifest requirements, acceptance criteria, and stop conditions.

The proposal keeps personal controls, community governance, platform policy,
automated assistance, and legal/urgent processes as separate authority layers.
It explicitly rejects report-count guilt, private-message surveillance,
indefinite evidence retention, and model-only durable sanctions. External
safety/regulatory material is used as design input, not a compliance claim.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO indexes,
plus the ethical-adoption evidence, trustworthy-adoption roadmap, and TODO 22.
The Claude TODO index also clarifies that full filenames are canonical because
parallel work has produced duplicate numeric prefixes. No product behavior,
policy, moderation setting, API, or data schema changed.

Validation and exact-head CI/preview receipts for this run are recorded in the
PR body after publication.

## 2026-09-04 — service continuity and recovery

This run separates Thingtime's useful point-in-time health signals from proof
that critical user journeys remain available, durable, and recoverable through
dependency failure. It adds:

- `NOTES/service-continuity-and-recovery-baseline.md`, a dated evidence ledger
  covering frontend, Nitro, MongoDB, migration-readiness, deployment, timeout,
  backup/restore, incident, dependency, and recovery-objective boundaries;
- `PLAN/service-continuity-and-recovery-roadmap.md`, a gated path from critical
  journey definitions and service objectives through truthful degraded modes,
  restore drills, incident operations, dependency exercises, and sustainable
  release gates;
- `TODO/claude-todo/28-service-continuity-and-recovery.md`, an implementation
  epic with owner decisions, dependencies, security/privacy/accessibility
  safeguards, acceptance criteria, stop conditions, and a first decision
  packet.

The proposal treats health checks, CI, and deployments as evidence inputs, not
availability claims. It requires acknowledged writes to have a durable and
observable outcome, keeps migration compatibility under TODO 24, makes backup
existence insufficient without restore proof, and keeps incident communication
factual, privacy-safe, accessible, and owned. No runtime, API, schema,
deployment, alert, backup, or production behavior changed.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO
indexes, plus the ethical-adoption evidence, trustworthy-adoption roadmap, and
TODO 22 dependency list. Validation and exact-head CI/preview receipts for this
run are recorded in the PR body after publication.

## 2026-09-04 — content provenance and correction integrity

This run separates account-bound authorship and current timestamps from the
stronger evidence people need to understand edits, source claims, derivation,
platform assistance, corrections, and disputes. It adds:

- `NOTES/content-provenance-and-correction-baseline.md`, a dated evidence ledger
  covering current post projection and edit behavior, terminology, assertion
  authority, privacy boundaries, abuse cases, interoperability references, and
  open owner questions;
- `PLAN/content-provenance-and-correction-roadmap.md`, a gated path from honest
  public edit state through protected relational revision evidence, source and
  derivation context, bounded platform observations, one C2PA media pilot,
  corrections, disputes, reuse, export, and operational proof;
- `TODO/claude-todo/29-content-provenance-and-correction-integrity.md`, an
  implementation epic with dependencies, API capability-manifest obligations,
  security/privacy/accessibility safeguards, acceptance criteria, stop
  conditions, and a concrete first decision packet.

The proposal rejects universal truth badges, AI-detector guesses, hidden
prompt/source disclosure, retroactive revision mutation, and authority gained
from unsigned user claims. Absence or stripping of provenance remains unknown,
while corrections and disputes remain distinct from moderation and deletion.
No runtime, API, schema, storage, media, moderation, or production behavior
changed.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO
indexes, plus the ethical-adoption evidence, trustworthy-adoption roadmap, and
TODO 22 dependency list. Validation and exact-head CI/preview receipts for this
run are recorded in the PR body after publication.

## 2026-09-05 — resource-conscious reach

This run separates shipped point optimizations from a complete promise that
Thingtime remains useful on constrained devices and networks. It adds:

- `NOTES/resource-conscious-reach-baseline.md`, a dated evidence ledger covering
  route splitting, immutable assets, lazy media, opt-in offline audio, exact
  byte ledgers, missing journey budgets, privacy boundaries, and external
  sustainability guidance;
- `PLAN/resource-conscious-reach-roadmap.md`, a gated path from owner-approved
  journeys and reproducible lab fixtures through client/media/offline/backend
  budgets, honest environmental evidence, and continuous release checks;
- `TODO/claude-todo/30-resource-conscious-reach.md`, an implementation epic
  with dependencies, API capability-manifest obligations, security/privacy
  invariants, acceptance criteria, stop conditions, and a first decision packet.

The proposal keeps complete meaning, accessibility, safety, permissions,
durable write truth, and deletion above byte or speed scores. It rejects device
fingerprinting, punitive data-saver tiers, hidden offline authority, private
media transformation outside the protected attachment path, and environmental
marketing without current physical evidence and uncertainty. No runtime, API,
schema, storage, media, infrastructure, telemetry, or production behavior
changed.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO indexes,
plus the ethical-adoption evidence, trustworthy-adoption roadmap, and TODO 22
dependency list. Validation and exact-head CI/preview receipts for this run are
recorded in the PR body after publication.

## 2026-09-05 — retire the orphaned duplicate of TODO 21

`chore(lopu): apply repository review improvements` (`d2ec2abf`, 2026-08-29)
renumbered the index-budget epic from 20 to 21 by adding
`TODO/claude-todo/21-index-budget-consolidation.md` and repointing the Claude
TODO index at it, but it never removed the original
`TODO/claude-todo/20-index-budget-consolidation.md`. The two files were
identical from line 2 onward — only the `# 20 —`/`# 21 —` heading differed —
and the leftover 20 had no inbound reference anywhere in the repository, so it
was an unindexed duplicate that a reader could reach only by listing the
directory and would then have no way to tell was superseded.

This run deletes the orphan. `21-index-budget-consolidation.md` keeps the
content verbatim and remains the single indexed entry. The removal upholds the
rule this PR writes into `AI_ALL.md` — the tree indexes are the entry points,
not the individual files — and is the concrete case behind this PR's earlier
note that historical numeric prefixes can repeat, so a full filename and link
is canonical rather than a number. No other TODO, NOTES, PLAN, or runtime
content changed.

## 2026-09-05 — creator sustainability and fair value

This run distinguishes subscription-tier and marketplace price metadata from a
real creator value-exchange contract. It adds:

- `NOTES/creator-sustainability-and-fair-value-baseline.md`, a dated evidence
  ledger covering current tier/quota and marketplace primitives, missing role
  and transaction contracts, provider responsibilities, consumer remedies,
  privacy, creator safety, and a deliberately narrow pilot boundary;
- `PLAN/creator-sustainability-and-fair-value-roadmap.md`, a gated path from one
  responsibility charter through provider-neutral product truth, synthetic
  proof, one test-mode payment rail, a bounded invited pilot, and separately
  approved future capabilities; and
- `TODO/claude-todo/31-creator-sustainability-and-fair-value.md`, an
  implementation epic with dependencies, protected API and capability-manifest
  obligations, provider-event invariants, accessibility/privacy/fairness gates,
  acceptance criteria, stop conditions, and a concrete first decision packet.

The proposal requires roles before rails and keeps provider events as evidence
rather than canonical authority. It rejects paid reach, paid trust, public
earnings by default, hidden recurrence, callback-granted entitlements, and
commerce paths that weaken safety, accessibility, portability, or remedies. It
recommends only a fixed-price, non-recurring digital artifact as the first
candidate; even that waits for owner and qualified legal, tax, privacy,
financial-risk, accessibility, and operational review.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO
indexes, plus the ethical-adoption evidence, trustworthy-adoption roadmap, and
TODO 22 dependency list. No runtime, API, schema, provider, payment, entitlement,
marketplace, telemetry, or production behavior changed.

## 2026-09-06 — learning agency and knowledge stewardship

This run separates knowledge storage, saves, anniversary resurfacing, course or
certificate presentation, and proposed experience history from an honest
learning contract. It adds:

- `NOTES/learning-agency-and-knowledge-stewardship-baseline.md`, a dated
  evidence ledger covering current knowledge surfaces, private saved-post and
  “On this day” primitives, source/version dependencies, learning-science
  references, reflection privacy, claim limits, and a bounded adult pilot;
- `PLAN/learning-agency-and-knowledge-stewardship-roadmap.md`, a gated path from
  a learning-agency charter through canonical private state, one-shot in-app
  revisit, surveillance-free evaluation, optional active reflection, reusable
  knowledge stewardship, and separately approved AI or institutional use; and
- `TODO/claude-todo/32-learning-agency-and-knowledge-stewardship.md`, an
  implementation epic with dependencies, protected API and capability-manifest
  obligations, source-authorization and scheduling invariants, complete-journey
  acceptance criteria, stop conditions, and a first decision packet.

The recommended first experiment is intentionally small: a consenting adult
asks to revisit one owned or currently visible saved Thing at a chosen time,
receives one quiet in-app card explaining “You asked to revisit this”, and may
write a private reflection before or after revealing the authorized source.
Saving does not schedule, opening does not prove learning, and reflection does
not grade or publish. The proposal excludes recurrence, external notifications,
inferred topics, generated questions, streaks, mastery, schools, minors,
credentials, institutional analytics, AI tutoring, and efficacy claims.

The new theme is linked from the NOTES, PLAN, main TODO, and Claude TODO indexes,
plus the ethical-adoption evidence, trustworthy-adoption roadmap, and TODO 22
dependency list. No runtime, API, schema, worker, scheduler, notification,
analytics, course, certificate, AI, or production behavior changed.
