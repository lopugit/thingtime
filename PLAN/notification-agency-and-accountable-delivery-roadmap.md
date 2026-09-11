# Notification agency and accountable-delivery roadmap

**Status:** Proposed

**Prepared:** 2026-09-09, Australia/Melbourne

**Evidence:** [Notification agency and accountable-delivery baseline](../NOTES/notification-agency-and-accountable-delivery-baseline.md)

**Execution epic:** [TODO 37 — Notification agency and accountable delivery](../TODO/claude-todo/37-notification-agency-and-accountable-delivery.md)

## Outcome

Make every notification claim as narrow as its evidence. A person can tell
whether Thingtime recorded an event, attempted a channel, received a provider
receipt, presented a status, marked it read, verified an action outcome, or
offered a remedy—and can see when any state is unknown, failed, expired, or
superseded.

The first proof is one synthetic, owner-triggered, non-sensitive action result
inside Thingtime. External delivery comes later, one channel and evidence
contract at a time.

## Boundaries with adjacent roadmaps

- [Attention agency and calm use](./attention-agency-roadmap.md) owns whether,
  when, and where to interrupt, including defaults, quiet windows, batching,
  and urgency. This roadmap owns the truthful event-to-remedy evidence model.
- [Service continuity and recovery](./service-continuity-and-recovery-roadmap.md)
  owns critical-journey objectives, degraded operation, restore, and incidents.
  This roadmap may expose a delivery failure but cannot redefine service truth.
- [Content provenance and correction](./content-provenance-and-correction-roadmap.md)
  owns authorship, revisions, source assertions, and content corrections. A
  notification receipt is not proof that its content is true.
- [Data portability and graceful exit](./data-portability-and-exit-roadmap.md)
  owns account-wide inventory, export, deletion, closure, and verified exit.
- [Accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md)
  owns the shared journey matrix, interaction foundation, locale, and
  conformance-evidence boundary.
- Domain roadmaps for safety, collaboration, identity, governance, commerce,
  learning, and AI own their decisions and remedies. This roadmap supplies a
  reusable notification lifecycle; it never gains their authority.

## Non-goals

- Maximizing opens, clicks, response speed, daily return, or delivery volume.
- Treating history, transport receipts, read state, or acknowledgement as proof
  of attention, understanding, consent, agreement, or outcome.
- Shipping push, email, SMS, marketing, urgent, critical, or bulk delivery in
  the first pilot.
- Building sender-visible read receipts, presence, surveillance, or response-
  latency profiles.
- Retrofitting certainty onto old rows whose lifecycle evidence was never
  collected.
- Turning application logs, provider dashboards, or analytics into a shadow
  notification history.
- Using notifications as the canonical state of an action, moderation case,
  payment, vote, account, or shared artifact.
- Claiming legal compliance or accessibility conformance from this plan.

## Principles

1. **One state, one meaning.** Recorded, requested, accepted, received,
   presented, read, acknowledged, acted on, verified, and remedied stay
   separate.
2. **Unknown is honest.** Missing evidence never becomes implied success.
3. **Canonical state wins.** Notifications point to product truth; they do not
   replace it.
4. **History and interruption are separate choices.** Preserving a record must
   not silently enable a channel.
5. **Producer authority is bounded.** A client, server, app, moderator, or
   provider may assert only its registered observation.
6. **Sensitive by context.** Storage, in-app detail, lock screen, email, logs,
   and assistive announcements use distinct disclosure policies.
7. **Remedy beats decorative certainty.** Consequential messages include an
   owned correction, support, appeal, recovery, or retry path.
8. **No attention surveillance.** Evaluation measures fidelity,
   comprehension, accessibility, recovery, and minimisation—not engagement.

The [relationship agency and consentful connection roadmap](./relationship-agency-and-consentful-connection-roadmap.md)
owns relationship states, who may act, and the effects of stopping. This
roadmap owns the separate event, history, channel, presentation, read, outcome,
and remedy evidence for any request, acceptance, removal, or block notice.

## Candidate contract

Each registered event family should declare:

- semantic feature/version, producer authority, recipient rule, subject kind,
  immutable event time, persistence time, and canonical outcome reference;
- history eligibility, history template, sensitivity class, retention/export/
  delete behavior, search fields, expiry, and supersession key;
- each channel's eligibility, consent/default, bounded template, urgency, TTL,
  deduplication/grouping, retry, provider evidence, and honest user-facing
  labels;
- presented/read/acknowledged/action semantics, including which transitions
  require an explicit user act and which are unavailable;
- correction, support, appeal, retry, security review, or other remedy owner;
  and
- accessibility/locale profiles, abuse cases, operational objectives, stop
  thresholds, and capability requirements.

