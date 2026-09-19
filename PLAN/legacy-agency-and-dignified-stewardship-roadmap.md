# Legacy agency and dignified stewardship roadmap

Status: Proposed

Evidence: [legacy agency and dignified stewardship baseline](../NOTES/legacy-agency-and-dignified-stewardship-baseline.md)

Execution epic: [TODO 50](../TODO/claude-todo/50-legacy-agency-and-dignified-stewardship.md)

## Outcome

People can leave, review, and revoke bounded instructions for prolonged
inactivity, incapacity, or death while Thingtime keeps designation separate
from activation, treats silence as uncertain, protects other people and
secrets, and performs no action without current policy, qualified authority,
exact scope, review, and remedy.

## Principles

- No present access from a future instruction.
- No inferred death, incapacity, kinship, or authority.
- Notify, preserve, export, transfer, memorialize, and close are distinct.
- Scope by data class, recipient, action, duration, and jurisdiction.
- Never transfer credentials or let import create authority.
- Protect living people and shared content after the owner's death.
- Prefer reversible holds and notification before irreversible action.
- A stale or unsupported instruction fails closed with an honest explanation.
- Qualified legal, privacy, security, safety, accessibility, support, and
  operations owners decide real scope; software does not decide entitlement.

## Phase 0 — assign authority and freeze improvisation

Name accountable product, legal/policy, privacy, security, identity, data,
accessibility, support, safety, and operations owners. Document the current
support posture for inactivity, incapacity, death, claimant requests, account
closure, and data preservation. Until an approved contract exists, do not
improvise account access, credential recovery, ownership transfer, or deletion.

Gate: every current request path has one safe response and escalation owner;
unsupported cases remain unsupported rather than being handled ad hoc.

## Phase 1 — define events, roles, actions, and data classes

Approve a versioned matrix covering:

- event classes and the evidence each may use;
- owner, trusted contact, claimant, reviewer, recipient, and operator roles;
- notify, hold, preserve, export, transfer, memorialize, delete, and close;
- ordinary Things, attachments, shared content, Messenger, recordings,
  relationships, apps, subscriptions, support/moderation records, custom
  endpoints, credentials, logs, backups, and third-party services;
- jurisdiction, age, capacity, living-person privacy, conflicts, appeals, and
  unsupported cases; and
- default behavior when no valid current instruction exists.

Gate: every pilot cell has an approved action or explicit prohibition, and no
role label silently grants authentication or legal authority.

## Phase 2 — specify the instruction and review contract

Define a minimal versioned instruction envelope, recent-auth requirements,
contact lifecycle, review reminders, revocation, expiry, policy migration, and
safe display. Define a separate claim envelope containing only the minimum
evidence metadata, review state, holds, decisions, and retention required for
the approved pilot.

The owner must see current and proposed scope before every change. The contact
must see what the role does and does not mean before accepting. Neither record
contains credentials or account content.

Gate: threat modelling covers coercion, stolen sessions, forged documents,
contact takeover, contact conflict, insider misuse, owner return, stale policy,
enumeration, and support disclosure.

## Phase 3 — prototype notify-only with synthetic events

In one exact non-production build, let the synthetic owner draft, review,
activate, change, and revoke one notify-only instruction. Use deterministic
fixtures to rehearse inactivity threshold, warning sequence, owner return,
wrong contact, failed delivery, stale instruction, policy mismatch, conflicting
claim, hold, appeal, and final no-op.

No real email, SMS, identity document, account content, export, transfer,
memorialization, or deletion is used. Notifications render into a local test
inbox and carry no secret or access grant.

Gate: every state is keyboard, screen-reader, zoom, narrow-viewport, reduced-
motion, offline, stale, interrupted, and account-switch usable; repeated events
and requests converge without duplicate effects.

## Phase 4 — rehearse a scoped export decision without execution

Reuse TODO 23's proposed data-class inventory to show what a separately
approved export could include, exclude, redact, or leave undecided. Recheck
owner instruction, contact acceptance, claimant evidence, policy version,
recipient, data scope, living-person boundaries, current ACLs, holds, and
appeals at the execution boundary.

Generate a content-free preview and refusal/approval receipt, but do not create
or disclose an archive in this pilot. Keep account recovery, login, role
transfer, and archive download credentials out of the design.

