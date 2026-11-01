# Youth safety and age-appropriate agency baseline

**Status:** Evidence note; no implementation, participant recruitment, or legal conclusion is authorized

**Grounded:** 2026-09-14, Australia/Melbourne, against `origin/develop@503216c5a962a68feadd4416e2a45e5c073cf88c`

**Plan:** [Youth safety and age-appropriate agency roadmap](../PLAN/youth-safety-and-age-appropriate-agency-roadmap.md)

**Execution epic:** [TODO 45 — Youth safety and age-appropriate agency](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)

## Why preserve this note

Thingtime's plans repeatedly exclude minors from first pilots, but that caution
has no single product owner or product-wide contract. One merchandise-oriented
terms surface mentions age 16 and guardian consent, while canonical account
registration accepts username, password, and email without an age decision.
Birthday is optional profile data with a separate private sharing purpose, not
an eligibility gate. Moderation can classify sexual content involving minors,
but a classifier is not a child-rights, eligibility, safeguarding, support, or
remedy system.

This note prevents those fragments from becoming a false assurance. It proposes
an adult-reviewed, synthetic policy-and-surface audit only. It does not decide
which laws apply, establish a minimum age, prove guardian authority, repurpose
birthday, recruit minors, or authorize identity collection, age inference,
engineering, instrumentation, or production rollout.

## Evidence ledger

