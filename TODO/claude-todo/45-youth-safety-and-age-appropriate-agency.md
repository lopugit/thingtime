# 45 — Youth safety and age-appropriate agency

**Status:** 🟣 Proposed · owner and qualified review needed

**Evidence:** [Youth safety and age-appropriate agency baseline](../../NOTES/youth-safety-and-age-appropriate-agency-baseline.md)

**Plan:** [Youth safety and age-appropriate agency roadmap](../../PLAN/youth-safety-and-age-appropriate-agency-roadmap.md)

## Goal

Create one coherent product contract for who may use Thingtime and how every
in-scope surface protects a young person's rights, privacy, agency, safety,
accessibility, support, and remedy.

The first work is an adult-reviewed synthetic audit, not implementation. This
TODO does not establish a legal requirement, minimum age, age-assurance method,
guardian authority, or permission to recruit minors, collect identity evidence,
repurpose birthday, infer age, instrument production, or ship a child-facing
experience.

## Dependencies and boundaries

- [TODO 47](./47-support-agency-and-accountable-remedy.md) may provide shared
  help and handoff infrastructure only after this TODO's qualified owners
  approve age-appropriate discovery, privacy, guardian, urgent, and remedy
  boundaries. The general support queue cannot infer age or bypass them.

- [ ] Preserve [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md): protected API paths,
      ACLs, versioned storage, schema validation, quotas, and explicit authority
      remain mandatory.
- [ ] [TODO 22](./22-trustworthy-adoption-loop.md) owns adoption outcomes and
      measurement; no pilot includes minors until this contract is approved.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns export, deletion,
      closure, and independently verified exit.
- [ ] [TODO 24](./24-attention-agency-and-calm-use.md) owns attention and
      notification-pressure controls.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
      complete-journey access and language foundations.
- [ ] [TODO 49](./49-personalization-agency-and-accountable-memory.md) remains
      adult-only until this TODO's qualified owners approve any youth memory,
      inference, profiling, explanation, forgetting, or reset boundary.
- [ ] [TODO 26](./26-community-safety-and-accountable-moderation.md) owns
      reports, cases, moderation, appeals, remedies, and safety transparency;
      it is not an age-assurance system.
- [ ] [TODO 33](./33-ai-agency-and-accountable-assistance.md), [TODO 35](./35-identity-agency-and-context-safe-presence.md),
      [TODO 37](./37-notification-agency-and-accountable-delivery.md), and
      [TODO 39](./39-recording-agency-and-intimate-data-stewardship.md) retain
      their authority boundaries; this epic does not weaken them.
- [ ] Record approved eligibility, data-purpose, guardian, protection,
      capability, retention, deletion, or jurisdiction decisions in
      `DECISIONS.md`.

## Phase 0 — Approve scope and ownership

- [ ] Name product, child-safety, privacy, legal, security, accessibility,
      moderation, support, data, and incident owners with backups.
- [ ] Approve service and jurisdiction scope, vocabulary, evidence standard,
      refresh cadence, hard-zero failures, and manual stop authority.
- [ ] Inventory every current age, family, guardian, and child-safety claim and
      classify its product scope and enforcement status.
- [ ] Keep product pilots adult-only and freeze new child-facing claims.

No unchecked item above is permission to engineer, collect data, evaluate a
vendor, or recruit participants.

## Phase 1 — Produce the synthetic policy matrix

- [ ] Map registration, invites, OAuth, service accounts, login/recovery,
      account switching, and direct access paths.
- [ ] Map settings, public content, search/discovery, relationships, chat, AI,
      recording, commerce, export/deletion, reports, and support for synthetic
      ages 15, 16, 17, and 18.
- [ ] Inventory each age-adjacent datum and its purpose, necessity, accuracy,
      readers, recipients, retention, correction, deletion, and incident path.
