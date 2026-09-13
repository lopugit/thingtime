# Remix agency and responsible reuse roadmap

**Status:** 🟣 Proposed · planning only

**Grounded:** 2026-09-11, Australia/Melbourne

**Evidence:**
[Remix agency and responsible reuse baseline](../NOTES/remix-agency-and-responsible-reuse-baseline.md)

**Execution epic:**
[TODO 40 — Remix agency and responsible reuse](../TODO/claude-todo/40-remix-agency-and-responsible-reuse.md)

## Outcome

Let a person make a bounded, private, independently useful derivative while
understanding the exact source version, included dependencies, declared reuse
terms, attribution and change obligations, remaining external reliance, later
source notices, and available remedies. Preserve source and derivative agency:
neither side may silently acquire authority over, mutate, publish, or delete
the other.

This roadmap does not approve public remixing, a licence marketplace, legal
advice, automated compatibility decisions, payments, training, or remote
control of derivatives.

## Principles

1. **Access is not reuse permission.** Viewing, copying, adapting,
   redistributing, monetizing, and training are separate grants.
2. **Plan before write.** Show an exact bounded copy plan before quota,
   persistence, or external processing.
3. **Bind lineage to versions.** A mutable ID alone is not a receipt.
4. **Independence is scoped and testable.** Name retained external dependencies
   and unsupported behavior instead of promising universal portability.
5. **Attribution is contextual evidence.** It is not identity proof,
   endorsement, ownership, trust, or ranking authority.
6. **Updates are proposals.** A source change does not mutate a derivative;
   the recipient compares and chooses unless separately authorized safety law
   requires a narrow intervention.
7. **Terms never bypass platform safety.** Reuse permission cannot grant data,
   execution, moderation, app, endpoint, payment, or AI authority.
8. **No engagement objective.** Copy count, publication, remix depth, dwell,
   notifications, or revenue are not success measures.

## Dependencies and ownership boundaries

- [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
  owns provenance assertions, source/derivation vocabulary, correction
  integrity, verification limits, and portable provenance receipts.
- [TODO 31](../TODO/claude-todo/31-creator-sustainability-and-fair-value.md)
  owns creator terms, transaction truth, entitlements, fulfilment, money,
  disputes, refunds, settlement privacy, and fair-value evidence.
- [TODO 34](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md)
  owns invitations, shared artifact roles, proposals, conflicts, departure,
  removal, and collaborative stewardship. A fork is not shared edit authority.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns export,
  restore, selective deletion, and account closure. A fork is not an export or
  recovery format.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns personal blocks, reports, cases, scoped moderation, appeals, remedies,
  and safety transparency.
- [TODO 27](../TODO/claude-todo/27-trusted-developer-ecosystem.md) owns app
  identity, scopes, releases, review receipts, incidents, and update consent.
- [TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md)
  owns AI context, model/tool authority, receipts, correction, and autonomy.
- [TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)
  owns public identity projection, pseudonym contexts, assurance, correction,
  recovery, and attestation.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md)
  owns shared complete-journey access and locale gates.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  truthful write outcomes, degraded operation, restore proof, and incidents.
- Open PRs remain changeable evidence. Recheck exact head, base, CI, preview,
  capability contract, and shipped behavior before implementation.

## Milestone 0 — Approve the reuse charter

**Gate:** owner and qualified review; no implementation or experiment intake.

- Define source, version, dependency, copy, fork, remix, quotation, revision,
  attribution, grant, condition, independence, withdrawal, correction, dispute,
  and remedy without collapsing them.
- Choose the first supported source family and a deliberately narrow synthetic
  test grant. Do not infer permission from ACL, public visibility, a link key,
  purchase, collaboration, relationship, or prior copy.
- Name the exact rights/terms source, update authority, retention, correction,
  withdrawal, and conflict behavior. Unknown terms remain unknown.
- Define a grant matrix for view, private copy, adaptation, redistribution,
  commercial use, sublicensing, translation, AI processing, and training.
