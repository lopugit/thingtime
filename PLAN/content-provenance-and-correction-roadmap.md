# Content provenance and correction roadmap

**Status:** Proposed · owner decision required

**Prepared:** 2026-09-04, Australia/Melbourne

**Evidence:**
[Content provenance and correction baseline](../NOTES/content-provenance-and-correction-baseline.md)

**Execution epic:**
[TODO 29 — Content provenance and correction integrity](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)

**Adoption dependency:**
[Trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md)

**Safety dependency:**
[Community safety and accountable moderation](./community-safety-and-accountable-moderation-roadmap.md)

**Portability dependency:**
[Data portability and graceful exit](./data-portability-and-exit-roadmap.md)

## Outcome

Help creators, readers, collaborators, and reusers understand who or what
contributed to an artifact, what materially changed, which sources and
transformations are declared, and which assertions were independently verified
without turning provenance into a “true content” badge or a surveillance layer.

The first recommended slice is deliberately small: public posts show an honest
creation-versus-material-edit state and an accessible details view backed by a
bounded revision contract. Source graphs, AI-assistance disclosure, media
credentials, corrections, and export build on that vocabulary only after the
owner approves their privacy and authority boundaries.

## Non-goals

- Deciding whether a statement, image, source, or person is truthful.
- Guessing whether external content was AI-generated or manipulated.
- Requiring real-world identity, legal names, or public signing credentials to
  create, publish, or correct ordinary content.
- Publishing private drafts, edit diffs, prompts, model conversations, device
  metadata, locations, keys, or hidden collaborators.
- Treating a signature, digest, moderator decision, verified account, or C2PA
  manifest as a universal trust score.
- Retaining deleted or newly private content solely to keep a public history.
- Inventing a second experience-history, app-release, moderation-case, export,
  localization, or analytics system.
- Adopting RDF, C2PA, a trust list, or a signing service before a narrow pilot
  proves the user need and operating cost.

## Operating principles

1. **Evidence, not verdict.** Say exactly who asserted or observed what, how it
   was bound, when it was checked, and what remains unknown.
2. **Current authorization wins.** History never bypasses deletion, blocks,
   moderation, ownership, or a newly private source.
3. **Observed and declared stay distinct.** Platform-created facts, signed
   claims, user declarations, and imported metadata never share one confidence
   label.
4. **Relational and bounded.** Revision, source, receipt, correction, and
   dispute records are pageable child Things, never an accumulating array on
   the artifact.
5. **Privacy before completeness.** Missing or redacted provenance is an honest
   state. Completeness never justifies exposing a vulnerable creator or source.
6. **Progressive disclosure.** The default cue is plain and quiet; deeper
   history remains keyboard-, touch-, text-, and screen-reader-accessible.
7. **Portable vocabulary.** API, UI, export, embeds, feeds, and verification
   use one versioned meaning for each state.
8. **Reversible rollout.** Every indicator can be disabled if testing shows
   confusion, discrimination, coercion, or unsafe disclosure.

## Provenance contract to decide

The owner decision should approve semantics before field names.

| Object | Proposed responsibility | Boundary |
| --- | --- | --- |
| Current artifact | The ordinary Thing and its current authorized projection. | Remains the content source of truth; no embedded history. |
| Revision event | A protected writer records a material create/update/correction event linked by `targetId`, with version, actor role, exact digests, and safe summary. | Prior content is optional and separately authorized; pagination and retention are mandatory. |
| Source assertion | Expresses a typed relation such as quote, import, translation, remix, generation, or derivation. | Records who asserted it and evidence strength; does not grant read or reuse permission. |
| Verification receipt | Reproducible method/version/input digest/result/time for a signature, credential, or platform observation. | Expires or changes with trust material; proves only the scoped assertion. |
| Correction note | Attributable explanation connected to a material revision. | Does not require publishing the superseded payload or reporter identity. |
| Dispute event | References an accountable case/appeal outcome. | Community/platform authority remains in the safety system, not a writable content badge. |

