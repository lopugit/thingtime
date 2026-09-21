# Recording agency and intimate-data stewardship baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-11, Australia/Melbourne

**Repository scope:** `origin/develop@3e54fd9b1` plus the merged PR evidence and
external design references linked below. This is not a production assessment,
legal advice, consent determination, or compliance claim.

**Plan:**
[Recording agency and intimate-data stewardship roadmap](../PLAN/recording-agency-and-intimate-data-stewardship-roadmap.md)

**Execution epic:**
[TODO 39 — Recording agency and intimate-data stewardship](../TODO/claude-todo/39-recording-agency-and-intimate-data-stewardship.md)

## Why preserve this note

Thingtime can now accept selected owner-private recording Things and private
Watch recordings, transcribe them through an explicitly selected cloud or
personal-device path, attach transcripts as relational comments, derive private
notes and todos, and offer a confirmed handoff to Lopu. These are meaningful
privacy and authority foundations. They are not yet a complete agreement about
who may be recorded, what each processing step does, how long each artifact
remains, or what correction and deletion mean for downstream derivatives.

Audio can contain several people's voices, locations, relationships, health,
work, beliefs, and incidental background information. The account owner who
uploads a file may not be the only person represented in it. A private ACL does
not establish every speaker's knowledge or permission, and a transcript or
model-derived todo can amplify errors beyond the original recording.

The first experiment should therefore be deliberately narrow: one consenting
adult records a purpose-made, non-sensitive monologue, deliberately selects it,
uses the personal-device path, reviews a visible lifecycle receipt, corrects one
synthetic transcript error, and deletes the complete test family. No other
person's voice, real meeting, automatic discovery, cloud provider, reminder,
or action handoff is needed to learn whether the contract is understandable.

## Vocabulary that must stay separate

| Term              | Meaning here                                                                               | Must not silently mean                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Capture           | Creating or importing an audio artifact for a declared purpose.                            | Permission from every represented person or permission for later processing.                   |
| Source audio      | The original bounded audio object selected for processing.                                 | A verified, complete, or shareable account of an event.                                        |
| Recording person  | A person whose voice or personal information is represented.                               | The uploader, account owner, rights holder, or consenting participant.                         |
| Transcription     | Producing text intended to represent audible content.                                      | A perfect quotation, speaker identity, intent, truth, or consent.                              |
| Derived insight   | A note, todo, summary, label, or reminder inferred from a transcript.                      | A fact, instruction, authorization, diagnosis, obligation, or completed action.                |
| Action handoff    | Deliberately sending a transcript to Lopu for a new assisted turn.                         | Permission to execute commands found in audio or to act without fresh authority.               |
| Processing route  | The devices, services, providers, regions, and data forms used for one step.               | A privacy, security, accuracy, or legal guarantee.                                             |
| Correction        | A traceable amendment to transcript or derived meaning.                                    | Erasure of the earlier artifact, admission of fault, or automatic correction everywhere.       |
| Deletion          | A scoped request and verified outcome for named artifacts and copies.                      | Instant recall from recipients, provider systems, backups, logs, or already completed effects. |
| Lifecycle receipt | A bounded owner-visible map of source, derivatives, route, state, retention, and remedies. | Storage of raw audio/transcript in analytics or proof that the processing was appropriate.     |

## Repository evidence ledger

