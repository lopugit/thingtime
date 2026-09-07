# 29 — Content provenance and correction integrity

**Status:** 🟣 Proposed · owner decision needed

**Priority:** P1 trust/adoption infrastructure

**Proposed:** 2026-09-04, Australia/Melbourne

**Evidence:**
[Content provenance and correction baseline](../../NOTES/content-provenance-and-correction-baseline.md)

**Roadmap:**
[Content provenance and correction roadmap](../../PLAN/content-provenance-and-correction-roadmap.md)

## Goal

Give creators and readers a clear, privacy-preserving account of who or what
contributed to an artifact, what materially changed, which sources or
transformations are declared, which assertions were actually verified, and how
corrections changed the current understanding.

Provenance is contextual evidence. It must never become a verdict that content
is true, a requirement to reveal real identity, or a ranking advantage for
people who can afford credentials.

## Problem

Thingtime's current Thing envelope stores `shareId`, `ownerId`, `createdAt`, and
`updatedAt`, but public posts project only author and creation time. A content
edit replaces the current Thing and advances `updatedAt`; the previous authored
state is not retained as a content revision. Shares can link one level to an
original post, but there is no general contract for source, quote, import,
translation, remix, AI assistance, media credentials, or correction.

That makes several unsafe shortcuts tempting: calling the current owner the
original author, treating “signed” as “true,” guessing whether content is AI,
publishing sensitive metadata for completeness, or embedding an unbounded edit
array on the parent. This epic rejects those shortcuts and stages one narrow,
testable contract.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative. Data access uses
  the API, physical collection names stay versioned, and accumulating history
  is relational.
- [TODO 20 — Versioned experience history](./20-versioned-experience-history.md)
  owns replay of a user's search/feed/navigation state. This epic owns the
  provenance of the content artifact itself.
- [TODO 23 — Data portability and graceful exit](./23-data-portability-and-exit.md)
  owns inventory, export, restore, deletion, and account closure. Provenance
  must join that archive rather than invent a second export path.
- [TODO 25 — Accessibility and language readiness](./25-accessibility-and-language-readiness.md)
  owns shared interaction, locale, translation, and complete-journey gates.
- [TODO 26 — Community safety and accountable moderation](./26-community-safety-and-accountable-moderation.md)
  owns report/case jurisdiction, remedies, appeals, and transparency. A
  provenance dispute must not become a parallel moderation system.
- [TODO 27 — Trusted developer ecosystem](./27-trusted-developer-ecosystem.md)
  owns publisher declarations and immutable release provenance for apps and
  executable artifacts. Reuse vocabulary where appropriate without letting a
  content assertion widen runtime capabilities.
- [TODO 28 — Service continuity and recovery](./28-service-continuity-and-recovery.md)
  owns write truth, recovery, and incident gates. Revision evidence cannot make
  ordinary content writes less durable or falsely successful.
