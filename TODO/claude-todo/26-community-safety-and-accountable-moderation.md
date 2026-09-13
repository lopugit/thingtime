# 26 — Community safety and accountable moderation 🛡️

**Status:** 🟣 Proposed · planning only · added 2026-09-03

**Owner:** Unassigned; product owner names policy, trust/safety, community,
privacy/security, accessibility, legal, engineering, and operations owners

**Plan:**
[`PLAN/community-safety-and-accountable-moderation-roadmap.md`](../../PLAN/community-safety-and-accountable-moderation-roadmap.md)

**Evidence:**
[`NOTES/community-safety-and-accountable-moderation-baseline.md`](../../NOTES/community-safety-and-accountable-moderation-baseline.md)

## Goal

Connect Thingtime's shipped community roles, invite controls, message requests,
chat mute, and automated moderation pipeline into a humane safety system:
immediate personal boundaries, specific reports, durable case state, scoped
moderator authority, understandable decisions, appeals, remedies, and
privacy-safe operational evidence.

This epic does not authorize new data kinds, private-message scanning, public
safety claims, response-time promises, or legal processes by itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative.
- [TODO 15](./15-anti-abuse-storage-hardening.md) owns global storage and
  anonymous-write abuse brakes. Safety reports must reuse shared bounded,
  fail-closed primitives rather than create a second limiter.
- Existing community/member/invite behavior lives in
  [`communities.ts`](../../remix/app/api/utils/messenger/communities.ts); extend
  its relational and transactional patterns instead of embedding case history.
- Existing model flags and site-admin review live in
  [`api/utils/moderation/`](../../remix/app/api/utils/moderation/) and are one
  evidence source, not the report/case/policy source of truth.
- [TODO 19](./19-anonymous-group-chats.md) must state the honest limit that
  authorized moderators may resolve identities. A report projection must not
  expose those identities to participants.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns the complete
  journey and locale release gates for stressed reporting, decisions, appeals,
  and safety help.
- [TODO 24](./24-attention-agency-and-calm-use.md) owns notification defaults;
  safety delivery may override quiet behavior only under an approved urgent
  class.
- Open PRs and source presence are not production evidence. Recheck exact head,
  capability manifest, CI, preview, and live behavior before shipped status.

## Phase 0 — Owner decisions

- [ ] Approve account-block semantics for profiles, follows, message requests,
      invites, new/existing chats, mentions, feeds, recommendations, shared
      communities, notifications, and direct API calls.
- [ ] Select the first reportable target kinds. Recommended start: public post,
      comment, profile, and active chat-message references; no automatic private
      message scanning.
- [ ] Approve a small versioned policy/reason taxonomy and separate safety,
      illegal-content notice, security, product-feedback, and IP processes.
- [ ] Define community moderator jurisdiction, site-admin escalation, conflicts,
      recusal, and owner appeals.
- [ ] Approve reporter/target/moderator/admin projections and what each party is
      told at every state.
- [ ] Approve evidence purpose, reference/snapshot rules, encryption, access
      logs, retention, deletion, holds, and incident handling.
- [ ] Set honest service hours, response targets, urgent escalation boundaries,
      appeal windows, staffed capacity, and launch/stop thresholds.
- [ ] Record architectural and policy forks in `DECISIONS.md`.

**Gate:** no implementation until this packet is accepted.

## Phase 1 — Immediate personal controls

- [ ] Add one protected, deterministic account-block relation through a
      dedicated API utility; never expose it through generic Thing CRUD.
- [ ] Keep mute separate from block and document exact effects for each surface.
- [ ] Enforce the boundary server-side on every approved read/write/notify path,
      including stale clients and direct API calls.
- [ ] Apply block/mute/leave optimistically from account-scoped cache, reconcile
      in the background, and never leak state across accounts/endpoints.
- [ ] Do not notify the blocked account or reveal the block through a distinct
      error oracle. Document unavoidable shared-community visibility.
- [ ] Provide a safety/help entry point that works after content is edited,
      deleted, pending, blocked, or no longer accessible.

## Phase 2 — Report and case contracts

- [ ] Add protected report, case, case-event, and appeal schemas only after the
      names and lifecycle are approved. Appended events are relational children
      loaded in batches, never embedded arrays.
- [ ] Register route, server import map, API docs, semantic capability feature
      and version, runtime census, compatibility tests, body caps, auth,
      idempotency, and fail-closed rate limits together.
- [ ] Resolve the exact target kind/id and target revision/fingerprint. Define
      behavior for foreign, private, blocked, edited, deleted, and unavailable
      targets without creating an existence oracle.
- [ ] Use a small reason picker, bounded optional context, accessible examples,
      and a distinct urgent-help route. Do not force legal classification.
- [ ] Return a stable acknowledgement and allowlisted status path. Reporter
      views never expose target-private notes or precise sanctions.
- [ ] Group accidental retries and related reports without treating volume as
      proof or losing distinct reporters.
- [ ] Reference content by default. Any copied evidence must use the approved
      encryption, access, retention, deletion, and audit contract.