- Assign product, creator-support, rights/legal, privacy, security, safety,
  accessibility, operations, incident, and manual stop owners.
- Record any durable data/API/schema decision in `DECISIONS.md`; this plan does
  not choose storage representation.

## Milestone 1 — Produce an exact pre-copy plan

**Gate:** read-only planning returns the same dependency boundary as execution.

- Resolve a fixed source revision and canonical dependency graph through the
  same authorization path used by the final copy.
- Classify each item as copied first-party Thing, copied stored file, linked
  record, retained external reference, runtime service, font, action,
  permission, secret-like value, unsupported item, or excluded private data.
- Fail closed on missing, changing, inaccessible, blocked, unretargetable,
  cyclic beyond bounds, or terms-unknown required dependencies.
- Show size/quota estimates, destination privacy, executable capabilities,
  remaining egress, attribution preview, declared terms, and what the operation
  cannot guarantee.
- Make the plan keyboard/screen-reader usable and meaningful without color,
  side-by-side vision, legal jargon, or a wide viewport.
- Revalidate plan version, source authority, terms, moderation, account,
  endpoint, and capability immediately before writes.

## Milestone 2 — Bind copy event and lineage evidence

**Gate:** one atomic, content-minimal receipt matches observed writes.

- Allocate derivative IDs before rewriting; preserve current source
  immutability, authorization, quota, moderation, limits, timeout, cleanup, and
  capability-negotiation controls.
- Bind source revision/content hash, dependency/material manifest hash, grant
  version, copy-plan version, destination IDs, timestamp, outcome, and known
  cleanup state without retaining secret/private source payloads.
- Keep creator, copier, contributor, publisher, rights holder, licensor,
  subject, and platform assertions separate and correctable.
- Store attribution label, source pointer, declared terms pointer, material
  change note, and non-endorsement language in a form that can survive export.
- Distinguish complete, partial-cleanup-pending, failed-before-write,
  failed-after-write, cancelled, timed-out, disputed, and deleted outcomes.
- Register every new or changed endpoint in the canonical capability registry,
  docs, runtime map, client requirement map, and compatibility/build smoke tests.

## Milestone 3 — Make comparison and change legible

**Gate:** both parties can identify source, derivative, and material changes.

- Provide accessible structural and rendered comparisons with summaries for
  text, component/action graph, arguments, media, external dependencies,
  permissions, and known safety/accessibility changes.
- Never imply that absence from a diff proves equivalence, safe execution,
  licence compatibility, accessibility, or unchanged external behavior.
- Let the remixer write a bounded plain-language change note and correct it
  without rewriting historical evidence.
- Let a source creator correct approved attribution or terms metadata while
  preserving which version governed an earlier copy.
- Keep private source/derivative content out of public lineage pages, search,
  analytics, notifications, logs, support tooling, and aggregate graphs.

## Milestone 4 — Handle upstream change without remote control

**Gate:** notices are typed, optional by default, and never silently applied.

- Classify source events: ordinary new version, factual correction, security
  advisory, safety action, attribution correction, terms change for future use,
  source withdrawal, dispute, and deletion.
- Define which events may produce a content-minimal owner-private notice and
  which require no downstream signal.
- Offer compare, dismiss, defer, adopt as a new derivative revision, or open a
  remedy path. Preserve both intentions under concurrent or stale changes.
- Terms changes govern future acts only according to the approved contract;
  do not silently rewrite historical receipts or claim retroactive effect.
- Reserve any urgent disablement/quarantine authority for a separately approved,
  narrow safety/security contract with reason, scope, duration, appeal, remedy,
  and offline/export behavior.

## Milestone 5 — Prove exit, deletion, and disputes

**Gate:** each party can exercise its authority without fabricating control.

- Let creators stop future copies under the approved grant without remotely
  deleting existing derivatives or hiding historical facts.
- Let derivative owners delete their copy and copied media without mutating
  the source; explain bounded retained receipts, backups, exports, recipients,
  provider records, and completed effects.
