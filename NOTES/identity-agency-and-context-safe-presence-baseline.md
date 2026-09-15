# Identity agency and context-safe presence baseline

**Evidence snapshot:** 2026-09-08, Australia/Melbourne

**Scope:** account identity, public profiles, app disclosure, pseudonymous
participation, attestations, authority, recovery, and safety boundaries visible
from this branch after merging `origin/develop`. This is a planning baseline,
not identity proof, legal advice, a production-behaviour claim, or permission to
collect new personal information. It contains no private user data.

## Why preserve this note

Thingtime already gives each account a stable record, username, public profile,
authenticators, app-scoped disclosures, and several context-specific actor
presentations. Those pieces answer different questions. They do not yet give a
person one place to understand what identifies them, what other people or apps
can see, what has merely been verified, and what authority follows.

A passkey proves possession of an authenticator, not a legal identity. Email
verification proves control of an address, not that a profile claim is true. A
username makes an account addressable, but need not be a real name. A signed
credential can preserve an issuer's assertion, but cannot make that issuer
trustworthy or the assertion correct. A role or social relationship is not
authorization.

The related
[identity agency and context-safe presence roadmap](../PLAN/identity-agency-and-context-safe-presence-roadmap.md)
turns these boundaries into gates. The proposed execution epic is
[TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md).

## Evidence ledger

