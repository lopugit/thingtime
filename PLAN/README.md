# Thingtime plans

`PLAN/` holds strategies, sequencing, milestones, experiments, success metrics,
and contingency paths. Plans explain how several TODOs work together; they do
not replace the actionable backlog in [`../TODO/`](../TODO/TODO.md) or the
engineering decisions in [`../DECISIONS.md`](../DECISIONS.md).

## Index

| Plan | Horizon | Status |
| --- | --- | --- |
| [Trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md) | Five gated milestones from outcome definition to sustainable scale | Proposed |
| [Data portability and graceful-exit roadmap](./data-portability-and-exit-roadmap.md) | Contract approval through verified export, restore, deletion, and continuous exit drills | Proposed |
| [Attention agency and calm-use roadmap](./attention-agency-roadmap.md) | User-controlled feed continuation, algorithm learning/correction/explanation, stopping points, and notification delivery | Proposed |
| [Accessibility and language-readiness roadmap](./accessibility-and-language-readiness-roadmap.md) | Complete-journey access baseline, shared interaction repair, one locale foundation, pilot language, and continuous release gates | Proposed |

## Conventions

- Begin with an evidence note and link it.
- State outcomes, non-goals, dependencies, measurable gates, risks, and stop
  conditions.
- Separate repository facts from product hypotheses.
- Keep milestone status honest: planned, active, blocked, validated, shipped,
  or superseded.
- Promote implementation-sized work into `TODO/`; record durable architectural
  forks in `DECISIONS.md` only after the owner decides.