- Reconcile lineage receipt, Thing/file inventory, export, selective deletion,
  account closure, and restore through canonical
  [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) contracts.
- Route rights, attribution, privacy, impersonation, malware, and safety claims
  to typed intake with minimum evidence, interim-action policy, human authority,
  notification, appeal, correction, remedy, and retention.
- Prevent repeat-fork laundering when a source or derivative is blocked or
  disputed, without using report count as guilt or publishing private graphs.

## Milestone 6 — Run one bounded private pilot

**Gate:** all earlier evidence and stop owners are approved at the exact head.

- Use two adult test accounts and one fully synthetic, non-sensitive app with
  purpose-made text, one generated image, and an inert internal action.
- Present one platform-authored synthetic-test grant, exact plan, attribution,
  quota, destination privacy, retained external references, and limitations.
- Make one private copy, change one labelled field, compare it, export the
  lineage receipt, receive one synthetic source correction, explicitly decline
  or adopt it, and delete every fixture.
- Test source privacy/revocation races, plan drift, account switch, capability
  mismatch, timeout, quota, partial cleanup, external offline state, blocked
  media, terms conflict, dispute, export, deletion, and restore.
- Inspect the complete journey at desktop and 390px, top-to-bottom, including
  plan, nested details, comparison, notice, conflict, error, dispute, and delete
  states, with keyboard and screen-reader evidence.
- Record only content-free scenario/version/outcome states, comprehension,
  accessibility profile, incidents, and stop reasons.

## Measures

- Plan/execution dependency-set equality and exact source-version binding.
- Zero unlisted or unauthorized Things, files, references, secrets, actions,
  grants, providers, or telemetry writes.
- Source and derivative immutability under copy, update, failure, and deletion.
- Participant accuracy about permission, contents, independence, attribution,
  updates, disputes, and deletion effects before and after the journey.
- Complete, correct, accessible comparison and lineage/export/delete receipts.
- Cleanup completion time and honest residual-state reporting.
- Negative, ambiguous, declined, disputed, and stopped outcomes retained in
  evaluation; no conversion, dwell, publication, remix-count, or revenue goal.

## Continuous gate before broader work

- Re-run exact-head unit, integration, built-server capability, storage,
  browser, accessibility, security, privacy, quota, failure/recovery, export,
  delete, and restore checks.
- Re-review every new source/content/dependency family and every reuse grant,
  terms source, external service, public audience, payment, AI use, training,
  recommendation, minor, institution, sensitive domain, or jurisdiction.
- Publish no claims such as “independent,” “licensed,” “original,” “safe,”
  “accessible,” or “creator-friendly” beyond the exact tested evidence.
- Stop or roll back when any stop condition in TODO 40 fires.

## Explicit non-goals

- Legal advice, rights adjudication, automated licence compatibility, copyright
  filtering, authorship/ownership proof, or universal terms.
- Public remix galleries, rankings, recommendations, social graphs, virality,
  contests, badges, creator scores, or engagement analytics.
- Payments, royalties, revenue sharing, marketplaces, sublicensing, or rights
  transfer.
- Live co-editing, shared ownership, merge automation, remote update control,
  or source-author deletion of derivatives.
- AI generation, model training, embeddings, similarity/originality scoring,
  plagiarism verdicts, biometric/media inference, or automated moderation.
- Real creator work, real disputes, minors, institutions, sensitive domains,
  public publishing, commercial use, or cross-border pilot data.

## First owner decision packet

Approve or revise:

1. two adult test accounts and one fully synthetic source app;
2. a narrow platform-authored synthetic-test grant for one private copy and
   one labelled change, with no public/commercial/AI use;
3. exact source/dependency/terms/attribution plan before writes;
4. a version-bound, content-minimal lineage receipt and accessible comparison;
5. one optional synthetic correction notice with explicit decline/adopt;
6. canonical export and full fixture deletion with truthful residuals;
7. content-free evaluation and no engagement objective; and
8. named qualified reviewers, incident path, appeal/remedy owner, and manual
   stop authority before implementation starts.