| Claim | Evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Accounts already separate public profile data from private credentials and preferences. | `remix/app/api/utils/auth/users.ts` stores username and presentation fields in the user Thing's `crystal`, while email, password and account state live in protected `secure` data; hashed uniqueness material lives in `uniqueKeys`. | High for this commit. Re-read after user storage, collection, or projection changes. |
| Other people receive a deliberately smaller profile than the account owner. | `PublicProfile` and `toPublicProfile()` expose id, username, display name, bio, avatar/banner, creation time, and temporary status. Email, birthday, verification, quotas, preferences, admin state, and secure fields are absent. | High for this commit. Re-run projection and route tests after profile changes. |
| The email preference does not publish email. | The profile route and `profileRoute.test.ts` keep email out of another person's response whether `hideEmailOnProfile` is true or false. API docs describe the preference as owner-only display control. | High for this commit. Re-test every public profile surface after field or copy changes. |
| Usernames are global platform handles with architectural weight. | Registration normalizes and reserves usernames, uniqueness is enforced, user search resolves them, profile URLs use them, and ACL vocabulary includes `tt:user/<username>`. | High for current addressability. A rename or alias proposal requires an inventory of ACLs, links, caches, apps, exports, moderation, and recovery. |
| App identity disclosure is already scope-separated. | `remix/app/api/utils/apps/scopes.ts` defines `profile.username`, presentation-field scopes, and a separate `email` scope. Userinfo projections include only granted fields; birthday and email have dedicated scopes. | High for current code. Recheck after OAuth scope, consent, token, userinfo, or app-data changes. |
| Current authentication factors establish access confidence, not real-world identity. | Password, passkey, session, and email-verification paths authenticate an account or channel. No inspected contract claims government, employment, professional, age, or legal-name proof. | High for the distinction; medium for complete path inventory. Refresh before any assurance label ships. |
| Anonymous group chat has a strong proposed context boundary but is not implemented. | [TODO 19](../TODO/claude-todo/19-anonymous-group-chats.md) proposes chat-local opaque identifiers, no profile links or stable hashes, and an honest operator/inviter boundary. It is marked not started. | High for planning status. Re-ground from code and live behaviour before implementation. |
| Invite prefill is recipient-controlled and grants no privilege. | [TODO 18](../TODO/claude-todo/18-account-invite-links.md) allows optional editable username/profile suggestions while preserving canonical registration, explicit consent, expiry, revocation, and no authority transfer. | High for the current plan. Keep account invitation separate from attestation and authorization. |
| Earlier governance thinking proposes signed public profiles and attestations but does not supply an approved product contract. | [`AI_Idlings/2026-06-23-135148-AEST/03-trust-identity-and-governance.md`](../AI_Idlings/2026-06-23-135148-AEST/03-trust-identity-and-governance.md) explores externally verifiable tokens, key rotation, organizational claims, and voting. | High for idea provenance, not implementation status. Revalidate standards, threats, owners, and product need before use. |
| External standards support pseudonymous participation and warn against collapsing integrity into truth. | [NIST SP 800-63-4](https://pages.nist.gov/800-63-4/sp800-63/introduction/) separates identity, authentication, and federation assurance and allows pseudonymous accounts; its [subscriber account guidance](https://pages.nist.gov/800-63-4/sp800-63a/accounts/) records whether identity proofing occurred. [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model/) says verification does not create transitive trust and documents correlation risks. | High for the cited versions. Recheck before standards or conformance claims. |
| Privacy guidance treats anonymity and pseudonymity as legitimate design choices. | Australia's [OAIC APP Guidelines, Chapter 2](https://www.oaic.gov.au/__data/assets/pdf_file/0019/258121/Consolidated-APP-guidelines.pdf) distinguishes anonymity from pseudonymity and describes circumstances where people should have those options. The [eSafety Commissioner](https://www.esafety.gov.au/industry/safety-by-design/foundations/empowering-users-to-stay-safe-online) includes pseudonyms, privacy controls, and private groups among user-safety tools. | High for planning input, not a legal conclusion about a specific feature. Obtain qualified review where required. |

## Vocabulary that must stay separate

| Layer | What it can establish | What it cannot establish by itself |
| --- | --- | --- |
| Account record | A durable Thingtime account and stable internal reference. | A legal or real-world identity. |
| Authenticator/session | That an approved factor or session controls the account at an assurance level. | Truth of profile claims, social trust, or action authority beyond the session. |
| Platform username | A unique, discoverable Thingtime address and ACL subject. | A real name, ownership of similar names elsewhere, or entitlement to a role. |
| Presentation profile | What the current audience may see: display name, bio, media, and handle. | Verification, endorsement, professional status, or permission. |
| Context presence | A context-scoped label or pseudonym used in one chat, app, subspace, or collaboration. | Global linkability or invisibility from operators unless explicitly guaranteed. |
| Claim/attestation | What a named issuer asserts about a subject, with scope and status. | That the issuer is authoritative, the claim is true, or the verifier should rely on it. |
| Identity proofing | Evidence that a subject corresponds to a claimed real-world identity at an approved level. | Authentication of every future action, authorization, safety, or correctness. |
| Role/authorization | What the current actor may do to the current resource in the current state. | Identity proof, authorship, legal rights, or general trustworthiness. |
| Safety traceability | A protected path for authorized investigation and remedy. | Permission to expose an identity to ordinary participants or the public. |
| Recovery/continuity | How rightful access can be restored and stale access stopped. | A basis for silently weakening privacy or authentication. |

## Current strengths to preserve

- Public profile projection is allowlisted and excludes email even when an
  owner chooses to see email on their own profile.
- OAuth disclosures are purpose-scoped instead of exposing one all-or-nothing
  identity object.
- User records already have a stable account identifier distinct from the
  visible username field, even though every dependency on both still needs an
  explicit inventory before mutable handles are considered.
- Anonymous-chat planning keeps real actor mapping protected server-side for
  authorization and remedies while removing globally correlatable values from
  participant-facing payloads.
- Account invites preserve recipient choice and do not imply relationship,
  role, access, verification, or endorsement.

## Gaps and unresolved decisions

1. **No owner-facing disclosure map.** Profile settings do not yet provide one
   exact, server-projected comparison of what only the owner sees versus what an
   anonymous person, signed-in person, selected audience, or app sees.
2. **Identity labels can overclaim.** “Verified”, “trusted”, “official”, and
   “anonymous” have no shared evidence, issuer, audience, expiry, or limitation
   vocabulary across the product.
3. **Global handles and context identities are not a unified lifecycle.** A
   username is addressable and ACL-significant; chat-local anonymity is planned;
   rename, collision, impersonation, context alias, and linkability rules remain
   undecided.
4. **Attestation architecture is exploratory.** There is no approved issuer
   registry, claim schema, status/revocation path, audience projection, dispute,
   correction, retention, portability, or qualified review.
5. **Recovery can become an identity attack.** Account switching, cross-
   deployment hints, email/passkey recovery, support, and stale sessions need a
   single threat model before identity presentation expands.
6. **Safety and privacy can conflict.** Operator traceability may be necessary
   for abuse response, but ordinary-participant anonymity must remain honest and
   protected from casual disclosure, exports, logs, analytics, and support views.

## First reversible pilot

Build no new identity, alias, credential, or proofing system. First prototype an
owner-only **Public presence preview** for one adult self-profile:

- show side-by-side, server-generated “Only you” and “Anyone” projections;
- label every field as account, authenticator, presentation, preference, or
  undisclosed protected data without rendering secret values;
- state that email verification and passkeys do not verify real-world identity;
- link to the existing edit controls and provide an anonymous preview route;
- make stale/error state explicit and collect no field values or preview views;
- test comprehension, correction, accessibility, account switching, custom
  endpoints, narrow screens, and cache separation with synthetic accounts.

The hypothesis is that people can predict public disclosure more accurately
when Thingtime shows the exact projection instead of relying on settings prose.
This pilot is complete only if its projections are generated by the same server
allowlists as the actual surfaces. A hand-maintained mock is not evidence.

## Risks and protective responses

| Risk | Protective response |
| --- | --- |
| Involuntary outing or cross-context correlation | Minimize stable identifiers; keep context aliases pairwise or context-scoped; never expose a mapping through unused fields, URLs, caches, notifications, or analytics. |
| Impersonation and confusing name collisions | Distinguish handle, display name, issuer, claim, and role visually; provide correction/report paths; do not reserve “official” semantics without a reviewed registry. |
| Deceptive verification badge | Show exactly what was checked, by whom, when, for which audience and purpose, with expiry/status and limitations; never convert a signature into a truth badge. |
| Enumeration and stalking | Preserve bounded search, rate limits, block controls, safe errors, and non-identifying previews; do not add public lookup by email or protected identifiers. |
| Real-name coercion | Keep pseudonymous participation available where lawful and practicable; require a documented necessity and qualified review before any proofed identity is mandatory. |
| Moderation evasion or unsafe anonymity | Preserve protected server-side actor linkage, authorization, rate limits, reporting, appeal, retention, and audited access; explain the exact anonymity boundary. |
| Handle rename breaks authority | Do not implement mutable usernames until ACL, link, app, cache, export, moderation, migration, and rollback invariants are decided and tested. |
| Recovery takeover | Re-authenticate sensitive changes, notify through safe channels, revoke stale sessions, provide bounded recovery and human remedy, and never reveal whether a protected identifier exists. |
| Badge hierarchy or discrimination | Avoid public reputation scores and default sorting by attestations; measure exclusion and error separately; provide correction, expiry, dispute, and non-participation paths. |
| Child, workplace, health, finance, civic, or legal use raises harm | Exclude those domains from the pilot and require separate qualified review, evidence, support, and stop authority. |

## Candidate measures

| Question | Candidate evidence | Guardrail |
| --- | --- | --- |
| Can people predict disclosure? | Participants correctly identify each field visible to themselves, anonymous viewers, and approved apps before and after a change. | A settings click or successful request is not comprehension. |
| Does the preview match reality? | Contract tests compare preview and live public/app projections from the same canonical projector. | No duplicated client-side visibility rules. |
| Can mistakes be corrected? | Edit, revoke, session invalidation, report, and recovery exercises reach the approved state. | Do not preserve private values in analytics or screenshots. |
| Is context separation real? | Adversarial tests find no global identifier in a context-private projection and no stale cross-account cache. | Cosmetic aliases are not pseudonymity. |
| Is the journey accessible? | End-to-end keyboard, touch, screen-reader, zoom/reflow, language, slow-network, and error-path exercises pass. | Do not average away a blocked profile. |
| Are claims honest? | Participants can explain subject, issuer, evidence type, audience, status, limitation, and authority separately. | A signature, badge, or popularity signal is never enough. |

## Open questions

1. Which account identifier is internal-only, which is safe to expose, and
   which dependencies currently assume a stable username?
2. Which audiences need first-class previews: anonymous, signed-in, custom ACL,
   chat, subspace, collaborator, app, support, or moderator?
3. Should context aliases be person-chosen, system-generated, or both, and what
   prevents correlation across contexts?
4. Which legitimate use case, if any, needs identity proofing rather than an
   authenticated pseudonymous account?
5. Who may issue an attestation, what exact claim may it make, and who decides
   whether that issuer is relevant?
6. What survives claim expiry, revocation, correction, dispute, account closure,
   export, deletion, restore, and issuer disappearance?
7. How are impersonation, protected identities, safety investigation, appeal,
   and disclosure to affected people governed and audited?
8. Who owns product, privacy, security, accessibility, safety, legal review,
   recovery, support, incident response, and stop authority?

## Refresh checklist

- Re-run scoped Graphify queries for accounts, profiles, usernames, ACLs,
  authenticators, OAuth scopes, invites, chats, subspaces, moderation, account
  switching, cross-deployment hints, recovery, exports, logs, and caches.
- Exercise actual owner, anonymous-viewer, signed-in-viewer, OAuth-app, blocked,
  renamed/deleted, account-switch, and custom-endpoint projections when they
  exist.
- Re-read the cited OAIC, NIST, W3C, and eSafety guidance and obtain qualified
  review before legal, conformance, assurance, or high-impact claims.
- Update this note after an owner decision, identity/profile/auth change,
  implementation milestone, incident, or production-behaviour change.