- PRs [#592](https://github.com/lopugit/thingtime/pull/592) and
  [#607](https://github.com/lopugit/thingtime/pull/607) were open when this epic
  was proposed. Recheck exact merge status and shipped behavior; do not design a
  migration against their PR descriptions.
- C2PA, W3C PROV-O, and NIST guidance are design references, not adopted
  compliance, identity, truth, or legal contracts.

## Phase 0 — Owner decision packet

- [ ] Choose the first artifact family. Recommended: public posts/comments.
- [ ] Approve definitions for owner, author, publisher, uploader, editor,
      translator, app, service, model, signer, source, assertion, verification,
      correction, and dispute.
- [ ] Approve deterministic, content-type-specific material edit rules.
- [ ] Ban ambiguous labels including “true,” “verified content,” and “authentic
      person.” Approve plain-language alternatives that state exact scope.
- [ ] Decide whether a revision event retains only digests, a safe summary, or
      any prior payload, plus its visibility, retention, deletion, and redaction
      behavior.
- [ ] Decide the legacy-content boundary. Do not fabricate events before the
      feature's first observed revision.
- [ ] Assign product, privacy/security, accessibility/language, safety,
      interoperability/export, and operations owners.
- [ ] Record durable data, authority, or retention forks in `DECISIONS.md`.

**Gate:** no implementation begins until all decisions have an owner and an
explicit accepted state.

## Phase 1 — Honest creation and edit state

- [ ] Add the approved versioned edit state to the canonical public projection.
      If an endpoint contract changes, update its route/docs registration,
      capability-manifest feature SemVer, and client requirement map together.
- [ ] Show creation time and plain-text “Edited” state consistently on feed,
      post/comment permalink, profile, search, media, embed, and syndication
      surfaces where that artifact appears.
- [ ] Exclude no-op writes, view/reaction counters, moderation-only stamps,
      attachment maintenance, and other non-authored background changes from
      the material-edit rule.
- [ ] Provide an accessible details surface that distinguishes
      platform-observed facts from unavailable history. Do not expose prior
      content in this phase.
- [ ] Treat legacy/missing/invalid update evidence as unknown, not unchanged.
- [ ] Add tests for optimistic edits, stale CAS, retry, account switch, custom
      Mongo endpoint, deleted source, old client, narrow viewport, keyboard,
      touch, screen reader, reduced motion, and target locales.

**Gate:** a reader sees one correct edit state everywhere, and no maintenance
write or private field can create a misleading disclosure.

## Phase 2 — Protected relational revision evidence

- [ ] Define a versioned protected revision-event Thing linked to the current
      artifact by `targetId`. Do not embed history on the parent.
- [ ] Include bounded event type, actor role/id appropriate to the audience,
      timestamp, previous/current canonical digest, canonicalization version,
      idempotency key, and safe material-change summary.
- [ ] Use one dedicated API utility and named collection getter. Generic Thing
      CRUD must reject forged platform-observed or verified events.
- [ ] Commit current-content mutation and event atomically, or return an honest
      incomplete/unavailable state without claiming history integrity.
- [ ] Page event reads with stable cursors and batch aggregation; never N+1.
- [ ] Test concurrent edits, retry replay, conflict, rollback, partial legacy
      state, corrupt events, source deletion, retention expiry, and account
      closure.
- [ ] Backfill only an explicit “history starts here” boundary. Never infer old
      authors, tools, sources, or intermediate versions.

**Gate:** the event-chain tail reproducibly binds to current content under the
recorded algorithm, and a failed event write never masquerades as complete.

## Phase 3 — Source and derivation assertions

- [ ] Implement the smallest approved relation vocabulary: `quotes`, `imports`,
      `translates`, `remixes`, `generates`, and `derives-from`.
- [ ] Store who made each assertion and its strength:
      `platform-observed`, `signature-verified`, `user-declared`, or
      `imported-unverified`.
- [ ] Re-authorize internal sources on every read. Deleted, blocked, private, or
      moderated targets render as unavailable with no hidden reason leak.
- [ ] Normalize and bound external URLs. Strip credentials/private query data,
      reject unsafe schemes, and do not add tracking parameters or previews
      that create SSRF.
- [ ] Keep attribution, reuse permission, rights assertion, moderation status,
      and verification as separate fields and UI concepts.
- [ ] Give creators an exact disclosure preview plus correction/removal control
      before source metadata becomes public or portable.
- [ ] Preserve the approved relation subset across copy, share, remix, embed,
      Atom feed, export, and import without copying foreign private content.

**Gate:** malicious source graphs stay bounded; access changes do not leak; and
imported assertions never gain stronger status without a new verification.

## Phase 4 — Platform assistance and one media-credential pilot

- [ ] Re-ground all platform generation/edit paths after their owning PRs merge.
      Record only assistance Thingtime directly observed and only at the
      approved materiality level.
- [ ] Allow explicitly labeled creator declarations for external assistance.
      Do not implement probabilistic AI-origin detection.
- [ ] Exclude raw prompts, system instructions, private chats, provider keys,
      hidden reasoning, private source content, and model-internal identifiers
      from public provenance.
- [ ] Choose one attachment type for a reversible C2PA validation pilot.
- [ ] Pin the validator, trust material, canonical input bytes/digest, result
      vocabulary, time, and refresh/expiry rule in each receipt.
- [ ] Distinguish present, absent, stripped/unknown, invalid, expired/revoked,
      unsupported, and not-yet-validated states. None may mean “true.”
- [ ] Parse locally and within strict byte/time/depth limits by default. Any
      remote lookup needs separate SSRF, redirect, privacy, and tracking review.
- [ ] Preview and minimize optional identity, location, device, edit, and
      ingredient disclosures before save/export.

**Gate:** the pilot passes malformed/adversarial file tests, privacy and harms
review, accessibility/comprehension testing, and cost/latency limits without
blocking ordinary media when credentials are unavailable.

## Phase 5 — Corrections, disputes, portability, and operations

- [ ] Add an attributable correction note that links to a material revision and
      makes the current corrected state clear without forcing the previous
      payload to remain public.
- [ ] Route forged attribution, impersonation, harassment, and rights disputes
      through TODO 26's scoped report/case/remedy/appeal contract.
- [ ] Define how correction, moderation, appeal, redaction, deletion, and key
      revocation update display without silently rewriting event history.
- [ ] Export the approved safe evidence subset with versioned offline
      verification. Import keeps original assertion strength and marks external
      evidence unverified until rechecked.
- [ ] Add validator/trust-material upgrade, expiry, incident, rollback, and
      retirement runbooks.
- [ ] Measure comprehension and correctness through structured testing and
      aggregate operational evidence only. Do not log sensitive source
      inspection or build person-level trust scores.
- [ ] Review ongoing storage, verification, support, accessibility,
      localization, and dispute-handling cost before expanding artifact types.

**Gate:** every correction, privacy, deletion, moderation, appeal, export/import,
and credential-expiry scenario converges to one explainable current state.

## Security, privacy, accessibility, and abuse safeguards

- Protected writers are the only source of platform-observed and
  signature-verified states; user-authored fields cannot forge them.
- A digest is not anonymous. Never expose digests of private low-entropy data or
  provide a public reverse-lookup oracle.
- Current ACL, owner, block, moderation, source visibility, and deletion are
  checked at read time for every current and historical relation.
- Creator real-world identity is optional. Pseudonymous or redacted work remains
  usable and is not downranked, hidden, or treated as suspicious.
- Identity, device, location, collaborator, source, prompt, and edit metadata is
  deny-by-default; disclose only approved fields after an exact creator preview.
- Signatures verify scoped assertions and bytes. They do not establish factual
  truth, permission, safety, quality, or real-world identity on their own.
- External URLs and credential payloads have strict scheme, origin, redirect,
  byte, depth, decompression, and time bounds. Unsafe parsing fails closed.
- Every icon/color has equivalent text. Disclosure works without hover and with
  keyboard, touch, zoom, screen reader, reduced motion, long text, and RTL.
- Localization preserves assertion scope. Translators cannot silently turn
  “declared,” “recorded,” “signed,” or “verified” into synonyms.
- Source and correction requests are rate-limited, attributable, appealable,
  and protected from brigading. Report volume alone never proves wrongdoing.
- Provenance never widens app scopes, action capabilities, source visibility,
  content permissions, or reuse rights.
- Sensitive evidence access is least-privilege and audited; retention is
  bounded and deletion semantics are tested.

## Acceptance criteria

- Eligible public artifacts expose deterministic creation/material-edit state
  consistently through API and every relevant first-party surface.
- Background counters, moderation stamps, storage maintenance, and no-op writes
  never produce a false content edit.
- Revision events are relational, protected, bounded, pageable, idempotent, and
  transactionally aligned with the current artifact.
- Current digest and event tail reproduce under the recorded canonicalization
  version; a mismatch becomes a visible integrity incident.
- Legacy, missing, corrupt, expired, stripped, unsupported, private, deleted,
  blocked, and moderated states render honestly without guessing or leakage.
- Source relations preserve assertion strength and cannot grant authority,
  reveal a hidden target, or smuggle unsafe URLs.
- Platform-observed assistance and creator-declared external assistance remain
  distinct; AI-detector guesses never appear as provenance.
- The C2PA pilot proves only the exact validated assertions and bytes. It has no
  generic truth/authenticity badge and no hard dependency for ordinary display.
- Correction and dispute flows preserve accountability, appeal, and privacy
  without requiring superseded content or reporter identity to stay public.
- Export verification works offline for the approved evidence subset; import
  cannot upgrade trust or authority.
- Capability manifest coverage accepts compatible versions and rejects missing
  or breaking versions for every dependent client.
- Structured user testing shows people can distinguish owner, author, source,
  edit, declaration, signature, verification, moderation, and truth.
- Desktop/mobile, keyboard/touch/screen-reader, zoom, long-history, target-locale,
  RTL, offline, slow, and failure-state checks pass without clipping,
  hover-only meaning, focus loss, or loading over last-known safe state.

## Stop conditions

Pause rollout and return to the owner decision if any of these occur:

- readers consistently interpret the disclosure as a truth or quality verdict;
- provenance exposes identity, location, source, private content, prompt, key,
  or another field outside the approved projection;
- unsigned, redacted, pseudonymous, or accessibility-dependent creators receive
  worse discovery or core functionality;
- ordinary content writes become slower, partial, unavailable, or falsely
  successful because revision evidence cannot commit;
- source lookup becomes an enumeration, tracking, SSRF, parser, or denial-of-
  service vector;
- corrections or attribution requests enable harassment, coercion, brigading,
  or irreversible reputational harm without appeal;
- retained history conflicts with deletion, privacy change, moderation, legal
  hold boundaries, or account closure;
- validator/trust-list/storage/support cost exceeds the approved service budget;
- the responsible product, privacy/security, accessibility/language, safety,
  interoperability, or operations owner is unavailable.

## Concrete next action

The product owner should review one bounded packet containing:

1. first artifact family and material-edit examples/non-examples;
2. actor/assertion vocabulary plus forbidden trust labels;
3. proposed relational event fields and canonical digest algorithm;
4. prior-content, redaction, retention, deletion, and legacy boundaries; and
5. named accountable owners.

After approval, implement only Phase 1 behind a reversible release flag. Do not
start revision storage, source graphs, AI disclosure, or media credentials in
the same first slice.
