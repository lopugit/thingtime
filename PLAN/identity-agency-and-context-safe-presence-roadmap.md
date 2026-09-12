# Identity agency and context-safe presence roadmap

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Identity agency and context-safe presence baseline](../NOTES/identity-agency-and-context-safe-presence-baseline.md)

**Execution epic:**
[TODO 35 — Identity agency and context-safe presence](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)

## Outcome

Let a person understand and control how they appear in each Thingtime context
without confusing authentication, identity proofing, presentation, claims,
relationships, roles, or authorization. Begin with one exact public-profile
preview; defer aliases, credentials, proofing, badges, and high-impact uses until
their separate need, threat model, governance, and evidence are approved.

## Non-goals

- A real-name policy, universal identity, government-ID collection, biometrics,
  inferred age, background checks, or identity-proofing vendor selection.
- A public “verified”, “trusted”, “official”, safety, reputation, or social-score
  badge.
- Mutable usernames, multiple personas, reusable anonymous identities, or
  cross-context identity matching in the first pilot.
- Treating a passkey, email, signature, credential, role, friend relationship,
  follower count, payment, or moderation status as proof of truth or authority.
- Anonymous group-chat implementation; [TODO 19](../TODO/claude-todo/19-anonymous-group-chats.md)
  owns that feature and its honest operator/inviter boundary.
- Minors, employment, education, health, finance, housing, insurance, civic,
  legal, safety-critical, or other sensitive/high-impact decisions.

## Operating principles

1. **Purpose before identity.** Ask which outcome needs which minimum identifier
   or claim before collecting or exposing anything.
2. **Pseudonymity is legitimate.** Do not require real-world identity where an
   authenticated pseudonymous account can safely meet the purpose.
3. **Projection is the privacy boundary.** Every audience sees one canonical,
   allowlisted server projection; UI copy cannot substitute for enforcement.
4. **Assurance layers stay separate.** Account, authenticator, proofing,
   attestation, role, and authorization each state their exact evidence and
   limits.
5. **Context boundaries resist correlation.** A context-private identity uses
   no global identifier, stable hash, reusable avatar, hidden URL, or other
   correlatable value in recipient-facing data.
6. **No badge without governance.** Every claim names its subject, issuer,
   scope, audience, status, expiry, evidence limit, correction, dispute, and
   remedy; cryptographic integrity is not truth.
7. **Recovery never silently weakens privacy.** Sensitive identity changes
   re-authenticate, invalidate stale access, notify safely, and remain
   reviewable and remediable.
8. **One reversible pilot before expansion.** New audiences, aliases, claims,
   proofing levels, or domains require fresh evidence and owner approval.

## Dependencies and ownership boundaries

- [TODO 18](../TODO/claude-todo/18-account-invite-links.md) owns consentful
  account creation. Prefill is editable suggestion, not proof or privilege.
- [TODO 19](../TODO/claude-todo/19-anonymous-group-chats.md) owns chat-local
  anonymity and its protected server-side actor mapping.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns export,
  deletion, closure, and verified exit for profiles and future claims.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md)
  owns complete-journey accessibility and locale foundations.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns block, report, investigation, appeal, remedies, and accountable access.
- [TODO 27](../TODO/claude-todo/27-trusted-developer-ecosystem.md) owns app
  identity, OAuth capabilities, publisher review, and ecosystem incidents.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  truthful writes, restore proof, degraded operation, and incidents.