Candidate assertion strengths are `platform-observed`, `signature-verified`,
`user-declared`, and `imported-unverified`. The final names need accessibility,
localization, security, and user-research review. “Verified content,” “authentic
person,” and “true” are rejected states because their scope is ambiguous.

## Milestones

### M0 — Approve vocabulary, scope, and authority

**Outcome:** one documented answer exists for what Thingtime can know, display,
retain, redact, and correct.

- Choose the first artifact family. Recommended: public posts/comments, because
  their current projection already exposes author and creation time while edits
  overwrite the same Thing.
- Define author, owner, publisher, uploader, editor, translator, app, service,
  model, signer, source, assertion, verification, correction, and dispute.
- Define material edit rules per content type and the legacy-content state.
- Decide whether a revision stores only digests/safe summaries or any prior
  payload, and approve retention/deletion behavior before schema work.
- Assign product, privacy/security, accessibility/language, community safety,
  export/interoperability, and operations owners.
- Write durable storage, authority, or retention forks into `DECISIONS.md`.

**Gate:** no provenance field, badge, signer, or history writer ships until the
decision packet and threat model are approved.

### M1 — Make current edits honest

**Outcome:** a reader can distinguish creation from a material update without
opening hidden technical data.

- Add `updatedAt` or an equivalent versioned edit state to the eligible public
  projection through the canonical API path.
- Show accessible, localized “Edited” text only when the deterministic material
  edit rule is met; hover alone is never the only disclosure.
- Provide a details surface that says what Thingtime observed and what remains
  unavailable. Do not expose a previous payload yet.
- Keep optimistic editing, account switching, custom data endpoints, embeds,
  feeds, permalink pages, and old clients coherent.
- Register any changed API operation and SemVer contract in the capability
  manifest, docs registry, route map, and compatibility tests together.
- Test legacy posts with missing or unreliable update evidence and render them
  as unknown rather than guessing.

**Gate:** every material update produces the same API/UI state; non-material
server touches do not create false edit labels; no private metadata appears.

### M2 — Create bounded, reproducible revision evidence

**Outcome:** Thingtime can explain the sequence of material events without
turning the parent Thing into an unbounded log.

- Introduce one protected relational revision-event contract using a dedicated
  utility and current versioned collection access.
- Record the event in the same transaction as the current-content mutation or
  fail closed without claiming a complete history.
- Bind prior/current digests to a versioned canonicalization algorithm; include
  the algorithm/version in every receipt.
- Page events by stable cursor; batch-load summaries; never N+1.
- Define idempotency, concurrency, migration, corrupt-event, partial-write,
  deletion, and retention behavior.
- Provide owner-visible detail before considering public prior-content access.
- Backfill no fictional history. Legacy artifacts begin with an explicit
  “history before this point unavailable” boundary.

**Gate:** concurrent edits, retries, rollback, deletion, and authorization tests
cannot produce a current artifact that falsely claims complete revision proof.

### M3 — Add source and derivation context

**Outcome:** creators can credit sources and readers can inspect typed relations
without source links becoming authority or tracking channels.

- Start with a small typed relation set: `quotes`, `imports`, `translates`,
  `remixes`, `generates`, and `derives-from`.
- Resolve internal Thing references with current authorization. Render deleted,
  blocked, private, or moderated targets as unavailable without explaining the
  hidden reason.
- Bound and normalize external source URLs; remove credential/query leakage;
  block unsafe schemes and tracking enrichment.
- Keep source assertion, content permission, and rights assertion separate.
- Preserve original attribution when a Thing is copied, exported, imported,
  embedded, syndicated, or remixed, without copying foreign private content.
- Add creator preview and correction controls before publishing source data.

**Gate:** source chains remain bounded, accessible, permission-safe, and
portable; malicious or private targets cannot become an enumeration oracle.

### M4 — Disclose platform assistance and pilot media credentials

**Outcome:** Thingtime records what it directly knows about assisted creation
and can validate one interoperable media credential without pretending to
detect all AI use.