Lifecycle events should be bounded relational Things linked to the source
notification or canonical subject. Do not grow one unbounded nested attempt or
receipt array. Public/API projections reveal only owner-authorized fields.

## Milestone N0 — Approve the charter and vocabulary

**Outcome:** every proposed label has one narrow meaning before schema or UI
work.

- Approve the lifecycle vocabulary from the evidence note and explicitly map
  current `createdAt`, `readAt`, `historyOnly`, and `outcome` behavior.
- Select the one synthetic private action and its deterministic canonical
  completion predicate.
- Decide event/history/presentation/read/expiry/supersession/remedy semantics,
  temporary retention, export/delete behavior, and unavailable old-row state.
- Decide which fields are immutable snapshots versus current projections.
- Define the no-analytics evaluation and approved accessibility profiles.
- Name product, notification, action-domain, privacy/security, accessibility/
  language, reliability, operations, support, and incident owners.
- Record durable architecture and retention decisions in `DECISIONS.md`.

**Gate:** the owner and qualified reviewers approve one decision packet; no
code, data collection, channel, or participant recruitment is authorized by
this roadmap alone.

## Milestone N1 — Characterize current truth and failure

**Outcome:** tests freeze what today's system can and cannot prove.

- Trace each current notification producer through authorization, protected
  persistence, preference checks, APNs/email adapters, UI caches, history,
  read controls, target links, action outcomes, logs, metrics, and errors.
- Inventory every event type's actor/recipient/target semantics, sensitivity,
  delivery defaults, duplicates, retention, deletion, and remedy.
- Reproduce history-only, push/email off, all on, failed persistence, provider
  failure, stale target, account switch, retry, and concurrent duplicate paths.
- Label existing history rows as legacy evidence; never infer missing provider,
  display, or attention states.
- Verify capability manifest coverage and identify any undocumented executable
  route or semantic change before implementation.

**Gate:** deterministic fixtures and a signed-off matrix state exactly what each
current field and path proves, does not prove, and cannot reconstruct.

## Milestone N2 — Register the protected lifecycle

**Outcome:** lifecycle evidence is versioned, relational, bounded, and
authoritative only within its scope.

- Add a canonical event/receipt registry with semantic versions, producer
  allowlists, state transitions, templates, sensitivity, retention, expiry,
  supersession, remedies, and required tests.
- Store attempts and receipts as bounded relational Things with protected
  server writers, versioned getters, indexes, idempotency keys, quotas, and
  batch reads—never an unbounded embedded history.
- Bind event, notification, receipt, and canonical outcome with opaque
  identifiers safe for the owner-facing projection. Keep provider identifiers,
  tokens, payloads, credentials, and infrastructure details private.
- Define a monotonic state machine that preserves failed/expired/superseded
  evidence without letting late retries rewrite history as timely success.
- Register every API change in route source, Nitro import map, docs, capability
  manifest, and explicit client requirements with deliberate SemVer.
- Build expand/coexist/migrate/verify/contract behavior for legacy rows; no
  deploy may make existing history unreadable.

**Gate:** unit and integration tests reject forged, replayed, cross-account,
cross-origin, stale, unknown, out-of-order, oversized, and invalid transitions.

## Milestone N3 — Make in-app state understandable

**Outcome:** a person can inspect one event without being interrupted or
misled.

- Show plain-language event, record, presentation, read, action-outcome,
  expiry/supersession, and remedy states only when supported by evidence.
- Keep unread as a navigation aid, not a responsibility score or success claim.
  Explain any automatic read transition.
- Resolve links against current authorization and canonical state. Stale,
  deleted, private, revoked, failed, or unavailable targets get safe recovery
  copy rather than a misleading action.
- Keep cached history visible while refetching; reconcile exact account and
  endpoint state without a loading flash or cross-account cache leak.
- Use programmatically determinable status updates without stealing focus or
  producing duplicate live-region announcements.
- Provide owner-facing export/delete and the approved remedy for the pilot;
  coordinate account-wide behavior with TODO 23.

**Gate:** desktop/mobile, keyboard, touch, screen reader, zoom/reflow, reduced
motion, locale, long text, slow/offline, stale-link, and account-switch journeys
pass with no state overclaim.

## Milestone N4 — Prove one private in-app pilot

**Outcome:** one low-risk action lifecycle is useful and truthful end to end.

- Use consenting adults and synthetic accounts/content for one owner-triggered,
  non-sensitive action with an easy reversible or no-op effect.
- Record the approved server observation and history row, present one in-app
  status, and link to the canonical action result and remedy.
