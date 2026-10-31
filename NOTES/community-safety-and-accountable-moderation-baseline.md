# Community safety and accountable moderation baseline

**Evidence snapshot:** 2026-09-03, Australia/Melbourne

**Repository baseline:** automation PR #557 at `0d4bb905`; current
`origin/develop` at `4387af925`

**Scope:** public Things, profiles, chats, communities, moderation utilities,
API documentation, and related planning artifacts. This is a repository
snapshot, not a production safety audit, legal opinion, or claim about the
amount or type of harm experienced by people using Thingtime.

## Why preserve this note

Thingtime already has useful safety primitives, but they sit in separate
systems: community roles and removal, invite limits, message-request buckets,
per-chat mute, and automated post/media screening with an admin review queue.
The missing layer is the human accountability loop that connects a person who
needs help to a bounded case, a reasoned decision, an appeal, and privacy-safe
evidence that the system is improving.

The related
[community safety and accountable moderation roadmap](../PLAN/community-safety-and-accountable-moderation-roadmap.md)
sequences that work. The implementation backlog is
[TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md).

## Evidence ledger

| Claim | Repository evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Communities have a relational membership wall and three roles. | [`communities.ts`](../remix/app/api/utils/messenger/communities.ts) defines `owner`, `admin`, and `member` checks, caps ownership, and removes a departing member's channel memberships in the same storage transaction. | High for this commit. Re-read after community/member schema or transaction changes. |
| Community admins can manage membership and invites. | `manageCommunityMember` can promote, demote, or remove non-owners. `createInvite` supports expiry, use caps, revocation, a live-invite cap, and atomic redemption. Routes and public contracts are registered in [`apiDocs.ts`](../remix/app/docs/apiDocs.ts). | High for repository behavior; not live-tested in this run. |
| People can gate unexpected conversations and quiet a chat. | [`RequestsView.tsx`](../remix/app/components/Messenger/RequestsView.tsx) separates follower and unknown requests and supports accept/decline. [`ChatDetailsDrawer.tsx`](../remix/app/components/Messenger/ChatDetailsDrawer.tsx) exposes per-chat mute and leave/remove controls. | High for source presence. UI behavior needs live re-verification before a shipped claim. |
| Automated moderation is durable for supported post-family text and attachments. | [`analyzeText.ts`](../remix/app/api/utils/moderation/analyzeText.ts) screens `post`, `comment`, and `share`, can keep content owner-private while pending, writes protected stamps/flags, and preserves admin overrides. [`analyzeAttachment.ts`](../remix/app/api/utils/moderation/analyzeAttachment.ts) quarantines pending/blocked attachments and creates deterministic admin flags. The bounded sweep and review API are documented in [`apiDocs.ts`](../remix/app/docs/apiDocs.ts). | High for the implemented contract. Provider configuration, live coverage, and false-positive behavior were not exercised here. |
| Private message prose is outside the current text-moderation set. | `TEXT_MODERATED_THINGTIMES` names only `post`, `comment`, and `share`; it does not include `message`. This is a scope fact, not a recommendation to send private messages to a model. | High for this commit. Refresh if the set or messenger write path changes. |
| The admin queue is content-verdict oriented, not a user-report case system. | [`moderationAdmin.ts`](../remix/app/api/utils/moderation/moderationAdmin.ts) lists model-created flags and lets site admins set clear/NSFW/block outcomes. The flag record does not represent reporter acknowledgement, policy basis, case events, community jurisdiction, target notification, or appeal state. | High for the data shape. Recheck after moderation kinds or admin APIs change. |
| No user-facing content/account report, appeal, or account-block contract was found. | A scoped search of `remix/app`, API docs, route names, and Thing constructors found no `reportMessage`, `reportPost`, `blockUser`, `user-block`, `content-report`, or safety-appeal path. Existing uses of “report” concern devices, migrations, or operational results. Chat mute changes notification behavior; it is not an account block. | High for this snapshot, not proof that production has no external support channel. Repeat the scoped search and inspect the live product before implementation. |
| Community roles do not yet form a scoped moderation workflow. | Community admins can manage membership, while moderation review is reserved for site admins. No repository contract currently assigns reports, evidence access, decisions, or appeals to a community moderator with bounded jurisdiction. | High for the current source model. Refresh after messenger/community or moderation changes. |
| Open issues do not represent the safety backlog. | GitHub returned zero open issues during this run while the TODO tree and open PRs contain substantial unfinished work. | High only for the timestamp. Never infer “no safety problems” from an empty issue list. |

