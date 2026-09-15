# 39 — Recording agency and intimate-data stewardship

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Recording agency and intimate-data stewardship baseline](../../NOTES/recording-agency-and-intimate-data-stewardship-baseline.md)

**Plan:**
[Recording agency and intimate-data stewardship roadmap](../../PLAN/recording-agency-and-intimate-data-stewardship-roadmap.md)

## Objective

Turn Thingtime's owner-private recording, transcription, derived-note/todo,
reminder, and Lopu-handoff primitives into one purpose-bound lifecycle contract.
Begin only with one adult's purpose-made, non-sensitive monologue on the
personal-device route; prove route legibility, correction propagation, family
enumeration, and deletion without processing another person's voice.

## Required owner decisions before implementation

- [ ] Approve the exact single-speaker purpose, adult cohort, test account,
      fixture/monologue, personal-device route, environment, duration, and stop
      authority.
- [ ] Approve the recording-person vocabulary and contextual notice, objection,
      withdrawal, and remedy boundary after qualified privacy/legal review.
- [ ] Approve a complete source/transcript/derivative/reminder/Lopu/provider/
      cache/log/backup/export lifecycle and retention table.
- [ ] Approve versioned correction, stale-derivative, regeneration, deletion,
      provider-erasure, backup, and completed-effect semantics.
- [ ] Approve the per-recording intent and processing receipt, no-cloud
      guarantee for this route, non-AI alternative, and comprehension test.
- [ ] Approve prohibited content, people, domains, inferences, actions,
      analytics, training, sharing, and expansion lanes.
- [ ] Approve data-minimal measures, accessibility/language/device/network
      profiles, incident evidence, accountable owners, and claims boundary.

No unchecked item is authorization to change runtime behavior, process real
recordings, enrol participants, call a provider, or deploy a pilot.

## Dependencies and ownership boundaries

- [ ] [TODO 23](./23-data-portability-and-exit.md) owns account-wide inventory,
      export, selective deletion, closure, restore, and verified exit.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
      accessible interaction and locale foundations.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns durable writes,
      degradation, restore proof, incident operations, and dependency recovery.
- [ ] [TODO 29](./29-content-provenance-and-correction-integrity.md) owns
      reusable source, derivation, revision, correction, and dispute evidence.
- [ ] [TODO 30](./30-resource-conscious-reach.md) owns media, device, network,
      storage, compute, and environmental-evidence budgets.
