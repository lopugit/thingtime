# 50 — Legacy agency and dignified stewardship

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/legacy-agency-and-dignified-stewardship-baseline.md)

Plan: [roadmap](../../PLAN/legacy-agency-and-dignified-stewardship-roadmap.md)

## Goal

Let people leave, review, and revoke bounded instructions for prolonged
inactivity, incapacity, or death without granting present access, treating
silence as proof, transferring credentials, exposing other people, or letting
software decide legal authority.

## Why this belongs in the garden

Thingtime plans normal owner-directed export and account closure, and it ships
one narrowly scoped live subspace-ownership transfer. Neither answers what may
happen when an account holder cannot act. Improvised support decisions could
otherwise create a backdoor, ignore the person's wishes, strand shared work,
expose living people, or destroy data without valid authority.

This item creates a reviewable contract before any real claimant, document,
notification, archive, transfer, memorialization, deletion, or closure enters
the system.

## Dependencies and boundaries

- [TODO 23](./23-data-portability-and-exit.md) owns owner-authorized data
  inventory, export, restore, deletion, and account closure. This item owns only
  the exceptional authority and review boundary for invoking a bounded action
  when the owner may not be able to act.
- [TODO 28](./28-service-continuity-and-recovery.md) owns service continuity,
  backup, restore, and incident recovery.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI authority. AI
  must not infer death, incapacity, kinship, entitlement, or execution.
