# Change agency and humane product evolution baseline

**Status:** Evidence note; no product change, rollout, feature flag, user
research, telemetry, deprecation, sunset, or production experiment is authorized

**Grounded:** 2026-09-15 evening, Australia/Melbourne, against
`origin/develop@6b88d199ad4daff3842b58e6d02b727a3e0cc84b`

**Plan:** [Change agency and humane product evolution roadmap](../PLAN/change-agency-and-humane-product-evolution-roadmap.md)

**Execution epic:** [TODO 48 — Change agency and humane product evolution](../TODO/claude-todo/48-change-agency-and-humane-product-evolution.md)

## Why preserve this note

Thingtime changes quickly and already records several parts of change well:
internal changelogs, exact-commit previews, semantic API capability versions,
storage migration rules, historical-state plans, notifications, and support
remedies. Those parts answer different questions. Together they still do not
give a person one dependable answer to: what is changing, why, when, which
parts of my experience or data are affected, what remains the same, whether I
can preview or defer it, how long old paths will work, and what happens if the
change is inaccessible, harmful, or wrong for me.

That missing layer is not a veto on improvement or a promise that every old
interface lives forever. It is a humane transition contract. It keeps surprise
proportional to risk, preserves established capabilities and data, makes
meaningful choices real, supports accessible relearning, and requires an
accountable path through rollback, compatibility, migration, retirement, or
exit.

## Evidence ledger

| Claim                                                                                                                | Current evidence                                                                                                                                                                                                                                                                                                                                                  | Confidence and refresh trigger                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Thingtime has a detailed engineering change record, not a person-facing change contract.                             | `remix/CHANGELOG.md` records implementation and delivery changes with dates and PR links. It does not define affected-person discovery, preview, deferral, relearning, compatibility windows, sunset notice, or transition remedy across the product.                                                                                                             | High for the inspected file; refresh if a public change centre or shared change policy is added.                            |
| Exact-build previews can support review, but deployment proof is not informed adoption.                              | The PR preview workflow and cumulative delivery receipts bind a preview and checks to an exact commit. They prove an inspectable build exists; they do not prove an affected person saw, understood, chose, or could recover from its changes.                                                                                                                    | High for current delivery infrastructure; refresh when preview access or release governance changes.                        |
| API capability SemVer provides machine compatibility evidence only.                                                  | `remix/app/api/utils/capabilities/capabilityContract.ts`, `thingtimeCapabilities.ts`, and their tests negotiate origin-scoped feature versions and reject missing or breaking majors. They do not cover navigation, terminology, defaults, visual hierarchy, policy meaning, or other person-facing changes.                                                      | High for current code; refresh whenever the capability registry or client requirements change.                              |
| Storage continuity is already a separate P0 invariant.                                                               | [TODO 24](../TODO/claude-todo/24-migration-safe-continuous-availability.md) requires expand/coexist/migrate/verify/contract so pending storage work never blocks established reads and writes. This baseline depends on that rule and does not replace its technical ownership.                                                                                   | High for the planning contract; refresh when TODO 24 or the migration architecture changes.                                 |
| Historical experience restoration is planned but not a product-change lifecycle.                                     | [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md) proposes revisiting captured searches, feeds, routes, and view state. A historical snapshot may help recovery, but it does not announce a product change, preserve an old contract, authorize a rollback, or define a sunset.                                                                   | High for the current TODO; refresh if the history feature ships or changes scope.                                           |
| Developer-app updates and retirement have dedicated ownership.                                                       | [TODO 27](../TODO/claude-todo/27-trusted-developer-ecosystem.md) covers immutable third-party app releases, permission and compatibility diffs, re-consent, quarantine, transfer, abandonment, and retirement. Product-wide change agency must not silently become app review or token authority.                                                                 | High for the planning boundary; refresh when the ecosystem lifecycle changes.                                               |
| No open issue or PR currently names a shared deprecation, sunset, feature-flag, rollback, or change-notice contract. | Targeted GitHub searches on 2026-09-15 returned no open issue or PR title/body result for those terms. Absence from those searches does not prove that no partial implementation or private plan exists.                                                                                                                                                          | Medium; refresh before implementation and when issue/PR state changes.                                                      |
| Predictable operation requires warning before a control causes an unexpected context change.                         | W3C's [Understanding Success Criterion 3.2.2: On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input) explains that people should be advised before changing a control causes a change of context, because unexpected context changes can be disorienting.                                                                                                | Strong accessibility design input, not a Thingtime conformance claim. Refresh if normative or explanatory guidance changes. |
| Retiring a service should preserve the user need, explain the transition, protect data, and allow lead time.         | The GOV.UK Service Manual's [Retiring your service](https://www.gov.uk/service-manual/agile-delivery/retiring-your-service) asks teams to consider how needs will still be met, tell people what changes and why, explain required action and data handling, support assisted channels, preserve redirects, and give API users time to adapt.                     | Useful service-design input; Thingtime is not claiming GOV.UK compliance. Refresh if the guidance changes.                  |
| Deprecation and loss of availability are distinct machine-readable states.                                           | [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html) defines a `Deprecation` header and documentation link while stating that deprecation itself does not change resource behavior. [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html) defines a separate `Sunset` timestamp for expected unavailability and treats it as a hint rather than a guarantee. | Strong protocol vocabulary for APIs; it does not by itself establish adequate human notice, compatibility, or remedy.       |