- Exercise accepted, complete, failed, timeout, cancelled, retry, duplicate,
  stale target, reload, offline, deletion, expiry, and supersession cases.
- Evaluate state comprehension, receipt fidelity, accessibility, recovery, and
  data minimisation through structured sessions with no attention analytics.
- Delete temporary pilot data at the approved date and publish aggregate
  conditions, failures, remedies, limitations, owners, and refresh date.

**Gate:** all lifecycle labels reproduce their evidence, participants can
distinguish read from outcome, and no private content reaches an unauthorized
surface.

## Milestone N5 — Add one channel only if justified

**Outcome:** an approved channel adds value without claiming more than its
provider evidence or weakening calm-use controls.

- Revisit whether any external channel is needed. Prefer no new channel when
  in-app history and status satisfy the approved outcome.
- If justified, select one event family and one channel; document permission,
  preference, urgency, TTL, templates, sensitivity, batching, retry, provider
  acceptance/receipt semantics, failure, unsubscribe, expiry, and support.
- Preserve TODO 24's quiet/default decisions and platform-level controls.
- Label provider acceptance, device acknowledgement, and unknown delivery
  exactly; never label them seen, read, understood, or completed.
- Test revoked permission, invalid token, provider outage, late receipt,
  offline device, multiple devices, duplicate collapse, stale notification,
  and target authorization changes.

**Gate:** external delivery remains optional, no sensitive disclosure occurs,
and exact receipt/failure semantics pass real-provider tests before wider use.

## Milestone N6 — Operate, review, and retire safely

**Outcome:** the lifecycle remains bounded as producers, channels, and policies
change.

- Add registry coverage that fails for missing semantics, templates, retention,
  sensitivity, remedy, accessibility, capability, or test ownership.
- Monitor aggregate attempts, terminal states, unknowns, latency, expiry,
  duplicates, provider errors, storage pressure, remedy completion, and severe
  accessibility/privacy incidents without message content or person profiles.
- Drill provider failure, database degradation, backlog recovery, key/token
  rotation, stale clients, bad template rollback, export/delete, and restore.
- Review retention, channels, event families, urgency, remedies, and support
  capacity at a fixed cadence. Remove unused paths and expire temporary data.
- Publish honest scope, evidence, known unknowns, incidents, corrections,
  accessibility coverage, and next review date.

**Gate:** every active producer/channel has a current owner, evidence contract,
bounded data lifecycle, tested remedy, and safe disable path.

## Success measures

| Measure                    | Proposed definition                                                                              | Required guardrail                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Semantic accuracy          | User-facing lifecycle labels match deterministic evidence in every fixture.                      | Unknown or absent evidence is never scored as success.        |
| State comprehension        | Pilot participants distinguish recorded, presented, read, acknowledged, and outcome.             | No optimization for faster acknowledgement or more opens.     |
| Recovery completion        | People reach canonical state or remedy after stale/failure scenarios.                            | Notifications never replace the canonical product record.     |
| Preference fidelity        | History and each channel follow their separately approved choices.                               | Explicit old choices survive migration and account switching. |
| Accessibility completeness | Approved complete journeys pass all named interaction/language profiles.                         | Automated checks alone cannot satisfy the gate.               |
| Data minimisation          | Stored fields and retention match the approved purpose and deletion proof.                       | Provider/log/metric data cannot become a shadow history.      |
| Operational truth          | Attempt, acceptance, receipt, expiry, and failure totals reconcile within the approved envelope. | Aggregate operations cannot infer individual attention.       |

## Stop conditions

Pause the pilot or disable the narrowest affected producer/channel if a label
overstates evidence; a forged or cross-account event is accepted; history or a
channel ignores preferences; a read state is used as consent/outcome; sensitive
content reaches a lock screen, email, log, metric, or unauthorized account;
late/stale messages cause unsafe action; retries flood or rewrite evidence;
retention/export/delete behavior diverges from the contract; accessibility
announcements are missing or coercively repetitive; remedies are unavailable;
or evaluation requires attention surveillance.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, correction/remedy, regression proof, cleanup, and owner
approval.

## First decision packet

The next owner session should decide:

1. the lifecycle vocabulary and honest labels;
2. the one synthetic private action and canonical outcome predicate;
3. current-field and legacy-row semantics;
4. immutable snapshot versus current-projection fields;
5. temporary retention, export, deletion, expiry, and supersession;
6. sensitivity templates and forbidden surfaces;
7. read, acknowledgement, remedy, and support meanings;
8. no-analytics evaluation and accessibility profiles;
9. accountable owners and stop thresholds; and
10. whether any external channel is needed after the in-app pilot.

No schema, API, channel, data collection, or pilot should begin until that
packet is approved.
