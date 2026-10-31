# Collective decision agency and accountable governance baseline

**Evidence snapshot:** 2026-09-09, Australia/Melbourne

**Scope:** the current documentation-garden branch after merging
`origin/develop`, plus public repository and standards evidence reviewed during
this run. This is planning evidence, not a production election, legal opinion,
accessibility conformance claim, or permission to recruit participants.

## Why preserve this note

Thingtime can now compose polls, accept one mutable vote per signed-in account,
and project a live tally. That is a useful expression primitive, but it is not
yet a collective-decision contract. A legitimate decision also needs an
understood purpose, eligible constituency, stable question and options, timing,
privacy, influence boundary, decision rule, accountable response, correction,
appeal, and durable evidence of what happened.

The related [roadmap](../PLAN/collective-decision-agency-and-accountable-governance-roadmap.md)
turns this boundary into gated milestones. The executable backlog lives in
[TODO 36](../TODO/claude-todo/36-collective-decision-agency-and-accountable-governance.md).

## Evidence ledger

| Claim | Evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Polls and live voting are implemented on this repository baseline. | `PostComposer.tsx` authors a poll-shaped Thing; `pollCore.ts`, `vote.ts`, `things.ts`, `PostCard.tsx`, and `PollRenderer` validate, write, tally, optimistically render, and reconcile votes. `TESTING.md` records the manual journey. | High for this commit. Re-run code and live checks after poll, post, projection, ACL, or index changes. |
| One vote means one authenticated Thingtime account slot, not one human. | The server derives `<pollId>~<userId>` and the protected shared `uniqueKeys` index permits one relational vote Thing for that pair. A person may still control multiple accounts; the system does not establish personhood or electorate eligibility. | High for code semantics; no claim about production data. Refresh after account or vote-identity changes. |
| A vote can be moved or removed and visibility is checked on every write. | Choosing a different option updates the existing vote; choosing the same option deletes it. `findViewableThing()` and inherited ACL checks reject a caller who cannot view the poll. | High for the current server path. Re-test concurrency, block, deletion, and ACL changes. |
| Current tallies are engagement projections, not certified results. | `pollVotes` exposes option-aligned counts, total votes, and the viewer's choice. There is no reviewed electorate snapshot, quorum, threshold, result Thing, certification state, implementation commitment, or appeal record in the inspected poll path. | High for the scoped path; medium for the whole repository. Re-run Graphify and route inventory before implementation. |
| `closesAt` is presentation data, not an enforced close. | `PollRenderer` may display `closesAt`, but `voteOnThing()` validates only visibility, poll shape, and option index; it does not reject a late vote. | High for this commit. Recheck whenever time or lifecycle rules are added. |
| Poll definitions are not frozen after voting begins. | Poll shape is read from the current Thing. Tallies ignore vote indexes beyond the current option list instead of preserving a ballot version or producing a reconciliation event. | High for current code. Treat any post-vote edit as a governance blocker until version semantics are approved. |
| Results have meaningful privacy and influence implications. | Signed-in participants see bars after voting; logged-out viewers see results immediately. Vote Things retain owner linkage server-side even though the public projection is aggregate. Small groups, timing, and auxiliary information can still reveal or pressure participants. | High for behavior; risk severity depends on context. Complete a privacy threshold assessment before a pilot. |
| Current accessibility foundations are helpful but not complete-journey proof. | Options are buttons with names and pressed state, optimistic failure is surfaced, and `TESTING.md` includes manual poll checks. This run did not establish keyboard, screen-reader, zoom, language, timing, comprehension, or status-announcement conformance. | Medium. Test the entire approved journey before any accessibility claim. |
| Participation quality requires more than collecting responses. | The [OECD Guidelines for Citizen Participation Processes](https://www.oecd.org/en/publications/2022/09/oecd-guidelines-for-citizen-participation-processes_63b34541.html) emphasize purpose, accountability, transparency, inclusion/accessibility, integrity, privacy, information, resources, feedback, and evaluation. | High as planning input, not a claim that a product poll is a civic process. Recheck before public-sector use. |
| Digital identity and personhood must remain distinct. | [NIST SP 800-63-4](https://pages.nist.gov/800-63-4/sp800-63/introduction/) notes that a person can have multiple digital identities and supports anonymous or pseudonymous accounts where real-life identity is unnecessary. | High for the cited guidance. Qualified review is required before proofing or high-impact eligibility. |
| Privacy and accessibility need explicit design work. | The [OAIC PIA guide](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/privacy-impact-assessments/guide-to-undertaking-privacy-impact-assessments) treats privacy assessment as a way to identify and minimize impacts; its [de-identification guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/handling-personal-information/de-identification-and-the-privacy-act) warns that re-identification risk is contextual. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) requires understandable labels, programmatic control state, and accessible status messages. | High for planning input, not legal or conformance advice. Recheck cited versions and obtain qualified review. |

## Vocabulary that must stay separate

| Layer | Meaning | It does not establish by itself |
| --- | --- | --- |
| Poll | A question with selectable options and a tally. | A proposal, electorate, mandate, or fair decision. |
| Proposal | A versioned action or policy being considered. | Approval, implementation, or authority over affected people. |
| Eligibility | The reviewed rule for who may participate in this decision. | One-human uniqueness, informed participation, or representativeness. |
| Ballot | The exact options and rules presented during one decision version. | Secrecy, coercion resistance, or a correct result. |
| Vote | One eligible actor's recorded choice under a ballot version. | Consent to unrelated actions, identity proof, or truth. |
| Abstention/non-participation | A distinct choice to withhold preference, or no recorded choice. | Agreement with the winner or approval of the process. |
| Tally | Arithmetic over accepted vote records. | Quorum, validity, legitimacy, or implementation authority. |
| Result | The decision rule applied to the final eligible tally. | Certification, mandate, or action completion. |
| Decision authority | Who may decide and what the poll's outcome can change. | Ownership of people, content, rights, funds, or moderation power. |
| Participation receipt | Minimal evidence of what rule/version processed an action. | A public voting history or proof of how a person voted. |
| Audit/remedy | Authorized review, correction, challenge, and repair. | Permission for universal surveillance or public deanonymization. |

## Current strengths to preserve

- Votes are relational child Things rather than an unbounded array on a poll.
- The server owns vote identity, enforces the shared unique slot, and refuses
  generic vote creation.
- ACL visibility is rechecked for each vote and inherited from the target poll.
- Re-votes update in place, unvotes are possible, races fail honestly, and the
  UI rolls back optimistic state on failure.
- Tallies batch-aggregate and expose a compact public shape rather than raw vote
  documents.
- Poll API behavior is registered in the semantic capability manifest and has
  repository tests and a manual checklist.

## Gaps and unresolved decisions

1. **Purpose and authority:** advisory feedback, consent, preference discovery,
   allocation, moderation, and binding governance need different contracts.
2. **Electorate:** there is no frozen eligibility set, membership cutoff,
   exclusion explanation, duplicate-human defense, or appeal path.
3. **Ballot integrity:** question, context, options, ordering, translation,
   close time, and rule are not frozen into an immutable version.
4. **Lifecycle:** there is no server-enforced open/closed/cancelled/disputed/
   certified/implemented state machine.
5. **Result rule:** no quorum, threshold, tie, abstention, invalidation, or
   insufficient-participation rule exists.
6. **Privacy:** public live totals, server-side actor linkage, small groups, and
   timing may expose choices or create bandwagon and retaliation risks.
7. **Accountability:** organizers do not yet commit to how input will be used,
   explain departures, publish implementation status, or provide challenge and
   remedy.
8. **Inclusion:** access to a poll is not proof that language, disability,
   device, time, safety, or information barriers were addressed.

## First reversible pilot

If the owner approves implementation, begin with one non-binding advisory poll
inside one owner-selected private adult test group, using a synthetic,
non-sensitive question whose outcome changes no person's rights, access, money,
work, school, health, safety, moderation status, or public representation.

Before opening, publish the purpose, organizer, eligible accounts and cutoff,
exact ballot version, source context, open/close times, whether totals are
hidden until close, change/withdraw rules, decision rule, use of input, privacy
boundary, retention, support, cancellation, challenge, and deletion limits.
Include an explicit abstain option. After close, publish the eligible count,
turnout denominator, abstentions, final counts, rule application, limitations,
organizer response, and implementation status without exposing individual
choices.

This pilot tests whether people understand and can safely exercise the contract;
it does not test political legitimacy or authorize delegated, quadratic,
ranked, token-weighted, secret, anonymous, public, or binding voting.

## Candidate measures

| Question | Candidate evidence | Guardrail |
| --- | --- | --- |
| Is the decision understood? | Participants identify purpose, authority, eligibility, close, privacy, rule, effect, and remedy before voting. | Opening or voting is not informed understanding. |
| Is the ballot stable? | Every accepted vote references one immutable ballot/rule version and late writes fail. | A mutable post timestamp is not a ballot version. |
| Is inclusion visible? | Eligible, participated, abstained, excluded, blocked, and failed counts are reported separately. | Turnout cannot prove representativeness or agreement. |
| Is privacy bounded? | Payload, log, cache, export, support, and small-group review finds no unapproved choice disclosure. | Aggregate counts are not automatically anonymous. |
| Is correction real? | Change/withdraw, cancellation, dispute, recount, and implementation-correction exercises reach the approved state. | Silent tally replacement is not remedy. |
| Is accountability closed-loop? | The organizer responds by the declared time and links result to implemented, declined, delayed, or superseded status. | Publishing numbers alone is not accountability. |

## Stop conditions

Pause intake and disable the narrowest affected capability if eligibility or
ballot version changes silently; a late, duplicate, ineligible, or withdrawn
vote is counted incorrectly; an individual choice is exposed or inferable
beyond the approved boundary; coercion, retaliation, brigading, manipulation,
or accessibility exclusion cannot be contained; totals, result, organizer
response, or implementation state is misleading; or challenge and support
cannot reach an accountable remedy.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, data cleanup, and owner approval.

## Refresh checklist

- Re-run Graphify queries for poll shape, vote identity, ACLs, projections,
  lifecycle fields, subspace membership, moderation, deletion, logs, and API
  capabilities.
- Exercise compose, eligible/ineligible vote, move, withdraw, concurrent write,
  close, edit, delete, result, dispute, account switch, block, and restore paths
  when those states exist.
- Re-read the cited OECD, NIST, OAIC, and W3C guidance and obtain qualified
  privacy, security, accessibility, safety, governance, and legal review before
  higher-risk use.
- Update this note after an owner decision, poll contract change, incident,
  pilot, production-behavior change, or new evidence.