| Claim                                                                      | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                       | Confidence and refresh trigger                                                                                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A terms surface contains an age statement.                                 | [`ThingtimeDefaults.tsx`](../remix/app/Providers/Thingtime/ThingtimeDefaults.tsx) says acceptance confirms age 16 or older and, under 18, guardian consent. The same text describes merchandise purchases at `merch.thingtime.com` through TeePublic, so its applicability to Thingtime accounts is ambiguous.                                                                                                         | High for text; qualified review must determine scope before it is treated as product policy.                                          |
| Canonical public registration does not collect or enforce age.             | [`Register.tsx`](../remix/app/components/Login/Register.tsx) submits username, password, and email. [`registerUser.ts`](../remix/app/api/utils/auth/registerUser.ts) validates those inputs and creates the account through the canonical path without an age or guardian field.                                                                                                                                       | High for this repository snapshot; recheck every account, invite, service-account, OAuth, and recovery entry point before a decision. |
| Birthday has a narrow privacy purpose.                                     | [`birthday.ts`](../remix/app/api/utils/auth/birthday.ts) stores an optional calendar date in the encrypted secure blob and exposes it only to the owner or exact `profile.birthday` OAuth scope. [`SettingsContent.tsx`](../remix/app/components/Settings/SettingsContent.tsx) presents it after signup as private optional profile data.                                                                              | High; do not silently change purpose, access, retention, correction, or deletion semantics.                                           |
| Public profiles exclude birthday.                                          | [`apiDocs.ts`](../remix/app/docs/apiDocs.ts) documents exact-scope birthday disclosure and excludes it from public projections.                                                                                                                                                                                                                                                                                        | High for the documented contract; verify route tests before implementation.                                                           |
| Safety moderation includes a severe child-harm category.                   | The moderation vocabulary includes `sexual/minors`; [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md) separately owns reports, cases, appeals, remedies, and accountable moderation.                                                                                                                                                                                                    | Medium for coverage: category presence does not prove prevention, response quality, or child-appropriate support.                     |
| Australian safety guidance favors safety built into design.                | eSafety's [Safety by Design](https://www.esafety.gov.au/industry/safety-by-design) centers provider responsibility, user empowerment and autonomy, and transparency and accountability.                                                                                                                                                                                                                                | High as current Australian guidance; applicability and implementation need qualified review.                                          |
| Australian children's privacy policy is evolving.                          | OAIC's [Children's Online Privacy Code](https://www.oaic.gov.au/privacy/privacy-for-kids/privacy-for-kids-childrens-online-privacy-code) page describes a 2026 draft consultation and a code still under development.                                                                                                                                                                                                  | High as a dated policy signal, not settled legal requirements; refresh before every gate.                                             |
| International references support age-appropriate, rights-based assessment. | The UK ICO [Children's Code resources](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/additional-resources/) and UNICEF's [child-rights impact-assessment report](https://www.unicef.org/reports/CRIA-responsibletech) provide structured design and assessment inputs. | Useful references only; jurisdiction, evidence quality, and Thingtime applicability need qualified review.                            |

## Narrow vocabulary

| Term                           | Proposed meaning                                                                                   | Must not imply                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Account eligibility            | Approved rule for who may create, hold, or use an account in an exact context.                     | That a terms sentence or checkbox enforces the rule.                  |
| Age band                       | Coarse, purpose-bound category needed for one approved decision.                                   | Exact birthday, identity, maturity, or legal status.                  |
| Age assurance                  | Proportionate evidence process chosen for a defined risk and context.                              | Certainty, universal identity, or permission to retain documents.     |
| Guardian involvement           | Reviewed role, authority, information, choices, and withdrawal path.                               | That self-attestation proves identity, authority, consent, or safety. |
| Child-facing feature           | Surface reasonably expected to be used by a child under the approved scope.                        | That labels or intended audience prevent child access.                |
| Protective default             | Least-exposing usable starting state for an approved age band.                                     | A substitute for comprehension, control, support, or remedy.          |
| Child-rights impact assessment | Versioned assessment of rights, benefits, harms, mitigations, evidence, owners, and residual risk. | A one-time compliance badge or legal conclusion.                      |

## Gaps and risks

1. Product eligibility, terms scope, enforcement, and exception paths do not form
   one versioned decision.
2. Registration, invitation, OAuth, public content, chat, AI, recording, sharing,
   commerce, deletion, and support have no common age-band matrix.
3. Optional birthday cannot be assumed necessary, accurate, current, or suitable
   for eligibility.
4. There is no approved age-assurance proportionality or data-minimization rule.
5. Guardian involvement lacks authority, information, withdrawal, conflict,
   privacy, and emergency boundaries.
6. Current safety, privacy, accessibility, explanation, stopping, and remedy
   plans exclude minors rather than define child-appropriate behavior.
7. No qualified owner is accountable for changes in law, guidance, product
   reach, or evidence.

The main failure modes are false assurance, overcollection of identity data,
covert age inference, guardian theatre, exposing a young person's private state
to adults, exclusion without accessible remedy, unsafe contact or discovery,
age-inappropriate nudges, weak crisis/support routes, vendor leakage, and an
adult-only claim that is not consistently enforced.

## Smallest honest first study

Use adult product, privacy, safety, accessibility, and support reviewers with
synthetic personas representing ages 15, 16, 17, and 18. Map registration,
invites, login/recovery, settings, OAuth disclosure, public content, search,
relationships, chat, AI, recording, commerce, export/deletion, reporting, and
support. Produce one versioned eligibility-and-surface matrix, an evidence gap
list, and a recommended interim posture.

No real child accounts, child content, direct child research, production
instrumentation, document collection, biometric inference, external vendor, or
automated enforcement is permitted. Until qualified owners approve otherwise,
do not recruit minors into product pilots and do not claim the product is
designed for, safe for, or verified to exclude children.

## Owner decisions

1. What exact Thingtime services and jurisdictions are in scope?
2. What interim eligibility posture applies consistently across every entry path?
3. Which features are reasonably likely to be accessed by children?
4. Is any age assurance necessary, proportionate, accessible, and privacy preserving?
5. What may be collected, for which purpose, for how long, and by whom?
6. What is the guardian role, and how are authority, disagreement, withdrawal, and safety handled?
7. Which protective defaults, explanations, controls, support, escalation, and remedies are required by age band?
8. What qualified review, evidence, incident ownership, stop authority, and refresh cadence are mandatory?

## Refresh triggers

Refresh this baseline before implementation, minor-inclusive research, a
child-facing claim, new jurisdiction, materially changed registration or
profile data, new communication/discovery/AI/recording/commerce capability, or
any change to the OAIC code or other selected regulatory guidance.
