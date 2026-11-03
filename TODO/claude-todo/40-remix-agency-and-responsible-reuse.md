# 40 — Remix agency and responsible reuse 🧬

**Status:** 🟣 Proposed · planning only · added 2026-09-11

**Owner:** Unassigned; product owner and qualified rights/privacy/safety
reviewers must approve the first contract

**Plan:**
[`PLAN/remix-agency-and-responsible-reuse-roadmap.md`](../../PLAN/remix-agency-and-responsible-reuse-roadmap.md)

**Evidence:**
[`NOTES/remix-agency-and-responsible-reuse-baseline.md`](../../NOTES/remix-agency-and-responsible-reuse-baseline.md)

## Goal

Make Thingtime's private copy/fork capability an accountable reuse journey:
before writing, a person can understand the exact source version, included and
retained dependencies, declared terms, attribution, destination privacy,
executable authority, and independence limits; afterward, source and
derivative remain separate, versioned, correctable, exportable, deletable, and
remediable without silent remote control.

This epic authorizes no implementation, schema, API, production experiment,
licence interpretation, public remix, payment, AI use, or training.

## Problem

The current fork route has strong mechanics: fresh access checks, bounded
dependency resolution, caller-owned private Things, copied first-party media,
targeted reference rewriting, quota/moderation reuse, source immutability,
cleanup, capability negotiation, and real-browser independence evidence.

But readable content is not necessarily reusable, a copied byte graph is not a
rights decision, and `forkOf` alone is not exact lineage. The product does not
yet show a fixed source/dependency plan, represent terms and attribution,
record material changes, distinguish remaining external reliance, carry
corrections safely, or provide a typed dispute/remedy path.

## Dependencies

- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns
  provenance/correction assertions, verification limits, and portable receipts.
- [TODO 31](./31-creator-sustainability-and-fair-value.md) owns creator terms,
  transactions, fulfilment, money, disputes, and fair-value evidence.