| Claim                                                                                  | Current evidence                                                                                                                                                                                                                                                                                                                                                                    | Confidence and refresh trigger                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recording automation is opt-in and owner-bound.                                        | `recordingsCore.ts` defaults automation to disabled. `recordingSources.ts` accepts only exact-owner, owner-ACL sources and rejects deleted, shared, app-bound, draft, blocked, or unready saved recordings.                                                                                                                                                                         | High for inspected code. Recheck settings, source eligibility, ACL, and attachment changes together.                                                                                   |
| Automatic discovery is intentionally narrower than manual selection.                   | `recordingsStore.ts` discovers Watch sources only, starts at the first opt-in watermark, advances a bounded durable cursor, and rechecks opt-in. Explicit saved recording Things can be selected manually but are not swept automatically.                                                                                                                                          | High for current implementation. Re-test disable/re-enable, old libraries, cursor recovery, and account switching.                                                                     |
| Cloud and personal-device processing are separate routes.                              | `RecordingAutomationPage.tsx` explains that personal recording audio is transcribed locally and only transcript text reaches native Claude Code, with no cloud fallback. Cloud mode explains that audio and transcript go to selected AI providers. Existing jobs retain their selected processor until explicit retry.                                                             | High for repository UX. Provider infrastructure, diagnostics, backups, and live network behavior were not inspected end to end.                                                        |
| Processing is bounded and fails closed.                                                | `recordingsCore.ts` caps audio, transcript, insight count, attempts, and lease time. `recordingsProvider.ts` allowlists audio types, verifies size, bounds downloads and provider calls, and uses explicit provider routes. Public errors avoid raw provider, S3, or exception detail.                                                                                              | High for current code. Recheck every new media type, provider, retry, redirect, and error projection.                                                                                  |
| Jobs continuously revalidate owner intent and source privacy.                          | `recordingsWorker.ts` rechecks enabled state, chosen personal device, and private source before work. Transaction fences protect against opt-out/delete races. A personal job cannot fall through to cloud credentials.                                                                                                                                                             | High for current code paths. Add adversarial live coverage for races and lease recovery before relying on it.                                                                          |
| Transcript-derived output is constrained but remains fallible.                         | `parseRecordingInsights` requires exact transcript evidence and closed note/todo types. The prompt treats transcript text as untrusted and forbids executing commands, contacting people, changing permissions, or treating a todo as authority. Derived Things stay owner-private.                                                                                                 | High for controls, not output accuracy. Synthetic and real positive-path evaluation remains required for every model/provider change.                                                  |
| Long-lived recording data forms a family of related artifacts.                         | The source audio remains an attachment; transcript parts are relational comments; notes/todos are separate owner-private Things; a job carries encrypted scratch transcript state until completion, when the scratch text is dropped.                                                                                                                                               | High for storage shape. A canonical lifecycle map, correction propagation, deletion cascade, export receipt, and provider-erasure proof are not evident.                               |
| Handoff to Lopu is deliberate but creates a new authority context.                     | The page uses an explicit confirmation before “Send transcript to Lopu” and warns that Lopu may create Things or reminders while sensitive actions still need confirmation. The selected recording, not an implicit bulk set, is sent.                                                                                                                                              | High for the inspected UI and route. Recheck chat context, receipts, tool policy, and account changes after assistant work.                                                            |
| Pairing secrets have a guarded UI boundary.                                            | Personal-device pairing displays the secret once in a password field, warns not to send it in chat, and provides device revocation.                                                                                                                                                                                                                                                 | High for UI intent. Inspect transport, logging, expiration, recovery, and device compromise separately.                                                                                |
| Recent recording work is merged, but complete real-media acceptance is still unproven. | Merged PRs [#665](https://github.com/lopugit/thingtime/pull/665) and [#761](https://github.com/lopugit/thingtime/pull/761) establish private Watch and explicitly selected saved-recording flows. #761 records builds, automated tests, synthetic API and browser checks, while leaving real approved audio through actual transcription, derivation, and Lopu handoff outstanding. | High for merged repository evidence; low for production, physical-device, provider, and human comprehension outcomes. Refresh exact deployment and acceptance receipts before a pilot. |

## External design inputs

These sources provide questions and design constraints. Their presence does not
establish that an Australian Privacy Principle applies, that consent is legally
sufficient, or that Thingtime conforms.

1. The OAIC's [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information)
   emphasizes necessity, proportionality, fair collection, and data
   minimisation. Its [APP 5 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-5-app-5-notification-of-the-collection-of-personal-information)
   informs contextual notice when information is collected about a person.
2. The OAIC's [APP 11 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information)
   connects security with active retention review and reasonable destruction or
   de-identification when information is no longer needed.
3. W3C's [Privacy Principles](https://www.w3.org/TR/privacy-principles/)
   supports purpose limitation, minimisation, meaningful contextual choices,
   easy withdrawal, and attention to people represented in data provided by
   somebody else.
4. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) treats text alternatives for
   prerecorded audio and captions for synchronized media as accessibility
   foundations. A transcript editor and lifecycle controls must also work by
   keyboard, screen reader, zoom, reflow, and without audio alone.
5. NIST's [AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)
   informs documented scope, component and third-party risk mapping, human
   oversight, privacy-risk measurement, and continued evaluation.

Recording and interception rules vary by place, context, participant, and
purpose. Qualified legal and privacy review must decide applicable obligations
before real multi-person, workplace, health, legal, financial, or cross-border
recording is considered.

## Strengths to preserve

- **Private and disabled by default.** No background recording automation is
  implied merely by account existence or local adapter testing.
- **Source eligibility is canonical.** Manual selection does not bypass owner,
  ACL, readiness, binding, deletion, or moderation checks.
- **Intent is rechecked during work.** Disabling automation or changing the
  personal device can stop stale jobs before more processing.
- **Route choice is explicit.** Personal-device jobs do not silently fall back
  to cloud processing, and retries do not silently change processors.
- **Transcript text is untrusted evidence.** It cannot grant tool authority,
  and derived todos remain suggestions rather than executable commands.
- **Scratch data is bounded.** The job drops its private transcript scratch
  after completion instead of accumulating another indefinite copy.

## Gaps that block an accountable pilot

1. **No recording-person contract.** Account opt-in and source ownership do not
   establish who else is represented, how they were informed, or what happens
   if they object.