## External design references

These sources inform the decision packet; they do not establish that a law
applies to Thingtime or that the product currently conforms.

- Australia's eSafety Commissioner frames Safety by Design around service
  provider responsibility, user empowerment and autonomy, and transparency and
  accountability. It recommends usable safety tools, report feedback, appeal
  opportunities, accessible rules, and aggregate effectiveness evidence:
  [Safety by Design](https://www.esafety.gov.au/industry/safety-by-design) and
  [Empowering users to stay safe online](https://www.esafety.gov.au/industry/safety-by-design/foundations/empowering-users-to-stay-safe-online).
- The European Commission's plain-language Digital Services Act guidance uses a
  useful procedural pattern: acknowledge a notice, communicate the final
  decision, and provide an internal or independent appeal path. Treat this as a
  product-design reference unless counsel determines applicability:
  [DSA notice and action mechanism](https://digital-strategy.ec.europa.eu/en/policies/dsa-notice-and-action-mechanism).

## Current strengths to preserve

- Membership, invites, messages, moderation flags, and social relationships are
  relational Things rather than unbounded arrays on a parent.
- Role checks and generic-CRUD protection create a foundation for
  least-privilege writes.
- Invite expiry, use caps, revocation, and atomic redemption reduce simple raid
  and replay paths.
- Unknown-message requests do not silently become active conversations.
- A mute is local to the person choosing it; the other participant is not given
  a retaliation signal.
- Automated content screening has protected stamps, retry paths, sticky blocks,
  and an admin override instead of treating one model call as infallible.
- Blocked content is removed from ordinary projections while authorized admin
  evidence access remains separate.

## Gaps that block responsible community scale

1. **No immediate account-level safety boundary.** Declining one request or
   muting one chat does not define what happens to future requests, invites,
   mentions, recommendations, profile access, or shared-community contact.
2. **No report intake contract.** A person cannot point to a specific post,
   comment, message, profile, community, or invite, choose a reason, add bounded
   context, and receive a stable acknowledgement.
3. **No case lifecycle.** There is no durable state machine for received,
   triaged, decided, communicated, appealed, reversed, expired, or closed.
4. **No policy basis or reason taxonomy.** Model categories are not a public
   community standard, and an admin verdict is not a plain-language explanation
   of which rule applied.
5. **No scoped moderator jurisdiction.** Community admins can remove members,
   but there is no least-privilege report queue or separation between community
   action and site-wide account/content enforcement.
6. **No appeal and correction loop.** Authors and reporters have no bounded way
   to challenge a material decision or learn that it changed.
7. **No trustworthy transparency layer.** There is no privacy-safe aggregate
   view of report volume, response time, reversals, repeat harm, automation use,
   or moderation capacity.
8. **Private-message safety needs a distinct design.** Sending every private
   message to an external model would create a major privacy boundary. Reports,
   local controls, encryption direction, authorized evidence access, and urgent
   escalation must be decided together rather than copied from public posts.

## Abuse and failure map

| Risk | Design implication |
| --- | --- |
| Harassment, stalking, or repeated unwanted contact | Give the affected person an immediate quiet boundary that does not wait for moderator action or notify the blocked account. |
| Community raids and invite leakage | Keep expiring/revocable invites, add join velocity and moderator tooling, and avoid public member enumeration. |
| Coordinated false reporting | Rate-limit by risk, deduplicate exact target/reason combinations, detect bursts in aggregate, and never let report count alone decide guilt. |
| Moderator misuse or capture | Bound jurisdiction, require reasons, append audit events, separate community actions from site actions, and provide escalation/appeal. |
| Automated false positives or policy drift | Version policy and model configuration, preserve reviewable evidence, sample safely, and require human review for durable high-impact sanctions. |
| Retaliation against reporters | Hide reporter identity from the target by default; expose it to moderators only when necessary and authorized. |
| Evidence overcollection | Store references and hashes by default; copy content only under an approved purpose, access, encryption, retention, and deletion contract. |
| Deletion used to erase a serious incident | Decide legal/safety preservation separately; never silently retain all deleted private content “just in case.” |
| Urgent or illegal-content reports | Publish a clear escalation path designed with qualified safety/legal input; do not promise emergency response the service cannot staff. |
| Child safety or age-sensitive spaces | Do not infer age or bolt on invasive identity collection. Decide eligibility, guardian, reporting, and high-risk escalation with specialist review before launch. |

## Candidate principles

1. **Control now, adjudicate later.** Block/mute/leave/close-invite actions reduce
   exposure immediately even when the case queue is slow.
2. **One event-sourced case history.** Every report, assignment, decision,
   reason, notification, appeal, and reversal is a bounded relational event;
   current state is derived, not silently rewritten.
3. **Policy and model are different.** A classifier proposes evidence or a
   temporary visibility action; a versioned policy and authorized human own
   durable sanctions.
4. **Minimum necessary evidence.** Do not duplicate private content, contact
   graphs, or identity details without a documented necessity and retention
   decision.
5. **Reporter privacy is not total anonymity.** Explain what moderators can see,
   what the target can see, and the limits imposed by legal or urgent-safety
   duties.
6. **Accessible, calm, and non-punitive UX.** Reporting must be usable under
   stress without dark patterns, forced confrontation, or a maze of categories.
7. **Transparency without a harassment dashboard.** Publish coarse aggregate
   evidence with minimum counts and delay; never expose person or small-group
   histories.
8. **Capacity is a release dependency.** Do not scale invitations or public
   communities faster than humans, tools, and escalation paths can support.

## Open questions

1. Which personal block semantics apply across profiles, follows, requests,
   invites, mentions, feeds, existing chats, shared communities, and APIs?
2. Which report surfaces ship first, and can a person report content they can no
   longer open without retaining the full content in the client?
3. Which policy taxonomy is small enough to understand yet sufficient for
   routing, urgency, and transparency?
4. Who may moderate a community, what can they see/do, and which actions require
   site-admin escalation?
5. What evidence is necessary for public content, private messages, deleted
   content, and attachments, and how long may each class remain?
6. Which actions are temporary and reversible by default? What threshold
   permits immediate site-wide suspension?
7. What response targets are honest at Thingtime's current staffing level?
8. How are reporters and affected authors updated without revealing another
   person's private enforcement details?
9. What appeal window, reviewer independence, and reversal remedy are feasible?
10. Which aggregate measures are useful without making small groups or rare
    harms identifiable?
11. Does any launch jurisdiction require a distinct notice, complaint, evidence,
    transparency, or law-enforcement process? Counsel, not this note, decides.
12. Which safety controls remain available when automated moderation providers
    are off, unavailable, or intentionally excluded from private content?

## Refresh checklist

Before changing a claim or milestone to shipped:

1. fetch the integration branch and inspect the exact moderation, messenger,
   community, schema, route, API-doc, capability, and test state;
2. exercise report/block/mute/leave/invite/revoke/appeal paths in a live desktop
   and mobile browser where implemented;
3. verify private, public, deleted, blocked, pending, appealed, and restored
   target states through the real API;
4. inspect current queue capacity, response evidence, incidents, support paths,
   open PRs/issues, CI, and deployment receipts without copying user content;
5. refresh applicable legal/safety guidance with qualified reviewers; and
6. date the evidence pack and retain explicit limitations.
