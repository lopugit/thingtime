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