## Phase 3 — Review, action, and appeal

- [ ] Build separate scoped queues for community and platform decisions.
      Permission tests must prove a moderator cannot cross communities or read
      unrelated messages/contact graphs.
- [ ] Require policy version, reason, scope, duration/expiry, actor, evidence
      access, and timestamp for each material action.
- [ ] Support reversible community actions first: content hide, timeout, channel
      removal, invite freeze, member removal, and site escalation.
- [ ] Treat automated moderation stamps as versioned suggestions/evidence. A
      model may quarantine where approved but cannot be the sole basis for a
      durable high-impact account sanction.
- [ ] Notify affected parties through allowlisted views and Lopu; protect
      reporter identity and avoid revealing another person's private history.
- [ ] Accept eligible appeals without overwriting the original decision, assign
      an appropriately independent reviewer, append the result, and apply a
      tested remedy/reversal.
- [ ] Preserve a bounded audit trail for assignments, evidence access,
      decisions, communications, appeals, reversals, and closure.

## Phase 4 — Operations and transparency

- [ ] Add privacy-safe queue/capacity, response-time, severe-miss, reversal,
      automation-disagreement, stale-case, and failed-notification measures.
- [ ] Define minimum cohorts, suppression, delay, retention, access, and deletion
      before any dashboard or public transparency view.
- [ ] Alert on urgent backlog, old cases, unexplained actions, cross-scope access,
      retention failures, and provider/sweep failures without logging content.
- [ ] Add policy/model version review, redacted quality sampling, moderator
      training/handoff, incident response, kill switches, and rollback.
- [ ] Run false-report, raid, moderator-misuse, evidence-leak, edit/delete race,
      provider-outage, stale-client, and replay exercises.
- [ ] Add the complete desktop/mobile/keyboard/screen-reader/locale journeys to
      `TESTING.md` before promotion.
- [ ] Publish aggregate transparency only after two cycles meet the approved
      quality, privacy, capacity, appeal, and accessibility gates.

## Security, privacy, and abuse requirements

- Reports, cases, appeals, blocks, and enforcement events are protected system
  kinds written only by dedicated utilities through named collection getters.
- Every write has a strict allowlist, size cap, rate limit, idempotency key,
  authorization decision, and audit event. Unknown fields fail closed.
- Reporter identity is hidden from the target by default and visible to
  moderators only when necessary for the approved purpose.
- No raw message, Thing, profile, contact graph, token, URL credential, or
  external endpoint appears in product analytics or ordinary logs.
- Private content is never sent to a new external moderation provider without a
  separate approved purpose, consent/authority, data-flow, retention, and
  incident review.
- Evidence access is least-privilege and logged. Community roles never inherit
  site-admin access.
- Report count, reputation, follower count, payment status, or model score alone
  never establishes guilt or removes appeal rights.
- Deletion and retention behavior is explicit; safety preservation exceptions
  require narrow authority rather than indefinite silent copies.
- Block/report/error responses do not become account, membership, private
  content, or enforcement-state enumeration oracles.
- Legal and urgent-safety workflows are reviewed by qualified owners and make
  no promise beyond verified staffing and jurisdiction.

## Acceptance criteria

- The approved policy, roles, first target set, block matrix, evidence contract,
  response targets, appeal path, capacity, and stop conditions are linked from
  the roadmap and decisions log.
- Block, mute, leave, report, status, decision, and appeal semantics are
  understandable without reading code and remain distinct.
- Server tests cover every approved cross-surface block path, direct API access,
  account switching, custom endpoints, stale clients, and no-target-notification
  behavior.
- Report retries converge; exact target revisions remain attributable; target
  edits/deletion cannot silently rewrite a case; and report volume alone has no
  enforcement effect.
- Reporter, target, community moderator, and site-admin projections expose only
  approved fields; cross-community and private-message access tests fail closed.
- Every material action has actor, policy/reason version, scope, time, expiry,
  evidence-access trail, notification result, and reversible/remedial path.
- Eligible appeals preserve the original decision and can reverse derived
  visibility/access state without direct database edits.
- Automated suggestions record provider/model/policy context and durable
  sanctions require the approved human review.
- New endpoints appear in route files, the Nitro import map, API docs, and the
  origin-scoped capability manifest with compatibility/census tests.
- Real-API tests and live desktop/mobile browser checks cover happy, abuse,
  denial, offline/stale, deleted-target, provider-offline, accessibility, and
  locale paths.
- Operational measures contain no raw content or person-level safety histories,
  respect minimum cohorts and retention, and expose capacity honestly.
- The implementation can be disabled or narrowed without losing block/mute,
  corrupting case history, or requiring destructive database repair.

## Concrete next action

Prepare one owner decision packet containing:

1. the recommended account-block matrix;
2. the first reportable target set and excluded surfaces;
3. a draft policy/reason taxonomy;
4. role and projection tables;
5. the evidence/retention/access proposal;
6. response, urgent-escalation, appeal, and staffing targets; and
7. a proposed first schema/API state machine with no implementation commit.

Do not begin Phase 1 until that packet is approved.