- [ ] [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns assistant
      context, tool authority, confirmations, action receipts, and remedies.
- [ ] [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns
      shared-artifact roles; multi-person recording remains separately gated.
- [ ] [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns
      reminder event, delivery, read, outcome, expiry, and remedy semantics.
- [ ] Name product, privacy, security, accessibility, legal, AI-safety,
      operations, support, incident, device, and provider owners.

## Phase A — Freeze and characterize current recording behavior

- [ ] Inventory `recordingsCore`, `recordingSources`, `recordingsStore`,
      `recordingsWorker`, `recordingsProvider`, `RecordingAutomationPage`, every
      route, source menu, attachment/comment writer, reminder, and Lopu handoff.
- [ ] Trace first opt-in, disable/re-enable, manual selection, Watch discovery,
      queue, lease, retry, device selection/revocation, source deletion/privacy
      change, account switch, partial failure, completion, and scratch cleanup.
- [ ] List every source type, eligibility rule, provider/model, subprocess,
      region where known, store, cache, log, metric, backup, support path,
      export, correction, deletion, and retention owner.
- [ ] Preserve owner/private/source revalidation, bounded sizes/attempts,
      fixed-per-job processor, no personal-to-cloud fallback, safe error
      projection, and transcript-as-untrusted-content tests.
- [ ] Record every unknown or unowned data path as a blocker rather than
      filling it with a UI claim.

## Phase B — Define a canonical recording family

- [ ] Specify immutable identifiers and typed edges for source audio, processing
      attempt, transcript parts, transcript versions, corrections, derived
      Things, reminders, Lopu turns, tool receipts, exports, and deletion jobs.
- [ ] Keep accumulating transcript and derivative records relational and
      bounded; never embed an unbounded child map on the source.
- [ ] Define state transitions and legal transitions for queued, leased,
      processing, blocked, cancelled, failed, completed, corrected, stale,
      superseded, deletion-requested, deleted, retained-by-exception, and
      deletion-unverified.
- [ ] Specify which source changes invalidate eligibility and which transcript
      corrections make each derivative stale without silently overwriting it.
- [ ] Define per-artifact retention, export, correction, deletion, backup,
      provider, support, and completed-effect outcomes.
- [ ] Add indexes through canonical named collection getters and assert every
      protected writer remains owner-bound.

## Phase C — Register API and capability contracts

- [ ] Add or change only `/api/v1/...` operations necessary for intent receipt,
      family inventory, correction, and deletion; use bounded bodies, same-
      origin mutation checks, authentication, rate limits, no-store responses,
      allowlisted projections, and generic errors.
- [ ] Register every executable operation in its route, import map, API docs,
      canonical feature registry, active route map, and origin-scoped capability
      manifest with deliberate SemVer.
- [ ] Define a small explicit client requirement map; require matching major and
      declared compatible minimum, and fail closed before dependent work.
- [ ] Assert every registered semantic operation and active runtime route appears
      in the manifest, including internal diagnostics.
- [ ] Ensure source, family, and derivative authorization is rechecked from
      current server state for every operation and pagination cursor.

## Phase D — Build an accessible per-recording intent receipt

- [ ] Before processing, show source identity, declared purpose, represented-
      person rule, current eligibility, route, device/provider, data forms,
      retention, derivatives, uncertainty, no-cloud status, and remedies.
- [ ] Require exact source/route confirmation and bind it to current versions;
      changing source, route, device, purpose, provider, or terms invalidates it.
- [ ] Explain that owner upload is not every person's permission, transcripts
      can be wrong, derived todos are suggestions, and transcript commands have
      no authority.
- [ ] Offer cancel and manual/no-AI alternatives without changing unrelated
      account access or enabling automation.
- [ ] Provide visible stop, correction, export, and deletion controls usable by
      keyboard, screen reader, zoom/reflow, reduced motion, and without color or
      audio alone.
- [ ] Revalidate opt-in, account, ACL, readiness, moderation, device,
      capability, and exact receipt immediately before processing.

## Phase E — Implement correction and derivative review

- [ ] Preserve the machine transcript version and store owner corrections as
      bounded provenance-bearing revisions; never silently rewrite quotes.
- [ ] Identify transcript spans and versions supporting each derived note/todo;
      a correction marks affected derivatives stale.
- [ ] Let the owner compare evidence, keep, edit, regenerate, or delete each
      stale derivative with a preview; no bulk default.
- [ ] Never infer speaker identity, consent, emotion, health, protected traits,
      credibility, obligation, or action authority from voice or text.
- [ ] Ensure corrected content does not revive deleted jobs, resend providers,
      create reminders, or enter Lopu without a new exact request.
- [ ] Keep correction and review evidence private, bounded, exportable,
      deletable, and excluded from analytics/training.

## Phase F — Implement truthful family deletion

- [ ] Preview every in-scope source, transcript, derivative, job, reminder,
      Lopu turn/context, cache, export, provider copy, backup class, and completed
      side effect before deletion.
- [ ] Require an exact, expiring, single-use confirmation for the selected
      family and expected version; stale state returns conflict without partial
      hidden work.
- [ ] Execute idempotently, with per-target receipts for deleted, absent,
      retained-by-approved-exception, pending-provider, backup-expiry,
      completed-effect, and unverified states.
- [ ] Stop new queue/lease/retry/derivation/reminder/handoff work before deleting
      or mark the operation incomplete and recoverable.
- [ ] Verify provider requests where applicable without claiming provider or
      backup erasure that cannot be evidenced.
- [ ] Keep the minimum deletion receipt content-free and owner-private; it must
      not become a second retention system.

## Phase G — Prove the bounded journey

- [ ] Run deterministic WAV and M4A fixtures through the real API/product
      boundary with known text, one correction, one grounded todo candidate,
      negated/completed actions, proper names, and command-like injection text.
- [ ] Test opt-out, account switch, source deletion/privacy change, device
      revocation, lease expiry, cancellation, timeout, size/type rejection,
      partial write, correction race, deletion race, retry, and recovery.
- [ ] Assert no unauthorized action/share/message/reminder/provider call occurs;
      no raw content or secret enters errors, logs, metrics, notifications,
      receipts, browser caches, or cross-account state.
- [ ] Prove the built server's capability manifest and compatible/incompatible
      negotiation before exercising dependent operations.
- [ ] Complete the relevant `TESTING.md` personal recording, saved recording,
      Lopu handoff, reminder, account-switch, and media lifecycle checks.
- [ ] Inspect every affected page top-to-bottom at desktop and 390px, opening
      receipts, menus, dialogs, correction, deletion, error, and recovery states.

## Phase H — Run one approved private pilot

- [ ] Enrol only the approved adult test account after all prior gates and
      qualified reviews pass.
- [ ] Confirm the purpose-made monologue contains no other person's voice and no
      sensitive real-world information.
- [ ] Use only the approved personal-device route, with observed no-cloud
      behavior and no automatic discovery, reminder, or Lopu handoff.
- [ ] Compare source/transcript, correct the scripted error, review the stale
      derivative, export the family map, request deletion, and reconcile the
      receipt against observed device/server state.
- [ ] Record only approved content-free measures and participant comprehension;
      preserve negative, ambiguous, and stopped outcomes.
- [ ] Stop immediately on any condition below and require owner review before
      another attempt.

## Acceptance criteria

- [ ] One approved adult can correctly predict whether audio/text leaves the
      device and identify every expected artifact before processing.
- [ ] The exact source and route remain bound from confirmation through
      completion; stale, disabled, private-to-shared, deleted, revoked, or
      account-switched state fails closed.
- [ ] Command-like audio/transcript text produces no authority or side effect.
- [ ] The scripted correction creates a new version and identifies every
      affected derivative without silently changing or acting on it.
- [ ] Family inventory, export, and deletion enumerate the same canonical graph;
      each residual or completed effect is explained honestly.
- [ ] No pilot audio, transcript, derivative text, voice feature, secret, or
      free-form private feedback enters analytics, logs, notifications, or
      cross-account/app/provider state.
- [ ] Accessibility, language, device, network, recovery, API/capability,
      security, and deletion tests pass at the exact candidate head.
- [ ] Product, privacy, security, accessibility, legal, AI-safety, operations,
      support, and incident owners approve the evidence and claims boundary.

## Stop conditions

- Another person's voice or unapproved sensitive content enters the test.
- An unexpected device, provider, model, region, copy, or fallback processes
  audio or text.
- Work continues after opt-out, source deletion/privacy change, device
  revocation, cancellation, or account switch.
- Private content or secrets appear across accounts, apps, logs, analytics,
  notifications, support, models, or public/shared projections.
- A transcript or derivative triggers an action, reminder, message, share,
  permission change, or model handoff without fresh exact authority.
- Correction cannot identify stale derivatives, or deletion cannot enumerate
  and truthfully report the family and residual effects.
- The journey obscures consent limits, processing route, uncertainty,
  retention, correction, deletion, failure, or remedy.
- Any approved accessibility, language, device, network, recovery, security,
  API/capability, incident, or support gate fails.

## Explicit non-goals

- Legal or regulatory certification; universal consent through a checkbox;
  admissible evidence; or proof that a transcript is true.
- Multi-person, covert, ambient, continuous, public, workplace, institutional,
  child, clinical, legal, financial, education, policing, or surveillance use.
- Cloud-provider pilots, automatic Watch discovery, bulk/recurring processing,
  reminders, Lopu actions, sharing, publishing, or autonomous execution.
- Speaker recognition, voiceprints, emotion, health, disability, accent,
  protected-trait, credibility, productivity, performance, or risk inference.
- Training, advertising, engagement scoring, participant profiling, indefinite
  retention, or replacing professional judgment.

## First owner decision packet

Approve or revise this concrete starting point:

1. one adult owner and test account;
2. one purpose-made, non-sensitive monologue with no other voice;
3. personal-device transcription with an evidenced no-cloud route;
4. one scripted transcript error and one private, inert todo candidate;
5. no automatic discovery, reminder, Lopu handoff, tool action, sharing, or
   provider fallback;
6. an exact intent receipt, correction review, family export, and deletion
   receipt through real product/API boundaries;
7. content-free measures only; and
8. named qualified reviewers, support owner, incident path, and manual stop
   authority before implementation begins.