- [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns shared
  artifact roles and contributions. A fork grants no collaborative authority.
- [TODO 23](./23-data-portability-and-exit.md) owns export, restore, selective
  deletion, and account closure. A fork is not a recovery format.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns personal
  block, reports, cases, moderation, appeals, and safety remedies.
- [TODO 27](./27-trusted-developer-ecosystem.md) owns app permissions, release
  review, incident handling, update consent, and fair discovery.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI context,
  tools, authority, receipts, correction, and autonomy.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity
  projection, pseudonym contexts, assurance, correction, and recovery.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
  complete-journey accessibility and locale gates.
- [TODO 28](./28-service-continuity-and-recovery.md) owns truthful write
  outcomes, degraded operation, restore proof, and incidents.
- Open PRs are evidence only. Recheck exact head, base, CI, preview,
  capabilities, and shipped behavior before implementation.

## Phase 0 — Approve authority before code

- [ ] Name product, creator-support, rights/legal, privacy, security, safety,
      accessibility, operations, incident, appeal/remedy, and stop owners.
- [ ] Approve separate definitions for read, private copy, fork, remix,
      quotation, revision, attribution, grant, condition, withdrawal, dispute,
      and remedy.
- [ ] Approve a grant matrix for view, private copy, adaptation,
      redistribution, commercial use, sublicensing, translation, AI processing,
      and training. Unknown remains unknown and fails closed where required.
- [ ] Choose one platform-authored synthetic-test grant; do not infer reuse
      permission from ACL, public visibility, link key, purchase, relationship,
      collaboration, attribution, or prior copy.
- [ ] Approve retention, correction, terms-version, withdrawal, dispute,
      deletion, export, restore, and emergency-action boundaries.
- [ ] Record durable schema/API/storage decisions in `DECISIONS.md` only after
      approval. Do not create a parallel provenance, payment, ACL, moderation,
      app, identity, export, notification, or AI system.

**Phase gate:** no implementation or participant intake until every authority
and stop condition is approved.

## Phase 1 — Build one canonical copy plan

- [ ] Resolve an exact source revision and dependency graph through the same
      fresh authorization path execution will use.
- [ ] Classify every included Thing/file, linked record, retained external URL,
      runtime service, font, action, permission, secret-like value, unsupported
      dependency, and excluded private object.
- [ ] Show content/version/manifest hashes, declared terms and attribution,
      destination privacy, quota estimate, executable capabilities, remaining
      egress, unsupported behavior, and independence limits.
- [ ] Fail closed on missing, inaccessible, changed, blocked, unsafe,
      unretargetable, over-limit, terms-unknown required, or cyclic-beyond-limit
      dependencies.
- [ ] Make plan review complete by keyboard, screen reader, touch, zoom/reflow,
      reduced motion, narrow viewport, low bandwidth, and non-visual summary.
- [ ] Revalidate source, plan, account, endpoint, terms, moderation, quota, and
      capability immediately before any reservation or write.

## Phase 2 — Create one private version-bound derivative

- [ ] Preserve current fresh access checks, source immutability, caller-owned
      IDs, exact stored-file copies, quota, moderation, body/graph limits,
      timeout, transactional binding, cleanup, and semantic capabilities.
- [ ] Bind source revision/hash, dependency/material manifest hash, grant and
      plan versions, destination IDs, time, outcome, and cleanup state without
      retaining private payloads or secrets in the receipt.
- [ ] Keep creator, copier, contributor, publisher, rights holder, licensor,
      represented person, and platform assertions separate and correctable.
- [ ] Preserve approved attribution, terms pointer, source pointer,
      non-endorsement language, and later material-change note through export.
- [ ] Distinguish complete, cancelled, timed out, failed before writes, failed
      after writes, partial-cleanup-pending, disputed, and deleted states.
- [ ] Register every endpoint/contract change in the canonical capability
      registry, active route map, docs, client requirement map, compatibility
      tests, and built-server manifest smoke coverage.

## Phase 3 — Explain change without claiming truth

- [ ] Show accessible structural and rendered comparisons for content,
      dependency/action graphs, arguments, media, external reliance,
      permissions, and known accessibility/safety-relevant changes.
- [ ] Summarize material changes without exposing private source/derivative
      content or claiming equivalence, originality, licence compatibility,
      accessibility, safety, or truth from a diff.
- [ ] Let the remixer add and correct a bounded material-change note while
      preserving earlier receipt versions.
- [ ] Let an approved source attribution/terms correction preserve the exact
      metadata version that governed each prior copy.
- [ ] Keep lineage out of public search/ranking, analytics, training, logs,
      support views, notifications, and relationship inference by default.

## Phase 4 — Handle source change as a bounded proposal

- [ ] Type ordinary release, factual correction, security advisory, safety
      action, attribution correction, future-terms change, withdrawal, dispute,
      and deletion without collapsing them.
- [ ] Define which events may emit a content-minimal owner-private notice and
      which have no downstream effect.
- [ ] Offer compare, dismiss, defer, or adopt as a new derivative revision;
      never silently mutate the derivative or rewrite historical receipts.
- [ ] Preserve both intentions under stale/concurrent source and derivative
      changes; surface conflicts and an accessible retry/rebase path.
- [ ] Gate any urgent quarantine/disablement behind separately approved narrow
      safety/security authority with scope, reason, duration, offline/export
      behavior, human review, notice, appeal, and remedy.

## Phase 5 — Prove remedies, exit, and deletion

- [ ] Let a source owner stop approved future copies without claiming control
      of existing derivatives or hiding historical facts.
- [ ] Let a derivative owner delete their Things/files without changing the
      source; report backups, exports, recipients, provider state, receipts,
      cleanup, and completed effects truthfully.
- [ ] Use canonical [TODO 23](./23-data-portability-and-exit.md)
      inventory/export/delete/closure/restore contracts, and TODO 29
      provenance/correction receipts.
- [ ] Route rights, attribution, privacy, impersonation, malware, and safety
      claims to typed, minimum-evidence intake with interim policy, human
      authority, notification, appeal, correction, remedy, and retention.
- [ ] Prevent blocked/disputed repeat-fork laundering without treating reports
      as guilt or publishing private lineage/relationship graphs.

## Phase 6 — Run the bounded private pilot

- [ ] Use two approved adult test accounts and one synthetic, non-sensitive app
      with purpose-made text, one generated tiny image, and one inert action.
- [ ] Show the exact source/version/plan, synthetic-test grant, attribution,
      quota, private destination, retained external references, and limits.
- [ ] Create one private copy; prove source unchanged and supported copy
      independence through the real built API/storage/product boundaries.
- [ ] Change one labelled field, compare source and derivative, export a
      content-minimal lineage receipt, and correct the change note once.
- [ ] Publish one synthetic source correction; require explicit decline or
      adopt-as-new-revision, never remote mutation.
- [ ] Exercise privacy/revocation races, plan drift, account switch, capability
      mismatch, timeout, quota, partial cleanup, blocked media, external
      offline state, terms conflict, dispute, export, deletion, and restore.
- [ ] Inspect every affected screen top-to-bottom at desktop and 390px and open
      plan details, comparisons, notices, conflicts, errors, disputes, and
      deletion states.
- [ ] Delete all fixture Things/files and reconcile both accounts' receipts
      against observed storage and bounded residuals.

## Acceptance criteria

- [ ] Plan and execution use the same exact authorized source/dependency set;
      no unlisted item, secret, action, permission, grant, provider, or signal
      crosses the boundary.
- [ ] Both participants accurately predict what is copied, what remains
      external, what is permitted/unknown, who is credited, which version is
      used, and what later source change or deletion can do.
- [ ] Source and derivative remain unchanged by the other's copy, edit,
      correction, failure, withdrawal, dispute, deletion, and restore except
      through separately authorized, visible operations.
- [ ] Attribution, terms, material-change, lineage, correction, dispute,
      cleanup, export, and deletion states remain distinct and correctable.
- [ ] The copy passes exact-head capability, unit/integration, real storage,
      security/privacy, accessibility/language, constrained device/network,
      failure/recovery, export/delete/restore, and browser journey checks.
- [ ] Evaluation contains only approved content-free states and preserves
      negative, ambiguous, declined, disputed, and stopped outcomes.
- [ ] No success claim relies on copy count, publication, remix depth, dwell,
      notifications, revenue, originality scoring, or creator ranking.

## Stop conditions

- Any unlisted, inaccessible, private, unsafe, blocked, unsupported, or
  non-synthetic content/dependency is copied or exposed.
- Read, lineage, attribution, terms, relationship, or payment is treated as
  execution, ACL, app, moderation, endpoint, tool, AI, or identity authority.
- Source or derivative is silently mutated, published, monetized, trained on,
  recommended, disabled, or deleted because the other changed.
- Required attribution/terms are lost, private identities are exposed, or the
  product fabricates permission, ownership, authorship, endorsement, licence
  compatibility, independence, safety, accessibility, or truth.
- Partial copy, cleanup, correction, withdrawal, dispute, export, deletion,
  restore, or residual effects are hidden or misreported as complete.
- Personal block, moderation, account closure, incident action, appeal, or
  remedy can be bypassed through another fork.
- Any approved capability, accessibility, privacy, security, quota,
  constrained-network/device, recovery, or support gate fails.

## Explicit non-goals

- Legal advice, ownership/authorship proof, rights adjudication, automated
  licence compatibility, copyright filtering, or universal terms.
- Public/commercial reuse, remix galleries, rankings, recommendations, social
  graphs, badges, contests, virality, payments, royalties, or marketplaces.
- Live collaboration, shared ownership, automatic merging, remote update
  control, or source-author deletion of derivatives.
- AI generation, model training, embeddings, similarity/originality scoring,
  plagiarism verdicts, biometric inference, or automated durable sanctions.
- Real creator work or disputes, minors, institutions, sensitive domains,
  public publishing, commercial use, or cross-border pilot data.

## First owner decision packet

Approve or revise:

1. two adult test accounts and one fully synthetic source app;
2. one narrow synthetic-test grant for private copy plus one labelled change;
3. no public, commercial, payment, recommendation, AI, or training use;
4. exact plan plus terms/attribution/independence preview before writes;
5. a version-bound, content-minimal lineage receipt and accessible comparison;
6. one optional synthetic correction with explicit decline/adopt;
7. canonical export and deletion with truthful residuals; and
8. named qualified owners, incident/appeal/remedy paths, and manual stop
   authority before implementation begins.