2. **No canonical lifecycle map.** The UI does not enumerate source audio,
   transcript parts, derived Things, reminders, Lopu turns, provider copies,
   caches, logs, backups, retention, export, deletion, and support access.
3. **No derivative correction protocol.** A transcript correction does not yet
   carry an explicit version, invalidate stale notes/todos, or ask the owner to
   review effects already created from incorrect text.
4. **No deletion receipt across the family.** The recording route exposes
   settings, retry, queue, handoff, and todo operations but no recording-family
   purge with per-artifact and provider outcome evidence.
5. **No per-recording processing receipt.** General mode descriptions do not
   prove what a particular recording sent, to which processor, for which
   purpose, or under which retention policy.
6. **No bystander-sensitive capture guidance.** The evidence does not show a
   persistent recording indicator, multi-speaker acknowledgement, local-law
   boundary, or safe refusal path for incidental voices.
7. **No approved inference boundary.** Speaker identity, emotion, health,
   biometrics, credibility, protected traits, and high-impact conclusions need
   explicit prohibition or separately reviewed authority—not a model prompt
   alone.
8. **Positive-path evidence is incomplete.** Automated and synthetic checks do
   not yet prove comprehension, real transcription quality, correction,
   complete deletion, provider handling, device behavior, or accessibility.

## Risks and abuse cases

- Covertly recording a partner, colleague, customer, child, patient, client,
  interviewee, or public bystander.
- Uploading a shared or stolen recording through an owner-private wrapper.
- Hallucinated transcript text becoming an attributed quote, todo, reminder,
  allegation, or assistant action.
- Sensitive content reaching an unexpected cloud provider after route changes,
  retries, endpoint changes, or stale UI state.
- Deleting the source while transcript comments, derived Things, reminders,
  Lopu context, exported copies, or provider artifacts remain unexplained.
- Treating silence, continued use, account ownership, meeting attendance, or a
  recording indicator as universal consent.
- Using voices to infer identity, emotion, health, disability, accent, origin,
  truthfulness, performance, or risk.
- Optimizing engagement by retaining intimate content, transcripts, or derived
  profiles beyond the person's declared purpose.

## Bounded first experiment

One consenting adult uses one test account and one purpose-made, non-sensitive
monologue containing a scripted transcript error. They manually choose the
source, select the personal-device route, and see before processing:

- that no other person may be represented in the pilot;
- the declared purpose, processor, data forms, expected retention, and no-cloud
  promise for this route;
- how to stop, correct, export, and request deletion; and
- that transcript and derived output may be wrong and cannot authorize action.

After processing, the person compares source and transcript, corrects the
scripted error, verifies stale derivatives are identified for review, then
deletes the source family and receives a bounded outcome receipt. Evaluation
records only synthetic scenario ID, route/version, completion state, correction
state, deletion state, participant-reported comprehension, accessibility
profile, incidents, and stop reasons—never the audio, transcript, derived text,
voice features, or free-form private feedback.

## Stop conditions

Stop intake and preserve only incident-minimum evidence if any test:

- includes another person's voice or sensitive real-world content;
- processes through an unapproved route or sends audio/text to an unexpected
  provider;
- continues after opt-out, device change, source deletion, or account switch;
- exposes content across accounts, apps, logs, analytics, notifications, or
  support surfaces;
- creates an action, reminder, or public/shared artifact without fresh exact
  authority;
- cannot correct, enumerate, export, or delete the test family as promised;
- obscures route, retention, failure, uncertainty, or remedy at the moment it
  matters; or
- fails the approved keyboard, screen-reader, zoom, language, constrained-
  network, or recovery profile.

## Decisions required before implementation

1. Which single-person purpose and personal-device configuration are approved?
2. What is the canonical artifact-family schema and source-to-derivative graph?
3. What retention and deletion outcome applies to each local, server, provider,
   backup, log, exported, and Lopu-context copy?
4. How do transcript corrections version and invalidate downstream derivatives?
5. What wording and evidence distinguish uploader choice from every recording
   person's knowledge, permission, objection, and remedy?
6. Which inferences and domains are prohibited, and who approves exceptions?
7. Which accessibility, language, device, network, incident, legal/privacy,
   support, and stop owners sign the pilot charter?

## Refresh checklist

- Re-query `recordingsCore`, `recordingSources`, `recordingsStore`,
  `recordingsWorker`, `recordingsProvider`, `RecordingAutomationPage`, recording
  routes, Lopu handoff, comments, attachments, reminders, export, and deletion.
- Recheck exact merge/deployment state for #665, #761, and later recording work.
- Re-map every device, provider, region, cache, log, backup, support, analytics,
  and subprocess boundary with qualified owners.
- Re-run synthetic failure/race tests, complete real positive-path acceptance,
  and exercise the relevant `TESTING.md` recording checklists.
- Re-review current law and external guidance for the approved place, people,
  purpose, provider, and data flow; never reuse this snapshot as legal advice.