- Re-ground Lopu and other generation paths after their PRs merge. Record
  platform-observed assistance only at the approved materiality level.
- Never store raw prompts, hidden system text, private chat content, provider
  keys, model internals, or another person's private source in provenance.
- Let creators add explicit external-tool declarations labeled
  `user-declared`; do not run probabilistic AI-origin detectors.
- Pilot C2PA validation on one supported attachment type behind a reversible
  flag. Preserve the original bytes/digest and validator version.
- Render present, absent, stripped/unknown, invalid, expired/revoked, and
  unsupported states distinctly. No state becomes a truth or quality badge.
- Preview every optional identity, location, device, edit, and ingredient field
  before it can become visible or portable.

**Gate:** the pilot passes the C2PA security/harms checklist, privacy review,
accessible comprehension tests, malformed-input tests, and bounded cost/latency
limits without delaying ordinary media display.

### M5 — Make corrections, disputes, reuse, and exit coherent

**Outcome:** history helps repair understanding and survives legitimate reuse
without preserving unsafe content.

- Add attributable correction notes and a clear current-versus-corrected state.
- Route impersonation, forged attribution, harassment, and rights disputes into
  the accountable report/case/appeal plan; do not add report-count guilt.
- Define how remedies amend, hide, revoke, or annotate evidence and how appeals
  restore it without silently rewriting events.
- Include the approved safe provenance subset in account export with offline
  verification; import preserves evidence strength and never upgrades trust.
- Carry compatible summaries into public embeds, Atom feeds, social previews,
  and reusable artifacts only where the audience and source authorization allow.
- Add retention, trust-material refresh, validator upgrade, incident response,
  and sustainable service-cost reviews.

**Gate:** correction, deletion, privacy change, export/import, key expiry,
moderation, and appeal scenarios converge to an explainable current state.

## Proposed measure registry

| Measure | Candidate definition | Release interpretation |
| --- | --- | --- |
| State comprehension | Participants who correctly explain author/source/edit/assertion/verification in structured tasks ÷ participants tested. | A low or unequal result blocks broader disclosure UI. |
| Material-edit correctness | Eligible material edits with one matching public state and revision event ÷ eligible material edits tested. | Must be exact; background touches and no-op writes stay excluded. |
| Revision consistency | Current artifacts whose event-chain tail matches the current canonical digest ÷ sampled eligible artifacts. | Any mismatch is an integrity incident, not a percentage to average away. |
| Authorized source resolution | Internal source references resolving to the exact allowed target or honest unavailable state ÷ tested references. | A private-data leak or enumeration signal is a release stop. |
| Receipt reproducibility | Verification receipts reproducible with the recorded method/trust version ÷ eligible receipts sampled. | Expired trust material changes status explicitly; it is not silently accepted. |
| Correction outcome | Accepted corrections with an attributable reader-visible outcome under the approved policy ÷ accepted corrections sampled. | Reporter identity and private evidence stay excluded from product analytics. |
| Comprehension parity | Difference in successful provenance tasks across keyboard/touch/screen reader, target locales, and narrow/wide layouts. | One aggregate rate cannot hide a failing access mode or language. |

## Security, privacy, accessibility, and abuse requirements

- Provenance writers are protected. Generic Thing CRUD cannot forge a
  platform-observed or signature-verified event.
- Every event binds exact `targetId`, owner/actor role, canonicalization version,
  and timestamp. Stable idempotency prevents retry duplication.
- Current ACL, blocks, moderation, deletion, and source authorization are
  rechecked on every read. Historical access is never inherited merely because
  the viewer once saw the content.
- Optional identity, device, location, collaborator, prompt, edit, and source
  metadata is deny-by-default with creator preview and redaction.
- A digest is not anonymization. Do not expose digests of low-entropy private
  values or build a public reverse-lookup service.
- External URLs are bounded and sanitized. Verification fetches fail closed
  against SSRF, redirect, decompression, parser, and oversized-input risks.
- Plain text carries the full meaning of every icon/color state. Details are
  reachable and dismissible by keyboard, touch, and assistive technology.
