# Recording agency and intimate-data stewardship roadmap

**Status:** Proposed

**Prepared:** 2026-09-11, Australia/Melbourne

**Evidence:**
[Recording agency and intimate-data stewardship baseline](../NOTES/recording-agency-and-intimate-data-stewardship-baseline.md)

**Execution epic:**
[TODO 39 — Recording agency and intimate-data stewardship](../TODO/claude-todo/39-recording-agency-and-intimate-data-stewardship.md)

## Outcome

Let a person deliberately process one eligible recording while understanding
who and what is represented, where audio and text travel, what is derived, how
errors propagate, and how to stop, correct, export, or delete the artifact
family. Preserve the current owner-private, opt-in, source-revalidation, bounded
processing, and no-silent-cloud-fallback foundations.

Success is not recording volume, transcript count, generated todos, provider
calls, time saved, or Lopu activity. It is an informed, purpose-bound journey
whose processing route and lifecycle match the person's expectation, whose
errors are reviewable, and whose promised remedies work.

## Boundary with adjacent roadmaps

- [Data portability and graceful exit](./data-portability-and-exit-roadmap.md)
  owns account-wide inventory, export, selective deletion, closure, restore,
  and verified exit. This roadmap specifies recording-family membership and
  per-artifact lifecycle semantics.
- [Accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md)
  owns shared interaction and locale foundations. This roadmap supplies the
  recording journey, transcript/media alternatives, and failure states.
- [Content provenance and correction](./content-provenance-and-correction-roadmap.md)
  owns reusable source, derivation, revision, correction, and dispute evidence.
  This roadmap applies them to audio, transcript, and recording derivatives.
- [Resource-conscious reach](./resource-conscious-reach-roadmap.md) owns
  media, device, network, storage, and compute budgets. This roadmap may not
  call local processing private or sustainable without measured evidence.
- [AI agency and accountable assistance](./ai-agency-and-accountable-assistance-roadmap.md)
  owns model context, tool authority, confirmations, action receipts, and
  remedies. This roadmap owns whether a transcript may enter that context.
- [Collaboration agency and shared stewardship](./collaboration-agency-and-shared-stewardship-roadmap.md)
  owns shared-artifact roles. Multi-person recording remains blocked until
  recording-person and collaboration authority are jointly approved.
- [Notification agency and accountable delivery](./notification-agency-and-accountable-delivery-roadmap.md)
  owns reminder lifecycle and channels. A derived todo is not reminder consent.

## Invariants

1. Private source ownership never stands in for every represented person's
   knowledge, permission, or remedy.
2. Capture, transcription, derivation, reminder creation, and Lopu handoff are
   separate purposes and authority steps.
3. The selected processing route is fixed per attempt; no retry or failure
   silently expands it or falls back to cloud processing.
4. Source audio, transcript, corrections, derived Things, reminders, and
   assistant context remain explicitly linked without duplicating raw content
   into analytics or receipts.
5. Transcript and model output are fallible evidence. They cannot grant tool,
   account, ACL, identity, legal, medical, financial, or safety authority.
6. Stop, correction, export, and deletion are reachable, scoped, and truthful
   about completed effects, provider systems, backups, and residual copies.
7. No derived voice, emotion, identity, health, disability, protected-trait,
   credibility, performance, or risk inference enters the first pilot.
8. Success evidence is data-minimal and never stores pilot audio or transcript.

## Milestone R0 — Approve the charter and accountable owners

**Outcome:** the pilot has one declared purpose, safe cohort, route, data
boundary, review team, and stop authority before engineering begins.

- Approve one adult, single-speaker, purpose-made, non-sensitive test scenario.
- Select the personal-device route and explicitly prohibit cloud fallback.
- Name product, privacy, security, accessibility, legal, AI-safety, operations,
  support, and incident owners; obtain qualified review for the exact context.
- Define recording-person, purpose, notice, objection, and remedy vocabulary
  without asserting that product UI alone creates legally sufficient consent.
- Freeze excluded domains, inferences, sources, people, sharing, automation,
  reminders, actions, analytics, training, and retention.
- Record a manual stop owner, communication path, evidence-minimum policy, and
  restart approval process.

**Gate:** all owner decisions in TODO 39 are approved and linked. Otherwise no
pilot build, real-person intake, provider processing, or production exposure.

## Milestone R1 — Publish the canonical lifecycle and route inventory

**Outcome:** reviewers can follow one source through every representation,
processor, store, derivative, cache, log, backup, export, and remedy.

- Generate the artifact-family graph from canonical code and registries:
  source attachment, job/control Thing, scratch transcript, transcript comment
  parts, corrections, notes/todos, reminders, Lopu turns, and action receipts.
- For every edge, record purpose, initiator, authority check, processor/device,
  data form, encryption boundary, region where known, retention, projection,
  export, correction, deletion, backup, and accountable owner.
- Characterize first opt-in, disable/re-enable, queue, lease, retry, provider
  selection, device replacement, source deletion, account switch, and failure.
- Specify a machine-readable recording-family identifier and relationship
  registry without embedding an unbounded derivative list on the source.
- Register any changed HTTP operation in the canonical API and capability
  manifests, with the correct semantic version and complete route coverage.

**Gate:** reviewers can enumerate the family and explain every external data
transfer from canonical state. Unknown or unowned flows stop progress.

## Milestone R2 — Make intent and processing legible before work

**Outcome:** the person sees one accessible, contextual, per-recording receipt
before any new processing starts.

- Show the selected source, declared purpose, represented-person boundary,
  processor route, data forms sent, providers, expected retention, derivatives,
  no-cloud status where applicable, and current source eligibility.
- Require deliberate confirmation for the exact source and route; do not infer
  it from enabling a global setting, opening a screen, or prior processing.
