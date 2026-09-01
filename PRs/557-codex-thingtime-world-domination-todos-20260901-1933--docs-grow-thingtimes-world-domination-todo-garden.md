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