- [ ] Run a qualified child-rights impact assessment and threat model.
- [ ] Mark unknown or inconsistent cells blocked rather than inventing defaults.

## Phase 2 — Decide the interim posture

- [ ] Compare consistently enforced adult-only access, approved age-banded
      access, and non-launch in an unresolved jurisdiction.
- [ ] Assess likely child access, benefits, rights and harms, proportionality,
      exclusion, accessibility, guardian role, support capacity, and residual
      risk for each option.
- [ ] Approve one posture and align terms, entry paths, exceptions, recovery,
      deletion, support, and incidents.
- [ ] Decide whether any age assurance is necessary; approve no method or
      vendor merely because it is available.
- [ ] Decide whether existing birthday remains optional profile data; any new
      purpose requires a separate approved contract and migration.

## Phase 3 — Specify protective behavior

- [ ] Define privacy, audience, contact, discoverability, recommendations,
      notification, time-pressure, purchase, AI, recording, and external-sharing
      defaults for each approved age band.
- [ ] Define accessible explanation, choice, correction, challenge, withdrawal,
      block/report, urgent-help, escalation, and remedy paths.
- [ ] Define guardian information, authority, disagreement, withdrawal, and
      disclosure separately from the young person's controls and privacy.
- [ ] Specify reversible rollout, migration, deletion, support, and incident
      handling before code.
- [ ] Update route, docs, capability registry, client requirements, and tests
      together for every changed external API contract.

## Phase 4 — Prove the contract without minors

- [ ] Use adult specialists, synthetic data, deterministic fixtures, and
      non-production environments only.
- [ ] Test every direct and indirect entry path, older client, stale session,
      account switch, locale, assistive technology, narrow viewport, failure,
      appeal, withdrawal, deletion, and support path.
- [ ] Prove protective defaults cannot be bypassed across routes and no private
      age or guardian state leaks across account, app, public, vendor, or log
      boundaries.
- [ ] Delete every fixture and publish bounded, redacted evidence and limits.
- [ ] Require two passing exact-release runs and fresh qualified sign-off.

## Acceptance criteria

- [ ] One approved posture applies consistently to every in-scope entry path.
- [ ] Every age-adjacent datum has an approved necessary purpose and complete
      access, retention, correction, deletion, and incident contract.
- [ ] Optional birthday is not silently used as eligibility evidence.
- [ ] Guardian involvement never becomes assumed authority or unrestricted
      access to a young person's private state.
- [ ] Protective defaults, explanations, choices, support, stopping, and
      remedies are accessible and testable by approved synthetic age band.
- [ ] Direct URLs, stale clients, account switches, and failures cannot bypass
      the posture or expose protected state.
- [ ] API manifests, documentation, clients, tests, browser behavior, and
      qualified evidence agree at the exact release.
- [ ] All fixtures are deleted and residual risks are explicit.

## Stop conditions

Stop for ambiguous eligibility; false enforcement or safety claims; covert age
inference; excessive or repurposed data; guardian theatre; unsafe contact or
discovery; age-inappropriate persuasion; missing support or remedy;
inaccessible denial; cross-scope disclosure; incomplete deletion; a severe
incident; stale qualified review; or evidence narrower than the claim.

## Explicit non-goals

- No real minors, child accounts, child content, participatory child research,
  production experiment, behavioral analytics, or public child-safety claim.
- No default collection of birthday, identity documents, biometrics, contacts,
  device graph, location, behavior, or inferred age.
- No assumption that a date field, checkbox, ID vendor, guardian assertion,
  authentication, moderation model, or legal text proves age or safety.
- No advertising, profiling, persuasion, commerce, public discovery, AI,
  recording, institution, health, education, or high-impact expansion.

## First decision packet

Approve or revise scope, interim eligibility posture, likely-child-access
assessment, data and age-assurance boundaries, guardian role, protective
defaults, support/remedies, qualified reviewers, evidence thresholds, refresh
triggers, and manual stop authority.
