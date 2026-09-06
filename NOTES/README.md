# Thingtime notes

`NOTES/` preserves evidence, observations, questions, and design thinking that
should inform work without pretending the work has been committed to. Turn a
note into a phased strategy in [`../PLAN/`](../PLAN/README.md), then create an
actionable item in [`../TODO/`](../TODO/TODO.md) when it is ready to execute.

## Index

| Note                                                                                                              | Purpose                                                                                                                                                 | Last grounded |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| [Ethical adoption baseline](./ethical-adoption-baseline.md)                                                       | Current product and delivery evidence, adoption gaps, privacy boundaries, and open questions                                                            | 2026-09-01    |
| [Data portability and graceful-exit baseline](./data-portability-and-exit-baseline.md)                            | Evidence behind Thingtime's no-lock-in promise, current API gaps, archive/deletion boundaries, and open decisions                                       | 2026-09-01    |
| [Attention agency and calm-use baseline](./attention-agency-baseline.md)                                          | Evidence on feed continuation, passive algorithm training, correction/explanation gaps, notification defaults, and calm-use decisions                   | 2026-09-02    |
| [Accessibility and language-readiness baseline](./accessibility-and-language-readiness-baseline.md)               | Evidence on shared interaction affordances, release-wide accessibility gaps, static English semantics, locale ownership, and privacy boundaries         | 2026-09-02    |
| [Community safety and accountable moderation baseline](./community-safety-and-accountable-moderation-baseline.md) | Evidence on community roles, personal controls, automated moderation, missing report/appeal contracts, privacy, and accountable governance              | 2026-09-03    |
| [Trusted developer ecosystem baseline](./trusted-developer-ecosystem-baseline.md)                                 | Evidence on app identity, OAuth consent, user-owned app data, capability negotiation, release/review gaps, incidents, and sustainable distribution      | 2026-09-03    |
| [Service continuity and recovery baseline](./service-continuity-and-recovery-baseline.md)                         | Evidence on health signals, dependency failure, degraded operation, backup/restore proof, incident ownership, and recovery objectives                   | 2026-09-04    |
| [Content provenance and correction baseline](./content-provenance-and-correction-baseline.md)                     | Evidence on authorship, edits, source assertions, derivation, verification limits, corrections, disputes, privacy, and interoperability                 | 2026-09-04    |
| [Resource-conscious reach baseline](./resource-conscious-reach-baseline.md)                                       | Evidence on constrained-device and low-bandwidth journeys, delivery/media/offline primitives, resource budgets, privacy, and environmental-claim limits | 2026-09-05    |
| [Creator sustainability and fair-value baseline](./creator-sustainability-and-fair-value-baseline.md)             | Evidence on tiers, marketplace metadata, payment-role gaps, product truth, privacy, remedies, creator safety, and fair value exchange                   | 2026-09-05    |
| [Learning agency and knowledge-stewardship baseline](./learning-agency-and-knowledge-stewardship-baseline.md)     | Evidence on knowledge surfaces, private saves, calm resurfacing, source versions, learning claims, reflection privacy, and a bounded adult pilot        | 2026-09-06    |
| [AI agency and accountable-assistance baseline](./ai-agency-and-accountable-assistance-baseline.md)               | Evidence on Lopu context, models/providers, tools, confirmations, receipts, memory boundaries, remedies, and one private draft pilot                    | 2026-09-06    |

## Conventions

- Separate confirmed repository or live-service evidence from hypotheses.
- Date snapshots and name the command, file, issue, PR, or route that supports a
  claim. Link to source material when it can be shared safely.
- Never copy credentials, private user data, raw analytics payloads, or
  security-sensitive exploit detail into a note.
- Give every time-sensitive claim a refresh trigger. An open PR, CI run, or
  production behavior can change after the note is written.
- Prefer questions and competing explanations over invented certainty.