- Terms are localized through the shared language contract; “verified,”
  “authentic,” and “AI” labels receive comprehension testing rather than literal
  translation alone.
- Pseudonymous and vulnerable creators can use Thingtime without exposing legal
  identity. Absence/redaction is never ranked down or treated as suspicious.
- Reports, disputes, removals, and appeals reuse the accountable safety system
  with least-privilege evidence access and bounded retention.
- Provenance does not widen action, app, source, or reuse authority. Runtime
  capabilities remain independently negotiated and enforced.

## Acceptance criteria

- A public post's API and UI distinguish original publication from a material
  edit with deterministic, versioned semantics across feed, permalink, profile,
  search, embed, and Atom surfaces.
- No-op writes, moderation stamps, view/reaction counters, and background
  maintenance do not falsely mark the authored content edited.
- Each eligible content mutation and its protected revision event commit
  atomically or return an honest incomplete/unavailable state; retries converge.
- Legacy content, missing events, corrupt events, expired credentials, stripped
  metadata, unavailable sources, and unsupported formats remain explicit rather
  than being guessed green or red.
- Source relations preserve assertion strength, do not grant read/reuse access,
  and cannot reveal a private or blocked target.
- Platform-observed AI assistance and user-declared external assistance remain
  distinct; raw prompts and private conversations never enter public evidence.
- The media pilot validates exact bytes with a pinned method/version, survives
  malformed/adversarial input, and never delays or blocks ordinary display when
  provenance is unavailable.
- Correction, moderation, appeal, privacy change, and deletion tests leave one
  explainable current state without exposing superseded private content.
- Export includes an offline-verifiable, versioned safe evidence subset; import
  preserves `imported-unverified` status until independently rechecked.
- Capability manifest coverage accepts compatible versions and rejects missing
  or breaking contracts for every changed endpoint.
- Desktop/mobile and keyboard/touch/screen-reader tests cover cues, details,
  source chains, corrections, long histories, unavailable states, and
  localization without clipping, hover-only meaning, or focus loss.

## Risks and contingency paths

| Risk | Early signal | Response |
| --- | --- | --- |
| Readers treat a credential as truth | Testing participants say “verified means true” | Remove the badge/wording, return to scoped evidence text, and rerun comprehension testing. |
| History harms creator privacy or safety | Location/identity/source leakage, coercion, or disproportionate use against vulnerable creators | Stop collection/display, redact safely, shorten retention, and re-run harms review with affected communities. |
| Revision logging threatens write reliability | Latency, partial events, or conflicts rise | Pause rollout; keep current writes truthful; simplify or move to a proven transactional outbox only after explicit design review. |
| Provenance becomes a ranking caste | Unsigned/redacted/pseudonymous work is downranked or hidden | Remove ranking use; treat provenance as optional context, not reach or quality authority. |
| External verification becomes an attack surface | SSRF, parser failures, oversized manifests, or validator churn | Disable remote lookup/pilot, retain safe local inspection, and patch under the security release gate. |
| Cost grows faster than user value | Large histories, trust-list operations, or verification latency exceed bounds | Narrow artifact types, shorten detail retention, deduplicate receipts, or stop the service. |
| Source graphs become spam or harassment | Attribution squatting, malicious links, repeated disputes | Rate-limit assertions, require owner preview for incoming links, and use scoped case/remedy flows. |
| Standards or laws change | Validator/trust semantics or required disclosures drift | Version the contract, re-ground authoritative sources, and avoid claiming compliance until separately reviewed. |

## Concrete next action

Schedule one owner decision packet containing exactly:

1. the first artifact family and material-edit rule;
2. the approved actor/assertion vocabulary and forbidden trust labels;
3. whether revision events retain digests only, safe summaries, or prior payload;
4. the privacy/redaction/deletion/retention boundary; and
5. named product, privacy/security, accessibility/language, safety,
   interoperability, and operations owners.

Do not start M1 until that packet is decided. Record durable forks in
`DECISIONS.md`; preserve rejected alternatives in the evidence note.