Gate: foreign-owner fixtures, shared messages, recordings, secrets, connected
apps, external endpoints, and unsupported classes fail closed without being
listed in revealing detail.

## Phase 5 — evaluate, clean up, and decide the next narrow scope

Review comprehension, error recovery, privacy boundaries, support load,
accessibility, adversarial findings, and negative evidence. Record approved,
rejected, revised, and unknown contract elements. Delete synthetic accounts,
Things, contacts, claims, evidence metadata, test inbox items, receipts, and
caches.

Gate: cleanup is proven, no production behavior or retention changed, and any
next step is separately approved. Notification-only may be the terminal scope.

## Pilot measures

- 100% of reviewers distinguish instruction, contact, claim, review, approval,
  and execution before acting.
- 100% of pilot states show event uncertainty, current scope, policy version,
  next reviewer, available stop, and remedy.
- Zero present-access grants arise from designation or contact acceptance.
- Zero credentials, private content, identity-document images, or living-person
  data appear in notifications, URLs, logs, analytics, or receipts.
- Owner return, revocation, weak evidence, conflict, stale policy, unsupported
  jurisdiction, and active hold prevent irreversible action.
- Repeated synthetic events and claims produce one idempotent state transition.
- Complete cleanup leaves no active instruction, claim, notification, receipt,
  cache, or fixture.

These are prototype gates, not proof of legal compliance, identity accuracy,
privacy, accessibility, or suitability for real bereavement workflows.

## Risks and responses

| Risk                                        | Response                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Inactivity is labelled as death             | Keep event classes explicit; inactivity can only start the approved warning/review path                 |
| A trusted contact becomes a backdoor        | Grant no login, session, token, ACL, role, or content access from designation                           |
| A claimant fabricates authority             | Require qualified review and approved evidence; stop on mismatch or uncertainty                         |
| One owner's instruction exposes others      | Classify shared data separately and re-check current privacy/ACL rules at action time                   |
| Secrets appear in an archive                | Deny credentials and secret-bearing fields by construction; reuse TODO 23's dedicated projections       |
| Contacts disagree                           | Hold irreversible work, preserve bounded decision evidence, and provide appeal/escalation               |
| Old policy is applied silently              | Version instructions and capabilities; require review or fail closed after material change              |
| Owner returns after a trigger               | Cancel pending work, restore owner control, record correction, and notify only as approved              |
| “Memorialization” becomes public disclosure | Keep it outside the first scope and require separate identity, audience, moderation, and consent review |
| Support improvises under emotional pressure | Provide one approved response, role boundaries, escalation, and staff care before real operation        |

## Hard stops

Stop for real death or incapacity data; real claimants or nominees; identity
documents; uncertain authority; unsupported jurisdiction; disputed instruction;
active hold or appeal; owner return; stale or absent policy; credential or
secret transfer; living-person or shared-content exposure; inaccessible
critical controls; unbounded retention; production notification; account login,
export, transfer, memorialization, deletion, or closure; minors; institutions;
money or entitlement movement; public claims; or missing qualified owners.

## Dependencies and boundaries

- TODO 23 supplies owner-authorized inventory, archive, restore, deletion, and
  closure mechanics; this roadmap cannot bypass its gates.
- TODO 28 supplies service continuity and recovery evidence.
- TODO 33 must prohibit AI inference or execution of legacy events.
- TODO 34 owns live collaboration and accepted artifact transfer.
- TODO 35 owns identity, authentication, disclosure, and recovery.
- TODO 37 owns notification lifecycle truth for any approved channel.
- TODO 39 owns recordings and represented-person rights.
- TODO 41 owns relationship states; none are legacy authority.
- TODO 45 qualifies any future youth scope.
- TODO 46 governs every claim made about this work.
- TODO 47 owns shared support intake, acknowledgement, status, and escalation.
- TODO 48 owns policy migration, rollback, deprecation, and retirement.

## Next owner packet

Before implementation, present the evidence baseline, event/role/action
vocabulary, data-class matrix, no-instruction default, notify-only state
machine, instruction and claim envelopes, evidence and retention boundaries,
threat model, conflict/hold/appeal flow, accessibility matrix, failure fixtures,
cleanup proof, exclusions, qualified owners, and manual stop authority.
