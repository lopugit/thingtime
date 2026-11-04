# Legacy agency and dignified stewardship baseline

Last grounded: 2026-09-16 21:09 AEST, Australia/Melbourne

Status: evidence note; not an approved product, legal, inheritance, or
incapacity decision

Plan: [legacy agency and dignified stewardship roadmap](../PLAN/legacy-agency-and-dignified-stewardship-roadmap.md)

Execution epic: [TODO 50](../TODO/claude-todo/50-legacy-agency-and-dignified-stewardship.md)

## Question

What would Thingtime need to let a person state what should happen to their
account and data after prolonged inactivity, incapacity, or death without
guessing that an absence proves an event, handing over credentials, exposing
other people, or pretending the product can decide legal authority?

## Working vocabulary

| Term               | Meaning in this note                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Legacy instruction | A revocable, versioned statement made by the account owner about a bounded future action                     |
| Trusted contact    | A named person who may be notified or invited into a verification process; the role grants no present access |
| Claimant           | A person asking Thingtime to act after a stated event; a claim is not proof or authority                     |
| Trigger            | The approved evidence and review state required before one instruction may progress                          |
| Scope              | The exact data classes and actions an instruction covers, excludes, or leaves undecided                      |
| Stewardship action | A bounded notify, preserve, export, memorialize, transfer, or close operation approved for one scope         |
| Hold               | A time-bounded stop on irreversible work while identity, authority, conflict, safety, or appeal is reviewed  |

These are planning terms. They do not establish who is an executor,
beneficiary, guardian, representative, next of kin, owner, or rights holder.

## Repository evidence

### Normal account exit exists only as a planned contract

- [The portability baseline](./data-portability-and-exit-baseline.md) records
  no registered account-wide export, restore, or account-closure route. Current
  routes can list, export, import, or delete bounded Thing families, but that is
  not whole-account succession.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) proposes an
  owner-authorized inventory, verified archive, restore, deletion, and closure
  journey. It does not define who may act when the owner cannot.
- Authentication recovery, password reset, passkeys, sessions, and account
  switching all preserve or recover the current account holder's authority.
  They are not representative or successor credentials.

### One live ownership transfer is deliberately narrow

- `transferSubspace()` in
  `remix/app/api/utils/subspaces/subspaces.ts` lets the current owner transfer
  one subspace to an active member. It rechecks ownership, recipient state, and
  owner caps transactionally, moves storage accounting, steps the previous
  owner down, and records a moderation-log event.
- That operation does not transfer an account, private Things, messages,
  credentials, contracts, intellectual-property rights, or legal
  responsibility. It also assumes the current owner can authenticate and act.
- Collaboration planning already requires a named eligible recipient,
  acceptance, exact-state guards, impact review, receipts, and no implication
  of rights transfer. Those are useful building blocks, not a legacy policy.

### Existing data can implicate living people

Messages, relationships, recordings, collaboration records, shared Things,
support cases, moderation records, and provenance may contain or reveal other
people's information. A direction from one account owner cannot automatically
authorize disclosure of everything they could see while alive.

