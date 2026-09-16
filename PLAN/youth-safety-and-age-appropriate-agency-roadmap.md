# Youth safety and age-appropriate agency roadmap

**Status:** Proposed; owner and qualified child-safety, privacy, legal, accessibility, and support review required before engineering or participant recruitment

**Grounded:** 2026-09-14, Australia/Melbourne

**Evidence:** [Youth safety and age-appropriate agency baseline](../NOTES/youth-safety-and-age-appropriate-agency-baseline.md)

**Execution epic:** [TODO 45 — Youth safety and age-appropriate agency](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)

## Outcome

Establish one coherent, rights-respecting product contract for account
eligibility and age-appropriate use before any Thingtime work includes minors.
Every in-scope surface must apply the same approved posture, collect no more
data than necessary, preserve the young person's agency and privacy, provide
understandable support and remedy, and stop when evidence or authority is weak.

## Non-negotiable boundaries

- Current terms text, optional birthday, authentication, or a moderation label
  is not proof of age, guardian authority, compliance, or safety.
- Do not repurpose birthday or collect documents, biometrics, contacts,
  behavioral signals, or inferred age without a separately approved purpose,
  necessity, proportionality, retention, access, correction, deletion, and
  incident contract.
- Guardian involvement must not erase the young person's privacy, voice,
  stopping choices, or access to appropriate support and remedy.
- No real minors, production experiments, public child-safety claims, or
  automated age enforcement are authorized by this plan.
- Until a reviewed posture says otherwise, pilots remain adult-only.

## Y0 — Assign ownership and freeze claims

- Name accountable product, child-safety, privacy, legal, security,
  accessibility/language, moderation, support, data, and incident owners.
- Inventory current age, audience, family, guardian, safety, and eligibility
  statements; mark each as policy, implementation, help text, or ambiguity.
- Pause minor recruitment and child-facing claims while scope is undecided.
- Approve vocabulary, jurisdictions, evidence standard, hard-zero failures,
  manual stop authority, and refresh cadence.

**Gate:** no engineering, collection, vendor evaluation, or participant work.

## Y1 — Map eligibility and data flows

- Map every account and access entry path, including registration, invitations,
  OAuth, service accounts, recovery, and account switching.
- Map each feature's visibility, contact, discovery, sharing, AI, recording,
  commerce, export/deletion, moderation, and support effects by synthetic age
  band.
- Record every age-adjacent datum, purpose, source, accuracy limit, reader,
  recipient, retention, correction, deletion, and incident owner.
- Complete a child-rights impact assessment and threat model with qualified
  reviewers; distinguish jurisdictional requirements from chosen safeguards.

**Gate:** one versioned matrix covers every in-scope path and unresolved cells
fail closed.

## Y2 — Decide the interim product posture

- Compare at least: consistently enforced adult-only access; phased access for
  approved age bands; or no launch in an unresolved jurisdiction.
- For each option, document likely child access, benefits, rights and harms,
  assurance proportionality, exclusion and accessibility effects, guardian
  role, support capacity, residual risk, and evidence limits.
- Choose one posture and align terms, product copy, entry paths, exceptions,
  recovery, deletion, support, and incident response.
- Record the durable decision in `DECISIONS.md` only after owner approval.

**Gate:** no implementation until the posture and accountable owners are
explicitly approved.

## Y3 — Specify protective behavior before code

- Define age-band-specific defaults for privacy, audience, discoverability,
  contact, recommendations, notifications, time pressure, purchases, AI,
  recording, and data sharing.
- Define accessible explanations, choices, correction, challenge, withdrawal,
  block/report, urgent-help, escalation, and remedy paths.
- Specify guardian information and actions separately from the young person's
  information and actions; minimize disclosure in both directions.
- If an API changes, update its canonical registry, semantic capability,
  documentation, client requirement map, and compatibility tests together.
- Design reversible flags, migration, deletion, support, and incident runbooks
  before exposure.

**Gate:** trace every requirement to the matrix, owner, test, remedy, and stop
condition.

## Y4 — Validate without real minors

- Use adult specialists and synthetic 15/16/17/18 personas against deterministic
  fixtures in non-production environments.
- Test every entry path, direct URL, stale session, account switch, locale,
  assistive technology, narrow viewport, failure, appeal, withdrawal, deletion,
  and support route.
- Prove no cross-age, cross-account, guardian, vendor, public, or log disclosure.
- Verify denial is understandable and recoverable; verify protective defaults
  cannot be bypassed through another route or older client.
- Delete every fixture and publish bounded, redacted limitations.

**Gate:** all criteria pass twice at the exact release with zero severe safety,
privacy, authority, accessibility, false-assurance, or cleanup issue.

## Y5 — Separately govern any participatory research

Research involving real children requires a new proposal and qualified ethics,
safeguarding, recruitment, consent/assent, guardian, compensation, privacy,
mandatory-response, withdrawal, distress, accessibility, data-deletion, and
incident review. It must be genuinely necessary and safe; adult proxies and
synthetic evaluation come first. This roadmap does not authorize that work.

## Measures and stop conditions

Measure matrix completeness, cross-route consistency, data minimization,
protective-default fidelity, comprehension, accessible task success, support
and remedy completion, failure containment, deletion, and evidence freshness.
Do not measure engagement, vulnerability, inferred age, private content, social
graphs, or behavioral profiles.

Stop for ambiguous eligibility; an unenforced claim; covert inference;
unapproved collection or purpose change; guardian disclosure or action outside
the contract; unsafe contact/discovery; age-inappropriate persuasion; missing
support or remedy; inaccessible denial; cross-scope leakage; incomplete
deletion; severe incident; stale qualified review; or a claim broader than the
evidence.

## Expansion gates

Approve separately by jurisdiction and feature: another age band, communication
mode, public discovery, recommendations, notifications, AI, recording,
location, health, education, commerce, advertising, external app, institution,
or high-impact decision. A passing adult-only or synthetic audit never carries
authority into those contexts.

## First owner decision packet

Approve or revise service/jurisdiction scope; interim eligibility posture;
likely-child-access assessment; age-assurance and data-purpose boundaries;
guardian role; protective defaults; support/remedies; qualified reviewers;
evidence, hard-zero thresholds, refresh triggers, and manual stop authority.