- [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns live
  collaboration and accepted ownership transfer; transfer never implies legal
  or intellectual-property rights.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity,
  authentication, recovery, and disclosure. A claimant never logs in as the
  original person.
- [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns truthful
  notification lifecycle state.
- [TODO 39](./39-recording-agency-and-intimate-data-stewardship.md) owns
  recording and represented-person boundaries.
- [TODO 41](./41-relationship-agency-and-consentful-connection.md) owns social
  state; kinship, friendship, following, or messaging is not authority.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) owns any future
  youth qualification; minors are excluded here.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns claims.
- [TODO 47](./47-support-agency-and-accountable-remedy.md) owns shared intake,
  acknowledgement, status, and escalation, not the domain outcome.
- [TODO 48](./48-change-agency-and-humane-product-evolution.md) owns policy
  introduction, migration, rollback, and retirement.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. This TODO approves
  no production implementation or legal conclusion.

## Phase 0 — establish the safe current posture

- [ ] Name product, legal/policy, privacy, security, identity, data,
      accessibility, support, safety, and operations owners plus manual stop
      authority.
- [ ] Inventory current routes, support paths, terms/privacy copy, retention,
      account recovery, export/import, deletion, ownership-transfer, external
      endpoint, and shared-content behavior.
- [ ] Publish one internal response for inactivity, incapacity, death, claimant,
      preservation, and closure requests while the feature is unsupported.
- [ ] Prohibit ad hoc credential resets, account access, ACL or role changes,
      ownership transfer, exports, deletion, and public memorialization.
- [ ] Record only owner-approved decisions in `DECISIONS.md`.

Gate: unsupported requests have an accountable, privacy-safe escalation path
that grants no access and promises no outcome.

## Phase 1 — approve vocabulary and scope matrix

- [ ] Define legacy instruction, trusted contact, claimant, trigger, evidence,
      reviewer, recipient, stewardship action, hold, conflict, appeal,
      revocation, expiry, completion, and unsupported outcome.
- [ ] Keep prolonged inactivity, temporary incapacity, permanent incapacity,
      and death distinct. Define what the product can observe versus what a
      qualified reviewer must establish.
- [ ] Separate notify, preserve, export, transfer, memorialize, delete, and
      close. Approval for one never implies another.
- [ ] Classify ordinary Things, attachments, shared content, Messenger,
      recordings, relationships, app data, subscriptions, moderation/support,
      logs, backups, custom endpoints, third-party services, and credentials.
- [ ] Mark credentials, sessions, tokens, passkeys, private keys, payment
      material, and secret-bearing endpoint values non-transferable.
- [ ] Approve a safe default for no instruction, stale instruction, unsupported
      jurisdiction, uncertain authority, conflict, appeal, and owner return.

Gate: every pilot cell has one approved action or explicit prohibition; labels
such as contact, family, executor, or owner grant no technical authority.

## Phase 2 — specify instruction and claim records

- [ ] Define a versioned instruction envelope with owner, recent-auth proof,
      exact scope, event class, contacts, actions, exclusions, review date,
      policy/capability versions, revocation, expiry, holds, and safe default.
- [ ] Define contact invitation and acceptance that grants no present content,
      login, session, token, ACL, role, export, or notification about private
      account activity.
- [ ] Define a separately encrypted, access-limited claim envelope containing
      only approved evidence metadata, decision state, reviewers, retention,
      holds, conflict, appeal, and deletion state.
- [ ] Require recent authentication for owner create/change/revoke actions and
      fresh qualified review at every future execution boundary.
- [ ] Define content-free receipts that show request, current scope, policy,
      decision, action/refusal, timestamps, exceptions, and remedy without
      exposing content, identity documents, or sensitive claimant data.
- [ ] Threat-model coercion, stolen sessions, forged or replayed evidence,
      contact takeover, enumeration, collusion, contact conflict, insider
      access, owner return, stale policy, and support disclosure.

Gate: privacy, security, identity, legal/policy, accessibility, support, and
data owners approve the schemas, access controls, retention, and abuse cases.

## Phase 3 — prototype notify-only with synthetic fixtures

- [ ] Use one synthetic owner, contact, conflicting claimant, private text
      Thing, local test inbox, and exact non-production build.
- [ ] Let the owner draft, preview, activate, review, change, and revoke one
      notify-only instruction after recent-auth simulation.
- [ ] Show the contact the role's exact scope, absence of present access,
      withdrawal path, and data handling before acceptance.
- [ ] Model a fixed synthetic inactivity event as uncertain. Exercise warning,
      owner response, owner return, delay, expiry, stale policy, failed contact
      delivery, wrong contact, and cancellation.
- [ ] Exercise weak claimant evidence, conflicting claim, active hold, appeal,
      unsupported jurisdiction, and no-instruction paths; all end in no-op.
- [ ] Make retries idempotent and reject stale versions, account switches,
      duplicate events, replayed confirmations, and crossed identities.
- [ ] Keep all messages local; send no real email, SMS, push, webhook, or
      external support request.

Gate: no fixture path grants access or describes inactivity as proof of death
or incapacity, and every stopped path remains understandable and recoverable.

## Phase 4 — rehearse a scoped export decision without exporting

- [ ] Reuse TODO 23's proposed data-class inventory rather than inventing a
      second archive or deletion contract.
- [ ] Produce a deterministic preview of included, excluded, redacted,
      external, unsupported, shared, and undecided classes for one synthetic
      instruction.
- [ ] Recheck current instruction/version, contact acceptance, claimant review,
      recipient, jurisdiction, data scope, ACLs, living-person boundaries,
      hold, conflict, and appeal at the hypothetical action boundary.
- [ ] Prove shared messages, other people's private Things, recordings,
      credentials, app secrets, custom-endpoint secrets, and unsupported
      classes fail closed without revealing their contents or existence beyond
      the approved summary.
- [ ] Emit only content-free approval/refusal receipts. Create no archive,
      download link, ownership change, login credential, memorial profile,
      deletion job, or closure job.

Gate: qualified reviewers agree the decision path is comprehensible,
minimal, conflict-aware, and incapable of bypassing TODO 23.

## Phase 5 — accessibility, failure, and cleanup proof

- [ ] Walk every pilot state on desktop and mobile with keyboard, touch, screen
      reader, 200%/400% zoom, narrow viewport, reduced motion, plain language,
      offline, stale data, interruption, timeout, and account switching.
- [ ] Inject duplicate event, duplicate claim, restart, partial persistence,
      stale policy, owner revocation race, contact removal, failed notification,
      reviewer loss, hold, appeal, and cleanup failure.
- [ ] Verify logs, URLs, notifications, analytics, exports, screenshots,
      support views, and receipts contain no credentials, private content,
      identity-document images, or unnecessary living-person data.
- [ ] Delete every synthetic account, Thing, contact, instruction, claim,
      evidence item, inbox message, receipt, cache, and fixture through approved
      APIs and verify complete cleanup.
- [ ] Record positive, negative, contradictory, and unresolved evidence without
      changing production policy or making a public claim.

Gate: every failure is visible and recoverable, cleanup is proven, and
notification-only may remain the maximum approved scope.

## Acceptance criteria

- The approved event/role/action/data matrix makes designation, notification,
  claim, verification, approval, and execution visibly distinct.
- A trusted contact receives no present access and no reusable credential.
- Inactivity never appears as proof of incapacity or death.
- No relationship, profile field, support assertion, document, or model output
  automatically grants authority.
- Every action is limited by current instruction, policy/capability version,
  recipient, data class, jurisdiction, evidence, review, hold, and appeal state.
- Owner return, revocation, conflict, stale policy, unsupported jurisdiction,
  weak evidence, and failed review prevent irreversible work.
- Credentials, secrets, living-person data, shared content, and external
  systems are denied or separately reviewed by construction.
- Duplicate synthetic events/claims and restarts converge without duplicate
  notification or state transitions.
- Complete-journey accessibility and cleanup checks pass with no production
  notification, data, telemetry, authority change, or policy change.
- The evidence report explicitly says the pilot does not prove legal
  authority, claimant identity, privacy compliance, accessibility, or readiness
  for real death or incapacity requests.

## Hard stops

- Any real person, death, incapacity, claimant, nominee, identity document,
  bereavement communication, or account data enters the pilot.
- Inactivity, relationship, profile, document upload, support assertion, or AI
  output is treated as proof or authority.
- A contact gains login, session, token, passkey, ACL, role, archive, or content
  access from designation or acceptance.
- Living-person or shared content crosses its current authorized boundary.
- Credentials, private keys, payment material, secret-bearing endpoint URLs, or
  identity-document images enter messages, logs, receipts, analytics, or test
  artifacts.
- An instruction is stale, disputed, unsupported, held, appealed, or superseded
  by owner return and work continues.
- Production notification, preservation, export, ownership transfer,
  memorialization, deletion, closure, retention, or public claims are enabled.
- Minors, institutions, money, entitlements, sensitive domains, or unsupported
  jurisdictions enter scope.
- Qualified ownership, accessible critical controls, incident response, or
  manual stop authority is missing.

## Concrete next action

Prepare one owner packet containing the evidence baseline, vocabulary,
event/role/action/data matrix, safe current response, no-instruction default,
notify-only state machine, instruction and claim envelopes, threat model,
conflict/hold/appeal path, retention and deletion rules, accessibility matrix,
failure fixtures, cleanup proof, exclusions, qualified owners, and stop
authority. Do not implement a production route or contact a real person before
that packet is approved.