The [OAIC's explanation of personal information](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/handling-personal-information/what-is-personal-information)
notes that information about a deceased person may still be personal
information about an identifiable living person. This is an Australian privacy
input, not a complete rule for Thingtime or every jurisdiction.

## Comparative design anchors

- [Apple Legacy Contact](https://support.apple.com/en-us/102631) separates
  advance designation from a later access request, requires an access key and
  documentary evidence, and excludes some data such as passwords, passkeys,
  payment information, and purchased media. It is a product example, not a
  template or proof of legal sufficiency.
- [Google Inactive Account Manager](https://support.google.com/accounts/answer/3036546?hl=en)
  lets a person choose an inactivity interval, contacts, and data categories;
  it distinguishes notification from data sharing and allows the plan to be
  changed or disabled. Inactivity remains a proxy, not proof of incapacity or
  death.
- The NSW Law Reform Commission consultation paper
  [Access to digital assets upon death or incapacity](https://lawreform.nsw.gov.au/content/dam/dcj/law-reform-commission/documents/Publications/Consultation-Papers/CP20.pdf)
  demonstrates that authority, asset type, contracts, privacy, and incapacity
  are legally complex. Qualified review is required before any real workflow.

These sources show useful separations: designation is not activation, silence
is not proof, a claimant is not automatically authorized, and one scope need
not unlock another.

## The product gap

Thingtime has no shared contract answering:

1. Can a person leave a revocable instruction without granting present access?
2. Which event is being asserted: chosen inactivity, temporary incapacity,
   permanent incapacity, or death?
3. What evidence, human review, waiting period, conflict path, and appeal are
   required for each action and jurisdiction?
4. Which data may be notified, preserved, exported, transferred, memorialized,
   deleted, or left untouched?
5. How are credentials, secrets, private keys, third-party content, messages,
   living people's data, and external endpoints excluded or separately
   reviewed?
6. What happens if the owner returns, a claimant is wrong or abusive, contacts
   disagree, the instruction is stale, or a legal hold applies?
7. How can Thingtime prove a bounded action completed without revealing the
   protected content in receipts or support tools?
8. What safe default applies when there is no valid instruction?

Without those answers, either indefinite retention or improvised support action
can override a person's wishes and other people's rights.

## Boundaries with adjacent garden work

- TODO 23 owns owner-authorized inventory, archive, restore, deletion, and
  normal account closure. This theme owns the exceptional authority needed to
  invoke a bounded operation when the owner may not be able to act.
- TODO 28 owns service backup, recovery, and continuity. Provider recovery is
  not succession.
- TODO 33 owns AI context and tool authority. An assistant must never infer or
  execute a legacy event.
- TODO 34 owns live collaboration roles and accepted ownership transfer. This
  theme does not invent rights transfer or bypass recipient acceptance.
- TODO 35 owns identity, authentication, recovery, and public presence. A
  claimant does not become the original person and receives no reusable login.
- TODO 39 owns recordings and represented-person boundaries.
- TODO 41 owns relationship state; kinship, friendship, following, or message
  history does not prove legacy authority.
- TODO 45 owns youth-safety qualification; minors remain outside this scope.
- TODO 47 owns shared support intake and status, while qualified domain owners
  decide any actual stewardship outcome.
- TODO 48 owns policy change, migration, rollback, and retirement.
- TODO 49 owns remembered preferences and derived profiles. A legacy
  instruction is deliberate authority metadata, not personalization.

## Candidate instruction envelope

For review, a legacy instruction should be representable with:

- owner, stable instruction id, version, creation and last-review timestamps;
- recent-auth evidence for create, change, revoke, and high-risk review;
- named contact identifiers and their notification/acceptance state;
- exact event class, waiting period, evidence requirements, review owner, and
  supported jurisdiction, with unsupported cases explicit;
- per-data-class action, exclusions, recipient, duration, and conditions;
- conflict, objection, appeal, hold, expiry, revocation, and owner-return rules;
- current policy/capability versions and stale-instruction handling;
- bounded, content-free request and completion receipts; and
- declared safe default when no instruction can be executed.

It must never contain passwords, passkeys, session tokens, private keys,
payment credentials, secret-bearing endpoint URLs, or a blanket copy of account
content.

## Bounded first pilot

Use adult internal reviewers, one synthetic owner, one synthetic contact, one
synthetic conflicting claimant, one synthetic private text Thing, and one exact
non-production build. The pilot is a policy and interaction rehearsal only:

1. draft and revoke one instruction that says **notify only** after a fixed
   synthetic inactivity event;
2. preview one separate owner-approved export scope without creating an
   archive or granting content access;
3. exercise stale instruction, owner return, failed claimant verification,
   claimant conflict, hold, appeal, and no-instruction outcomes;
4. show that the contact has no present account access and receives no reusable
   credentials; and
5. delete every fixture and receipt after review.

Do not process a real death or incapacity claim, contact a real nominee, collect
identity documents, change production retention, transfer ownership, expose
content, delete an account, memorialize a profile, move money or entitlements,
or make legal or privacy claims.

## Evaluation questions

- Can every reviewer distinguish designation, notification, claim,
  verification, approval, and execution?
- Does inactivity remain visibly uncertain rather than being labelled death or
  incapacity?
- Can the owner change or revoke the instruction without the contact's
  permission?
- Does every recipient see only the approved minimum for the current stage?
- Do owner return, conflict, weak evidence, unsupported jurisdiction, and stale
  policy stop irreversible work?
- Are living-person, shared-content, secret, and external-system boundaries
  explicit?
- Can the product explain what it did, did not do, and cannot prove without
  leaking content?

## Open owner decisions

- Should Thingtime support notification only before it supports any data
  access or transfer?
- Which event classes and jurisdictions, if any, can be supported honestly?
- Who performs claimant and documentary review, and how are sensitive records
  isolated, retained, and deleted?
- Which data classes are categorically non-transferable?
- What is the safe default for inactive accounts without a current instruction?
- Can an owner require multiple contacts or an independent reviewer for one
  action?
- What owner-return, conflict, appeal, hold, and correction windows are
  supportable?

Refresh this note after account export/closure, auth recovery, subspace
transfer, collaboration, recording, legal-policy, or support behavior changes;
when qualified reviewers resolve an open decision; or before any real pilot.