- [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
  owns content assertions, revisions, sources, corrections, and disputes. An
  identity attestation cannot become a content-truth shortcut.
- [TODO 34](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md)
  owns artifact roles and contribution authority. A profile or claim grants no
  collaboration power.
- [TODO 41](../TODO/claude-todo/41-relationship-agency-and-consentful-connection.md)
  owns follow/friend states, relationship effects, public/private graph
  boundaries, stopping, and receipts. A relationship is not identity proof,
  assurance, trust, safety, endorsement, or authorization.

## Milestone I0 — Approve the identity charter

**Outcome:** the team agrees on vocabulary, purpose, owners, evidence limits,
and prohibited uses before schema or participant work begins.

- Approve definitions for account, authenticator, platform handle, presentation,
  context presence, claim, issuer, proofing, role, authorization, traceability,
  recovery, and remedy.
- Name the exact audiences whose projections matter and the minimum fields each
  needs for a documented purpose.
- Approve the owner-only public-presence preview, synthetic/adult evaluation
  cohort, environments, task rubric, duration, support, and stop authority.
- Approve the data/log/metric allowlist and denylist. Collect no preview field
  values, free text, screenshots, account graph, or identity correlations.
- Name product, privacy, security, accessibility/language, safety, legal,
  reliability, recovery, operations, support, and incident owners.
- Record architectural choices in `DECISIONS.md`; this roadmap is not approval.

**Gate:** every term, audience, purpose, owner, evidence field, exclusion,
remedy, and stop condition is explicit and qualified review needs are assigned.

## Milestone I1 — Freeze current identity and disclosure behaviour

**Outcome:** implementation starts from a complete map of current projections,
identifiers, authentication, recovery, and authority dependencies.

- Trace registration, login, email verification, passkeys, sessions, account
  switching, custom endpoints, cross-deployment hints, recovery, and closure.
- Inventory every username and account-id dependency in profile URLs, ACLs,
  search, invites, chats, subspaces, apps, tokens, notifications, exports,
  backups, moderation, support, caches, analytics, logs, and deep links.
- Enumerate owner, anonymous, signed-in, custom-audience, app, collaboration,
  moderator, operator, export, and support projections.
- Characterize `toPublicProfile()`, profile routes, OAuth userinfo, app scopes,
  blocked/deleted accounts, stale clients, and account/endpoint switching with
  direct tests before changing them.
- Record every store and third party that could receive profile, identifier,
  authenticator, claim, recovery, or correlation data.

**Gate:** reviewers can explain which canonical projector supplies each field
to each audience and prove protected values do not appear in unused payload
fields, URLs, caches, logs, analytics, errors, exports, or notifications.

## Milestone I2 — Build one exact public-presence preview

**Outcome:** an adult account owner can predict and correct the current public
profile without adding a new identity concept.

- Generate “Only you” and “Anyone” views from the same server-side projectors
  used by the owner and anonymous profile routes.
- Label username as a platform address, display fields as self-presentation,
  email as protected account data, email verification as channel control, and
  passkeys as authenticators—not real-world identity proof.
- Show why each public field is visible and provide the existing edit route;
  never render password, credential, secure state, unique keys, raw tokens, or
  internal recovery material.
- Add anonymous live-preview validation without leaking the owner's signed-in
  state or creating a public cache of owner-only data.
- Preserve optimistic last-known state while making stale, unavailable, and
  failed refreshes explicit; do not fabricate a projection client-side.
- Register and negotiate any new endpoint or operation through the canonical
  API registry, manifest, docs, and client requirement map.

**Gate:** contract tests prove preview/public projection equivalence and people
can accurately explain and correct disclosure across approved access profiles.

## Milestone I3 — Prove correction, stopping, and recovery

**Outcome:** identity-presentation mistakes and account compromise have bounded,
understandable remedies.

- Exercise profile edit, app-scope revoke, session revocation, passkey/email
  change, account switch, endpoint switch, block, report, closure, restore, and
  support against current state.
- Re-authenticate sensitive changes and make stale tabs, sessions, tokens,
  previews, caches, and queued notifications fail safely after revocation.
- Define what remains visible after username/profile changes, block, claim
  correction, account closure, deletion, backup, or restore; never promise
  recall from recipients who already received data.
- Provide accessible receipts stating what changed, what stopped, what remains,
  and which remedy or escalation is available.
- Test existence-oracle, enumeration, impersonation, recovery-takeover, and
  cross-account/cache attacks without collecting real participant data.

**Gate:** every approved correction and stop journey reaches the intended state,
old authority fails, residual disclosure is explained, and support has an owned
remedy path.

## Milestone I4 — Evaluate context presence separately

**Outcome:** any future pseudonym or alias has a documented context, threat
model, correlation boundary, and lifecycle before implementation.

- Decide whether a proposed context needs ordinary public profiles, user-chosen
  aliases, system-generated labels, or true participant-facing anonymity.
- Prefer pairwise/context-scoped opaque identifiers; prohibit stable hashes,
  global IDs, profile links, reusable media, or metadata that reconnects a
  protected identity.
- Specify creation, collision, change, self-reveal, expiry, block, moderation,
  export, deletion, closure, restore, and historical-display effects.
- Keep operator traceability protected, purpose-limited, access-controlled,
  audited, retained only as approved, and subject to report/appeal/remedy.
- Reuse TODO 19's chat-specific contract for group chat; do not generalize its
  decisions to apps, subspaces, collaborations, or public posts.

**Gate:** adversarial projection tests and qualified privacy/safety review show
the exact audience, linkability, operator boundary, residual risks, and remedies.

## Milestone I5 — Evaluate claims and attestations separately

**Outcome:** Thingtime can decide whether a narrow claim is useful without
creating a deceptive trust badge or centralized identity hierarchy.

- Require a documented decision use case that cannot be met by self-
  presentation, authentication, authorization, or a lower-data alternative.
- Define subject, issuer, claim type, evidence class, audience, purpose,
  issuance, status, expiry, revocation, correction, dispute, retention,
  deletion, export, accessibility, and verifier responsibility.
- Model accumulating claims/status events as protected relational Things using
  named collection getters; keep them outside generic CRUD and public search.
- If portable credentials are used, apply pairwise identifiers and selective
  disclosure where appropriate, validate issuer/status at decision time, and
  show that signature verification does not establish truth or relevance.
- Do not rank, recommend, moderate, authorize, or deny service from a claim
  until fairness, error, exclusion, appeal, support, and legal review pass.

**Gate:** one synthetic claim can be issued, inspected, withheld, verified,
expired, revoked, corrected, disputed, exported/deleted as approved, and
explained without an “official/trusted” shortcut. No live use is implied.

## Milestone I6 — Run and evaluate the bounded preview pilot

**Outcome:** a small adult cohort completes the public-presence task with
privacy, accessibility, accuracy, and remedies intact.

- Use synthetic or participant-controlled profiles and no sensitive claims.
- Measure pre/post disclosure prediction, correction success, projection
  equivalence, accessibility, privacy/security incidents, failure, latency, and
  support load as separate dimensions.
- Retain only approved aggregate counts or structured-session notes with field
  values removed. Do not retain profile content, identifiers, screenshots, or
  relationship graphs as analytics.
- Pause on any unexpected public field, stale cross-account state, misleading
  assurance language, inaccessible critical control, broken correction, or
  operating overload.
- Publish a bounded report with cohort, task, version, conditions, exclusions,
  failures, incidents, remedies, deletions, limitations, owner, and refresh date.

**Gate:** participants predict the actual projection and can correct it; every
technical and human failure is visible, remediable, and included in the report.

## Measure contract

| Question                         | Candidate evidence                                                                                       | Guardrail                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Is disclosure understood?        | Correct predictions for owner and anonymous projections before action.                                   | Opening a preview is not comprehension.                     |
| Is product truth exact?          | Automated equality between preview and canonical live projectors.                                        | No copied visibility tables in UI code.                     |
| Can people recover?              | Correction, revoke, session-stop, report, and support exercises reach expected state.                    | Do not expose protected identifiers to explain errors.      |
| Is context separation preserved? | Adversarial payload/cache/link inspection finds no unapproved correlatable value.                        | A different display label is not unlinkability.             |
| Are assurance claims bounded?    | People separately explain authenticator, proofing, issuer claim, role, and authorization.                | Never infer correctness, safety, or authority from a badge. |
| Is the journey inclusive?        | Complete approved keyboard, touch, screen-reader, zoom, language, device, network, and error paths pass. | One aggregate score cannot erase a blocked profile.         |

## Stop conditions

Pause intake and disable the narrowest affected capability if:

- any protected field, global identifier, recovery material, or identity mapping
  reaches an unauthorized audience, log, cache, export, notification, or error;
- preview and actual projection disagree or stale account/endpoint state appears;
- authentication, email control, signature, attestation, popularity, role, or
  relationship is presented as stronger proof or authority than it supplies;
- a pseudonym becomes correlatable or an anonymity boundary is overstated;
- impersonation, enumeration, recovery takeover, coercion, discrimination, or
  badge misuse cannot be contained and remedied;
- correction, revoke, block, expiry, closure, deletion, appeal, or support
  cannot reach the approved outcome;
- a critical control fails for an approved accessibility, language, device, or
  network profile; or
- accountable owners lack capacity to investigate and remedy incidents.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, data cleanup, and accountable
owner approval.

## First owner decision packet

Before implementation, ask the owner to approve or revise:

1. the vocabulary and explicit non-goals;
2. the owner-only public-presence preview, audiences, adult/synthetic cohort,
   task, duration, and useful-outcome rubric;
3. canonical projectors, field labels, anonymous validation, no-collection
   contract, correction/recovery journeys, and residual-disclosure copy;
4. accessibility/language/network profiles, threat cases, support, incident
   handling, stop authority, and permitted claims; and
5. whether context aliases or attestations solve any approved later need—and,
   if so, the separate evidence and qualified reviews required before design.