## Narrow vocabulary

| Term                 | Proposed meaning                                                                                                            | Must not imply                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Change proposal      | A versioned description of a possible product, policy, interface, default, capability, or lifecycle change before adoption. | Approval, release, inevitability, or permission to test on people.                                     |
| Affected contract    | The exact user task, meaning, data, permission, route, integration, accessibility pattern, or expectation that may differ.  | That a file diff or feature name captures every consequence.                                           |
| Impact map           | A bounded list of affected people, surfaces, clients, data, dependencies, risks, owners, evidence, and unknowns.            | Profiling individuals or claiming an exhaustive census without evidence.                               |
| Preview              | A non-production, version-bound representation of the proposed experience and its important states.                         | Production equivalence, accessibility, safety, comprehension, or successful migration.                 |
| Adoption choice      | An approved choice such as keep current for now, adopt now, schedule, or leave, with visible effects and limits.            | That every security fix, legal requirement, or shared protocol can be optional forever.                |
| Compatibility window | The measured period during which declared old and new paths remain supported together.                                      | A guarantee beyond scope, capacity, evidence, or the stated end condition.                             |
| Deprecation          | Notice that a path is still usable but is no longer preferred and may change or be retired under an approved plan.          | Immediate breakage, removal, or permission to neglect support.                                         |
| Sunset               | The approved point or condition after which a path is expected to become unavailable.                                       | That a date alone proves safe retirement or relieves transition duties.                                |
| Rollback             | A controlled return to a previously approved product version or behavior after a change fails its gates.                    | Reversing user data, resurrecting revoked authority, or erasing events created under the newer state.  |
| Transition remedy    | A domain-authorized correction, compatible path, assistance, restore, export, or other response to change-related harm.     | A generic support team inventing rights or overriding security, safety, legal, data, or domain owners. |

## Gaps and risks

1. A changelog can describe implementation while an affected person still meets
   a surprising default, moved control, renamed concept, lost path, or changed
   meaning with no advance context.
2. Treating every change as mandatory creates learned helplessness; pretending
   every change is optional creates false choice and unsafe fragmentation.
3. Feature flags can become hidden, indefinite policy forks with different
   rights, accessibility, safety, or data behavior for otherwise similar people.
4. Adoption, deferral, dismissal, error, and rollback can be misread as approval,
   comprehension, preference, success, or lack of harm.
5. Compatibility layers can preserve old syntax while silently changing
   semantics, permissions, data shape, ordering, privacy, or side effects.
6. Notices can be inaccessible, mistimed, repetitive, coercive, absent from
   stale/offline clients, or delivered through a channel that reveals private
   context.
7. A changed default can override a deliberate prior choice or make the least
   surprising path require more effort than adoption.
8. Rollback may restore code but leave incompatible data, queued work, caches,
   permissions, notifications, or third-party effects behind.
9. Retirement can strand old links, assistive workflows, custom origins,
   integrations, exports, or records needed to understand what happened.
10. Change metrics can become release velocity, adoption pressure, dismissal
    reduction, or engagement optimization rather than evidence of task
    continuity, comprehension, and remedy.

## Smallest honest first study

Use adult internal reviewers, synthetic data, one exact non-production build,
and one reversible, low-risk change: rename and relocate one non-sensitive
display preference while preserving its stored value and its effect.

Create a version-bound change packet and impact map. Show an accessible old/new
comparison, what is unchanged, the stored-value mapping, a plain reason, the
compatibility window, and **keep current for now**, **adopt now**, and **decide
later** only if owners approve those choices as real. Exercise direct and stale
links, keyboard and screen-reader paths, narrow layouts, reduced motion,
offline/stale clients, account switching, interrupted adoption, duplicate
submission, new-build failure, rollback, re-entry, and complete fixture cleanup.

The study does not release the rename, collect telemetry, contact users, change
permissions or data meaning, retire the old path, or prove that the method is
suitable for security, safety, legal, youth, money, identity, health,
institutional, or high-impact changes. A reviewer action is not treated as
consent to future changes or proof of product value.

## Owner decisions

1. Which change families require only release notes, which require notice,
   preview, choice, re-consent, compatibility, qualified review, or prohibition?
2. Who owns the affected contract, impact map, accessibility/language review,
   security/privacy, rollout, compatibility, support, evidence, and manual stop?
3. What counts as prior deliberate choice, established capability, material
   meaning, breaking change, urgent fix, deprecation, sunset, and safe rollback?
4. Which changes may be deferred, for how long, and what must remain available
   to people who cannot or do not adopt immediately?
5. How are old/new data, caches, queued work, links, clients, permissions,
   receipts, and external effects handled through adoption and rollback?
6. Where do notices live, how are they made accessible and language-ready, and
   how do stale/offline/custom-origin clients receive or discover them safely?
7. What evidence proves task continuity, understanding, compatibility, cleanup,
   and remedy without profiling people or optimizing coercive adoption?
8. What conditions halt, narrow, roll back, extend compatibility, or retire the
   change, and who has authority to decide?

## Refresh triggers

Refresh before any person-facing change pilot, deprecation, sunset, or
feature-flag framework; after a material UI, default, policy, data, permission,
API, client, accessibility, language, migration, incident, support, or release
process change; when a relevant issue or PR appears; and whenever the selected
W3C, GOV.UK, IETF, or qualified-domain guidance changes.
