# Collaboration agency and shared-stewardship baseline

**Evidence snapshot:** 2026-09-07, Australia/Melbourne

**Scope:** collaboration on private or deliberately shared Things, including
invitations, roles, edit authority, concurrent changes, departure, removal,
ownership transfer, and group lifecycle visible from `origin/develop` and the
public GitHub repository. This is a product-planning baseline, not a claim about
production behaviour, user consent, legal status, or rights ownership. It
contains no private user data.

## Why preserve this note

Thingtime already has useful relationship and collaboration-adjacent pieces:
friends, follows, ACL audiences, share links, Messenger groups, communities,
roles, invitations, and owner-guarded Thing updates. Those pieces answer
different questions. They do not yet form one contract for people who want to
make and steward an artifact together.

A friend is not automatically a collaborator. Seeing a Thing does not imply
permission to edit it. Accepting a community invite does not transfer ownership
or copyright. A visible edit receipt does not resolve a disagreement. Removing
someone from a group does not explain what happens to their contributions.

The related
[collaboration agency and shared-stewardship roadmap](../PLAN/collaboration-agency-and-shared-stewardship-roadmap.md)
turns this evidence into gates. The proposed execution epic is
[TODO 34](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md).

## Evidence ledger

| Claim | Evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Ordinary Thing mutation is owner-bound, even when a Thing is visible to other people. | `updateThing()` in `remix/app/api/utils/things/things.ts` first loads by both `shareId` and `ownerId: viewer.id`. ACL changes affect audience, but the generic update path does not define co-editor roles. | High for this commit. Re-read after Thing write authorization or ACL semantics change. |
| Thing updates already have an optional stale-preview guard, but it is not a multi-editor workflow. | `updateThing(..., { expectedUpdatedAt })` rejects a changed timestamp with 409 and asks for a new preview. This is a useful lost-update primitive; it does not provide merge, suggestion, attribution, or conflict-resolution UX. | High for the current path. Re-test every client that begins sending the guard. |
| ACLs express visibility, not shared stewardship. | The Thing read path resolves user, friends, family, public, token, and inherited audiences. The owner remains the generic mutation authority. [`TODO 17`](../TODO/claude-todo/17-circles.md) records that friends are consent-based while family remains owner-only. | High for the current architecture. Refresh after custom audiences, shared-edit roles, or family membership lands. |
| App sharing is explicit and narrow, but deliberately read-only. | `sanitizeSharedThings()` in `remix/app/api/utils/apps/sharedThings.ts` accepts only owner-selected Thing IDs, caps the selection, and `getSharedThings()` serves a content projection after re-checking current ownership. | High for this commit. Preserve this boundary unless a separately reviewed write capability is introduced. |
| Messenger has relational membership and bounded roles. | `chat-member` and `community-member` are separate Things. `ChatRole` is `owner`, `admin`, or `member`; membership is checked on Messenger reads and writes. These roles govern chat/community operations, not arbitrary Thing edits. | High for the inspected code. Recheck after Messenger or community authorization changes. |
| Community removal and leaving revoke channel membership, but ownership transfer is explicitly absent. | `manageCommunityMember()` removes a non-owner and revokes their community-channel memberships transactionally. `leaveCommunity()` permits non-owners to leave; its owner path fails because transfer is a future feature. | High for the current community path. Refresh if transfer, deletion, or role history ships. |
| Community invite codes have expiry, revocation, use limits, and atomic redemption, but joining is broad membership rather than purpose-specific collaboration consent. | `createInvite()` and `joinCommunityByCode()` in `communities.ts` guard role, expiry, revocation, maximum uses, duplicate membership, and transaction races. The redeem projection does not define an artifact, proposed role, exact capabilities, or contribution/exit terms. | High for current code; no production invite was exercised. |
| Group-chat invitations and anonymous participation are separately planned. | [`TODO 19`](../TODO/claude-todo/19-anonymous-group-chats.md) requires opt-in group membership, privacy-safe identity projection, leave/remove flows, and continued server-side accountability. It does not create a shared artifact authority model. | High for the planning boundary. Re-ground if that TODO is implemented. |
| Account invite links are not collaboration invitations. | [`TODO 18`](../TODO/claude-todo/18-account-invite-links.md) keeps registration under recipient control and forbids an invite from granting friendships, chat membership, app scopes, or other privileges. | High for the current plan. Keep account creation and artifact authority separate. |
| Current edit history and provenance are insufficient for shared authorship. | The [content provenance baseline](./content-provenance-and-correction-baseline.md) records that current updates replace content, while proposed relational revisions, source assertions, and correction notes remain unimplemented. | High for the 2026-09-04 baseline; refresh before building shared editing. |
| A shared rich-text editor contract does not imply simultaneous editing. | `remix/app/components/Editor/sharedEditorContract.test.ts` ensures application entry points use one Editor.js runtime. It does not define document sessions, remote cursors, operational transforms, CRDTs, or merge semantics. | High for the test's purpose. Do not infer real-time collaboration from shared component ownership. |
| Subspaces are substantial active work, not merged evidence for this baseline. | PR [#649](https://github.com/lopugit/thingtime/pull/649) was open against `develop` on 2026-09-07. Its proposal includes membership, roles, join requests, moderation, transfer, and deletion for subspaces, but an open PR is not shipped behaviour and its scope is community publishing rather than co-editing one private Thing. | Time-sensitive. Refresh the PR head, status, implementation, and live behaviour before reuse. |
| The public issue tracker is empty at this snapshot. | `gh issue list --repo lopugit/thingtime --state open` returned no rows on 2026-09-07. | High for the timestamp only. It is not evidence that collaboration needs, conflicts, or harms are absent. |

## External design references

These are design inputs, not compliance or conformance claims.

- The [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
  recommends least privilege, deny by default, permission checks on every
  request, and authorization tests. A collaborator's current role and the
  artifact's current state must therefore be checked at execution time rather
  than trusted from an invite, cached screen, or client-supplied role.
- [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)
  describes `If-Match` preconditions as a way to prevent accidental overwrites
  when multiple agents act on one representation. Thingtime can use the same
  principle without claiming that timestamp checks solve semantic conflicts.
- Australia's eSafety Commissioner describes
  [Safety by Design](https://www.esafety.gov.au/industry/safety-by-design/faq)
  through service-provider responsibility, user empowerment and autonomy, and
  transparency and accountability. Those principles support clear join,
  leave, remove, report, and remedy paths.
- [WCAG 2.2's error-prevention guidance](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data)
  calls for important submissions to be reversible, checked, or reviewable and
  correctable. Permission changes, ownership transfer, destructive conflict
  resolution, and departure need equivalent accessible safeguards.
- The [NIST Privacy Framework](https://www.nist.gov/privacy-framework/getting-started-0)
  distinguishes Identify, Govern, Control, Communicate, and Protect outcomes
  and emphasizes granular control of data processing. It is useful vocabulary
  for multi-party purpose, role, disclosure, retention, and revocation choices.

## Terms that must remain separate

| Term | Proposed meaning | Must not imply |
| --- | --- | --- |
| Relationship | A friend, follow, family, account, or other social connection. | Access to, edit authority over, or responsibility for an artifact. |
| Invitation | A bounded proposal to join one collaboration under stated terms. | Consent, acceptance, account creation, or authority before redemption. |
| Membership | A current relationship to a collaboration space or artifact. | Ownership, authorship of every part, or permission to take every action. |
| Role | A named set of versioned capabilities within a declared scope. | Trustworthiness, employment status, platform moderation power, or real-world identity. |
| Visibility | Who may receive a projection of current content. | Permission to edit, invite, export, transfer, delete, or change visibility. |
| Contribution | An attributable proposal or accepted change to an artifact. | Agreement by every collaborator, ownership of the whole, or a licence to republish. |
| Stewardship | Responsibility for lifecycle decisions and remedies under an approved contract. | Permanent control, unilateral rights ownership, or immunity from review. |
| Conflict | Two intentions cannot be applied safely to the same expected state. | Misconduct, bad faith, or a reason to silently choose the last writer. |
| Removal | Ending a member's future authority. | Erasing history, retracting already shared data, deleting contributions, or resolving a dispute. |
| Departure | A member voluntarily ends participation. | Automatic transfer, deletion, public disclosure, or waiver of unresolved rights. |
| Ownership transfer | A deliberate change in the platform actor responsible for the artifact. | Transfer of copyright, contract, payment, identity, or liability. |
| Platform moderation | Thingtime's safety/policy authority. | A collaborator's project role or permission to settle authorship disputes. |

## Strengths to preserve

- One protected, versioned physical Things collection and relational child
  records already support bounded membership and lifecycle facts.
- Owner-bound writes, current server-side authorization, explicit ACLs, and
  protected Messenger kinds provide a fail-closed starting posture.
- `expectedUpdatedAt` already demonstrates exact-state mutation rather than
  unconditional last-writer-wins.
- Community membership, role ranking, expiry, revocation, use caps, atomic
  redemption, leave, and removal provide reusable lifecycle lessons.
- The provenance, portability, safety, accessibility, continuity, developer,
  AI-agency, and adoption plans already own adjacent guarantees and remedies.

## Gaps that block an honest collaboration claim

1. **No shared-artifact authority model.** ACLs grant reading; generic updates
   still require ownership. There is no explicit co-editor or suggester scope.
2. **No purpose-bound invitation.** Existing invite codes join a community but
   do not preview one artifact, role, capabilities, duration, visibility, or
   departure consequences before acceptance.
3. **No enforced role vocabulary across artifacts.** Messenger roles cannot be
   reused implicitly for Thing writes, and a friendly label is not a server
   authorization rule.
4. **No contribution lifecycle.** Proposed, accepted, rejected, superseded,
   reverted, and disputed changes have no protected relational record.
5. **No conflict experience.** An optional timestamp check can stop stale
   writes, but people cannot compare intentions, preserve both versions, or
   resolve conflicts accessibly.
6. **No complete departure/removal contract.** Future access may end, but the
   product does not define retained contributions, notifications, exports,
   private copies, pending changes, attribution, or dispute routes.
7. **No ownership-transfer contract for ordinary collaborative Things.** Even
   community ownership cannot currently transfer on `develop`.
8. **No periodic access review.** Participants cannot inspect why they have
   access, when it expires, which capabilities they hold, or which artifacts a
   relationship exposes.
9. **No shared-stewardship remedies.** Safety reporting, correction, rights
   disputes, restoration, and support are adjacent plans rather than a joined
   end-to-end journey.
10. **No evidence for a useful collaboration outcome.** Group size, invite
    redemption, edit count, or time spent would not prove that people created
    something useful or understood their authority.

## Candidate minimum contract

This is decision vocabulary, not an approved schema.

- A **collaboration** names one purpose, one current artifact, participant
  eligibility, visibility, available roles, lifecycle state, expiry/review
  dates, accountable steward, and remedy routes.
- A protected relational **collaboration membership** links one account to one
  collaboration with a role, capability-set version, state, inviter, accepted
  terms version, start/end times, and safe reason codes.
- A single-use **invitation** identifies the artifact and proposed role in its
  server-side record. Its preview reveals enough to consent without exposing
  the private artifact to a non-member.
- A bounded relational **contribution event** records proposal, acceptance,
  rejection, application, revert, or dispute against an exact artifact version.
  Content snapshots remain minimized and authorization-aware.
- Every mutation binds actor, current membership, role/capability version,
  artifact, expected version, material change, result, and inverse/remedy path.
- Current authorization wins over historical membership. Revoked or departed
  people cannot mutate from a stale client or replay an earlier approval.
- Provenance can preserve safe attribution after departure without exposing a
  private account, deleted content, hidden identity, or unrestricted history.
- Ownership transfer is a separately confirmed state transition with an
  accessible preview, recipient acceptance, stale-state guard, receipt, and
  recovery path. It changes platform stewardship only.

## Recommended first pilot

Test one **two-person, owner-private shared draft** with consenting adults:

1. An owner chooses one existing private draft and invites one existing trusted
   account as a `suggest` collaborator for one declared purpose and duration.
2. The recipient preview states the artifact label, inviter, role,
   capabilities, visibility, expiry, notifications, and leave/remove effects.
   It reveals no draft body before acceptance.
3. The collaborator proposes bounded edits; the owner accepts or rejects them.
   The pilot does not need real-time co-editing or automatic merge.
4. Every proposal and decision targets an exact version, is attributable,
   reviewable, accessible, and reversible within the stated boundary.
5. Either participant can leave or remove access. The UI explains what remains,
   what no longer works, what cannot be recalled, and where to seek remedy.

Exclude public artifacts, anonymous groups, minors, money, moderation powers,
copyright transfer, external apps, AI agents, background actions, sensitive or
high-impact domains, simultaneous live editing, and more than two people.

## Failure and abuse map

| Failure or abuse | Required posture |
| --- | --- |
| An invite is forwarded or opened by the wrong account | Bind redemption to the intended account or require a new explicit owner decision; reveal no private body before acceptance. |
| A stale tab applies an edit after the artifact changed | Reject against the exact expected version, preserve the proposal, and offer comparison/rebase rather than silently overwriting. |
| A removed member replays a mutation | Re-check current membership and capability on every request; fail closed without revealing new content. |
| The owner removes a person to erase inconvenient authorship | Preserve the minimum authorized attribution/dispute receipt; do not expose private history or turn removal into a public accusation. |
| A collaborator exports or republishes private material | Make visibility and export capability explicit, minimize client delivery, record bounded receipts, and route abuse/rights questions to the appropriate remedy. Do not promise technical recall after disclosure. |
| Two people disagree about the accepted result | Preserve both bounded intentions, distinguish product state from interpersonal agreement, and provide revert, correction, dispute, and support paths. |
| A role change expands authority without comprehension | Preview the capability diff, require appropriate confirmation/acceptance, and invalidate stale sessions or approvals. |
| Departure strands the only steward | Require an accepted transfer or safe archive before the last steward leaves; never guess a successor. |
| Contribution history leaks deleted or newly private content | Current authorization and deletion rules govern projections; keep only approved minimal receipts and honest unavailable states. |
| Collaboration controls are inaccessible | Stop the affected pilot path; keyboard, touch, screen-reader, zoom, language, error, and recovery journeys are release gates. |

## Candidate measures

| Question | Candidate evidence | Guardrail |
| --- | --- | --- |
| Is authority understood? | Participants accurately explain who can see, suggest, accept, invite, remove, export, and transfer before acting. | An acceptance click or successful API response is not comprehension. |
| Is the shared outcome useful? | Both participants judge the agreed draft outcome useful under a predeclared task rubric. | Do not optimize edit count, messages, invitations, or time spent. |
| Are conflicts safe? | Stale-write tests preserve both intentions and recover without unnoticed loss. | A 409 alone is not a usable resolution journey. |
| Can people stop? | Leave and removal complete, stale authority fails, and residual effects are explained. | Do not equate removal with deletion or recall. |
| Is attribution bounded? | Accepted contribution and correction records remain accurate for authorized viewers across role changes. | Do not expose real-world identity, hidden membership, or deleted content. |
| Is the journey accessible? | Complete desktop/mobile journeys pass approved keyboard, touch, screen-reader, zoom, language, and network profiles. | Component-level checks cannot replace end-to-end proof. |
| Do remedies work? | Revert, correction, report, dispute, export, deletion, restore, and support exercises reach an owned outcome. | Keep private content and interpersonal disputes out of analytics. |

## Open questions

1. Is the first collaborator role suggestion-only, bounded editor, or both as
   separate roles?
2. Which Thing families are safe for the pilot, and which fields can a
   contribution change?
3. Must the recipient be a named existing account, or can an opaque link be
   safely bound during redemption?
4. Which invitation facts can be shown before acceptance without revealing the
   artifact or participant graph?
5. What contribution evidence survives rejection, revert, departure, removal,
   deletion, account closure, or a later privacy change?
6. Which actor may accept, reject, restore, change roles, invite others,
   archive, delete, or transfer stewardship?
7. How should blocked accounts, anonymous/pseudonymous authors, and protected
   identities interact with attribution and participant lists?
8. When is `expectedUpdatedAt` sufficient, and when does an artifact need field
   merge, proposal branching, or a CRDT/operational-transform design?
9. What does an ownership transfer change in storage, quotas, attachments,
   links, app grants, exports, moderation, and provenance?
10. Who owns product, authorization, privacy, accessibility, safety, rights,
    reliability, support, and incident decisions for the pilot?

## Refresh checklist

- Re-run scoped Graphify queries for Thing writes, ACLs, shares, Messenger,
  communities, invitations, roles, revisions, and concurrency.
- Re-query PR #649 and any newer collaboration/community work; inspect exact
  heads, tests, CI, preview, and merged state before treating it as a dependency.
- Exercise the real invite, accept, suggest, stale-write, accept/reject, revert,
  leave, remove, and restore journeys when they exist.
- Re-read authorization, HTTP concurrency, accessibility, privacy, and safety
  guidance before approving a technical or policy claim.
- Update this note after an owner decision, implementation milestone, incident,
  or production behaviour changes the evidence.