- Explain transcript fallibility, no-action authority, correction/deletion
  paths, and the limits of provider erasure and recall.
- Provide cancel and non-AI/manual alternatives without loss of unrelated use.
- Revalidate owner, account, ACL, readiness, binding, moderation, device, opt-in,
  capability, and exact receipt version at execution time.

**Gate:** comprehension tests pass across approved accessibility and language
profiles, and stale or changed state fails closed before data leaves its current
boundary.

## Milestone R3 — Prove one synthetic lifecycle deterministically

**Outcome:** a non-sensitive fixture proves the state machine and remedies
without a real person's recording or a live provider dependency.

- Use deterministic WAV/M4A fixtures with a known transcript, one scripted
  correction, one grounded todo candidate, and misleading command-like text.
- Prove the command-like text is treated only as content and creates no action,
  share, message, permission change, reminder, or public artifact.
- Exercise opt-out, account switch, source delete, source privacy change,
  device replacement, lease expiry, cancellation, retry, size/type rejection,
  provider error, partial derivative failure, and concurrent deletion.
- Verify correction versions preserve evidence, identify stale derivatives,
  prevent automatic overwrites, and require review before regeneration.
- Verify deletion enumerates source, transcript, derivatives, jobs, reminders,
  Lopu context, caches, exports, providers, backups, and already completed effects
  with honest per-target states.
- Assert raw audio, transcript, secrets, provider errors, and free-form feedback
  never enter metrics, logs, notifications, receipts, or snapshots.

**Gate:** all deterministic tests pass through public product/API boundaries,
not direct database writes, and the capability manifest accepts compatible
versions while rejecting missing or breaking contracts.

## Milestone R4 — Run one private, single-person pilot

**Outcome:** one consenting adult completes the personal-device journey with a
purpose-made monologue and can predict the data flow and remedies.

- Enrol one test account only after the charter, notice, support path, and stop
  authority are approved.
- Confirm no other person's voice or sensitive real-world content is present.
- Record route choice and comprehension without retaining the recording text.
- Process once, compare audio and transcript, correct the scripted error, review
  stale derivative state, export the family map, then request deletion.
- Verify the actual installed personal-device process, network behavior,
  provider exclusion, account boundary, and post-delete product state.
- Exercise keyboard-only, screen-reader, 200%/400% zoom, reflow, reduced motion,
  error recovery, and the approved language/network/device profiles.

**Gate:** the participant understands the route and derivative meanings;
correction and deletion receipts match observed state; no incident or stop
condition occurs. One pass supports only this exact journey.

## Milestone R5 — Evaluate changes and remedies

**Outcome:** later device, model, prompt, provider, schema, or lifecycle changes
cannot silently invalidate the pilot evidence.

- Version the charter, route, prompts, models, processors, capability contract,
  lifecycle registry, correction policy, retention, and deletion semantics.
- Define which changes require fixture reruns, accessibility regression,
  privacy/security review, participant re-consent, or a new pilot.
- Reconcile product receipts with device, server, provider, backup, and support
  evidence without constructing a content or voice profile.
- Publish an owner-facing remedy path for mismatch, objection, wrong transcript,
  stale derivative, unexpected provider, deletion failure, or incident.
- Record negative and inconclusive outcomes as first-class evidence.

**Gate:** every material change has an owner, compatibility decision, current
validation, rollback/stop path, and honest evidence status.

## Milestone R6 — Consider expansion separately

Multi-person audio, Watch automatic discovery, cloud transcription, recurring
processing, reminders, Lopu actions, sharing, public content, minors,
workplaces, institutions, health/legal/financial contexts, speaker recognition,
biometrics, emotion or credibility inference, and training require new charters,
qualified review, stronger authority and remedies, and fresh complete-journey
evidence. None is earned by R0–R5.

## Measures

- Correct prediction of whether audio or text leaves the device.
- Correct identification of source, transcript, derivative, and action states.
- Successful cancel before processing and stop during eligible boundaries.
- Transcript correction detected and stale derivatives identified.
- Complete family enumeration, export, and per-target deletion receipt.
- Cross-account, unexpected-provider, silent-fallback, and unauthorized-action
  count: zero.
- Accessibility and recovery profile pass rate, with raw failures reviewed.
- Incidents, objections, remedy completion, and manual stop reasons.

Do not collect audio, transcripts, derived text, voiceprints, inferred traits,
free-form private feedback, unrelated clicks, time-on-task surveillance, or
engagement proxies merely to compute these measures.

## Stop conditions

- Any unapproved person, content, purpose, processor, provider, region, copy,
  inference, or downstream action enters the journey.
- Opt-out, source deletion, privacy change, account switch, or device revocation
  fails to stop new processing.
- The UI or receipt misstates route, retention, correction, deletion, provider
  handling, authority, or uncertainty.
- Private content or secrets cross account, app, provider, log, analytics,
  notification, support, or model boundaries.
- A transcript error creates an unreviewed action or cannot be traced to stale
  derivatives.
- The promised correction, export, deletion, or incident remedy cannot be
  completed and truthfully evidenced.
- Accessibility, language, constrained-device/network, recovery, security, or
  capability-manifest gates fail.

## Non-goals

- Establishing legal consent, workplace policy, evidentiary truth, or regulatory
  compliance through a checkbox or transcript.
- Covert, ambient, public, continuous, third-party, child, clinical, legal,
  financial, employment, education, policing, or surveillance recording.
- Speaker identification, voiceprints, emotion, health, protected-trait,
  credibility, productivity, risk, or intent inference.
- Automatic summaries, todos, reminders, actions, sharing, publishing,
  training, advertising, engagement optimization, or indefinite retention.
- Claiming a local route is private, secure, accurate, low-carbon, or legally
  permitted without bounded current evidence and qualified review.
